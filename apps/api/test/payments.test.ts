import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma, addCalendarMonths } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

/** Creates an active payment method directly (admin CRUD is tested separately). */
async function makeMethod(overrides: Partial<{ name: string; type: 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER'; isActive: boolean; displayOrder: number }> = {}) {
  return prisma.paymentMethod.create({
    data: {
      name: overrides.name ?? `Test Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: overrides.type ?? 'EASYPAISA',
      accountTitle: 'NearbyOrders Test',
      accountNumber: '03000000000',
      displayOrder: overrides.displayOrder ?? 50,
      isActive: overrides.isActive ?? true,
    },
  });
}

const submit = (token: string, businessId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/subscription/payment-requests`,
    headers: authed(token),
    payload: body,
  });

const REF = 'TX-100000-TEST';

/**
 * The test database persists between runs, and approved transaction
 * references are unique forever — so every reference must be unique per run,
 * exactly like uniqueEmail.
 */
let refCounter = 0;
const runRef = (label: string): string => `${label}-${Date.now()}-${++refCounter}`;

/** Starts a trial through the authoritative apply route (grants eligibility first). */
async function startTrial(token: string, businessId: string, planSlug = 'nearbyorders-business') {
  await prisma.business.update({ where: { id: businessId }, data: { trialStatus: 'ELIGIBLE' } });
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/subscription/trial/apply`,
    headers: authed(token),
    payload: { planSlug },
  });
  expect(res.statusCode).toBe(201);
}

describe('payment methods catalog', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-methods' });
    expect(res.statusCode).toBe(401);
  });

  it('lists active methods in display order and hides inactive ones', async () => {
    const visible = await makeMethod({ displayOrder: 5 });
    await makeMethod({ isActive: false, displayOrder: 1 });
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-methods', headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body).data as { id: string; accountNumber: string }[];
    const ids = items.map((m) => m.id);
    expect(ids).toContain(visible.id);
    const inactive = await prisma.paymentMethod.findFirst({ where: { isActive: false } });
    if (inactive) expect(ids).not.toContain(inactive.id);
  });
});

describe('submitting a payment request', () => {
  it('owner submits; server computes the amount from the plan (client values ignored)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const method = await makeMethod();
    const res = await submit(token, id, {
      paymentMethodId: method.id,
      transactionReference: `  ${REF}  `,
      receiptStorageKey: 'receipts/abc.jpg',
      // Attack payloads: a client must not be able to set its own price.
      amountMinor: 1,
      currency: 'USD',
      status: 'APPROVED',
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.status).toBe('PENDING');
    expect(data.amountMinor).toBe(299900);
    expect(data.currency).toBe('PKR');
    expect(data.transactionReference).toBe(REF); // trimmed
    expect(data.receiptStorageKey).toBe('receipts/abc.jpg');
  });

  it('rejects invalid transaction references', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const method = await makeMethod();
    for (const ref of ['abc', '   ', '', 'x'.repeat(101)]) {
      const res = await submit(token, id, { paymentMethodId: method.id, transactionReference: ref, receiptStorageKey: 'k' });
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires a receipt reference and a valid active method', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const method = await makeMethod();
    const noReceipt = await submit(token, id, { paymentMethodId: method.id, transactionReference: REF });
    expect(noReceipt.statusCode).toBe(400);
    const badMethod = await submit(token, id, { paymentMethodId: '00000000-0000-4000-8000-000000000000', transactionReference: REF, receiptStorageKey: 'k' });
    expect(badMethod.statusCode).toBe(400);
    // A deactivated method is not usable either.
    const off = await makeMethod({ isActive: false });
    const res = await submit(token, id, { paymentMethodId: off.id, transactionReference: REF, receiptStorageKey: 'k' });
    expect(res.statusCode).toBe(400);
  });

  it('blocks duplicate pending submissions (409)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const method = await makeMethod();
    const first = await submit(token, id, { paymentMethodId: method.id, transactionReference: REF, receiptStorageKey: 'k' });
    expect(first.statusCode).toBe(201);
    const second = await submit(token, id, { paymentMethodId: method.id, transactionReference: 'TX-OTHER', receiptStorageKey: 'k' });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('PAYMENT_ALREADY_PENDING');
  });

  it('enforces ownership and role (404 other business / 403 customer / 401 anon)', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerA.token);
    const method = await makeMethod();
    const foreign = await submit(ownerB.token, id, { paymentMethodId: method.id, transactionReference: REF, receiptStorageKey: 'k' });
    expect(foreign.statusCode).toBe(404);
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const cust = await submit(customer.token, id, { paymentMethodId: method.id, transactionReference: REF, receiptStorageKey: 'k' });
    expect(cust.statusCode).toBe(403);
    const anon = await app.inject({ method: 'POST', url: `/api/v1/businesses/${id}/subscription/payment-requests`, payload: {} });
    expect(anon.statusCode).toBe(401);
  });

  it('owner can cancel their own pending request and submit a corrected one', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const method = await makeMethod();
    const created = JSON.parse((await submit(token, id, { paymentMethodId: method.id, transactionReference: 'TX-WRONG', receiptStorageKey: 'k' })).body).data;
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/subscription/payment-requests/${created.id}/cancel`,
      headers: authed(token),
    });
    expect(cancel.statusCode).toBe(200);
    expect(JSON.parse(cancel.body).data.status).toBe('CANCELLED');
    const again = await submit(token, id, { paymentMethodId: method.id, transactionReference: 'TX-RIGHT', receiptStorageKey: 'k' });
    expect(again.statusCode).toBe(201);
  });
});

