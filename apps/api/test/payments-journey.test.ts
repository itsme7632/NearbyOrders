/**
 * Phase 7B end-to-end journey (API-backed):
 * business owner without a subscription → picks a payment method → submits
 * proof (reference + receipt via the upload abstraction) → admin reviews →
 * approve activates the subscription and notifies the owner → duplicate
 * approval is blocked. Also the rejection path: subscription untouched,
 * reason shown to the owner, corrected resubmission succeeds.
 *
 * Mirrors the real manual workflow: nothing is "auto-activated" — only an
 * admin's review turns a payment request into an active subscription.
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { authed, makeApp, registerAndLogin, registerAdminAndLogin } from './helpers.js';

const app = await makeApp();

const submit = (token: string, businessId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/subscription/payment-requests`,
    headers: authed(token),
    payload: body,
  });

describe('manual payment → admin verification → activation journey', () => {
  it('runs the complete approve flow end to end', async () => {
    /* 1. Business owner logs in and onboards a business. */
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const categoriesRes = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    const categories = JSON.parse(categoriesRes.body).data as { id: string }[];
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `Payments Journey Salon ${Date.now()}`,
        description: 'Journey payments test',
        address: '9 Test Avenue',
        city: 'Karachi',
        categoryIds: [categories[0]!.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const business = JSON.parse(created.body).data as { id: string };

    /* 2. Subscription state: none yet — payment is required for access. */
    const subBefore = await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription`, headers: authed(owner.token) });
    expect(JSON.parse(subBefore.body).data).toBeNull();

    /* 3. Owner fetches the pay-in channels (server-configured, not hardcoded). */
    const methodsRes = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-methods', headers: authed(owner.token) });
    expect(methodsRes.statusCode).toBe(200);
    const methods = JSON.parse(methodsRes.body).data as { id: string; type: string; accountTitle: string; accountNumber: string }[];
    expect(methods.length).toBeGreaterThan(0);
    const easypaisa = methods.find((m) => m.type === 'EASYPAISA') ?? methods[0]!;
    expect(easypaisa.accountTitle).toBeTruthy();
    expect(easypaisa.accountNumber).toBeTruthy();

    /* 4. Owner submits proof: reference + receipt storage key from the
     *    upload abstraction (never an image URL the user typed). */
    const transactionReference = `JRN-EASY-${Date.now()}`;
    const submitted = await submit(owner.token, business.id, {
      paymentMethodId: easypaisa.id,
      transactionReference,
      receiptStorageKey: 'receipts/journey-easypaisa.jpg',
    });
    expect(submitted.statusCode).toBe(201);
    const payment = JSON.parse(submitted.body).data as { id: string; status: string; amountMinor: number; currency: string };
    expect(payment.status).toBe('PENDING');
    // Amount is the plan price computed server-side.
    expect(payment.amountMinor).toBe(299900);
    expect(payment.currency).toBe('PKR');

    /* 5. Owner sees it in their history as pending. */
    const history = await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription/payment-requests`, headers: authed(owner.token) });
    const historyItems = JSON.parse(history.body).data.items as { id: string; status: string }[];
    expect(historyItems.find((p) => p.id === payment.id)?.status).toBe('PENDING');

    /* 6. Admin logs in, opens the queue, opens the request and its receipt. */
    const admin = await registerAdminAndLogin(app);
    const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/payment-requests?status=PENDING', headers: authed(admin.token) });
    expect(queue.statusCode).toBe(200);
    const queued = JSON.parse(queue.body).data.items as { id: string; business: { id: string }; receiptStorageKey: string }[];
    const open = queued.find((p) => p.id === payment.id);
    expect(open?.business.id).toBe(business.id);
    expect(open?.receiptStorageKey).toBe('receipts/journey-easypaisa.jpg');

    /* 7. Admin approves → subscription becomes ACTIVE atomically. */
    const approve = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${payment.id}/approve`, headers: authed(admin.token) });
    expect(approve.statusCode).toBe(200);
    expect(JSON.parse(approve.body).data.status).toBe('APPROVED');

    const sub = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription`, headers: authed(owner.token) })).body,
    ).data as { status: string; plan: { monthlyPriceMinor: number } };
    expect(sub.status).toBe('ACTIVE');
    expect(sub.plan.monthlyPriceMinor).toBe(299900);

    /* 8. Owner receives the approval notification. */
    const notif = await prisma.notification.findFirst({ where: { userId: owner.userId, type: 'SUBSCRIPTION_PAYMENT_APPROVED', entityId: payment.id } });
    expect(notif?.title).toBe('Subscription payment approved');

    /* 9. Duplicate approval is blocked. */
    const approveAgain = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${payment.id}/approve`, headers: authed(admin.token) });
    expect(approveAgain.statusCode).toBe(409);
  });

  it('runs the rejection flow end to end: unchanged subscription, reason visible, resubmission works', async () => {
    /* Owner + business with no subscription. */
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const categoriesRes = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    const categories = JSON.parse(categoriesRes.body).data as { id: string }[];
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `Payments Reject Bakery ${Date.now()}`,
        description: 'Journey rejection test',
        address: '12 Mall Road',
        city: 'Lahore',
        categoryIds: [categories[0]!.id],
      },
    });
    const business = JSON.parse(created.body).data as { id: string };

    const methodRes = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-methods', headers: authed(owner.token) });
    const method = (JSON.parse(methodRes.body).data as { id: string; type: string }[]).find((m) => m.type === 'BANK_TRANSFER') ?? (JSON.parse(methodRes.body).data as { id: string }[])[0]!;

    /* First attempt: submitted, then rejected with a real reason. */
    const badRef = `JRN-BAD-${Date.now()}`;
    const first = JSON.parse((await submit(owner.token, business.id, { paymentMethodId: method.id, transactionReference: badRef, receiptStorageKey: 'receipts/journey-bad.jpg' })).body).data as { id: string };

    const admin = await registerAdminAndLogin(app);
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/subscription/payment-requests/${first.id}/reject`,
      headers: authed(admin.token),
      payload: { reason: 'Receipt does not match transaction reference.' },
    });
    expect(reject.statusCode).toBe(200);
    expect(JSON.parse(reject.body).data.rejectionReason).toBe('Receipt does not match transaction reference.');

    /* Subscription stays untouched (null — the owner never had one). */
    const sub = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription`, headers: authed(owner.token) })).body,
    ).data;
    expect(sub).toBeNull();

    /* Owner sees the rejection + reason in history and a notification. */
    const history = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription/payment-requests`, headers: authed(owner.token) })).body,
    ).data.items as { id: string; status: string; rejectionReason: string | null }[];
    const rejected = history.find((p) => p.id === first.id);
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.rejectionReason).toBe('Receipt does not match transaction reference.');
    const notif = await prisma.notification.findFirst({ where: { userId: owner.userId, type: 'SUBSCRIPTION_PAYMENT_REJECTED', entityId: first.id } });
    expect(notif?.message).toContain('Receipt does not match transaction reference.');

    /* Corrected resubmission → approval → ACTIVE. */
    const goodRef = `JRN-GOOD-${Date.now()}`;
    const second = JSON.parse((await submit(owner.token, business.id, { paymentMethodId: method.id, transactionReference: goodRef, receiptStorageKey: 'receipts/journey-good.jpg' })).body).data as { id: string };
    const approve2 = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${second.id}/approve`, headers: authed(admin.token) });
    expect(approve2.statusCode).toBe(200);
    const sub2 = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/subscription`, headers: authed(owner.token) })).body,
    ).data as { status: string };
    expect(sub2.status).toBe('ACTIVE');
  });
});
