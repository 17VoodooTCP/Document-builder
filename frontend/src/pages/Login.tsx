import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Button, Field, Input, PageSpinner } from '../components/ui';

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <PageSpinner />;
  if (user) return <Navigate to={from || '/organisations'} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate(from || '/organisations', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      footer={<>No account yet? <Link to="/register" className="font-medium text-slate-900 underline underline-offset-2">Create one</Link>.</>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner>{error}</Banner>}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
      </form>
    </AuthShell>
  );
}

/**
 * Shared frame for the two unauthenticated screens.
 *
 * Lives here rather than in components/ because these are the only two pages
 * that use it, and a shared component with two callers in the same feature is a
 * file you have to open to understand either of them.
 */
export function AuthShell({ title, children, footer }: {
  title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Document Builder</h1>
          <p className="mt-1 text-sm text-slate-500">{title}</p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {children}
        </div>

        {footer && <p className="mt-4 text-center text-sm text-slate-500">{footer}</p>}
      </div>
    </div>
  );
}
