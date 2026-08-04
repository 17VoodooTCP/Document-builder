/**
 * Dates on a document are written out in full — "3 August 2026", not
 * "03/08/2026". The slash form is read as 8 March by roughly half the planet,
 * and a correspondence date that means two different things is a defect on a
 * page whose entire purpose is to be unambiguous.
 */
export function longDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : parseDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * A date the user typed is a calendar date, not an instant.
 *
 * `new Date('2026-08-03')` is defined as UTC midnight, and formatting that
 * anywhere west of Greenwich prints the 2nd. The document then carries a date
 * one day before the one that was entered, which on a notice with a deadline is
 * not a cosmetic defect. Bare yyyy-mm-dd is therefore built as a local date;
 * anything else is a real timestamp and is left alone.
 */
function parseDate(value: string): Date {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  return new Date(value);
}

/** Timestamps in the application chrome, where the time of day matters. */
export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** yyyy-mm-dd, for <input type="date">. Local, not UTC — toISOString on the
    evening of the 3rd in a positive-offset timezone yields the 4th. */
export function isoDate(d = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Paragraphs from a textarea. Blank lines separate; single newlines do not. */
export const paragraphs = (body: string): string[] =>
  String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
