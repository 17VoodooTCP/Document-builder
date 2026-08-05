import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Banner, Button, Field, Input, PageSpinner } from '../components/ui';
import LetterGlitch from '../components/LetterGlitch';
import EvilCatV1, { type CatMood } from '../components/EvilCatV1';

/** How long the success animation is allowed before the page moves on. */
const SUCCESS_MS = 600;
/** One slow blink and a tilt, matching the keyframes. */
const ERROR_MS = 900;

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /* What the cat is reacting to. Kept here rather than inside the mark, because
     the mark reports state — it does not own any. */
  const [emailFocus, setEmailFocus] = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [outcome, setOutcome] = useState<'success' | 'error' | null>(null);

  /*
   * Order matters. An outcome outranks focus — a refused sign-in should blink
   * even though the password field still holds the cursor — and the password
   * field outranks the email field, because tabbing between them fires the new
   * focus before the old blur.
   */
  const mood: CatMood =
    outcome === 'success' ? 'success'
      : outcome === 'error' ? 'error'
        : passwordFocus ? (reveal ? 'reveal' : 'password')
          : emailFocus ? 'email'
            : 'idle';

  if (loading) return <PageSpinner />;
  /*
   * Held back while the success animation runs. The auth context sets the user
   * the instant the request returns, which would redirect out of this screen
   * mid-sweep; the explicit navigate below takes over once it has played.
   */
  if (user && outcome !== 'success') return <Navigate to={from || '/organisations'} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      setOutcome('success');
      window.setTimeout(() => navigate(from || '/organisations', { replace: true }), SUCCESS_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setOutcome('error');
      window.setTimeout(() => setOutcome(null), ERROR_MS);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      mood={mood}
      footer={<>No account yet? <Link to="/register" className="font-medium text-white underline underline-offset-2">Create one</Link>.</>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Banner>{error}</Banner>}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setEmailFocus(true)}
            onBlur={() => setEmailFocus(false)}
            autoComplete="username"
            required
            autoFocus
          />
        </Field>

        <Field label="Password">
          <div className="relative">
            <Input
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordFocus(true)}
              onBlur={() => setPasswordFocus(false)}
              autoComplete="current-password"
              required
              className="pr-16"
            />
            {/*
              onMouseDown is prevented so the button never steals focus from the
              field. Without it, revealing the password blurs the input, the cat
              opens its eyes for the blur rather than the reveal, and the caret
              is lost mid-typing.
            */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>
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
 *
 * The card is the mark's container in the literal sense: `relative` gives it
 * something to be positioned against and `overflow-hidden` is what guarantees
 * it can never extend past the panel, whatever a transform does to it.
 */
export function AuthShell({ title, children, footer, mood = 'idle' }: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  mood?: CatMood;
}) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-16">
      {/*
        The full-screen field behind everything. Untouched by any of the panel
        work — it runs on its own canvas and its own loop, and the mark inside
        the card never reaches outside to it.
      */}
      <div className="absolute inset-0" aria-hidden="true">
        <LetterGlitch
          glitchSpeed={50}
          centerVignette
          outerVignette={false}
          smooth
        />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-white">Document Builder</h1>
          <p className="mt-1 text-sm text-slate-300">{title}</p>
        </div>

        {/* Kept opaque white. It is the sheet of paper on the desk, and a
            translucent card over moving text is a form nobody can read. */}
        <div className="ec-host relative overflow-hidden rounded-lg bg-white p-6 shadow-2xl ring-1 ring-black/20">
          <EvilCatV1 mood={mood} />
          {/* Every control sits in its own layer above the engraving. */}
          <div className="relative z-10">{children}</div>
        </div>

        {footer && <p className="mt-4 text-center text-sm text-slate-300">{footer}</p>}
      </div>
    </div>
  );
}
