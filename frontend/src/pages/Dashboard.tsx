import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { atLeast, useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { verifyUrl } from '../lib/qr';
import type { Draft, DocumentStatus, IssuedDocument } from '../lib/types';
import {
  Banner, Button, Card, Empty, Mono, PageSpinner, Select, StatusPill,
} from '../components/ui';

/**
 * The register.
 *
 * What this organisation has issued, in the order it issued it. It is the
 * answer to "did we send this", which is the question somebody is holding a
 * letter and a phone in order to ask.
 */
export default function Dashboard() {
  const { slug = '' } = useParams();
  const { roleAt } = useAuth();
  const role = roleAt(slug);
  const canIssue = atLeast(role, 'ISSUER');

  const [documents, setDocuments] = useState<IssuedDocument[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ documents: IssuedDocument[] }>(`/documents/${slug}`)
      .then((r) => setDocuments(r.documents))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load the register.');
        setDocuments([]);
      });

    /* Drafts are a convenience, not the page. A failure to load them leaves the
       register readable rather than replacing it with an error. */
    api<{ drafts: Draft[] }>(`/documents/${slug}/drafts`)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDrafts([]));
  }, [slug]);

  useEffect(load, [load]);

  async function setStatus(reference: string, status: DocumentStatus) {
    const reason = status === 'REVOKED'
      ? window.prompt('Why is this being withdrawn? The portal shows this to anyone who scans it.') ?? ''
      : '';

    try {
      await api(`/documents/${slug}/${encodeURIComponent(reference)}/status`, {
        method: 'PATCH',
        body: { status, reason },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that status.');
    }
  }

  if (documents === null) return <PageSpinner />;

  return (
    <div className="space-y-6">
      {error && <Banner>{error}</Banner>}

      {drafts.length > 0 && canIssue && (
        <Card title="Drafts" description="Working state. Unversioned, and not on the register.">
          <ul className="divide-y divide-slate-100">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-900">{d.title}</span>
                  <span className="block text-xs text-slate-500">
                    {d.kind.toLowerCase()} · saved {dateTime(d.updatedAt)}
                  </span>
                </span>
                <Link
                  to={`/o/${slug}/new?draft=${d.id}`}
                  className="shrink-0 text-sm font-medium text-slate-900 underline underline-offset-2"
                >
                  Resume
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Register"
        description={`${documents.length} document${documents.length === 1 ? '' : 's'} issued.`}
        actions={canIssue && <Link to={`/o/${slug}/new`}><Button>New document</Button></Link>}
      >
        {documents.length === 0 ? (
          <Empty title="Nothing issued yet.">
            {canIssue
              ? 'A document appears here the moment it is exported, and not before — until then a scan of its code can only report that the reference is unknown.'
              : 'Nothing has been issued by this organisation yet.'}
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 pb-2 font-medium">Reference</th>
                  <th scope="col" className="px-3 pb-2 font-medium">Recipient</th>
                  <th scope="col" className="px-3 pb-2 font-medium">Subject</th>
                  <th scope="col" className="px-3 pb-2 font-medium">Standing</th>
                  <th scope="col" className="px-3 pb-2 font-medium">Looked up</th>
                  <th scope="col" className="px-5 pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((d) => (
                  <tr key={d.id} className="align-top">
                    <td className="px-5 py-3">
                      <a
                        href={verifyUrl(slug, d.reference)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-slate-900 underline underline-offset-2"
                      >
                        {d.reference}
                      </a>
                      <div className="mt-0.5 text-xs text-slate-400">{dateTime(d.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{d.recipientName || '—'}</td>
                    <td className="max-w-[16rem] px-3 py-3 text-slate-600">
                      <span className="block truncate">{d.subject || '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={d.status} />
                      {d.statusReason && (
                        <div className="mt-1 max-w-[12rem] text-xs text-slate-500">{d.statusReason}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {d.lastVerifiedAt
                        ? <><Mono>{d.verifyCount ?? 0}×</Mono><div>{dateTime(d.lastVerifiedAt)}</div></>
                        : 'Never'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canIssue && (
                        <Select
                          value={d.status}
                          aria-label={`Standing of ${d.reference}`}
                          onChange={(e) => setStatus(d.reference, e.target.value as DocumentStatus)}
                          className="w-auto py-1 text-xs"
                        >
                          <option value="ACTIVE">In good standing</option>
                          <option value="PENDING">Awaiting issue</option>
                          <option value="EXPIRED">Expired</option>
                          <option value="REVOKED">Withdrawn</option>
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
