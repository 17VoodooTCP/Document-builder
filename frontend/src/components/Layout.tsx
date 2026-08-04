import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { atLeast, useAuth } from '../lib/auth';
import { cx } from './ui';

/**
 * The application shell.
 *
 * Neutral by design. The tenant's colour appears in the switcher as a small
 * marker and nowhere else in the chrome: somebody who administers three
 * organisations needs to know at a glance which one they are acting for, and
 * they need the document on screen to be the only thing wearing its identity.
 */

function Tab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx(
        '-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors',
        isActive
          ? 'border-slate-900 text-slate-900'
          : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
      )}
    >
      {children}
    </NavLink>
  );
}

export default function Layout() {
  const { slug = '' } = useParams();
  const { user, memberships, logout, roleAt } = useAuth();
  const navigate = useNavigate();
  const role = roleAt(slug);
  const current = memberships.find((m) => m.slug === slug);

  return (
    <div className="min-h-full">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <span className="hidden text-sm font-semibold tracking-tight text-slate-900 sm:block">
            Document Builder
          </span>

          {/* Organisation switcher. A select rather than a menu: it is a change
              of context, and the list is short and complete. */}
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
              style={{ background: current?.accentColor || '#94a3b8' }}
            />
            <select
              value={slug}
              onChange={(e) => navigate(`/o/${e.target.value}`)}
              aria-label="Organisation"
              className="min-w-0 max-w-[14rem] truncate rounded-md border-0 bg-transparent py-1 pl-1 pr-7 text-sm font-medium text-slate-900 ring-1 ring-inset ring-transparent hover:ring-slate-300 focus:ring-2 focus:ring-slate-900"
            >
              {memberships.map((m) => (
                <option key={m.slug} value={m.slug}>{m.name}</option>
              ))}
              {/* A platform operator can reach an organisation they are not a
                  member of, so the current slug may not be in the list. */}
              {!current && slug && <option value={slug}>{slug}</option>}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/organisations" className="text-sm text-slate-500 hover:text-slate-900">
              All organisations
            </NavLink>
            <span className="hidden text-sm text-slate-400 sm:block" title={user?.email}>
              {user?.name}
            </span>
            <button
              type="button"
              onClick={() => logout().then(() => navigate('/login'))}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-6 border-t border-slate-100 px-4 sm:px-6">
          <Tab to={`/o/${slug}`} end>Register</Tab>
          {/* Hidden from a VIEWER because the API would refuse them. Offering a
              button whose only outcome is a 403 is a worse answer than not
              offering it. */}
          {atLeast(role, 'ISSUER') && <Tab to={`/o/${slug}/new`}>New document</Tab>}
          {atLeast(role, 'OWNER') && <Tab to={`/o/${slug}/settings`}>Identity</Tab>}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
