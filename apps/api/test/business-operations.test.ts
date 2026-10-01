import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, authed, registerAndLogin, registerAdminAndLogin, createBusiness, approveBusiness, uniqueEmail } from './helpers.js';
import type { TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

/**
 * Phase 16 — Business operations & analytics.
 *
 * Every metric in this phase is derived from real rows; these tests prove the
 * math, the ownership boundaries, and the revenue definitions (only COMPLETED
 * transactions count; pending proofs are never collected money).
 */

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

const createService = async (ownerToken: string, businessId: string, priceMinor = 50000, name = 'Test Service') => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/services`,
    headers: authed(ownerToken),
    payload: { name, priceMinor, durationMinutes: 60 },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

const createProduct = async (ownerToken: string, businessId: string, priceMinor = 120000, name = 'Test Product') => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(ownerToken),
    payload: { name, priceMinor },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

/** Books tomorrow-ish on an open day by configuring 24/7 hours first. */
const createConfirmedBooking = async (
  ownerToken: string,
  customerToken: string,
  businessId: string,
  serviceId: string,
  leavePending = false,
  slotOffset = 0,
): Promise<{ id: string }> => {
  const put = await app.inject({
    method: 'PUT',
    url: `/api/v1/businesses/${businessId}/hours`,
    headers: authed(ownerToken),
    payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '00:00', closesAt: '23:59' })),
  });
  expect(put.statusCode).toBe(200);

  // Start tomorrow: today's early slots can already be past in PKT at test time.
  let date: string | null = null;
  let startTime: string | null = null;
  for (let i = 1; i < 7 && !date; i++) {
    const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
    const avail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${d}` });
    const slots = (JSON.parse(avail.body).data?.slots ?? []) as { start: string }[];
    const availableSlots = slots.filter((slot) => (slot as { available?: boolean }).available !== false);
    const slot = availableSlots[slotOffset];
    if (slot) {
      date = d;
      startTime = slot.start as string;
    }
  }
  expect(date).not.toBeNull();

  const booking = await app.inject({
    method: 'POST',
    url: '/api/v1/bookings',
    headers: authed(customerToken),
    payload: { businessId, serviceId, date, startTime },
  });
  expect(booking.statusCode).toBe(201);
  const created = JSON.parse(booking.body).data as { id: string };

  if (!leavePending) {
    const confirm = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${created.id}/status`, headers: authed(ownerToken), payload: { status: 'CONFIRMED' } });
    expect(confirm.statusCode).toBe(200);
  }
  return created;
};

const placeOrder = async (customerToken: string, businessId: string, productId: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: authed(customerToken),
    payload: { businessId, items: [{ productId, quantity: 2 }], fulfillmentType: 'PICKUP' },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string; totalMinor: number };
};


/** Deletes the businesses this file created (namespaced), cascading children. */
const createdBusinessIds = new Set<string>();
const origCreateBusiness = createBusiness;
const trackedCreateBusiness: typeof createBusiness = async (...args) => {
  const out = await origCreateBusiness(...args);
  createdBusinessIds.add(out.id);
  return out;
};

const cleanupBusinesses = async () => {
  if (createdBusinessIds.size === 0) return;
  const ids = [...createdBusinessIds];
  await prisma.orderPayment.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.bookingPayment.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.order.deleteMany({ where: { businessId: { in: ids } } }); // cascades OrderItem
  await prisma.booking.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.review.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.service.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessHour.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  createdBusinessIds.clear();
};

describe('owner overview endpoint', () => {
  afterEach(async () => {
    await cleanupBusinesses();
  });

  it('reports today/attention/completeness from real rows only', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const service = await createService(owner.token, businessId);
    const product = await createProduct(owner.token, businessId);

    const order = await placeOrder(customer.token, businessId, product.id);
    const booking = await createConfirmedBooking(owner.token, customer.token, businessId, service.id);
    const pendingBooking = await createConfirmedBooking(owner.token, customer.token, businessId, service.id, true, 5);

    const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/overview`, headers: authed(owner.token) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;

    expect(body.business.id).toBe(businessId);
    expect(body.needsAttention.pendingOrders).toBe(1);
    expect(body.needsAttention.pendingBookings).toBe(1);
    expect(body.needsAttention.pendingPayments).toBe(0);
    expect(body.upcomingBookings).toHaveLength(2);
    expect(body.upcomingBookings.map((b: { id: string }) => b.id)).toContain(booking.id);
    expect(body.upcomingBookings.every((b: { startTime: string }) => /^\d{2}:\d{2}$/.test(b.startTime))).toBe(true);
    expect(body.today.revenueMinor).toBe(0); // nothing completed yet
    // The helper configures hours, but phone/image were never set → honest gaps.
    expect(body.profileMissing).toContain('phone');
    expect(body.profileMissing).toContain('image');
    expect(body.profileMissing).not.toContain('hours');
    expect(body.recentOrders.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(body.recentBookings.map((b: { id: string }) => b.id)).toContain(booking.id);
  });

  it('stamps completedAt on completion and counts today revenue', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const service = await createService(owner.token, businessId, 30000);
    await createConfirmedBooking(owner.token, customer.token, businessId, service.id);

    const complete = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${(await prisma.booking.findFirstOrThrow({ where: { businessId } })).id}/status`, headers: authed(owner.token), payload: { status: 'COMPLETED' } });
    expect(complete.statusCode).toBe(200);

    const row = await prisma.booking.findFirstOrThrow({ where: { businessId } });
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).not.toBeNull();

    const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/overview`, headers: authed(owner.token) });
    const body = JSON.parse(res.body).data;
    expect(body.today.revenueMinor).toBe(30000);
  });

  it('404s another owner’s business and 403s customers/admins', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, ownerA.token);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const admin = await registerAdminAndLogin(app);

    for (const t of [ownerB.token, customer.token]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/overview`, headers: authed(t) });
      expect([403, 404]).toContain(res.statusCode);
    }
    // Admins have their own surfaces; the owner overview is owner-scoped.
    const adminRes = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/overview`, headers: authed(admin.token) });
    expect([403, 404]).toContain(adminRes.statusCode);
    // Owner A still gets 200.
    expect((await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/overview`, headers: authed(ownerA.token) })).statusCode).toBe(200);
  });
});

describe('owner analytics endpoint', () => {
  afterEach(async () => {
    await cleanupBusinesses();
  });

  it('computes period windows from real data with honest period labels', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const product = await createProduct(owner.token, businessId, 10000);
    const order = await placeOrder(customer.token, businessId, product.id);

    const accept = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'ACCEPTED' } });
    expect(accept.statusCode).toBe(200);
    const complete = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'COMPLETED' } });
    expect(complete.statusCode).toBe(200);

    for (const period of ['today', 'week', 'month'] as const) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/analytics?period=${period}`, headers: authed(owner.token) });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body).data;
      expect(body.period).toBe(period);
      expect(body.orders.total).toBe(1);
      expect(body.orders.completed).toBe(1);
      expect(body.orders.cancelled).toBe(0);
      expect(body.orders.revenueMinor).toBe(20000); // 2 × 10000
      expect(body.catalog.activeProducts).toBe(1);
    }

    // The window is a real business-local date range, never fake.
    const month = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/analytics?period=month`, headers: authed(owner.token) })).body).data;
    expect(month.window.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('never counts cancelled money as revenue', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const product = await createProduct(owner.token, businessId, 50000);
    const order = await placeOrder(customer.token, businessId, product.id);
    const reject = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'REJECTED' } });
    expect(reject.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/analytics?period=today`, headers: authed(owner.token) });
    const body = JSON.parse(res.body).data;
    expect(body.orders.cancelled).toBe(1);
    expect(body.orders.revenueMinor).toBe(0);
  });

  it('rejects invalid periods and enforces ownership', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, ownerA.token);

    const bad = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/analytics?period=year`, headers: authed(ownerA.token) });
    expect(bad.statusCode).toBe(400);

    const foreign = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/analytics`, headers: authed(ownerB.token) });
    expect([403, 404]).toContain(foreign.statusCode);
  });
});