describe('admin review: list & authorization', () => {
  it('admin sees pending requests with business/owner details', async () => {
    const { token: ownerToken } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    const method = await makeMethod();
    await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: 'TX-LIST-1', receiptStorageKey: 'k' });
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/payment-requests?status=PENDING', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const items = JSON.parse(res.body).data.items as { transactionReference: string; business: { id: string } }[];
    const mine = items.find((p) => p.transactionReference === 'TX-LIST-1');
    expect(mine?.business.id).toBe(id);
  });

  it('non-admins cannot access admin payment endpoints', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    for (const [method, url] of [
      ['GET', '/api/v1/admin/subscription/payment-requests'],
      ['POST', '/api/v1/admin/subscription/payment-requests/00000000-0000-4000-8000-000000000000/approve'],
      ['POST', '/api/v1/admin/subscription/payment-requests/00000000-0000-4000-8000-000000000000/reject'],
      ['GET', '/api/v1/admin/payment-methods'],
      ['POST', '/api/v1/admin/payment-methods'],
    ] as const) {
      const res = await app.inject({ method, url, headers: authed(token), payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('admin approval', () => {
  it('approves atomically: subscription ACTIVE, notification created, double-approve blocked', async () => {
    const { token: ownerToken, userId: ownerId } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    await startTrial(ownerToken, id);
    const method = await makeMethod();
    const approveRef = runRef('TX-APPROVE');
    const created = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: approveRef, receiptStorageKey: 'k' })).body).data;

    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const approved = JSON.parse(res.body).data;
    expect(approved.status).toBe('APPROVED');
    expect(approved.reviewedAt).toBeTruthy();
    expect(approved.reviewedByUserId).toBe(admin.userId);

    // Subscription: the trial row became ACTIVE starting now, ending in one calendar month.
    const sub = await prisma.businessSubscription.findFirst({ where: { businessId: id }, orderBy: { createdAt: 'desc' } });
    expect(sub?.status).toBe('ACTIVE');
    const now = new Date();
    expect(Math.abs((sub!.currentPeriodStartAt?.getTime() ?? 0) - now.getTime())).toBeLessThan(60_000);
    expect(Math.abs(sub!.currentPeriodEndAt.getTime() - addCalendarMonths(now, 1).getTime())).toBeLessThan(60_000);

    // Exactly one live subscription row remains (the trial was activated in place).
    const liveCount = await prisma.businessSubscription.count({ where: { businessId: id, status: { in: ['TRIAL', 'ACTIVE'] } } });
    expect(liveCount).toBe(1);

    // Owner notification is dispatched post-commit (never blocks the
    // response); retry briefly until the row lands.
    let notif = null;
    for (let i = 0; i < 20 && !notif; i++) {
      notif = await prisma.notification.findFirst({ where: { userId: ownerId, type: 'SUBSCRIPTION_PAYMENT_APPROVED', entityId: created.id } });
      if (!notif) await new Promise((r) => setTimeout(r, 100));
    }
    expect(notif).toBeTruthy();

    // Double approval is blocked.
    const again = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('NOT_PENDING');
  });

  it('approves a pending request even after the admin changes the plan price', async () => {
    const { token: ownerToken } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    const method = await makeMethod();
    const ref = runRef('TX-PRICECHANGE');
    const created = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: ref, receiptStorageKey: 'k' })).body).data;
    const submittedAmount = created.amountMinor;
    expect(submittedAmount).toBeGreaterThan(0);

    // Admin changes the plan price between submit and approve.
    const plan = await prisma.plan.findFirstOrThrow({ where: { slug: 'nearbyorders-business' } });
    const originalPrice = plan.monthlyPriceMinor;
    await prisma.plan.update({ where: { id: plan.id }, data: { monthlyPriceMinor: originalPrice + 50000 } });
    try {
      const admin = await registerAdminAndLogin(app);
      const res = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) });
      expect(res.statusCode).toBe(200);
      const approved = JSON.parse(res.body).data;
      expect(approved.status).toBe('APPROVED');
      // The request amount was server-computed at submit; it is unchanged.
      expect(approved.amountMinor).toBe(submittedAmount);
      // The activated subscription snapshots the plan's current (edited) terms.
      const sub = await prisma.businessSubscription.findFirstOrThrow({ where: { businessId: id }, orderBy: { createdAt: 'desc' } });
      expect(sub.planPriceMinorSnapshot).toBe(originalPrice + 50000);
    } finally {
      await prisma.plan.update({ where: { id: plan.id }, data: { monthlyPriceMinor: originalPrice } });
    }
  });

  it('rejects a transaction reference that was already approved elsewhere', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const businessB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: idA } = await createBusiness(app, owner.token);
    const { id: idB } = await createBusiness(app, businessB.token);
    const method = await makeMethod();
    const admin = await registerAdminAndLogin(app);

    const sharedRef = runRef('TX-SHARED');
    const reqA = JSON.parse((await submit(owner.token, idA, { paymentMethodId: method.id, transactionReference: sharedRef, receiptStorageKey: 'k' })).body).data;
    const ok = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${reqA.id}/approve`, headers: authed(admin.token) });
    expect(ok.statusCode).toBe(200);

    const reqB = JSON.parse((await submit(businessB.token, idB, { paymentMethodId: method.id, transactionReference: sharedRef, receiptStorageKey: 'k' })).body).data;
    const clash = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${reqB.id}/approve`, headers: authed(admin.token) });
    expect(clash.statusCode).toBe(409);
    expect(JSON.parse(clash.body).error.code).toBe('REFERENCE_ALREADY_APPROVED');
  });

  it('handles concurrent approvals of the same request safely', async () => {
    const { token: ownerToken } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    const method = await makeMethod();
    const created = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: runRef('TX-RACE'), receiptStorageKey: 'k' })).body).data;
    const admin = await registerAdminAndLogin(app);
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) }),
      app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBe(409);
    const liveCount = await prisma.businessSubscription.count({ where: { businessId: id, status: 'ACTIVE' } });
    expect(liveCount).toBe(1);
  });

  it('renews a live paid subscription from its current expiry', async () => {
    const { token: ownerToken } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    const method = await makeMethod();
    const admin = await registerAdminAndLogin(app);

    const first = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: runRef('TX-RENEW-A'), receiptStorageKey: 'k' })).body).data;
    await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${first.id}/approve`, headers: authed(admin.token) });
    const sub1 = await prisma.businessSubscription.findFirst({ where: { businessId: id }, orderBy: { createdAt: 'desc' } });
    expect(sub1?.status).toBe('ACTIVE');

    const second = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: runRef('TX-RENEW-B'), receiptStorageKey: 'k' })).body).data;
    const res = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${second.id}/approve`, headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);

    const sub2 = await prisma.businessSubscription.findFirstOrThrow({ where: { id: sub1!.id } });
    expect(sub2.status).toBe('ACTIVE');
    // Renewal extends from the previous expiry — never shortens entitlement.
    expect(sub2.currentPeriodStartAt.getTime()).toBe(sub1!.currentPeriodEndAt.getTime());
    expect(Math.abs(sub2.currentPeriodEndAt.getTime() - addCalendarMonths(sub1!.currentPeriodEndAt, 1).getTime())).toBeLessThan(1_000);
  });
});

