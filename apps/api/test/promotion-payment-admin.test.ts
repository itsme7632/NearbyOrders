import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { saveReceipt } from '../src/receiptStorage.js';

/**
 * Admin promotion-payment workflow: the admin review queue must carry
 * everything needed to verify a payment (business identity, promotion
 * details incl. catalog price/duration), and the payment record must link
 * business + request + promotion + server-computed amount + method +
 * reference + receipt + paidAt + status. Companion to
 * promotion-lifecycle.test.ts (which covers the happy path end to end).
 */
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

let counter = 0;
const unique = (name: string) => `${name} ${Date.now()}-${++counter}`;

async function makePromotion(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/promotions',
    headers: authed(adminToken),
    payload: {
      name: unique('AdminPay Promo'),
      description: 'Test promotion',
      benefits: ['Featured placement'],
      priceMinor: 49900,
      currency: 'PKR',
      durationDays: 7,
      isActive: true,
      displayOrder: 1,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { id: string; priceMinor: number | null };
}

async function makeMethod() {
  return prisma.paymentMethod.create({
    data: {
      name: `AdminPay Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

const validKey = () => saveReceipt(Buffer.from(`fake-receipt-bytes-${randomUUID()}`), 'image/jpeg');

const submitPayment = (owner: { token: string; businessId: string }, requestId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${requestId}/payment-requests`,
    headers: authed(owner.token),
    payload: body,
  });

const paymentBody = async (methodId: string, ref: string, extra: Record<string, unknown> = {}) => ({
  paymentMethodId: methodId,
  transactionReference: ref,
  receiptStorageKey: await validKey(),
  ...extra,
});

describe('admin promotion-payment workflow: persistence and DTO completeness', () => {
  it('submitted payment persists linked to business + request + promotion + amount + method + reference + receipt + paidAt + status', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    const paidAt = new Date(Date.now() - 60_000).toISOString();
    const ref = `TX-PERSIST-${Date.now()}`;
    const key = await validKey();
    const res = await submitPayment(owner, request.id, { paymentMethodId: method.id, transactionReference: ref, receiptStorageKey: key, paidAt, note: 'Paid via easypaisa' });
    expect(res.statusCode).toBe(201);
    const payment = res.json().data as { id: string };

    const row = await prisma.promotionPaymentRequest.findUniqueOrThrow({
      where: { id: payment.id },
      include: { promotionRequest: { include: { promotion: true } }, business: true, paymentMethod: true },
    });
    expect(row.businessId).toBe(owner.businessId);
    expect(row.promotionRequestId).toBe(request.id);
    expect(row.promotionRequest.promotion.id).toBe(promo.id);
    expect(row.amountMinor).toBe(49900);
    expect(row.currency).toBe('PKR');
    expect(row.paymentMethodId).toBe(method.id);
    expect(row.transactionReference).toBe(ref);
    expect(row.receiptStorageKey).toBe(key);
    expect(row.paidAt).not.toBeNull();
    expect(row.status).toBe('PENDING');
    expect(row.submittedAt).not.toBeNull();
  });

  it('a client-sent amount is ignored: the stored amount is always the server-computed catalog price', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token, { priceMinor: 75000 });
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    // The schema has no amount field at all; a tampered amountMinor is stripped.
    const res = await submitPayment(owner, request.id, (await paymentBody(method.id, `TX-TAMPER-${Date.now()}`, { amountMinor: 1, priceMinor: 1 })));
    expect(res.statusCode).toBe(201);
    const payment = res.json().data as { id: string; amountMinor: number };
    expect(payment.amountMinor).toBe(75000);
    const row = await prisma.promotionPaymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.amountMinor).toBe(75000);
  });

  it('an arbitrary receipt key is rejected: receipts must come from the upload endpoint', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    for (const bad of ['not-a-key', 'https://evil.example/r.jpg', 'receipts/ok but spaces.jpg', '']) {
      const res = await submitPayment(owner, request.id, { paymentMethodId: method.id, transactionReference: `TX-BAD-${Date.now()}`, receiptStorageKey: bad });
      expect(res.statusCode).toBe(400);
    }
  });

  it('a well-formed but nonexistent receipt key is rejected: no dangling references persist', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    const ghostKey = `receipts/${randomUUID()}.jpg`;
    const res = await submitPayment(owner, request.id, { paymentMethodId: method.id, transactionReference: `TX-GHOST-${Date.now()}`, receiptStorageKey: ghostKey });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('RECEIPT_NOT_FOUND');
    const row = await prisma.promotionPaymentRequest.findFirst({ where: { promotionRequestId: request.id } });
    expect(row).toBeNull();
  });

  it('admin list and detail expose business identity and full promotion details (incl. catalog price/duration)', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token, { priceMinor: 49900, durationDays: 7 });
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, (await paymentBody(method.id, `TX-DTO-${Date.now()}`)))).json().data as { id: string };

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotion-payment-requests?status=PENDING',
      headers: authed(admin.token),
    });
    expect(queue.statusCode).toBe(200);
    const item = (queue.json().data.items as { id: string }[]).find((p) => p.id === payment.id);
    expect(item).toBeDefined();
    const dto = item as unknown as {
      business: { id: string; name: string };
      promotion: { id: string; name: string; slug: string; priceMinor: number | null; durationDays: number | null };
      promotionRequest: { id: string; status: string };
      amountMinor: number;
    };
    expect(dto.business.id).toBe(owner.businessId);
    expect(dto.business.name).toBeTruthy();
    expect(dto.promotion.id).toBe(promo.id);
    expect(dto.promotion.name).toBeTruthy();
    expect(dto.promotion.slug).toBeTruthy();
    expect(dto.promotion.priceMinor).toBe(49900);
    expect(dto.promotion.durationDays).toBe(7);
    expect(dto.promotionRequest.id).toBe(request.id);
    expect(dto.amountMinor).toBe(49900);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotion-payment-requests/${payment.id}`,
      headers: authed(admin.token),
    });
    expect(detail.statusCode).toBe(200);
    const detailDto = detail.json().data as typeof dto;
    expect(detailDto.business.name).toBeTruthy();
    expect(detailDto.promotion.priceMinor).toBe(49900);
  });

  it('admin promotion-payment detail is admin-only', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const method = await makeMethod();
    const promo = await makePromotion(admin.token);
    const request = (await applyFor(owner, promo.id)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });
    const payment = (await submitPayment(owner, request.id, (await paymentBody(method.id, `TX-AUTH-${Date.now()}`)))).json().data as { id: string };

    expect((await app.inject({ method: 'GET', url: `/api/v1/admin/promotion-payment-requests/${payment.id}`, headers: authed(owner.token) })).statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/admin/promotion-payment-requests/${payment.id}` });
    expect([401, 403]).toContain(anon.statusCode);
  });
});