describe('owner earnings endpoint', () => {
  afterEach(async () => {
    await cleanupBusinesses();
  });

  it('counts only completed transactions as collected; pending proofs are separate', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const product = await createProduct(owner.token, businessId, 25000);
    const order = await placeOrder(customer.token, businessId, product.id); // total 50000

    // A pending payment proof is NOT collected money (digital channel + receipt).
    const method = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/businesses/${businessId}/payment-methods`,
      headers: authed(owner.token),
      payload: { type: 'EASYPAISA', displayName: 'Test Easypaisa', accountTitle: 'Test Owner', accountNumber: '03001234567' },
    });
    expect(method.statusCode).toBe(201);
    const methodId = JSON.parse(method.body).data.id as string;
    const proof = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/payments`,
      headers: authed(customer.token),
      payload: { amountMinor: 50000, paymentMethodId: methodId, transactionReference: 'TX-TEST-1', receiptStorageKey: 'receipts/test.jpg' },
    });
    expect(proof.statusCode).toBe(201);

    const before = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/earnings`, headers: authed(owner.token) })).body).data;
    expect(before.collected.totalMinor).toBe(0);
    expect(before.awaitingVerification.count).toBe(1);
    expect(before.awaitingVerification.amountMinor).toBe(50000);
    expect(before.inProgress.orders).toBe(1);
    expect(before.inProgress.valueMinor).toBe(50000);

    const accept = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'ACCEPTED' } });
    expect(accept.statusCode).toBe(200);
    const complete = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'COMPLETED' } });
    expect(complete.statusCode).toBe(200);

    const after = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/earnings`, headers: authed(owner.token) })).body).data;
    expect(after.collected.ordersRevenueMinor).toBe(50000);
    expect(after.collected.totalMinor).toBe(50000);
    expect(after.collected.completedOrders).toBe(1);
    expect(after.currency).toBe('PKR');
  });

  it('enforces ownership boundaries', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await trackedCreateBusiness(app, ownerA.token);

    const foreign = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/earnings`, headers: authed(ownerB.token) });
    expect([403, 404]).toContain(foreign.statusCode);
    const cust = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/earnings`, headers: authed(customer.token) });
    expect([403, 404]).toContain(cust.statusCode);
    void customer;
  });
});

describe('admin businesses operational counts', () => {
  it('exposes real per-business activity counts to admins only', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    const admin = await registerAdminAndLogin(app);
    await createService(owner.token, businessId);
    await createProduct(owner.token, businessId);

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const row = JSON.parse(res.body).data.find((b: { id: string }) => b.id === businessId);
    expect(row.counts).toMatchObject({ orders: 0, bookings: 0, services: 1, products: 1, reviews: 0 });

    const customer = await registerAndLogin(app, 'CUSTOMER');
    const customerRes = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses', headers: authed(customer.token) });
    expect(customerRes.statusCode).toBe(403);
    void uniqueEmail;
  });
});
