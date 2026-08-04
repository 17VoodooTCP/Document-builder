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
import {
  DEFAULT_FOIL, DEFAULT_TYPEFACE, FOILS, TYPEFACES, foil as foilFor, typeface as typefaceFor,
} from '../lib/typefaces';
import {
  Banner, Button, Card, Field, Input, Mono, PageSpinner, Select, Textarea, Toggle,
} from '../components/ui';

/**
 * The builder.
 *
 * Form on the left, the actual sheet on the right — not an approximation of it.
 * The preview is the same component that prints, at a smaller scale, because a
 * preview that is a separate rendering of the same data is a second thing to
 * keep in step and it never is.
 */

const KINDS: DocumentKind[] = ['LETTER', 'CERTIFICATE', 'NOTICE', 'STATEMENT'];

const TITLE_FOR: Record<DocumentKind, string> = {
  LETTER: 'Official correspondence',
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
  headerLabel: 'Official correspondence',
  addresseeNote: 'Addressee only.',
  footerNote: 'Non-negotiable · Not a statement of account',
  version: '1.0',
  revision: 'A',
  typeface: DEFAULT_TYPEFACE,
  foil: DEFAULT_FOIL,
  features: {
    seal: true, watermark: true, qr: true, microtext: true,
    frame: true, guilloche: true, marginRule: true, holoStrip: true,
  },
});

