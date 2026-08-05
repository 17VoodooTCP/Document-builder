import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { qrDataUrl } from '../lib/qr';
import Coin from '../components/Coin';
import LetterGlitch from '../components/LetterGlitch';
import { Banner, Button, Mono, PageSpinner, Spinner } from '../components/ui';

/**
 * Paying for access.
 *
 * ── The wording rule, applied to money ────────────────────────────────────
 *
 * The same rule that governs the documents governs this page. "Payment
 * verified" names an operation; until a transfer of the right amount has met
 * the confirmation threshold, that operation has not happened, and saying so
 * early is the one thing a customer could later hold against the operator.
 *
 * So the states are named for what is true. Waiting. Seen on the network, with
 * a confirmation count. Confirmed. And — the one most systems hide — a payment
 * that arrived for the wrong amount, reported with the figure that actually
 * turned up rather than silently ignored.
 */

type Status = 'PENDING' | 'SEEN' | 'CONFIRMED' | 'EXPIRED' | 'MISMATCH';
type Asset = 'BTC' | 'USDT';

interface Invoice {
  id: string;
  asset: Asset;
  chain: string;
  network: string;
  address: string;
  amount: string;
  priceCents: number;
  rate: string;
  status: Status;
  statusDetail: string | null;
  txid: string | null;
  confirmations: number;
  requiredConfirmations: number;
  received: string | null;
  expiresAt: string;
  confirmedAt: string | null;
  /** Uploaded by the operator. When present it replaces the generated code,
      because theirs may carry a memo or payment id that ours would drop. */
  qrImage: string | null;
}

interface Config {
  priceCents: number;
  headline?: string;
  note?: string;
  unlocked: boolean;
  assets: { asset: Asset; label: string; network: string; available: boolean }[];
}

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function Unlock() {
  const { user, loading, reload } = useAuth();
  const navigate = useNavigate();

  const [config, setConfig] = useState<Config | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);

  useEffect(() => {
    api<Config>('/payments/config')
      .then(setConfig)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load payment options.'));
  }, []);

  /* A payment URI, so a phone wallet fills in both fields itself. Mistyping an
     address by hand is the most expensive error available on this page. */
  useEffect(() => {
    if (!invoice) { setQr(null); return; }
    if (invoice.qrImage) { setQr(invoice.qrImage); return; }
    const uri = invoice.asset === 'BTC'
      ? `bitcoin:${invoice.address}?amount=${invoice.amount}`
      : invoice.address;
    let live = true;
    qrDataUrl(uri, 420).then((u) => { if (live) setQr(u); }).catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [invoice]);

  const poll = useCallback(async (id: string) => {
    try {
      const res = await api<{ payment: Invoice; unlocked?: boolean; warning?: string }>(`/payments/${id}`);
      setInvoice(res.payment);
      setWarning(res.warning || '');
      if (res.payment.status === 'CONFIRMED') {
        /* Refresh the session so the guard sees the unlock without a sign-out. */
        await reload().catch(() => {});
        return true;
      }
    } catch {
      /* A failed poll is not a failed payment. Left silent; the next tick
         retries, and the invoice on screen is unchanged. */
    }
    return false;
  }, [reload]);

  /* Polled rather than pushed. A websocket for a page somebody watches for two
     minutes is a connection to keep alive, a proxy to configure and a
     reconnection path to get wrong, for no gain over a request every five
     seconds. */
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!invoice || invoice.status === 'CONFIRMED' || invoice.status === 'EXPIRED') return;
    timer.current = window.setInterval(() => {
      poll(invoice.id).then((done) => { if (done) window.clearInterval(timer.current); });
    }, 5000);
    return () => window.clearInterval(timer.current);
  }, [invoice, poll]);

  async function raise(chosen: Asset) {
    setBusy(true);
    setError('');
    setAsset(chosen);
    try {
      const res = await api<{ payment: Invoice }>('/payments/invoice', {
        method: 'POST', body: { asset: chosen },
      });
      setInvoice(res.payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not raise an invoice.');
      setAsset(null);
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, what: 'address' | 'amount') {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(what); window.setTimeout(() => setCopied(null), 1600); },
      () => setError('Could not copy — select the text and copy it by hand.'),
    );
  }

  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.unlockedAt) return <Navigate to="/organisations" replace />;

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-14">
      <div className="absolute inset-0" aria-hidden="true">
        <LetterGlitch glitchSpeed={70} centerVignette outerVignette={false} smooth />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-6">
          <Coin asset="BTC" size={96} />
          <Coin asset="USDT" size={96} />
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            {config?.headline || 'Unlock Document Builder'}
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            {config ? `${money(config.priceCents)} once. Not a subscription.` : 'Loading…'}
          </p>
          {config?.note && <p className="mt-2 text-xs text-slate-400">{config.note}</p>}
        </div>

        <div className="rounded-lg bg-white p-6 shadow-2xl ring-1 ring-black/20">
          {error && <div className="mb-4"><Banner>{error}</Banner></div>}

          {!config ? <PageSpinner />
            : !invoice ? <Choose config={config} onPick={raise} busy={busy} picked={asset} />
              : <Pay
                  invoice={invoice}
                  qr={qr}
                  warning={warning}
                  copied={copied}
                  onCopy={copy}
                  onContinue={() => navigate('/organisations')}
                  onRestart={() => { setInvoice(null); setAsset(null); }}
                />}
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
          Verification pages stay free and always will. Anyone holding a document you
          issued can check its reference without an account, and without paying.
        </p>
      </div>
    </div>
  );
}

