import { useLayoutEffect, useRef, useState } from 'react';
import type { PortalOrganisation } from '../lib/types';
import { longDate, paragraphs } from '../lib/format';
import { typeface as typefaceFor } from '../lib/typefaces';
import { CONTRACT_STATUS_LABEL, contractTemplate, type ContractDraft } from '../lib/contracts';
import { EdgeBand, Lockup, MarkingTab, PageFoot, SignatureMark, Stub, Watermark, accentOf, inkOf } from './DocKit';

/**
 * The agreement sheet.
 *
 * Dressed in the document kit (see DocKit): the edge band and marking tab on
 * every page, a title page that names the agreement and its parties before a
 * single clause is read, and the tear-off stub with the scan code under the
 * execution block.
 *
 * ── How the pages are decided ─────────────────────────────────────────────
 *
 * The title block, every clause, the execution block and the stub are
 * measured once, off-screen, at the exact width they print at. Clauses are
 * then dealt into pages against the space each page really has. No clause is
 * split across a page boundary — a clause broken mid-sentence across a
 * signature page is how disputes about what was agreed begin — and the stub
 * always ends up on the last page, under the signatures.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

const MM = 3.7795;
const PAD_X = '20mm';
const PAD_TOP_MM = 14;
const PAD_BOTTOM_MM = 21;
/** Height inside the padding: everything a page can hold. */
const CONTENT = (297 - PAD_TOP_MM - PAD_BOTTOM_MM) * MM;
/** The running head on continuation pages, with its gap. */
const RUNNING = 12 * MM;
/** Space between the title block and the first clause. */
const FIRST_GAP = 6 * MM;

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
  organisation: org, draft, reference, documentId, fingerprint, signatureFor, onPages,
}: Props) {
  const ink = inkOf(org);
  const accent = accentOf(org);
  const f = draft.features;
  const tpl = contractTemplate(draft.kind);
  const face = typefaceFor(draft.typeface);

  const blocks = [
    ...draft.sections.map((s, i) => ({ key: s.id, kind: 'section' as const, index: i, section: s })),
    { key: '__exec', kind: 'exec' as const, index: -1, section: null },
  ];

  const measureRef = useRef<HTMLDivElement>(null);
  /* Page membership by stable block key, never by array position — positions
     go stale the instant a clause is removed or reordered. */
  const [pages, setPages] = useState<string[][]>([blocks.map((b) => b.key)]);
  const lastSig = useRef('');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const headH = kids[0]?.offsetHeight ?? 0;
    const heights = blocks.map((_, i) => kids[1 + i]?.offsetHeight ?? 0);
    const stubH = kids[1 + blocks.length]?.offsetHeight ?? 0;

    const cap = (pageIndex: number) => CONTENT - (pageIndex === 0 ? headH + FIRST_GAP : RUNNING);

    /* Greedy fill. A block taller than a whole page gets its own page and may
       overflow — a cramped clause is better than a silently missing one. */
    const out: string[][] = [];
    let page: string[] = [];
    let used = 0;
    heights.forEach((h, i) => {
      if (page.length && used + h > cap(out.length)) {
        out.push(page);
        page = [];
        used = 0;
      }
      page.push(blocks[i].key);
      used += h;
    });
    out.push(page);
    /* The stub sits under the execution block, on the same page, or the
       execution block moves over with it. */
    if (used + stubH > cap(out.length - 1) && out[out.length - 1].length > 1) {
      const moved = out[out.length - 1].pop()!;
      out.push([moved]);
    }

    const sig = out.map((p) => p.join(',')).join('|');
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setPages(out);
      onPages?.(out.length);
    }
  });

  const renderBlock = (b: (typeof blocks)[number]) =>
    b.kind === 'exec'
      ? <Execution key={b.key} draft={draft} org={org} accent={accent} signatureFor={signatureFor} />
      : <Clause key={b.key} n={b.index + 1} section={b.section!} accent={accent} />;
  const blockByKey = new Map(blocks.map((b) => [b.key, b]));

  const title = <TitleBlock org={org} draft={draft} reference={reference} accent={accent} tplTitle={tpl.title} />;
  const stub = (
    <Stub org={org} reference={reference} documentId={documentId} fingerprint={fingerprint} qrOn={f.qr} padX={PAD_X} noun="agreement" issued={longDate(draft.issuedOn)} />
  );

  return (
    <>
      {/* Measuring pass: off-screen, never painted, laid out at print width. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="sheet"
        style={{
          position: 'absolute', left: '-10000px', top: 0, height: 'auto', padding: `0 ${PAD_X}`,
          color: ink, visibility: 'hidden',
          ['--doc-body' as string]: face.body, ['--doc-chrome' as string]: face.chrome,
        } as React.CSSProperties}
      >
        <div>{title}</div>
        {blocks.map((b) => <div key={b.key}>{renderBlock(b)}</div>)}
        <div>{stub}</div>
      </div>

      <div className="sheet-stack">
        {pages.map((keys, pageNo) => {
          const last = pageNo === pages.length - 1;
          return (
            <article
              key={pageNo}
              className="sheet shadow-xl"
              style={{
                color: ink,
                ['--doc-body' as string]: face.body,
                ['--doc-chrome' as string]: face.chrome,
                ['--doc-accent' as string]: accent,
              } as React.CSSProperties}
              aria-label={`${draft.documentTitle || tpl.title} — page ${pageNo + 1} of ${pages.length}`}
            >
              <Watermark org={org} on={f.watermark} />
              <EdgeBand org={org} />
              <MarkingTab org={org} text={draft.classification} right={PAD_X} />

              <div className="relative flex flex-col" style={{ padding: `${PAD_TOP_MM}mm ${PAD_X} ${PAD_BOTTOM_MM}mm`, height: '297mm' }}>
                {pageNo === 0 ? title : (
                  /* A loose continuation page still says which agreement it is. */
                  <div
                    className="flex items-end justify-between gap-4 font-sans"
                    style={{ fontSize: '7pt', paddingBottom: '2.5mm', borderBottom: '0.2mm solid rgb(0 0 0 / 0.16)', marginBottom: `${RUNNING / MM - 6}mm`, height: '6mm' }}
                  >
                    <span className="truncate font-semibold">{draft.documentTitle || tpl.title}</span>
                    <span className="shrink-0 font-mono opacity-60">{reference}</span>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: pageNo === 0 ? `${FIRST_GAP / MM}mm` : 0 }}>
                  {keys.map((key) => {
                    const block = blockByKey.get(key);
                    return block ? renderBlock(block) : null;
                  })}
                </div>

                {last && stub}
              </div>

              <PageFoot org={org} note={draft.footerNote} folio={`Page ${pageNo + 1} of ${pages.length}`} padX={PAD_X} />
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ── Title page ──────────────────────────────────────────────────────────── */

