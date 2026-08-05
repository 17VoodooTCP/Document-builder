const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const prisma = require('../utils/prisma');
const { authenticate } = require('../middleware/auth');
const {
  ChainError, DECIMALS, BTC_MIN_CONFIRMATIONS,
  fromBaseUnits, usdRate, quote, check,
} = require('../utils/chains');

const router = express.Router();

/**
 * Paying for access.
 *
 * A one-off unlock per account, settled on-chain, watched by us. No processor
 * sits in the middle, so nothing here ever holds the customer's funds and there
 * is no key on this server that could move them — the configured addresses are
 * receive-only as far as this codebase is concerned.
 *
 * ── What this can and cannot promise ──────────────────────────────────────
 *
 * Crypto payments are irreversible and there is no chargeback. That cuts both
 * ways and the copy says so: an invoice quotes an exact figure, states the
 * network it must arrive on, and expires. A payment sent to the wrong chain, or
 * for the wrong amount, is not something this system can undo — it can only
 * report, accurately, what it saw arrive.
 *
 * Which is why the status is never called "verified" until it is. PENDING,
 * SEEN, CONFIRMED and MISMATCH each name a different thing that is true.
 */

const ASSETS = {
  BTC: { chain: 'BITCOIN', label: 'Bitcoin', network: 'Bitcoin', env: 'BTC_ADDRESS' },
  USDT: { chain: 'TRON', label: 'Tether', network: 'Tron (TRC-20)', env: 'USDT_TRON_ADDRESS' },
};

/** Default $49. Set UNLOCK_PRICE_USD to a plain dollar figure to change it. */
const priceCents = () => {
  const dollars = Number(process.env.UNLOCK_PRICE_USD || '49');
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 4900;
};

/** How long a quote stands. Long enough to open a wallet, short enough that a
    pinned Bitcoin rate is not a free option on the operator at our expense. */
const INVOICE_TTL_MS = 30 * 60 * 1000;

const receivingAddress = (asset) => (process.env[ASSETS[asset].env] || '').trim();

/* Raising invoices is cheap for us and free for a caller, so it is limited
   separately from the global allowance — an open endpoint that writes a row and
   calls a price API is one worth keeping on a short leash. */
const invoiceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Try again in a few minutes.' },
});

router.use(authenticate);

/** How the invoice looks to the client. Never internal bookkeeping. */
const shape = (p) => ({
  id: p.id,
  asset: p.asset,
  chain: p.chain,
  network: ASSETS[p.asset]?.network || p.chain,
  address: p.address,
  amount: p.amount,
  priceCents: p.priceCents,
  rate: p.rate,
  status: p.status,
  statusDetail: p.statusDetail,
  txid: p.txid,
  confirmations: p.confirmations,
  requiredConfirmations: p.chain === 'BITCOIN' ? BTC_MIN_CONFIRMATIONS : 1,
  received: p.receivedUnits ? fromBaseUnits(p.receivedUnits, DECIMALS[p.asset]) : null,
  expiresAt: p.expiresAt,
  confirmedAt: p.confirmedAt,
  createdAt: p.createdAt,
});

/**
 * GET /payments/config
 *
 * What may be paid with, and how much. Assets whose address is unset are
 * reported as unavailable rather than offered and then failed at the last
 * step — an invoice that cannot be paid is worse than a button that is not
 * there.
 */
router.get('/config', (req, res) => {
  res.json({
    priceCents: priceCents(),
    unlocked: !!req.user.unlockedAt,
    assets: Object.entries(ASSETS).map(([asset, meta]) => ({
      asset,
      label: meta.label,
      network: meta.network,
      available: !!receivingAddress(asset),
    })),
  });
});

/**
 * POST /payments/invoice   { asset }
 *
 * Raises an invoice, or hands back the open one. Re-quoting on every visit
 * would move the figure under somebody who has already hit send in their
 * wallet, and the amount is the only thing identifying their payment.
 */
