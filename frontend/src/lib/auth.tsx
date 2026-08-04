import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken } from './api';
import type { Membership, Role, User } from './types';

interface Session {
  user: User;
  memberships: Membership[];
  accessToken?: string;
}

interface AuthValue {
  user: User | null;
  memberships: Membership[];
  /** True until the first /auth/refresh has settled. Routing before that
      resolves is how a signed-in user gets bounced to the sign-in screen on
      every reload. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Called after creating an organisation, so the switcher shows it. */
  reload: () => Promise<void>;
  roleAt: (slug: string) => Role | null;
}

const AuthContext = createContext<AuthValue | null>(null);

const RANK: Record<Role, number> = { VIEWER: 1, ISSUER: 2, OWNER: 3 };

/** Mirrors requireRole. The UI hides what the API would refuse, so a VIEWER is
    not offered a button whose only outcome is a 403. */
export const atLeast = (role: Role | null, min: Role) =>
  !!role && RANK[role] >= RANK[min];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  const adopt = useCallback((s: Session) => {
    if (s.accessToken) setAccessToken(s.accessToken);
    setUser(s.user);
    setMemberships(s.memberships || []);
  }, []);

  /*
   * On load, try to refresh rather than calling /auth/me.
   *
   * There is no access token in memory yet — it was never persisted — so /me
   * would 401 and then refresh anyway. Going straight to the refresh cookie is
   * the same result in one round trip instead of two.
   */
  useEffect(() => {
    let live = true;
    api<Session>('/auth/refresh', { method: 'POST', body: {}, noRetry: true })
      .then((s) => { if (live) adopt(s); })
      .catch(() => { /* Signed out. Not an error; it is most visitors. */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [adopt]);

  const login = useCallback(async (email: string, password: string) => {
    adopt(await api<Session>('/auth/login', { method: 'POST', body: { email, password } }));
  }, [adopt]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    adopt(await api<Session>('/auth/register', { method: 'POST', body: { name, email, password } }));
  }, [adopt]);

  const logout = useCallback(async () => {
    /* Clear locally first and regardless. If the request fails, the user still
       wanted to be signed out, and leaving them signed in because the network
       blinked is the one outcome nobody would accept. */
    setAccessToken(null);
    setUser(null);
    setMemberships([]);
    await api('/auth/logout', { method: 'POST', body: {}, noRetry: true }).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    const s = await api<Session>('/auth/me');
    setUser(s.user);
    setMemberships(s.memberships || []);
  }, []);

  const roleAt = useCallback(
    (slug: string) => memberships.find((m) => m.slug === slug)?.role
      /* A platform operator is treated as an owner everywhere, matching the
         guard. The UI would otherwise hide controls the API would allow. */
      ?? (user?.isPlatformAdmin ? 'OWNER' : null),
    [memberships, user],
  );

  const value = useMemo<AuthValue>(
    () => ({ user, memberships, loading, login, register, logout, reload, roleAt }),
    [user, memberships, loading, login, register, logout, reload, roleAt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider.');
  return ctx;
}