/**
 * The front of the agreement, set the way professionally drafted agreements
 * are: the title, the date line, the parties numbered and defined, the
 * background as lettered recitals, and then the agreed terms.
 */
function TitleBlock({ org, draft, reference, accent, tplTitle }: {
  org: Identity; draft: ContractDraft; reference: string; accent: string; tplTitle: string;
}) {
  const recitals = paragraphs(draft.preamble || '');
  const dated = longDate(draft.issuedOn);
  return (
    <header>
      <div className="flex items-start justify-between gap-6">
        <Lockup org={org} />
        <div className="shrink-0 font-sans" style={{ marginTop: '7mm' }}>
          <span
            className="inline-block font-bold uppercase"
            style={{ fontSize: '6pt', letterSpacing: '0.14em', height: '4.6mm', padding: '0 2.6mm', display: 'inline-flex', alignItems: 'center', lineHeight: 1, borderRadius: '999px', border: `0.3mm solid ${accent}`, color: accent }}
          >
            {CONTRACT_STATUS_LABEL[draft.status]}
          </span>
        </div>
      </div>

      <h1 className="font-sans font-bold" style={{ fontSize: '21pt', lineHeight: 1.12, letterSpacing: '-0.01em', marginTop: '9mm' }}>
        {draft.documentTitle || tplTitle}
      </h1>
      {draft.subtitle && <p style={{ fontSize: '9.5pt', opacity: 0.72, marginTop: '1.5mm' }}>{draft.subtitle}</p>}

      <dl
        className="grid grid-cols-4 font-sans"
        style={{ marginTop: '6mm', fontSize: '7.5pt', borderTop: '0.2mm solid rgb(0 0 0 / 0.16)', borderBottom: '0.2mm solid rgb(0 0 0 / 0.16)' }}
      >
        <Cell label="Reference" mono>{reference}</Cell>
        <Cell label="Agreement no." mono>{draft.agreementNumber || '—'}</Cell>
        <Cell label="Dated">{longDate(draft.issuedOn) || '—'}</Cell>
        <Cell label="Effective" last>{longDate(draft.effectiveDate) || '—'}</Cell>
      </dl>

      <p style={{ fontSize: '9pt', marginTop: '6mm' }}>
        <span className="font-bold uppercase" style={{ letterSpacing: '0.06em' }}>This agreement</span> is dated{' '}
        <span className="font-semibold">{dated || '____________________'}</span>.
      </p>

      {/* The parties, numbered and defined before a single clause is read. */}
      <Heading accent={accent}>Parties</Heading>
      <ol style={{ fontSize: '8.8pt', lineHeight: 1.55 }}>
        {draft.parties.map((p, i) => {
          const who = p.company || p.name || '____________________';
          const address = String(p.addressLines || '').split('\n').map((l) => l.trim()).filter(Boolean).join(', ');
          return (
            <li key={p.id} className="flex" style={{ marginTop: '1.6mm' }}>
              <span className="shrink-0 font-semibold" style={{ width: '9mm' }}>({i + 1})</span>
              <span className="min-w-0">
                <span className="font-bold uppercase" style={{ letterSpacing: '0.02em' }}>{who}</span>
                {p.company && p.name && <>, represented by {p.name}{p.title ? `, ${p.title}` : ''}</>}
                {address && <>, of {address}</>}
                {' '}(the <span className="font-semibold">&ldquo;{p.role}&rdquo;</span>).
              </span>
            </li>
          );
        })}
      </ol>

      {recitals.length > 0 && (
        <>
          <Heading accent={accent}>Background</Heading>
          <ol style={{ fontSize: '8.8pt', lineHeight: 1.55 }}>
            {recitals.map((r, i) => (
              <li key={i} className="flex" style={{ marginTop: '1.6mm' }}>
                <span className="shrink-0 font-semibold" style={{ width: '9mm' }}>({String.fromCharCode(65 + (i % 26))})</span>
                <span className="min-w-0" style={{ whiteSpace: 'pre-line' }}>{r}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      <Heading accent={accent}>Agreed terms</Heading>
    </header>
  );
}

function Heading({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <h2 className="font-sans font-bold uppercase" style={{ fontSize: '7.6pt', letterSpacing: '0.16em', color: accent, marginTop: '5.5mm', paddingBottom: '1.2mm', borderBottom: '0.2mm solid rgb(0 0 0 / 0.12)' }}>
      {children}
    </h2>
  );
}

function Cell({ label, children, mono, last }: { label: string; children: React.ReactNode; mono?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: '2mm 3mm 2mm 0', borderRight: last ? undefined : '0.2mm solid rgb(0 0 0 / 0.1)', paddingLeft: '3mm' }}>
      <dt className="uppercase" style={{ fontSize: '5.8pt', letterSpacing: '0.14em', opacity: 0.5 }}>{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono' : ''}`} style={{ marginTop: '0.5mm' }}>{children}</dd>
    </div>
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
  /* The clause's own colour when it has one, the organisation's otherwise. */
  const headColor = /^#[0-9a-f]{6}$/i.test(section.color || '') ? section.color : accent;
  const body = paragraphs(section.body);
  /* Sub-clauses: each paragraph of a clause is numbered 1.1, 1.2… with a
     hanging indent, so any provision can be cited exactly. A clause of one
     paragraph needs no sub-number. */
  const numbered = body.length > 1;
  const prose = (text: string) => {
    const ps = paragraphs(text);
    return ps.map((p, i) => (
      <p key={i} style={{ marginBottom: i === ps.length - 1 ? 0 : '2mm', whiteSpace: 'pre-line' }}>{p}</p>
    ));
  };
  return (
    <section className="flex" style={{ breakInside: 'avoid', paddingBottom: '3.8mm' }}>
      <div className="shrink-0 font-sans font-bold" style={{ width: '10mm', fontSize: '9.2pt', color: headColor, lineHeight: 1.35 }}>
        {n}.
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-sans font-bold uppercase" style={{ fontSize: '8.4pt', lineHeight: 1.35, letterSpacing: '0.04em' }}>
          {section.heading || 'Untitled clause'}
        </h2>
        <div style={{ fontSize: '8.8pt', lineHeight: 1.6, marginTop: '1.4mm', textAlign: 'justify', hyphens: 'auto' }}>
          {numbered
            ? body.map((p, i) => (
                <div key={i} className="flex" style={{ marginBottom: i === body.length - 1 ? 0 : '1.8mm' }}>
                  <span className="shrink-0 font-sans font-semibold" style={{ width: '10mm', marginLeft: '-10mm', fontSize: '8.2pt' }}>{n}.{i + 1}</span>
                  <p className="min-w-0 flex-1" style={{ whiteSpace: 'pre-line' }}>{p}</p>
                </div>
              ))
            : prose(section.body)}

          {/* Particulars: the value sits on its rule, so one template serves as
              a completed record or as a form filled in by hand at signing. */}
          {!!section.fields?.length && (
            <div style={{ marginTop: section.body.trim() ? '2.5mm' : 0 }}>
              {section.fields.map((row, ri) => (
                <div key={row.id} className="flex items-baseline gap-2" style={{ marginBottom: ri === section.fields!.length - 1 ? 0 : '1.6mm' }}>
                  <span className="shrink-0 font-sans font-semibold" style={{ fontSize: '8pt' }}>{row.label || 'Field'}</span>
                  <span className="min-w-0 flex-1 font-semibold" style={{ borderBottom: '0.25mm solid currentColor', paddingBottom: '0.4mm', paddingLeft: '2mm' }}>
                    {row.value || ' '}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!!section.bodyAfter?.trim() && <div style={{ marginTop: '2mm' }}>{prose(section.bodyAfter!)}</div>}

          {Array.from({ length: section.ruledLines || 0 }).map((_, i) => (
            <div key={i} style={{ borderBottom: '0.2mm solid currentColor', opacity: 0.35, height: '5mm' }} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Execution. A party with a signature on file signs in their own hand; every
 * other party gets an open line, to be signed on paper.
 */
function Execution({ draft, org, accent, signatureFor }: {
  draft: ContractDraft;
  org: Identity;
  accent: string;
  signatureFor?: (name: string) => string | null | undefined;
}) {
  const executionDate = longDate(draft.effectiveDate || draft.issuedOn);
  return (
    <section style={{ breakInside: 'avoid', paddingTop: '4mm' }}>
      <h2 className="font-sans font-bold uppercase" style={{ fontSize: '8pt', letterSpacing: '0.14em', color: accent }}>
        Signed by the parties
      </h2>
      {draft.executionNote && <p style={{ fontSize: '8.4pt', lineHeight: 1.6, marginTop: '1.5mm' }}>{draft.executionNote}</p>}

      <div className="grid grid-cols-2 gap-x-10 gap-y-7" style={{ marginTop: '6mm' }}>
        {draft.parties.map((p) => (
          <div key={p.id}>
            <div className="font-sans uppercase" style={{ fontSize: '6pt', letterSpacing: '0.18em', opacity: 0.55 }}>
              For {p.role}
            </div>
            <SignatureMark image={signatureFor?.(p.name) || null} width="64mm" />
            <div className="font-bold" style={{ fontSize: '8.5pt', marginTop: '1.5mm' }}>{p.name || ' '}</div>
            <div style={{ fontSize: '7.2pt', lineHeight: 1.45, opacity: 0.75 }}>
              {p.title && <div>{p.title}</div>}
              {p.company && <div>{p.company}</div>}
            </div>
            {p.dateLine && (
              <div className="flex items-baseline gap-2 font-sans" style={{ marginTop: '2.5mm', fontSize: '7pt' }}>
                <span className="uppercase" style={{ fontSize: '6pt', letterSpacing: '0.14em', opacity: 0.55 }}>Date</span>
                <span style={{ flex: 1, borderBottom: '0.2mm solid rgb(0 0 0 / 0.4)', minHeight: '3.5mm', paddingBottom: '0.6mm', fontWeight: 600 }}>
                  {executionDate || ' '}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {draft.features.seal && org.seal && (
        <div className="flex justify-end" style={{ marginTop: '3mm' }}>
          <img src={org.seal} alt="" aria-hidden="true" style={{ width: '24mm', height: '24mm', objectFit: 'contain' }} />
        </div>
      )}
    </section>
  );
}
