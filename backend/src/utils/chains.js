/**
 * Chain watching, and the price it is quoted at.
 *
 * There is no payment processor here. Funds go straight to the operator's own
 * wallet, and this module's whole job is to answer one question honestly: has a
 * transfer of exactly this amount, to exactly this address, landed since this
 * invoice was raised.
 *
 * Everything talks to public explorers over plain HTTP with no account and no
 * key. That is deliberate — a processor means custody, a cut, and usually KYC —
 * but it does mean this code is a client of somebody else's uptime, and it says
 * so when they are down rather than reporting "not paid".
 *
 * ── Integers, everywhere ──────────────────────────────────────────────────
 *
 * Amounts are compared as BigInt base units — satoshis, and USDT×10⁶. Never as
 * floats. 0.1 + 0.2 is not 0.3 in IEEE 754, and a matcher that rounds is one
 * that silently rejects correct payments and, worse, occasionally accepts short
 * ones.
 */

/** USDT on Tron. The one contract that counts; anything else is not USDT. */
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const DECIMALS = { BTC: 8, USDT: 6 };

/**
 * Confirmations before an unlock is granted.
 *
 * One block for Bitcoin. Zero would be reversible by a fee-bumped replacement,
 * and six is forty minutes of a customer staring at a spinner for a payment
 * whose size does not justify it.
 *
 * Tron settles in about three seconds and the explorer only returns transfers
 * already in a block, so the threshold there is expressed as age instead.
 */
const BTC_MIN_CONFIRMATIONS = 1;
const TRON_MIN_AGE_MS = 20 * 1000;

class ChainError extends Error {
  constructor(message) {
    super(message);
    this.status = 502;
  }
}

