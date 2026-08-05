import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import { PageSpinner } from './components/ui';
import { useAuth } from './lib/auth';
import Admin from './pages/Admin';
import Builder from './pages/Builder';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Organisations from './pages/Organisations';
import Register from './pages/Register';
import Settings from './pages/Settings';
import Unlock from './pages/Unlock';
import Verify from './pages/Verify';

/**
 * Routing.
 *
 * Two halves that barely touch: everything under /o is a signed-in tenant
 * workspace, and /verify is the public portal a scanned code lands on. The
 * portal never renders application chrome and never needs a session — a
 * recipient holding a letter is not a user of this system and should not be
 * asked to become one in order to check a reference.
 */

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  /* Wait for the refresh on load to settle. Redirecting before it does signs a
     signed-in user out on every reload, which looks exactly like a broken
     session and is the single most common bug in this shape of app. */
  if (loading) return <PageSpinner />;

  if (!user) {
    /* Remember where they were headed, so signing in resumes rather than
       dumping them on a landing page. */
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Authenticated, and paid.
 *
 * Mirrors requirePaid on the API. The client gate exists so somebody who has
 * not paid lands on the unlock page rather than on a workspace that answers
 * every request with a 402 — but it is a courtesy, not the control. The server
 * refuses regardless of what this component decides.
 *
 * A platform operator passes, matching the middleware.
 */
function RequirePaid({ children }: { children: ReactNode }) {
  const { user, loading, paywallActive } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  /*
   * `paywallActive` is what stops this becoming a loop.
   *
   * With no receiving address configured the API's own gate fails open, and
   * without asking it this guard would keep sending people to an unlock page
   * that has nothing to sell them — which, if that page bounced them back,
   * is two components redirecting at each other forever. One source of truth,
   * and it is the server's.
   */
  if (paywallActive && !user.unlockedAt && !user.isPlatformAdmin) {
    return <Navigate to="/unlock" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/verify/:slug/:reference" element={<Verify />} />

      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Behind the sign-in, in front of the paywall — it is where an unpaid
          account is sent, so gating it on payment would be a closed loop. */}
      <Route path="/unlock" element={<RequireAuth><Unlock /></RequireAuth>} />

      {/* Operator console. Outside the paywall on purpose — the person who
          configures the wallets cannot be gated behind the payments they are
          configuring. The API answers 404 to anybody who is not an operator. */}
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />

      <Route path="/organisations" element={<RequirePaid><Organisations /></RequirePaid>} />

      <Route path="/o/:slug" element={<RequirePaid><Layout /></RequirePaid>}>
        <Route index element={<Dashboard />} />
        <Route path="new" element={<Builder />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/" element={<Navigate to="/organisations" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
