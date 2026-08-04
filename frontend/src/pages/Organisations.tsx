import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Organisation, Role } from '../lib/types';
import { Banner, Button, Card, Empty, Field, Input, PageSpinner } from '../components/ui';

type Row = Organisation & { role: Role };

const ROLE_COPY: Record<Role, string> = {
  OWNER: 'Owner — identity, signatories and issuing',
  ISSUER: 'Issuer — may issue documents',
  VIEWER: 'Viewer — may read the register',
};

/** Slugs are permanent and public, so the field is derived and then left alone
    the moment somebody edits it by hand. */
const slugify = (s: string) =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function Organisations() {
  const { user, logout, reload } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ organisations: Row[] }>('/organisations')
      .then((r) => setRows(r.organisations))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load your organisations.');
        setRows([]);
      });
  }, []);

  if (rows === null) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Organisations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Signed in as {user?.name} ({user?.email}).
          </p>
        </div>
        <Button variant="ghost" onClick={() => logout().then(() => navigate('/login'))}>
          Sign out
        </Button>
      </header>

      {error && <div className="mb-6"><Banner>{error}</Banner></div>}

      {rows.length === 0 ? (
        <Empty title="You do not belong to an organisation yet.">
          Create one below, or ask an owner to add you to theirs. Until then there is
          nothing to see — authority here is per organisation, so an account on its own
          holds none.
        </Empty>
      ) : (
        <ul className="mb-8 space-y-2">
          {rows.map((o) => (
            <li key={o.id}>
              <Link
                to={`/o/${o.slug}`}
                className="flex items-center gap-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-inset ring-black/5"
                  style={{ background: o.logo ? '#fff' : o.accentColor }}
                >
                  {o.logo
                    ? <img src={o.logo} alt="" className="max-h-9 max-w-9 object-contain" />
                    : <span className="text-sm font-semibold text-white">{o.name.slice(0, 1).toUpperCase()}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{o.name}</span>
                  <span className="block truncate text-xs text-slate-500">{ROLE_COPY[o.role]}</span>
                </span>
                <span className="font-mono text-xs text-slate-400">/{o.slug}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating
        ? <CreateForm
            onCancel={() => setCreating(false)}
            onCreated={async (slug) => { await reload(); navigate(`/o/${slug}/settings`); }}
          />
        : <Button variant="secondary" onClick={() => setCreating(true)}>Create an organisation</Button>}
    </div>
  );
}

function CreateForm({ onCancel, onCreated }: {
  onCancel: () => void; onCreated: (slug: string) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ organisation: Organisation }>('/organisations', {
        method: 'POST',
        body: { name, slug: effectiveSlug, legalName: legalName || name },
      });
      await onCreated(res.organisation.slug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that organisation.');
      setBusy(false);
    }
  }

  return (
    <Card title="New organisation" description="You will be its owner. The rest of the identity is set afterwards.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner>{error}</Banner>}

        <Field label="Name" hint="How it is referred to conversationally.">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Northwind Trust" />
        </Field>

        <Field
          label="Slug"
          hint="Appears in every verification link, and cannot be changed afterwards — codes already printed would stop resolving."
        >
          <Input
            value={effectiveSlug}
            onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
            required
            minLength={3}
            className="font-mono"
            placeholder="northwind-trust"
          />
        </Field>

        <Field label="Legal name" hint="Used in document footers and legal copy. Defaults to the name above.">
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Northwind Trust Limited" />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={!name || effectiveSlug.length < 3}>Create</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