/** Public APIs are someone else's uptime. A hung fetch must not hang a request. */
async function getJson(url, { headers, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new ChainError(`Explorer returned ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err instanceof ChainError) throw err;
    throw new ChainError('Could not reach the block explorer. Try again shortly.');
  } finally {
    clearTimeout(timer);
  }
}

/* ── Decimal handling ─────────────────────────────────────────────────────── */

/** "0.00041537" -> 41537n, at 8 decimals. String in, BigInt out, no floats. */
function toBaseUnits(decimalString, decimals) {
  const [whole, frac = ''] = String(decimalString).trim().split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/** 41537n -> "0.00041537". Trailing zeros trimmed, but never the whole part. */
function fromBaseUnits(units, decimals) {
  const s = BigInt(units).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/* ── Price ────────────────────────────────────────────────────────────────── */

/**
 * USD per unit of the asset, pinned into the invoice at issue.
 *
 * USDT is quoted at one dollar rather than fetched. It is a dollar token; using
 * its market price would mean an invoice for $49 asking for 49.02 USDT because
 * the peg wobbled a fifth of a percent that afternoon, which looks like a
 * mistake to the person paying and is not worth the two cents.
 */
async function usdRate(asset) {
  if (asset === 'USDT') return '1';
  if (asset !== 'BTC') throw new ChainError(`Unknown asset: ${asset}`);

  const data = await getJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  );
  const rate = data?.bitcoin?.usd;
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    throw new ChainError('Could not get a Bitcoin price just now. Try again shortly.');
  }
  return String(rate);
}

/**
 * What to charge, in base units, for a price in cents.
 *
 * Rounded up. A rounded-down invoice asks for very slightly less than the
 * stated price, and the difference — invisible per payment — is the sort of
 * thing that is discovered a year later in an accounts reconciliation.
 */
function quote(priceCents, rate, asset) {
  const decimals = DECIMALS[asset];
  const scale = 10n ** BigInt(decimals);
  const cents = BigInt(priceCents);
  /* rate is a decimal string; carry it at 8 places so the division is integral. */
  const rateUnits = toBaseUnits(rate, 8);
  if (rateUnits <= 0n) throw new ChainError('Invalid exchange rate.');

  const numerator = cents * scale * 10n ** 8n;
  const denominator = 100n * rateUnits;
  return (numerator + denominator - 1n) / denominator; // ceil
}

/* ── Bitcoin ──────────────────────────────────────────────────────────────── */

/**
 * Look for a transfer of exactly `expectedUnits` satoshis to `address`.
 *
 * mempool.space returns an address's recent transactions with every output.
 * Outputs are summed per transaction, because a wallet may legitimately pay one
 * address across two outputs in a single transaction, and treating those as two
 * short payments would reject a correct one.
 */
async function checkBitcoin({ address, expectedUnits, since }) {
  const txs = await getJson(`https://mempool.space/api/address/${encodeURIComponent(address)}/txs`);
  if (!Array.isArray(txs)) throw new ChainError('Unexpected response from the Bitcoin explorer.');

  let tipHeight = null;
  const sinceSec = Math.floor(new Date(since).getTime() / 1000);
  let best = null;

  for (const tx of txs) {
    /* Unconfirmed transactions carry no block time, so they are judged as
       current — which is right: they cannot predate the invoice. */
    const seenAt = tx.status?.block_time ?? Math.floor(Date.now() / 1000);
    /* A minute of slack. Block timestamps are not wall clocks and may run a
       little behind the moment the invoice was written. */
    if (seenAt < sinceSec - 60) continue;

    const paid = (tx.vout || [])
      .filter((o) => o.scriptpubkey_address === address)
      .reduce((sum, o) => sum + BigInt(o.value || 0), 0n);
    if (paid === 0n) continue;

    let confirmations = 0;
    if (tx.status?.confirmed && tx.status.block_height) {
      if (tipHeight === null) {
        tipHeight = Number(await getJson('https://mempool.space/api/blocks/tip/height'));
      }
      confirmations = Math.max(0, tipHeight - tx.status.block_height + 1);
    }

    const candidate = { txid: tx.txid, receivedUnits: paid, confirmations };
    if (paid === BigInt(expectedUnits)) {
      /* An exact match wins outright, and the most-confirmed exact match wins
         among several. */
      if (!best?.exact || confirmations > best.confirmations) {
        best = { ...candidate, exact: true };
      }
    } else if (!best) {
      /* Held only so the payer can be told what actually arrived. Nothing is
         unlocked on it. */
      best = { ...candidate, exact: false };
    }
  }

  if (!best) return { found: false };
  return {
    found: true,
    exact: best.exact,
    txid: best.txid,
    receivedUnits: best.receivedUnits.toString(),
    confirmations: best.confirmations,
    settled: best.exact && best.confirmations >= BTC_MIN_CONFIRMATIONS,
  };
}

/* ── Tron / USDT TRC-20 ───────────────────────────────────────────────────── */

/**
 * Look for a TRC-20 USDT transfer of exactly `expectedUnits` to `address`.
 *
 * Filtered on the contract address, not on the token's name. A TRC-20 token can
 * call itself whatever it likes — "USDT" included — and matching on a symbol is
 * how a checkout ends up crediting somebody for a worthless token they minted
 * themselves that morning.
 *
 * TronGrid works without a key at a modest rate limit; TRONGRID_API_KEY raises
 * it and is read here if set.
 */
async function checkTron({ address, expectedUnits, since }) {
  const url =
    `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` +
    `?limit=50&only_to=true&contract_address=${USDT_TRC20}`;

  const headers = process.env.TRONGRID_API_KEY
    ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
    : undefined;

  const body = await getJson(url, { headers });
  const rows = body?.data;
  if (!Array.isArray(rows)) throw new ChainError('Unexpected response from the Tron explorer.');

  const sinceMs = new Date(since).getTime() - 60 * 1000;
  let best = null;

  for (const row of rows) {
    if (row.type && row.type !== 'Transfer') continue;
    if (row.to !== address) continue;
    if (row.token_info?.address !== USDT_TRC20) continue;
    const at = Number(row.block_timestamp || 0);
    if (at < sinceMs) continue;

    let paid;
    try { paid = BigInt(row.value); } catch { continue; }

    const age = Date.now() - at;
    const candidate = { txid: row.transaction_id, receivedUnits: paid, age };

    if (paid === BigInt(expectedUnits)) {
      if (!best?.exact || age > best.age) best = { ...candidate, exact: true };
    } else if (!best) {
      best = { ...candidate, exact: false };
    }
  }

  if (!best) return { found: false };
  return {
    found: true,
    exact: best.exact,
    txid: best.txid,
    receivedUnits: best.receivedUnits.toString(),
    /* Tron has no confirmation count worth surfacing — the explorer only
       returns transfers already in a block. Reported as 1 once it has had a
       moment to settle, so the client has one number to reason about. */
    confirmations: best.age >= TRON_MIN_AGE_MS ? 1 : 0,
    settled: best.exact && best.age >= TRON_MIN_AGE_MS,
  };
}

const check = ({ chain, ...rest }) =>
  chain === 'BITCOIN' ? checkBitcoin(rest)
    : chain === 'TRON' ? checkTron(rest)
      : Promise.reject(new ChainError(`Unknown chain: ${chain}`));

module.exports = {
  ChainError, USDT_TRC20, DECIMALS,
  BTC_MIN_CONFIRMATIONS,
  toBaseUnits, fromBaseUnits, usdRate, quote, check,
};
