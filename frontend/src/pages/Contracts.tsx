import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { fingerprint, newReference, sha256Hex } from '../lib/fingerprint';
import { verifyUrl } from '../lib/qr';
import { downloadPdf, pdfFilename } from '../lib/pdf';
import { FOILS, TYPEFACES } from '../lib/typefaces';
import {
  blankField, blankParty, blankSection, CONTRACT_STATUS_LABEL, CONTRACT_TEMPLATES,
  contractTemplate, newContract, PARTICULARS,
  type ContractDraft, type ContractKind, type ContractStatus,
} from '../lib/contracts';
import type { Draft, IssuedDocument, Organisation, Signatory } from '../lib/types';
import ContractSheet from '../components/ContractSheet';
import {
  Banner, Button, Card, Field, Input, Mono, PageSpinner, Select, Textarea, Toggle,
} from '../components/ui';
import SheetPreview from '../components/SheetPreview';

/**
 * Agreement Studio.
 *
 * Eight contract types, a clause list you can reorder, and as many signing
 * parties as the agreement has. Independent of the Letter Builder and the
 * Billing Studio; issues into the same register and verifies through the same
 * portal as both.
 */

export default function Contracts() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');

  const [org, setOrg] = useState<Organisation | null>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [doc, setDoc] = useState<ContractDraft | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId);
  const [print, setPrint] = useState({ fingerprint: '', authorizationId: '', documentId: '' });
  const [issued, setIssued] = useState<IssuedDocument | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ organisation: Organisation }>(`/organisations/${slug}`)
      .then((r) => setOrg(r.organisation))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this organisation.'));
    api<{ signatories: Signatory[] }>(`/organisations/${slug}/signatories`)
      .then((r) => setSignatories(r.signatories))
      .catch(() => setSignatories([]));
  }, [slug]);

  useEffect(() => {
    if (!draftId) return;
    api<{ drafts: Draft[] }>(`/documents/${slug}/drafts`)
      .then((r) => {
        const found = r.drafts.find((d) => d.id === draftId);
        if (!found) return;
        try {
          const p = JSON.parse(found.payload || '{}');
          if (p?.kind) {
            const base = { ...newContract(p.kind as ContractKind), reference: '' };
            setDoc({
              ...base, ...p,
              parties: Array.isArray(p.parties) && p.parties.length ? p.parties : base.parties,
              sections: Array.isArray(p.sections) && p.sections.length ? p.sections : base.sections,
              features: { ...base.features, ...(p.features || {}) },
            });
          }
        } catch { /* Unparseable payload: the picker stands. */ }
      })
      .catch(() => {});
  }, [draftId, slug]);

  const set = <K extends keyof ContractDraft>(k: K, v: ContractDraft[K]) => {
    setDoc((d) => (d ? { ...d, [k]: v } : d));
    setIssued(null);
  };

  const refresh = useCallback(async () => {
    if (!org || !doc) return;
    const first = doc.parties[0];
    const fp = await fingerprint({
      organisationSlug: org.slug,
      reference: doc.reference,
      recipientName: doc.parties.map((p) => p.name || p.company).filter(Boolean).join(' / '),
      subject: `${doc.documentTitle} · ${doc.agreementNumber || doc.reference}`,
      department: doc.department,
      classification: doc.classification,
      signerName: first?.name || '',
      signerTitle: first?.title || '',
      issuedOn: doc.issuedOn,
    });
    const tpl = contractTemplate(doc.kind);
    const prefix = (doc.department || tpl.prefix).slice(0, 2).toUpperCase();
    const tail = (await sha256Hex(doc.reference.toUpperCase() + (first?.name || ''))).toUpperCase().slice(0, 5);
    const documentId = (await sha256Hex(doc.reference.toUpperCase())).toUpperCase().slice(0, 16);
    setPrint({ fingerprint: fp, authorizationId: `${prefix}-${tail}`, documentId });
  }, [org, doc]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  function start(kind: ContractKind) {
    const tpl = contractTemplate(kind);
    setDoc({ ...newContract(kind), reference: newReference(tpl.prefix) });
    setIssued(null);
  }

  /* ── Clause and party operations ──────────────────────────────────────── */
  const mutSections = (fn: (s: ContractDraft['sections']) => ContractDraft['sections']) => {
    setDoc((d) => (d ? { ...d, sections: fn([...d.sections]) } : d));
    setIssued(null);
  };
  const mutParties = (fn: (p: ContractDraft['parties']) => ContractDraft['parties']) => {
    setDoc((d) => (d ? { ...d, parties: fn([...d.parties]) } : d));
    setIssued(null);
  };

  async function saveDraft() {
    if (!doc) return;
    setBusy('save'); setError('');
    try {
      const res = await api<{ draft: Draft }>(`/documents/${slug}/drafts`, {
        method: 'POST',
        body: {
          id: savedDraftId || undefined,
          title: `${doc.documentTitle} · ${doc.parties.map((p) => p.company || p.name).filter(Boolean).join(' / ') || doc.reference}`,
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
    if (!doc) return;
    setBusy('issue'); setError('');
    const first = doc.parties[0];
    try {
      const res = await api<{ document: IssuedDocument }>(`/documents/${slug}/issue`, {
        method: 'POST',
        body: {
          reference: doc.reference,
          kind: doc.kind,
          documentTitle: doc.documentTitle,
          recipientName: doc.parties.map((p) => p.name || p.company).filter(Boolean).join(' / '),
          subject: `${doc.documentTitle} · ${doc.agreementNumber || doc.reference}`,
          department: doc.department,
          classification: doc.classification,
          signerName: first?.name || '',
          signerTitle: first?.title || '',
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
    /* The whole stack, not one sheet — every page is exactly A4 and they sit
       flush, so the existing slicer cuts on the page boundaries unaided. */
    const stack = sheetRef.current?.querySelector<HTMLElement>('.sheet-stack');
    if (!stack || !doc) return;
    setBusy('pdf'); setError('');
    try {
      await downloadPdf(stack, pdfFilename(doc.reference), {
        title: `${doc.documentTitle} — ${doc.reference}`,
        subject: doc.parties.map((p) => p.company || p.name).filter(Boolean).join(' / '),
        author: org?.legalName || org?.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    } finally { setBusy(null); }
  }

  if (!org) return error ? <Banner>{error}</Banner> : <PageSpinner />;
  if (!doc) return <Picker onPick={start} />;

  const tpl = contractTemplate(doc.kind);
  const mismatch = issued && issued.fingerprint !== print.fingerprint;
  const sigFor = (name: string) => signatories.find((s) => s.name === name)?.signature || null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="no-print space-y-6">
        {error && <Banner>{error}</Banner>}

        <Card
          title={tpl.title}
          description={tpl.note}
          actions={<Button variant="ghost" onClick={() => setDoc(null)}>Change type</Button>}
        >
          <div className="space-y-4">
            <Field label="Reference">
              <div className="flex gap-2">
                <Input value={doc.reference} onChange={(e) => set('reference', e.target.value.toUpperCase())} className="font-mono" />
                <Button type="button" variant="secondary" className="shrink-0" onClick={() => set('reference', newReference(tpl.prefix))}>New</Button>
              </div>
            </Field>
            <Field label="Title"><Input value={doc.documentTitle} onChange={(e) => set('documentTitle', e.target.value)} /></Field>
            <Field label="Subtitle"><Input value={doc.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Agreement no."><Input value={doc.agreementNumber} onChange={(e) => set('agreementNumber', e.target.value)} className="font-mono" /></Field>
              <Field label="Status">
                <Select value={doc.status} onChange={(e) => set('status', e.target.value as ContractStatus)}>
                  {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Issued on"><Input type="date" value={doc.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} /></Field>
              <Field label="Effective date"><Input type="date" value={doc.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Classification"><Input value={doc.classification} onChange={(e) => set('classification', e.target.value)} /></Field>
              <Field label="Department"><Input value={doc.department} onChange={(e) => set('department', e.target.value)} /></Field>
            </div>
          </div>
        </Card>

        <Card
          title="Parties"
          description={`${doc.parties.length} signing part${doc.parties.length === 1 ? 'y' : 'ies'}.`}
          actions={
            <Button variant="secondary" onClick={() => mutParties((p) => [...p, blankParty(`Party ${String.fromCharCode(65 + p.length)}`)])}>
              Add party
            </Button>
          }
        >
          <div className="space-y-4">
            {doc.parties.map((p, i) => (
              <div key={p.id} className="space-y-3 rounded-md p-3 ring-1 ring-slate-200">
                <div className="flex items-center gap-2">
                  <Input
                    value={p.role}
                    onChange={(e) => mutParties((a) => { a[i] = { ...a[i], role: e.target.value }; return a; })}
                    className="text-xs font-semibold uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => mutParties((a) => (a.length > 1 ? a.filter((_, n) => n !== i) : a))}
                    disabled={doc.parties.length === 1}
                    className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
                <Select
                  value={p.name}
                  onChange={(e) => {
                    const s = signatories.find((x) => x.name === e.target.value);
                    mutParties((a) => { a[i] = { ...a[i], name: e.target.value, title: s?.title ?? a[i].title }; return a; });
                  }}
                >
                  <option value="">— signatory —</option>
                  {signatories.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </Select>
                <Input placeholder="Name" value={p.name} onChange={(e) => mutParties((a) => { a[i] = { ...a[i], name: e.target.value }; return a; })} />
                <Input placeholder="Company" value={p.company} onChange={(e) => mutParties((a) => { a[i] = { ...a[i], company: e.target.value }; return a; })} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Title" value={p.title} onChange={(e) => mutParties((a) => { a[i] = { ...a[i], title: e.target.value }; return a; })} />
                  <Input placeholder="Department" value={p.department} onChange={(e) => mutParties((a) => { a[i] = { ...a[i], department: e.target.value }; return a; })} />
                </div>
                <Textarea rows={2} placeholder="Address" value={p.addressLines} onChange={(e) => mutParties((a) => { a[i] = { ...a[i], addressLines: e.target.value }; return a; })} />
                <Toggle
                  label="Date line under the signature"
                  checked={p.dateLine}
                  onChange={(v) => mutParties((a) => { a[i] = { ...a[i], dateLine: v }; return a; })}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Clauses"
          description={`${doc.sections.length} numbered. Numbering follows position, so reordering renumbers.`}
          actions={<Button variant="secondary" onClick={() => mutSections((s) => [...s, blankSection()])}>Add clause</Button>}
        >
          <div className="space-y-3">
            {doc.sections.map((s, i) => (
              <div key={s.id} className="rounded-md p-3 ring-1 ring-slate-200">
                <div className="flex items-center gap-1 pb-2">
                  <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Mini label="Move up" onClick={() => mutSections((a) => { if (i === 0) return a; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} disabled={i === 0}>↑</Mini>
                    <Mini label="Move down" onClick={() => mutSections((a) => { if (i === a.length - 1) return a; [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a; })} disabled={i === doc.sections.length - 1}>↓</Mini>
                    <Mini label="Ruled line" onClick={() => mutSections((a) => { a[i] = { ...a[i], ruledLines: ((a[i].ruledLines || 0) + 1) % 6 }; return a; })}>___</Mini>
                    <Mini label="Remove" onClick={() => mutSections((a) => (a.length > 1 ? a.filter((_, n) => n !== i) : a))} disabled={doc.sections.length === 1}>✕</Mini>
                  </div>
                </div>
                <Input
                  value={s.heading}
                  placeholder="Clause heading"
                  onChange={(e) => mutSections((a) => { a[i] = { ...a[i], heading: e.target.value }; return a; })}
                  className="font-semibold"
                />
                <Textarea
                  rows={4}
                  className="mt-2"
                  placeholder="Clause text. Blank lines separate paragraphs."
                  value={s.body}
                  onChange={(e) => mutSections((a) => { a[i] = { ...a[i], body: e.target.value }; return a; })}
                />

                {/*
                  Particulars: labelled rows that print as `LABEL: ______value______`.

                  These sit under the prose rather than replacing it, which is
                  the shape most agreements actually take — a paragraph stating
                  what was agreed, then the specifics set out on rules that can
                  equally be completed by hand after printing.
                */}
                {!!s.fields?.length && (
                  <div className="mt-2 space-y-1.5 rounded bg-slate-50 p-2">
                    {s.fields.map((row, fi) => (
                      <div key={row.id} className="flex items-center gap-1.5">
                        <input
                          value={row.label}
                          placeholder="Label"
                          onChange={(e) => mutSections((a) => {
                            const fields = [...(a[i].fields || [])];
                            fields[fi] = { ...fields[fi], label: e.target.value };
                            a[i] = { ...a[i], fields }; return a;
                          })}
                          className="w-[38%] rounded border-0 bg-white px-2 py-1 text-xs font-semibold uppercase ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-slate-900"
                        />
                        <input
                          value={row.value}
                          placeholder="Value — leave blank for a rule to fill in by hand"
                          onChange={(e) => mutSections((a) => {
                            const fields = [...(a[i].fields || [])];
                            fields[fi] = { ...fields[fi], value: e.target.value };
                            a[i] = { ...a[i], fields }; return a;
                          })}
                          className="min-w-0 flex-1 rounded border-0 bg-white px-2 py-1 text-xs ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-slate-900"
                        />
                        <Mini
                          label="Remove field"
                          onClick={() => mutSections((a) => {
                            a[i] = { ...a[i], fields: (a[i].fields || []).filter((_, n) => n !== fi) };
                            return a;
                          })}
                        >✕</Mini>
                      </div>
                    ))}
                  </div>
                )}

                {/* Closing prose, printed under the particulars — the
                    conditions attached to what the rows just set out. */}
                <Textarea
                  rows={3}
                  className="mt-2"
                  placeholder="Closing text, printed below the fill-in rows."
                  value={s.bodyAfter || ''}
                  onChange={(e) => mutSections((a) => { a[i] = { ...a[i], bodyAfter: e.target.value }; return a; })}
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => mutSections((a) => {
                      a[i] = { ...a[i], fields: [...(a[i].fields || []), blankField()] };
                      return a;
                    })}
                    className="rounded px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    + Fill-in row
                  </button>
                  {!s.fields?.length && (
                    <button
                      type="button"
                      onClick={() => mutSections((a) => {
                        a[i] = { ...a[i], fields: PARTICULARS.map((l) => blankField(l)) };
                        return a;
                      })}
                      className="rounded px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                    >
                      + Standard particulars
                    </button>
                  )}
                  {/* Heading colour. Blank inherits the organisation's accent,
                      which is what nearly every clause should use — the control
                      is here for the few that genuinely colour-code. */}
                  <span className="ml-auto flex items-center gap-1">
                    <input
                      type="color"
                      aria-label="Heading colour"
                      title="Heading colour"
                      value={/^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#0F5F5C'}
                      onChange={(e) => mutSections((a) => { a[i] = { ...a[i], color: e.target.value.toUpperCase() }; return a; })}
                      className="h-6 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                    />
                    {s.color && (
                      <button
                        type="button"
                        onClick={() => mutSections((a) => { a[i] = { ...a[i], color: '' }; return a; })}
                        className="text-[10px] text-slate-500 underline underline-offset-2 hover:text-slate-900"
                      >
                        reset
                      </button>
                    )}
                  </span>
                </div>

                {!!s.ruledLines && (
                  <p className="mt-1 text-xs text-slate-500">{s.ruledLines} blank ruled line{s.ruledLines === 1 ? '' : 's'} for completion by hand.</p>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Execution and footer">
          <div className="space-y-4">
            <Field label="Execution wording"><Textarea rows={2} value={doc.executionNote} onChange={(e) => set('executionNote', e.target.value)} /></Field>
            <Field label="Foot of every page"><Input value={doc.footerNote} onChange={(e) => set('footerNote', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="Blocks">
          <div className="space-y-2">
            {([
              ['seal', org.seal ? 'Seal' : 'Seal — none uploaded'],
              ['watermark', org.watermark ? 'Watermark' : 'Watermark — none uploaded'],
              ['qr', 'Verification code'], ['microtext', 'Microtext'], ['frame', 'Frame'],
              ['guilloche', 'Guilloché'], ['holoStrip', 'Foil strip'], ['marginRule', 'Margin classification'],
            ] as const).map(([k, label]) => (
              <Toggle key={k} label={label} checked={doc.features[k]} onChange={(v) => set('features', { ...doc.features, [k]: v })} />
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
          <span className="ml-auto font-mono text-xs text-slate-400">{pageCount} page{pageCount === 1 ? '' : 's'}</span>
        </div>

        <div className="no-print mb-4">
          {issued ? (
            mismatch ? (
              <Banner>
                This agreement has been edited since it was recorded. Re-issue before printing,
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
              as unknown.
            </Banner>
          )}
        </div>

        <div ref={sheetRef}>
          <SheetPreview>
            <ContractSheet
              organisation={org}
              draft={doc}
              reference={doc.reference}
              documentId={print.documentId}
              fingerprint={print.fingerprint}
              authorizationId={print.authorizationId}
              generatedAt={issued ? issued.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : undefined}
              signatureFor={sigFor}
              onPages={setPageCount}
            />
          </SheetPreview>
        </div>
      </div>
    </div>
  );
}

function Picker({ onPick }: { onPick: (k: ContractKind) => void }) {
  const [q, setQ] = useState('');
  const shown = CONTRACT_TEMPLATES.filter((t) => (t.title + t.note).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">Agreement Studio</h1>
        <p className="mt-1 text-sm text-slate-400">
          Eight contract types, numbered clauses you can reorder, and as many signing parties as
          the agreement has. Paginates across as many pages as it needs.
        </p>
      </div>
      <div className="mb-4"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agreement types…" autoFocus /></div>
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
            <p className="mt-2 text-[11px] text-slate-400">{t.sections.length} clauses · {t.partyRoles.join(' / ')}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function Mini({ children, label, onClick, disabled }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="rounded px-1.5 py-0.5 font-mono text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

