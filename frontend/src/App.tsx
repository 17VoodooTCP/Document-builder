import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import { PageSpinner } from './components/ui';
import { useAuth } from './lib/auth';
import Builder from './pages/Builder';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Organisations from './pages/Organisations';
import Register from './pages/Register';
import Settings from './pages/Settings';
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

export default function App() {
  return (
    <Routes>
      <Route path="/verify/:slug/:reference" element={<Verify />} />

      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route path="/organisations" element={<RequireAuth><Organisations /></RequireAuth>} />

      <Route path="/o/:slug" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="new" element={<Builder />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/" element={<Navigate to="/organisations" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
