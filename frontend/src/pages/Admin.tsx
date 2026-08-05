import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import Coin from '../components/Coin';
import {
  Banner, Button, Mono, PageSpinner, Spinner, Textarea,
} from '../components/ui';

/**
 * The operator's console.
 *
 * Where the receiving wallets are set. Worth being plain about why that is safe
 * to expose behind a login at all: a receiving address is public by
 * construction — it is the thing handed to somebody so they can pay — and no
 * private key, seed or mnemonic exists anywhere in this application. Nothing
 * reachable from this page can move money. What it can do is change where
 * *future* payments are directed, which is why it is operator-only and why
 * every save records who made it.
 *
 * Addresses are shown in full rather than masked. An address you cannot read is
 * one you cannot check, and a single wrong character sends a customer's payment
 * somewhere neither of you can reach.
 */

interface Settings {
  priceCents: number;
  btcAddress: string;
  usdtTronAddress: string;
  btcQr: string | null;
  usdtQr: string | null;
  offerHeadline: string;
  offerNote: string;
  updatedAt: string;
}

interface Overview {
  counts: {
    users: number; unlocked: number; organisations: number;
    documents: number; openInvoices: number;
  };
  takenCents: number;
  recent: {
    id: string; asset: string; amount: string; priceCents: number;
    txid: string | null; confirmedAt: string; email: string | null;
  }[];
}

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function Admin() {
  const { user, loading } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [effective, setEffective] = useState<Settings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    api<{ settings: Settings; effective: Settings }>('/admin/settings')
      .then((r) => { setSettings(r.settings); setEffective(r.effective); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load settings.'));
    api<Overview>('/admin/overview').then(setOverview).catch(() => {});
  }, [user]);

  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  /* Matching the API, which answers 404 rather than 403 — a console whose
     existence is not advertised is not one people go looking for a way into. */
  if (!user.isPlatformAdmin) return <Navigate to="/organisations" replace />;

  return (
    <div className="min-h-full bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Platform operator
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Console</h1>
          </div>
          <Link to="/organisations" className="text-sm text-slate-400 underline underline-offset-4 hover:text-white">
            Back to workspace
          </Link>
        </header>

        {error && <div className="mb-6"><Banner>{error}</Banner></div>}

        {overview && <Overview data={overview} />}

        {!settings || !effective
          ? <PageSpinner />
          : <Wallets
              settings={settings}
              effective={effective}
              onSaved={(s, e) => { setSettings(s); if (e) setEffective(e); }}
            />}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview({ data }: { data: Overview }) {
  const tiles = [
    { label: 'Accounts', value: data.counts.users },
    { label: 'Paid', value: data.counts.unlocked },
    { label: 'Organisations', value: data.counts.organisations },
    { label: 'Documents issued', value: data.counts.documents },
    { label: 'Open invoices', value: data.counts.openInvoices },
    { label: 'Taken', value: money(data.takenCents) },
  ];

  return (
    <section className="mb-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-800 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-slate-900 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {t.label}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>

      {/* Confirmed only. Anything else would be a projection dressed as revenue. */}
      {data.recent.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg ring-1 ring-slate-800">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-slate-900 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Confirmed</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Paid</th>
                <th className="px-4 py-2 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/60">
              {data.recent.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-300">{dateTime(p.confirmedAt)}</td>
                  <td className="px-3 py-2 text-slate-400">{p.email || '—'}</td>
                  <td className="px-3 py-2"><Mono className="text-xs">{p.amount} {p.asset}</Mono></td>
                  <td className="max-w-[12rem] truncate px-4 py-2">
                    <Mono className="text-xs text-slate-500">{p.txid || '—'}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ── Wallets ──────────────────────────────────────────────────────────────── */

function Wallets({ settings, effective, onSaved }: {
  settings: Settings;
  effective: Settings;
  onSaved: (s: Settings, e?: Settings) => void;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ settings: Settings; effective: Settings }>('/admin/settings', {
        method: 'PUT',
        body: {
          btcAddress: form.btcAddress,
          usdtTronAddress: form.usdtTronAddress,
          priceCents: form.priceCents,
          offerHeadline: form.offerHeadline,
          offerNote: form.offerNote,
        },
      });
      setForm(res.settings);
      onSaved(res.settings, res.effective);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-slate-800">
        <h2 className="text-sm font-semibold">Receiving wallets</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Customer payments land directly in these. This application holds no key that
          could move them — it only watches public explorers for transfers that arrive.
          Check every character: a wrong address sends real money somewhere neither you
          nor the payer can reach.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-5">
          {error && <Banner>{error}</Banner>}
          {saved && <Banner tone="success">Saved. New invoices use these immediately.</Banner>}

          <DarkField
            label="Bitcoin address"
            hint={
              !form.btcAddress && effective.btcAddress
                ? `Blank here — falling back to BTC_ADDRESS: ${effective.btcAddress}`
                : 'Legacy, P2SH or bech32.'
            }
          >
            <DarkInput
              value={form.btcAddress}
              onChange={(e) => set('btcAddress', e.target.value.trim())}
              placeholder="bc1…"
              spellCheck={false}
            />
          </DarkField>

          <DarkField
            label="USDT address — Tron (TRC-20) only"
            hint={
              !form.usdtTronAddress && effective.usdtTronAddress
                ? `Blank here — falling back to USDT_TRON_ADDRESS: ${effective.usdtTronAddress}`
                : 'Begins with T. An address for any other chain will never match, and payments to it are lost.'
            }
          >
            <DarkInput
              value={form.usdtTronAddress}
              onChange={(e) => set('usdtTronAddress', e.target.value.trim())}
              placeholder="T…"
              spellCheck={false}
            />
          </DarkField>

          <DarkField label="Price" hint="What one account pays, once, for permanent access.">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">$</span>
              <DarkInput
                type="number"
                min={0}
                step="1"
                value={String(Math.round(form.priceCents / 100))}
                onChange={(e) => set('priceCents', Math.max(0, Math.round(Number(e.target.value) || 0)) * 100)}
                className="w-32"
              />
              <span className="text-xs text-slate-500">= {money(form.priceCents)}</span>
            </div>
          </DarkField>

          <DarkField label="Headline on the unlock screen" hint="Optional.">
            <DarkInput
              value={form.offerHeadline}
              onChange={(e) => set('offerHeadline', e.target.value)}
              placeholder="Unlock Document Builder"
            />
          </DarkField>

          <DarkField label="Note beneath it" hint="Optional.">
            <Textarea
              rows={2}
              value={form.offerNote}
              onChange={(e) => set('offerNote', e.target.value)}
              className="border-0 bg-slate-950 text-slate-100 ring-1 ring-inset ring-slate-700 placeholder:text-slate-600 focus:ring-slate-400"
            />
          </DarkField>

          <Button type="submit" loading={busy} variant="secondary">Save</Button>
        </form>
      </section>

      <section className="rounded-lg bg-slate-900 p-6 ring-1 ring-slate-800">
        <h2 className="text-sm font-semibold">Payment QR codes</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Optional. A correct code is generated from the address on its own — upload one
          only where your wallet or exchange issues a code carrying something extra a
          generated one would drop, such as a memo or a payment id. The address is
          always printed beneath it so a payer can check the two agree.
        </p>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <QrSlot asset="BTC" value={form.btcQr} onChange={(s) => { setForm(s); onSaved(s); }} />
          <QrSlot asset="USDT" value={form.usdtQr} onChange={(s) => { setForm(s); onSaved(s); }} />
        </div>
      </section>
    </div>
  );
}

function QrSlot({ asset, value, onChange }: {
  asset: 'BTC' | 'USDT'; value: string | null; onChange: (s: Settings) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(dataUrl: string | null) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ settings: Settings }>(`/admin/settings/qr/${asset}`, {
        method: 'PUT', body: { dataUrl },
      });
      onChange(res.settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That upload did not go through.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <Coin asset={asset} size={18} spin={false} /> {asset}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => send(null)}
            disabled={busy}
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-red-400"
          >
            Remove
          </button>
        )}
      </div>

      <div className="mt-2 flex h-40 items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-950 p-2">
        {busy ? <Spinner className="h-5 w-5 text-slate-600" />
          : value ? <img src={value} alt={`${asset} payment QR`} className="max-h-full max-w-full object-contain" />
            : <span className="text-xs text-slate-600">Generated from the address</span>}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 12 * 1024 * 1024) { setError('That image is over 12MB.'); return; }
          const reader = new FileReader();
          reader.onerror = () => setError('That file could not be read.');
          reader.onload = () => send(String(reader.result));
          reader.readAsDataURL(file);
        }}
      />

      <Button
        type="button"
        variant="secondary"
        className="mt-2 w-full"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {value ? 'Replace' : 'Upload'}
      </Button>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/* Dark variants. The console is the one authenticated surface that is not the
   tenant's workspace, and it is styled apart so an operator always knows which
   of the two they are looking at. */
function DarkField({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border-0 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 ring-1 ring-inset ring-slate-700 placeholder:text-slate-600 focus:ring-2 focus:ring-inset focus:ring-slate-400 ${props.className || ''}`}
    />
  );
}
