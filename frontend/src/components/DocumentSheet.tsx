import { useLayoutEffect, useRef, useState } from 'react';
import type { DocumentDraft, PortalOrganisation } from '../lib/types';
import { longDate, paragraphs } from '../lib/format';
import { typeface as typefaceFor } from '../lib/typefaces';
import { EdgeBand, FoldMarks, Lockup, MarkingTab, PageFoot as KitFoot, SignatureMark, Stub, Watermark } from './DocKit';

/**
 * The letter.
 *
 * A modern block-format business letter on A4: the organisation's letterhead,
 * everything set flush left, a real signature in pen ink, and one quiet strip
 * at the foot that tells the reader how to check the letter is genuine.
 *
 * Authenticity comes from a few marks done well rather than many done loudly:
 * the letterhead, the handwritten signature, the seal beside it, a faint
 * watermark, and a code that resolves to the issuer's own register.
 *
 * Two modes share every part of the page:
 *   - final  — paginated A4 sheets, the thing that is printed and exported;
 *   - write  — one continuous sheet whose recipient, subject, body and closing
 *              are typed into directly.
 */

type Identity = PortalOrganisation & { watermark?: string | null };
type PageBody = string[];
type Field = 'recipientName' | 'recipientAddress' | 'subject' | 'body' | 'closing';

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
  /** Present → the write surface, typed into directly. Absent → final pages. */
  onEdit?: (field: Field, value: string) => void;
}

/* ── Measures ─────────────────────────────────────────────────────────────── */

const BODY_PT = 10.5;
const LEADING = 1.55;
const PARA_GAP = '3.4mm';
/* Side margins of 22mm: the convention for business stationery, and wide
   enough that a hole punch or a binder never reaches the text. */
const PAD_X = '22mm';
const FOOT_ZONE = '22mm';

const MUTED = 0.62;

export default function DocumentSheet(props: Props) {
  return props.onEdit ? <WriteSheet {...props} onEdit={props.onEdit} /> : <FinalSheets {...props} />;
}

/* ── Final: paginated A4 ──────────────────────────────────────────────────── */

type Kind = 'firstFull' | 'continuedFull' | 'firstFinal' | 'continuedFinal';

interface PageProps extends Props {
  body: PageBody;
  pageNumber: number;
  pageCount: number;
  continued: boolean;
  last: boolean;
  bodyRef?: (node: HTMLDivElement | null) => void;
  paginationKind?: Kind;
}

function FinalSheets(props: Props) {
  const bodyParagraphs = paragraphs(props.draft.body);
  const [pageBodies, setPageBodies] = useState<PageBody[]>([bodyParagraphs]);
  const refs = useRef<Record<Kind, HTMLDivElement | null>>({
    firstFull: null, continuedFull: null, firstFinal: null, continuedFinal: null,
  });
  const lastLayout = useRef('');
  const assign = (key: Kind) => (node: HTMLDivElement | null) => { refs.current[key] = node; };

  /* Measure, then paginate: four hidden probe pages report how much body each
     kind of page can hold, and the body is split to fit. Runs after every
     render — the guard key stops it feeding itself. */
  useLayoutEffect(() => {
    const recalculate = () => {
      /* A two-pixel reserve for rounding when the page is rasterised at a
         different scale for the PDF. */
      const cap = (n: HTMLDivElement | null) => Math.max(0, (n?.clientHeight || 0) - 2);
      const capacities = {
        firstFull: cap(refs.current.firstFull),
        continuedFull: cap(refs.current.continuedFull),
        firstFinal: cap(refs.current.firstFinal),
        continuedFinal: cap(refs.current.continuedFinal),
      };
      if (!Object.values(capacities).every(Boolean)) return;

      const next = paginateBody(bodyParagraphs, capacities);
      const key = `${props.draft.body}\u0000${next.map((p) => p.join('\u0001')).join('\u0002')}`;
      if (key !== lastLayout.current) {
        lastLayout.current = key;
        setPageBodies((cur) => (samePages(cur, next) ? cur : next));
        props.onFit?.({ pt: BODY_PT, overflowing: false, pages: next.length });
      }
    };
    recalculate();
    /* Re-measure once fonts are in, or pagination is computed against
       fallback metrics and the final page can clip a line. */
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) recalculate(); });
    return () => { cancelled = true; };
  });

  const pageCount = pageBodies.length;
  const page = (body: PageBody, n: number, extra: Partial<PageProps> = {}): PageProps => ({
    ...props, body, pageNumber: n, pageCount, continued: n > 1, last: n === pageCount, ...extra,
  });

  return (
    <>
      <div className="sheet-stack">
        {pageBodies.map((body, i) => (
          <Page key={`${i}-${body.join('\u0000')}`} {...page(body, i + 1)} />
        ))}
      </div>
      <div
        className="sheet-pagination-probes"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-100000px', top: 0, visibility: 'hidden', pointerEvents: 'none' }}
      >
        <Page {...page(bodyParagraphs, 1, { continued: false, last: false, bodyRef: assign('firstFull'), paginationKind: 'firstFull' })} />
        <Page {...page(bodyParagraphs, 2, { continued: true, last: false, bodyRef: assign('continuedFull'), paginationKind: 'continuedFull' })} />
        <Page {...page(bodyParagraphs, 1, { continued: false, last: true, bodyRef: assign('firstFinal'), paginationKind: 'firstFinal' })} />
        <Page {...page(bodyParagraphs, 2, { continued: true, last: true, bodyRef: assign('continuedFinal'), paginationKind: 'continuedFinal' })} />
      </div>
    </>
  );
}

