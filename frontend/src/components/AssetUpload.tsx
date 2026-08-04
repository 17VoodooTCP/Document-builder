import { useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Organisation } from '../lib/types';
import { Banner, Button, Spinner } from './ui';

/**
 * One brand asset slot.
 *
 * The file is read to a data URL and sent as JSON — the API stores assets on the
 * Organisation row rather than in object storage, and re-encodes everything it
 * receives, so there is no multipart endpoint and no need for one.
 *
 * Nothing is resized here. Doing it on both sides means two pieces of code that
 * have to agree about quality and dimensions, and only one of them is the one
 * that decides what actually gets stored.
 */

type Kind = 'logo' | 'watermark' | 'seal';

const COPY: Record<Kind, { label: string; hint: string; box: string }> = {
  logo: {
    label: 'Logo',
    hint: 'Sits in the letterhead. Transparent PNG or SVG-flattened artwork works best.',
    box: 'h-20 w-full',
  },
  watermark: {
    label: 'Watermark',
    hint: 'Sits behind the body at low opacity. Fine detail survives; heavy blocks of ink do not.',
    box: 'h-32 w-full',
  },
  seal: {
    label: 'Seal',
    hint: 'Struck beside the signature. Kept at print resolution — a seal should reward a magnifier.',
    box: 'h-32 w-full',
  },
};

interface Props {
  slug: string;
  kind: Kind;
  value: string | null;
  onChange: (organisation: Organisation) => void;
  disabled?: boolean;
}

export default function AssetUpload({ slug, kind, value, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[kind];

  async function send(dataUrl: string | null) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ organisation: Organisation }>(
        `/organisations/${slug}/assets/${kind}`,
        { method: 'PUT', body: { dataUrl } },
      );
      onChange(res.organisation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That upload did not go through.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    /* The API refuses over 12MB. Catching it here saves pushing 30MB up a phone
       connection to be told no at the other end. */
    if (file.size > 12 * 1024 * 1024) {
      setError('That image is over 12MB. Please choose a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('That file could not be read.');
    reader.onload = () => send(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {copy.label}
        </span>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => send(null)}
            disabled={busy}
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      <div className={`mt-1.5 flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 ${copy.box}`}>
        {busy
          ? <Spinner className="h-5 w-5 text-slate-400" />
          : value
            ? <img src={value} alt={`${copy.label} preview`} className="max-h-full max-w-full object-contain" />
            : <span className="text-xs text-slate-400">Nothing set</span>}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={busy || disabled}
        >
          {value ? 'Replace' : 'Upload'}
        </Button>
      </div>

      <p className="mt-1.5 text-xs text-slate-500">{copy.hint}</p>
      {error && <div className="mt-2"><Banner>{error}</Banner></div>}
    </div>
  );
}
