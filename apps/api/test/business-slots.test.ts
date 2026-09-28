/**
 * P3 — plan-based business slots.
 *
 * The entitlement is owner-level and derived from the owner's highest live
 * plan (Starter 1 / Growth 3 / Premium 10; base allowance 1 with no live
 * plan). POST /businesses enforces it inside a user-scoped PostgreSQL
 * advisory transaction lock, so concurrent creations can never exceed it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  makeApp,
  registerAndLogin,
  ensureCategory,
  authed,
  type TestApp,
} from './helpers.js';
import { prisma, ownerBusinessAllowance } from '../src/lib.js';
import { upsertPlans } from '../prisma/seed.js';

let app: TestApp;

const DAY_MS = 86_400_000;

beforeAll(async () => {
  app = await makeApp();
  // Idempotent: guarantees the three catalog rows exist with P3 slot values.
  await upsertPlans();
});

type PlanSlug = 'starter' | 'nearbyorders-business' | 'premium';
type SubStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

/** Fixture subscription row, shaped the way activation writes it. */
async function grantSubscription(businessId: string, slug: PlanSlug, status: SubStatus, periodEndMs = Date.now() + 30 * DAY_MS) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { slug } });
  const now = new Date();
  return prisma.businessSubscription.create({
    data: {
      businessId,
      planId: plan.id,
      status,
      currentPeriodStartAt: now,
      currentPeriodEndAt: new Date(periodEndMs),
      trialStartAt: status === 'TRIAL' ? now : null,
      trialEndAt: status === 'TRIAL' ? new Date(periodEndMs) : null,
      planNameSnapshot: plan.name,
      planPriceMinorSnapshot: plan.monthlyPriceMinor,
    },
  });
}

/**
 * Registers an owner and seeds `n` businesses DIRECTLY in the database
 * (bypassing the HTTP creation gate under test — these are the pre-existing
 * businesses the gate must count, including grandfathered over-limit ones).
 */
async function ownerWithBusinesses(n: number) {
  const { token, userId } = await registerAndLogin(app, 'BUSINESS_OWNER');
  const category = await ensureCategory();
  const businessIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const stamp = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const b = await prisma.business.create({
      data: {
        name: `Slot Fixture ${stamp}`,
        slug: `slot-fixture-${stamp}`,
        ownerId: userId,
        status: 'APPROVED',
        address: '1 Test Street',
        city: 'Lahore',
        categories: { create: [{ categoryId: category.id }] },
      },
      select: { id: true },
    });
    businessIds.push(b.id);
  }
  return { token, userId, businessIds };
}

/** Raw business-creation attempt (never throws): returns the HTTP response. */
async function tryCreateBusiness(token: string, name: string) {
  const category = await ensureCategory();
  return app.inject({
    method: 'POST',
    url: '/api/v1/businesses',
    headers: authed(token),
    payload: {
      name,
      address: '1 Test Street',
      city: 'Lahore',
      categoryIds: [category.id],
    },
  });
}

const readEntitlement = async (token: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(token) });
  expect(res.statusCode).toBe(200);
  return res.json().entitlement as { usedBusinesses: number; maxBusinesses: number; remainingBusinesses: number };
};

describe('plan catalog slot values', () => {
  it('seeds Starter=1, Growth=3, Premium=10 via the idempotent seed', async () => {
    await upsertPlans();
    const rows = await prisma.plan.findMany({ where: { slug: { in: ['starter', 'nearbyorders-business', 'premium'] } } });
    const bySlug = new Map(rows.map((r) => [r.slug, r.maxBusinesses]));
    expect(bySlug.get('starter')).toBe(1);
    expect(bySlug.get('nearbyorders-business')).toBe(3);
    expect(bySlug.get('premium')).toBe(10);
  });

  it('backfills maxBusinesses for rows that predate the column without clobbering admin edits', async () => {
    // A row still holding the schema default gets the catalog value.
    await prisma.plan.update({ where: { slug: 'premium' }, data: { maxBusinesses: 1 } });
    // An admin-set value is sacred.
    await prisma.plan.update({ where: { slug: 'nearbyorders-business' }, data: { maxBusinesses: 5 } });
    await upsertPlans();
    expect((await prisma.plan.findUniqueOrThrow({ where: { slug: 'premium' } })).maxBusinesses).toBe(10);
    expect((await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } })).maxBusinesses).toBe(5);
    // Restore the catalog value for the rest of the suite.
    await prisma.plan.update({ where: { slug: 'nearbyorders-business' }, data: { maxBusinesses: 3 } });
  });

  it('GET /subscription/plans exposes maxBusinesses from the database catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/plans' });
    expect(res.statusCode).toBe(200);
    const bySlug = new Map((res.json().data as { slug: string; maxBusinesses: number }[]).map((p) => [p.slug, p.maxBusinesses]));
    expect(bySlug.get('starter')).toBe(1);
    expect(bySlug.get('nearbyorders-business')).toBe(3);
    expect(bySlug.get('premium')).toBe(10);
  });
});

