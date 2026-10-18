import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { fingerprint, newReference, sha256Hex } from '../lib/fingerprint';
import { isoDate } from '../lib/format';
import { verifyUrl } from '../lib/qr';
import type {
  Draft, DocumentDraft, DocumentKind, IssuedDocument, Organisation, Signatory,
} from '../lib/types';
import DocumentSheet from '../components/DocumentSheet';
import { downloadPdf, pdfFilename } from '../lib/pdf';
import { DEFAULT_FOIL, TYPEFACES } from '../lib/typefaces';
import { DEFAULT_PEN, PENS } from '../lib/ink';
import { Banner, Button, Input, Mono, PageSpinner, Select, Toggle } from '../components/ui';

/**
 * The letter builder.
 *
 * The letter is the workspace. In Write, the page itself is typed into —
 * recipient, subject, body and closing sit where they will print, in the type
 * they will print in. Final shows the same letter as the A4 pages that are
 * issued, printed and exported. Everything that is not the words — who signs,
 * the date and reference, how the page is dressed — lives in the slim panel
 * beside it.
 */

const KINDS: DocumentKind[] = ['LETTER', 'CERTIFICATE', 'NOTICE', 'STATEMENT'];

const TITLE_FOR: Record<DocumentKind, string> = {
  LETTER: 'Letter',
  CERTIFICATE: 'Certificate',
  NOTICE: 'Formal notice',
  STATEMENT: 'Statement of account',
};

const blank = (): DocumentDraft => ({
  kind: 'LETTER',
  reference: '',
  documentTitle: TITLE_FOR.LETTER,
  recipientName: '',
  recipientAddress: '',
  subject: '',
  body: '',
  department: '',
  classification: 'Private & Confidential',
  signerName: '',
  signerTitle: '',
  issuedOn: isoDate(),
  headerLabel: '',
  addresseeNote: '',
  footerNote: '',
  version: '1.0',
  revision: 'A',
  closing: 'Yours sincerely,',
  pen: DEFAULT_PEN,
  /* A neutral sans by default: modern, and present on every machine. */
  typeface: 'helvetica',
  foil: DEFAULT_FOIL,
  features: {
    seal: true, watermark: true, qr: true, microtext: false,
    frame: false, guilloche: false, marginRule: false, holoStrip: false,
  },
});

