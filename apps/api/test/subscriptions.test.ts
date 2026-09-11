import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { PLAN_CATALOG, evaluateSubscription } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

/** Owner with one approved business + a second foreign owner for authz checks. */
async function ownerWithBusiness() {
  const { token, userId } = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
  const foreign = await registerAndLogin(app, 'BUSINESS_OWNER');
  return { token, userId, businessId: business.id, foreignToken: foreign.token };
}

describe('plan catalog', () => {
  it('defines the NearbyOrders Business plan in minor units', () => {
    const plan = PLAN_CATALOG.find((p) => p.slug === 'nearbyorders-business');
    expect(plan).toBeDefined();
    expect(plan!.monthlyPriceMinor).toBe(299900);
    expect(plan!.currency).toBe('PKR');
    expect(plan!.trialDays).toBe(30);
  });

  it('ensurePlan seeds the plan row idempotently and never clobbers it', async () => {
    // The start-trial endpoint runs ensurePlan internally; exercising it twice
    // must leave exactly one row per slug with the catalog values intact.
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const again = await prisma.plan.findMany({ where: { slug: 'nearbyorders-business' } });
    expect(again).toHaveLength(1);
    expect(again[0]!.monthlyPriceMinor).toBe(299900);
  });
});

describe('GET /businesses/:id/subscription', () => {
  it('returns null for a business that never subscribed', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it('rejects a foreign owner, a customer, and unauthenticated access', async () => {
    const { token, businessId, foreignToken } = await ownerWithBusiness();
    const customer = await registerAndLogin(app);
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(foreignToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(customer.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) })).statusCode).toBe(200);
  });
});

describe('POST /businesses/:id/subscription/trial', () => {
  it('starts a 30-day TRIAL with server-generated dates and includes the plan', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const before = Date.now();
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    expect(res.statusCode).toBe(201);
    const sub = res.json().data;
    expect(sub.status).toBe('TRIAL');
    expect(sub.plan.slug).toBe('nearbyorders-business');
    expect(sub.plan.monthlyPriceMinor).toBe(299900);
    const start = Date.parse(sub.trialStartAt);
    const end = Date.parse(sub.trialEndAt);
    expect(start).toBeGreaterThanOrEqual(before - 5000);
    expect(Math.round((end - start) / 86_400_000)).toBe(30);
    // Trial populates the current period too.
    expect(Date.parse(sub.currentPeriodEndAt)).toBe(end);
  });

  it('rejects a second live subscription with 409 ALREADY_SUBSCRIBED', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('enforces ownership and role on the trial endpoint', async () => {
    const { businessId, foreignToken } = await ownerWithBusiness();
    const customer = await registerAndLogin(app);
    expect((await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(foreignToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(customer.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial` })).statusCode).toBe(401);
  });
});

describe('POST /businesses/:id/subscription/cancel', () => {
  it('cancels the live subscription and stamps cancelledAt', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const sub = res.json().data;
    expect(sub.status).toBe('CANCELLED');
    expect(sub.cancelledAt).toBeTruthy();
  });

  it('allows a new trial after a cancelled subscription (history is kept)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    expect(res.statusCode).toBe(201);
    const rows = await prisma.businessSubscription.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe('CANCELLED');
    expect(rows[1]!.status).toBe('TRIAL');
  });

  it('returns 404 when there is nothing live to cancel', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    expect(res.statusCode).toBe(404);
  });

  it('enforces ownership on the cancel endpoint', async () => {
    const { token, businessId, foreignToken } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    expect((await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(foreignToken) })).statusCode).toBe(404);
  });
});

describe('lazy expiry (server-authoritative)', () => {
  it('evaluateSubscription resolves a past-period TRIAL as EXPIRED without mutating', () => {
    const past = new Date(Date.now() - 86_400_000);
    const now = new Date();
    expect(evaluateSubscription({ status: 'TRIAL', currentPeriodEndAt: past }, now)).toBe('EXPIRED');
    expect(evaluateSubscription({ status: 'ACTIVE', currentPeriodEndAt: past }, now)).toBe('EXPIRED');
    expect(evaluateSubscription({ status: 'TRIAL', currentPeriodEndAt: new Date(now.getTime() + 60_000) }, now)).toBe('TRIAL');
    expect(evaluateSubscription({ status: 'CANCELLED', currentPeriodEndAt: past }, now)).toBe('CANCELLED');
  });

  it('GET normalizes an expired trial row to EXPIRED', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    await prisma.businessSubscription.updateMany({
      where: { businessId },
      data: { currentPeriodEndAt: new Date(Date.now() - 86_400_000), trialEndAt: new Date(Date.now() - 86_400_000) },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('EXPIRED');
    const row = await prisma.businessSubscription.findFirst({ where: { businessId } });
    expect(row!.status).toBe('EXPIRED');
  });

  it('an expired trial does not block starting a new trial', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    await prisma.businessSubscription.updateMany({
      where: { businessId },
      data: { status: 'EXPIRED' },
    });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial`, headers: authed(token) });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('TRIAL');
  });
});
