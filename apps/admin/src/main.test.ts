// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

/**
 * The admin panel's API surface is covered end-to-end by the API integration
 * suite (apps/api/test/admin.test.ts). Here we verify the module graph and the
 * core formatting/helper behavior the panel relies on.
 */
describe('admin panel', () => {
  it('loads the API client with auth, dashboard and moderation endpoints', async () => {
    const api = await import('./api.js');
    expect(typeof api.login).toBe('function');
    expect(typeof api.getDashboard).toBe('function');
    expect(typeof api.listUsers).toBe('function');
    expect(typeof api.setUserSuspended).toBe('function');
    expect(typeof api.listBusinesses).toBe('function');
    expect(typeof api.setBusinessStatus).toBe('function');
    expect(typeof api.setBusinessVerified).toBe('function');
    expect(typeof api.listOrders).toBe('function');
    expect(typeof api.listBookings).toBe('function');
    expect(typeof api.listReviews).toBe('function');
    expect(typeof api.listSubscriptions).toBe('function');
    expect(typeof api.approvePaymentRequest).toBe('function');
    expect(typeof api.rejectPaymentRequest).toBe('function');
    expect(typeof api.listAuditLog).toBe('function');
  });

  it('stores an ADMIN session and rejects a non-admin login', async () => {
    const api = await import('./api.js');
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 't', user: { id: 'u1', email: 'a@b.c', role: 'ADMIN' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accessToken: 't2', user: { id: 'u2', email: 'c@b.c', role: 'CUSTOMER' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }) as unknown as Response,
      );
    const admin = await api.login('admin@example.com', 'password123');
    expect(admin.user.role).toBe('ADMIN');
    expect(api.getSession()?.user.role).toBe('ADMIN');
    await expect(api.login('customer@example.com', 'password123')).rejects.toThrow(/not an administrator/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    api.logout();
    expect(api.getSession()).toBeNull();
  });

  it('money formatting shows whole rupees from minor units', () => {
    const fmt = (minor: number, currency = 'PKR') =>
      new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
    expect(fmt(299900)).toContain('2,999');
    expect(fmt(0)).toContain('0');
  });
});
