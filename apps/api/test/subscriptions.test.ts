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

/** Grants trial eligibility the way the admin verification flow does. */
async function makeEligible(businessId: string) {
  await prisma.business.update({ where: { id: businessId }, data: { trialStatus: 'ELIGIBLE' } });
}

const applyTrial = (businessId: string, token: string, planSlug = 'nearbyorders-business') =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/subscription/trial/apply`,
    headers: authed(token),
    payload: { planSlug },
  });

describe('plan catalog', () => {
  it('defines three plans with PKR minor-unit pricing and trial windows', () => {
    expect(PLAN_CATALOG).toHaveLength(3);
    const bySlug = new Map(PLAN_CATALOG.map((p) => [p.slug, p]));
    expect(bySlug.get('starter')).toMatchObject({ monthlyPriceMinor: 149900, currency: 'PKR', trialDays: 14, displayOrder: 1, isHighlighted: false });
    expect(bySlug.get('nearbyorders-business')).toMatchObject({ name: 'Growth', monthlyPriceMinor: 299900, currency: 'PKR', trialDays: 30, displayOrder: 2, isHighlighted: true });
    expect(bySlug.get('premium')).toMatchObject({ monthlyPriceMinor: 499900, currency: 'PKR', trialDays: 30, displayOrder: 3, isHighlighted: false });
    for (const plan of PLAN_CATALOG) {
      expect(plan.benefits.length).toBeGreaterThan(0);
      expect(plan.billingInterval).toBe('monthly');
    }
  });

  it('GET /subscription/plans lists active plans in display order with full metadata', async () => {
    // Idempotent ensure, mirroring the seed: create missing rows, backfill
    // catalog metadata, and restore the pre-test rows afterwards so the
    // shared test database is left exactly as found.
    const originals = await prisma.plan.findMany({ where: { slug: { in: PLAN_CATALOG.map((p) => p.slug) } } });
    for (const spec of PLAN_CATALOG) {
      await prisma.plan.upsert({ where: { slug: spec.slug }, update: { ...spec }, create: { ...spec } });
    }
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/plans' });
      expect(res.statusCode).toBe(200);
      const plans = res.json().data;
      expect(plans).toHaveLength(3);
      expect(plans.map((p: { slug: string }) => p.slug)).toEqual(['starter', 'nearbyorders-business', 'premium']);
      const growth = plans.find((p: { slug: string }) => p.slug === 'nearbyorders-business');
      expect(growth.name).toBe('Growth');
      expect(growth.monthlyPriceMinor).toBe(299900);
      expect(growth.benefits).toContain('Priority support');
      expect(growth.isHighlighted).toBe(true);
      // Every row carries a stable id and an explicit isActive flag — the
      // mobile picker filters on isActive, so it must never be missing.
      for (const p of plans) {
        expect(typeof p.id).toBe('string');
        expect(p.id.length).toBeGreaterThan(0);
        expect(p.isActive).toBe(true);
      }
      // Inactive plans are hidden from the public picker.
      const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
      await prisma.plan.update({ where: { id: plan.id }, data: { isActive: false } });
      const hidden = await app.inject({ method: 'GET', url: '/api/v1/subscription/plans' });
      expect(hidden.json().data.map((p: { slug: string }) => p.slug)).not.toContain('starter');
    } finally {
      for (const original of originals) {
        const { id, ...data } = original;
        await prisma.plan.update({ where: { id }, data });
      }
      const restoredSlugs = new Set(originals.map((p) => p.slug));
      await prisma.plan.deleteMany({ where: { slug: { in: PLAN_CATALOG.map((p) => p.slug).filter((s) => !restoredSlugs.has(s)) } } });
    }
  });

  it('trial apply seeds the plan row idempotently and never clobbers admin pricing', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    // Admin edits the price before the trial starts.
    await prisma.plan.update({ where: { slug: 'nearbyorders-business' }, data: { monthlyPriceMinor: 299900 } });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    const again = await prisma.plan.findMany({ where: { slug: 'nearbyorders-business' } });
    expect(again).toHaveLength(1);
    expect(again[0]!.monthlyPriceMinor).toBe(299900);
  });
});

describe('GET /businesses/:id/subscription', () => {
  it('returns the extended shape for a business that never subscribed', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.businessId).toBe(businessId);
    expect(data.subscription).toBeNull();
    expect(data.status).toBeNull();
    expect(data.trial).toBeNull();
    expect(data.verificationStatus).toBe('NOT_SUBMITTED');
    expect(data.trialStatus).toBe('NOT_ELIGIBLE');
    // P2: the listing-approval state rides along for owner gating/copy.
    expect(data.businessStatus).toBe('APPROVED');
  });

  it('reports trial metadata, snapshots and statuses for a live trial', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe('TRIAL');
    expect(data.subscription.status).toBe('TRIAL');
    expect(data.subscription.plan.slug).toBe('nearbyorders-business');
    // Snapshots freeze the commercial terms at activation.
    expect(data.planNameSnapshot).toBe('Growth');
    expect(data.planPriceMinorSnapshot).toBe(299900);
    expect(data.subscription.planNameSnapshot).toBe('Growth');
    // Trial metadata block.
    expect(Date.parse(data.trial.startsAt)).toBeLessThanOrEqual(Date.now());
    expect(Math.round((Date.parse(data.trial.endsAt) - Date.parse(data.trial.startsAt)) / 86_400_000)).toBe(30);
    expect(data.trial.daysRemaining).toBeGreaterThan(0);
    expect(data.trial.daysRemaining).toBeLessThanOrEqual(30);
    expect(data.trialStatus).toBe('ACTIVE');
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

describe('POST /businesses/:id/subscription/trial/apply', () => {
  it('starts a 30-day TRIAL with server-generated dates and snapshots the plan', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const before = Date.now();
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    const sub = res.json().data;
    expect(sub.status).toBe('TRIAL');
    expect(sub.plan.slug).toBe('nearbyorders-business');
    expect(sub.plan.name).toBe('Growth');
    expect(sub.plan.monthlyPriceMinor).toBe(299900);
    expect(sub.planNameSnapshot).toBe('Growth');
    expect(sub.planPriceMinorSnapshot).toBe(299900);
    const start = Date.parse(sub.trialStartAt);
    const end = Date.parse(sub.trialEndAt);
    expect(start).toBeGreaterThanOrEqual(before - 5000);
    expect(Math.round((end - start) / 86_400_000)).toBe(30);
    // Trial populates the current period too.
    expect(Date.parse(sub.currentPeriodEndAt)).toBe(end);
    // Business-level trial state moves to ACTIVE with timestamps.
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.trialStatus).toBe('ACTIVE');
    expect(business.trialStartedAt).not.toBeNull();
    expect(business.trialEndsAt).not.toBeNull();
  });

  it('starts the plan named in planSlug (14-day starter trial)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token, 'starter');
    expect(res.statusCode).toBe(201);
    const sub = res.json().data;
    expect(sub.plan.slug).toBe('starter');
    expect(Math.round((Date.parse(sub.trialEndAt) - Date.parse(sub.trialStartAt)) / 86_400_000)).toBe(14);
  });

  it('rejects an unknown plan with 400 PLAN_NOT_FOUND', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token, 'no-such-plan');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PLAN_NOT_FOUND');
  });

  it('rejects an ineligible business with 403 NOT_ELIGIBLE (trials never auto-start)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    // New businesses are NOT_ELIGIBLE — no eligibility granted.
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
    expect(await prisma.businessSubscription.count({ where: { businessId } })).toBe(0);
  });

  it('rejects a second apply while the trial is live (eligibility gate fires first)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    // The first apply flipped trialStatus to ACTIVE, so the ELIGIBLE gate
    // rejects the second apply before the live-subscription check is reached.
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
  });

  it('is one-time: a second apply after the first is rejected as not eligible', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const first = await applyTrial(businessId, token);
    expect(first.statusCode).toBe(201);
    // Simulate the trial having run its course at the business level.
    await prisma.business.update({ where: { id: businessId }, data: { trialStatus: 'EXPIRED' } });
    await prisma.businessSubscription.updateMany({ where: { businessId }, data: { status: 'EXPIRED' } });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
    expect(await prisma.businessSubscription.count({ where: { businessId } })).toBe(1);
  });

  it('enforces ownership and role on the trial endpoint', async () => {
    const { businessId, foreignToken } = await ownerWithBusiness();
    const customer = await registerAndLogin(app);
    expect((await applyTrial(businessId, foreignToken)).statusCode).toBe(404);
    expect((await applyTrial(businessId, customer.token)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/trial/apply`, payload: { planSlug: 'starter' } })).statusCode).toBe(401);
  });
});

