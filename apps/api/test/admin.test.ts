import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, makeApp, registerAdminAndLogin, registerAndLogin, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe('admin panel API: authorization boundaries', () => {
  it('every admin endpoint rejects customers with 403', async () => {
    const customer = await registerAndLogin(app, 'CUSTOMER');
    for (const url of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/businesses', '/api/v1/admin/orders', '/api/v1/admin/bookings', '/api/v1/admin/reviews', '/api/v1/admin/subscriptions', '/api/v1/admin/audit-log']) {
      const res = await app.inject({ method: 'GET', url, headers: authed(customer.token) });
      expect([401, 403]).toContain(res.statusCode);
    }
  });

  it('every admin endpoint rejects business owners with 403', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    for (const url of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/businesses', '/api/v1/admin/orders', '/api/v1/admin/bookings', '/api/v1/admin/reviews', '/api/v1/admin/subscriptions', '/api/v1/admin/audit-log']) {
      const res = await app.inject({ method: 'GET', url, headers: authed(owner.token) });
      expect([401, 403]).toContain(res.statusCode);
    }
  });

  it('admin endpoints reject unauthenticated requests', async () => {
    for (const url of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/businesses']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('mutation endpoints also enforce the ADMIN role', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await createBusiness(app, owner.token);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const resStatus = await app.inject({ method: 'PATCH', url: `/api/v1/admin/businesses/${businessId}/status`, headers: authed(otherOwner.token), payload: { status: 'APPROVED' } });
    expect([401, 403]).toContain(resStatus.statusCode);
    const resVerify = await app.inject({ method: 'PATCH', url: `/api/v1/admin/businesses/${businessId}/verification`, headers: authed(customer.token), payload: { verified: true } });
    expect([401, 403]).toContain(resVerify.statusCode);
  });
});

describe('admin panel API: dashboard and listings', () => {
  it('dashboard exposes platform counts', async () => {
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as Record<string, number>;
    expect(typeof data.users).toBe('number');
    expect(typeof data.businesses).toBe('number');
    expect(typeof data.activeBusinesses).toBe('number');
    expect(typeof data.pendingBusinesses).toBe('number');
    expect(typeof data.pendingSubscriptionPayments).toBe('number');
  });

  it('businesses list includes every status plus owner identity', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token); // PENDING
    const { id: approvedId } = await createBusiness(app, owner.token);
    await approveBusiness(approvedId);

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as { id: string; status: string; owner: { id: string } }[];
    const mine = rows.filter((b) => b.id === id || b.id === approvedId);
    expect(mine).toHaveLength(2);
    expect(mine.every((b) => b.owner.id === owner.userId)).toBe(true);

    const pendingOnly = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses?status=PENDING', headers: authed(admin.token) });
    const pendingRows = JSON.parse(pendingOnly.body).data as { id: string }[];
    expect(pendingRows.some((b) => b.id === id)).toBe(true);
    expect(pendingRows.some((b) => b.id === approvedId)).toBe(false);
  });

  it('users list and detail never leak passwordHash', async () => {
    const admin = await registerAdminAndLogin(app);
    const customer = await registerAndLogin(app, 'CUSTOMER');

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: authed(admin.token) });
    expect(list.body).not.toContain('passwordHash');
    const rows = JSON.parse(list.body).data as { id: string; email: string }[];
    expect(rows.some((u) => u.id === customer.userId)).toBe(true);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/users/${customer.userId}`, headers: authed(admin.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain('passwordHash');
    const user = JSON.parse(detail.body).data as { counts: { bookings: number } };
    expect(user.counts).toHaveProperty('bookings');
  });

  it('users can be searched by email', async () => {
    const admin = await registerAdminAndLogin(app);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } })).email;
    const res = await app.inject({ method: 'GET', url: `/api/v1/admin/users?q=${encodeURIComponent(email)}`, headers: authed(admin.token) });
    const rows = JSON.parse(res.body).data as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(customer.userId);
  });

  it('orders and bookings listings return cross-platform rows with identity', async () => {
    const admin = await registerAdminAndLogin(app);
    const orders = await app.inject({ method: 'GET', url: '/api/v1/admin/orders', headers: authed(admin.token) });
    expect(orders.statusCode).toBe(200);
    expect(orders.body).not.toContain('passwordHash');

    const bookings = await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: authed(admin.token) });
    expect(bookings.statusCode).toBe(200);
    expect(bookings.body).not.toContain('passwordHash');
  });

  it('reviews and subscriptions listings return rows for moderation', async () => {
    const admin = await registerAdminAndLogin(app);
    const reviews = await app.inject({ method: 'GET', url: '/api/v1/admin/reviews', headers: authed(admin.token) });
    expect(reviews.statusCode).toBe(200);
    const subs = await app.inject({ method: 'GET', url: '/api/v1/admin/subscriptions', headers: authed(admin.token) });
    expect(subs.statusCode).toBe(200);
  });
});

describe('admin panel API: moderation actions', () => {
  it('verify and unverify a business with an audit entry', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);

    const on = await app.inject({ method: 'PATCH', url: `/api/v1/admin/businesses/${id}/verification`, headers: authed(admin.token), payload: { verified: true } });
    expect(on.statusCode).toBe(200);
    expect(JSON.parse(on.body).data.isVerified).toBe(true);

    const off = await app.inject({ method: 'PATCH', url: `/api/v1/admin/businesses/${id}/verification`, headers: authed(admin.token), payload: { verified: false } });
    expect(JSON.parse(off.body).data.isVerified).toBe(false);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'Business', entityId: id, action: { in: ['BUSINESS_VERIFIED', 'BUSINESS_UNVERIFIED'] } } });
    expect(audits.map((a) => a.action).sort()).toEqual(['BUSINESS_UNVERIFIED', 'BUSINESS_VERIFIED']);
  });

  it('suspend and reinstate a customer, with audit entries; admins are protected', async () => {
    const admin = await registerAdminAndLogin(app);
    const customer = await registerAndLogin(app, 'CUSTOMER');

    const suspend = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${customer.userId}/suspension`, headers: authed(admin.token), payload: { suspended: true } });
    expect(suspend.statusCode).toBe(200);
    expect(JSON.parse(suspend.body).data.isSuspended).toBe(true);

    const reinstate = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${customer.userId}/suspension`, headers: authed(admin.token), payload: { suspended: false } });
    expect(JSON.parse(reinstate.body).data.isSuspended).toBe(false);

    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const protect = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${adminUser.id}/suspension`, headers: authed(admin.token), payload: { suspended: true } });
    expect(protect.statusCode).toBe(409);
    expect(JSON.parse(protect.body).error.code).toBe('ADMIN_IMMUTABLE');
  });

  it('suspension actions are audit-logged with the acting admin', async () => {
    const admin = await registerAdminAndLogin(app);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${customer.userId}/suspension`, headers: authed(admin.token), payload: { suspended: true } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId: customer.userId, action: 'USER_SUSPENDED' } });
    expect(entry.actorId).toBe(admin.userId);
  });

  it('business status still transitions through the existing admin endpoint', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/admin/businesses/${id}/status`, headers: authed(admin.token), payload: { status: 'APPROVED' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('APPROVED');
  });
});