function Page(p: PageProps) {
  const { organisation: org, draft, body, continued, last, bodyRef, paginationKind } = p;
  return (
    <Paper org={org} draft={draft} reference={p.reference}>
      <div className="relative flex flex-col" style={{ height: '297mm', padding: `${continued ? '12mm' : '15mm'} ${PAD_X} ${FOOT_ZONE}` }}>
        {continued ? <ContinuationHead org={org} draft={draft} reference={p.reference} /> : <Opening {...p} />}

        {/* Probes stretch the body to measure how much a page can hold. A real
            final page lets it take its natural height, so the sign-off follows
            the last paragraph and only the verification strip sits at the foot. */}
        <div
          ref={bodyRef}
          data-pagination-body={paginationKind}
          className={`min-h-0 overflow-hidden ${paginationKind || !last ? 'flex-1' : ''}`}
          style={{ marginTop: continued ? '9mm' : '6mm', ...BODY_STYLE }}
        >
          {body.map((text, i) => (
            <p key={`${i}-${text.slice(0, 12)}`} style={{ marginBottom: PARA_GAP, whiteSpace: 'pre-line' }}>{text}</p>
          ))}
        </div>

        {last && (
          <>
            <SignOff {...p} />
            {!paginationKind && <div className="flex-1" />}
            <LetterStub {...p} />
          </>
        )}
      </div>
      <KitFoot org={org} note={draft.footerNote} folio={`Page ${p.pageNumber} of ${p.pageCount}`} padX={PAD_X} />
    </Paper>
  );
}

/* ── Write: one continuous sheet, typed into ──────────────────────────────── */

function WriteSheet(p: Props & { onEdit: (field: Field, value: string) => void }) {
  const { organisation: org, draft, onEdit } = p;
  return (
    <div className="sheet-stack">
      <Paper org={org} draft={draft} reference={p.reference} write>
        <div className="relative flex flex-col" style={{ minHeight: '297mm', padding: `15mm ${PAD_X} ${FOOT_ZONE}` }}>
          <Opening {...p} pageNumber={1} pageCount={1} body={[]} continued={false} last onEdit={onEdit} />

          <AutoText
            value={draft.body}
            onChange={(v) => onEdit('body', v)}
            placeholder={'Dear …\n\nStart writing. Leave a blank line between paragraphs.'}
            style={{ marginTop: '6mm', minHeight: '70mm', ...BODY_STYLE }}
            label="Letter body"
          />

          <SignOff {...p} pageNumber={1} pageCount={1} body={[]} continued={false} last onEdit={onEdit} />
          <LetterStub {...p} pageNumber={1} pageCount={1} body={[]} continued={false} last />
        </div>
        <KitFoot org={org} note={draft.footerNote} folio="Draft" padX={PAD_X} />
      </Paper>
    </div>
  );
}

/* ── Shared parts of the page ─────────────────────────────────────────────── */

const BODY_STYLE: React.CSSProperties = { fontSize: `${BODY_PT}pt`, lineHeight: LEADING };

