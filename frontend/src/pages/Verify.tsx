import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi } from '../lib/api';
import { groupHex } from '../lib/fingerprint';
import { dateTime, longDate } from '../lib/format';
import type { DocumentStatus, PortalOrganisation } from '../lib/types';
import { Mono, PageSpinner, STATUS_LABEL } from '../components/ui';

/**
 * The verification portal.
 *
 * Where a scanned code lands, and the only page in this application a recipient
 * will ever see. It renders in the issuing organisation's identity, because
 * somebody who scans a code should see the institution that wrote to them
 * rather than the platform that generated the page.
 *
 * ── What this page is careful not to say ──────────────────────────────────
 *
 * It never receives the document. It cannot compare the paper in someone's hand
 * to anything, so it does not say "verified", "authentic", or "unaltered" — each
 * of those names an operation that does not happen here, and a recipient who
 * later learned that would be right to feel misled.
 *
 * What it can do is show what the issuer recorded, and hand the reader the
 * fingerprint so the comparison is one they make themselves. That is a smaller
 * claim and a true one, and it is set at the same visual weight a grander claim
 * would have had.
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

const STATUS_NOTE: Record<DocumentStatus, string> = {
  ACTIVE: 'The issuer has this reference on their register and has not withdrawn it.',
  PENDING: 'This reference is on the register but has not been issued yet.',
  EXPIRED: 'This reference has passed the date the issuer set for it.',
  REVOKED: 'The issuer has withdrawn this reference. Contact them before acting on the document.',
};

const STATUS_COLOR: Record<DocumentStatus, string> = {
  ACTIVE: '#047857',
  PENDING: '#B45309',
  EXPIRED: '#475569',
  REVOKED: '#B91C1C',
};

export default function Verify() {
  const { slug = '', reference = '' } = useParams();
  const [state, setState] = useState<Response | null>(null);

  useEffect(() => {
    publicApi<Response>(`/verify/${encodeURIComponent(slug)}/${encodeURIComponent(reference)}`)
      .then(setState)
      .catch((err) => setState({ found: false, reference, error: err.message }));
  }, [slug, reference]);

  if (!state) return <PageSpinner />;

  const org = state.organisation;
  const accent = org?.accentColor || '#334155';
  const ink = org?.inkColor || '#1B2733';

  return (
    <div className="min-h-full bg-slate-100 px-4 py-10" style={{ color: ink }}>
      <div className="mx-auto max-w-2xl">
        {/* Letterhead. The organisation's, not the platform's. */}
        <header className="mb-6 flex items-center gap-4">
          {org?.logo
            ? <img src={org.logo} alt={org.name} className="max-h-14 max-w-[12rem] object-contain" />
            : <div className="text-xl font-serif" style={{ color: accent }}>{org?.name || 'Verification'}</div>}
          {org?.logo && (
            <div className="text-xs uppercase tracking-[0.16em] opacity-60">{org.legalName}</div>
          )}
        </header>

        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <div style={{ height: '4px', background: accent }} />

          {state.found && state.document ? (
            <Found doc={state.document} org={org!} accent={accent} />
          ) : (
            <NotOnRegister reference={state.reference || reference} org={org} accent={accent} error={state.error} />
          )}
        </div>

        {org && (
          <footer className="mt-6 text-center text-xs leading-relaxed text-slate-500">
            <div>{org.legalName || org.name}</div>
            {[org.addressLine1, org.addressLine2, org.country].filter(Boolean).join(', ') && (
              <div>{[org.addressLine1, org.addressLine2, org.country].filter(Boolean).join(', ')}</div>
            )}
            {org.supportEmail && (
              <div className="mt-1">
                <a href={`mailto:${org.supportEmail}`} className="underline underline-offset-2" style={{ color: accent }}>
                  {org.supportEmail}
                </a>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function Found({ doc, org, accent }: { doc: Doc; org: PortalOrganisation; accent: string }) {
  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{STATUS_LABEL[doc.status]}</h1>
        <Mono className="text-sm opacity-70">{doc.reference}</Mono>
      </div>

      <p className="mt-1 text-sm" style={{ color: STATUS_COLOR[doc.status] }}>
        {STATUS_NOTE[doc.status]}
      </p>
      {doc.statusReason && (
        <p className="mt-2 rounded bg-slate-50 p-3 text-sm text-slate-700">{doc.statusReason}</p>
      )}

      <h2 className="mt-8 text-xs font-medium uppercase tracking-wide text-slate-500">
        What {org.name} recorded
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Compare this against the document in front of you. Anything that differs is worth
        a call before you act on it.
      </p>

      <dl className="mt-4 divide-y divide-slate-100 text-sm">
        <Row label="Document">{doc.documentTitle || '—'}</Row>
        <Row label="Issued to">{doc.recipientName || '—'}</Row>
        <Row label="Subject">{doc.subject || '—'}</Row>
        <Row label="Classification">{doc.classification || '—'}</Row>
        <Row label="Department">{doc.department || '—'}</Row>
        <Row label="Signed by">
          {doc.signerName || '—'}
          {doc.signerTitle && <span className="block text-xs text-slate-500">{doc.signerTitle}</span>}
        </Row>
        <Row label="Issued on">{longDate(doc.issuedOn) || '—'}</Row>
        <Row label="Authorisation"><Mono className="text-xs">{doc.authorizationId || '—'}</Mono></Row>
      </dl>

      {/* ── Fingerprint ───────────────────────────────────────────────────
          The one part of this page that is a check rather than a comparison,
          and it is a check the reader performs. Said plainly, because a reader
          who thinks the site already did it will not do it. */}
      <h2 className="mt-8 text-xs font-medium uppercase tracking-wide text-slate-500">Fingerprint</h2>
      <p className="mt-1 text-sm text-slate-600">
        This is computed from the fields above. The document you are holding prints the
        same run of characters at its foot — if the two match, the details on the paper are
        the details on the register.
      </p>
      <div className="mt-3 rounded-md bg-slate-900 px-4 py-3">
        <Mono className="block break-all text-xs leading-relaxed text-emerald-300">
          {groupHex(doc.fingerprint.slice(0, 32))}
        </Mono>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {org.name} never sends the text of a document to this page, so this page cannot
        check the wording for you — only you can see both.
      </p>

      <h2 className="mt-8 text-xs font-medium uppercase tracking-wide text-slate-500">History</h2>
      <dl className="mt-2 divide-y divide-slate-100 text-sm">
        <Row label="Recorded">{dateTime(doc.recordedAt)}</Row>
        <Row label="Previous lookup">
          {doc.lastVerifiedAt
            ? <>{dateTime(doc.lastVerifiedAt)} <span className="text-xs text-slate-500">({doc.verifyCount} in total)</span></>
            : <span className="text-slate-500">This is the first time this reference has been looked up.</span>}
        </Row>
      </dl>

      {org.supportEmail && (
        <p className="mt-8 text-sm text-slate-600">
          Something here does not match?{' '}
          <a href={`mailto:${org.supportEmail}?subject=Document ${doc.reference}`} className="underline underline-offset-2" style={{ color: accent }}>
            Contact {org.name}
          </a>{' '}
          and quote <Mono className="text-xs">{doc.reference}</Mono>.
        </p>
      )}
    </div>
  );
}

/**
 * The most useful answer this endpoint gives, and the one most likely to be
 * read by somebody who has been sent a forgery. It gets a proper page, in the
 * organisation's identity, rather than an error.
 */
function NotOnRegister({ reference, org, accent, error }: {
  reference: string; org?: PortalOrganisation; accent: string; error?: string;
}) {
  return (
    <div className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold">Not on the register</h1>
      <p className="mt-2 text-sm text-slate-600">
        {org
          ? <>{org.name} has no record of the reference <Mono className="text-xs">{reference}</Mono>.</>
          : <>No organisation on this platform matches that link.</>}
      </p>

      <div className="mt-6 space-y-3 text-sm text-slate-600">
        <p>
          References are short and are read off paper, so the likeliest explanation is a
          typing slip — check the characters again, particularly 0 against O and 1 against I.
        </p>
        <p>
          If the reference is right as printed, the document was not issued by
          {org ? ` ${org.name}` : ' this organisation'}, or it has been removed from the
          register. Either is worth a call before acting on it.
        </p>
        {error && <p className="text-xs text-slate-400">{error}</p>}
      </div>

      {org?.supportEmail && (
        <p className="mt-6 text-sm">
          <a href={`mailto:${org.supportEmail}?subject=Reference ${reference}`} className="underline underline-offset-2" style={{ color: accent }}>
            Contact {org.name}
          </a>
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
