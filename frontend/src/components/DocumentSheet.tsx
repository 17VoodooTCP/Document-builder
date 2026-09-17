import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentDraft, PortalOrganisation } from '../lib/types';
import { groupHex } from '../lib/fingerprint';
import { longDate, paragraphs } from '../lib/format';
import { qrDataUrl, verifyUrl } from '../lib/qr';
import { Guilloche, HoloStrip, Signature } from './Security';
import { foil as foilFor, typeface as typefaceFor } from '../lib/typefaces';

type Identity = PortalOrganisation & { watermark?: string | null };
type PageBody = string[];
type PageVariant = 'first' | 'continued';

interface Props {
  organisation: Identity;
  draft: DocumentDraft;
  reference: string;
  documentId: string;
  fingerprint: string;
  authorizationId: string;
  generatedAt?: string;
  signatureImage?: string | null;
  onFit?: (info: { pt: number; overflowing: boolean; pages: number }) => void;
}

const KIND_LABEL: Record<string, string> = {
  LETTER: 'Official correspondence',
  CERTIFICATE: 'Certificate',
  NOTICE: 'Formal notice',
  STATEMENT: 'Statement',
};

interface PageProps extends Props {
  body: PageBody;
  pageNumber: number;
  pageCount: number;
  variant: PageVariant;
  showEndMatter: boolean;
  bodyRef?: (node: HTMLDivElement | null) => void;
  paginationKind?: string;
}

/** A stack of real A4 sheets; long correspondence is never clipped into one. */
export default function DocumentSheet(props: Props) {
  const bodyParagraphs = paragraphs(props.draft.body);
  const [pageBodies, setPageBodies] = useState<PageBody[]>([bodyParagraphs]);
  const firstFullRef = useRef<HTMLDivElement | null>(null);
  const continuedFullRef = useRef<HTMLDivElement | null>(null);
  const firstFinalRef = useRef<HTMLDivElement | null>(null);
  const continuedFinalRef = useRef<HTMLDivElement | null>(null);
  const lastLayout = useRef('');

  const assign = (key: 'firstFull' | 'continuedFull' | 'firstFinal' | 'continuedFinal') =>
    (node: HTMLDivElement | null) => {
      if (key === 'firstFull') firstFullRef.current = node;
      if (key === 'continuedFull') continuedFullRef.current = node;
      if (key === 'firstFinal') firstFinalRef.current = node;
      if (key === 'continuedFinal') continuedFinalRef.current = node;
    };

  useLayoutEffect(() => {
    const recalculate = () => {
      /* Keep a tiny reserve for sub-pixel rounding in print/PDF engines. Without
         it, a line that exactly fits in the browser can be clipped after the
         sheet is rasterised at a different scale. */
      const capacity = (node: HTMLDivElement | null) =>
        Math.max(0, (node?.clientHeight || 0) - 2);
      const capacities = {
        firstFull: capacity(firstFullRef.current),
        continuedFull: capacity(continuedFullRef.current),
        firstFinal: capacity(firstFinalRef.current),
        continuedFinal: capacity(continuedFinalRef.current),
      };
      if (!Object.values(capacities).every(Boolean)) return;

      const next = paginateBody(bodyParagraphs, capacities);
      const key = `${props.draft.body}\u0000${next.map((page) => page.join('\u0001')).join('\u0002')}\u0000${next.length}`;
      if (key !== lastLayout.current) {
        lastLayout.current = key;
        setPageBodies((current) => samePages(current, next) ? current : next);
        props.onFit?.({ pt: 9.5, overflowing: false, pages: next.length });
      }
    };

    recalculate();
    /* The selected typeface is local to the reader's machine. Reflow once the
       browser has finished loading it, otherwise pagination can be calculated
       against fallback metrics and then clip a line in the final page. */
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) recalculate(); });
    return () => { cancelled = true; };
  });

  const pageCount = pageBodies.length;
  const pageProps = (body: PageBody, pageNumber: number): PageProps => ({
    ...props,
    body,
    pageNumber,
    pageCount,
    variant: pageNumber === 1 ? 'first' : 'continued',
    showEndMatter: pageNumber === pageCount,
  });

  return (
    <>
      <div className="sheet-stack">
        {pageBodies.map((body, index) => (
          <DocumentPage key={`${index}-${body.join('\u0000')}`} {...pageProps(body, index + 1)} />
        ))}
      </div>

      <div
        className="sheet-pagination-probes"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-100000px', top: 0, visibility: 'hidden', pointerEvents: 'none' }}
      >
        <DocumentPage {...pageProps(bodyParagraphs, 1)} variant="first" showEndMatter={false} bodyRef={assign('firstFull')} paginationKind="firstFull" />
        <DocumentPage {...pageProps(bodyParagraphs, 2)} variant="continued" showEndMatter={false} bodyRef={assign('continuedFull')} paginationKind="continuedFull" />
        <DocumentPage {...pageProps(bodyParagraphs, 1)} variant="first" showEndMatter bodyRef={assign('firstFinal')} paginationKind="firstFinal" />
        <DocumentPage {...pageProps(bodyParagraphs, 2)} variant="continued" showEndMatter bodyRef={assign('continuedFinal')} paginationKind="continuedFinal" />
      </div>
    </>
  );
}