function Paper({ org, draft, reference, write, children }: {
  org: Identity; draft: DocumentDraft; reference: string; write?: boolean; children: React.ReactNode;
}) {
  const face = typefaceFor(draft.typeface);
  return (
    <article
      className={`sheet shadow-xl ${write ? 'sheet--write' : ''}`}
      style={{
        color: org.inkColor || '#1B2733',
        ['--doc-body' as string]: face.body,
        ['--doc-chrome' as string]: face.chrome,
        ['--doc-accent' as string]: org.accentColor || '#0F5F5C',
      } as React.CSSProperties}
      aria-label={`${org.name} — ${draft.documentTitle || 'Letter'} ${reference}`}
    >
      <Watermark org={org} on={draft.features.watermark} />
      <FoldMarks />
      <EdgeBand org={org} />
      <MarkingTab org={org} text={draft.classification} right={PAD_X} />
      {children}
    </article>
  );
}

/**
 * Letterhead, the window-envelope address field, the reference block and the
 * subject — laid out to DIN 5008 (form B) measures, so the letter folds into
 * a standard window envelope with the recipient's address in the window:
 *
 *    15–40mm   letterhead (the lockup, and the office on the right)
 *    45–50mm   the sender's return line, read through the window
 *    50–90mm   the recipient's address
 */
function Opening(p: PageProps & { onEdit?: (field: Field, value: string) => void }) {
  const { organisation: org, draft, reference, onEdit } = p;
  const web = org.website?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  /* Four lines at most, so the block always clears the rule under it. */
  const contact = [
    [org.addressLine1, org.addressLine2].filter(Boolean).join(', '),
    org.country,
    org.phone,
    [org.supportEmail, web].filter(Boolean).join('  ·  '),
  ].filter(Boolean) as string[];
  const returnLine = [org.legalName || org.name, org.addressLine1, org.addressLine2].filter(Boolean).join('  ·  ');

  return (
    <>
      <header className="flex items-start justify-between gap-8" style={{ height: '25mm' }}>
        <div className="min-w-0 pt-[1mm]"><Lockup org={org} /></div>
        <address className="shrink-0 text-right font-sans not-italic" style={{ fontSize: '7.2pt', lineHeight: 1.5, marginTop: '3mm' }}>
          <div style={{ opacity: MUTED + 0.12 }}>{contact.map((line) => <div key={line}>{line}</div>)}</div>
        </address>
      </header>
      <div style={{ marginTop: '2mm', height: '0.2mm', background: 'currentColor', opacity: 0.16 }} />

      <div className="flex items-start justify-between gap-10" style={{ marginTop: '3mm' }}>
        <div className="min-w-0" style={{ width: '85mm', minHeight: '45mm' }}>
          {/* The return line: small, underlined, and the first thing seen
              through the envelope window above the address. */}
          <div className="font-sans" style={{ height: '5mm', fontSize: '6pt', opacity: 0.6 }}>
            {/* The underline is its own hairline element: the PDF rasteriser
                draws a text border through the letters rather than under them. */}
            <div style={{ display: 'inline-block', lineHeight: 1.2 }}>
              <div>{returnLine}</div>
              <div style={{ height: '0.15mm', background: 'currentColor', marginTop: '0.4mm' }} />
            </div>
          </div>
          <div style={BODY_STYLE}>
          {onEdit ? (
            <>
              <AutoText single value={draft.recipientName} onChange={(v) => onEdit('recipientName', v)} placeholder="Recipient name" className="font-semibold" label="Recipient name" />
              <AutoText value={draft.recipientAddress} onChange={(v) => onEdit('recipientAddress', v)} placeholder={'Address\nCity, postcode'} label="Recipient address" />
            </>
          ) : (
            <>
              <div className="font-semibold">{draft.recipientName}</div>
              {draft.recipientAddress.split('\n').map((l, i) => l.trim() && <div key={`${i}-${l}`}>{l.trim()}</div>)}
            </>
          )}
          </div>
        </div>

        <dl className="shrink-0 font-sans" style={{ fontSize: '8pt', lineHeight: 1.45, width: '52mm', marginTop: '5mm' }}>
          <Meta label="Date">{longDate(draft.issuedOn)}</Meta>
          <Meta label="Our reference" mono>{reference || '—'}</Meta>
          {draft.department && <Meta label="Department">{draft.department}</Meta>}
        </dl>
      </div>

      {draft.kind !== 'LETTER' && draft.documentTitle && (
        <h1 className="font-sans font-bold" style={{ fontSize: '15pt', lineHeight: 1.2, letterSpacing: '-0.01em', marginTop: '5mm' }}>
          {draft.documentTitle}
        </h1>
      )}

      <div style={{ marginTop: draft.kind !== 'LETTER' && draft.documentTitle ? '3mm' : '5mm', ...BODY_STYLE }} className="font-bold">
        {onEdit
          ? <AutoText single value={draft.subject} onChange={(v) => onEdit('subject', v)} placeholder="Subject" className="font-bold" label="Subject" />
          : draft.subject}
      </div>
    </>
  );
}

