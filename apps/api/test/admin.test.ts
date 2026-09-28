import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, makeApp, registerAdminAndLogin, registerAndLogin, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { upsertPlans } from '../prisma/seed.js';

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
    for (const url of ['/api/v1/admin/dashboard', '/api/v1/admin/users', '/api/v1/admin/businesses', '/api/v1/admin/orders', '/api/v1/admin/bookings', '/api/v1/admin/reviews', '/api/v1/admin/subscriptions', '/api/v1/admin/audit-log', '/api/v1/admin/categories']) {
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
    const resReview = await app.inject({ method: 'PATCH', url: '/api/v1/admin/reviews/00000000-0000-4000-8000-000000000000/visibility', headers: authed(customer.token), payload: { hidden: true } });
    expect([401, 403]).toContain(resReview.statusCode);
    const resCategory = await app.inject({ method: 'PATCH', url: '/api/v1/admin/categories/00000000-0000-4000-8000-000000000000', headers: authed(customer.token), payload: { isActive: false } });
    expect([401, 403]).toContain(resCategory.statusCode);
  });
});

describe('admin panel API: dashboard and listings', () => {
  it('dashboard exposes platform counts', async () => {
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as Record<string, unknown>;
    expect(typeof data.users).toBe('number');
    expect(typeof data.customers).toBe('number');
    expect(typeof data.businessOwners).toBe('number');
    expect(typeof data.businesses).toBe('number');
    expect(typeof data.activeBusinesses).toBe('number');
    expect(typeof data.pendingBusinesses).toBe('number');
    expect(typeof data.pendingSubscriptionPayments).toBe('number');
    expect(typeof data.reviews).toBe('number');
    expect(typeof data.hiddenReviews).toBe('number');
    const push = data.pushDevices as Record<string, number>;
    expect(typeof push.total).toBe('number');
    expect(typeof push.active).toBe('number');
  });

  it('businesses list includes every status plus owner identity', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token); // PENDING
    // P3: the base allowance is 1 business per owner — this status-matrix
    // scenario needs two owned businesses, so grant a Growth plan (3 slots).
    await upsertPlans();
    const growth = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
    const now = new Date();
    await prisma.businessSubscription.create({
      data: {
        businessId: id,
        planId: growth.id,
        status: 'ACTIVE',
        currentPeriodStartAt: now,
        currentPeriodEndAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        planNameSnapshot: growth.name,
        planPriceMinorSnapshot: growth.monthlyPriceMinor,
      },
    });
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

  it('hiding a review removes it from public surfaces and ratings; restoring brings it back', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await approveBusiness(businessId);
    const review = await prisma.review.create({
      data: { businessId, customerId: customer.userId, rating: 2, comment: 'Moderation test review' },
    });

    // Sanity: the review is public before moderation.
    const before = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/reviews` });
    expect(JSON.parse(before.body).data.reviewCount).toBe(1);

    const hide = await app.inject({ method: 'PATCH', url: `/api/v1/admin/reviews/${review.id}/visibility`, headers: authed(admin.token), payload: { hidden: true } });
    expect(hide.statusCode).toBe(200);
    expect(JSON.parse(hide.body).data.isHidden).toBe(true);

    // Public list: gone. Rating summary: gone.
    const after = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/reviews` });
    const publicData = JSON.parse(after.body).data as { items: unknown[]; reviewCount: number; averageRating: number | null };
    expect(publicData.items).toHaveLength(0);
    expect(publicData.reviewCount).toBe(0);
    expect(publicData.averageRating).toBeNull();

    // The admin still sees it, flagged hidden, and can filter to hidden only.
    const adminList = await app.inject({ method: 'GET', url: '/api/v1/admin/reviews?status=hidden', headers: authed(admin.token) });
    const hiddenRows = JSON.parse(adminList.body).data as { id: string; isHidden: boolean }[];
    expect(hiddenRows.some((rv) => rv.id === review.id && rv.isHidden)).toBe(true);

    // The customer's own review history is untouched by soft moderation.
    const mine = await app.inject({ method: 'GET', url: '/api/v1/my-reviews', headers: authed(customer.token) });
    const mineRows = JSON.parse(mine.body).data as { id: string }[];
    expect(mineRows.some((rv) => rv.id === review.id)).toBe(true);

    // Restore.
    const restore = await app.inject({ method: 'PATCH', url: `/api/v1/admin/reviews/${review.id}/visibility`, headers: authed(admin.token), payload: { hidden: false } });
    expect(JSON.parse(restore.body).data.isHidden).toBe(false);
    const restored = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/reviews` });
    expect(JSON.parse(restored.body).data.reviewCount).toBe(1);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'Review', entityId: review.id, action: { in: ['REVIEW_HIDDEN', 'REVIEW_RESTORED'] } } });
    expect(audits.map((a) => a.action).sort()).toEqual(['REVIEW_HIDDEN', 'REVIEW_RESTORED']);
  });

  it('category updates are audit-logged including activate/deactivate', async () => {
    const admin = await registerAdminAndLogin(app);
    const fixtureSuffix = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/categories', headers: authed(admin.token), payload: { name: `Patio Furnishing ${fixtureSuffix()}` } });
    expect(created.statusCode).toBe(201);
    const { id } = JSON.parse(created.body).data as { id: string };

    const off = await app.inject({ method: 'PATCH', url: `/api/v1/admin/categories/${id}`, headers: authed(admin.token), payload: { isActive: false } });
    expect(off.statusCode).toBe(200);
    expect(JSON.parse(off.body).data.isActive).toBe(false);
    const on = await app.inject({ method: 'PATCH', url: `/api/v1/admin/categories/${id}`, headers: authed(admin.token), payload: { isActive: true } });
    expect(JSON.parse(on.body).data.isActive).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'Category', entityId: id, action: { in: ['CATEGORY_DEACTIVATED', 'CATEGORY_ACTIVATED'] } } });
    expect(audits.map((a) => a.action).sort()).toEqual(['CATEGORY_ACTIVATED', 'CATEGORY_DEACTIVATED']);
    const actor = audits.find((a) => a.action === 'CATEGORY_DEACTIVATED');
    expect(actor?.actorId).toBe(admin.userId);

    // Fixture cleanup: don't leave the created category in the shared test catalog.
    await prisma.category.deleteMany({ where: { id } });
  });
});