/* ── Choosing ─────────────────────────────────────────────────────────────── */

function Choose({ config, onPick, busy, picked }: {
  config: Config; onPick: (a: Asset) => void; busy: boolean; picked: Asset | null;
}) {
  return (
    <div>
      <p className="text-sm text-slate-600">
        One payment, one account, no expiry. Choose what to pay with.
      </p>

      <div className="mt-4 space-y-3">
        {config.assets.map((a) => (
          <button
            key={a.asset}
            type="button"
            disabled={!a.available || busy}
            onClick={() => onPick(a.asset)}
            className="flex w-full items-center gap-4 rounded-lg p-3 text-left ring-1 ring-slate-200 transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
          >
            <Coin asset={a.asset} size={44} spin={false} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900">
                {a.label} <span className="text-slate-400">({a.asset})</span>
              </span>
              <span className="block text-xs text-slate-500">
                {a.available ? a.network : 'Not accepted yet'}
              </span>
            </span>
            {busy && picked === a.asset
              ? <Spinner className="h-4 w-4 text-slate-400" />
              : <span className="text-slate-300" aria-hidden="true">→</span>}
          </button>
        ))}
      </div>

      {/* Stated before they commit, not after. Sending on the wrong network is
          the one mistake on this page nobody can undo. */}
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Tether is accepted on <strong>Tron (TRC-20)</strong> only — it is the cheapest
        network every exchange will actually let you withdraw to. USDT sent on Ethereum,
        BNB Chain or any other network will not arrive here and cannot be recovered.
      </p>
    </div>
  );
}

/* ── Paying ───────────────────────────────────────────────────────────────── */

const STATE: Record<Status, { title: string; tone: 'info' | 'success' | 'error'; note: string }> = {
  PENDING: {
    title: 'Waiting for your payment',
    tone: 'info',
    note: 'Nothing has arrived yet. This page checks the network every few seconds.',
  },
  SEEN: {
    title: 'Payment seen on the network',
    tone: 'info',
    note: 'Your transfer is on the chain and is waiting to be confirmed. Keep this page open.',
  },
  CONFIRMED: {
    title: 'Payment confirmed',
    tone: 'success',
    note: 'Your account is unlocked.',
  },
  EXPIRED: {
    title: 'This quote has expired',
    tone: 'error',
    note: 'The exchange rate it was based on has moved on. Start again for a fresh figure — and if you already sent the payment, it is still on the chain and can be settled by hand.',
  },
  MISMATCH: {
    title: 'The amount did not match',
    tone: 'error',
    note: '',
  },
};