function ContinuationHead({ org, draft, reference }: { org: Identity; draft: DocumentDraft; reference: string }) {
  return (
    <div className="flex items-end justify-between gap-6 font-sans" style={{ fontSize: '7.5pt', paddingBottom: '2.5mm', borderBottom: '0.2mm solid rgb(0 0 0 / 0.18)' }}>
      <Lockup org={org} size="compact" />
      <span style={{ opacity: MUTED }}>
        {[draft.recipientName, longDate(draft.issuedOn), reference].filter(Boolean).join('  ·  ')}
      </span>
    </div>
  );
}

/** Closing, the handwritten signature, the seal, and who signed. */
function SignOff(p: PageProps & { onEdit?: (field: Field, value: string) => void }) {
  const { organisation: org, draft, signatureImage, onEdit } = p;
  const seal = draft.features.seal && org.seal;
  const closing = draft.closing ?? 'Yours sincerely,';

  return (
    <div className="flex items-end justify-between gap-6" style={{ marginTop: '4mm', ...BODY_STYLE }}>
      <div className="min-w-0">
        {onEdit
          ? <AutoText single value={closing} onChange={(v) => onEdit('closing', v)} placeholder="Yours sincerely," label="Closing" />
          : <div>{closing}</div>}

        {/* The signature is the person's own hand, or nothing. With nobody
            chosen the space stays open — never a typed name in a script face. */}
        <div style={{ marginTop: '1mm' }}>
          {signatureImage
            ? <SignatureMark image={signatureImage} pen={draft.pen} />
            : <div className="flex items-end" style={{ height: '18mm' }}>
                {onEdit && <span className="font-sans" style={{ fontSize: '8pt', opacity: 0.45 }}>Choose who is signing under “Signed by”</span>}
              </div>}
        </div>

        <div className="font-bold" style={{ marginTop: '1mm' }}>{draft.signerName || ' '}</div>
        <div className="font-sans" style={{ fontSize: '8pt', lineHeight: 1.45, opacity: MUTED + 0.1 }}>
          {draft.signerTitle && <div>{draft.signerTitle}</div>}
          {draft.department && <div>{draft.department}</div>}
          <div>{org.legalName || org.name}</div>
        </div>
      </div>

      {seal && (
        <img src={org.seal!} alt="" aria-hidden="true" className="shrink-0" style={{ width: '26mm', height: '26mm', objectFit: 'contain', marginBottom: '3mm' }} />
      )}
    </div>
  );
}

/** The tear-off stub, on the letter's last page. */
function LetterStub(p: PageProps) {
  return (
    <div style={{ marginTop: '7mm' }}>
      <Stub
        org={p.organisation}
        reference={p.reference}
        documentId={p.documentId}
        fingerprint={p.fingerprint}
        qrOn={p.draft.features.qr}
        padX={PAD_X}
        noun={p.draft.kind === 'LETTER' ? 'letter' : 'document'}
        issued={longDate(p.draft.issuedOn)}
      />
    </div>
  );
}

function Meta({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" style={{ paddingBottom: '0.8mm' }}>
      <dt className="uppercase" style={{ fontSize: '6pt', letterSpacing: '0.14em', opacity: MUTED - 0.1 }}>{label}</dt>
      <dd className={`text-right font-semibold ${mono ? 'font-mono' : ''}`} style={mono ? { letterSpacing: '0.03em' } : undefined}>{children}</dd>
    </div>
  );
}

/**
 * A field that is part of the paper: the letter's own type, no box, growing
 * with what is written. A faint outline on hover and focus is the only sign
 * that it can be typed into.
 */
