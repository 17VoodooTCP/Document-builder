/**
 * Code 128 (set B) — the 1D barcode on the authentication stub.
 *
 * Set B covers printable ASCII, which is everything a reference contains.
 * Each symbol is six alternating bar/space widths summing to 11 modules; the
 * stop symbol has seven, summing to 13. A modulo-103 check symbol precedes
 * the stop, so a scanner rejects a misread rather than returning a wrong
 * reference.
 *
 * Drawn to a canvas and handed out as a PNG data URL: bars as an image are
 * pixel-exact in the preview, the print and the PDF export alike.
 */

/* Bar/space widths for symbol values 0–106 (ISO/IEC 15417). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
/** Clear space either side, in modules. The standard asks for at least ten. */
export const QUIET = 10;

/** Symbol values for `text`, including start, check and stop. */
export function code128B(text: string): number[] {
  const values = Array.from(text).map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 B cannot encode "${ch}"`);
    return code - 32;
  });
  const check = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...values, check, STOP];
}

/** Alternating bar/space widths in modules, starting with a bar. */
export function widths(text: string): number[] {
  return code128B(text).flatMap((v) => Array.from(PATTERNS[v], Number));
}

/** Total width in modules, quiet zones included. */
export function moduleCount(text: string) {
  return widths(text).reduce((a, b) => a + b, 0) + QUIET * 2;
}

const cache = new Map<string, string>();

/** The barcode as a PNG data URL, `px` pixels per module. */
export function barcodeDataUrl(text: string, color = '#000000', px = 4, height = 120): string {
  const key = `${text}\u0000${color}\u0000${px}\u0000${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ws = widths(text);
  const canvas = document.createElement('canvas');
  canvas.width = moduleCount(text) * px;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = color;
  let x = QUIET * px;
  ws.forEach((w, i) => {
    if (i % 2 === 0) ctx.fillRect(x, 0, w * px, height);
    x += w * px;
  });
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Self-check of the table: every symbol 11 modules, the stop 13, all distinct. */
export function selfCheck() {
  const bad = PATTERNS.map((p, i) => [i, p] as const)
    .filter(([i, p]) => Array.from(p, Number).reduce((a, b) => a + b, 0) !== (i === STOP ? 13 : 11));
  return { symbols: PATTERNS.length, distinct: new Set(PATTERNS).size, bad };
}
