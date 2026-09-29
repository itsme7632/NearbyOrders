// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { API_BASE, setSession, getMyBusinesses, getMyBusinessesWithEntitlement } from './api.js';

/**
 * Regression tests for the 429 incident: simultaneous identical GETs must
 * share one network request (in-flight deduplication) instead of each
 * firing independently. The dedup is in-flight only — nothing is cached
 * after it settles, so navigation and explicit reloads always fetch fresh.
 */
describe('in-flight GET deduplication', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok', user: { id: 'u1', email: 'o@x.com', role: 'BUSINESS_OWNER' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: () => Promise.resolve({ data: [], entitlement: null }),
                }),
              20,
            ),
          ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('merges simultaneous getMyBusinesses calls into one request', async () => {
    const [a, b] = await Promise.all([getMyBusinesses(), getMyBusinesses()]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/businesses/mine`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('merges getMyBusinesses with getMyBusinessesWithEntitlement (same endpoint)', async () => {
    await Promise.all([getMyBusinesses(), getMyBusinessesWithEntitlement()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not serve stale data: sequential calls refetch', async () => {
    await getMyBusinesses();
    await getMyBusinesses();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed request does not poison the dedup slot', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'));
    await expect(getMyBusinesses()).rejects.toThrow();
    // The next call must retry the network, not replay the failure.
    await getMyBusinesses();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not deduplicate across different paths', async () => {
    const { getBusinessSubscription } = await import('./api.js');
    await Promise.all([getMyBusinesses(), getBusinessSubscription('biz-1')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