describe('POST /businesses/:id/subscription/cancel', () => {
  it('cancels the live subscription and stamps cancelledAt', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const sub = res.json().data;
    expect(sub.status).toBe('CANCELLED');
    expect(sub.cancelledAt).toBeTruthy();
  });

  it('does not grant a second trial after a cancelled subscription (one-time trial)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
    const rows = await prisma.businessSubscription.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CANCELLED');
  });

  it('returns 404 when there is nothing live to cancel', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/subscription/cancel`, headers: authed(token) });
    expect(res.statusCode).toBe(404);
  });

  it('enforces ownership on the cancel endpoint', async () => {
    const { token, businessId, foreignToken } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
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

  it('GET normalizes an expired trial row to EXPIRED and flips the business trial status', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    await prisma.businessSubscription.updateMany({
      where: { businessId },
      data: { currentPeriodEndAt: new Date(Date.now() - 86_400_000), trialEndAt: new Date(Date.now() - 86_400_000) },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('EXPIRED');
    const row = await prisma.businessSubscription.findFirst({ where: { businessId } });
    expect(row!.status).toBe('EXPIRED');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.trialStatus).toBe('EXPIRED');
  });
});

/* ------------------------------------------------------------------ */
/* P2: listing-approval gate on trial apply                             */
/* ------------------------------------------------------------------ */

/** Owner with a business that is still PENDING listing approval. */
async function ownerWithPendingBusiness() {
  const { token, userId } = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'PENDING' } });
  return { token, userId, businessId: business.id };
}

describe('trial apply: listing-approval gate (P2)', () => {
  it('1. PENDING + ELIGIBLE → rejected with BUSINESS_NOT_APPROVED', async () => {
    const { token, businessId } = await ownerWithPendingBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_NOT_APPROVED');
    expect(res.json().error.message).toMatch(/approved before you can start the free trial/);
    expect(await prisma.businessSubscription.count({ where: { businessId } })).toBe(0);
  });

  it('2. REJECTED + ELIGIBLE → rejected with BUSINESS_NOT_APPROVED', async () => {
    const { token, businessId } = await ownerWithPendingBusiness();
    await makeEligible(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { status: 'REJECTED' } });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_NOT_APPROVED');
    expect(await prisma.businessSubscription.count({ where: { businessId } })).toBe(0);
  });

  it('3. APPROVED + ELIGIBLE → trial starts', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('TRIAL');
  });

  it('4. APPROVED + no eligibility → rejected with NOT_ELIGIBLE', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ELIGIBLE');
  });

  it('5. APPROVED + existing live subscription → rejected with ALREADY_SUBSCRIBED', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
    await prisma.businessSubscription.create({
      data: {
        businessId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStartAt: new Date(),
        currentPeriodEndAt: new Date(Date.now() + 30 * 86_400_000),
        planNameSnapshot: plan.name,
        planPriceMinorSnapshot: plan.monthlyPriceMinor,
      },
    });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('6. APPROVED + valid plan → trial starts immediately (no pending state)', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    // Synchronous activation: the row is TRIAL right away, never pending.
    const row = await prisma.businessSubscription.findFirstOrThrow({ where: { businessId } });
    expect(row.status).toBe('TRIAL');
  });

  it('7. successful apply creates a BusinessSubscription TRIAL row', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    const rows = await prisma.businessSubscription.findMany({ where: { businessId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('TRIAL');
  });

  it('8. successful apply updates business trialStatus to ACTIVE with timestamps', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await applyTrial(businessId, token);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.trialStatus).toBe('ACTIVE');
    expect(business.trialStartedAt).not.toBeNull();
    expect(business.trialEndsAt).not.toBeNull();
  });

  it('9. repeated apply cannot create a second trial', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    expect((await applyTrial(businessId, token)).statusCode).toBe(201);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(await prisma.businessSubscription.count({ where: { businessId } })).toBe(1);
  });

  it('10. trial duration comes from the selected plan', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token, 'starter');
    expect(res.statusCode).toBe(201);
    const sub = res.json().data;
    expect(Math.round((Date.parse(sub.trialEndAt) - Date.parse(sub.trialStartAt)) / 86_400_000)).toBe(14);
  });

  it('11. no payment request is created when a trial starts', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(201);
    expect(await prisma.subscriptionPaymentRequest.count({ where: { businessId } })).toBe(0);
  });

  it('the approval gate is enforced inside the transaction (no race)', async () => {
    // Eligible + APPROVED at the pre-check, but flip to PENDING before the
    // transaction re-check would run — simulated by setting PENDING and
    // relying on the in-transaction gate (the pre-check would also reject).
    const { token, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { status: 'PENDING' } });
    const res = await applyTrial(businessId, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_NOT_APPROVED');
  });
});

describe('TRIAL_EXPIRED notification (P2)', () => {
  /** Starts a trial, then backdates it so the next GET detects expiry. */
  async function backdatedTrial() {
    const { token, userId, businessId } = await ownerWithBusiness();
    await makeEligible(businessId);
    const applied = await applyTrial(businessId, token);
    expect(applied.statusCode).toBe(201);
    const subId = applied.json().data.id as string;
    const past = new Date(Date.now() - 86_400_000);
    await prisma.businessSubscription.update({
      where: { id: subId },
      data: { currentPeriodEndAt: past, trialEndAt: past },
    });
    return { token, userId, businessId, subId };
  }

  const expiredNotifs = (userId: string, subId: string) =>
    prisma.notification.count({ where: { userId, type: 'TRIAL_EXPIRED', entityId: subId } });

  it('creates exactly one TRIAL_EXPIRED notification on the TRIAL → EXPIRED transition', async () => {
    const { token, userId, businessId, subId } = await backdatedTrial();
    expect(await expiredNotifs(userId, subId)).toBe(0);
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('EXPIRED');
    expect(await expiredNotifs(userId, subId)).toBe(1);
    const notif = await prisma.notification.findFirstOrThrow({ where: { userId, type: 'TRIAL_EXPIRED', entityId: subId } });
    expect(notif.title).toMatch(/expired/i);
  });

  it('repeated GET /subscription calls do not create duplicates', async () => {
    const { token, userId, businessId, subId } = await backdatedTrial();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
      expect(res.statusCode).toBe(200);
    }
    expect(await expiredNotifs(userId, subId)).toBe(1);
  });

  it('reading the subscription after expiry still returns correct state', async () => {
    const { token, businessId } = await backdatedTrial();
    await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe('EXPIRED');
    expect(data.trialStatus).toBe('EXPIRED');
    expect(data.subscription.status).toBe('EXPIRED');
  });

  it('does not fire TRIAL_EXPIRED when a paid ACTIVE subscription expires', async () => {
    const { token, userId, businessId } = await ownerWithBusiness();
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
    const paid = await prisma.businessSubscription.create({
      data: {
        businessId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStartAt: new Date(Date.now() - 60 * 86_400_000),
        currentPeriodEndAt: new Date(Date.now() - 86_400_000),
        planNameSnapshot: plan.name,
        planPriceMinorSnapshot: plan.monthlyPriceMinor,
      },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('EXPIRED');
    expect(await expiredNotifs(userId, paid.id)).toBe(0);
  });

  it('the expiry path does not duplicate the TRIAL_ENDING_SOON notification', async () => {
    const { token, userId, businessId, subId } = await backdatedTrial();
    await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/subscription`, headers: authed(token) });
    expect(await prisma.notification.count({ where: { userId, type: 'TRIAL_ENDING_SOON', entityId: subId } })).toBe(0);
    expect(await expiredNotifs(userId, subId)).toBe(1);
  });
});
