import { useLayoutEffect, useRef, useState } from 'react';
import type { PortalOrganisation } from '../lib/types';
import { longDate } from '../lib/format';
import { typeface as typefaceFor } from '../lib/typefaces';
import {
  currency, documentTotals, formatMinor, formatMoney,
  formatPct, formatQty, lineTotals, parseAmount,
} from '../lib/money';
import { STATUS_LABEL, template, type BillingDraft } from '../lib/billing';
import { paragraphs } from '../lib/format';
import { EdgeBand, Lockup, MarkingTab, PageFoot, SignatureMark, Stub, Watermark, accentOf, inkOf } from './DocKit';

/**
 * The commercial sheet — invoices, quotes, receipts and the rest.
 *
 * Dressed in the document kit (see DocKit). What is particular to money:
 *
 *   - a summary bar under the heading that answers the reader's first three
 *     questions — which document, when it is due, how much — before the table;
 *   - the balance due set as a solid band in the organisation's colour;
 *   - the tear-off stub doubling as the remittance slip: amount, due date and
 *     the reference to quote, beside the scan code.
 *
 * ── Why this paginates rather than shrinking ──────────────────────────────
 *
 * Thirty lines is an ordinary invoice, and nobody can shorten it. So the table
 * splits across pages: the column header repeats on every page, no row is
 * split, and the totals, signature and stub stay together on the last page.
 * Every block is measured off-screen at the exact width it prints at.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

const MM = 3.7795;
const PAD_X = '18mm';
const PAD_TOP_MM = 14;
const PAD_BOTTOM_MM = 21;
const CONTENT_H = (297 - PAD_TOP_MM - PAD_BOTTOM_MM) * MM;
/** Running head on continuation pages, with its gap. */
const RUNNING = 12 * MM;
/** Space between the opening blocks and the table, and above the stub. */
const GAP = 6 * MM;

interface Props {
  organisation: Identity;
  draft: BillingDraft;
  reference: string;
  documentId: string;
  fingerprint: string;
  authorizationId: string;
  generatedAt?: string;
  signatureImage?: string | null;
  /** How many pages the document currently runs to. */
  onPages?: (n: number) => void;
}

