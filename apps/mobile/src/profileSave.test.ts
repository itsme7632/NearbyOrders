import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Focused regression test for Account → Personal information → Save changes.
 * Proves updateMyProfile() goes through the centralized request() with the
 * configured API base (never a raw relative fetch), using PATCH + JSON body
 * + bearer token.
 */
describe('updateMyProfile request (profile Save changes)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const installFetch = () => {
    const calls: { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: { id: 'u1' } }) };
      }),
    );
    return calls;
  };

  const signIn = (api: typeof import('./api.js')) =>
    api.setSession({ accessToken: 'tok-123', user: { id: 'u1', email: 'a@b.c', role: 'CUSTOMER' } });

  it('sends PATCH with JSON body and bearer token to /auth/profile', async () => {
    const calls = installFetch();
    const api = await import('./api.js');
    signIn(api);

    await api.updateMyProfile({ firstName: 'Ayesha', lastName: 'Khan', phone: '+92 300 1234567' });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    // Default (web/test) base: same-origin relative path, via API_BASE.
    expect(url).toBe('/api/v1/auth/profile');
    expect(init.method).toBe('PATCH');
    expect(init.headers?.['content-type']).toBe('application/json');
    expect(init.headers?.authorization).toBe('Bearer tok-123');
    expect(JSON.parse(init.body ?? '{}')).toEqual({
      firstName: 'Ayesha',
      lastName: 'Khan',
      phone: '+92 300 1234567',
    });
    api.setSession(null);
  });

  it('targets the absolute VPS base in the device build (VITE_API_BASE_URL baked in)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://157.230.213.10:3000/api/v1');
    const calls = installFetch();
    const api = await import('./api.js');
    expect(api.API_BASE).toBe('http://157.230.213.10:3000/api/v1');
    signIn(api);

    await api.updateMyProfile({ firstName: 'Ayesha', lastName: null, phone: null });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://157.230.213.10:3000/api/v1/auth/profile');
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[0].init.headers?.authorization).toBe('Bearer tok-123');
    api.setSession(null);
  });
});
