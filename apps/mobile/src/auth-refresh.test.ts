// @vitest-environment node
/**
 * Refresh-on-401 regressions (device report 2026-10-20: tapping actions on
 * Business Detail "sent the user Home"). Root cause: access tokens expire
 * after ~15 minutes and ANY authed request that met a 401 cleared the whole
 * session (and the stored refresh token), dropping the app to the signed-out
 * Home. Business Detail fires authed calls on mount (favorite state) and on
 * Save/Book/Add Product, so ordinary browsing past the token lifetime lost
 * the session mid-task.
 *
 * The contract now: a 401 on an authed request triggers ONE refresh-token
 * exchange and ONE retry; the session survives. Only a failed refresh (or a
 * retry that is also rejected) clears auth state.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getSession, setSession, whoami, getFavoriteState, type Session } from './api.js';
import { setRefreshTokenStorage, type RefreshTokenStorage } from './auth-storage.js';

function mockStorage(): RefreshTokenStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getRefreshToken: async () => map.get('nearbyorders.refreshToken') ?? null,
    setRefreshToken: async (t: string) => void map.set('nearbyorders.refreshToken', t),
    clearRefreshToken: async () => void map.delete('nearbyorders.refreshToken'),
  };
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
}

const okJson = (data: unknown): Response => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;
const errJson = (status: number, code: string, message: string): Response =>
  ({ ok: false, status, json: async () => ({ error: { code, message } }) }) as Response;

const user = { id: 'u1', email: 'owner@example.com', role: 'BUSINESS_OWNER' };
const expiredSession: Session = { accessToken: 'access-expired', user };

let storage: ReturnType<typeof mockStorage>;

beforeEach(() => {
  storage = mockStorage();
  setRefreshTokenStorage(storage);
  setSession(null);
  storage.map.set('nearbyorders.refreshToken', 'refresh-1');
});

afterEach(() => {
  setRefreshTokenStorage(null);
  setSession(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('refresh on 401', () => {
  it('an expired access token is refreshed and the request retried; the session survives', async () => {
    setSession(expiredSession);
    const seenAuth: string[] = [];
    stubFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-2', user });
      }
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      seenAuth.push(auth);
      if (auth === 'Bearer access-expired') return errJson(401, 'UNAUTHORIZED', 'Token expired');
      return okJson({ id: 'u1', email: user.email, role: user.role, firstName: 'A', lastName: null, phone: null });
    });

    const me = await whoami();
    expect(me.id).toBe('u1');
    // First attempt used the expired token; the retry used the fresh one.
    expect(seenAuth).toEqual(['Bearer access-expired', 'Bearer access-2']);
    // Session was renewed, not destroyed; the rotated refresh token stored.
    expect(getSession()?.accessToken).toBe('access-2');
    expect(storage.map.get('nearbyorders.refreshToken')).toBe('refresh-2');
  });

  it('the favorite-state call Business Detail makes on mount no longer kills the session', async () => {
    setSession(expiredSession);
    stubFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-2', user });
      }
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth === 'Bearer access-expired') return errJson(401, 'UNAUTHORIZED', 'Token expired');
      return okJson({ saved: true });
    });

    const state = await getFavoriteState('biz-1');
    expect(state.saved).toBe(true);
    expect(getSession()).not.toBeNull();
  });

  it('when the refresh token is also dead, the session is cleared (real logout semantics)', async () => {
    setSession(expiredSession);
    stubFetch((url) => {
      if (url.endsWith('/auth/refresh')) return errJson(401, 'UNAUTHORIZED', 'Refresh revoked');
      return errJson(401, 'UNAUTHORIZED', 'Token expired');
    });

    await expect(whoami()).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
    expect(storage.map.has('nearbyorders.refreshToken')).toBe(false);
  });

  it('concurrent 401s share a single refresh exchange', async () => {
    setSession(expiredSession);
    let refreshCalls = 0;
    stubFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-2', user });
      }
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth === 'Bearer access-expired') return errJson(401, 'UNAUTHORIZED', 'Token expired');
      return okJson({ saved: false });
    });

    await Promise.all([getFavoriteState('biz-1'), getFavoriteState('biz-2'), getFavoriteState('biz-3')]);
    expect(refreshCalls).toBe(1);
    expect(getSession()?.accessToken).toBe('access-2');
  });

  it('public (non-auth) requests never trigger a refresh', async () => {
    setSession(expiredSession);
    let refreshCalls = 0;
    stubFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-2', user });
      }
      return errJson(401, 'UNAUTHORIZED', 'Nope');
    });

    const { listBusinessReviews } = await import('./api.js');
    await expect(listBusinessReviews('biz-1')).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(0);
  });
});
