import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PortalOrganisation } from '../lib/types';
import { groupHex } from '../lib/fingerprint';
import { longDate, paragraphs } from '../lib/format';
import { qrDataUrl, verifyUrl } from '../lib/qr';
import { Guilloche, HoloStrip, Signature } from './Security';
import { foil as foilFor, typeface as typefaceFor } from '../lib/typefaces';
import { CONTRACT_STATUS_LABEL, contractTemplate, type ContractDraft } from '../lib/contracts';

/**
 * The agreement sheet — the first thing here that genuinely paginates.
 *
 * A letter is one page by nature and an invoice usually is. A contract is not:
 * seventeen clauses and three signature blocks do not fit on A4 and never will,
 * so shrinking type to force it — which is what the other two sheets do — would
 * be the wrong answer applied harder.
 *
 * ── How the pages are decided ─────────────────────────────────────────────
 *
 * Blocks are measured once, off-screen, at the exact width they will print at.
 * Then they are dealt into pages greedily against the space each page actually
 * has: the first page carries the title block and so holds less, every page
 * carries a running head and a foot. Nothing is split across a page boundary,
 * because a clause broken mid-sentence across a signature page is how disputes
 * about what was agreed begin.
 *
 * The stack of sheets is what the PDF exporter captures. Each is exactly 297mm
 * and they sit flush, so the existing slicer cuts precisely on page boundaries
 * with no special handling — the gap between them is screen furniture, removed
 * for capture and for print.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

const MM = 3.7795;
const PAGE_H = 297 * MM;
/** Space a page has for blocks, once padding, running head and foot are taken. */
const BODY_LATER = (297 - 13 - 9 - 13 - 15) * MM;
/** The first page also carries the title, parties and dates. */
const BODY_FIRST = BODY_LATER - 62 * MM;

interface Props {
  organisation: Identity;
  draft: ContractDraft;
  reference: string;
  documentId: string;
  fingerprint: string;
  authorizationId: string;
  generatedAt?: string;
  signatureFor?: (name: string) => string | null | undefined;
  onPages?: (n: number) => void;
}