describe('entitlement rule', () => {
  it('no live plan → base allowance of 1', async () => {
    const { token, userId } = await ownerWithBusinesses(0);
    expect(await readEntitlement(token)).toEqual({ usedBusinesses: 0, maxBusinesses: 1, remainingBusinesses: 1 });
    expect(await ownerBusinessAllowance(prisma, userId)).toMatchObject({ maxBusinesses: 1 });
  });

  it('paid plans grant their slot counts (Starter 1 / Growth 3 / Premium 10)', async () => {
    for (const [slug, expected] of [['starter', 1], ['nearbyorders-business', 3], ['premium', 10]] as const) {
      const { token, businessIds } = await ownerWithBusinesses(1);
      await grantSubscription(businessIds[0]!, slug, 'ACTIVE');
      expect(await readEntitlement(token)).toEqual({ usedBusinesses: 1, maxBusinesses: expected, remainingBusinesses: Math.max(0, expected - 1) });
    }
  });

  it('active trials use the trial plan slots (Growth trial 3 / Premium trial 10)', async () => {
    for (const [slug, expected] of [['nearbyorders-business', 3], ['premium', 10]] as const) {
      const { token, businessIds } = await ownerWithBusinesses(1);
      await grantSubscription(businessIds[0]!, slug, 'TRIAL');
      expect((await readEntitlement(token)).maxBusinesses).toBe(expected);
    }
  });

  it('expired or cancelled plans no longer grant their slots', async () => {
    const { token, businessIds } = await ownerWithBusinesses(1);
    // Lazily-expired: ACTIVE row whose period already ended.
    await grantSubscription(businessIds[0]!, 'premium', 'ACTIVE', Date.now() - DAY_MS);
    expect((await readEntitlement(token)).maxBusinesses).toBe(1);

    const again = await ownerWithBusinesses(1);
    await grantSubscription(again.businessIds[0]!, 'nearbyorders-business', 'CANCELLED');
    expect((await readEntitlement(again.token)).maxBusinesses).toBe(1);

    const normalized = await ownerWithBusinesses(1);
    await grantSubscription(normalized.businessIds[0]!, 'premium', 'EXPIRED', Date.now() - DAY_MS);
    expect((await readEntitlement(normalized.token)).maxBusinesses).toBe(1);
  });

  it('the highest live plan wins; lower or expired plans never override it', async () => {
    const { token, businessIds } = await ownerWithBusinesses(2);
    await grantSubscription(businessIds[0]!, 'nearbyorders-business', 'ACTIVE');
    await grantSubscription(businessIds[1]!, 'premium', 'ACTIVE');
    expect((await readEntitlement(token)).maxBusinesses).toBe(10);

    const mixed = await ownerWithBusinesses(2);
    await grantSubscription(mixed.businessIds[0]!, 'premium', 'ACTIVE', Date.now() - DAY_MS);
    await grantSubscription(mixed.businessIds[1]!, 'nearbyorders-business', 'ACTIVE');
    expect((await readEntitlement(mixed.token)).maxBusinesses).toBe(3);
  });

  it('existing businesses stay intact after expiry/downgrade', async () => {
    const { token, businessIds } = await ownerWithBusinesses(3);
    await grantSubscription(businessIds[0]!, 'premium', 'ACTIVE');
    expect((await readEntitlement(token)).maxBusinesses).toBe(10);
    // The plan lapses…
    await prisma.businessSubscription.updateMany({ where: { businessId: businessIds[0]! }, data: { status: 'EXPIRED', currentPeriodEndAt: new Date(Date.now() - DAY_MS) } });
    // …the allowance drops, but all three businesses are still listed and usable.
    const res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(3);
    expect(res.json().entitlement).toEqual({ usedBusinesses: 3, maxBusinesses: 1, remainingBusinesses: 0 });
  });

  it('archived businesses do not consume slots', async () => {
    const { token, businessIds } = await ownerWithBusinesses(2);
    await prisma.business.update({ where: { id: businessIds[0]! }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    expect(await readEntitlement(token)).toEqual({ usedBusinesses: 1, maxBusinesses: 1, remainingBusinesses: 0 });
    const res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(token) });
    expect(res.json().data).toHaveLength(1);
  });
});