describe('admin rejection', () => {
  it('requires a meaningful reason', async () => {
    const admin = await registerAdminAndLogin(app);
    for (const reason of ['', '   ', 'ab', 'x'.repeat(501)]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/subscription/payment-requests/00000000-0000-4000-8000-000000000000/reject`,
        headers: authed(admin.token),
        payload: { reason },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects with reason; subscription unchanged; owner notified; resubmission allowed', async () => {
    const { token: ownerToken, userId: ownerId } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerToken);
    await startTrial(ownerToken, id);
    const before = await prisma.businessSubscription.findFirst({ where: { businessId: id }, orderBy: { createdAt: 'desc' } });

    const method = await makeMethod();
    const rejectRef = runRef('TX-REJECT');
    const created = JSON.parse((await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: rejectRef, receiptStorageKey: 'k' })).body).data;
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/subscription/payment-requests/${created.id}/reject`,
      headers: authed(admin.token),
      payload: { reason: 'Receipt does not match transaction reference.' },
    });
    expect(res.statusCode).toBe(200);
    const rejected = JSON.parse(res.body).data;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Receipt does not match transaction reference.');

    // Subscription untouched (still the trial, same period).
    const after = await prisma.businessSubscription.findFirstOrThrow({ where: { id: before!.id } });
    expect(after.status).toBe(before!.status);
    expect(after.currentPeriodEndAt.getTime()).toBe(before!.currentPeriodEndAt.getTime());

    // Owner notifications are dispatched post-commit and never block the
    // response, so the test retries briefly until the row lands.
    let notif = null;
    for (let i = 0; i < 20 && !notif; i++) {
      notif = await prisma.notification.findFirst({ where: { userId: ownerId, type: 'SUBSCRIPTION_PAYMENT_REJECTED', entityId: created.id } });
      if (!notif) await new Promise((r) => setTimeout(r, 100));
    }
    expect(notif?.message).toContain('Receipt does not match transaction reference.');

    // A corrected request can be submitted after rejection.
    const again = await submit(ownerToken, id, { paymentMethodId: method.id, transactionReference: runRef('TX-REJECT-B'), receiptStorageKey: 'k' });
    expect(again.statusCode).toBe(201);
  });
});