export default function ContractSheet({
  organisation: org, draft, reference, documentId, fingerprint,
  authorizationId, generatedAt, signatureFor, onPages,
}: Props) {
  const accent = org.accentColor || '#0F5F5C';
  const ink = org.inkColor || '#1B2733';
  const f = draft.features;
  const tpl = contractTemplate(draft.kind);
  const foilSpec = foilFor(draft.foil);
  const face = typefaceFor(draft.typeface);

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!f.qr || !reference) { setQr(null); return; }
    let live = true;
    qrDataUrl(verifyUrl(org.slug, reference)).then((u) => { if (live) setQr(u); }).catch(() => {});
    return () => { live = false; };
  }, [f.qr, org.slug, reference]);

  /* Every block that has to be placed: the clauses, then the execution block. */
  const blocks = [
    ...draft.sections.map((s, i) => ({ key: s.id, kind: 'section' as const, index: i, section: s })),
    { key: '__exec', kind: 'exec' as const, index: -1, section: null },
  ];

  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>([blocks.map((_, i) => i)]);
  const lastSig = useRef('');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const heights = Array.from(el.children).map((c) => (c as HTMLElement).offsetHeight);

    /* Greedy fill. A block taller than a whole page gets its own page and is
       allowed to overflow rather than being dropped — the editor warns, and a
       silently missing clause would be far worse than a cramped one. */
    const out: number[][] = [];
    let page: number[] = [];
    let used = 0;
    let capacity = BODY_FIRST;

    heights.forEach((h, i) => {
      if (page.length && used + h > capacity) {
        out.push(page);
        page = [];
        used = 0;
        capacity = BODY_LATER;
      }
      page.push(i);
      used += h;
    });
    if (page.length) out.push(page);

    const sig = out.map((p) => p.join(',')).join('|');
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setPages(out);
      onPages?.(out.length);
    }
  });

  const address = [org.addressLine1, org.addressLine2, org.country].filter(Boolean);
  const stamp = generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const renderBlock = (b: (typeof blocks)[number]) =>
    b.kind === 'exec'
      ? <Execution key={b.key} draft={draft} org={org} accent={accent} ink={ink} authorizationId={authorizationId} signatureFor={signatureFor} />
      : <Clause key={b.key} n={b.index + 1} section={b.section!} accent={accent} />;

  return (
    <>
      {/* Measuring pass. Off-screen, never painted, but laid out at the exact
          printing width so the heights are the heights that will be used. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute', left: '-10000px', top: 0,
          width: `${(210 - 15 - 21) * MM}px`,
          fontFamily: face.body, color: ink, visibility: 'hidden',
        }}
      >
        {blocks.map(renderBlock)}
      </div>

      <div className="sheet-stack">
        {pages.map((blockIndexes, pageNo) => (
          <article
            key={pageNo}
            className="sheet font-serif shadow-xl"
            style={{
              color: ink,
              ['--doc-body' as string]: face.body,
              ['--doc-chrome' as string]: face.chrome,
            } as React.CSSProperties}
            aria-label={`${draft.documentTitle || tpl.title} — page ${pageNo + 1} of ${pages.length}`}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
              {f.watermark && org.watermark
                ? <img src={org.watermark} alt="" className="select-none" style={{ width: '150mm', opacity: 0.13 }} />
                : f.guilloche ? <Guilloche seed={`${reference}:${pageNo}`} size={560} color={accent} opacity={0.09} rings={6} /> : null}
            </div>

            {f.frame && (
              <>
                <div className="pointer-events-none absolute" style={{ inset: '6mm', border: `0.5mm solid ${accent}`, opacity: 0.9 }} />
                <div className="pointer-events-none absolute" style={{ inset: '7.6mm', border: `0.15mm solid ${accent}`, opacity: 0.45 }} />
              </>
            )}

            {f.microtext && ['top', 'bottom'].map((pos) => (
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

            {f.marginRule && draft.classification && (
              <div
                className="pointer-events-none absolute flex flex-col items-center"
                style={{ left: '12.8mm', width: '3mm', top: '95mm', bottom: '70mm' }}
                aria-hidden="true"
              >
                <div style={{ width: '0.2mm', flex: 1, background: ink, opacity: 0.3 }} />
                <div style={{ position: 'relative', height: '62mm', width: '3mm' }}>
                  <span
                    className="font-sans uppercase"
                    style={{
                      position: 'absolute', left: '50%', top: '50%',
                      transform: 'translate(-50%, -50%) rotate(-90deg)',
                      transformOrigin: 'center', whiteSpace: 'nowrap',
                      fontSize: '5.5pt', letterSpacing: '0.3em', opacity: 0.55,
                    }}
                  >
                    {draft.classification}
                  </span>
                </div>
                <div style={{ width: '0.2mm', flex: 1, background: ink, opacity: 0.3 }} />
              </div>
            )}

            <div className="relative flex flex-col" style={{ padding: '13mm 15mm 9mm 21mm', height: `${PAGE_H}px` }}>
              {/* Running head, on every page. A contract page found loose on a
                  desk has to say which agreement it belongs to. */}
              <div className="flex items-baseline justify-between gap-4" style={{ paddingBottom: '2mm' }}>
                <span className="font-sans text-[6.5pt] uppercase tracking-[0.18em] opacity-60">
                  {org.legalName || org.name}
                </span>
                <span className="font-mono text-[6.5pt] tracking-[0.08em] opacity-60">{reference}</span>
              </div>
              {f.holoStrip
                ? <HoloStrip stops={foilSpec.stops} text={`${(org.legalName || org.name).toUpperCase()} · ${reference}`} textColor={foilSpec.text} edge={foilSpec.edge} />
                : <div style={{ height: '0.5mm', background: ink }} />}

              {/* Title block, first page only. */}
              {pageNo === 0 && (
                <header style={{ marginTop: '7mm' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      {org.logo
                        ? <img src={org.logo} alt={org.name} style={{ maxHeight: '12mm', maxWidth: '62mm' }} />
                        : <div className="font-serif leading-none" style={{ fontSize: '15pt', color: accent }}>{org.name}</div>}
                      <address className="text-[6.5pt] not-italic leading-[1.5] opacity-75" style={{ marginTop: '2mm' }}>
                        {address.map((l) => <div key={l}>{l}</div>)}
                      </address>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className="inline-block font-sans text-[6pt] font-bold uppercase tracking-[0.14em]"
                        style={{ padding: '1mm 2.5mm', border: `0.3mm solid ${accent}`, color: accent }}
                      >
                        {CONTRACT_STATUS_LABEL[draft.status]}
                      </div>
                    </div>
                  </div>

                  <h1
                    className="font-serif font-bold"
                    style={{ fontSize: '19pt', letterSpacing: '0.01em', marginTop: '6mm', lineHeight: 1.15 }}
                  >
                    {draft.documentTitle || tpl.title}
                  </h1>
                  {draft.subtitle && (
                    <p className="text-[9pt] opacity-75" style={{ marginTop: '1.5mm' }}>{draft.subtitle}</p>
                  )}

                  <div style={{ height: '0.4mm', background: accent, marginTop: '4mm' }} />

                  <dl className="grid grid-cols-3 gap-x-6 text-[7.5pt]" style={{ marginTop: '3mm' }}>
                    <Meta label="Reference" mono>{reference}</Meta>
                    <Meta label="Agreement no." mono>{draft.agreementNumber || '—'}</Meta>
                    <Meta label="Classification">{draft.classification || '—'}</Meta>
                    <Meta label="Issued">{longDate(draft.issuedOn) || '—'}</Meta>
                    <Meta label="Effective">{longDate(draft.effectiveDate) || '—'}</Meta>
                    <Meta label="Department">{draft.department || '—'}</Meta>
                  </dl>

                  {/* The parties, named before a single clause is read. */}
                  <div className="grid grid-cols-2 gap-6" style={{ marginTop: '5mm' }}>
                    {draft.parties.slice(0, 2).map((p) => (
                      <div key={p.id}>
                        <div className="font-sans text-[6pt] uppercase tracking-[0.2em] opacity-55">{p.role}</div>
                        <div className="text-[9pt] font-bold" style={{ marginTop: '1mm' }}>{p.company || p.name || '—'}</div>
                        <div className="text-[7.5pt] leading-[1.45] opacity-80">
                          {p.company && p.name && <div>{p.name}</div>}
                          {String(p.addressLines || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </header>
              )}

              {/* Clauses assigned to this page. */}
              <div className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: pageNo === 0 ? '6mm' : '5mm' }}>
                {blockIndexes.map((i) => renderBlock(blocks[i]))}
              </div>

              {/* Foot, on every page. */}
              <footer style={{ marginTop: '3mm', borderTop: `0.15mm solid ${ink}`, paddingTop: '1.5mm' }}>
                {pageNo === pages.length - 1 && (
                  <div className="flex items-start justify-between gap-5" style={{ paddingBottom: '2mm' }}>
                    <dl className="grid flex-1 grid-cols-2 gap-x-5 text-[5.8pt]">
                      <Foot label="Document ID" mono>{documentId}</Foot>
                      <Foot label="Reference" mono>{reference}</Foot>
                      <Foot label="Generated" mono>{stamp}</Foot>
                      <Foot label="Authorisation" mono>{authorizationId}</Foot>
                      <Foot label="Fingerprint" mono>{groupHex(fingerprint.slice(0, 20))}</Foot>
                      <Foot label="Pages">{pages.length}</Foot>
                    </dl>
                    {f.qr && (
                      <div className="shrink-0 text-center" style={{ border: `0.2mm solid ${ink}`, padding: '1.5mm', width: '26mm' }}>
                        <div className="font-sans text-[4.6pt] font-bold uppercase tracking-[0.1em]">Verify</div>
                        {qr
                          ? <img src={qr} alt={`Verification code for ${reference}`} style={{ width: '19mm', height: '19mm', margin: '1mm auto 0' }} />
                          : <div style={{ width: '19mm', height: '19mm', margin: '1mm auto 0', border: `0.2mm dashed ${accent}` }} />}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between font-sans text-[5.5pt] uppercase tracking-[0.14em] opacity-60">
                  <span>{draft.footerNote}</span>
                  <span className="font-mono tracking-[0.08em]">{documentId}</span>
                  <span>Page {pageNo + 1} of {pages.length}</span>
                </div>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ── Blocks ───────────────────────────────────────────────────────────────── */

function Clause({ n, section, accent }: {
  n: number;
  section: {
    heading: string; body: string; bodyAfter?: string; color?: string;
    fields?: { id: string; label: string; value: string }[]; ruledLines?: number;
  };
  accent: string;
}) {
  /* The clause's own colour when it has one, the tenant's accent otherwise. */
  const headColor = /^#[0-9a-f]{6}$/i.test(section.color || '') ? section.color : accent;
  return (
    <section style={{ breakInside: 'avoid', paddingBottom: '4mm' }}>
      <h2 className="font-sans text-[8pt] font-bold uppercase tracking-[0.12em]" style={{ color: headColor }}>
        <span className="font-mono" style={{ marginRight: '2.5mm' }}>{n}.</span>
        {section.heading || 'Untitled clause'}
      </h2>
      <div className="text-[8.5pt] leading-[1.65]" style={{ marginTop: '1.5mm', textAlign: 'justify', hyphens: 'auto' }}>
        {paragraphs(section.body).map((p, i) => (
          <p key={i} style={{ marginBottom: '2mm', whiteSpace: 'pre-line' }}>{p}</p>
        ))}
        {!section.body.trim() && !section.fields?.length && (
          /* An empty clause prints its rule rather than nothing, so a printed
             draft can be completed by hand without the numbering shifting. */
          <div style={{ borderBottom: '0.2mm solid currentColor', opacity: 0.3, height: '4mm' }} />
        )}

        {/*
          Particulars.
          
          The rule runs the full remaining width whether or not a value is set,
          so one template serves both as a completed record and as something
          printed and filled in by hand at signing. The value sits *on* the rule
          rather than above it, which is what makes it read as filled in rather
          than as a caption.
        */}
        {!!section.fields?.length && (
          <div style={{ marginTop: section.body.trim() ? '2.5mm' : 0 }}>
            {section.fields.map((row) => (
              <div key={row.id} className="flex items-baseline gap-2" style={{ marginBottom: '1.6mm' }}>
                <span className="shrink-0 font-sans text-[8pt] font-bold uppercase tracking-[0.04em]">
                  {row.label || 'Field'}:
                </span>
                <span
                  className="min-w-0 flex-1 text-center font-semibold"
                  style={{ borderBottom: '0.25mm solid currentColor', paddingBottom: '0.4mm' }}
                >
                  {row.value || ' '}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Closing prose, under the particulars. */}
        {!!section.bodyAfter?.trim() && (
          <div style={{ marginTop: '2.5mm' }}>
            {paragraphs(section.bodyAfter).map((p, i) => (
              <p key={i} style={{ marginBottom: '2mm', whiteSpace: 'pre-line' }}>{p}</p>
            ))}
          </div>
        )}

        {Array.from({ length: section.ruledLines || 0 }).map((_, i) => (
          <div key={i} style={{ borderBottom: '0.2mm solid currentColor', opacity: 0.35, height: '5mm' }} />
        ))}
      </div>
    </section>
  );
}

function Execution({ draft, org, accent, ink, authorizationId, signatureFor }: {
  draft: ContractDraft;
  org: Identity;
  accent: string;
  ink: string;
  authorizationId: string;
  signatureFor?: (name: string) => string | null | undefined;
}) {
  return (
    <section style={{ breakInside: 'avoid', paddingTop: '3mm' }}>
      {/* The execution block always takes the tenant's accent. It is the one
          heading that is structural rather than authored, so it is not offered
          a colour of its own. */}
      <h2 className="font-sans text-[8pt] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>
        Execution
      </h2>
      <p className="text-[8pt] leading-[1.6]" style={{ marginTop: '1.5mm' }}>{draft.executionNote}</p>

      {/* Two to a row, so four parties fit without the blocks getting narrow
          enough to break a printed name across two lines. */}
      <div className="grid grid-cols-2 gap-x-10 gap-y-7" style={{ marginTop: '6mm' }}>
        {draft.parties.map((p) => (
          <div key={p.id}>
            <div className="font-sans text-[6pt] uppercase tracking-[0.2em] opacity-55">
              For and on behalf of {p.role}
            </div>
            <div style={{ marginTop: '2mm' }}>
              <Signature
                name={p.name}
                image={signatureFor?.(p.name) || null}
                authorizationId={authorizationId}
                ink={ink}
              />
            </div>
            <div className="text-[8pt] font-bold" style={{ marginTop: '1.5mm' }}>{p.name || ' '}</div>
            <div className="text-[7pt] leading-[1.45] opacity-75">
              {p.title && <div>{p.title}</div>}
              {p.department && <div>{p.department}</div>}
              {p.company && <div>{p.company}</div>}
            </div>
            {p.dateLine && (
              <div className="flex items-baseline gap-2" style={{ marginTop: '3mm' }}>
                <span className="font-sans text-[6.5pt] uppercase tracking-[0.14em] opacity-55">Date</span>
                <span style={{ flex: 1, borderBottom: `0.2mm solid ${ink}`, opacity: 0.5, height: '3.5mm' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {draft.features.seal && (
        <div className="flex justify-end" style={{ marginTop: '4mm' }}>
          {org.seal
            ? <img src={org.seal} alt="" aria-hidden="true" style={{ width: '24mm', height: '24mm', objectFit: 'contain' }} />
            : <Guilloche seed={`${authorizationId}:seal`} size={90} color={accent} opacity={0.7} rings={4} strokeWidth={0.4} />}
        </div>
      )}
    </section>
  );
}

function Meta({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ paddingBottom: '1mm' }}>
      <dt className="font-sans text-[5.8pt] uppercase tracking-[0.16em] opacity-50">{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono tracking-[0.04em]' : ''}`}>{children}</dd>
    </div>
  );
}

function Foot({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2" style={{ paddingBottom: '0.6mm' }}>
      <dt className="w-[19mm] shrink-0 font-sans uppercase tracking-[0.1em] opacity-50">{label}</dt>
      <dd className={`min-w-0 flex-1 font-semibold ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}
