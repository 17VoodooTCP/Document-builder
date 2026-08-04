import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type { DocumentStatus } from '../lib/types';

/**
 * Application chrome.
 *
 * Deliberately neutral — slate, system type, no colour of its own. Every accent
 * on screen should belong to the tenant whose document is being looked at, and a
 * platform with opinions about blue makes that impossible to tell.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ── Buttons ──────────────────────────────────────────────────────────────── */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
};

const VARIANTS: Record<string, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50',
};

export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
        'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Fields ───────────────────────────────────────────────────────────────── */

const CONTROL =
  'w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ' +
  'ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900';

export function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {/* Hint gives way to error rather than stacking. Two lines of guidance
          under one input is one line too many to read in a hurry. */}
      {error
        ? <span className="mt-1 block text-xs text-red-600">{error}</span>
        : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) =>
  <input {...p} className={cx(CONTROL, p.className)} />;

export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea {...p} className={cx(CONTROL, 'leading-relaxed', p.className)} />;

export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...p} className={cx(CONTROL, 'pr-8', p.className)} />;

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
      />
      {label}
    </label>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export function Card({ title, description, actions, children }: {
  title?: string; description?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Banner({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: ReactNode }) {
  if (!children) return null;
  const tones = {
    error: 'bg-red-50 text-red-800 ring-red-200',
    info: 'bg-slate-50 text-slate-700 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-md px-3 py-2 text-sm ring-1', tones[tone])}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

/**
 * Document status.
 *
 * Wording is what the register actually holds, and nothing more. "In good
 * standing" is a statement about the record; it is not a statement that the
 * paper in someone's hand is genuine, which this system has no way to know.
 */
export const STATUS_LABEL: Record<DocumentStatus, string> = {
  ACTIVE: 'In good standing',
  PENDING: 'Awaiting issue',
  EXPIRED: 'Expired',
  REVOKED: 'Withdrawn',
};

const STATUS_TONE: Record<DocumentStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-300',
  REVOKED: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusPill({ status }: { status: DocumentStatus }) {
  return (
    <span className={cx(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
      STATUS_TONE[status] || STATUS_TONE.EXPIRED,
    )}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

/** Reference numbers, fingerprints, authorisation ids. */
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cx('font-mono tabular-nums', className)}>{children}</span>;

export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export { cx };
