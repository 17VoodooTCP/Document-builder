import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Organisation, Signatory } from '../lib/types';
import AssetUpload from '../components/AssetUpload';
import {
  Banner, Button, Card, Empty, Field, Input, PageSpinner,
} from '../components/ui';

/**
 * Identity.
 *
 * Everything on this page ends up on paper that leaves the building, which is
 * why it is OWNER-only on both sides. It is also the page where the difference
 * between tenants actually lives: the renderer has no opinions of its own, so a
 * document looks like this organisation's precisely to the extent that this
 * form has been filled in.
 */
export default function Settings() {
  const { slug = '' } = useParams();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ organisation: Organisation }>(`/organisations/${slug}`)
      .then((r) => setOrg(r.organisation))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this organisation.'));
  }, [slug]);

  if (error && !org) return <Banner>{error}</Banner>;
  if (!org) return <PageSpinner />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Details org={org} onSaved={setOrg} />
        <Signatories slug={slug} />
      </div>
      <div className="space-y-6">
        <Brand org={org} onChange={setOrg} />
      </div>
    </div>
  );
}

/* ── Details ──────────────────────────────────────────────────────────────── */

function Details({ org, onSaved }: { org: Organisation; onSaved: (o: Organisation) => void }) {
  const [form, setForm] = useState(org);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Organisation>(k: K, v: Organisation[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ organisation: Organisation }>(`/organisations/${org.slug}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          legalName: form.legalName,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          country: form.country,
          supportEmail: form.supportEmail,
          website: form.website,
          phone: form.phone || '',
          tagline: form.tagline || '',
          registrationNumber: form.registrationNumber || '',
          taxNumber: form.taxNumber || '',
          letterhead: form.letterhead || 'auto',
          accentColor: form.accentColor,
          inkColor: form.inkColor,
          referencePrefix: form.referencePrefix,
        },
      });
      onSaved(res.organisation);
      setForm(res.organisation);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save those details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Details" description="Name, address and contact, as they appear in the letterhead.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner>{error}</Banner>}
        {saved && <Banner tone="success">Saved.</Banner>}

        <Field label="Slug" hint="Permanent — it is in every code already printed.">
          <Input value={org.slug} readOnly disabled className="font-mono text-slate-500" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Legal name">
            <Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
          </Field>
        </div>

        <Field label="Address line 1">
          <Input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 2">
            <Input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set('country', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email">
            <Input type="email" value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="northwind.example" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <Input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Tagline" hint="Set under the name in the letterhead.">
            <Input value={form.tagline || ''} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Advisory & Legal" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company registration no." hint="Printed at the foot of every page.">
            <Input value={form.registrationNumber || ''} onChange={(e) => set('registrationNumber', e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Tax / VAT no." hint="Printed on invoices and at the foot of every page.">
            <Input value={form.taxNumber || ''} onChange={(e) => set('taxNumber', e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        <Field label="Letterhead" hint="How your logo and name are set at the top of every document.">
          <div className="grid grid-cols-3 gap-2">
            {([
              ['auto', 'Automatic', 'Name beside a square logo; a wide logo alone'],
              ['lockup', 'Logo + name', 'Always typeset the name beside the logo'],
              ['logo', 'Logo only', 'Your artwork already contains the name'],
            ] as const).map(([value, title, note]) => {
              const on = (form.letterhead || 'auto') === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('letterhead', value)}
                  className={`rounded-lg border p-2.5 text-left transition ${on ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200 hover:border-slate-400'}`}
                >
                  <span className="block text-sm font-medium text-slate-900">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{note}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            label="Accent"
            hint="Rules, labels and the portal's furniture."
            value={form.accentColor}
            onChange={(v) => set('accentColor', v)}
          />
          <ColorField
            label="Ink"
            hint="Body copy. Near-black reads better on paper than black."
            value={form.inkColor}
            onChange={(v) => set('inkColor', v)}
          />
        </div>

        <Field label="Reference prefix" hint={`Produces references like ${(form.referencePrefix || 'DOC').toUpperCase()}-260803-A4F2.`}>
          <Input
            value={form.referencePrefix}
            onChange={(e) => set('referencePrefix', e.target.value.toUpperCase().slice(0, 6))}
            className="font-mono uppercase"
            maxLength={6}
          />
        </Field>

        <Button type="submit" loading={busy}>Save details</Button>
      </form>
    </Card>
  );
}

/** A swatch and a hex field, kept in step. People arrive with a brand hex in
    their clipboard as often as they arrive wanting to pick one. */
function ColorField({ label, hint, value, onChange }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <Field label={label} hint={hint} error={valid ? undefined : 'Needs to be a six-digit hex, e.g. #0F5F5C.'}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label} colour`}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-1"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono uppercase"
          maxLength={7}
        />
      </div>
    </Field>
  );
}

/* ── Brand assets ─────────────────────────────────────────────────────────── */

function Brand({ org, onChange }: { org: Organisation; onChange: (o: Organisation) => void }) {
  return (
    <Card
      title="Brand assets"
      description="Stored on the organisation record and re-encoded on upload, so a 6MB screenshot becomes a few tens of kilobytes."
    >
      <div className="space-y-6">
        <AssetUpload slug={org.slug} kind="logo" value={org.logo} onChange={onChange} />
        <AssetUpload slug={org.slug} kind="watermark" value={org.watermark} onChange={onChange} />
        <AssetUpload slug={org.slug} kind="seal" value={org.seal} onChange={onChange} />
      </div>
    </Card>
  );
}

/* ── Signatories ──────────────────────────────────────────────────────────── */

function Signatories({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Signatory[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ signatories: Signatory[] }>(`/organisations/${slug}/signatories`)
      .then((r) => setRows(r.signatories))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load signatories.');
        setRows([]);
      });
  }
  useEffect(load, [slug]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/organisations/${slug}/signatories`, {
        method: 'POST',
        body: { name, title, department, signature },
      });
      setName(''); setTitle(''); setDepartment(''); setSignature(null);
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that signatory.');
    } finally {
      setBusy(false);
    }
  }

  /*
   * Bulk add: one cropped signature per file, the person's name taken from the
   * filename ("james-carter.png" → "James Carter"). Each name stays editable
   * before anything is saved, and people already on file are skipped so
   * running the same folder twice does not create duplicates.
   */
  const [bulk, setBulk] = useState<{ name: string; signature: string }[] | null>(null);
  const [bulkDone, setBulkDone] = useState(0);

  function nameFromFile(file: string) {
    return file
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  }

  function pickBulk(files: FileList | null) {
    if (!files?.length) return setBulk(null);
    Promise.all(
      Array.from(files).map(
        (file) => new Promise<{ name: string; signature: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: nameFromFile(file.name), signature: String(reader.result) });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
      ),
    )
      .then((list) => setBulk(list.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setError('One of those files could not be read.'));
  }

  const onFile = new Set((rows ?? []).map((s) => s.name.trim().toLowerCase()));
  const toAdd = (bulk ?? []).filter((b) => b.name.trim() && !onFile.has(b.name.trim().toLowerCase()));

  async function addBulk() {
    setBusy(true);
    setError('');
    setBulkDone(0);
    try {
      /* One at a time: each image is re-encoded server-side, and a failure
         should stop at the file that caused it rather than leave a scatter. */
      for (const b of toAdd) {
        await api(`/organisations/${slug}/signatories`, {
          method: 'POST',
          body: { name: b.name.trim(), title: '', department: '', signature: b.signature },
        });
        setBulkDone((n) => n + 1);
      }
      setBulk(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add those signatories.');
      load();
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string, who: string) {
    if (!window.confirm(`Retire ${who}? Documents already issued keep their name — this only removes them from the list of people who can be chosen.`)) return;
    try {
      await api(`/organisations/${slug}/signatories/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not retire that signatory.');
    }
  }

  if (rows === null) return <Card title="Signatories"><PageSpinner /></Card>;

  return (
    <Card
      title="Signatories"
      description="Who may sign. The letter builder only offers staff with their own signature on file."
      actions={!adding && !bulk && (
        <div className="flex gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
            Add from files
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => { pickBulk(e.target.files); e.target.value = ''; }}
            />
          </label>
          <Button variant="secondary" onClick={() => setAdding(true)}>Add</Button>
        </div>
      )}
    >
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}

      {bulk && (
        <div className="mb-4 space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-sm text-slate-600">
            One signature per file. Check each name matches the signature above it, then add.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {bulk.map((b, i) => {
              const dup = onFile.has(b.name.trim().toLowerCase());
              return (
                <li key={i} className="rounded-md border border-slate-100 p-2">
                  <span className="flex h-12 items-center justify-center">
                    <img src={b.signature} alt="" className="max-h-12 max-w-full object-contain" />
                  </span>
                  <Input
                    aria-label="Name"
                    value={b.name}
                    onChange={(e) => setBulk((list) => list!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className="mt-1"
                  />
                  {dup && <span className="text-[11px] text-slate-500">Already on file — will be skipped.</span>}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <Button onClick={addBulk} loading={busy} disabled={!toAdd.length}>
              Add {toAdd.length} {toAdd.length === 1 ? 'signatory' : 'signatories'}
            </Button>
            <Button variant="ghost" onClick={() => setBulk(null)} disabled={busy}>Cancel</Button>
            {busy && <span className="text-xs text-slate-500">{bulkDone} of {toAdd.length}</span>}
          </div>
        </div>
      )}

      {rows.length === 0 && !adding ? (
        <Empty title="No signatories yet.">
          Add each member of staff with their own handwritten signature. Letters
          cannot be issued until at least one is on file.
        </Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0">
              <span className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-slate-50 ring-1 ring-inset ring-slate-200">
                {s.signature
                  ? <img src={s.signature} alt="" className="max-h-7 max-w-14 object-contain" />
                  : <span className="text-[10px] text-slate-400">typed</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-900">{s.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[s.title, s.department].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <Button variant="ghost" onClick={() => retire(s.id, s.name)} className="text-xs">
                Retire
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form onSubmit={add} className="mt-4 space-y-4 border-t border-slate-200 pt-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head of Registry" />
            </Field>
            <Field label="Department">
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
          </div>

          <Field
            label="Signature image"
            hint="Their own handwritten signature. A scan on white is fine — it is re-encoded on the way in. Without one, they will not appear in the letter builder."
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return setSignature(null);
                const reader = new FileReader();
                reader.onload = () => setSignature(String(reader.result));
                reader.readAsDataURL(file);
              }}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!name.trim()}>Add signatory</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