describe('business creation gate', () => {
  it('Starter owner with 1 business cannot create a second (403 BUSINESS_LIMIT_REACHED)', async () => {
    const { token, businessIds } = await ownerWithBusinesses(1);
    await grantSubscription(businessIds[0]!, 'starter', 'ACTIVE');
    const ownerId = await readOwnerId(token);
    const before = await prisma.business.count({ where: { ownerId } });
    const res = await tryCreateBusiness(token, `Slot Test A ${Date.now()}`);
    expect(res.statusCode).toBe(403);
    const err = res.json().error;
    expect(err.code).toBe('BUSINESS_LIMIT_REACHED');
    expect(err.details).toMatchObject({ maxBusinesses: 1, used: 1 });
    // Nothing was created.
    expect(await prisma.business.count({ where: { ownerId } })).toBe(before);
  });

  it('Growth owner with 3 businesses cannot create a fourth', async () => {
    const { token, businessIds } = await ownerWithBusinesses(3);
    await grantSubscription(businessIds[0]!, 'nearbyorders-business', 'ACTIVE');
    const res = await tryCreateBusiness(token, `Slot Test B ${Date.now()}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_LIMIT_REACHED');
    expect(res.json().error.details).toMatchObject({ maxBusinesses: 3, used: 3 });
  });

  it('Premium owner with 10 businesses cannot create an eleventh', async () => {
    const { token, businessIds } = await ownerWithBusinesses(10);
    await grantSubscription(businessIds[0]!, 'premium', 'ACTIVE');
    const res = await tryCreateBusiness(token, `Slot Test C ${Date.now()}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_LIMIT_REACHED');
    expect(res.json().error.details).toMatchObject({ maxBusinesses: 10, used: 10 });
    expect(await prisma.business.count({ where: { ownerId: await readOwnerId(token), archivedAt: null } })).toBe(10);
  });

  it('no live plan → base allowance of 1 enforced on creation', async () => {
    const { token } = await ownerWithBusinesses(1);
    const res = await tryCreateBusiness(token, `Slot Test D ${Date.now()}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details).toMatchObject({ maxBusinesses: 1, used: 1 });
  });

  it('grandfathered over-limit accounts stay usable but cannot create more', async () => {
    const { token, businessIds } = await ownerWithBusinesses(5);
    // No live plan: allowance is 1, but the 5 existing businesses are untouched.
    const mine = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(token) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toHaveLength(5);
    expect(mine.json().entitlement).toEqual({ usedBusinesses: 5, maxBusinesses: 1, remainingBusinesses: 0 });
    const res = await tryCreateBusiness(token, `Slot Test E ${Date.now()}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BUSINESS_LIMIT_REACHED');
    expect(businessIds).toHaveLength(5);
  });

  it('archiving a business frees its slot and creation becomes possible again', async () => {
    const { token, businessIds } = await ownerWithBusinesses(3);
    await grantSubscription(businessIds[0]!, 'nearbyorders-business', 'ACTIVE');
    const blocked = await tryCreateBusiness(token, `Slot Test F1 ${Date.now()}`);
    expect(blocked.statusCode).toBe(403);
    await prisma.business.update({ where: { id: businessIds[0]! }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    const allowed = await tryCreateBusiness(token, `Slot Test F2 ${Date.now()}`);
    expect(allowed.statusCode).toBe(201);
    expect((await readEntitlement(token)).usedBusinesses).toBe(3);
  });

  it('creation below the limit still succeeds', async () => {
    const { token, businessIds } = await ownerWithBusinesses(2);
    await grantSubscription(businessIds[0]!, 'nearbyorders-business', 'ACTIVE');
    const res = await tryCreateBusiness(token, `Slot Test G ${Date.now()}`);
    expect(res.statusCode).toBe(201);
  });
});

describe('race safety', () => {
  it('two concurrent creations with one slot left → exactly one succeeds', async () => {
    const { token } = await ownerWithBusinesses(2);
    // Growth allowance is 3 and 2 are used, so exactly one slot remains.
    const ownerId = await readOwnerId(token);
    const existing = await prisma.business.findFirstOrThrow({ where: { ownerId } });
    await grantSubscription(existing.id, 'nearbyorders-business', 'ACTIVE');

    const stamp = Date.now();
    const [a, b] = await Promise.all([
      tryCreateBusiness(token, `Race Biz Alpha ${stamp}`),
      tryCreateBusiness(token, `Race Biz Beta ${stamp}`),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 403]);
    const loser = a.statusCode === 403 ? a : b;
    expect(loser.json().error.code).toBe('BUSINESS_LIMIT_REACHED');
    expect(loser.json().error.details).toMatchObject({ maxBusinesses: 3, used: 3 });
    // Exactly 3 live businesses, no duplicates, no partial rows.
    const live = await prisma.business.findMany({ where: { ownerId, archivedAt: null }, select: { id: true, slug: true } });
    expect(live).toHaveLength(3);
    expect(new Set(live.map((r) => r.slug)).size).toBe(3);
    expect(new Set(live.map((r) => r.id)).size).toBe(3);
  });
});

/** Resolves the owner id behind a token via /auth/me. */
async function readOwnerId(token: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authed(token) });
  return res.json().data.id as string;
}
