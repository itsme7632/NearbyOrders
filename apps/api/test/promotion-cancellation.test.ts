import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { saveReceipt } from '../src/receiptStorage.js';

/**
 * Promotion cancellation: the owner can cancel their own promotion request
 * (PENDING or APPROVED) and their own PENDING promotion payment. Cancellation
 * is server-authoritative, audited, and never touches reviewed/active rows.
 * A cancelled request or payment must never surface as an active placement
 * on the customer-facing featured endpoint.
 */
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

let counter = 0;
const unique = (name: string) => `${name} ${Date.now()}-${++counter}`;

async function makePromotion(adminToken: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/promotions',
    headers: authed(adminToken),
    payload: {
      name: unique('Cancel Promo'),
      description: 'Cancellation test promotion',
      benefits: ['Featured placement'],
      priceMinor: 49900,
      currency: 'PKR',
      durationDays: 7,
      isActive: true,
      displayOrder: 1,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { id: string };
}

async function makeMethod() {
  return prisma.paymentMethod.create({
    data: {
      name: `Cancel Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

const validKey = () => saveReceipt(Buffer.from(`cancel-receipt-${randomUUID()}`), 'image/jpeg');

describe('promotion request cancellation', () => {
  it('owner can cancel a PENDING request', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: promo.id },
    });
    expect(applied.statusCode).toBe(201);
    const requestId = applied.json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/cancel`,
      headers: authed(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CANCELLED');

    const row = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe('CANCELLED');
  });

  it('owner can cancel an APPROVED request, and a pending payment is cancelled with it', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: promo.id },
    });
    const requestId = applied.json().data.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${requestId}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    const paid = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
      headers: authed(owner.token),
      payload: { paymentMethodId: method.id, transactionReference: `TX-CANCEL-${Date.now()}`, receiptStorageKey: await validKey() },
    });
    expect(paid.statusCode).toBe(201);
    const paymentId = paid.json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/cancel`,
      headers: authed(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CANCELLED');

    const payment = await prisma.promotionPaymentRequest.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('CANCELLED');
  });

  it('cannot cancel an ACTIVE request', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const requestId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
        payload: { promotionId: promo.id },
      })
    ).json().data.id as string;
    // Zero-price path would activate directly; force ACTIVE for the guard test.
    await prisma.promotionRequest.update({ where: { id: requestId }, data: { status: 'ACTIVE', activatedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/cancel`,
      headers: authed(owner.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_CANCELLABLE');
  });

  it('cannot cancel another business owner\u2019s request', async () => {
    const admin = await registerAdminAndLogin(app);
    const ownerA = await ownerWithBusiness();
    const ownerB = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const requestId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${ownerA.businessId}/promotion-requests`,
        headers: authed(ownerA.token),
        payload: { promotionId: promo.id },
      })
    ).json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${ownerB.businessId}/promotion-requests/${requestId}/cancel`,
      headers: authed(ownerB.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('promotion payment cancellation', () => {
  it('owner can cancel their own PENDING payment and resubmit afterwards', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const requestId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
        payload: { promotionId: promo.id },
      })
    ).json().data.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${requestId}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
      headers: authed(owner.token),
      payload: { paymentMethodId: method.id, transactionReference: `TX-RESUB-1-${Date.now()}`, receiptStorageKey: await validKey() },
    });
    expect(first.statusCode).toBe(201);
    const paymentId = first.json().data.id as string;

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests/${paymentId}/cancel`,
      headers: authed(owner.token),
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe('CANCELLED');

    // A corrected payment can be submitted after the cancellation.
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
      headers: authed(owner.token),
      payload: { paymentMethodId: method.id, transactionReference: `TX-RESUB-2-${Date.now()}`, receiptStorageKey: await validKey() },
    });
    expect(second.statusCode).toBe(201);
  });

  it('cannot cancel an APPROVED payment', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const requestId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
        payload: { promotionId: promo.id },
      })
    ).json().data.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${requestId}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    const paymentId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
        headers: authed(owner.token),
        payload: { paymentMethodId: method.id, transactionReference: `TX-NOCANCEL-${Date.now()}`, receiptStorageKey: await validKey() },
      })
    ).json().data.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-payment-requests/${paymentId}/approve`,
      headers: authed(admin.token),
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests/${paymentId}/cancel`,
      headers: authed(owner.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_PENDING');
  });
});

describe('cancelled promotions never surface as featured', () => {
  it('a cancelled request does not appear on GET /api/v1/featured-businesses', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token);
    const requestId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
        headers: authed(owner.token),
        payload: { promotionId: promo.id },
      })
    ).json().data.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/cancel`,
      headers: authed(owner.token),
    });

    const featured = await app.inject({ method: 'GET', url: '/api/v1/featured-businesses' });
    expect(featured.statusCode).toBe(200);
    const items = featured.json().data as Array<{ placementId: string }>;
    expect(items.some((i) => i.placementId === requestId)).toBe(false);
  });
});