function DocumentPage({
  organisation: org, draft, reference, documentId, fingerprint, authorizationId,
  generatedAt, signatureImage, body, pageNumber, pageCount, variant, showEndMatter, bodyRef, paginationKind,
}: PageProps) {
  const accent = org.accentColor || '#0F5F5C';
  const ink = org.inkColor || '#1B2733';
  const f = draft.features;
  const foilSpec = foilFor(draft.foil);
  const face = typefaceFor(draft.typeface);
  const [qr, setQr] = useState<string | null>(null);
  const continued = variant === 'continued';

  useEffect(() => {
    if (!f.qr || !reference) { setQr(null); return; }
    let live = true;
    qrDataUrl(verifyUrl(org.slug, reference))
      .then((url) => { if (live) setQr(url); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [f.qr, org.slug, reference]);

  const address = [org.addressLine1, org.addressLine2, org.country].filter(Boolean);
  const stamp = generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    <article
      className="sheet font-serif shadow-xl"
      style={{
        color: ink,
        ['--doc-body' as string]: face.body,
        ['--doc-chrome' as string]: face.chrome,
      } as React.CSSProperties}
      aria-label={`${org.name} — ${draft.documentTitle || KIND_LABEL[draft.kind]}`}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
        {f.watermark && org.watermark ? (
          <img src={org.watermark} alt="" className="select-none" style={{ width: '150mm', opacity: 0.13 }} />
        ) : f.guilloche ? (
          <Guilloche seed={`${reference}:${pageNumber}`} size={560} color={accent} opacity={0.1} rings={6} />
        ) : null}
      </div>

      {f.frame && (
        <>
          <div className="pointer-events-none absolute" style={{ inset: '6mm', border: `0.5mm solid ${accent}`, opacity: 0.9 }} />
          <div className="pointer-events-none absolute" style={{ inset: '7.6mm', border: `0.15mm solid ${accent}`, opacity: 0.45 }} />
        </>
      )}

      {f.microtext && ['4.6mm', 'bottom'].map((pos) => (
        <div
          key={pos}
          className="microtext pointer-events-none absolute"
          style={{
            ...(pos === 'bottom' ? { bottom: '4.6mm' } : { top: '4.6mm' }),
            left: '7mm', right: '7mm', color: accent, opacity: 0.7,
          }}
          aria-hidden="true"
        >
          {`${org.legalName || org.name} · ${reference} · ${documentId} · `.repeat(20)}
        </div>
      ))}

      {!continued && f.marginRule && draft.classification && (
        <MarginRule classification={draft.classification} ink={ink} face={face} />
      )}

      <div
        className="relative flex flex-col"
        style={{
          padding: continued ? '11mm 15mm 16mm 21mm' : '13mm 15mm 16mm 21mm',
          height: '297mm',
        }}
      >
        {continued ? (
          <div className="flex items-center justify-between border-b border-slate-300 pb-2 font-sans text-[7.5pt] uppercase tracking-[0.16em]">
            <span className="font-bold normal-case tracking-normal">{org.legalName || org.name}</span>
            <span className="text-slate-400">{reference} · Continued</span>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                {org.logo
                  ? <img src={org.logo} alt={org.name} style={{ maxHeight: '15mm', maxWidth: '78mm' }} />
                  : <div className="font-serif leading-none" style={{ fontSize: '19pt', color: accent }}>{org.name}</div>}
              </div>
              <h1 className="shrink-0 text-right font-sans font-bold uppercase" style={{ fontSize: '12.5pt', letterSpacing: '0.02em', lineHeight: 1.1 }}>
                {draft.headerLabel || KIND_LABEL[draft.kind] || 'Official correspondence'}
              </h1>
            </header>

            <div className="flex items-start justify-between gap-8" style={{ marginTop: '4mm' }}>
              <address className="text-[7.5pt] not-italic leading-[1.5] opacity-85">
                <div className="font-semibold">{org.legalName || org.name}</div>
                {address.map((line) => <div key={line}>{line}</div>)}
                {org.supportEmail && <div>{org.supportEmail}</div>}
              </address>
              <dl className="shrink-0 text-right text-[7.5pt] leading-[1.6]">
                <MetaRow label="Date of issue">{longDate(draft.issuedOn)}</MetaRow>
                <MetaRow label="Reference" mono>{reference}</MetaRow>
                {draft.department && <MetaRow label="Department">{draft.department}</MetaRow>}
              </dl>
            </div>

            <div style={{ marginTop: '4mm' }}>
              {f.holoStrip ? (
                <HoloStrip stops={foilSpec.stops} text={`${(org.legalName || org.name).toUpperCase()} · ${reference}`} textColor={foilSpec.text} edge={foilSpec.edge} />
              ) : (
                <><div style={{ height: '0.7mm', background: ink }} /><div style={{ height: '0.2mm', background: ink, marginTop: '0.7mm', opacity: 0.7 }} /></>
              )}
            </div>

            <div className="flex items-start justify-between gap-8" style={{ marginTop: '7mm' }}>
              <div className="min-w-0">
                <div className="font-sans text-[6.5pt] uppercase tracking-[0.2em] opacity-55">Addressed to</div>
                <div className="font-serif font-bold" style={{ fontSize: '14pt', marginTop: '1.5mm' }}>{draft.recipientName || '—'}</div>
                <div className="text-[8.5pt] leading-[1.5] opacity-80" style={{ marginTop: '1mm' }}>
                  {draft.recipientAddress.split('\n').map((line, i) => line.trim() && <div key={`${line}-${i}`}>{line.trim()}</div>)}
                </div>
              </div>
              {draft.classification && (
                <div className="shrink-0 text-right" style={{ maxWidth: '62mm' }}>
                  <div style={{ height: '0.2mm', background: ink, opacity: 0.5, marginBottom: '1.5mm' }} />
                  <div className="font-sans text-[7.5pt] font-bold uppercase tracking-[0.14em]">{draft.classification}</div>
                  {draft.addresseeNote && <div className="text-[6.5pt] leading-snug opacity-70" style={{ marginTop: '0.8mm' }}>{draft.addresseeNote}</div>}
                </div>
              )}
            </div>

            {draft.subject && (
              <p className="text-[9.5pt] font-semibold" style={{ marginTop: '7mm' }}>
                Subject: <span className="font-normal">{draft.subject}</span>
              </p>
            )}
          </>
        )}

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-hidden leading-[1.75]"
          style={{ marginTop: continued ? '8mm' : '5mm', textAlign: 'justify', hyphens: 'auto' }}
          data-pagination-body={paginationKind}
        >
          {body.map((p, i) => <p key={`${i}-${p.slice(0, 12)}`} style={{ marginBottom: '3.5mm', whiteSpace: 'pre-line' }}>{p}</p>)}
        </div>

        {showEndMatter && (
          <EndMatter
            org={org}
            draft={draft}
            reference={reference}
            documentId={documentId}
            fingerprint={fingerprint}
            authorizationId={authorizationId}
            generatedAt={stamp}
            signatureImage={signatureImage}
            qr={qr}
            accent={accent}
            ink={ink}
            pageNumber={pageNumber}
            pageCount={pageCount}
          />
        )}
      </div>

      {!showEndMatter && (
        <div className="absolute right-[15mm] bottom-[11mm] font-sans text-[6.5pt] uppercase tracking-[0.16em] text-slate-400">
          Page {pageNumber} of {pageCount}
        </div>
      )}
    </article>
  );
}

function EndMatter({
  org, draft, reference, documentId, fingerprint, authorizationId, generatedAt,
  signatureImage, qr, accent, ink, pageNumber, pageCount,
}: {
  org: Identity; draft: DocumentDraft; reference: string; documentId: string;
  fingerprint: string; authorizationId: string; generatedAt: string;
  signatureImage?: string | null; qr: string | null; accent: string; ink: string;
  pageNumber: number; pageCount: number;
}) {
  const office = [draft.department, org.addressLine2 || org.addressLine1].filter(Boolean).join(', ');
  return (
    <>
      <div className="flex items-end justify-between gap-6" style={{ paddingTop: '7mm' }}>
        <div>
          <div className="text-[9pt]" style={{ marginBottom: '1mm' }}>Yours sincerely,</div>
          <Signature name={draft.signerName} image={signatureImage} authorizationId={authorizationId} ink="#1459D9" />
          <div className="text-[9pt] font-bold" style={{ marginTop: '1.5mm' }}>{draft.signerName}</div>
          <div className="text-[7.5pt] leading-[1.5] opacity-75">
            {draft.signerTitle && <div>{draft.signerTitle}</div>}
            {draft.department && <div>{draft.department} Department</div>}
            <div>{org.legalName || org.name}</div>
          </div>
          <div className="relative" style={{ marginTop: '3mm', border: `0.2mm solid ${ink}`, opacity: 0.95, padding: '3mm 3mm 2.5mm', maxWidth: '62mm' }}>
            <span className="absolute bg-white px-1 font-sans text-[5.5pt] uppercase tracking-[0.16em]" style={{ top: '-1.6mm', left: '2mm', color: accent }}>Authorised for issue by</span>
            <div className="text-[7.5pt] font-bold">{draft.signerName || '—'}</div>
            {draft.department && <div className="text-[7pt] opacity-75">{draft.department} Department</div>}
            <div className="text-[7pt] opacity-75">Authorisation ID: <span className="font-mono font-semibold">{authorizationId}</span></div>
          </div>
        </div>

        {draft.features.seal && (
          <div className="shrink-0 self-end" style={{ paddingBottom: '4mm' }}>
            {org.seal ? (
              <img src={org.seal} alt="" aria-hidden="true" style={{ width: '32mm', height: '32mm', objectFit: 'contain' }} />
            ) : (
              <div className="relative flex items-center justify-center" style={{ width: '32mm', height: '32mm' }}>
                <Guilloche seed={`${reference}:seal`} size={121} color={accent} opacity={0.75} rings={4} strokeWidth={0.4} />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-sans text-[4.5pt] uppercase tracking-[0.14em]" style={{ color: accent }}>{org.name.slice(0, 22)}</span>
                  <span className="font-mono text-[4pt] opacity-70" style={{ marginTop: '0.5mm' }}>{documentId.slice(0, 8)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: '5mm', borderTop: `0.2mm dashed ${ink}`, opacity: 0.35 }} />
      <footer style={{ marginTop: '4mm' }}>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="font-sans text-[7.5pt] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>Secure document</div>
            <p className="text-[6.5pt] leading-[1.55] opacity-80" style={{ marginTop: '1.5mm', maxWidth: '105mm' }}>
              Issued by {org.legalName || org.name} under reference {reference}. This document carries a control mark and a verification identifier derived from that reference, and the details below are recorded on the issuer&rsquo;s register. The register does not hold the text of this letter, so the comparison is one you make.
              {org.supportEmail ? ` If you did not expect this letter, or any detail appears altered, contact ${org.supportEmail} before acting on it.` : ' If you did not expect this letter, or any detail appears altered, contact the issuer before acting on it.'}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 text-[6.5pt]" style={{ marginTop: '2.5mm' }}>
              <FootRow label="Document ID" mono>{documentId}</FootRow>
              <FootRow label="Reference" mono>{reference}</FootRow>
              <FootRow label="Issuing office">{office || org.name}</FootRow>
              <FootRow label="Classification">{draft.classification || '—'}</FootRow>
              <FootRow label="Version">{draft.version || '1.0'}</FootRow>
              <FootRow label="Revision">{draft.revision || 'A'}</FootRow>
              <FootRow label="Generated" mono>{generatedAt}</FootRow>
              <FootRow label="Authorisation" mono>{authorizationId}</FootRow>
              <FootRow label="Fingerprint" mono>{groupHex(fingerprint.slice(0, 20))}</FootRow>
            </dl>
          </div>

          {draft.features.qr && (
            <div className="shrink-0 text-center" style={{ border: `0.2mm solid ${ink}`, padding: '2mm', width: '34mm' }}>
              <div className="font-sans text-[5.5pt] font-bold uppercase tracking-[0.12em]">Verify this document</div>
              {qr ? <img src={qr} alt={`Verification code for ${reference}`} style={{ width: '24mm', height: '24mm', margin: '1.5mm auto' }} /> : <div style={{ width: '24mm', height: '24mm', margin: '1.5mm auto', border: `0.2mm dashed ${accent}` }} />}
              <div style={{ height: '0.15mm', background: ink, opacity: 0.4 }} />
              <div className="font-sans text-[4.5pt] uppercase tracking-[0.1em] opacity-70" style={{ marginTop: '1mm' }}>Scan to verify</div>
              <div className="font-mono text-[5pt] font-semibold" style={{ marginTop: '0.5mm' }}>{documentId}</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between font-sans text-[5.5pt] uppercase tracking-[0.14em] opacity-60" style={{ marginTop: '3.5mm' }}>
          <span>{draft.footerNote}</span><span className="font-mono tracking-[0.08em]">{documentId}</span><span>Page {pageNumber} of {pageCount}</span>
        </div>
      </footer>
    </>
  );
}

function MarginRule({ classification, ink, face }: { classification: string; ink: string; face: ReturnType<typeof typefaceFor> }) {
  const W = 30; const H = 1320; const FS = 19.4; const label = classification.toUpperCase();
  const half = Math.min(H * 0.42, (label.length * FS * 0.85) / 2 + 40);
  return (
    <div className="pointer-events-none absolute" style={{ left: '12.8mm', width: '3mm', top: '95mm', bottom: '70mm' }} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="presentation">
        <line x1={W / 2} y1={0} x2={W / 2} y2={H / 2 - half} stroke={ink} strokeWidth={2} opacity={0.3} />
        <line x1={W / 2} y1={H / 2 + half} x2={W / 2} y2={H} stroke={ink} strokeWidth={2} opacity={0.3} />
        <text x={W / 2} y={H / 2} fill={ink} opacity={0.55} fontSize={FS} letterSpacing={FS * 0.3} textAnchor="middle" dominantBaseline="central" fontFamily={face.chrome} transform={`rotate(-90 ${W / 2} ${H / 2})`}>{label}</text>
      </svg>
    </div>
  );
}

function MetaRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return <div className="flex items-baseline justify-end gap-3"><dt className="font-sans text-[6pt] uppercase tracking-[0.16em] opacity-50">{label}</dt><dd className={`font-semibold ${mono ? 'font-mono tracking-[0.06em]' : ''}`}>{children}</dd></div>;
}

function FootRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return <div className="flex gap-2" style={{ paddingBottom: '0.8mm' }}><dt className="w-[19mm] shrink-0 font-sans uppercase tracking-[0.1em] opacity-50">{label}</dt><dd className={`min-w-0 flex-1 font-semibold ${mono ? 'font-mono' : ''}`}>{children}</dd></div>;
}

function samePages(a: PageBody[], b: PageBody[]) {
  return a.length === b.length && a.every((page, i) => page.length === b[i].length && page.every((text, j) => text === b[i][j]));
}

function paginateBody(body: string[], capacities: Record<string, number>): PageBody[] {
  if (!body.length || fits(body, 'firstFinal', capacities)) return [body];
  const pages: PageBody[] = [];
  let remaining = body;
  let first = true;
  while (remaining.length) {
    const finalKind = first ? 'firstFinal' : 'continuedFinal';
    if (fits(remaining, finalKind, capacities)) {
      pages.push(remaining);
      break;
    }
    const fullKind = first ? 'firstFull' : 'continuedFull';
    const split = takeFit(remaining, capacities[fullKind], fullKind);
    pages.push(split.page);
    remaining = split.rest;
    first = false;
  }
  return pages.length ? pages : [[]];
}

function fits(body: string[], kind: string, capacities: Record<string, number>) {
  return measureBody(body, kind) <= capacities[kind] + 1;
}

function takeFit(body: string[], capacity: number, kind: string): { page: string[]; rest: string[] } {
  let low = 1; let high = body.length; let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (measureBody(body.slice(0, middle), kind) <= capacity + 1) { best = middle; low = middle + 1; } else high = middle - 1;
  }
  if (best > 0) return { page: body.slice(0, best), rest: body.slice(best) };

  const words = body[0].split(/\s+/).filter(Boolean);
  low = 1; high = words.length; best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (measureBody([words.slice(0, middle).join(' ')], kind) <= capacity + 1) { best = middle; low = middle + 1; } else high = middle - 1;
  }
  const count = Math.max(1, best);
  return { page: [words.slice(0, count).join(' ')], rest: [words.slice(count).join(' '), ...body.slice(1)].filter(Boolean) };
}

function measureBody(body: string[], kind: string) {
  const source = document.querySelector<HTMLDivElement>(`.sheet-pagination-probes [data-pagination-body="${kind}"]`);
  if (!source) return Number.POSITIVE_INFINITY;
  const clone = source.cloneNode(false) as HTMLDivElement;
  const computed = getComputedStyle(source);
  clone.style.position = 'absolute'; clone.style.left = '-100000px'; clone.style.top = '0';
  clone.style.visibility = 'hidden'; clone.style.display = 'block'; clone.style.width = `${source.clientWidth}px`;
  clone.style.height = 'auto'; clone.style.maxHeight = 'none'; clone.style.overflow = 'visible'; clone.style.flex = 'none';
  clone.style.fontFamily = computed.fontFamily; clone.style.fontSize = computed.fontSize; clone.style.lineHeight = computed.lineHeight;
  clone.style.letterSpacing = computed.letterSpacing; clone.style.wordSpacing = computed.wordSpacing; clone.style.textAlign = computed.textAlign; clone.style.hyphens = computed.hyphens;
  body.forEach((text) => { const p = document.createElement('p'); p.style.marginBottom = '3.5mm'; p.style.whiteSpace = 'pre-line'; p.textContent = text; clone.appendChild(p); });
  document.body.appendChild(clone);
  const height = clone.scrollHeight;
  clone.remove();
  return height;
}
