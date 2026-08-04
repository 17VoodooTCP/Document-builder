import QRCode from 'qrcode';

/**
 * The QR code printed on a document.
 *
 * Error correction is set to 'M' rather than the library default of 'L'. The
 * code is going onto paper that will be folded, photocopied and photographed
 * under an office light before anyone points a phone at it, and a code that
 * scans on a screen and not on the paper is worse than no code — it sends the
 * reader to the support line to ask why the verification does not work.
 *
 * Rendered black on white regardless of the organisation's accent. A tinted
 * code looks considered and fails on low-contrast pairings, and this is the one
 * element on the page whose job is to be read by a machine.
 */
export async function qrDataUrl(text: string, size = 640): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Where a scan lands: the frontend's own origin, not the API's.
 *
 * The code has to point at a page a person can read, and PUBLIC_URL on the
 * backend names the same origin for the codes it would generate. Deriving it
 * from the running location means a preview deployment prints codes that
 * resolve on that preview rather than on production.
 */
export const verifyUrl = (slug: string, reference: string) =>
  `${window.location.origin}/verify/${slug}/${encodeURIComponent(reference)}`;
