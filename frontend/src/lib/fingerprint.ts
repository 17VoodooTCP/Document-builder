/**
 * The fingerprint, computed in the browser.
 *
 * This must produce byte-for-byte what backend/src/routes/documents.js produces
 * for the same document, because the value printed on the paper comes from here
 * and the value on the register comes from there. If they drift, every document
 * issued in between shows a mismatch on the portal and nothing is actually
 * wrong — which is the worst kind of wrong, because it trains people to ignore
 * the check.
 *
 * Change either side and you change both. The field list, their order, the
 * separators and the canonicalisation are all part of the value.
 */

const canonical = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export interface FingerprintFields {
  organisationSlug: string;
  reference: string;
  recipientName: string;
  subject: string;
  department: string;
  classification: string;
  signerName: string;
  signerTitle: string;
  issuedOn: string;
}

export function fingerprintPayload(d: FingerprintFields): string {
  return (
    [
      ['org', canonical(d.organisationSlug).toLowerCase()],
      ['reference', canonical(d.reference).toUpperCase()],
      ['recipient', canonical(d.recipientName)],
      ['subject', canonical(d.subject)],
      ['department', canonical(d.department)],
      ['classification', canonical(d.classification)],
      ['signer', canonical(d.signerName)],
      ['title', canonical(d.signerTitle)],
      ['issued', canonical(d.issuedOn)],
    ] as const
  )
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

/**
 * SHA-256, via the platform. `crypto.subtle` is unavailable on insecure origins
 * other than localhost, so a deployment served over plain HTTP would find this
 * missing rather than wrong — hence the explicit check instead of a stack trace
 * about reading a property of undefined.
 */
export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Fingerprinting needs a secure context (HTTPS or localhost).');
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const fingerprint = (d: FingerprintFields) => sha256Hex(fingerprintPayload(d));

/** Grouped into fours. A 64-character hex string is unreadable in one run, and
    this one exists specifically to be compared by eye against a printed page. */
export const groupHex = (hex: string, size = 4) =>
  (hex.match(new RegExp(`.{1,${size}}`, 'g')) || []).join(' ');

/**
 * PREFIX-YYMMDD-XXXX, matching the backend's format.
 *
 * The reference is generated here so it can be shown in the preview before the
 * document is issued — the builder has to print the code the register will hold.
 * The backend still generates one when none is sent, for callers that do not.
 */
export function newReference(prefix: string): string {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');

  const tail = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(2)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 4);

  return `${(prefix || 'DOC').toUpperCase()}-${stamp}-${tail}`;
}
