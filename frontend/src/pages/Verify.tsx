import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi } from '../lib/api';
import { dateTime, longDate } from '../lib/format';
import type { DocumentStatus, PortalOrganisation } from '../lib/types';
import { Mono, PageSpinner, STATUS_LABEL } from '../components/ui';
import { Barcode, Lockup, checkCode, useVerifyQr } from '../components/DocKit';

/**
 * The verification portal — where a scanned code lands.
 *
 * Built around the one comparison that means something: the reader types the
 * check code printed on their paper, and the page tells them at once whether
 * it is the code the issuer recorded. Around that, what the issuer recorded,
 * in the issuer's own identity.
 *
 * ── What this page is careful not to say ──────────────────────────────────
 *
 * It never receives the document, so it never says "authentic" or
 * "unaltered". It reports what is on the register; the match is the reader's
 * own comparison of their paper against it, and is worded as exactly that.
 *
 * The check code is not a secret — anyone holding the reference can look it
 * up here. A match therefore shows the paper carries the registered code, not
 * that the rest of the paper is unchanged, and the page says so.
 */

interface Doc {
  reference: string;
  verificationId: string;
  fingerprint: string;
  documentTitle: string;
  recipientName: string;
  subject: string;
  department: string;
  classification: string;
  signerName: string;
  signerTitle: string;
  authorizationId: string;
  issuedOn: string;
  status: DocumentStatus;
  statusReason: string | null;
  generatedAt: string;
  recordedAt: string;
  lastVerifiedAt: string | null;
  verifyCount: number;
}

interface Response {
  found: boolean;
  reference?: string;
  organisation?: PortalOrganisation;
  document?: Doc;
  error?: string;
}

const STATUS: Record<DocumentStatus, { color: string; note: string }> = {
  ACTIVE: { color: '#047857', note: 'Issued, recorded on the register, and not withdrawn.' },
  PENDING: { color: '#B45309', note: 'On the register, but not issued yet.' },
  EXPIRED: { color: '#475569', note: 'Past the date the issuer set for it.' },
  REVOKED: { color: '#B91C1C', note: 'Withdrawn by the issuer. Contact them before acting on it.' },
};

