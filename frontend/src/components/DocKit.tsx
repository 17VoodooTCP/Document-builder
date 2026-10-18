import { useEffect, useState } from 'react';
import type { PortalOrganisation } from '../lib/types';
import { qrDataUrl, verifyUrl } from '../lib/qr';
import { useInkedSignature, DEFAULT_PEN } from '../lib/ink';
import { barcodeDataUrl, moduleCount } from '../lib/barcode';

/**
 * The document kit — the furniture every sheet this builder makes shares.
 *
 *   Lockup        the organisation's logo, with its name and tagline set
 *                 beside a square mark, as on printed stationery.
 *   Edge band     a solid band of the organisation's colour along the top edge.
 *   Marking tab   the handling marking as a filled tab hanging from that band.
 *   Fold marks    DIN 5008 fold and punch marks in the left margin of letters.
 *   Page foot     the statutory line — legal name, registered office,
 *                 registration and tax numbers — and the folio.
 *   Stub          the tear-off authentication panel at the foot of the last
 *                 page: scan code, Code 128 barcode, reference, check code.
 *   Check code    twelve characters of the document's fingerprint in groups
 *                 of four. The verification page prints the same twelve.
 *
 * No foil, frame, microprinting or generated seal anywhere.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

export const accentOf = (org: Identity) => org.accentColor || '#0F5F5C';
export const inkOf = (org: Identity) => org.inkColor || '#1B2733';

/** The lockup's own face: a brand mark is set once, not per document. */
const DISPLAY = 'Georgia, Cambria, "Times New Roman", serif';
const LABEL: React.CSSProperties = { fontSize: '5.8pt', letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.55 };

/** "A1B2 · C3D4 · E5F6" — what the paper and the portal both print. */
export function checkCode(fingerprint: string) {
  const hex = (fingerprint || '').replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 12);
  return hex ? (hex.match(/.{1,4}/g) || []).join(' · ') : '';
}

/** The QR for a reference, as a data URL, or null while it draws. */
export function useVerifyQr(slug: string, reference: string, on: boolean) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !reference) { setQr(null); return; }
    let live = true;
    qrDataUrl(verifyUrl(slug, reference)).then((u) => { if (live) setQr(u); }).catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [slug, reference, on]);
  return qr;
}

/* ── Lockup ─────────────────────────────────────────────────────────────── */

const trimCache = new Map<string, { src: string; aspect: number }>();

/**
 * The logo with its empty margin cut away, and its true aspect ratio.
 *
 * New uploads are trimmed on the server; this does the same for logos stored
 * before that, so a mark that arrived with generous padding still prints at
 * its full size rather than as a small thing in the middle of a box.
 */
export function useTrimmedImage(src: string | null | undefined) {
  const [out, setOut] = useState<{ src: string; aspect: number } | null>(src ? trimCache.get(src) ?? null : null);
  useEffect(() => {
    if (!src) { setOut(null); return; }
    const hit = trimCache.get(src);
    if (hit) { setOut(hit); return; }
    let live = true;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth; const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx || !w || !h) return;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      let top = h; let left = w; let right = -1; let bottom = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const ink = px[i + 3] > 16 && (px[i] < 238 || px[i + 1] < 238 || px[i + 2] < 238);
          if (ink) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
        }
      }
      let result = { src, aspect: w / h };
      if (right >= left && bottom >= top) {
        const cw = right - left + 1; const ch = bottom - top + 1;
        if (cw < w * 0.97 || ch < h * 0.97) {
          const crop = document.createElement('canvas');
          crop.width = cw; crop.height = ch;
          crop.getContext('2d')!.drawImage(c, left, top, cw, ch, 0, 0, cw, ch);
          result = { src: crop.toDataURL('image/png'), aspect: cw / ch };
        } else {
          result = { src, aspect: cw / ch };
        }
      }
      trimCache.set(src, result);
      if (live) setOut(result);
    };
    img.onerror = () => { if (live) setOut({ src, aspect: 1 }); };
    img.src = src;
    return () => { live = false; };
  }, [src]);
  return out;
}

