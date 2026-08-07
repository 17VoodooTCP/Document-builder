import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PortalOrganisation } from '../lib/types';
import { groupHex } from '../lib/fingerprint';
import { longDate } from '../lib/format';
import { qrDataUrl, verifyUrl } from '../lib/qr';
import { Guilloche, HoloStrip, Signature } from './Security';
import { foil as foilFor, typeface as typefaceFor } from '../lib/typefaces';
import { currency, documentTotals, formatMinor, formatMoney, formatPct, formatQty, lineTotals, parseAmount } from './../lib/money';
import { STATUS_LABEL, template, type BillingDraft } from '../lib/billing';

/**
 * The commercial sheet.
 *
 * A second layout engine, deliberately — a letter and an invoice disagree about
 * what the page is for, and forcing one component to be both is how the Letter
 * Builder would end up carrying tax-rate logic. Nothing in DocumentSheet is
 * touched by this file.
 *
 * What *is* shared is everything that makes a document look and verify like one
 * of ours: the frame, the guilloché, the foil strip, the microtext, the seal,
 * the facsimile signature, the QR and the fingerprint block all come from the
 * same modules the letters use, so a customer receiving an invoice and a letter
 * from the same organisation gets two documents that plainly belong together.
 *
 * ── The wording rule, applied to commerce ─────────────────────────────────
 *
 * It matters more here than on a letter. A proforma that reads like an invoice
 * is a customs and tax problem for whoever receives it; a quotation that reads
 * like a demand is one that gets paid by mistake. So each template carries its
 * own foot line stating what the document is *not*, and the renderer prints it
 * whether or not anybody scrolled that far in the editor.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

interface Props {
  organisation: Identity;
  draft: BillingDraft;
  reference: string;
  documentId: string;
  fingerprint: string;
  authorizationId: string;
  generatedAt?: string;
  signatureImage?: string | null;
  onFit?: (info: { pt: number; overflowing: boolean }) => void;
}

export default function InvoiceSheet({
  organisation: org, draft, reference, documentId, fingerprint,
  authorizationId, generatedAt, signatureImage, onFit,
}: Props) {
  const accent = org.accentColor || '#0F5F5C';
  const ink = org.inkColor || '#1B2733';
  const f = draft.features;
  const tpl = template(draft.kind);
  const foilSpec = foilFor(draft.foil);
  const face = typefaceFor(draft.typeface);
  const cur = currency(draft.currencyCode);

  const totals = documentTotals(draft.lines, {
    shippingMinor: parseAmount(draft.shipping, cur.decimals),
    otherMinor: parseAmount(draft.other, cur.decimals),
    paidMinor: parseAmount(draft.paid, cur.decimals),
  });

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!f.qr || !reference) { setQr(null); return; }
    let live = true;
    qrDataUrl(verifyUrl(org.slug, reference))
      .then((u) => { if (live) setQr(u); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [f.qr, org.slug, reference]);

  /*
   * The line table is what gives.
   *
   * Same approach as the letter body, and the same reason: the sheet is exactly
   * one page, everything around the table is fixed furniture, so the table is
   * stepped down until it clears. The floor is 6.4pt — lower than body copy
   * tolerates, because a table of figures stays legible smaller than running
   * prose does, and an invoice with twenty lines is ordinary.
   */
  const tableRef = useRef<HTMLDivElement>(null);
  const lastFit = useRef({ pt: 0, overflowing: false });
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    let pt = 8.4;
    el.style.fontSize = `${pt}pt`;
    while (el.scrollHeight > el.clientHeight + 1 && pt > 6.4) {
      pt = Math.round((pt - 0.1) * 10) / 10;
      el.style.fontSize = `${pt}pt`;
    }
    const next = { pt, overflowing: el.scrollHeight > el.clientHeight + 1 };
    if (next.pt !== lastFit.current.pt || next.overflowing !== lastFit.current.overflowing) {
      lastFit.current = next;
      onFit?.(next);
    }
  });

  const address = [org.addressLine1, org.addressLine2, org.country].filter(Boolean);
  const stamp = generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lines = (s: string) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <article
      className="sheet font-serif shadow-xl"
      style={{
        color: ink,
        ['--doc-body' as string]: face.body,
        ['--doc-chrome' as string]: face.chrome,
      } as React.CSSProperties}
      aria-label={`${org.name} — ${tpl.title} ${reference}`}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
        {f.watermark && org.watermark
          ? <img src={org.watermark} alt="" className="select-none" style={{ width: '150mm', opacity: 0.13 }} />
          : f.guilloche ? <Guilloche seed={reference} size={560} color={accent} opacity={0.1} rings={6} /> : null}
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

      <div className="relative flex flex-col" style={{ padding: '13mm 15mm 9mm', height: '297mm' }}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {org.logo
              ? <img src={org.logo} alt={org.name} style={{ maxHeight: '14mm', maxWidth: '70mm' }} />
              : <div className="font-serif leading-none" style={{ fontSize: '18pt', color: accent }}>{org.name}</div>}
            <address className="text-[7pt] not-italic leading-[1.5] opacity-85" style={{ marginTop: '2.5mm' }}>
              <div className="font-semibold">{org.legalName || org.name}</div>
              {address.map((l) => <div key={l}>{l}</div>)}
              {org.supportEmail && <div>{org.supportEmail}</div>}
              {org.website && <div>{org.website}</div>}
            </address>
          </div>

          <div className="shrink-0 text-right">
            <h1 className="font-sans font-bold uppercase" style={{ fontSize: '15pt', letterSpacing: '0.03em', lineHeight: 1 }}>
              {draft.documentTitle || tpl.title}
            </h1>
            {draft.subtitle && <div className="text-[7.5pt] opacity-70" style={{ marginTop: '1mm' }}>{draft.subtitle}</div>}

            {/* Status badge. Named for the state of the money, not the file. */}
            <div
              className="inline-block font-sans text-[6.5pt] font-bold uppercase tracking-[0.14em]"
              style={{
                marginTop: '2.5mm', padding: '1mm 2.5mm',
                border: `0.3mm solid ${accent}`, color: accent,
              }}
            >
              {STATUS_LABEL[draft.status]}
            </div>

            <dl className="text-right text-[7.5pt] leading-[1.55]" style={{ marginTop: '3mm' }}>
              <Meta label={`${tpl.title} no.`} mono>{reference}</Meta>
              <Meta label="Issued">{longDate(draft.issuedOn)}</Meta>
              {tpl.showsDueDate && draft.dueOn && <Meta label="Due">{longDate(draft.dueOn)}</Meta>}
              {draft.department && <Meta label="Department">{draft.department}</Meta>}
              <Meta label="Currency" mono>{cur.code}</Meta>
            </dl>
          </div>
        </header>

        <div style={{ marginTop: '4mm' }}>
          {f.holoStrip
            ? <HoloStrip
                stops={foilSpec.stops}
                text={`${(org.legalName || org.name).toUpperCase()} · ${reference}`}
                textColor={foilSpec.text}
                edge={foilSpec.edge}
              />
            : <div style={{ height: '0.6mm', background: ink }} />}
        </div>

        {/* ── Parties ────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-8" style={{ marginTop: '6mm' }}>
          <div className="min-w-0 flex-1">
            <div className="font-sans text-[6.5pt] uppercase tracking-[0.2em] opacity-55">{tpl.partyLabel}</div>
            <div className="font-serif font-bold" style={{ fontSize: '11pt', marginTop: '1.5mm' }}>
              {draft.party.name || '—'}
            </div>
            <div className="text-[8pt] leading-[1.5] opacity-85">
              {draft.party.company && <div>{draft.party.company}</div>}
              {lines(draft.party.addressLines).map((l, i) => <div key={i}>{l}</div>)}
              {draft.party.email && <div>{draft.party.email}</div>}
              {draft.party.phone && <div>{draft.party.phone}</div>}
              {draft.party.taxId && <div className="font-mono text-[7pt]">Tax ID {draft.party.taxId}</div>}
            </div>
          </div>

          {lines(draft.party.shippingLines).length > 0 && (
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[6.5pt] uppercase tracking-[0.2em] opacity-55">Ship to</div>
              <div className="text-[8pt] leading-[1.5] opacity-85" style={{ marginTop: '1.5mm' }}>
                {lines(draft.party.shippingLines).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          )}

          {draft.classification && (
            <div className="shrink-0 text-right" style={{ maxWidth: '48mm' }}>
              <div style={{ height: '0.2mm', background: ink, opacity: 0.5, marginBottom: '1.5mm' }} />
              <div className="font-sans text-[7pt] font-bold uppercase tracking-[0.14em]">{draft.classification}</div>
            </div>
          )}
        </div>

        {/* ── Line items ─────────────────────────────────────────────────── */}
        <div ref={tableRef} className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: '6mm' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="font-sans uppercase tracking-[0.1em]" style={{ fontSize: '0.78em', color: accent }}>
                <th className="text-left" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}` }}>Description</th>
                <th className="text-right" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '13mm' }}>Qty</th>
                <th className="text-left" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '12mm' }}>Unit</th>
                <th className="text-right" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '22mm' }}>Unit price</th>
                <th className="text-right" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '14mm' }}>Disc.</th>
                <th className="text-right" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '13mm' }}>Tax</th>
                <th className="text-right" style={{ padding: '1.4mm 1mm', borderBottom: `0.35mm solid ${accent}`, width: '24mm' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l, i) => {
                const t = lineTotals(l);
                return (
                  <tr key={l.id} style={{ borderBottom: `0.12mm solid ${ink}22` }}>
                    <td style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>
                      <span className="opacity-45" style={{ marginRight: '1.5mm' }}>{i + 1}.</span>
                      {l.description || <span className="opacity-40">—</span>}
                    </td>
                    <td className="text-right font-mono tabular-nums" style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>{formatQty(l.qtyMilli)}</td>
                    <td style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }} className="opacity-75">{l.unit}</td>
                    <td className="text-right font-mono tabular-nums" style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>{formatMinor(l.unitPriceMinor, cur)}</td>
                    <td className="text-right font-mono tabular-nums opacity-75" style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>{l.discountBp ? formatPct(l.discountBp) : '—'}</td>
                    <td className="text-right font-mono tabular-nums opacity-75" style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>{l.taxBp ? formatPct(l.taxBp) : '—'}</td>
                    <td className="text-right font-mono tabular-nums font-semibold" style={{ padding: '1.3mm 1mm', verticalAlign: 'top' }}>{formatMinor(t.netMinor, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Totals ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-8" style={{ marginTop: '4mm' }}>
          <div className="min-w-0 flex-1 text-[7pt] leading-[1.6] opacity-85">
            {tpl.showsPayment && (
              <>
                <div className="font-sans text-[6.5pt] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>
                  Payment
                </div>
                <dl className="font-mono" style={{ marginTop: '1.5mm' }}>
                  {([
                    ['Bank', draft.payment.bankName],
                    ['Account name', draft.payment.accountName],
                    ['Account', draft.payment.accountNumber],
                    ['IBAN', draft.payment.iban],
                    ['SWIFT/BIC', draft.payment.swift],
                    ['Routing', draft.payment.routing],
                    ['Reference', draft.payment.reference || reference],
                  ] as const).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-[24mm] shrink-0 font-sans opacity-55">{k}</dt>
                      <dd className="min-w-0 flex-1 break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
                {draft.payment.notes && <p style={{ marginTop: '1.5mm' }}>{draft.payment.notes}</p>}
              </>
            )}
          </div>

          <div className="shrink-0" style={{ width: '68mm' }}>
            <Row label="Subtotal" value={formatMinor(totals.subtotalMinor, cur)} />
            {totals.discountMinor > 0 && <Row label="Discount" value={`−${formatMinor(totals.discountMinor, cur)}`} />}
            {totals.taxBreakdown.map((b) => (
              <Row key={b.bp} label={`Tax ${formatPct(b.bp)}`} value={formatMinor(b.taxMinor, cur)} />
            ))}
            {totals.taxBreakdown.length === 0 && totals.taxMinor > 0 && <Row label="Tax" value={formatMinor(totals.taxMinor, cur)} />}
            {totals.shippingMinor !== 0 && <Row label="Shipping" value={formatMinor(totals.shippingMinor, cur)} />}
            {totals.otherMinor !== 0 && <Row label="Other charges" value={formatMinor(totals.otherMinor, cur)} />}

            <div style={{ height: '0.35mm', background: accent, margin: '1.5mm 0' }} />
            <Row label={`Total ${cur.code}`} value={formatMoney(totals.grandTotalMinor, cur)} strong />

            {tpl.showsBalance && (
              <>
                {totals.paidMinor !== 0 && <Row label="Amount paid" value={`−${formatMinor(totals.paidMinor, cur)}`} />}
                <div style={{ height: '0.15mm', background: ink, opacity: 0.4, margin: '1.5mm 0' }} />
                <Row label="Balance due" value={formatMoney(totals.balanceMinor, cur)} strong accent={accent} />
              </>
            )}

            <p className="text-[6.5pt] leading-snug opacity-70" style={{ marginTop: '2.5mm' }}>
              {tpl.closingNote}
            </p>
          </div>
        </div>

        {/* ── Signature and seal ─────────────────────────────────────────── */}
        {(f.signature || f.seal) && (
          <div className="flex items-end justify-between gap-6" style={{ marginTop: '5mm' }}>
            {f.signature && draft.signerName ? (
              <div>
                <Signature name={draft.signerName} image={signatureImage} authorizationId={authorizationId} />
                <div className="text-[8pt] font-bold" style={{ marginTop: '1.5mm' }}>{draft.signerName}</div>
                <div className="text-[7pt] leading-[1.5] opacity-75">
                  {draft.signerTitle && <div>{draft.signerTitle}</div>}
                  <div>{org.legalName || org.name}</div>
                </div>
              </div>
            ) : <div />}

            {f.seal && (
              <div className="shrink-0">
                {org.seal
                  ? <img src={org.seal} alt="" aria-hidden="true" style={{ width: '26mm', height: '26mm', objectFit: 'contain' }} />
                  : <Guilloche seed={`${reference}:seal`} size={98} color={accent} opacity={0.7} rings={4} strokeWidth={0.4} />}
              </div>
            )}
          </div>
        )}

        {/* ── Foot ───────────────────────────────────────────────────────── */}
        <div style={{ marginTop: '4mm', borderTop: `0.2mm dashed ${ink}`, opacity: 0.35 }} />

        <footer style={{ marginTop: '3mm' }}>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[7pt] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>
                Terms &amp; verification
              </div>
              <p className="text-[6.2pt] leading-[1.5] opacity-80" style={{ marginTop: '1.2mm', maxWidth: '108mm' }}>
                {[draft.paymentTerms, draft.latePaymentNotice, draft.terms, draft.notes].filter(Boolean).join('  ')}
              </p>
              <p className="text-[6.2pt] leading-[1.5] opacity-80" style={{ marginTop: '1.2mm', maxWidth: '108mm' }}>
                Issued by {org.legalName || org.name} under reference {reference}. The details
                below are recorded on the issuer&rsquo;s register; the register does not hold the
                line items, so the comparison is one you make.
              </p>

              <dl className="grid grid-cols-2 gap-x-5 text-[6.2pt]" style={{ marginTop: '2mm' }}>
                <Foot label="Document ID" mono>{documentId}</Foot>
                <Foot label="Reference" mono>{reference}</Foot>
                <Foot label="Total" mono>{cur.code} {formatMinor(totals.grandTotalMinor, cur)}</Foot>
                <Foot label="Classification">{draft.classification || '—'}</Foot>
                <Foot label="Generated" mono>{stamp}</Foot>
                <Foot label="Authorisation" mono>{authorizationId}</Foot>
                <Foot label="Fingerprint" mono>{groupHex(fingerprint.slice(0, 20))}</Foot>
              </dl>
            </div>

            {f.qr && (
              <div className="shrink-0 text-center" style={{ border: `0.2mm solid ${ink}`, padding: '2mm', width: '32mm' }}>
                <div className="font-sans text-[5.2pt] font-bold uppercase tracking-[0.12em]">Verify this document</div>
                {qr
                  ? <img src={qr} alt={`Verification code for ${reference}`} style={{ width: '22mm', height: '22mm', margin: '1.5mm auto' }} />
                  : <div style={{ width: '22mm', height: '22mm', margin: '1.5mm auto', border: `0.2mm dashed ${accent}` }} />}
                <div style={{ height: '0.15mm', background: ink, opacity: 0.4 }} />
                <div className="font-mono text-[4.8pt] font-semibold" style={{ marginTop: '1mm' }}>{documentId}</div>
              </div>
            )}
          </div>

          <div
            className="flex items-center justify-between font-sans text-[5.5pt] uppercase tracking-[0.14em] opacity-60"
            style={{ marginTop: '3mm' }}
          >
            <span>{tpl.footerNote}</span>
            <span className="font-mono tracking-[0.08em]">{documentId}</span>
            <span>Page 1 of 1</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

function Meta({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-end gap-3">
      <dt className="font-sans text-[6pt] uppercase tracking-[0.16em] opacity-50">{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono tracking-[0.05em]' : ''}`}>{children}</dd>
    </div>
  );
}

function Row({ label, value, strong, accent }: {
  label: string; value: string; strong?: boolean; accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3" style={{ padding: '0.7mm 0' }}>
      <span className={`font-sans uppercase tracking-[0.1em] ${strong ? 'text-[7pt] font-bold' : 'text-[6.5pt] opacity-65'}`}>
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${strong ? 'text-[10pt] font-bold' : 'text-[8pt]'}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function Foot({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2" style={{ paddingBottom: '0.7mm' }}>
      <dt className="w-[20mm] shrink-0 font-sans uppercase tracking-[0.1em] opacity-50">{label}</dt>
      <dd className={`min-w-0 flex-1 font-semibold ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}