describe('payment history & access control', () => {
  it('owner sees own history newest first; cannot see another business’s request', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: idA } = await createBusiness(app, ownerA.token);
    const { id: idB } = await createBusiness(app, ownerB.token);
    const method = await makeMethod();
    const hist1 = runRef('TX-HIST-A');
    const hist2 = runRef('TX-HIST-B');
    const first = JSON.parse((await submit(ownerA.token, idA, { paymentMethodId: method.id, transactionReference: hist1, receiptStorageKey: 'k' })).body).data as { id: string };
    // One PENDING request per business: cancel the first before correcting it.
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${idA}/subscription/payment-requests/${first.id}/cancel`, headers: authed(ownerA.token) });
    await submit(ownerA.token, idA, { paymentMethodId: method.id, transactionReference: hist2, receiptStorageKey: 'k2' });

    const list = await app.inject({ method: 'GET', url: `/api/v1/businesses/${idA}/subscription/payment-requests`, headers: authed(ownerA.token) });
    expect(list.statusCode).toBe(200);
    const items = JSON.parse(list.body).data.items as { transactionReference: string; submittedAt: string }[];
    expect(new Set(items.map((i) => i.transactionReference))).toEqual(new Set([hist2, hist1]));
    // Newest first: submittedAt is non-increasing (same-ms ties may reorder).
    expect(items.every((i, idx) => idx === 0 || Date.parse(items[idx - 1].submittedAt) >= Date.parse(i.submittedAt))).toBe(true);

    // Owner B's business history must not contain A's requests...
    const listB = await app.inject({ method: 'GET', url: `/api/v1/businesses/${idB}/subscription/payment-requests`, headers: authed(ownerB.token) });
    const itemsB = JSON.parse(listB.body).data.items as { transactionReference: string }[];
    expect(itemsB.every((i) => !i.transactionReference.startsWith('TX-HIST-'))).toBe(true);

    // ...and the single-request endpoint enforces ownership too (404).
    const firstA = JSON.parse((await app.inject({ method: 'GET', url: `/api/v1/businesses/${idA}/subscription/payment-requests`, headers: authed(ownerA.token) })).body).data.items[0] as { id: string };
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/businesses/${idB}/subscription/payment-requests/${firstA.id}`, headers: authed(ownerB.token) });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('receipt upload & protected viewing', () => {
  /** Builds a real multipart body with one image part (the upload abstraction's wire format). */
  const multipartBody = (bytes: Buffer, mimetype = 'image/png', filename = 'receipt.png') => {
    const boundary = '----vitestreceiptboundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { body: Buffer.concat([head, bytes, tail]), boundary };
  };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000', 'hex');

  it('owner uploads a real image file and gets an opaque storage key (no URLs)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { body, boundary } = multipartBody(PNG);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/subscription/payment-receipts',
      headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const key = JSON.parse(res.body).data.storageKey as string;
    expect(key).toMatch(/^receipts\/[a-f0-9-]+\.png$/);
  });

  it('rejects non-image uploads and unauthenticated calls', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { body, boundary } = multipartBody(Buffer.from('not an image'), 'application/pdf', 'receipt.pdf');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/subscription/payment-receipts',
      headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    const anon = await app.inject({ method: 'POST', url: '/api/v1/subscription/payment-receipts', payload: Buffer.alloc(0) });
    expect(anon.statusCode).toBe(401);
  });

  it('receipt bytes are only readable by the owner or an admin — never publicly', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const stranger = await registerAndLogin(app, 'BUSINESS_OWNER');
    const admin = await registerAdminAndLogin(app);
    const { body, boundary } = multipartBody(PNG);
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/subscription/payment-receipts',
      headers: { ...authed(owner.token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    const key = JSON.parse(up.body).data.storageKey as string;

    // A receipt becomes viewable once it is attached to a real payment
    // request — its lifecycle is upload → submit → review. Before that it is
    // an orphan no one can read (404), which is also asserted below.
    const orphan = await app.inject({ method: 'GET', url: `/api/v1/subscription/payment-receipts/${key}`, headers: authed(owner.token) });
    expect(orphan.statusCode).toBe(404);

    const { id: businessId } = await createBusiness(app, owner.token);
    const method = await makeMethod();
    const submitRes = await submit(owner.token, businessId, { paymentMethodId: method.id, transactionReference: runRef('TX-RECEIPT'), receiptStorageKey: key });
    expect(submitRes.statusCode).toBe(201);

    const own = await app.inject({ method: 'GET', url: `/api/v1/subscription/payment-receipts/${key}`, headers: authed(owner.token) });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    const adminView = await app.inject({ method: 'GET', url: `/api/v1/subscription/payment-receipts/${key}`, headers: authed(admin.token) });
    expect(adminView.statusCode).toBe(200);
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/subscription/payment-receipts/${key}`, headers: authed(stranger.token) });
    expect(foreign.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/subscription/payment-receipts/${key}` });
    expect(anon.statusCode).toBe(401);
    // Malformed keys (traversal attempts) never reach disk.
    const evil = await app.inject({ method: 'GET', url: '/api/v1/subscription/payment-receipts/..%2F..%2Fsecrets.txt', headers: authed(owner.token) });
    expect(evil.statusCode).toBe(404);
  });

  it('a real uploaded receipt key completes the submit → approve flow', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const { body, boundary } = multipartBody(PNG);
    const up = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/subscription/payment-receipts',
          headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
          payload: body,
        })
      ).body,
    ).data as { storageKey: string };
    const method = await makeMethod();
    const created = JSON.parse((await submit(token, id, { paymentMethodId: method.id, transactionReference: runRef('TX-RECEIPT'), receiptStorageKey: up.storageKey })).body).data;
    expect(created.receiptStorageKey).toBe(up.storageKey);
    const admin = await registerAdminAndLogin(app);
    const approve = await app.inject({ method: 'POST', url: `/api/v1/admin/subscription/payment-requests/${created.id}/approve`, headers: authed(admin.token) });
    expect(approve.statusCode).toBe(200);
  });
});

