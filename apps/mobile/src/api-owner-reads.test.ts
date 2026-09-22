// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  API_BASE,
  setSession,
  listOwnerServices,
  listOwnerProducts,
  getOwnerHours,
  listSubscriptionPlans,
} from './api.js';

/**
 * Regression tests: the owner management screens must call the authenticated
 * owner-scoped endpoints — never the public filtered ones. This is what fixed
 * the literal 404 "Business not found" for PENDING businesses.
 */
describe('owner-scoped management reads hit the owner endpoints', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-owner', user: { id: 'u1', email: 'o@x.com', role: 'BUSINESS_OWNER' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('listOwnerServices calls the owner services endpoint with auth', async () => {
    await listOwnerServices('biz-1');
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/owner/businesses/biz-1/services`,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok-owner' }) }),
    );
  });

  it('listOwnerProducts calls the owner products endpoint with auth', async () => {
    await listOwnerProducts('biz-1');
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/owner/businesses/biz-1/products`,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok-owner' }) }),
    );
  });

  it('getOwnerHours calls the owner hours endpoint with auth', async () => {
    await getOwnerHours('biz-1');
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/owner/businesses/biz-1/hours`,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer tok-owner' }) }),
    );
  });

  it('listSubscriptionPlans calls the public plans catalog', async () => {
    await listSubscriptionPlans();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/subscription/plans`, expect.anything());
  });
});