function Pay({ invoice, qr, warning, copied, onCopy, onContinue, onRestart }: {
  invoice: Invoice;
  qr: string | null;
  warning: string;
  copied: 'address' | 'amount' | null;
  onCopy: (text: string, what: 'address' | 'amount') => void;
  onContinue: () => void;
  onRestart: () => void;
}) {
  const state = STATE[invoice.status] || STATE.PENDING;
  const done = invoice.status === 'CONFIRMED';

  const [left, setLeft] = useState('');
  useEffect(() => {
    if (done || invoice.status === 'EXPIRED') return;
    const tick = () => {
      const ms = new Date(invoice.expiresAt).getTime() - Date.now();
      if (ms <= 0) { setLeft('expired'); return; }
      const m = Math.floor(ms / 60000);
      setLeft(`${m}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [invoice.expiresAt, invoice.status, done]);

  if (done) {
    return (
      <div className="text-center">
        <div className="flex justify-center"><Coin asset={invoice.asset} size={84} /></div>
        <h2 className="mt-4 text-base font-semibold text-slate-900">{state.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{state.note}</p>
        {invoice.txid && (
          <p className="mt-3 break-all text-xs text-slate-400">
            <Mono>{invoice.txid}</Mono>
          </p>
        )}
        <Button onClick={onContinue} className="mt-5 w-full">Go to your organisations</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{state.title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{invoice.network}</p>
        </div>
        {invoice.status !== 'EXPIRED' && (
          <div className="shrink-0 text-right">
            <div className="text-xs text-slate-400">Quote holds for</div>
            <Mono className="text-sm text-slate-700">{left}</Mono>
          </div>
        )}
      </div>

      {warning && <div className="mt-3"><Banner tone="info">{warning}</Banner></div>}

      {invoice.status === 'MISMATCH' || invoice.status === 'EXPIRED' ? (
        <div className="mt-4">
          <Banner>{invoice.statusDetail || state.note}</Banner>
          <Button variant="secondary" onClick={onRestart} className="mt-4 w-full">
            Start again
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-lg bg-white p-2 ring-1 ring-slate-200">
              {qr
                ? <img src={qr} alt="Payment address as a QR code" className="h-32 w-32" />
                : <div className="flex h-32 w-32 items-center justify-center"><Spinner className="h-5 w-5 text-slate-300" /></div>}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <Copyable
                label={`Send exactly — ${invoice.asset}`}
                value={invoice.amount}
                emphasis
                copied={copied === 'amount'}
                onCopy={() => onCopy(invoice.amount, 'amount')}
              />
              <Copyable
                label={`To this ${invoice.network} address`}
                value={invoice.address}
                copied={copied === 'address'}
                onCopy={() => onCopy(invoice.address, 'address')}
              />
            </div>
          </div>

          {/* The amount is not a suggestion, and the reason is worth giving —
              somebody who understands *why* is far likelier to get it right. */}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Send the amount exactly as shown, to the digit. Every invoice shares one
            address, so the amount is the only thing that tells yours apart — a
            transfer for a different figure will not be matched to your account
            automatically. If your wallet deducts its fee from the amount, add the fee
            on top so the figure above is what actually arrives.
          </p>

          <div className="mt-4 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Spinner className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              {state.note}
              {invoice.status === 'SEEN' && (
                <> {invoice.confirmations} of {invoice.requiredConfirmations} confirmation
                  {invoice.requiredConfirmations === 1 ? '' : 's'}.</>
              )}
            </span>
          </div>

          {invoice.txid && (
            <p className="mt-2 break-all text-[11px] text-slate-400"><Mono>{invoice.txid}</Mono></p>
          )}
        </>
      )}
    </div>
  );
}

function Copyable({ label, value, emphasis, copied, onCopy }: {
  label: string; value: string; emphasis?: boolean; copied: boolean; onCopy: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        className={`mt-1 break-all rounded-md bg-slate-50 px-3 py-2 font-mono ring-1 ring-inset ring-slate-200 ${
          emphasis ? 'text-base font-semibold text-slate-900' : 'text-xs text-slate-700'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
