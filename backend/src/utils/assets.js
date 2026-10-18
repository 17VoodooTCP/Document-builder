const sharp = require('sharp');

/**
 * Brand asset intake.
 *
 * Uploads arrive as data URLs and are stored on the Organisation row rather
 * than in object storage — see the README for why. That decision only holds if
 * something guarantees the assets stay small, which is this module's whole job:
 * an unbounded upload path into a 16MB document limit is a tenant one photo
 * away from being unable to save their own settings.
 *
 * Every asset is therefore re-encoded rather than trusted. A 6MB PNG screenshot
 * of a logo becomes a 40KB WebP, and the caller never has to think about it.
 */

/** What each slot is for, and how large it is allowed to end up. */
const PROFILES = {
  /* Printed up to ~80mm wide in the letterhead. 1600px keeps a wordmark crisp
     at 300dpi rather than softening into the paper. Trimmed: empty margin
     around the artwork is what made uploaded logos print small. */
  logo: { width: 1600, height: 800, fit: 'inside', quality: 92, maxKb: 420, trim: true },
  /* Behind the body at low opacity. Fine detail matters — see the note in the
     renderer about iridescence washing out before shapes do — so this one is
     allowed more room than its display size suggests. */
  watermark: { width: 900, height: 1200, fit: 'inside', quality: 84, maxKb: 420 },
  /* Struck beside the signature at ~122px, but a seal is meant to reward
     magnification, so it is kept at print resolution. */
  seal: { width: 900, height: 900, fit: 'inside', quality: 86, maxKb: 400, trim: true },
  /* A facsimile signature, usually a scan with a white background. */
  signature: { width: 700, height: 300, fit: 'inside', quality: 88, maxKb: 160, trim: true },
  /* An operator-supplied payment QR code.
     Quality is pinned high and the box is generous because this one is read by
     a camera rather than by a person: re-encoding a QR too hard closes up the
     quiet zones between modules and produces a code that looks perfect and
     scans on nothing. */
  qr: { width: 900, height: 900, fit: 'inside', quality: 96, maxKb: 320 },
};

const DATA_URL = /^data:(image\/(png|jpe?g|webp|gif|avif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;

class AssetError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Validate, re-encode and return a data URL ready to store.
 *
 * WebP for everything: it carries alpha, which logos and seals need, at roughly
 * a third the bytes of the PNG most people upload. The one exception is that
 * animated GIFs lose their animation, which is correct — a moving logo on a
 * printed letter is not a thing.
 *
 * @param {string} dataUrl  as received from the browser
 * @param {'logo'|'watermark'|'seal'|'signature'} kind
 */
async function ingest(dataUrl, kind) {
  const profile = PROFILES[kind];
  if (!profile) throw new AssetError(`Unknown asset type: ${kind}`);
  if (typeof dataUrl !== 'string') throw new AssetError('Expected a data URL.');

  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) {
    throw new AssetError('Upload an SVG, PNG, JPEG, WebP, GIF or AVIF image.');
  }

  const raw = Buffer.from(match[3], 'base64');
  const isSvg = match[2] === 'svg+xml';

  /*
   * Refuse anything absurd before decoding it. A decoder handed a deliberately
   * malformed image can allocate far more memory than the file suggests, so the
   * cheap length check comes first and the expensive decode second.
   */
  if (raw.length > 12 * 1024 * 1024) {
    throw new AssetError('That image is over 12MB. Please upload a smaller file.');
  }

  /*
   * SVG is rasterised here and never stored as SVG. An SVG is a document that
   * can carry script and external references; drawn to pixels on the server,
   * none of that can reach a page. It is rendered dense enough that the
   * resize below always shrinks rather than enlarges, so vector artwork comes
   * out at the full print resolution of the slot.
   */
  const source = () => sharp(raw, { failOn: 'error', ...(isSvg ? { density: 600 } : {}) });

  /* Trim the empty margin around the artwork. sharp takes the top-left pixel
     as the background, so this removes transparent margins and paper-white
     margins alike. PNG in between: lossless, and SVG cannot be re-emitted. */
  const encode = async (quality) => {
    let img = source().rotate(); // honour EXIF orientation; phone photos of a stamp arrive sideways
    if (profile.trim) {
      const trimmed = await img.png().toBuffer()
        .then((data) => sharp(data).trim({ threshold: 18 }).png().toBuffer())
        .catch(() => null);
      if (trimmed) img = sharp(trimmed);
    }
    return img
      .resize({ width: profile.width, height: profile.height, fit: profile.fit, withoutEnlargement: !isSvg })
      .webp({ quality, alphaQuality: 100 })
      .toBuffer();
  };

  let out;
  try {
    out = await encode(profile.quality);
  } catch {
    throw new AssetError('That file could not be read as an image.');
  }

  /*
   * If it is still too large, step the quality down rather than refusing. The
   * person uploading is trying to set up their letterhead, not tune a codec,
   * and "too big" is not an error they can act on.
   */
  let quality = profile.quality;
  while (out.length > profile.maxKb * 1024 && quality > 40) {
    quality -= 12;
    out = await encode(quality);
  }

  if (out.length > profile.maxKb * 1024) {
    throw new AssetError(
      `That image is too detailed to store at ${profile.maxKb}KB. Try a flatter version.`,
    );
  }

  const meta = await sharp(out).metadata();
  return {
    dataUrl: `data:image/webp;base64,${out.toString('base64')}`,
    bytes: out.length,
    width: meta.width,
    height: meta.height,
  };
}

module.exports = { ingest, AssetError, PROFILES };
