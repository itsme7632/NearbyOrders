import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import type { PaymentMethodType } from '@prisma/client';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

async function makeMethod(overrides: Partial<{ name: string; type: PaymentMethodType; isActive: boolean; displayOrder: number; qrImageUrl: string | null }> = {}) {
  return prisma.paymentMethod.create({
    data: {
      name: `Meta Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'EASYPAISA',
      accountTitle: 'NearbyOrders Test',
      accountNumber: '03000000000',
      displayOrder: 50,
      isActive: true,
      ...overrides,
    },
  });
}

async function ownerWithBusiness() {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, owner.token);
  return { ...owner, businessId: business.id };
}

const submit = (token: string, businessId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/subscription/payment-requests`,
    headers: authed(token),
    payload: body,
  });

describe('payment request metadata (paidAt / note)', () => {
  it('owner submits with paidAt and note; both are echoed back', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const method = await makeMethod();
    const paidAt = new Date(Date.now() - 3600_000).toISOString();
    const res = await submit(token, businessId, {
      paymentMethodId: method.id,
      transactionReference: `META-${Date.now()}`,
      receiptStorageKey: 'receipts/meta.jpg',
      paidAt,
      note: 'Paid via Easypaisa app, ref confirmed',
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.paidAt).toBe(paidAt);
    expect(data.note).toBe('Paid via Easypaisa app, ref confirmed');
  });

  it('paidAt stays null when omitted (submission time is in submittedAt)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const method = await makeMethod();
    const res = await submit(token, businessId, {
      paymentMethodId: method.id,
      transactionReference: `META-DFLT-${Date.now()}`,
      receiptStorageKey: 'receipts/meta.jpg',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.paidAt).toBeNull();
    expect(res.json().data.note).toBeNull();
    expect(Date.parse(res.json().data.submittedAt)).toBeGreaterThanOrEqual(Date.now() - 10_000);
  });

  it('future paidAt and overlong notes are rejected', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const method = await makeMethod();
    const future = await submit(token, businessId, {
      paymentMethodId: method.id,
      transactionReference: `META-FUT-${Date.now()}`,
      receiptStorageKey: 'receipts/meta.jpg',
      paidAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(future.statusCode).toBe(400);
    const longNote = await submit(token, businessId, {
      paymentMethodId: method.id,
      transactionReference: `META-LONG-${Date.now()}`,
      receiptStorageKey: 'receipts/meta.jpg',
      note: 'x'.repeat(501),
    });
    expect(longNote.statusCode).toBe(400);
  });
});

describe('admin payment-request filters', () => {
  it('filters by status, businessId, paymentMethodId, q and date range', async () => {
    const admin = await registerAdminAndLogin(app);
    const ownerA = await ownerWithBusiness();
    const ownerB = await ownerWithBusiness();
    const method = await makeMethod();
    const ref = `FILT-${Date.now()}`;
    await submit(ownerA.token, ownerA.businessId, {
      paymentMethodId: method.id,
      transactionReference: ref,
      receiptStorageKey: 'receipts/f.jpg',
    });
    const byQ = await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/payment-requests?q=${ref}`, headers: authed(admin.token) });
    expect(byQ.statusCode).toBe(200);
    expect(byQ.json().data.items.map((r: { transactionReference: string }) => r.transactionReference)).toContain(ref);
    const byBusiness = await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/payment-requests?businessId=${ownerB.businessId}`, headers: authed(admin.token) });
    expect(byBusiness.json().data.items.every((r: { businessId: string }) => r.businessId === ownerB.businessId)).toBe(true);
    expect(byBusiness.json().data.items.map((r: { transactionReference: string }) => r.transactionReference)).not.toContain(ref);
    const byMethod = await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/payment-requests?paymentMethodId=${method.id}`, headers: authed(admin.token) });
    expect(byMethod.json().data.items.map((r: { transactionReference: string }) => r.transactionReference)).toContain(ref);
    const byStatus = await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/payment-requests?status=PENDING', headers: authed(admin.token) });
    expect(byStatus.json().data.items.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    const from = encodeURIComponent(new Date(Date.now() - 600_000).toISOString());
    const to = encodeURIComponent(new Date(Date.now() + 600_000).toISOString());
    const byRange = await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/payment-requests?from=${from}&to=${to}`, headers: authed(admin.token) });
    expect(byRange.json().data.items.map((r: { transactionReference: string }) => r.transactionReference)).toContain(ref);
    const outside = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/subscription/payment-requests?from=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`,
      headers: authed(admin.token),
    });
    expect(outside.json().data.items.map((r: { transactionReference: string }) => r.transactionReference)).not.toContain(ref);
  });
});

describe('canonical admin payment-method routes', () => {
  it('canonical and legacy routes expose the same behavior', async () => {
    const admin = await registerAdminAndLogin(app);
    const legacy = await app.inject({ method: 'GET', url: '/api/v1/admin/payment-methods', headers: authed(admin.token) });
    const canonical = await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/payment-methods', headers: authed(admin.token) });
    expect(legacy.statusCode).toBe(200);
    expect(canonical.statusCode).toBe(200);
    expect(canonical.json().data).toEqual(legacy.json().data);
  });

  it('admin creates an OTHER-type method with a QR image URL', async () => {
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/subscription/payment-methods',
      headers: authed(admin.token),
      payload: {
        name: 'QR Counter Pay',
        type: 'OTHER',
        accountTitle: 'NearbyOrders Counter',
        accountNumber: 'QR-001',
        qrImageUrl: 'https://cdn.example.com/qr.png',
        displayOrder: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.type).toBe('OTHER');
    expect(res.json().data.qrImageUrl).toBe('https://cdn.example.com/qr.png');
    // Owners see the QR URL in the public catalog.
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const catalog = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-methods', headers: authed(owner.token) });
    const entry = catalog.json().data.find((m: { id: string }) => m.id === res.json().data.id);
    expect(entry.qrImageUrl).toBe('https://cdn.example.com/qr.png');
  });
});

describe('admin business DTO', () => {
  it('includes verificationStatus, trialStatus and the evaluated subscriptionStatus', async () => {
    const admin = await registerAdminAndLogin(app);
    const { token, businessId } = await ownerWithBusiness();
    await prisma.business.update({ where: { id: businessId }, data: { trialStatus: 'ELIGIBLE' } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/subscription/trial/apply`,
      headers: authed(token),
      payload: { planSlug: 'nearbyorders-business' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((b: { id: string }) => b.id === businessId);
    expect(row).toBeTruthy();
    expect(row.verificationStatus).toBe('NOT_SUBMITTED');
    expect(row.trialStatus).toBe('ACTIVE');
    expect(row.subscriptionStatus).toBe('TRIAL');
    // A business that never subscribed reports nulls.
    const plain = await ownerWithBusiness();
    const res2 = await app.inject({ method: 'GET', url: '/api/v1/admin/businesses', headers: authed(admin.token) });
    const plainRow = res2.json().data.find((b: { id: string }) => b.id === plain.businessId);
    expect(plainRow.subscriptionStatus).toBeNull();
    expect(plainRow.trialStatus).toBe('NOT_ELIGIBLE');
  });
});
