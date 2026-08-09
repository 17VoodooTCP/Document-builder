import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { fingerprint, newReference, sha256Hex } from '../lib/fingerprint';
import { isoDate } from '../lib/format';
import { verifyUrl } from '../lib/qr';
import { downloadPdf, pdfFilename } from '../lib/pdf';
import { DEFAULT_FOIL, DEFAULT_TYPEFACE, FOILS, TYPEFACES } from '../lib/typefaces';
import {
  CURRENCIES, currency, documentTotals, formatMinor, formatMoney,
  formatPct, formatQty, parseAmount, parsePct, parseQty,
} from '../lib/money';
import {
  BILLING_TEMPLATES, blankLine, STATUS_LABEL, template,
  type BillingDraft, type BillingKind, type BillingStatus,
} from '../lib/billing';
import type { Draft, IssuedDocument, Organisation, Signatory } from '../lib/types';
import InvoiceSheet from '../components/InvoiceSheet';
import {
  Banner, Button, Card, Field, Input, Mono, PageSpinner, Select, Textarea, Toggle,
} from '../components/ui';
import SheetPreview from '../components/SheetPreview';

/**
 * Billing & Invoice Studio.
 *
 * Twelve commercial document types over one editor and one sheet. Entirely
 * separate from the Letter Builder — its own page, its own state, its own draft
 * payloads — but it issues into the same register and verifies through the same
 * portal, so an invoice and a letter from the same organisation are equally
 * checkable by whoever receives them.
 */

const blank = (kind: BillingKind = 'INVOICE'): BillingDraft => ({
  kind,
  reference: '',
  documentTitle: '',
  subtitle: '',
  issuedOn: isoDate(),
  dueOn: '',
  status: 'ISSUED',
  classification: 'Commercial in confidence',
  department: '',
  party: { name: '', company: '', addressLines: '', shippingLines: '', email: '', phone: '', taxId: '' },
  lines: [blankLine()],
  currencyCode: 'USD',
  shipping: '',
  other: '',
  paid: '',
  payment: {
    bankName: '', accountName: '', accountNumber: '', iban: '',
    swift: '', routing: '', reference: '', notes: '',
  },
  terms: '',
  paymentTerms: 'Payment due within 30 days of the issue date.',
  latePaymentNotice: '',
  notes: '',
  signerName: '',
  signerTitle: '',
  features: {
    seal: true, watermark: true, qr: true, microtext: true,
    frame: true, guilloche: true, holoStrip: true, signature: true,
  },
  typeface: DEFAULT_TYPEFACE,
  foil: DEFAULT_FOIL,
});

