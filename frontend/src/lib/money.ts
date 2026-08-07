/**
 * Money, in integers.
 *
 * Every amount in this module is a whole number of minor units — cents, pence,
 * øre — and never a float. This is the same rule the crypto invoicing follows
 * and for the same reason: 0.1 + 0.2 is not 0.3 in IEEE 754, and an invoice
 * whose lines sum to a grand total a customer's accounts department cannot
 * reproduce is an invoice that gets queried instead of paid.
 *
 * Quantities are carried in thousandths so that "2.5 hours" or "0.375 tonnes"
 * are exact, and percentages in basis points so that 8.25% VAT is 825 rather
 * than a number that cannot be written down in binary.
 *
 * Rounding is half-up, applied once per line rather than once at the end. That
 * is the convention every accounting package uses, and matching it is what lets
 * a line-by-line hand check agree with the printed total.
 */

/** A currency, and how it is written. */
export interface Currency {
  code: string;
  symbol: string;
  /** Minor units per major unit expressed as a power of ten. */
  decimals: number;
  label: string;
}

/*
 * Zero-decimal currencies are not a curiosity — JPY is one of the most-invoiced
 * currencies on earth, and treating ¥1,000 as ten major units is the sort of
 * error that survives all the way to a bank transfer.
 */
export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', decimals: 2, label: 'US Dollar' },
  { code: 'EUR', symbol: '€', decimals: 2, label: 'Euro' },
  { code: 'GBP', symbol: '£', decimals: 2, label: 'Pound Sterling' },
  { code: 'NOK', symbol: 'kr', decimals: 2, label: 'Norwegian Krone' },
  { code: 'AED', symbol: 'د.إ', decimals: 2, label: 'UAE Dirham' },
  { code: 'CAD', symbol: 'C$', decimals: 2, label: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', decimals: 2, label: 'Australian Dollar' },
  { code: 'CHF', symbol: 'CHF', decimals: 2, label: 'Swiss Franc' },
  { code: 'SGD', symbol: 'S$', decimals: 2, label: 'Singapore Dollar' },
  { code: 'ZAR', symbol: 'R', decimals: 2, label: 'South African Rand' },
  { code: 'INR', symbol: '₹', decimals: 2, label: 'Indian Rupee' },
  { code: 'JPY', symbol: '¥', decimals: 0, label: 'Japanese Yen' },
];

export const currency = (code: string): Currency =>
  CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

/** Half-up, and symmetric about zero so a credit note rounds like an invoice. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** "1 234,56" / "1,234.56" / "-12.5" → minor units. Forgiving on purpose: this
    is what somebody pastes out of a spreadsheet. */
export function parseAmount(input: string | number, decimals = 2): number {
  if (typeof input === 'number') return roundHalfUp(input * 10 ** decimals);
  const raw = String(input).trim().replace(/[^0-9.,\-]/g, '');
  if (!raw) return 0;

  /* Whichever separator appears last is the decimal one. That resolves
     "1.234,56" and "1,234.56" without having to know the user's locale. */
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let normalised = raw;
  if (lastDot >= 0 && lastComma >= 0) {
    normalised = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    /* A lone comma is a decimal point if it leaves two digits behind it,
       otherwise it is a thousands separator. */
    normalised = /,\d{1,2}$/.test(raw) ? raw.replace(',', '.') : raw.replace(/,/g, '');
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? roundHalfUp(n * 10 ** decimals) : 0;
}

/** Quantities in thousandths, so fractional units stay exact. */
export const parseQty = (input: string | number): number => parseAmount(input, 3);

/** Percentages in basis points: 8.25% → 825. */
export const parsePct = (input: string | number): number => parseAmount(input, 2);

/** Minor units → "1,234.56". Grouped, never localised away from the document's
    own currency — a document prints the same wherever it is opened. */
export function formatMinor(minor: number, c: Currency): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const unit = 10 ** c.decimals;
  const whole = Math.floor(abs / unit);
  const frac = abs % unit;
  const grouped = whole.toLocaleString('en-US');
  const body = c.decimals
    ? `${grouped}.${String(frac).padStart(c.decimals, '0')}`
    : grouped;
  return neg ? `-${body}` : body;
}

export const formatMoney = (minor: number, c: Currency): string =>
  `${c.symbol}${formatMinor(minor, c)}`;

/* ── Lines and totals ─────────────────────────────────────────────────────── */

export interface LineItem {
  id: string;
  description: string;
  /** Thousandths. */
  qtyMilli: number;
  unit: string;
  /** Minor units. */
  unitPriceMinor: number;
  /** Basis points. */
  discountBp: number;
  /** Basis points. */
  taxBp: number;
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
}

/**
 * One line, computed in the order an auditor would expect:
 * quantity × price, less discount, then tax on what remains.
 *
 * Tax is charged on the discounted figure, not the gross. Charging on the gross
 * would have the customer paying tax on money they were never asked for, which
 * is both wrong and the kind of wrong that gets noticed.
 */
export function lineTotals(line: LineItem): LineTotals {
  const grossMinor = roundHalfUp((line.qtyMilli * line.unitPriceMinor) / 1000);
  const discountMinor = roundHalfUp((grossMinor * line.discountBp) / 10000);
  const netMinor = grossMinor - discountMinor;
  const taxMinor = roundHalfUp((netMinor * line.taxBp) / 10000);
  return { grossMinor, discountMinor, netMinor, taxMinor };
}

export interface DocumentTotals {
  subtotalMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  shippingMinor: number;
  otherMinor: number;
  grandTotalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  /** Tax broken out by rate, because a tax invoice has to show it that way. */
  taxBreakdown: { bp: number; baseMinor: number; taxMinor: number }[];
}

export function documentTotals(
  lines: LineItem[],
  extras: { shippingMinor: number; otherMinor: number; paidMinor: number },
): DocumentTotals {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  const byRate = new Map<number, { baseMinor: number; taxMinor: number }>();

  for (const line of lines) {
    const t = lineTotals(line);
    subtotalMinor += t.grossMinor;
    discountMinor += t.discountMinor;
    taxMinor += t.taxMinor;

    /* Summed per rate rather than recomputed from the net total, so a document
       mixing 0%, 5% and 20% reports each band as the sum of its own lines. */
    const bucket = byRate.get(line.taxBp) || { baseMinor: 0, taxMinor: 0 };
    bucket.baseMinor += t.netMinor;
    bucket.taxMinor += t.taxMinor;
    byRate.set(line.taxBp, bucket);
  }

  const netMinor = subtotalMinor - discountMinor;
  const grandTotalMinor = netMinor + taxMinor + extras.shippingMinor + extras.otherMinor;

  return {
    subtotalMinor,
    discountMinor,
    netMinor,
    taxMinor,
    shippingMinor: extras.shippingMinor,
    otherMinor: extras.otherMinor,
    grandTotalMinor,
    paidMinor: extras.paidMinor,
    balanceMinor: grandTotalMinor - extras.paidMinor,
    taxBreakdown: Array.from(byRate.entries())
      .filter(([bp]) => bp > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([bp, v]) => ({ bp, ...v })),
  };
}

/** "8.25%" from 825, without a trailing ".00" on whole percentages. */
export const formatPct = (bp: number): string =>
  `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

/** "2.5" from 2500 thousandths. */
export const formatQty = (milli: number): string => {
  const s = (milli / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s || '0';
};
