import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

let promoCounter = 0;
const unique = (name: string) => `${name} ${Date.now()}-${++promoCounter}`;

async function makePromotion(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/promotions',
    headers: authed(adminToken),
    payload: {
      name: unique('Promo'),
      description: 'Test promotion',
      benefits: ['Homepage feature'],
      priceMinor: 49900,
      currency: 'PKR',
      durationDays: 7,
      isActive: true,
      displayOrder: 1,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { id: string; priceMinor: number | null; durationDays: number | null };
}

async function makeMethod() {
  return prisma.paymentMethod.create({
    data: {
      name: `Lifecycle Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'EASYPAISA',
      accountTitle: 'NearbyOrders Test',
      accountNumber: '03000000000',
      isActive: true,
    },
  });
}

async function ownerWithBusiness() {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, owner.token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
  return { ...owner, businessId: business.id };
}

const applyFor = (owner: { token: string; businessId: string }, promotionId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
    headers: authed(owner.token),
    payload: { promotionId },
  });

const submitPayment = (owner: { token: string; businessId: string }, requestId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
    headers: authed(owner.token),
    payload: body,
  });

const paymentBody = (methodId: string, ref: string) => ({
  paymentMethodId: methodId,
  transactionReference: ref,
  receiptStorageKey: `receipts/${ref}.jpg`,
});

describe('promotion monetization: full paid lifecycle', () => {
  it('apply -> approve -> payment required -> submit -> approve payment -> ACTIVE with server-computed dates', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token, { priceMinor: 49900, durationDays: 7 });

    // 1. Business applies.
    const applied = await applyFor(owner, promo.id);
    expect(applied.statusCode).toBe(201);
    const request = applied.json().data;
    expect(request.status).toBe('PENDING');
    expect(request.lifecycleState).toBe('PENDING_REVIEW');
    expect(request.amountDueMinor).toBe(49900);

    // 2. Admin approves the APPLICATION: paid promotion must NOT activate.
    const beforeApprove = new Date();
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    const approvedData = approved.json().data;
    expect(approvedData.status).toBe('APPROVED');
    expect(approvedData.activatedAt).toBeNull();
    expect(approvedData.expiresAt).toBeNull();

    // 3. Business sees PAYMENT_REQUIRED with the server amount.
    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
    });
    const mineData = mine.json().data.find((r: { id: string }) => r.id === request.id);
    expect(mineData.lifecycleState).toBe('PAYMENT_REQUIRED');
    expect(mineData.amountDueMinor).toBe(49900);
    expect(mineData.paymentStatus).toBeNull();

    // 4. Business submits payment. There is no amount field to tamper with.
    const submitted = await submitPayment(owner, request.id, paymentBody(method.id, `TX-LC-${Date.now()}`));
    expect(submitted.statusCode).toBe(201);
    const payment = submitted.json().data;
    expect(payment.status).toBe('PENDING');
    expect(payment.amountMinor).toBe(49900); // server-computed catalog price

    const afterSubmit = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
      })
    ).json().data.find((r: { id: string }) => r.id === request.id);
    expect(afterSubmit.lifecycleState).toBe('PAYMENT_UNDER_REVIEW');
    expect(afterSubmit.paymentStatus).toBe('PENDING');

    // 5. Admin sees the payment in the review queue (paginated envelope).
    const queue = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotion-payment-requests?status=PENDING`,
      headers: authed(admin.token),
    });
    expect(queue.statusCode).toBe(200);
    const items = queue.json().data.items;
    expect(items.some((p: { id: string }) => p.id === payment.id)).toBe(true);
    const queued = items.find((p: { id: string }) => p.id === payment.id);
    expect(queued.promotion.name).toBeDefined();
    expect(queued.business.name).toBeDefined();
    expect(queued.amountMinor).toBe(49900);

    // 6. Admin approves the payment: promotion becomes ACTIVE, dates are server-set.
    const beforeActivate = new Date();
    const payApproved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    expect(payApproved.statusCode).toBe(200);
    expect(payApproved.json().data.status).toBe('APPROVED');

    const final = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
      })
    ).json().data.find((r: { id: string }) => r.id === request.id);
    expect(final.status).toBe('ACTIVE');
    expect(final.lifecycleState).toBe('ACTIVE');
    const activatedAt = new Date(final.activatedAt);
    const expiresAt = new Date(final.expiresAt);
    // Activation happened now (not at application/approval time), server-side.
    expect(activatedAt.getTime()).toBeGreaterThanOrEqual(beforeActivate.getTime() - 5000);
    expect(activatedAt.getTime()).toBeGreaterThan(new Date(request.createdAt).getTime());
    // Duration measured from activation: 7 days.
    expect(expiresAt.getTime() - activatedAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    // 7. Owner got the activation notification.
    const notif = await prisma.notification.findFirst({
      where: { userId: owner.userId, type: 'PROMOTION_ACTIVATED', entityId: request.id },
    });
    expect(notif).not.toBeNull();
  });

  it('approving an already-reviewed payment is rejected', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, paymentBody(method.id, `TX-DUP-${Date.now()}`))).json().data;
    const first = await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`, headers: authed(admin.token), payload: {} });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`, headers: authed(admin.token), payload: {} });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('NOT_PENDING');
  });
});

