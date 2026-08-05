const express = require('express');
const prisma = require('../utils/prisma');
const { authenticate } = require('../middleware/auth');
const { editable, save, settings } = require('../utils/settings');
const { ingest, AssetError } = require('../utils/assets');

const router = express.Router();

/**
 * The operator's console.
 *
 * Platform operators only — the people who run this installation, as distinct
 * from the administrators of any tenant on it. An organisation owner has total
 * authority over their own letterhead and none at all here.
 *
 * ── On editing wallet addresses from a web page ───────────────────────────
 *
 * A receiving address is public by construction: it is the thing you hand to
 * somebody so they can pay you, and publishing it is the entire point. No
 * private key, seed or mnemonic exists anywhere in this codebase, so nothing
 * reachable from this screen can move money — the worst an attacker with this
 * page could do is redirect *future* payments, which is why it is behind the
 * operator flag and why every change records who made it.
 *
 * That is also the reason a saved address is echoed back in full rather than
 * masked. An address you cannot read is one you cannot check, and a single
 * wrong character sends a customer's payment somewhere neither of you can
 * reach.
 */

function requirePlatformAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  /*
   * 404 rather than 403, matching the organisation guard. Telling somebody a
   * platform console exists but is closed to them is an invitation to go
   * looking for a way in; to everybody else this route simply is not here.
   */
  if (!req.user.isPlatformAdmin) return res.status(404).json({ error: 'Route not found' });
  next();
}

router.use(authenticate, requirePlatformAdmin);

const shape = (row) => ({
  priceCents: row.priceCents,
  btcAddress: row.btcAddress || '',
  usdtTronAddress: row.usdtTronAddress || '',
  btcQr: row.btcQr || null,
  usdtQr: row.usdtQr || null,
  offerHeadline: row.offerHeadline || '',
  offerNote: row.offerNote || '',
  updatedAt: row.updatedAt,
});

/**
 * Shapes only, deliberately loose.
 *
 * Bitcoin has legacy, P2SH and three generations of bech32; Tron is base58
 * beginning with T. Validating harder than this would mean shipping an address
 * parser and rejecting formats that do not exist yet — and the real check is
 * the operator reading their own address back, which is why it is shown in
 * full. What this does catch is the common slip: a pasted URL, a truncation, a
 * Tron address in the Bitcoin field.
 */
const LOOKS_BTC = /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
const LOOKS_TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

router.get('/settings', async (req, res, next) => {
  try {
    const row = await editable();
    res.json({
      settings: shape(row),
      /* What the payment path will actually use once the environment fallback
         has been applied. Without this an operator cannot tell whether a blank
         field means "unset" or "inherited from the deployment". */
      effective: await settings(),
    });
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  const b = req.body || {};
  const data = {};

  if (b.priceCents !== undefined) {
    const cents = Number(b.priceCents);
    if (!Number.isInteger(cents) || cents < 0 || cents > 100_000_00) {
      return res.status(400).json({ error: 'Price must be a whole number of cents, up to $100,000.' });
    }
    data.priceCents = cents;
  }

  if (typeof b.btcAddress === 'string') {
    const v = b.btcAddress.trim();
    if (v && !LOOKS_BTC.test(v)) {
      return res.status(400).json({ error: 'That does not look like a Bitcoin address.' });
    }
    data.btcAddress = v;
  }

  if (typeof b.usdtTronAddress === 'string') {
    const v = b.usdtTronAddress.trim();
    if (v && !LOOKS_TRON.test(v)) {
      return res.status(400).json({
        error: 'That does not look like a Tron address. TRC-20 addresses begin with T.',
      });
    }
    data.usdtTronAddress = v;
  }

  for (const k of ['offerHeadline', 'offerNote']) {
    if (typeof b[k] === 'string') data[k] = b[k].trim().slice(0, 300);
  }

  try {
    const row = await save(data, req.user.id);
    res.json({ settings: shape(row), effective: await settings() });
  } catch (err) { next(err); }
});

/**
 * PUT /admin/settings/qr/:asset   { dataUrl }
 *
 * An operator-supplied payment QR. Sending null clears it, at which point the
 * application goes back to generating one from the address — which is the
 * better default, and the reason this is optional rather than required.
 */
router.put('/settings/qr/:asset', async (req, res, next) => {
  const asset = String(req.params.asset || '').toUpperCase();
  const field = asset === 'BTC' ? 'btcQr' : asset === 'USDT' ? 'usdtQr' : null;
  if (!field) return res.status(400).json({ error: 'Asset must be BTC or USDT.' });

  try {
    if (req.body?.dataUrl === null) {
      const row = await save({ [field]: null }, req.user.id);
      return res.json({ settings: shape(row), cleared: true });
    }

    const asset_ = await ingest(req.body?.dataUrl, 'qr');
    const row = await save({ [field]: asset_.dataUrl }, req.user.id);
    res.json({
      settings: shape(row),
      asset: { bytes: asset_.bytes, width: asset_.width, height: asset_.height },
    });
  } catch (err) {
    if (err instanceof AssetError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * GET /admin/overview
 *
 * The numbers an operator actually opens this page to see. Counts only — no
 * customer document content passes through here, because the register does not
 * store any and the operator has no more business reading correspondence than
 * anybody else.
 */
router.get('/overview', async (req, res, next) => {
  try {
    const [users, unlocked, organisations, documents, confirmed, open] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { NOT: [{ unlockedAt: null }, { unlockedAt: { isSet: false } }] } }),
      prisma.organisation.count(),
      prisma.document.count(),
      prisma.payment.findMany({
        where: { status: 'CONFIRMED' },
        orderBy: { confirmedAt: 'desc' },
        take: 20,
        select: {
          id: true, asset: true, amount: true, priceCents: true,
          txid: true, confirmedAt: true, user: { select: { email: true } },
        },
      }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'SEEN'] } } }),
    ]);

    res.json({
      counts: { users, unlocked, organisations, documents, openInvoices: open },
      /* Takings, from confirmed rows only. Anything else would be a projection
         dressed up as revenue. */
      takenCents: confirmed.reduce((sum, p) => sum + p.priceCents, 0),
      recent: confirmed.map((p) => ({
        id: p.id, asset: p.asset, amount: p.amount, priceCents: p.priceCents,
        txid: p.txid, confirmedAt: p.confirmedAt, email: p.user?.email || null,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