export default function InvoiceSheet({
  organisation: org, draft, reference, documentId, fingerprint, signatureImage, onPages,
}: Props) {
  const accent = accentOf(org);
  const ink = inkOf(org);
  const f = draft.features;
  const tpl = template(draft.kind);
  const face = typefaceFor(draft.typeface);
  const cur = currency(draft.currencyCode);

  const totals = documentTotals(draft.lines, {
    shippingMinor: parseAmount(draft.shipping, cur.decimals),
    otherMinor: parseAmount(draft.other, cur.decimals),
    paidMinor: parseAmount(draft.paid, cur.decimals),
  });
  const due = tpl.showsBalance ? totals.balanceMinor : totals.grandTotalMinor;
  const addrLines = (s: string) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

  /* Blocks as values, so the measuring pass and the pages render identical
     markup — the only way the measurement can be trusted. */
  const headBlock = <Head org={org} draft={draft} tpl={tpl} cur={cur} accent={accent} reference={reference} due={due} />;
  const partiesBlock = <Parties org={org} draft={draft} tpl={tpl} addrLines={addrLines} />;
  const tableHeadBlock = <TableHead />;
  const tailBlock = (
    <Tail
      org={org} draft={draft} tpl={tpl} cur={cur} totals={totals} accent={accent}
      reference={reference} signatureImage={signatureImage}
    />
  );
  const stubBlock = (
    <Stub
      org={org} reference={reference} documentId={documentId} fingerprint={fingerprint}
      qrOn={f.qr} padX={PAD_X} noun={tpl.title.toLowerCase()} issued={longDate(draft.issuedOn)}
      aside={<Remittance tpl={tpl} draft={draft} cur={cur} due={due} reference={reference} />}
    />
  );

  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>([draft.lines.map((_, i) => i)]);
  const lastSig = useRef('');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    /* Order matches the measuring container: head, parties, table head, every
       row, the tail, then the stub. */
    const headH = kids[0]?.offsetHeight ?? 0;
    const partiesH = kids[1]?.offsetHeight ?? 0;
    const tableHeadH = kids[2]?.offsetHeight ?? 0;
    const rowH = draft.lines.map((_, i) => kids[3 + i]?.offsetHeight ?? 0);
    const tailH = kids[3 + draft.lines.length]?.offsetHeight ?? 0;
    const stubH = kids[4 + draft.lines.length]?.offsetHeight ?? 0;

    const capFirst = CONTENT_H - headH - partiesH - GAP - tableHeadH;
    const capLater = CONTENT_H - RUNNING - tableHeadH;
    const cap = (pageIndex: number) => (pageIndex === 0 ? capFirst : capLater);

    const out: number[][] = [];
    let current: number[] = [];
    let used = 0;
    rowH.forEach((h, i) => {
      if (current.length && used + h > cap(out.length)) {
        out.push(current);
        current = [];
        used = 0;
      }
      current.push(i);
      used += h;
    });
    out.push(current);

    /* Totals, signature and stub stay together under the last rows, or move
       to a page of their own — never clipped, since they are the point. */
    if (used + tailH + GAP + stubH > cap(out.length - 1)) out.push([]);

    const sig = out.map((p) => p.join(',')).join('|');
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setPages(out);
      onPages?.(out.length);
    }
  });

  const sheetVars = {
    color: ink,
    ['--doc-body' as string]: face.body,
    ['--doc-chrome' as string]: face.chrome,
    ['--doc-accent' as string]: accent,
  } as React.CSSProperties;

  return (
    <>
      {/* Measured off-screen at the printing width, never painted. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="sheet"
        style={{ ...sheetVars, position: 'absolute', left: '-10000px', top: 0, height: 'auto', padding: `0 ${PAD_X}`, visibility: 'hidden' }}
      >
        <div>{headBlock}</div>
        <div>{partiesBlock}</div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}><thead>{tableHeadBlock}</thead></table>
        {draft.lines.map((l, i) => (
          <table key={l.id} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody><LineRow line={l} n={i + 1} cur={cur} ink={ink} /></tbody>
          </table>
        ))}
        <div>{tailBlock}</div>
        <div>{stubBlock}</div>
      </div>

      <div className="sheet-stack">
        {pages.map((rowIndexes, pageNo) => {
          const isLast = pageNo === pages.length - 1;
          return (
            <article
              key={pageNo}
              className="sheet shadow-xl"
              style={sheetVars}
              aria-label={`${org.name} — ${tpl.title} ${reference}, page ${pageNo + 1} of ${pages.length}`}
            >
              <Watermark org={org} on={f.watermark} />
              <EdgeBand org={org} />
              <MarkingTab org={org} text={draft.classification} right={PAD_X} />

              <div className="relative flex flex-col" style={{ padding: `${PAD_TOP_MM}mm ${PAD_X} ${PAD_BOTTOM_MM}mm`, height: '297mm' }}>
                {pageNo === 0 ? (
                  <>
                    {headBlock}
                    {partiesBlock}
                  </>
                ) : (
                  /* A loose continuation page says which document it belongs to. */
                  <div
                    className="flex items-end justify-between gap-4 font-sans"
                    style={{ fontSize: '7pt', height: '6mm', paddingBottom: '2.5mm', borderBottom: '0.2mm solid rgb(0 0 0 / 0.16)', marginBottom: `${RUNNING / MM - 6}mm` }}
                  >
                    <span className="font-semibold">{draft.documentTitle || tpl.title} · continued</span>
                    <span className="font-mono opacity-60">{reference}</span>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: pageNo === 0 ? `${GAP / MM}mm` : 0 }}>
                  {rowIndexes.length > 0 && (
                    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                      <thead>{tableHeadBlock}</thead>
                      <tbody>
                        {rowIndexes.map((i) => (
                          <LineRow key={draft.lines[i].id} line={draft.lines[i]} n={i + 1} cur={cur} ink={ink} />
                        ))}
                      </tbody>
                    </table>
                  )}
                  {isLast && tailBlock}
                </div>

                {isLast && <div style={{ marginTop: `${GAP / MM}mm` }}>{stubBlock}</div>}
              </div>

              <PageFoot org={org} note={tpl.footerNote} folio={`Page ${pageNo + 1} of ${pages.length}`} padX={PAD_X} />
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ── Blocks ───────────────────────────────────────────────────────────────── */

type Tpl = ReturnType<typeof template>;
type Cur = ReturnType<typeof currency>;