export default function Builder() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');

  const [org, setOrg] = useState<Organisation | null>(null);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [doc, setDoc] = useState<DocumentDraft>(blank);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId);

  const [print, setPrint] = useState({ fingerprint: '', authorizationId: '', documentId: '' });
  const [issued, setIssued] = useState<IssuedDocument | null>(null);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | null>(null);
  /* The live sheet is what gets captured, so the export is always exactly what
     is on screen rather than a second rendering that has to be kept in step. */
  const sheetRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof DocumentDraft>(k: K, v: DocumentDraft[K]) => {
    setDoc((d) => ({ ...d, [k]: v }));
    /* Any edit after issuing means the paper no longer matches the register
       entry. Clearing the banner stops it claiming otherwise. */
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

  /* Resume a draft, if one was named in the query string. */
  useEffect(() => {
    if (!draftId) return;
    api<{ drafts: Draft[] }>(`/documents/${slug}/drafts`)
      .then((r) => {
        const found = r.drafts.find((d) => d.id === draftId);
        if (!found) return;
        try {
          /* A payload written by an older build may be missing fields the form
             now has. Merged over a blank rather than trusted whole, so a draft
             from last month opens instead of rendering undefined everywhere. */
          const payload = JSON.parse(found.payload || '{}');
          setDoc((d) => ({ ...blank(), ...d, ...payload, features: { ...blank().features, ...payload.features } }));
        } catch { /* Unparseable payload: leave the blank form standing. */ }
      })
      .catch(() => {});
  }, [draftId, slug]);

  /*
   * The fingerprint and the authorisation id, recomputed on every edit.
   *
   * Both are printed on the sheet, and both have to be what the API will store
   * for the same fields — see lib/fingerprint. Computing them here means what
   * is on screen is what will be on the register, rather than a placeholder
   * replaced after the fact.
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

    /* The same derivation the API uses for verificationId, so the id printed in
       the footer is the one the register holds rather than a second identifier
       that happens to sit next to it. */
    const documentId = (await sha256Hex(doc.reference.toUpperCase())).toUpperCase().slice(0, 16);

    setPrint({ fingerprint: fp, authorizationId: `${prefix}-${tail}`, documentId });
  }, [org, doc]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  async function saveDraft() {
    setBusy('save');
    setError('');
    try {
      const res = await api<{ draft: Draft }>(`/documents/${slug}/drafts`, {
        method: 'POST',
        body: {
          id: savedDraftId || undefined,
          title: doc.recipientName || doc.subject || 'Untitled document',
          kind: doc.kind,
          reference: doc.reference,
          payload: doc,
        },
      });
      setSavedDraftId(res.draft.id);
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
          signerTitle: doc.signerTitle,
          issuedOn: doc.issuedOn,
          authorizationId: print.authorizationId,
        },
      });
      setIssued(res.document);
      /* The register's own values win from here. If the two ever disagree, the
         printed page should carry what a scan will actually return. */
      setPrint({
        fingerprint: res.document.fingerprint,
        authorizationId: res.document.authorizationId,
        documentId: res.document.verificationId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that document.');
    } finally {
      setBusy(null);
    }
  }

  async function savePdf() {
    const sheet = sheetRef.current?.querySelector<HTMLElement>('.sheet');
    if (!sheet) return;
    setBusy('pdf');
    setError('');
    try {
      await downloadPdf(sheet, pdfFilename(doc.reference), {
        title: `${doc.documentTitle || 'Document'} — ${doc.reference}`,
        subject: doc.subject,
        author: org?.legalName || org?.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    } finally {
      setBusy(null);
    }
  }

  if (!org) return error ? <Banner>{error}</Banner> : <PageSpinner />;

  const chosen = signatories.find((s) => s.name === doc.signerName);
  const mismatch = issued && issued.fingerprint !== print.fingerprint;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="no-print space-y-6">
        {error && <Banner>{error}</Banner>}

        <Card title="Document">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Kind">
                <Select
                  value={doc.kind}
                  onChange={(e) => {
                    const kind = e.target.value as DocumentKind;
                    setDoc((d) => ({
                      ...d,
                      kind,
                      /* Only if they have not written their own — retyping a
                         title because you changed a dropdown is a small insult. */
                      documentTitle: Object.values(TITLE_FOR).includes(d.documentTitle)
                        ? TITLE_FOR[kind] : d.documentTitle,
                    }));
                    setIssued(null);
                  }}
                >
                  {KINDS.map((k) => <option key={k} value={k}>{k[0] + k.slice(1).toLowerCase()}</option>)}
                </Select>
              </Field>
              <Field label="Issued on">
                <Input type="date" value={doc.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} />
              </Field>
            </div>

            <Field label="Title">
              <Input value={doc.documentTitle} onChange={(e) => set('documentTitle', e.target.value)} />
            </Field>

            <Field
              label="Reference"
              hint="Goes on the paper and into the code. Regenerate before issuing a second, different document."
            >
              <div className="flex gap-2">
                <Input
                  value={doc.reference}
                  onChange={(e) => set('reference', e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => set('reference', newReference(org.referencePrefix))}
                  className="shrink-0"
                >
                  New
                </Button>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Classification">
                <Input value={doc.classification} onChange={(e) => set('classification', e.target.value)} />
              </Field>
              <Field label="Department">
                <Input value={doc.department} onChange={(e) => set('department', e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Recipient">
          <div className="space-y-4">
            <Field label="Name">
              <Input value={doc.recipientName} onChange={(e) => set('recipientName', e.target.value)} />
            </Field>
            <Field label="Address" hint="One line per line.">
              <Textarea
                rows={3}
                value={doc.recipientAddress}
                onChange={(e) => set('recipientAddress', e.target.value)}
              />
            </Field>
            <Field label="Subject">
              <Input value={doc.subject} onChange={(e) => set('subject', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card
          title="Body"
          description="Never stored. The register holds the details around it, not the text."
        >
          <Textarea
            rows={12}
            value={doc.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder={'Blank lines separate paragraphs.'}
          />
        </Card>

        <Card title="Signature">
          <div className="space-y-4">
            <Field label="Signatory">
              <Select
                value={doc.signerName}
                onChange={(e) => {
                  const s = signatories.find((x) => x.name === e.target.value);
                  setDoc((d) => ({
                    ...d,
                    signerName: e.target.value,
                    signerTitle: s?.title ?? d.signerTitle,
                    department: s?.department || d.department,
                  }));
                  setIssued(null);
                }}
              >
                <option value="">— choose —</option>
                {signatories.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </Select>
            </Field>

            <Field label="Name as printed">
              <Input value={doc.signerName} onChange={(e) => set('signerName', e.target.value)} />
            </Field>
            <Field label="Title">
              <Input value={doc.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="Blocks" description="What this document draws. Assets it has none of are skipped either way.">
          <div className="space-y-2">
            <Toggle
              label={org.seal ? 'Seal' : 'Seal — none uploaded'}
              checked={doc.features.seal}
              onChange={(v) => set('features', { ...doc.features, seal: v })}
            />
            <Toggle
              label={org.watermark ? 'Watermark' : 'Watermark — none uploaded'}
              checked={doc.features.watermark}
              onChange={(v) => set('features', { ...doc.features, watermark: v })}
            />
            <Toggle label="Verification code" checked={doc.features.qr} onChange={(v) => set('features', { ...doc.features, qr: v })} />
            <Toggle label="Microtext" checked={doc.features.microtext} onChange={(v) => set('features', { ...doc.features, microtext: v })} />
            <Toggle label="Frame" checked={doc.features.frame} onChange={(v) => set('features', { ...doc.features, frame: v })} />
            <Toggle
              label={org.watermark ? 'Guilloché — watermark takes precedence' : 'Guilloché'}
              checked={doc.features.guilloche}
              onChange={(v) => set('features', { ...doc.features, guilloche: v })}
            />
            <Toggle label="Margin classification" checked={doc.features.marginRule} onChange={(v) => set('features', { ...doc.features, marginRule: v })} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            The guilloché is drawn from this document&rsquo;s reference, so no two carry the
            same one. It stands in for the watermark when none is uploaded, and for the
            seal when there is no seal.
          </p>
        </Card>

        <Card
          title="Typeface"
          description="Families already on the reader's machine — nothing is fetched, so the preview, the PDF and the print all match."
        >
          <Field label="Document face">
            <Select value={doc.typeface} onChange={(e) => set('typeface', e.target.value)}>
              {Object.entries(TYPEFACES).map(([key, t]) => (
                <option key={key} value={key}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {typefaceFor(doc.typeface).note}
          </p>
          {/* Set in the face itself, so the choice is made by looking rather
              than by reading its name. */}
          <p
            className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800"
            style={{ fontFamily: typefaceFor(doc.typeface).body }}
          >
            We write to confirm the position recorded on our register as at
            31 March 2026 — reference {doc.reference || 'ABC-260804-1234'}.
          </p>
        </Card>

        <Card title="Foil" description="The band under the letterhead, with the issuer struck into it.">
          <Field label="Finish">
            <Select value={doc.foil} onChange={(e) => set('foil', e.target.value)}>
              {Object.entries(FOILS).map(([key, v]) => (
                <option key={key} value={key}>{v.label}</option>
              ))}
            </Select>
          </Field>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{foilFor(doc.foil).note}</p>

          {/* The swatch is the real gradient, not an approximation of it. */}
          <div
            className="mt-3 h-6 rounded"
            style={{
              background: `linear-gradient(100deg, ${foilFor(doc.foil).stops.join(', ')})`,
              border: `1px solid ${foilFor(doc.foil).edge}`,
            }}
            aria-hidden="true"
          />

          <div className="mt-4">
            <Toggle
              label="Draw the foil strip"
              checked={doc.features.holoStrip}
              onChange={(v) => set('features', { ...doc.features, holoStrip: v })}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            A foil shifts colour with the viewing angle and paper cannot, so what prints
            is that band seen from one angle. It is a printing convention — nothing on the
            document claims the strip was checked, because nothing checks it.
          </p>
        </Card>

        <Card title="Printed furniture" description="The standing wording around the letter.">
          <div className="space-y-4">
            <Field label="Header label" hint="Top right, above the reference block.">
              <Input value={doc.headerLabel} onChange={(e) => set('headerLabel', e.target.value)} />
            </Field>
            <Field label="Addressee note" hint="Beside the classification.">
              <Input value={doc.addresseeNote} onChange={(e) => set('addresseeNote', e.target.value)} />
            </Field>
            <Field
              label="Foot of page"
              hint="What the document is not. On anything touching money this is the line that stops it being presented as something else."
            >
              <Input value={doc.footerNote} onChange={(e) => set('footerNote', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Version">
                <Input value={doc.version} onChange={(e) => set('version', e.target.value)} className="font-mono" />
              </Field>
              <Field label="Revision">
                <Input value={doc.revision} onChange={(e) => set('revision', e.target.value)} className="font-mono" />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Sheet ────────────────────────────────────────────────────────── */}
      <div>
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <Button onClick={issue} loading={busy === 'issue'} disabled={!doc.reference}>
            {issued ? 'Re-issue' : 'Issue and record'}
          </Button>
          <Button variant="secondary" onClick={saveDraft} loading={busy === 'save'}>
            {savedDraftId ? 'Update draft' : 'Save draft'}
          </Button>
          {/*
            Writes the .pdf itself rather than handing the job to the print
            dialog. The dialog's destination is whatever the machine last used,
            and on Windows that is often "Microsoft XPS Document Writer" — which
            produces a .xps the operating system then refuses to preview. See
            lib/pdf for the resolution trade this makes instead.
          */}
          <Button onClick={savePdf} loading={busy === 'pdf'} disabled={!issued || !!mismatch}>
            Download PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={!issued || !!mismatch}>
            Print
          </Button>
          <span className="text-xs text-slate-500">
            Print keeps the text as text — pick &ldquo;Save as PDF&rdquo; there, not
            &ldquo;XPS Document Writer&rdquo;.
          </span>
        </div>

        <div className="no-print mb-4">
          {issued ? (
            mismatch ? (
              <Banner>
                The document has been edited since it was recorded. Re-issue before printing,
                or the fingerprint on the paper will not match the one on the register.
              </Banner>
            ) : (
              <Banner tone="success">
                <div>Recorded on the register as <Mono>{issued.reference}</Mono>.</div>
                <div className="mt-1 text-xs">
                  A scan now resolves to{' '}
                  <a
                    href={verifyUrl(slug, issued.reference)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {verifyUrl(slug, issued.reference)}
                  </a>
                </div>
              </Banner>
            )
          ) : (
            <Banner tone="info">
              Not yet recorded. Until this is issued, a scan of its code reports that the
              reference is unknown — so issue before printing, not after.
            </Banner>
          )}
        </div>

        {/* The foot of the sheet says "Page 1 of 1". If the body has pushed it
            onto a second page that line is no longer true, and the fix is the
            author's to make — so it is said plainly rather than absorbed. */}
        {pages > 1 && (
          <div className="no-print mb-4">
            <Banner>
              This letter now runs to {pages} pages, and the foot of the sheet still reads
              &ldquo;Page 1 of 1&rdquo;. Shorten the body, or trim the address, before printing.
            </Banner>
          </div>
        )}

        <div ref={sheetRef}>
        <Preview onPages={setPages}>
          <DocumentSheet
            organisation={org}
            draft={doc}
            reference={doc.reference}
            documentId={print.documentId}
            fingerprint={print.fingerprint}
            authorizationId={print.authorizationId}
            generatedAt={issued ? issued.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' : undefined}
            signatureImage={chosen?.signature}
          />
        </Preview>
        </div>
      </div>
    </div>
  );
}

/**
 * Scales the sheet to the column it is in.
 *
 * The sheet is laid out in millimetres and must stay that way — reflowing it to
 * fit a narrow window would make the preview a preview of a different document.
 * So it is scaled with a transform instead, and the wrapper is given the height
 * the scaled sheet actually occupies, because a transform does not affect
 * layout and the page would otherwise reserve room for the full-size original.
 */
/** 210×297mm at 96dpi — the sheet's own size in CSS pixels. */
const A4_W = 793.7;
const A4_H = 1122.5;

function Preview({ children, onPages }: {
  children: React.ReactNode;
  /** Reports how many A4 pages the sheet currently runs to. */
  onPages?: (pages: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(A4_H);

  useLayoutEffect(() => {
    const outer = box.current;
    if (!outer) return;

    /*
     * The wrapper is given the height the *measured* sheet occupies, not the
     * height of one page.
     *
     * A transform does not affect layout, so the wrapper has to be told how
     * tall the scaled sheet is. Assuming A4 was wrong: a letter whose body runs
     * long makes the sheet taller than one page, and a wrapper pinned to 1122px
     * with overflow hidden silently guillotines whatever is below the fold —
     * which is the footer, so the first casualties are the verification panel
     * and the QR code.
     */
    const measure = () => {
      setScale(Math.min(1, outer.clientWidth / A4_W));
      /* offsetHeight, not getBoundingClientRect — the sheet sits inside the
         transformed wrapper, so its rect is already scaled and feeding that
         back in would compound the scale on every pass. */
      const sheet = outer.querySelector<HTMLElement>('.sheet');
      if (sheet) setHeight(sheet.offsetHeight);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    const sheet = outer.querySelector('.sheet');
    if (sheet) observer.observe(sheet);
    return () => observer.disconnect();
    /* Mounted once. Every subsequent change — the column resizing, the body
       growing by a paragraph — arrives through the observer, which is cheaper
       than re-measuring on each render and cannot feed itself. */
  }, []);

  useEffect(() => {
    onPages?.(Math.max(1, Math.ceil(height / A4_H - 0.02)));
  }, [height, onPages]);

  return (
    <div ref={box}>
      <div style={{ height: `${height * scale}px` }} className="sheet-fit">
        {/* sheet-scale, so the print stylesheet drops the transform — a scaled
            sheet would print at 70% on an A4 page. */}
        <div
          className="sheet-scale"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${A4_W}px` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