/**
 * The letterhead mark.
 *
 * A square-ish mark gets the organisation's name and tagline typeset beside
 * it — the way printed stationery sets a monogram — while a wide wordmark,
 * which already carries the name, stands on its own at full width. The
 * organisation can force either in Identity → Letterhead.
 */
export function Lockup({ org, size = 'full' }: { org: Identity; size?: 'full' | 'compact' }) {
  const logo = useTrimmedImage(org.logo);
  const accent = accentOf(org);
  const full = size === 'full';
  const mode = org.letterhead || 'auto';
  const name = org.name || org.legalName;
  const withName = !org.logo || mode === 'lockup' || (mode === 'auto' && (logo?.aspect ?? 1) < 1.9);

  const markH = full ? 17 : 8;
  const nameSize = (full ? 1 : 0.55) * (name.length <= 18 ? 21 : name.length <= 28 ? 17 : 14);

  if (org.logo && !withName) {
    return logo
      ? <img src={logo.src} alt={name} style={{ height: `${markH}mm`, maxWidth: full ? '86mm' : '44mm', objectFit: 'contain', objectPosition: 'left center', display: 'block' }} />
      : <div style={{ height: `${markH}mm` }} />;
  }

  return (
    <div className="flex items-center" style={{ gap: full ? '4mm' : '2mm' }}>
      {org.logo && (
        logo
          ? <img src={logo.src} alt="" style={{ height: `${markH}mm`, maxWidth: `${markH * 1.9}mm`, objectFit: 'contain', display: 'block' }} />
          : <div style={{ height: `${markH}mm`, width: `${markH}mm` }} />
      )}
      <div className="min-w-0">
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: `${nameSize}pt`, lineHeight: 1.02, letterSpacing: '-0.005em', color: accent }}>
          {name}
        </div>
        {org.tagline && full && (
          <div style={{ fontFamily: DISPLAY, fontSize: '7.4pt', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: '1.4mm', opacity: 0.72 }}>
            {org.tagline}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Page furniture ─────────────────────────────────────────────────────── */

/** Solid band across the top edge of the page. */
export function EdgeBand({ org }: { org: Identity }) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: '3mm', background: accentOf(org) }} />;
}

/** The handling marking, as a tab hanging from the edge band. */
export function MarkingTab({ org, text, right = '22mm' }: { org: Identity; text: string; right?: string }) {
  if (!text) return null;
  return (
    <div
      className="absolute font-sans font-bold uppercase"
      style={{
        top: '3mm', right, background: accentOf(org), color: '#fff',
        fontSize: '6.2pt', letterSpacing: '0.16em', lineHeight: 1,
        padding: '1.6mm 3mm 1.8mm', borderRadius: '0 0 1.2mm 1.2mm',
      }}
    >
      {text}
    </div>
  );
}

/**
 * DIN 5008 fold and punch marks: folds at 105mm and 210mm so the page goes
 * into a window envelope with the address in the window, and the punch mark
 * at the page's half-height. Printed small in the left margin.
 */
export function FoldMarks() {
  const mark = (top: string, width: string) => (
    <div key={top} aria-hidden="true" className="pointer-events-none absolute" style={{ left: 0, top, width, borderTop: '0.2mm solid rgb(0 0 0 / 0.38)' }} />
  );
  return <>{mark('105mm', '5mm')}{mark('148.5mm', '7mm')}{mark('210mm', '5mm')}</>;
}

/** The faint mark behind the text: an uploaded watermark, or the logo greyed. */
export function Watermark({ org, on }: { org: Identity; on: boolean }) {
  const logo = useTrimmedImage(on && !org.watermark ? org.logo : null);
  /* Only a wide wordmark stands in for a missing watermark. A solid square
     mark enlarged behind the text reads as a grey blot, not as a watermark. */
  const mark = on ? (org.watermark || (logo && logo.aspect >= 1.9 ? logo.src : null)) : null;
  if (!mark) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center" style={{ height: '297mm' }} aria-hidden="true">
      <img
        src={mark}
        alt=""
        className="select-none"
        style={{
          /* The logo stand-in is kept small and very faint: a solid mark
             enlarged behind the text otherwise reads as a grey blot. */
          width: org.watermark ? '118mm' : '72mm', maxHeight: org.watermark ? '120mm' : '72mm', objectFit: 'contain',
          opacity: org.watermark ? 0.07 : 0.03,
          filter: org.watermark ? undefined : 'grayscale(1)',
        }}
      />
    </div>
  );
}