type View = 'write' | 'final';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export default function Builder() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');
  const issuedReference = params.get('issued');

  const [org, setOrg] = useState<Organisation | null>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [doc, setDoc] = useState<DocumentDraft>(blank);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId);
  const [view, setView] = useState<View>(issuedReference ? 'final' : 'write');

  const [print, setPrint] = useState({ fingerprint: '', authorizationId: '', documentId: '' });
  const [issued, setIssued] = useState<IssuedDocument | null>(null);
  const [fit, setFit] = useState<{ pt: number; overflowing: boolean; pages: number }>({ pt: 10.5, overflowing: false, pages: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | 'print' | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /* The final pages are what gets captured, so the export is exactly what the
     Final view shows rather than a second rendering kept in step with it. */
  const sheetRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof DocumentDraft>(k: K, v: DocumentDraft[K]) => {
    setDoc((d) => ({ ...d, [k]: v }));
    /* Any edit after issuing means the paper no longer matches the register. */
    setIssued(null);
  };

  /* Identity and signatories. */
  useEffect(() => {
    api<{ organisation: Organisation }>(`/organisations/${slug}`)
      .then((r) => {
        setOrg(r.organisation);
        setDoc((d) => (d.reference ? d : { ...d, reference: newReference(r.organisation.referencePrefix) }));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this organisation.'));

    api<{ signatories: Signatory[] }>(`/organisations/${slug}/signatories`)
      .then((r) => setSignatories(r.signatories))
      .catch(() => setSignatories([]));
  }, [slug]);

  /* Resume a draft named in the query string. Merged over a blank, so a draft
     written by an older build opens instead of rendering undefined. */
  useEffect(() => {
    if (!draftId) return;
    api<{ drafts: Draft[] }>(`/documents/${slug}/drafts`)
      .then((r) => {
        const found = r.drafts.find((d) => d.id === draftId);
        if (!found) return;
        try {
          const payload = JSON.parse(found.payload || '{}');
          setDoc((d) => ({ ...blank(), ...d, ...payload, features: { ...blank().features, ...payload.features } }));
        } catch { /* Unparseable payload: leave the blank form standing. */ }
      })
      .catch(() => {});
  }, [draftId, slug]);

  /* Reopen the private source snapshot stored at issuance. */
  useEffect(() => {
    if (!issuedReference) return;
    api<{ document: IssuedDocument & { payload?: string } }>(`/documents/${slug}/${encodeURIComponent(issuedReference)}/edit`)
      .then(({ document }) => {
        const payload = JSON.parse(document.payload || '{}') as Partial<DocumentDraft>;
        setDoc({ ...blank(), ...payload, features: { ...blank().features, ...(payload.features || {}) } });
        setIssued(document);
        setPrint({
          fingerprint: document.fingerprint,
          authorizationId: document.authorizationId,
          documentId: document.verificationId,
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not reopen that document.'));
  }, [issuedReference, slug]);

  /*
   * The fingerprint and the authorisation id, recomputed on every edit, by the
   * same derivation the API uses — so what is printed is what the register
   * will hold, not a placeholder replaced after the fact.
   */
  const refresh = useCallback(async () => {
    if (!org) return;
    const fp = await fingerprint({
      organisationSlug: org.slug,
      reference: doc.reference,
      recipientName: doc.recipientName,
      subject: doc.subject,
      department: doc.department,
      classification: doc.classification,
      signerName: doc.signerName,
      signerTitle: doc.signerTitle,
      issuedOn: doc.issuedOn,
    });
    const prefix = (doc.department || org.referencePrefix || 'DOC').slice(0, 2).toUpperCase();
    const tail = (await sha256Hex(doc.reference.toUpperCase() + doc.signerName)).toUpperCase().slice(0, 5);
    const documentId = (await sha256Hex(doc.reference.toUpperCase())).toUpperCase().slice(0, 16);
    setPrint({ fingerprint: fp, authorizationId: `${prefix}-${tail}`, documentId });
  }, [org, doc]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  /* Only people with a real signature on file can sign. */
  const signers = signatories.filter((s) => s.isActive && s.signature);
  const chosen = signers.find((s) => s.name === doc.signerName);
  const mismatch = !!issued && issued.fingerprint !== print.fingerprint;

  async function saveDraft() {
    setBusy('save');
    setError('');
    try {
      const res = await api<{ draft: Draft }>(`/documents/${slug}/drafts`, {
        method: 'POST',
        body: {
          id: savedDraftId || undefined,
          title: doc.recipientName || doc.subject || 'Untitled letter',
          kind: doc.kind,
          reference: doc.reference,
          payload: doc,
        },
      });
      setSavedDraftId(res.draft.id);
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      if (!draftId) setParams({ draft: res.draft.id }, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that draft.');
    } finally {
      setBusy(null);
    }
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
          documentTitle: doc.documentTitle,
          recipientName: doc.recipientName,
          subject: doc.subject,
          department: doc.department,
          classification: doc.classification,
          signerName: doc.signerName,
          signatoryId: chosen?.id ?? '',
          signerTitle: doc.signerTitle,
          issuedOn: doc.issuedOn,
          authorizationId: print.authorizationId,
          payload: doc,
        },
      });
      setIssued(res.document);
      /* The register's own values win from here. */
      setPrint({
        fingerprint: res.document.fingerprint,
        authorizationId: res.document.authorizationId,
        documentId: res.document.verificationId,
      });
      setView('final');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that document.');
    } finally {
      setBusy(null);
    }
  }

  /* Export and print always work from the final pages, so switch to them and
     let pagination settle before capturing. */
  async function showFinal() {
    if (view === 'final') return;
    setView('final');
    await nextFrame();
    await document.fonts?.ready;
    await nextFrame();
  }

  async function savePdf() {
    setBusy('pdf');
    setError('');
    try {
      await showFinal();
      const sheet = sheetRef.current?.querySelector<HTMLElement>('.sheet-stack');
      if (!sheet) throw new Error('The pages are not ready yet — try again.');
      await downloadPdf(sheet, pdfFilename(doc.reference), {
        title: `${doc.documentTitle || 'Letter'} — ${doc.reference}`,
        subject: doc.subject,
        author: org?.legalName || org?.name,
        saveWithPicker: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    } finally {
      setBusy(null);
    }
  }

  async function printPages() {
    setBusy('print');
    try {
      await showFinal();
      window.print();
    } finally {
      setBusy(null);
    }
  }

  if (!org) return error ? <Banner>{error}</Banner> : <PageSpinner />;

  const canIssue = !!doc.reference && !!chosen;
  const sheetProps = {
    organisation: org,
    draft: chosen ? doc : { ...doc, signerName: '' },
    reference: doc.reference,
    documentId: print.documentId,
    fingerprint: print.fingerprint,
    authorizationId: print.authorizationId,
    generatedAt: issued ? issued.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : undefined,
    signatureImage: chosen?.signature,
  };

  return (
    <div className="space-y-5">
      {/* ── Bar ──────────────────────────────────────────────────────────── */}
      <div className="no-print sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/85 px-3 py-2.5 backdrop-blur">
        <div role="tablist" aria-label="View" className="flex rounded-lg bg-slate-900 p-0.5 ring-1 ring-slate-800">
          {(['write', 'final'] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                view === v ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {v === 'write' ? 'Write' : `Final${fit.pages > 1 ? ` · ${fit.pages} pages` : ''}`}
            </button>
          ))}
        </div>

        <Status issued={issued} mismatch={mismatch} slug={slug} savedAt={savedAt} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={saveDraft} loading={busy === 'save'} className="text-slate-300 hover:bg-slate-800 hover:text-white">
            {savedDraftId ? 'Save' : 'Save draft'}
          </Button>
          <Button variant="secondary" onClick={printPages} loading={busy === 'print'} disabled={!issued || mismatch}>
            Print
          </Button>
          <Button variant="secondary" onClick={savePdf} loading={busy === 'pdf'} disabled={!issued || mismatch}>
            Download PDF
          </Button>
          <Button onClick={issue} loading={busy === 'issue'} disabled={!canIssue}>
            {issued && !mismatch ? 'Re-issue' : 'Issue letter'}
          </Button>
        </div>
      </div>

      {error && <div className="no-print"><Banner>{error}</Banner></div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── The page ───────────────────────────────────────────────────── */}
        <div className="min-w-0">
          {view === 'write' && (
            <div className="no-print">
              <Preview key="write">
                <DocumentSheet {...sheetProps} onEdit={(field, value) => set(field, value)} />
              </Preview>
            </div>
          )}

          {/* Always rendered, so the page count is live while writing; shown
              only in Final, where it is what prints and exports. */}
          <div
            ref={sheetRef}
            aria-hidden={view === 'write'}
            style={view === 'write'
              ? { position: 'absolute', left: '-100000px', top: 0, width: `${A4_W}px`, visibility: 'hidden' }
              : undefined}
          >
            <Preview key="final">
              <DocumentSheet {...sheetProps} onFit={setFit} />
            </Preview>
          </div>
        </div>

        {/* ── Panel ──────────────────────────────────────────────────────── */}
        <aside className="no-print space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Panel title="Signed by" note={chosen ? undefined : 'Pick who is on duty. Only staff with a signature on file appear.'}>
            {signers.length ? (
              <div role="radiogroup" aria-label="Signatory" className="grid max-h-[22rem] grid-cols-2 gap-2 overflow-y-auto pr-0.5">
                {signers.map((s) => {
                  const on = chosen?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setDoc((d) => ({ ...d, signerName: s.name, signerTitle: s.title, department: s.department || d.department }));
                        setIssued(null);
                      }}
                      className={`flex flex-col rounded-lg border bg-white p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                        on ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      <span className="flex h-10 items-center justify-center">
                        <img src={s.signature!} alt="" className="max-h-10 max-w-full object-contain" />
                      </span>
                      <span className="mt-1 truncate border-t border-slate-100 pt-1 text-xs font-medium text-slate-900">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No signatures on file yet. An owner adds staff in Identity → Signatories.</p>
            )}

            {chosen && (
              <div className="mt-3 grid gap-3">
                <Labelled label="Title under the name">
                  <Input value={doc.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} placeholder="e.g. Managing Partner" />
                </Labelled>
                <Labelled label="Ink">
                  <Segmented
                    value={doc.pen || DEFAULT_PEN}
                    options={Object.entries(PENS).map(([k, p]) => ({ value: k, label: p.label }))}
                    onChange={(v) => set('pen', v)}
                  />
                </Labelled>
              </div>
            )}
          </Panel>

          <Panel title="Letter details">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Type">
                  <Select
                    value={doc.kind}
                    onChange={(e) => {
                      const kind = e.target.value as DocumentKind;
                      setDoc((d) => ({
                        ...d,
                        kind,
                        /* Only if they have not written their own title. */
                        documentTitle: Object.values(TITLE_FOR).includes(d.documentTitle) || !d.documentTitle ? TITLE_FOR[kind] : d.documentTitle,
                      }));
                      setIssued(null);
                    }}
                  >
                    {KINDS.map((k) => <option key={k} value={k}>{TITLE_FOR[k]}</option>)}
                  </Select>
                </Labelled>
                <Labelled label="Date">
                  <Input type="date" value={doc.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} />
                </Labelled>
              </div>

              {doc.kind !== 'LETTER' && (
                <Labelled label="Heading">
                  <Input value={doc.documentTitle} onChange={(e) => set('documentTitle', e.target.value)} />
                </Labelled>
              )}

              <Labelled label="Reference">
                <div className="flex gap-2">
                  <Input value={doc.reference} onChange={(e) => set('reference', e.target.value.toUpperCase())} className="font-mono" />
                  <Button type="button" variant="secondary" onClick={() => set('reference', newReference(org.referencePrefix))} className="shrink-0" title="New reference">
                    New
                  </Button>
                </div>
              </Labelled>

              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Marking">
                  <Select value={doc.classification} onChange={(e) => set('classification', e.target.value)}>
                    {MARKINGS.includes(doc.classification) ? null : <option value={doc.classification}>{doc.classification}</option>}
                    {MARKINGS.map((m) => <option key={m} value={m}>{m || 'None'}</option>)}
                  </Select>
                </Labelled>
                <Labelled label="Department">
                  <Input value={doc.department} onChange={(e) => set('department', e.target.value)} placeholder="Optional" />
                </Labelled>
              </div>
            </div>
          </Panel>

          <Panel title="Page">
            <div className="grid gap-3">
              <Labelled label="Typeface">
                <Select value={doc.typeface} onChange={(e) => set('typeface', e.target.value)}>
                  {Object.entries(TYPEFACES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
                </Select>
              </Labelled>
              <div className="space-y-2">
                <Toggle
                  label={org.seal ? 'Seal beside the signature' : 'Seal — upload one in Identity'}
                  checked={doc.features.seal && !!org.seal}
                  onChange={(v) => set('features', { ...doc.features, seal: v })}
                />
                <Toggle
                  label={org.watermark ? 'Watermark' : org.logo ? 'Watermark (a wide logo, faint)' : 'Watermark — upload one in Identity'}
                  checked={doc.features.watermark && !!(org.watermark || org.logo)}
                  onChange={(v) => set('features', { ...doc.features, watermark: v })}
                />
                <Toggle label="Verification code" checked={doc.features.qr} onChange={(v) => set('features', { ...doc.features, qr: v })} />
              </div>
              <Labelled label="Line at the foot of every page">
                <Input value={doc.footerNote} onChange={(e) => set('footerNote', e.target.value)} placeholder="Optional — e.g. Registered in England No. 01234567" />
              </Labelled>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const MARKINGS = ['Private & Confidential', 'Confidential', 'Strictly Private', 'Without Prejudice', 'By Hand', ''];

function Status({ issued, mismatch, slug, savedAt }: { issued: IssuedDocument | null; mismatch: boolean; slug: string; savedAt: string | null }) {
  if (issued && mismatch) {
    return <span className="text-sm text-amber-300">Edited since issue — issue again before printing</span>;
  }
  if (issued) {
    return (
      <span className="flex items-center gap-2 text-sm text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        Issued as <Mono>{issued.reference}</Mono>
        <a href={verifyUrl(slug, issued.reference)} target="_blank" rel="noreferrer" className="text-slate-400 underline underline-offset-2 hover:text-white">
          check verification
        </a>
      </span>
    );
  }
  return (
    <span className="text-sm text-slate-400">
      Draft{savedAt ? ` · saved ${savedAt}` : ''} · issue before printing, so the code resolves
    </span>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h2>
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/*
 * The sheet is laid out in millimetres and must stay that way, so it is scaled
 * with a transform to fit its column, and the wrapper is given the height the
 * scaled sheet actually occupies (a transform does not affect layout).
 */
/** 210×297mm at 96dpi — the sheet's own size in CSS pixels. */
const A4_W = 793.7;
const A4_H = 1122.5;

function Preview({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(A4_H);

  useLayoutEffect(() => {
    const outer = box.current;
    if (!outer) return;
    const measure = () => {
      setScale(Math.min(1, outer.clientWidth / A4_W));
      /* offsetHeight, not the bounding rect — the rect is already scaled. */
      const sheet = outer.querySelector<HTMLElement>('.sheet-stack') || outer.querySelector<HTMLElement>('.sheet');
      if (sheet) setHeight(sheet.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    const sheet = outer.querySelector('.sheet-stack') || outer.querySelector('.sheet');
    if (sheet) observer.observe(sheet);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="mx-auto" style={{ maxWidth: `${A4_W}px` }}>
      <div style={{ height: `${height * scale}px` }} className="sheet-fit">
        {/* sheet-scale, so the print stylesheet drops the transform. */}
        <div className="sheet-scale" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${A4_W}px` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