function AutoText({ value, onChange, placeholder, single, className, style, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; single?: boolean;
  className?: string; style?: React.CSSProperties; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(single ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={single ? (e) => { if (e.key === 'Enter') e.preventDefault(); } : undefined}
      spellCheck
      className={`sheet-field ${className || ''}`}
      style={style}
    />
  );
}

/* ── Pagination ───────────────────────────────────────────────────────────── */

function samePages(a: PageBody[], b: PageBody[]) {
  return a.length === b.length && a.every((page, i) => page.length === b[i].length && page.every((t, j) => t === b[i][j]));
}

function paginateBody(body: string[], caps: Record<Kind, number>): PageBody[] {
  if (!body.length || fits(body, 'firstFinal', caps)) return [body];
  const pages: PageBody[] = [];
  let remaining = body;
  let first = true;
  while (remaining.length) {
    const finalKind: Kind = first ? 'firstFinal' : 'continuedFinal';
    if (fits(remaining, finalKind, caps)) { pages.push(remaining); break; }
    const fullKind: Kind = first ? 'firstFull' : 'continuedFull';
    const split = takeFit(remaining, caps[fullKind], fullKind);
    pages.push(split.page);
    remaining = split.rest;
    first = false;
  }
  return pages.length ? pages : [[]];
}

function fits(body: string[], kind: Kind, caps: Record<Kind, number>) {
  return measureBody(body, kind) <= caps[kind] + 1;
}

/**
 * Fill the page: as many whole paragraphs as fit, then as much of the next one
 * as fits — the way a typeset letter breaks — provided at least two lines stay
 * on each side of the break. A single stranded line at the foot of a page
 * (an orphan) or the top of the next (a widow) is the mark of careless
 * setting, so a paragraph that cannot be split that way moves over whole.
 */
function takeFit(body: string[], capacity: number, kind: Kind): { page: string[]; rest: string[] } {
  /* The space after the last paragraph on a page is not needed on that page. */
  const trailing = paraGap(kind);
  const within = (paras: string[]) => measureBody(paras, kind) - trailing <= capacity + 1;

  let low = 1; let high = body.length; let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (within(body.slice(0, mid))) { best = mid; low = mid + 1; } else high = mid - 1;
  }
  const head = body.slice(0, best);
  if (best >= body.length) return { page: head, rest: [] };

  const words = body[best].split(/\s+/).filter(Boolean);
  low = 1; high = words.length - 1; let cut = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (within([...head, words.slice(0, mid).join(' ')])) { cut = mid; low = mid + 1; } else high = mid - 1;
  }

  /* Most-filled break first; if that strands a line at the top of the next
     page, give words back until two lines carry over. */
  const total = lines(body[best], kind);
  while (cut > 0 && total - lines(words.slice(0, cut).join(' '), kind) < 2) cut -= 1;

  const before = words.slice(0, cut).join(' ');
  const after = words.slice(cut).join(' ');
  const splitCleanly = cut > 0 && lines(before, kind) >= 2 && lines(after, kind) >= 2;

  if (splitCleanly) return { page: [...head, before], rest: [after, ...body.slice(best + 1)] };
  if (best > 0) return { page: head, rest: body.slice(best) };
  /* A single paragraph taller than a whole page: break it wherever it fills. */
  const forced = Math.max(1, cut);
  return { page: [words.slice(0, forced).join(' ')], rest: [words.slice(forced).join(' '), ...body.slice(1)].filter(Boolean) };
}

function lineHeightOf(kind: Kind) {
  const source = document.querySelector<HTMLDivElement>(`.sheet-pagination-probes [data-pagination-body="${kind}"]`);
  return source ? parseFloat(getComputedStyle(source).lineHeight) || 0 : 0;
}

/** The spacing under a paragraph, in pixels. */
function paraGap(kind: Kind) {
  const lh = lineHeightOf(kind);
  return lh ? Math.max(0, measureBody(['x'], kind) - lh) : 0;
}

/** How many lines a paragraph sets in, on the given kind of page. */
function lines(text: string, kind: Kind) {
  const lh = lineHeightOf(kind);
  if (!lh || !text) return 0;
  return Math.round((measureBody([text], kind) - paraGap(kind)) / lh);
}

function measureBody(body: string[], kind: Kind) {
  const source = document.querySelector<HTMLDivElement>(`.sheet-pagination-probes [data-pagination-body="${kind}"]`);
  if (!source) return Number.POSITIVE_INFINITY;
  const clone = source.cloneNode(false) as HTMLDivElement;
  const cs = getComputedStyle(source);
  Object.assign(clone.style, {
    position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden', display: 'block',
    width: `${source.clientWidth}px`, height: 'auto', maxHeight: 'none', overflow: 'visible', flex: 'none',
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing, wordSpacing: cs.wordSpacing, textAlign: cs.textAlign, hyphens: cs.hyphens,
  });
  body.forEach((text) => {
    const p = document.createElement('p');
    p.style.marginBottom = PARA_GAP;
    p.style.whiteSpace = 'pre-line';
    p.textContent = text;
    clone.appendChild(p);
  });
  document.body.appendChild(clone);
  const height = clone.scrollHeight;
  clone.remove();
  return height;
}