export default function Verify() {
  const { slug = '', reference = '' } = useParams();
  const [state, setState] = useState<Response | null>(null);

  useEffect(() => {
    publicApi<Response>(`/verify/${encodeURIComponent(slug)}/${encodeURIComponent(reference)}`)
      .then(setState)
      .catch((err) => setState({ found: false, reference, error: err.message }));
  }, [slug, reference]);

  useEffect(() => {
    const name = state?.organisation?.name;
    document.title = name ? `Document check — ${name}` : 'Document check';
  }, [state]);

  if (!state) return <PageSpinner />;

  const org = state.organisation;
  const accent = org?.accentColor || '#334155';
  const ink = org?.inkColor || '#1B2733';
  const doc = state.found ? state.document : undefined;

  return (
    <div className="min-h-full bg-[#F4F5F7]" style={{ color: ink }}>
      {/* Identity bar: the organisation's own colour and mark. */}
      <div style={{ height: '5px', background: accent }} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          {org ? <Lockup org={org} /> : <span className="text-lg font-bold">Document check</span>}
          <div className="sm:text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Document check</div>
            <Mono className="text-sm font-semibold">{state.reference || reference}</Mono>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        {doc && org
          ? <Found doc={doc} org={org} accent={accent} />
          : <NotOnRegister reference={state.reference || reference} org={org} accent={accent} error={state.error} />}
      </main>

      {org && (
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-4 px-5 py-6 text-xs leading-relaxed text-slate-500 sm:px-8">
            <div>
              <div className="font-semibold text-slate-700">{org.legalName || org.name}</div>
              <div>{[org.addressLine1, org.addressLine2, org.country].filter(Boolean).join(', ')}</div>
              {org.registrationNumber && <div>Registered no. {org.registrationNumber}</div>}
            </div>
            <div className="text-right">
              {org.supportEmail && (
                <a href={`mailto:${org.supportEmail}`} className="font-medium underline underline-offset-2" style={{ color: accent }}>{org.supportEmail}</a>
              )}
              {org.phone && <div>{org.phone}</div>}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function Found({ doc, org, accent }: { doc: Doc; org: PortalOrganisation; accent: string }) {
  const s = STATUS[doc.status];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {/* ── Verdict ─────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start gap-4 p-6 sm:p-7">
            <span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: `${s.color}14`, color: s.color }}>
              <StatusIcon status={doc.status} />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: s.color }}>{STATUS_LABEL[doc.status]}</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">
                {doc.documentTitle || 'Document'} recorded by {org.name}
              </h1>
              <p className="mt-1.5 text-[15px] text-slate-600">{s.note}</p>
              {doc.statusReason && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{doc.statusReason}</p>}
            </div>
          </div>
          <CodeMatch code={checkCode(doc.fingerprint)} accent={accent} />
        </section>

        {/* ── The record ──────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">What {org.name} recorded</h2>
          <p className="mt-1 text-sm text-slate-600">Every line should match the paper in your hand.</p>
          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <Item label="Issued to">{doc.recipientName || '—'}</Item>
            <Item label="Date of issue">{longDate(doc.issuedOn) || '—'}</Item>
            <Item label="Subject" wide>{doc.subject || '—'}</Item>
            <Item label="Signed by">
              {doc.signerName || '—'}
              {doc.signerTitle && <span className="block text-xs font-normal text-slate-500">{doc.signerTitle}</span>}
            </Item>
            <Item label="Marking">{doc.classification || '—'}</Item>
            {doc.department && <Item label="Department">{doc.department}</Item>}
            <Item label="Document ID"><Mono className="text-[13px]">{doc.verificationId}</Mono></Item>
          </dl>
        </section>
      </div>

      {/* ── Side: the record card, history, contact ───────────────────── */}
      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <RecordCard doc={doc} org={org} accent={accent} />

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">History</h2>
          <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4">
            <Event title="Issued" when={longDate(doc.issuedOn)} accent={accent} />
            <Event title="Recorded on the register" when={dateTime(doc.recordedAt)} accent={accent} />
            <Event
              title={doc.lastVerifiedAt ? `Looked up ${doc.verifyCount} time${doc.verifyCount === 1 ? '' : 's'} before` : 'First lookup'}
              when={doc.lastVerifiedAt ? `Last ${dateTime(doc.lastVerifiedAt)}` : 'This is the first time this reference has been checked.'}
              accent={accent}
            />
          </ol>
        </section>

        {org.supportEmail && (
          <a
            href={`mailto:${org.supportEmail}?subject=Document ${doc.reference}`}
            className="block rounded-2xl p-5 text-white shadow-sm transition hover:opacity-95"
            style={{ background: accent }}
          >
            <div className="text-sm font-semibold">Something doesn&rsquo;t match?</div>
            <div className="mt-0.5 text-sm opacity-85">Contact {org.name} and quote {doc.reference}.</div>
          </a>
        )}
      </aside>
    </div>
  );
}

/**
 * The comparison. The reader types the code printed on their copy; it is
 * compared, as they type, with the code the register holds. Nothing is sent
 * anywhere — the comparison happens on this page.
 */
function CodeMatch({ code, accent }: { code: string; accent: string }) {
  const [typed, setTyped] = useState('');
  const want = code.replace(/[^0-9A-F]/g, '');
  const got = typed.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
  const pretty = useMemo(() => (got.match(/.{1,4}/g) || []).join(' · '), [got]);
  const done = got.length === 12;
  const match = done && got === want;
  const tone = !done ? null : match ? '#047857' : '#B91C1C';

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 p-6 sm:p-7">
      <label htmlFor="check-code" className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>
        Compare your copy
      </label>
      <p className="mt-1 text-sm text-slate-600">
        Type the <span className="font-semibold">check code</span> printed on the authentication stub at the foot of your document.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          id="check-code"
          value={pretty}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX · XXXX · XXXX"
          className="w-full max-w-[19rem] rounded-xl border bg-white px-4 py-3 font-mono text-xl font-bold uppercase tracking-[0.12em] outline-none transition placeholder:text-slate-300 focus:ring-4"
          style={{ borderColor: tone || '#CBD5E1', ['--tw-ring-color' as string]: `${tone || accent}26` } as React.CSSProperties}
          aria-describedby="check-result"
        />
        <div id="check-result" role="status" className="text-sm font-semibold" style={{ color: tone || '#64748B' }}>
          {!got && 'Waiting for the code'}
          {got && !done && `${12 - got.length} characters to go`}
          {match && '✓ Matches the register'}
          {done && !match && '✕ Does not match — do not rely on this document'}
        </div>
      </div>
      {match && (
        <p className="mt-2 text-xs text-slate-500">
          Your copy carries the code recorded for this reference. Now check the details below against your paper as
          well — a matching code on its own does not show that the rest of the page is unchanged.
        </p>
      )}
      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-700">Can&rsquo;t find the code on your copy?</summary>
        <p className="mt-1.5">
          It is the register&rsquo;s code for this reference: <span className="font-mono font-bold text-slate-700">{code}</span>.
          A genuine copy prints exactly this beside &ldquo;Check code&rdquo;. If your copy has no stub, or a different code, contact the issuer.
        </p>
      </details>
    </div>
  );
}

/** A small facsimile of the paper's own stub: scan code, barcode, reference. */
function RecordCard({ doc, org, accent }: { doc: Doc; org: PortalOrganisation; accent: string }) {
  const qr = useVerifyQr(org.slug, doc.reference, true);
  return (
    <section className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div style={{ height: '6px', background: accent }} />
      {doc.classification && (
        <div className="absolute right-5 top-[6px] rounded-b-md px-2.5 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white" style={{ background: accent }}>
          {doc.classification}
        </div>
      )}
      <div className="p-6 pt-8">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Register entry</div>
        <Mono className="mt-1 block text-lg font-bold">{doc.reference}</Mono>
        <div className="mt-4 flex items-start gap-4">
          {qr && <img src={qr} alt="" className="h-24 w-24 shrink-0 rounded-md ring-1 ring-slate-200" />}
          <dl className="min-w-0 text-xs">
            <dt className="uppercase tracking-[0.14em] text-slate-400">Issued</dt>
            <dd className="mt-0.5 font-semibold">{longDate(doc.issuedOn) || '—'}</dd>
            <dt className="mt-2 uppercase tracking-[0.14em] text-slate-400">Authorisation</dt>
            <dd className="mt-0.5 font-mono font-semibold">{doc.authorizationId || '—'}</dd>
          </dl>
        </div>
        <div className="mt-4 overflow-hidden rounded-md bg-white">
          <Barcode value={doc.reference} height="44px" />
        </div>
      </div>
    </section>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`border-b border-slate-100 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-[15px] font-medium">{children}</dd>
    </div>
  );
}

function Event({ title, when, accent }: { title: string; when: string; accent: string }) {
  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white" style={{ background: accent }} />
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-slate-500">{when}</div>
    </li>
  );
}

function StatusIcon({ status }: { status: DocumentStatus }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (status === 'ACTIVE') return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  if (status === 'REVOKED') return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

/**
 * The most useful answer this page gives, and the one most likely to be read
 * by somebody holding a forgery — so it gets a proper page, not an error.
 */
function NotOnRegister({ reference, org, accent, error }: {
  reference: string; org?: PortalOrganisation; accent: string; error?: string;
}) {
  return (
    <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-4 p-6 sm:p-8">
        <span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
          <StatusIcon status="REVOKED" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Not on the register</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">No record of {reference || 'this reference'}</h1>
          <p className="mt-2 text-[15px] text-slate-600">
            {org ? `${org.name} has nothing on its register under this reference.` : 'No organisation on this platform matches that link.'}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-slate-600">
            <li>• References are read off paper — check for a slip first: 0 against O, 1 against I.</li>
            <li>• If it is right as printed, the document was not issued by {org ? org.name : 'this organisation'}, or has been withdrawn.</li>
            <li>• Either way, contact the issuer before acting on it.</li>
          </ul>
          {error && <p className="mt-4 text-xs text-slate-400">{error}</p>}
          {org?.supportEmail && (
            <a href={`mailto:${org.supportEmail}?subject=Reference ${reference}`} className="mt-6 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: accent }}>
              Contact {org.name}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
