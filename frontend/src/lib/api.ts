/**
 * The one place that talks to the API.
 *
 * Two things live here that are easy to scatter and painful to have scattered:
 * how a token is attached, and what happens when it expires.
 */

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

/**
 * The access token, in memory.
 *
 * Not in localStorage. A token in localStorage survives the tab and is readable
 * by any script that gets onto the page; one held in a module variable dies with
 * the tab and comes back from /auth/refresh, which is the cookie's job. On a
 * browser that drops the cross-site cookie, that means a reload signs the user
 * out — the honest trade, and preferable to leaving a seven-day credential
 * sitting in a store every dependency can read.
 */
let accessToken: string | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Options {
  method?: string;
  body?: unknown;
  /** Set on the refresh call itself, so a failure cannot recurse. */
  noRetry?: boolean;
}

let refreshing: Promise<boolean> | null = null;

/**
 * Refresh, at most once at a time.
 *
 * A dashboard fires four requests on mount. Without the shared promise, an
 * expired token means four refreshes racing, three of which are answered with
 * tokens that are immediately replaced by the fourth.
 */
function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const data = await r.json();
        setAccessToken(data.accessToken || null);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, noRetry } = options;

  const send = () =>
    fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send();
  } catch {
    /* fetch rejects on network failure, CORS refusal and a sleeping free-tier
       instance alike. The user cannot tell those apart and neither can we, so
       the message says what they can do about it. */
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  /* One retry, and only for an expired token. Any other 401 means signed out,
     and retrying it just doubles the round trips before saying so. */
  if (res.status === 401 && !noRetry) {
    const payload = await res.clone().json().catch(() => ({}));
    if (payload?.code === 'TOKEN_EXPIRED' || !accessToken) {
      if (await refresh()) {
        res = await send();
      }
    }
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status, data?.code);
  }
  return data as T;
}

/** The verification portal is public and must never send a stale token. */
export async function publicApi<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  /* A 404 from /verify is an answer, not a failure: "we did not issue this" is
     the most useful thing the portal can say, and it arrives with a body. */
  if (!res.ok && res.status !== 404) {
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export { BASE as API_BASE, refresh as refreshSession };