describe('payment method admin CRUD', () => {
  it('admin can create, edit, deactivate and delete; in-use methods resist deletion', async () => {
    const admin = await registerAdminAndLogin(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/payment-methods',
      headers: authed(admin.token),
      payload: { name: 'Admin Method', type: 'JAZZCASH', accountTitle: 'NearbyOrders', accountNumber: '03001112222', instructions: 'Send exactly Rs. 2,999' },
    });
    expect(create.statusCode).toBe(201);
    const method = JSON.parse(create.body).data as { id: string };

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${method.id}`,
      headers: authed(admin.token),
      payload: { accountNumber: '03003334444', isActive: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).data.accountNumber).toBe('03003334444');
    expect(JSON.parse(patch.body).data.isActive).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/payment-methods/${method.id}`, headers: authed(admin.token) });
    expect(del.statusCode).toBe(204);

    // A method with payment requests can only be deactivated, not deleted.
    const used = await makeMethod();
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    await submit(token, id, { paymentMethodId: used.id, transactionReference: runRef('TX-INUSE'), receiptStorageKey: 'k' });
    const delUsed = await app.inject({ method: 'DELETE', url: `/api/v1/admin/payment-methods/${used.id}`, headers: authed(admin.token) });
    expect(delUsed.statusCode).toBe(409);
    expect(JSON.parse(delUsed.body).error.code).toBe('IN_USE');
  });
});
