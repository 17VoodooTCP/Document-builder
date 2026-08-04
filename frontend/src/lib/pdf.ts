/**
 * Download the sheet as a real PDF file.
 *
 * ── Why this exists rather than window.print() ────────────────────────────
 *
 * The print dialog looked like the better answer: it emits true vector text,
 * at any resolution, for free. What it cannot do is choose the destination.
 * On Windows the default is frequently "Microsoft XPS Document Writer", which
 * writes .xps — a format Windows itself will not preview, so the user is told
 * their brand-new document is "corrupted or of an unknown file format". The
 * quality argument is worth nothing if the file will not open.
 *
 * So the page is rasterised and wrapped in a PDF here. The file is a .pdf with
 * a %PDF header whatever the machine's printer settings happen to be, and it
 * opens in a browser, a phone, or Preview without anything installed.
 *
 * The cost is real and worth stating: the text becomes pixels. It is captured
 * at three times CSS size — about 300dpi at A4 — so body copy stays crisp and
 * the QR scans, but the microtext along the frame is at the edge of what
 * survives, and selecting or searching the text in the PDF is gone.
 * window.print() is still on the page for anyone who wants the vector version
 * and knows to pick "Save as PDF".
 */

const A4_W_MM = 210;
const A4_H_MM = 297;

/** 3× CSS pixels ≈ 300dpi at A4. Below this hairlines and microtext break up. */
const CAPTURE_SCALE = 3;

export interface PdfMeta {
  title?: string;
  subject?: string;
  author?: string;
}

export async function downloadPdf(el: HTMLElement, filename: string, meta: PdfMeta = {}) {
  /*
   * Loaded on demand, not at startup.
   *
   * The rasteriser and the PDF writer are around 600KB together — more than the
   * rest of the application put together, and none of it is any use to somebody
   * signing in or reading the register. Pulled in on the click instead, which
   * costs a moment the first time a document is exported and nothing ever
   * again, since the chunk is then cached.
   */
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  /*
   * The sheet on screen sits inside a wrapper scaled to fit its column. Captured
   * as-is that scale is baked into the image and the result is a soft
   * three-quarter-size document, so the clone is un-scaled before it is drawn.
   * The clone is what gets rendered — the live page is never touched, so
   * nothing flickers under the user while this runs.
   */
  const canvas = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    width: el.offsetWidth,
    height: el.offsetHeight,
    windowWidth: el.offsetWidth,
    windowHeight: el.offsetHeight,
    onclone: (doc) => {
      doc.querySelectorAll<HTMLElement>('.sheet-scale').forEach((n) => {
        n.style.transform = 'none';
        n.style.width = 'auto';
      });
      doc.querySelectorAll<HTMLElement>('.sheet-fit').forEach((n) => {
        n.style.height = 'auto';
      });
      doc.querySelectorAll<HTMLElement>('.sheet').forEach((n) => {
        /* The drop shadow is chrome for the preview. On paper it would print as
           a grey smear down two edges. */
        n.style.boxShadow = 'none';
      });
    },
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdf.setProperties({
    title: meta.title || filename,
    subject: meta.subject || '',
    author: meta.author || '',
    creator: 'Document Builder',
  });

  /* One A4 page, measured in captured pixels. */
  const pagePx = Math.floor(canvas.width * (A4_H_MM / A4_W_MM));

  /*
   * The 2% tolerance is not cosmetic.
   *
   * A4 is 1122.5 CSS pixels, which the browser reports as an offsetHeight of
   * 1123; at 3× that is 3369 captured pixels against a page of 3368. Without
   * the tolerance every single-page letter overflows by that one pixel and
   * exports with a second, blank sheet stapled to it.
   */
  const pages = Math.max(1, Math.ceil(canvas.height / pagePx - 0.02));

  for (let i = 0; i < pages; i++) {
    const sliceHeight = Math.min(pagePx, canvas.height - i * pagePx);

    /* Each page is cut out of the tall capture rather than re-rendered. A
       second html2canvas pass per page would double the work and, because
       layout is recomputed each time, is not guaranteed to line up with the
       first. */
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const ctx = slice.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the page for export.');

    /* Painted white first. A short final page would otherwise carry the
       canvas's transparent background into the PDF as black. */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, -i * pagePx);

    /* JPEG at 0.94, not PNG. A full-bleed 2381×3368 PNG of a page carrying a
       photographic seal and a tinted watermark lands around 9MB and email
       gateways start bouncing it; this is a tenth of that with no artefact
       visible at 100%. */
    const image = slice.toDataURL('image/jpeg', 0.94);
    const heightMm = (sliceHeight / canvas.width) * A4_W_MM;

    if (i > 0) pdf.addPage();
    pdf.addImage(image, 'JPEG', 0, 0, A4_W_MM, heightMm, undefined, 'FAST');
  }

  pdf.save(filename);
  return { pages, bytes: canvas.width * canvas.height };
}

/** `NWL-260804-FHXO.pdf` — the reference is what a reader will quote back. */
export const pdfFilename = (reference: string) =>
  `${(reference || 'document').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