export default function Billing() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');

  const [org, setOrg] = useState<Organisation | null>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [doc, setDoc] = useState<BillingDraft>(() => blank());
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId);
  const [print, setPrint] = useState({ fingerprint: '', authorizationId: '', documentId: '' });
  const [issued, setIssued] = useState<IssuedDocument | null>(null);
  const [fit, setFit] = useState({ pt: 8.4, overflowing: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | null>(null);
  const [picking, setPicking] = useState(!draftId);
  const sheetRef = useRef<HTMLDivElement>(null);

  const tpl = template(doc.kind);
  const cur = currency(doc.currencyCode);
  const totals = documentTotals(doc.lines, {
    shippingMinor: parseAmount(doc.shipping, cur.decimals),
    otherMinor: parseAmount(doc.other, cur.decimals),
    paidMinor: parseAmount(doc.paid, cur.decimals),
  });

  const set = <K extends keyof BillingDraft>(k: K, v: BillingDraft[K]) => {
    setDoc((d) => ({ ...d, [k]: v }));
    setIssued(null);
  };
  const setParty = (k: keyof BillingDraft['party'], v: string) => {
    setDoc((d) => ({ ...d, party: { ...d.party, [k]: v } }));
    setIssued(null);
  };
  const setPay = (k: keyof BillingDraft['payment'], v: string) => {
    setDoc((d) => ({ ...d, payment: { ...d.payment, [k]: v } }));
    setIssued(null);
  };

  useEffect(() => {
    api<{ organisation: Organisation }>(`/organisations/${slug}`)
      .then((r) => setOrg(r.organisation))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this organisation.'));
    api<{ signatories: Signatory[] }>(`/organisations/${slug}/signatories`)
      .then((r) => setSignatories(r.signatories))
      .catch(() => setSignatories([]));
  }, [slug]);

  /* Resume a draft. Merged over a blank so a payload written before a field
     existed still opens instead of rendering undefined everywhere. */
  useEffect(() => {
    if (!draftId) return;
    api<{ drafts: Draft[] }>(`/documents/${slug}/drafts`)
      .then((r) => {
        const found = r.drafts.find((d) => d.id === draftId);
        if (!found) return;
        try {
          const p = JSON.parse(found.payload || '{}');
          setDoc((d) => ({
            ...blank(), ...d, ...p,
            party: { ...blank().party, ...(p.party || {}) },
            payment: { ...blank().payment, ...(p.payment || {}) },
            features: { ...blank().features, ...(p.features || {}) },
            lines: Array.isArray(p.lines) && p.lines.length ? p.lines : [blankLine()],
          }));
          setPicking(false);
        } catch { /* Unparseable payload: leave the blank form standing. */ }
      })
      .catch(() => {});
  }, [draftId, slug]);

  /*
   * The fingerprint uses the same canonical field set as every other document,
   * so /verify resolves an invoice exactly as it resolves a letter. The subject
   * carries the document's own title and total, which is what a recipient can
   * check against the paper.
   */
  const refresh = useCallback(async () => {
    if (!org) return;
    const subject = `${doc.documentTitle || tpl.title} · ${cur.code} ${formatMinor(totals.grandTotalMinor, cur)}`;
    const fp = await fingerprint({
      organisationSlug: org.slug,
      reference: doc.reference,
      recipientName: doc.party.name,
      subject,
      department: doc.department,
      classification: doc.classification,
      signerName: doc.signerName,
      signerTitle: doc.signerTitle,
      issuedOn: doc.issuedOn,
    });
    const prefix = (doc.department || tpl.prefix).slice(0, 2).toUpperCase();
    const tail = (await sha256Hex(doc.reference.toUpperCase() + doc.signerName)).toUpperCase().slice(0, 5);
    const documentId = (await sha256Hex(doc.reference.toUpperCase())).toUpperCase().slice(0, 16);
    setPrint({ fingerprint: fp, authorizationId: `${prefix}-${tail}`, documentId });
  }, [org, doc, tpl, cur, totals.grandTotalMinor]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  function start(kind: BillingKind) {
    const t = template(kind);
    setDoc({
      ...blank(kind),
      documentTitle: t.title,
      reference: newReference(t.prefix),
      status: t.showsBalance ? 'ISSUED' : 'DRAFT',
    });
    setPicking(false);
    setIssued(null);
  }

  /* ── Line operations ──────────────────────────────────────────────────── */
  const mutate = (fn: (l: BillingDraft['lines']) => BillingDraft['lines']) => {
    setDoc((d) => ({ ...d, lines: fn([...d.lines]) }));
    setIssued(null);
  };
  const addLine = () => mutate((l) => [...l, blankLine()]);
  const removeLine = (i: number) => mutate((l) => (l.length > 1 ? l.filter((_, n) => n !== i) : l));
  const duplicateLine = (i: number) => mutate((l) => {
    const copy = { ...l[i], id: Math.random().toString(36).slice(2, 10) };
    return [...l.slice(0, i + 1), copy, ...l.slice(i + 1)];
  });
  const moveLine = (i: number, by: number) => mutate((l) => {
    const j = i + by;
    if (j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  });
  const editLine = (i: number, patch: Partial<BillingDraft['lines'][number]>) =>
    mutate((l) => { l[i] = { ...l[i], ...patch }; return l; });

  async function saveDraft() {
    setBusy('save');
    setError('');
    try {
      const res = await api<{ draft: Draft }>(`/documents/${slug}/drafts`, {
        method: 'POST',
        body: {
          id: savedDraftId || undefined,
          title: `${tpl.title} · ${doc.party.name || doc.reference}`,
          kind: doc.kind,
          reference: doc.reference,
          payload: doc,
        },
      });
      setSavedDraftId(res.draft.id);
      if (!draftId) setParams({ draft: res.draft.id }, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that draft.');
    } finally { setBusy(null); }
  }

  async function issue() {
    setBusy('issue');
    setError('');
    try {
      const res = await api<{ document: IssuedDocument }>(`/documents/${slug}/issue`, {
        method: 'POST',
        body: {
          reference: doc.reference,
          kind: doc.kind,
          documentTitle: doc.documentTitle || tpl.title,
          recipientName: doc.party.name,
          subject: `${doc.documentTitle || tpl.title} · ${cur.code} ${formatMinor(totals.grandTotalMinor, cur)}`,
          department: doc.department,
          classification: doc.classification,
          signerName: doc.signerName,
          signerTitle: doc.signerTitle,
          issuedOn: doc.issuedOn,
          authorizationId: print.authorizationId,
        },
      });
      setIssued(res.document);
      setPrint({
        fingerprint: res.document.fingerprint,
        authorizationId: res.document.authorizationId,
        documentId: res.document.verificationId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that document.');
    } finally { setBusy(null); }
  }

  async function savePdf() {
    const sheet = sheetRef.current?.querySelector<HTMLElement>('.sheet');
    if (!sheet) return;
    setBusy('pdf');
    setError('');
    try {
      await downloadPdf(sheet, pdfFilename(doc.reference), {
        title: `${doc.documentTitle || tpl.title} — ${doc.reference}`,
        subject: doc.party.name,
        author: org?.legalName || org?.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    } finally { setBusy(null); }
  }

  if (!org) return error ? <Banner>{error}</Banner> : <PageSpinner />;
  if (picking) return <Picker onPick={start} />;

  const chosen = signatories.find((s) => s.name === doc.signerName);
  const mismatch = issued && issued.fingerprint !== print.fingerprint;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="no-print space-y-6">
        {error && <Banner>{error}</Banner>}

        <Card
          title={tpl.title}
          description={tpl.note}
          actions={<Button variant="ghost" onClick={() => setPicking(true)}>Change type</Button>}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reference">
                <div className="flex gap-2">
                  <Input value={doc.reference} onChange={(e) => set('reference', e.target.value.toUpperCase())} className="font-mono" />
                  <Button type="button" variant="secondary" className="shrink-0" onClick={() => set('reference', newReference(tpl.prefix))}>New</Button>
                </div>
              </Field>
              <Field label="Status">
                <Select value={doc.status} onChange={(e) => set('status', e.target.value as BillingStatus)}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Issued on"><Input type="date" value={doc.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} /></Field>
              {tpl.showsDueDate
                ? <Field label="Due on"><Input type="date" value={doc.dueOn} onChange={(e) => set('dueOn', e.target.value)} /></Field>
                : <Field label="Currency"><CurrencySelect value={doc.currencyCode} onChange={(v) => set('currencyCode', v)} /></Field>}
            </div>
            {tpl.showsDueDate && (
              <Field label="Currency"><CurrencySelect value={doc.currencyCode} onChange={(v) => set('currencyCode', v)} /></Field>
            )}
            <Field label="Title"><Input value={doc.documentTitle} onChange={(e) => set('documentTitle', e.target.value)} placeholder={tpl.title} /></Field>
            <Field label="Subtitle"><Input value={doc.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Classification"><Input value={doc.classification} onChange={(e) => set('classification', e.target.value)} /></Field>
              <Field label="Department"><Input value={doc.department} onChange={(e) => set('department', e.target.value)} /></Field>
            </div>
          </div>
        </Card>

        <Card title={tpl.partyLabel}>
          <div className="space-y-4">
            <Field label="Name"><Input value={doc.party.name} onChange={(e) => setParty('name', e.target.value)} /></Field>
            <Field label="Company"><Input value={doc.party.company} onChange={(e) => setParty('company', e.target.value)} /></Field>
            <Field label="Billing address" hint="One line per line."><Textarea rows={3} value={doc.party.addressLines} onChange={(e) => setParty('addressLines', e.target.value)} /></Field>
            <Field label="Shipping address" hint="Left blank, no ship-to block is printed."><Textarea rows={2} value={doc.party.shippingLines} onChange={(e) => setParty('shippingLines', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email"><Input type="email" value={doc.party.email} onChange={(e) => setParty('email', e.target.value)} /></Field>
              <Field label="Phone"><Input value={doc.party.phone} onChange={(e) => setParty('phone', e.target.value)} /></Field>
            </div>
            <Field label="Tax ID"><Input value={doc.party.taxId} onChange={(e) => setParty('taxId', e.target.value)} className="font-mono" /></Field>
          </div>
        </Card>

        <Card title="Line items" description={`${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'}. Tax is charged on the discounted figure.`}>
          <div className="space-y-3">
            {doc.lines.map((l, i) => (
              <div key={l.id} className="rounded-md p-3 ring-1 ring-slate-200">
                <div className="flex items-center gap-1 pb-2">
                  <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <IconBtn label="Move up" onClick={() => moveLine(i, -1)} disabled={i === 0}>↑</IconBtn>
                    <IconBtn label="Move down" onClick={() => moveLine(i, 1)} disabled={i === doc.lines.length - 1}>↓</IconBtn>
                    <IconBtn label="Duplicate" onClick={() => duplicateLine(i)}>⧉</IconBtn>
                    <IconBtn label="Remove" onClick={() => removeLine(i)} disabled={doc.lines.length === 1}>✕</IconBtn>
                  </div>
                </div>
                <Input
                  value={l.description}
                  onChange={(e) => editLine(i, { description: e.target.value })}
                  placeholder="Description"
                />
                <div className="mt-2 grid grid-cols-5 gap-2">
                  <NumCell label="Qty" value={formatQty(l.qtyMilli)} onChange={(v) => editLine(i, { qtyMilli: parseQty(v) })} />
                  <NumCell label="Unit" value={l.unit} onChange={(v) => editLine(i, { unit: v })} text />
                  <NumCell label="Price" value={formatMinor(l.unitPriceMinor, cur)} onChange={(v) => editLine(i, { unitPriceMinor: parseAmount(v, cur.decimals) })} />
                  <NumCell label="Disc %" value={l.discountBp ? String(l.discountBp / 100) : ''} onChange={(v) => editLine(i, { discountBp: parsePct(v) })} />
                  <NumCell label="Tax %" value={l.taxBp ? String(l.taxBp / 100) : ''} onChange={(v) => editLine(i, { taxBp: parsePct(v) })} />
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={addLine} className="w-full">Add row</Button>
          </div>
        </Card>

        <Card title="Totals" description="Computed in whole minor units — never floats.">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Shipping"><Input value={doc.shipping} onChange={(e) => set('shipping', e.target.value)} className="font-mono" /></Field>
              <Field label="Other"><Input value={doc.other} onChange={(e) => set('other', e.target.value)} className="font-mono" /></Field>
              <Field label="Paid"><Input value={doc.paid} onChange={(e) => set('paid', e.target.value)} className="font-mono" /></Field>
            </div>
            <dl className="rounded-md bg-slate-50 p-3 text-sm">
              <Sum label="Subtotal">{formatMinor(totals.subtotalMinor, cur)}</Sum>
              {totals.discountMinor > 0 && <Sum label="Discount">−{formatMinor(totals.discountMinor, cur)}</Sum>}
              {totals.taxBreakdown.map((b) => <Sum key={b.bp} label={`Tax ${formatPct(b.bp)}`}>{formatMinor(b.taxMinor, cur)}</Sum>)}
              <Sum label="Grand total" strong>{formatMoney(totals.grandTotalMinor, cur)}</Sum>
              {tpl.showsBalance && <Sum label="Balance due" strong>{formatMoney(totals.balanceMinor, cur)}</Sum>}
            </dl>
          </div>
        </Card>

        {tpl.showsPayment && (
          <Card title="Payment details" description="Printed on the document. Never stored on the register.">
            <div className="space-y-4">
              <Field label="Bank"><Input value={doc.payment.bankName} onChange={(e) => setPay('bankName', e.target.value)} /></Field>
              <Field label="Account name"><Input value={doc.payment.accountName} onChange={(e) => setPay('accountName', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Account number"><Input value={doc.payment.accountNumber} onChange={(e) => setPay('accountNumber', e.target.value)} className="font-mono" /></Field>
                <Field label="Routing"><Input value={doc.payment.routing} onChange={(e) => setPay('routing', e.target.value)} className="font-mono" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="IBAN"><Input value={doc.payment.iban} onChange={(e) => setPay('iban', e.target.value)} className="font-mono" /></Field>
                <Field label="SWIFT / BIC"><Input value={doc.payment.swift} onChange={(e) => setPay('swift', e.target.value)} className="font-mono" /></Field>
              </div>
              <Field label="Payment reference" hint="Defaults to the document reference."><Input value={doc.payment.reference} onChange={(e) => setPay('reference', e.target.value)} className="font-mono" /></Field>
              <Field label="Payment notes"><Textarea rows={2} value={doc.payment.notes} onChange={(e) => setPay('notes', e.target.value)} /></Field>
            </div>
          </Card>
        )}

        <Card title="Terms and footer">
          <div className="space-y-4">
            <Field label="Payment terms"><Textarea rows={2} value={doc.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} /></Field>
            <Field label="Late payment notice"><Textarea rows={2} value={doc.latePaymentNotice} onChange={(e) => set('latePaymentNotice', e.target.value)} /></Field>
            <Field label="Terms &amp; conditions"><Textarea rows={3} value={doc.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
            <Field label="Notes"><Textarea rows={2} value={doc.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            <p className="rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">
              This document always prints: <strong>{tpl.footerNote}</strong>
            </p>
          </div>
        </Card>

        <Card title="Signature">
          <div className="space-y-4">
            <Field label="Signatory">
              <Select
                value={doc.signerName}
                onChange={(e) => {
                  const s = signatories.find((x) => x.name === e.target.value);
                  setDoc((d) => ({ ...d, signerName: e.target.value, signerTitle: s?.title ?? d.signerTitle }));
                  setIssued(null);
                }}
              >
                <option value="">— choose —</option>
                {signatories.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Name as printed"><Input value={doc.signerName} onChange={(e) => set('signerName', e.target.value)} /></Field>
            <Field label="Title"><Input value={doc.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="Blocks" description="The same furniture the letters use.">
          <div className="space-y-2">
            {([
              ['signature', 'Signature'], ['seal', org.seal ? 'Seal' : 'Seal — none uploaded'],
              ['watermark', org.watermark ? 'Watermark' : 'Watermark — none uploaded'],
              ['qr', 'Verification code'], ['microtext', 'Microtext'],
              ['frame', 'Frame'], ['guilloche', 'Guilloché'], ['holoStrip', 'Foil strip'],
            ] as const).map(([k, label]) => (
              <Toggle
                key={k}
                label={label}
                checked={doc.features[k]}
                onChange={(v) => set('features', { ...doc.features, [k]: v })}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label="Typeface">
              <Select value={doc.typeface} onChange={(e) => set('typeface', e.target.value)}>
                {Object.entries(TYPEFACES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Foil">
              <Select value={doc.foil} onChange={(e) => set('foil', e.target.value)}>
                {Object.entries(FOILS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
      </div>

      {/* ── Sheet ──────────────────────────────────────────────────────── */}
      <div>
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <Button onClick={issue} loading={busy === 'issue'} disabled={!doc.reference}>
            {issued ? 'Re-issue' : 'Issue and record'}
          </Button>
          <Button variant="secondary" onClick={saveDraft} loading={busy === 'save'}>
            {savedDraftId ? 'Update draft' : 'Save draft'}
          </Button>
          <Button onClick={savePdf} loading={busy === 'pdf'} disabled={!issued || !!mismatch}>Download PDF</Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={!issued || !!mismatch}>Print</Button>
        </div>

        <div className="no-print mb-4 space-y-3">
          {fit.overflowing && (
            <Banner>
              There are more line items than fit on one page, so the last of them are being
              cut off. Remove lines, or split this across two documents, before issuing.
              Multi-page tables are not built yet.
            </Banner>
          )}
          {issued ? (
            mismatch ? (
              <Banner>
                This document has been edited since it was recorded. Re-issue before printing,
                or the fingerprint on the paper will not match the register.
              </Banner>
            ) : (
              <Banner tone="success">
                <div>Recorded as <Mono>{issued.reference}</Mono>.</div>
                <div className="mt-1 text-xs">
                  <a href={verifyUrl(slug, issued.reference)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {verifyUrl(slug, issued.reference)}
                  </a>
                </div>
              </Banner>
            )
          ) : (
            <Banner tone="info">
              Not yet recorded. Until this is issued, a scan of its code reports the reference
              as unknown — so issue before sending.
            </Banner>
          )}
        </div>

        <div ref={sheetRef}>
          <SheetPreview>
            <InvoiceSheet
              organisation={org}
              draft={doc}
              reference={doc.reference}
              documentId={print.documentId}
              fingerprint={print.fingerprint}
              authorizationId={print.authorizationId}
              generatedAt={issued ? issued.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : undefined}
              signatureImage={chosen?.signature}
              onFit={setFit}
            />
          </SheetPreview>
        </div>
      </div>
    </div>
  );
}

/* ── Type picker ──────────────────────────────────────────────────────────── */

function Picker({ onPick }: { onPick: (k: BillingKind) => void }) {
  const [q, setQ] = useState('');
  const shown = BILLING_TEMPLATES.filter((t) =>
    (t.title + t.note + t.kind).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">Billing &amp; Invoice Studio</h1>
        <p className="mt-1 text-sm text-slate-400">
          Twelve commercial document types, one layout, and the same seal, foil, microtext and
          verification code the letters carry.
        </p>
      </div>

      <div className="mb-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search document types…" autoFocus />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => onPick(t.kind)}
            className="rounded-lg bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{t.title}</span>
              <Mono className="text-[10px] text-slate-400">{t.prefix}</Mono>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.note}</p>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="mt-6 text-sm text-slate-400">Nothing matches “{q}”.</p>}
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
    </Select>
  );
}

function NumCell({ label, value, onChange, text }: {
  label: string; value: string; onChange: (v: string) => void; text?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={text ? undefined : 'decimal'}
        className={`w-full rounded border-0 bg-white px-2 py-1 text-xs ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-slate-900 ${text ? '' : 'text-right font-mono tabular-nums'}`}
      />
    </label>
  );
}

function IconBtn({ children, label, onClick, disabled }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Sum({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${strong ? 'mt-1 border-t border-slate-200 pt-1' : ''}`}>
      <dt className={strong ? 'text-xs font-semibold text-slate-700' : 'text-xs text-slate-500'}>{label}</dt>
      <dd className={`font-mono tabular-nums ${strong ? 'text-sm font-bold text-slate-900' : 'text-xs text-slate-700'}`}>{children}</dd>
    </div>
  );
}