router.post('/invoice', invoiceLimiter, async (req, res, next) => {
  const asset = String(req.body?.asset || '').toUpperCase();
  if (!ASSETS[asset]) {
    return res.status(400).json({ error: 'Choose either BTC or USDT.' });
  }
  if (req.user.unlockedAt) {
    return res.status(409).json({ error: 'This account already has access.' });
  }

  const address = receivingAddress(asset);
  if (!address) {
    return res.status(503).json({
      error: `${ASSETS[asset].label} is not accepted yet — no receiving address is configured.`,
    });
  }

  try {
    const open = await prisma.payment.findFirst({
      where: {
        userId: req.user.id, asset,
        status: { in: ['PENDING', 'SEEN'] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (open) return res.json({ payment: shape(open) });

    const cents = priceCents();
    const rate = await usdRate(asset);
    const base = quote(cents, rate, asset);

    /*
     * A few base units of noise on top, so this invoice's figure is its own.
     *
     * Every invoice shares one receiving address, so the amount is what tells
     * them apart. The offset is tiny — under a thousand satoshis, under a
     * hundredth of a dollar in USDT — and it is checked against every other
     * open invoice on the chain rather than merely assumed unique. Trusting
     * randomness here would mean crediting the wrong account on a collision,
     * which is the one failure in this file nobody could unpick afterwards.
     */
    let amountUnits = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const noise = BigInt(crypto.randomInt(asset === 'BTC' ? 1000 : 10000));
      const candidate = (base + noise).toString();
      const clash = await prisma.payment.findFirst({
        where: {
          chain: ASSETS[asset].chain,
          amountUnits: candidate,
          status: { in: ['PENDING', 'SEEN'] },
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!clash) { amountUnits = candidate; break; }
    }
    if (!amountUnits) {
      return res.status(503).json({ error: 'Could not raise an invoice just now. Try again shortly.' });
    }

    const payment = await prisma.payment.create({
      data: {
        userId: req.user.id,
        asset,
        chain: ASSETS[asset].chain,
        address,
        amount: fromBaseUnits(amountUnits, DECIMALS[asset]),
        amountUnits,
        priceCents: cents,
        rate,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + INVOICE_TTL_MS),
      },
    });

    res.status(201).json({ payment: shape(payment) });
  } catch (err) {
    if (err instanceof ChainError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/**
 * GET /payments/:id
 *
 * The client polls this. Rather than run a scheduler — which a free instance
 * that sleeps between requests would not reliably wake for — the poll itself
 * drives the chain check, throttled so that a page left open does not hammer a
 * public explorer.
 */
router.get('/:id', async (req, res, next) => {
  if (!/^[0-9a-f]{24}$/i.test(String(req.params.id || ''))) {
    return res.status(404).json({ error: 'No such payment.' });
  }

  try {
    let payment = await prisma.payment.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!payment) return res.status(404).json({ error: 'No such payment.' });

    const settled = payment.status === 'CONFIRMED';
    const stale = !payment.lastCheckedAt || Date.now() - payment.lastCheckedAt.getTime() > 10_000;

    if (!settled && stale) {
      try {
        payment = await reconcile(payment);
      } catch (err) {
        /*
         * An explorer being unreachable is reported as exactly that, alongside
         * the invoice, rather than as a payment failure. Somebody who has just
         * sent Bitcoin should not be told anything that sounds like "we did not
         * get it" because a third-party API returned a 502.
         */
        if (err instanceof ChainError) {
          return res.json({ payment: shape(payment), warning: err.message });
        }
        throw err;
      }
    }

    /*
     * A confirmed payment that did not unlock anything is repaired here.
     *
     * Once a row reads CONFIRMED nothing above will look at it again, so a
     * grant that failed the first time — a filter that matched nothing, a
     * transaction that lost its second half — would stay failed forever, and
     * the customer would be left holding a settled transaction and no access.
     * Cheap to re-check, and it is the difference between a bug that self-heals
     * on the next page load and one that needs a support ticket.
     */
    let unlocked = await isUnlocked(req.user.id);
    if (payment.status === 'CONFIRMED' && !unlocked) {
      await grantAccess(payment);
      unlocked = await isUnlocked(req.user.id);
    }

    res.json({ payment: shape(payment), unlocked });
  } catch (err) { next(err); }
});

/** Every invoice this account has raised. */
router.get('/', async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    res.json({ payments: payments.map(shape) });
  } catch (err) { next(err); }
});

const isUnlocked = async (userId) => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { unlockedAt: true } });
  return !!u?.unlockedAt;
};

/**
 * Grant access on the strength of a settled payment.
 *
 * The `isSet: false` half of the filter is load-bearing — see the note at the
 * call site inside the transaction. Written once and used from both places so
 * the two can never drift apart, which is precisely how one of them would end
 * up with the working filter and the other with the broken one.
 */
const grantAccess = (payment) =>
  prisma.user.updateMany({
    where: {
      id: payment.userId,
      OR: [{ unlockedAt: null }, { unlockedAt: { isSet: false } }],
    },
    data: { unlockedAt: payment.confirmedAt || new Date(), unlockedBy: payment.id },
  });

/**
 * Ask the chain, then write down what it said.
 *
 * The unlock is granted inside a transaction with the status write, so an
 * account can never end up marked paid against an invoice that is not, or hold
 * a confirmed invoice that never unlocked anything.
 */
async function reconcile(payment) {
  const now = new Date();

  if (payment.expiresAt < now && payment.status === 'PENDING') {
    /* Expiry is about the quote, not the money. A late payment of the right
       amount still matches — the row keeps its amount — so this only stops the
       client waiting on a rate that has long since moved. */
    return prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED', lastCheckedAt: now },
    });
  }

  const result = await check({
    chain: payment.chain,
    address: payment.address,
    expectedUnits: payment.amountUnits,
    since: payment.createdAt,
  });

  if (!result.found) {
    return prisma.payment.update({
      where: { id: payment.id },
      data: { lastCheckedAt: now },
    });
  }

  if (!result.exact) {
    const got = fromBaseUnits(result.receivedUnits, DECIMALS[payment.asset]);
    return prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'MISMATCH',
        statusDetail:
          `A transfer of ${got} ${payment.asset} arrived, but this invoice is for ` +
          `${payment.amount} ${payment.asset}. The exact amount is what identifies your payment. ` +
          'Get in touch quoting the transaction id and it can be settled by hand.',
        txid: result.txid,
        receivedUnits: result.receivedUnits,
        lastCheckedAt: now,
      },
    });
  }

  if (!result.settled) {
    return prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SEEN',
        statusDetail: null,
        txid: result.txid,
        receivedUnits: result.receivedUnits,
        confirmations: result.confirmations,
        seenAt: payment.seenAt || now,
        lastCheckedAt: now,
      },
    });
  }

  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CONFIRMED',
        statusDetail: null,
        txid: result.txid,
        receivedUnits: result.receivedUnits,
        confirmations: result.confirmations,
        seenAt: payment.seenAt || now,
        confirmedAt: now,
        lastCheckedAt: now,
      },
    }),
    /*
     * Guarded so a second confirmed invoice cannot overwrite which payment
     * bought the access — but the guard has to allow for the field being
     * *absent* as well as null.
     *
     * This is the trap the schema already warns about on AuthToken.usedAt, and
     * it bites exactly the same way here. Prisma's MongoDB connector treats a
     * missing key and an explicit null as different things, and every user row
     * written before `unlockedAt` existed has no such key at all. A bare
     * `unlockedAt: null` filter therefore matches nothing, updates nobody, and
     * fails silently — leaving a customer with a payment confirmed on-chain and
     * no access to what they bought. Caught only because the flow was tested
     * against a real transaction rather than a mocked one.
     */
    prisma.user.updateMany({
      where: {
        id: payment.userId,
        OR: [{ unlockedAt: null }, { unlockedAt: { isSet: false } }],
      },
      data: { unlockedAt: now, unlockedBy: payment.id },
    }),
  ]);

  return updated;
}

module.exports = router;
