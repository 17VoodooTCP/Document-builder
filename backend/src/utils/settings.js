const prisma = require('./prisma');

/**
 * Platform settings, with the environment as a fallback.
 *
 * Read on the payment path, which means it is read while somebody is staring at
 * a spinner waiting to be told where to send money. So it is cached — but
 * briefly, and the cache is dropped the moment an operator saves, because the
 * first thing anybody does after pasting a wallet address is reload the page to
 * check it took.
 *
 * A blank field falls through to its environment variable rather than
 * overriding it with emptiness. That ordering matters: it lets a deployment
 * configured the old way keep running untouched, and it means clearing a field
 * in the admin screen reverts to the deployed default rather than silently
 * turning payments off.
 */

const KEY = 'singleton';
const TTL_MS = 15_000;

let cached = null;
let cachedAt = 0;

const clean = (v) => String(v ?? '').trim();

/** Blank in the database means "not set here", not "set to nothing". */
const prefer = (row, env) => clean(row) || clean(process.env[env]);

async function raw() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  /* Absent row is a normal state, not an error — a fresh install has never had
     anybody open the admin screen. Defaults stand in until it does. */
  cached = await prisma.platformSettings.findUnique({ where: { key: KEY } }).catch(() => null);
  cachedAt = Date.now();
  return cached;
}

/** Call after any write, so the next read is the value just saved. */
const invalidate = () => { cached = null; cachedAt = 0; };

/**
 * Everything the payment path needs, resolved.
 *
 * The price is the one field that does not fall back to the environment when
 * it is zero — a price of nothing is a real thing an operator might set during
 * a launch, and treating it as "unset" would quietly start charging again.
 */
async function settings() {
  const row = await raw();

  const envPrice = Number(process.env.UNLOCK_PRICE_USD);
  const fallbackCents = Number.isFinite(envPrice) && envPrice >= 0
    ? Math.round(envPrice * 100)
    : 4900;

  return {
    priceCents: typeof row?.priceCents === 'number' ? row.priceCents : fallbackCents,
    btcAddress: prefer(row?.btcAddress, 'BTC_ADDRESS'),
    usdtTronAddress: prefer(row?.usdtTronAddress, 'USDT_TRON_ADDRESS'),
    btcQr: row?.btcQr || null,
    usdtQr: row?.usdtQr || null,
    offerHeadline: clean(row?.offerHeadline),
    offerNote: clean(row?.offerNote),
  };
}

/** The stored row as the admin screen edits it, creating it on first open. */
async function editable() {
  const row = await raw();
  if (row) return row;
  const created = await prisma.platformSettings.create({ data: { key: KEY } });
  invalidate();
  return created;
}

async function save(data, userId) {
  const updated = await prisma.platformSettings.upsert({
    where: { key: KEY },
    create: { key: KEY, ...data, updatedBy: userId },
    update: { ...data, updatedBy: userId },
  });
  invalidate();
  return updated;
}

module.exports = { settings, editable, save, invalidate, KEY };