function Head({ org, draft, tpl, cur, accent, reference, due }: {
  org: Identity; draft: BillingDraft; tpl: Tpl; cur: Cur; accent: string; reference: string; due: number;
}) {
  return (
    <div>
      <header className="flex items-start justify-between gap-6">
        <Lockup org={org} />

        <div className="shrink-0 text-right" style={{ marginTop: '7mm' }}>
          <h1 className="font-sans font-bold" style={{ fontSize: '20pt', lineHeight: 1, letterSpacing: '-0.01em' }}>
            {draft.documentTitle || tpl.title}
          </h1>
          {draft.subtitle && <div style={{ fontSize: '7.5pt', opacity: 0.7, marginTop: '1.2mm' }}>{draft.subtitle}</div>}
          {/* Named for the state of the money, not the file. */}
          <span
            className="mt-2 inline-block font-sans font-bold uppercase"
            style={{ fontSize: '6pt', letterSpacing: '0.14em', height: '4.6mm', padding: '0 2.6mm', display: 'inline-flex', alignItems: 'center', lineHeight: 1, borderRadius: '999px', border: `0.3mm solid ${accent}`, color: accent }}
          >
            {STATUS_LABEL[draft.status]}
          </span>
        </div>
      </header>

      {/* The three questions a reader asks first, answered before the table. */}
      <div
        className="grid font-sans"
        style={{
          gridTemplateColumns: tpl.showsDueDate && draft.dueOn ? '1fr 1fr 1fr 1.3fr' : '1fr 1fr 1.3fr',
          marginTop: '7mm', background: `${accent}10`, borderRadius: '1.5mm',
        }}
      >
        <Summary label={`${tpl.title} no.`} mono>{reference}</Summary>
        <Summary label="Issued">{longDate(draft.issuedOn) || '—'}</Summary>
        {tpl.showsDueDate && draft.dueOn && <Summary label="Due">{longDate(draft.dueOn)}</Summary>}
        <Summary label={tpl.showsBalance ? 'Amount due' : 'Total'} strong accent={accent}>{formatMoney(due, cur)}</Summary>
      </div>
    </div>
  );
}