describe('promotion monetization: rejections', () => {
  it('rejected application -> REJECTED; business may re-apply afterwards', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/reject`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Not eligible this month' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('REJECTED');

    const mine = (
      await app.inject({ method: 'GET', url: `/api/v1/businesses/${owner.businessId}/promotion-requests`, headers: authed(owner.token) })
    ).json().data.find((r: { id: string }) => r.id === request.id);
    expect(mine.lifecycleState).toBe('REJECTED');
    expect(mine.reviewerMessage).toBe('Not eligible this month');

    // Re-apply is allowed after a decision.
    const retry = await applyFor(owner, promo.id);
    expect(retry.statusCode).toBe(201);
  });

  it('rejected payment keeps the request APPROVED and payable; business can resubmit', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, paymentBody(method.id, `TX-REJ-${Date.now()}`))).json().data;

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-payment-requests/${payment.id}/reject`,
      headers: authed(admin.token),
      payload: { reason: 'Receipt unreadable' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('REJECTED');
    expect(rejected.json().data.rejectionReason).toBe('Receipt unreadable');

    // Request stays APPROVED (never activated by a rejection) and is payable again.
    const row = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.activatedAt).toBeNull();

    const mine = (
      await app.inject({ method: 'GET', url: `/api/v1/businesses/${owner.businessId}/promotion-requests`, headers: authed(owner.token) })
    ).json().data.find((r: { id: string }) => r.id === request.id);
    expect(mine.lifecycleState).toBe('PAYMENT_REQUIRED');
    expect(mine.lastPaymentRejected).toBe(true);

    const resubmit = await submitPayment(owner, request.id, paymentBody(method.id, `TX-REJ2-${Date.now()}`));
    expect(resubmit.statusCode).toBe(201);
  });
});

describe('promotion monetization: free promotions', () => {
  it('zero-price promotion activates directly on application approval; payment is refused', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token, { priceMinor: 0, durationDays: 14 });
    const request = (await applyFor(owner, promo.id)).json().data;

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    const data = approved.json().data;
    expect(data.status).toBe('ACTIVE');
    expect(data.activatedAt).not.toBeNull();
    const activatedAt = new Date(data.activatedAt);
    const expiresAt = new Date(data.expiresAt);
    expect(expiresAt.getTime() - activatedAt.getTime()).toBe(14 * 24 * 60 * 60 * 1000);

    // No payment screen for a free promotion: submission is refused.
    const pay = await submitPayment(owner, request.id, paymentBody(method.id, `TX-FREE-${Date.now()}`));
    expect(pay.statusCode).toBe(400);
    expect(pay.json().error.code).toBe('PAYMENT_NOT_REQUIRED');
  });
});