/**
 * The foot of every page: legal name and registered office, the contact line,
 * the statutory numbers, and the folio — what business stationery is expected
 * to carry, set in three quiet columns.
 */
export function PageFoot({ org, note, folio, padX = '22mm' }: { org: Identity; note?: string; folio: string; padX?: string }) {
  const office = [org.addressLine1, org.addressLine2, org.country].filter(Boolean).join(', ');
  const contact = [org.phone, org.supportEmail, org.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join('  ·  ');
  const statutory = [
    org.registrationNumber && `Registered no. ${org.registrationNumber}`,
    org.taxNumber && `Tax/VAT no. ${org.taxNumber}`,
  ].filter(Boolean).join('  ·  ');

  return (
    <footer className="absolute font-sans" style={{ left: padX, right: padX, bottom: '7mm', fontSize: '6.3pt', lineHeight: 1.45 }}>
      {note && <div style={{ opacity: 0.6, marginBottom: '1mm' }}>{note}</div>}
      <div className="flex items-start justify-between gap-5" style={{ paddingTop: '1.8mm', borderTop: '0.2mm solid rgb(0 0 0 / 0.12)' }}>
        <div className="min-w-0" style={{ opacity: 0.66 }}>
          <div className="font-semibold">{org.legalName || org.name}</div>
          {office && <div>{office}</div>}
        </div>
        <div className="min-w-0 text-center" style={{ opacity: 0.66 }}>
          {contact && <div>{contact}</div>}
          {statutory && <div>{statutory}</div>}
        </div>
        <div className="shrink-0 text-right font-semibold" style={{ opacity: 0.66 }}>{folio}</div>
      </div>
    </footer>
  );
}

/* ── Authentication stub ────────────────────────────────────────────────── */

/** A Code 128 barcode of `value`, 0.25mm per module — laser-printer safe. */
export function Barcode({ value, height = '8mm', color = '#000' }: { value: string; height?: string; color?: string }) {
  if (!value) return null;
  let src = '';
  let modules = 0;
  try {
    src = barcodeDataUrl(value, color);
    modules = moduleCount(value);
  } catch { return null; }
  return <img src={src} alt={`Barcode ${value}`} style={{ width: `${modules * 0.25}mm`, height, display: 'block', imageRendering: 'pixelated' }} />;
}

/**
 * The stub: the tear-off foot of the last page.
 *
 * Runs edge to edge (it undoes the page's side padding), opens on a
 * perforated rule notched at both edges, and carries what a reader needs to
 * authenticate the paper: the scan code, a Code 128 barcode of the reference,
 * the reference, the check code and the address to check it at.
 *
 * Worded for what the register can do — confirm the reference and what was
 * recorded against it — and nothing more.
 */
export function Stub({
  org, reference, documentId, fingerprint, qrOn, padX = '22mm', noun = 'document', issued, aside,
}: {
  org: Identity; reference: string; documentId: string; fingerprint: string; qrOn: boolean;
  padX?: string; noun?: string; issued?: string; aside?: React.ReactNode;
}) {
  const qr = useVerifyQr(org.slug, reference, qrOn);
  const accent = accentOf(org);
  const url = reference ? verifyUrl(org.slug, reference).replace(/^https?:\/\//, '') : '';
  const code = checkCode(fingerprint);
  const notch: React.CSSProperties = {
    position: 'absolute', top: '-2.2mm', width: '4.4mm', height: '4.4mm', borderRadius: '50%', background: '#E4E7EC',
  };

  return (
    <div className="relative font-sans" style={{ marginLeft: `-${padX}`, marginRight: `-${padX}`, padding: `4.5mm ${padX} 0` }}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0" style={{ borderTop: '0.3mm dashed rgb(0 0 0 / 0.3)' }} />
      <span aria-hidden="true" style={{ ...notch, left: '-2.2mm' }} />
      <span aria-hidden="true" style={{ ...notch, right: '-2.2mm' }} />

      <div className="flex items-start" style={{ gap: '5mm' }}>
        {qrOn && (
          <div className="shrink-0" style={{ width: '22mm' }}>
            {qr
              ? <img src={qr} alt={`Scan code for ${reference}`} style={{ width: '22mm', height: '22mm', display: 'block' }} />
              : <div style={{ width: '22mm', height: '22mm', border: `0.2mm dashed ${accent}` }} />}
            <div className="text-center font-bold uppercase" style={{ fontSize: '5.2pt', letterSpacing: '0.18em', marginTop: '0.8mm', color: accent }}>Scan to verify</div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-bold uppercase" style={{ fontSize: '6.6pt', letterSpacing: '0.18em', color: accent }}>
              Document authentication
            </span>
            <span style={{ ...LABEL, opacity: 0.5 }}>{noun}</span>
          </div>

          <dl className="grid" style={{ gridTemplateColumns: 'auto 1fr', columnGap: '4mm', rowGap: '0.9mm', marginTop: '2mm', fontSize: '7.4pt', lineHeight: 1.25 }}>
            <dt style={LABEL}>Reference</dt>
            <dd className="font-mono font-bold" style={{ letterSpacing: '0.04em' }}>{reference || '—'}</dd>
            {code && <>
              <dt style={LABEL}>Check code</dt>
              <dd className="font-mono font-bold" style={{ fontSize: '8.6pt', letterSpacing: '0.06em', color: accent }}>{code}</dd>
            </>}
            {issued && <>
              <dt style={LABEL}>Issued</dt>
              <dd>{issued}</dd>
            </>}
            <dt style={LABEL}>Verify at</dt>
            <dd className="min-w-0 font-semibold" style={{ overflowWrap: 'anywhere' }}>{url}</dd>
          </dl>

          <div className="flex items-end justify-between gap-4" style={{ marginTop: '2.4mm' }}>
            <div>
              <Barcode value={reference} height="7.5mm" />
              <div className="font-mono" style={{ fontSize: '5.6pt', letterSpacing: '0.3em', marginTop: '0.6mm', paddingLeft: '2.5mm', opacity: 0.7 }}>
                {reference}{documentId ? `  ${documentId}` : ''}
              </div>
            </div>
            <p style={{ fontSize: '6pt', lineHeight: 1.4, opacity: 0.6, maxWidth: '52mm', textAlign: 'right' }}>
              The issuer&rsquo;s register must show this reference and check code. If either differs, do not rely on this {noun}.
            </p>
          </div>
        </div>

        {aside && <div className="shrink-0" style={{ borderLeft: '0.2mm solid rgb(0 0 0 / 0.12)', paddingLeft: '5mm', alignSelf: 'stretch' }}>{aside}</div>}
      </div>
    </div>
  );
}

/**
 * A signature: the person's own hand in pen ink, or — where nobody's
 * signature is on file, as for the other party to a contract — an open line
 * to be signed on paper. Never a typed name in a script face.
 */
export function SignatureMark({ image, pen, width = '62mm' }: { image?: string | null; pen?: string; width?: string }) {
  const inked = useInkedSignature(image, pen || DEFAULT_PEN);
  return (
    <div className="flex items-end" style={{ height: '18mm', width }}>
      {inked
        ? <img src={inked} alt="" style={{ maxHeight: '17mm', maxWidth: width, objectFit: 'contain' }} />
        : image ? null : <div style={{ width: '100%', borderBottom: '0.25mm solid currentColor', opacity: 0.45, marginBottom: '1mm' }} />}
    </div>
  );
}
