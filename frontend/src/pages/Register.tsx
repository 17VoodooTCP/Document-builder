import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Button, Field, Input, PageSpinner } from '../components/ui';
import { AuthShell } from './Login';

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <PageSpinner />;
  if (user) return <Navigate to="/organisations" replace />;

  /* Mirrors the API's rule exactly. A form that accepts what the server refuses
     teaches people that the error was arbitrary. */
  const tooShort = password.length > 0 && password.length < 12;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(name, email, password);
      /* Straight to the organisation list. A new account holds no memberships,
         so that page is a create form — which is the next thing they need. */
      navigate('/organisations', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create an account"
      footer={<>Already registered? <Link to="/login" className="font-medium text-slate-900 underline underline-offset-2">Sign in</Link>.</>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner>{error}</Banner>}

        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
        </Field>

        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>

        <Field
          label="Password"
          hint="At least 12 characters. Length beats punctuation — a passphrase is fine."
          error={tooShort ? `${12 - password.length} more character${12 - password.length === 1 ? '' : 's'}.` : undefined}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={12}
          />
        </Field>

        <Button type="submit" loading={busy} disabled={tooShort} className="w-full">
          Create account
        </Button>

        <p className="text-xs leading-relaxed text-slate-500">
          A new account can see nothing until it belongs to an organisation. You can
          create one on the next screen, or wait to be added to an existing one.
        </p>
      </form>
    </AuthShell>
  );
}