function Summary({ label, children, mono, strong, accent }: {
  label: string; children: React.ReactNode; mono?: boolean; strong?: boolean; accent?: string;
}) {
  return (
    <div style={{ padding: '3mm 4mm' }}>
      <div className="uppercase" style={{ fontSize: '5.8pt', letterSpacing: '0.14em', opacity: 0.55 }}>{label}</div>
      <div
        className={`${mono ? 'font-mono' : ''} font-bold`}
        style={{ fontSize: strong ? '12pt' : '8.5pt', marginTop: '0.8mm', color: strong ? accent : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

function Parties({ org, draft, tpl, addrLines }: {
  org: Identity; draft: BillingDraft; tpl: Tpl; addrLines: (s: string) => string[];
}) {
  const ship = addrLines(draft.party.shippingLines);
  return (
    <div>
    <div className="grid gap-6" style={{ gridTemplateColumns: ship.length ? '1fr 1fr 1fr' : '1fr 1fr', marginTop: '6mm', fontSize: '8pt', lineHeight: 1.5 }}>
      <div>
        <Label>{tpl.partyLabel}</Label>
        <div className="font-bold" style={{ fontSize: '9.5pt' }}>{draft.party.name || '—'}</div>
        <div style={{ opacity: 0.82 }}>
          {draft.party.company && <div>{draft.party.company}</div>}
          {addrLines(draft.party.addressLines).map((l, i) => <div key={i}>{l}</div>)}
          {draft.party.email && <div>{draft.party.email}</div>}
          {draft.party.phone && <div>{draft.party.phone}</div>}
          {draft.party.taxId && <div className="font-mono" style={{ fontSize: '7pt' }}>Tax ID {draft.party.taxId}</div>}
        </div>
      </div>

      {ship.length > 0 && (
        <div>
          <Label>Ship to</Label>
          <div style={{ opacity: 0.82 }}>{ship.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
      )}

      <div>
        <Label>From</Label>
        <div className="font-bold" style={{ fontSize: '9.5pt' }}>{org.legalName || org.name}</div>
        <div style={{ opacity: 0.82 }}>
          {[org.addressLine1, org.addressLine2, org.country].filter(Boolean).map((l) => <div key={l}>{l}</div>)}
          {org.supportEmail && <div>{org.supportEmail}</div>}
          {draft.department && <div>{draft.department}</div>}
          {org.taxNumber && <div className="font-mono" style={{ fontSize: '7pt' }}>Tax/VAT no. {org.taxNumber}</div>}
          {org.registrationNumber && <div className="font-mono" style={{ fontSize: '7pt' }}>Reg. no. {org.registrationNumber}</div>}
        </div>
      </div>
      </div>

      {/* The written note — whatever needs saying in words before the figures. */}
      {!!draft.message?.trim() && (
        <div style={{ marginTop: '6mm', fontSize: '8.8pt', lineHeight: 1.6, borderLeft: '0.6mm solid rgb(0 0 0 / 0.14)', paddingLeft: '4mm' }}>
          {paragraphs(draft.message).map((p, i, all) => (
            <p key={i} style={{ marginBottom: i === all.length - 1 ? 0 : '2mm', whiteSpace: 'pre-line' }}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans uppercase" style={{ fontSize: '6pt', letterSpacing: '0.16em', opacity: 0.55, marginBottom: '1mm' }}>
      {children}
    </div>
  );
}

const TH = (extra?: React.CSSProperties): React.CSSProperties =>
  ({ padding: '1.6mm 1.2mm', borderBottom: '0.35mm solid currentColor', fontWeight: 700, ...extra });

function TableHead() {
  return (
    <tr className="font-sans uppercase" style={{ fontSize: '6.4pt', letterSpacing: '0.1em' }}>
      <th className="text-left" style={TH()}>Description</th>
      <th className="text-right" style={TH({ width: '13mm' })}>Qty</th>
      <th className="text-left" style={TH({ width: '12mm' })}>Unit</th>
      <th className="text-right" style={TH({ width: '22mm' })}>Unit price</th>
      <th className="text-right" style={TH({ width: '14mm' })}>Disc.</th>
      <th className="text-right" style={TH({ width: '13mm' })}>Tax</th>
      <th className="text-right" style={TH({ width: '25mm' })}>Amount</th>
    </tr>
  );
}

const TD: React.CSSProperties = { padding: '1.5mm 1.2mm', verticalAlign: 'top' };

function LineRow({ line, n, cur, ink }: {
  line: BillingDraft['lines'][number]; n: number; cur: Cur; ink: string;
}) {
  const t = lineTotals(line);
  return (
    <tr style={{ borderBottom: `0.15mm solid ${ink}24`, fontSize: '8.4pt' }}>
      <td style={TD}>
        <span className="font-mono" style={{ opacity: 0.4, marginRight: '2mm', fontSize: '7pt' }}>{String(n).padStart(2, '0')}</span>
        {line.description || <span style={{ opacity: 0.4 }}>—</span>}
      </td>
      <td className="text-right font-mono tabular-nums" style={TD}>{formatQty(line.qtyMilli)}</td>
      <td style={{ ...TD, opacity: 0.75 }}>{line.unit}</td>
      <td className="text-right font-mono tabular-nums" style={TD}>{formatMinor(line.unitPriceMinor, cur)}</td>
      <td className="text-right font-mono tabular-nums" style={{ ...TD, opacity: 0.75 }}>{line.discountBp ? formatPct(line.discountBp) : '—'}</td>
      <td className="text-right font-mono tabular-nums" style={{ ...TD, opacity: 0.75 }}>{line.taxBp ? formatPct(line.taxBp) : '—'}</td>
      <td className="text-right font-mono tabular-nums font-semibold" style={TD}>{formatMinor(t.netMinor, cur)}</td>
    </tr>
  );
}

/** Totals, payment details, terms and the signature — the conclusion, kept whole. */
function Tail({ org, draft, tpl, cur, totals, accent, reference, signatureImage }: {
  org: Identity; draft: BillingDraft; tpl: Tpl; cur: Cur;
  totals: ReturnType<typeof documentTotals>; accent: string; reference: string;
  signatureImage?: string | null;
}) {
  const f = draft.features;
  const terms = [draft.paymentTerms, draft.latePaymentNotice, draft.terms, draft.notes].filter(Boolean).join('  ');
  const pay = ([
    ['Bank', draft.payment.bankName],
    ['Account name', draft.payment.accountName],
    ['Account', draft.payment.accountNumber],
    ['IBAN', draft.payment.iban],
    ['SWIFT/BIC', draft.payment.swift],
    ['Routing', draft.payment.routing],
    ['Reference', draft.payment.reference || reference],
  ] as const).filter(([, v]) => v);

  return (
    <div style={{ marginTop: '5mm' }}>
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0 flex-1" style={{ fontSize: '7.2pt', lineHeight: 1.6 }}>
          {tpl.showsPayment && pay.length > 0 && (
            <div style={{ border: '0.2mm solid rgb(0 0 0 / 0.14)', borderRadius: '1.5mm', padding: '3mm 3.5mm' }}>
              <Label>How to pay</Label>
              <dl>
                {pay.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-[23mm] shrink-0 font-sans" style={{ opacity: 0.55 }}>{k}</dt>
                    <dd className="min-w-0 flex-1 break-all font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
              {draft.payment.notes && <p style={{ marginTop: '1.5mm' }}>{draft.payment.notes}</p>}
            </div>
          )}
          {terms && <p style={{ marginTop: '3mm', fontSize: '6.8pt', opacity: 0.75 }}>{terms}</p>}
        </div>

        <div className="shrink-0 font-sans" style={{ width: '70mm' }}>
          <Row label="Subtotal" value={formatMinor(totals.subtotalMinor, cur)} />
          {totals.discountMinor > 0 && <Row label="Discount" value={`−${formatMinor(totals.discountMinor, cur)}`} />}
          {totals.taxBreakdown.map((b) => (
            <Row key={b.bp} label={`Tax ${formatPct(b.bp)}`} value={formatMinor(b.taxMinor, cur)} />
          ))}
          {totals.taxBreakdown.length === 0 && totals.taxMinor > 0 && <Row label="Tax" value={formatMinor(totals.taxMinor, cur)} />}
          {totals.shippingMinor !== 0 && <Row label="Shipping" value={formatMinor(totals.shippingMinor, cur)} />}
          {totals.otherMinor !== 0 && <Row label="Other charges" value={formatMinor(totals.otherMinor, cur)} />}
          <div style={{ borderTop: '0.3mm solid currentColor', margin: '1.2mm 0' }} />
          <Row label={`Total ${cur.code}`} value={formatMoney(totals.grandTotalMinor, cur)} bold />
          {tpl.showsBalance && totals.paidMinor !== 0 && <Row label="Paid" value={`−${formatMinor(totals.paidMinor, cur)}`} />}

          {tpl.showsBalance && (
            <div className="flex items-baseline justify-between" style={{ background: accent, color: '#fff', borderRadius: '1.5mm', padding: '2.4mm 3mm', marginTop: '2mm' }}>
              <span className="font-bold uppercase" style={{ fontSize: '6.8pt', letterSpacing: '0.12em' }}>Balance due</span>
              <span className="font-mono font-bold" style={{ fontSize: '11pt' }}>{formatMoney(totals.balanceMinor, cur)}</span>
            </div>
          )}
          {tpl.closingNote && <p style={{ fontSize: '6.5pt', lineHeight: 1.45, opacity: 0.65, marginTop: '2mm' }}>{tpl.closingNote}</p>}
        </div>
      </div>

      {((f.signature && draft.signerName) || (f.seal && org.seal)) && (
        <div className="flex items-end justify-between gap-6" style={{ marginTop: '5mm' }}>
          {f.signature && draft.signerName ? (
            <div>
              <SignatureMark image={signatureImage} width="58mm" />
              <div className="font-bold" style={{ fontSize: '8.4pt', marginTop: '1mm' }}>{draft.signerName}</div>
              <div style={{ fontSize: '7pt', lineHeight: 1.45, opacity: 0.72 }}>
                {draft.signerTitle && <div>{draft.signerTitle}</div>}
                <div>{org.legalName || org.name}</div>
              </div>
            </div>
          ) : <div />}
          {f.seal && org.seal && (
            <img src={org.seal} alt="" aria-hidden="true" className="shrink-0" style={{ width: '24mm', height: '24mm', objectFit: 'contain' }} />
          )}
        </div>
      )}
    </div>
  );
}

/** The right-hand side of the stub: what to pay, by when, quoting what. */
function Remittance({ tpl, draft, cur, due, reference }: {
  tpl: Tpl; draft: BillingDraft; cur: Cur; due: number; reference: string;
}) {
  return (
    <div className="font-sans" style={{ width: '44mm', fontSize: '7pt', lineHeight: 1.45 }}>
      <Label>{tpl.showsBalance ? 'Amount due' : 'Total'}</Label>
      <div className="font-mono font-bold" style={{ fontSize: '12pt', lineHeight: 1.1 }}>{formatMoney(due, cur)}</div>
      {tpl.showsDueDate && draft.dueOn && <div style={{ marginTop: '1mm', opacity: 0.75 }}>By {longDate(draft.dueOn)}</div>}
      <div style={{ opacity: 0.75 }}>Quote <span className="font-mono font-semibold">{draft.payment.reference || reference}</span></div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" style={{ padding: '0.7mm 0' }}>
      <span style={{ fontSize: bold ? '7.5pt' : '7pt', fontWeight: bold ? 700 : 400, opacity: bold ? 1 : 0.7 }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ fontSize: bold ? '9.5pt' : '8pt', fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}
