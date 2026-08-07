import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { atLeast, useAuth } from '../lib/auth';
import type { Membership } from '../lib/types';
import { cx } from './ui';

/**
 * The workspace shell.
 *
 * Dark, gridded, and set in instrument legends rather than prose — because the
 * people who live in this screen all day are doing one job in it, and a shell
 * that recedes is one they stop seeing after the first hour.
 *
 * It does not break the rule the rest of the codebase runs on. The platform
 * still chooses no colour: charcoal is the absence of a choice, and the only
 * hue anywhere in the chrome is the tenant's own accent, carried in on a custom
 * property and spent on state — the active tab, the live indicator, the corner
 * brackets. The organisation's mark is struck across the middle of the floor at
 * four percent, which is furniture rather than branding.
 *
 * And it makes the builder work harder: a sheet of white paper reads as paper
 * when it is lit against a dark desk, and as a blank div when it sits on grey.
 */

function Tab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx(
        '-mb-px border-b-2 px-1 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
        isActive
          ? 'border-[color:var(--org-accent)] text-white'
          : 'border-transparent text-slate-500 hover:border-slate-700 hover:text-slate-200',
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

  /*
   * A platform operator holds no memberships, and everything the shell needs to
   * dress itself — the switcher, the accent, the badge on the floor — was being
   * read out of that list. So an operator got a grey shell with an empty
   * dropdown and no mark, on precisely the screens they are there to support.
   *
   * They already see every organisation from /organisations, so the shell reads
   * from there instead when there is no membership to read from. One request,
   * only on the path that needs it.
   */
  const [all, setAll] = useState<Membership[]>([]);
  useEffect(() => {
    if (!user?.isPlatformAdmin) return;
    api<{ organisations: Membership[] }>('/organisations')
      .then((r) => setAll(r.organisations))
      .catch(() => {});
  }, [user]);

  const list = memberships.length ? memberships : all;
  const current = list.find((m) => m.slug === slug) || all.find((m) => m.slug === slug);
  const accent = current?.accentColor || '#64748b';

  return (
    <div
      className="ops min-h-full"
      style={{ ['--org-accent' as string]: accent } as React.CSSProperties}
    >
      {/* The organisation's mark, stencilled on the floor. Background image
          rather than an <img>: never in the accessibility tree, never
          clickable, never scrolling with the content. */}
      {current?.logo && (
        <div className="ops-badge" style={{ backgroundImage: `url(${current.logo})` }} aria-hidden="true" />
      )}

      <header className="no-print border-b border-slate-800/80 bg-[rgb(6_9_17/0.86)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.26em] text-slate-400 sm:block">
            Document&nbsp;Builder
          </span>

          <div className="flex min-w-0 items-center gap-2.5">
            <span className="ops-live" aria-hidden="true" />
            <select
              value={slug}
              onChange={(e) => navigate(`/o/${e.target.value}`)}
              aria-label="Organisation"
              className="min-w-0 max-w-[15rem] truncate rounded border-0 bg-transparent py-1 pl-1 pr-7 text-sm font-medium text-slate-100 ring-1 ring-inset ring-transparent hover:ring-slate-700 focus:ring-2 focus:ring-slate-500 [&>option]:bg-slate-900"
            >
              {list.map((m) => (
                <option key={m.slug} value={m.slug}>{m.name}</option>
              ))}
              {/* A platform operator can reach an organisation they are not a
                  member of, so the current slug may not be in the list. */}
              {!current && slug && <option value={slug}>{slug}</option>}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {user?.isPlatformAdmin && (
              <NavLink
                to="/admin"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500/80 hover:text-amber-400"
              >
                Console
              </NavLink>
            )}
            <NavLink to="/organisations" className="text-sm text-slate-500 hover:text-slate-200">
              All organisations
            </NavLink>
            <span className="hidden text-sm text-slate-600 sm:block" title={user?.email}>
              {user?.name}
            </span>
            <button
              type="button"
              onClick={() => logout().then(() => navigate('/login'))}
              className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-800/60 hover:text-slate-200"
            >
              Sign out
            </button>
          </div>
        </div>

        {/*
          Documents, as a row of studios rather than a single "new document".

          Each is its own builder over the same register: a letter, a commercial
          document, a contract. Grouped here so the shared thing — the register
          they all issue into — reads as the spine it is.
        */}
        <nav className="mx-auto flex max-w-7xl items-center gap-7 overflow-x-auto border-t border-slate-800/60 px-4 sm:px-6">
          <Tab to={`/o/${slug}`} end>Register</Tab>
          {/* Hidden from a VIEWER because the API would refuse them. Offering a
              control whose only outcome is a 403 is a worse answer than not
              offering it. */}
          {atLeast(role, 'ISSUER') && <Tab to={`/o/${slug}/new`}>Letter builder</Tab>}
          {atLeast(role, 'ISSUER') && <Tab to={`/o/${slug}/contracts`}>Contracts</Tab>}
          {atLeast(role, 'ISSUER') && <Tab to={`/o/${slug}/billing`}>Billing &amp; invoices</Tab>}
          {atLeast(role, 'OWNER') && <Tab to={`/o/${slug}/settings`}>Identity</Tab>}

          <span className="ops-legend ml-auto hidden shrink-0 py-3 sm:block">
            {role || '—'}
          </span>
        </nav>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
