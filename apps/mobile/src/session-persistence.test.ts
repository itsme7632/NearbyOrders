// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  bootstrapSession,
  getSession,
  login,
  logout,
  setSession,
  whoami,
  type Session,
} from './api.js';
import { setRefreshTokenStorage, type RefreshTokenStorage } from './auth-storage.js';

/** In-memory stand-in for the Capacitor secure-storage plugin. */
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

const okJson = (data: unknown): Response =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;

const noContent = (): Response => ({ ok: true, status: 204, json: async () => null }) as Response;

const errJson = (status: number, code: string, message: string): Response =>
  ({ ok: false, status, json: async () => ({ error: { code, message } }) }) as Response;

const user = { id: 'u1', email: 'owner@example.com', role: 'BUSINESS_OWNER' };
const session: Session = { accessToken: 'access-1', user };

let storage: ReturnType<typeof mockStorage>;

beforeEach(() => {
  storage = mockStorage();
  setRefreshTokenStorage(storage);
  setSession(null);
});

afterEach(() => {
  setRefreshTokenStorage(null);
  setSession(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('persistent login (refresh token in secure storage)', () => {
  it('login keeps the access token memory-only and persists the refresh token', async () => {
    stubFetch((url) => {
      expect(url).toContain('/auth/login');
      return okJson({ accessToken: 'access-1', refreshToken: 'refresh-1', user });
    });
    await login('owner@example.com', 'secret');
    // Access token lives in the memory session only.
    expect(getSession()?.accessToken).toBe('access-1');
    expect((getSession() as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
    // The refresh token went to the secure store, never localStorage-style plaintext.
    expect(storage.map.get('nearbyorders.refreshToken')).toBe('refresh-1');
  });

  it('bootstrapSession exchanges the stored token, rotates it, and restores the user', async () => {
    storage.map.set('nearbyorders.refreshToken', 'refresh-old');
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.endsWith('/auth/refresh'))
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-new', user });
      if (url.endsWith('/auth/me'))
        return okJson({ id: 'u1', email: 'owner@example.com', role: 'BUSINESS_OWNER', firstName: 'Ayesha', lastName: null });
      throw new Error(`unexpected ${url}`);
    });
    const restored = await bootstrapSession();
    expect(restored).toBe(true);
    expect(getSession()?.accessToken).toBe('access-2');
    expect(getSession()?.user.email).toBe('owner@example.com');
    // Rotation: the old token is replaced, never reused.
    expect(storage.map.get('nearbyorders.refreshToken')).toBe('refresh-new');
    expect(calls.some((c) => c.endsWith('/auth/refresh'))).toBe(true);
    expect(calls.some((c) => c.endsWith('/auth/me'))).toBe(true);
  });

  it('a failing /auth/me after refresh leaves no half-restored session', async () => {
    storage.map.set('nearbyorders.refreshToken', 'refresh-old');
    stubFetch((url) => {
      if (url.endsWith('/auth/refresh'))
        return okJson({ accessToken: 'access-2', refreshToken: 'refresh-new', user });
      if (url.endsWith('/auth/me')) return errJson(401, 'UNAUTHORIZED', 'revoked');
      throw new Error(`unexpected ${url}`);
    });
    expect(await bootstrapSession()).toBe(false);
    expect(getSession()).toBeNull();
    expect(storage.map.get('nearbyorders.refreshToken')).toBeUndefined();
  });

  it('bootstrapSession with no stored token does nothing and returns false', async () => {
    const fetchSpy = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await bootstrapSession()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });

  it('an expired refresh token clears storage and forces the login screen', async () => {
    storage.map.set('nearbyorders.refreshToken', 'refresh-dead');
    stubFetch((url) => {
      if (url.endsWith('/auth/refresh')) return errJson(401, 'INVALID_REFRESH_TOKEN', 'expired');
      throw new Error(`unexpected ${url}`);
    });
    expect(await bootstrapSession()).toBe(false);
    expect(storage.map.get('nearbyorders.refreshToken')).toBeUndefined();
    expect(getSession()).toBeNull();
  });

  it('logout clears the memory session at once, revokes the token server-side, and wipes storage', async () => {
    setSession(session);
    storage.map.set('nearbyorders.refreshToken', 'refresh-1');
    const bodies: string[] = [];
    stubFetch((url, init) => {
      if (url.endsWith('/auth/logout')) {
        bodies.push(String(init?.body ?? ''));
        return noContent();
      }
      throw new Error(`unexpected ${url}`);
    });
    await logout();
    expect(getSession()).toBeNull();
    expect(storage.map.get('nearbyorders.refreshToken')).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]).refreshToken).toBe('refresh-1');
  });

  it('logout without a stored token never touches the network', async () => {
    setSession(session);
    const fetchSpy = vi.fn(async () => noContent());
    vi.stubGlobal('fetch', fetchSpy);
    await logout();
    expect(getSession()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a 401 on an authenticated call clears the stored refresh token too', async () => {
    setSession(session);
    storage.map.set('nearbyorders.refreshToken', 'refresh-1');
    stubFetch(() => errJson(401, 'UNAUTHORIZED', 'token revoked'));
    await expect(whoami()).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
    expect(storage.map.get('nearbyorders.refreshToken')).toBeUndefined();
  });
});
