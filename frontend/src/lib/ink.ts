import { useEffect, useState } from 'react';

/**
 * Signature ink.
 *
 * A signature is stored as the person's own scan — dark strokes, on
 * transparency or on white. On the letter it is redrawn in pen ink: every
 * pixel takes the ink colour, and its opacity comes from how dark the stroke
 * was. White paper in a JPEG scan therefore drops out too, which is what makes
 * a scan sit on the page like a pen line instead of a pasted rectangle.
 *
 * Done on a canvas rather than with CSS masks or filters because the PDF
 * exporter (html2canvas) supports neither reliably — a data URL is the one
 * form that looks the same on screen, in print and in the file.
 */

export const PENS: Record<string, { label: string; color: [number, number, number] }> = {
  blue: { label: 'Blue ink', color: [26, 50, 128] },
  black: { label: 'Black ink', color: [22, 24, 29] },
};

export const DEFAULT_PEN = 'blue';

const cache = new Map<string, string>();

async function ink(src: string, pen: string): Promise<string> {
  const key = `${pen}\u0000${src}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const [r, g, b] = (PENS[pen] || PENS[DEFAULT_PEN]).color;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    /* Darkness → coverage. Paper-white (≥ 215) is fully clear; anything at or
       below ~60 is a full-strength stroke. */
    const cover = Math.max(0, Math.min(1, (215 - lum) / 155));
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
    px[i + 3] = Math.round(px[i + 3] * cover);
  }
  ctx.putImageData(data, 0, 0);

  const out = canvas.toDataURL('image/png');
  cache.set(key, out);
  return out;
}

/** The signature redrawn in the chosen pen, or null while it is being drawn. */
export function useInkedSignature(src: string | null | undefined, pen: string) {
  const [out, setOut] = useState<string | null>(src ? cache.get(`${pen}\u0000${src}`) ?? null : null);

  useEffect(() => {
    if (!src) { setOut(null); return; }
    let live = true;
    ink(src, pen)
      .then((url) => { if (live) setOut(url); })
      .catch(() => { if (live) setOut(src); });
    return () => { live = false; };
  }, [src, pen]);

  return out;
}