describe('promotion monetization: guards', () => {
  it('duplicate applications are blocked while PENDING, APPROVED or ACTIVE', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const first = await applyFor(owner, promo.id);
    expect(first.statusCode).toBe(201);
    const dupPending = await applyFor(owner, promo.id);
    expect(dupPending.statusCode).toBe(409);
    expect(dupPending.json().error.code).toBe('REQUEST_ALREADY_PENDING');

    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${first.json().data.id}/approve`, headers: authed(admin.token), payload: {} });
    const dupApproved = await applyFor(owner, promo.id);
    expect(dupApproved.statusCode).toBe(409);
  });

  it('duplicate payment submissions are blocked while one is PENDING', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const first = await submitPayment(owner, request.id, paymentBody(method.id, `TX-P1-${Date.now()}`));
    expect(first.statusCode).toBe(201);
    const second = await submitPayment(owner, request.id, paymentBody(method.id, `TX-P2-${Date.now()}`));
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('PAYMENT_ALREADY_PENDING');
  });

  it('payment cannot be submitted before the application is approved', async () => {
    const owner = await ownerWithBusiness();
    const admin = await registerAdminAndLogin(app);
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    const res = await submitPayment(owner, request.id, paymentBody(method.id, `TX-EARLY-${Date.now()}`));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_PAYABLE');
  });

  it('payment approval is refused when the application is not APPROVED', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, paymentBody(method.id, `TX-STALE-${Date.now()}`))).json().data;
    // Application gets rejected out-of-band; the payment must not activate it.
    await prisma.promotionRequest.update({ where: { id: request.id }, data: { status: 'REJECTED' } });
    const res = await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`, headers: authed(admin.token), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REQUEST_NOT_APPROVED');
    const row = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('REJECTED');
  });

  it('the same transaction reference cannot be approved twice', async () => {
    const admin = await registerAdminAndLogin(app);
    const ownerA = await ownerWithBusiness();
    const ownerB = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const ref = `TX-CLASH-${Date.now()}`;

    const reqA = (await applyFor(ownerA, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${reqA.id}/approve`, headers: authed(admin.token), payload: {} });
    const payA = (await submitPayment(ownerA, reqA.id, paymentBody(method.id, ref))).json().data;

    const reqB = (await applyFor(ownerB, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${reqB.id}/approve`, headers: authed(admin.token), payload: {} });
    const payB = (await submitPayment(ownerB, reqB.id, paymentBody(method.id, ref))).json().data;

    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payA.id}/approve`, headers: authed(admin.token), payload: {} })).statusCode).toBe(200);
    const clash = await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payB.id}/approve`, headers: authed(admin.token), payload: {} });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('REFERENCE_ALREADY_APPROVED');
  });
});

describe('promotion monetization: authorization', () => {
  it('businesses cannot touch other businesses\u2019 requests or payments', async () => {
    const admin = await registerAdminAndLogin(app);
    const ownerA = await ownerWithBusiness();
    const ownerB = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(ownerA, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    // Owner B cannot submit a payment against A's request.
    const foreign = await submitPayment(ownerB, request.id, paymentBody(method.id, `TX-F-${Date.now()}`));
    expect(foreign.statusCode).toBe(404);

    // Owner B cannot list A's payments (scoped lookup -> 404, no existence leak).
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${ownerA.businessId}/promotion-requests/${request.id}/payment-requests`,
      headers: authed(ownerB.token),
    });
    expect(list.statusCode).toBe(404);

    // Owner B cannot read A's request list (scoped lookup -> 404, no existence leak).
    const reqs = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${ownerA.businessId}/promotion-requests`,
      headers: authed(ownerB.token),
    });
    expect(reqs.statusCode).toBe(404);
  });

  it('non-admins cannot use the admin promotion payment endpoints', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, paymentBody(method.id, `TX-NA-${Date.now()}`))).json().data;

    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/promotion-payment-requests', headers: authed(owner.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`, headers: authed(owner.token), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-payment-requests/${payment.id}/reject`, headers: authed(owner.token), payload: {} })).statusCode).toBe(403);
  });

  it('admin cannot approve a business payment application decision (owner endpoints stay owner-scoped)', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    // Admins act through the admin endpoints; the owner apply endpoint requires ownership.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(admin.token),
      payload: { promotionId: promo.id },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('promotion monetization: expiry', () => {
  it('an ACTIVE promotion past its end date reads as EXPIRED (server-side transition on access)', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token, { priceMinor: 0, durationDays: 7 });
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    // Simulate time passing: the promotion ended yesterday.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.promotionRequest.update({
      where: { id: request.id },
      data: { activatedAt: new Date(past.getTime() - 7 * 24 * 60 * 60 * 1000), expiresAt: past },
    });

    const mine = (
      await app.inject({ method: 'GET', url: `/api/v1/businesses/${owner.businessId}/promotion-requests`, headers: authed(owner.token) })
    ).json().data.find((r: { id: string }) => r.id === request.id);
    expect(mine.status).toBe('EXPIRED');
    expect(mine.lifecycleState).toBe('EXPIRED');

    const row = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('EXPIRED');

    // Admin queue also reflects the transition.
    const queued = (
      await app.inject({ method: 'GET', url: '/api/v1/admin/promotion-requests?status=EXPIRED', headers: authed(admin.token) })
    ).json().data;
    expect(queued.some((r: { id: string }) => r.id === request.id)).toBe(true);
  });
});
