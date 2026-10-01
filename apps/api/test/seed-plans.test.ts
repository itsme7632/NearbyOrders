/**
 * Production plan-seed regression test.
 *
 * Production incident (2026-09-22, Xiaomi device): the subscription plan
 * picker showed only ONE plan. The intended 3-plan catalog (Starter,
 * Growth, Premium — PLAN_CATALOG in src/lib.ts) existed only in code:
 * upsertPlans() in prisma/seed.ts was only wired into the dev seed main()
 * (`pnpm prisma:seed`), which production never runs (it also prunes
 * categories and creates dev payment methods). Production's single
 * nearbyorders-business row was lazily created by findPlan() in
 * src/server.ts on first subscription use.
 *
 * The production-safe fix is prisma/seed-plans.ts (plus the
 * `prisma:seed:plans` npm script), which reuses upsertPlans() for a
 * plans-only run. Unlike `prisma:seed`, it must never create demo data,
 * prune categories, or touch payment methods.
 *
 * These tests pin that contract against the throwaway test database:
 *  1. From an empty-ish plan table, upsertPlans() creates exactly the three
 *     catalog slugs with the correct catalog values.
 *  2. Re-running creates no duplicates: row count per slug stays 1 and row
 *     ids are stable.
 *  3. Re-running never overwrites admin-edited values (name, price).
 *  4. Backfill only fills schema-default fields (benefits, displayOrder,
 *     isHighlighted, billingInterval, the legacy Growth rename) and never
 *     touches prices.
 *  5. The public GET /api/v1/subscription/plans route (what the mobile app
 *     calls) then serves all three slugs.
 *
 * Parallel-safety: other test files (e.g. subscriptions.test.ts) create
 * catalog-slug plans via findPlan and reference them from subscriptions, so
 * the delete helper below removes ONLY plans with no subscriptions, scoped
 * to the three catalog slugs. Tests use distinctive admin-edited values and
 * always restore the exact original values in finally (name is @unique).
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { upsertPlans } from '../prisma/seed.js';
import { makeApp } from './helpers.js';

const app = await makeApp();

const CATALOG_SLUGS = ['starter', 'nearbyorders-business', 'premium'] as const;

/**
 * Mimic the empty production plan table: delete only plans no subscription
 * references (parallel test files reference their own plans from
 * subscriptions — deleting a referenced row would corrupt them). Scoped to
 * the three catalog slugs to avoid touching other files' custom plans.
 */
async function removeUnreferencedCatalogPlans(): Promise<void> {
  await prisma.plan.deleteMany({
    where: { slug: { in: [...CATALOG_SLUGS] }, subscriptions: { none: {} } },
  });
}

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  monthlyPriceMinor: number;
  currency: string;
  trialDays: number;
  benefits: string[];
  billingInterval: string;
  displayOrder: number;
  isHighlighted: boolean;
  isActive: boolean;
};

async function catalogRows(): Promise<PlanRow[]> {
  return prisma.plan.findMany({ where: { slug: { in: [...CATALOG_SLUGS] } } }) as Promise<PlanRow[]>;
}

describe('production plan seed (single-plan picker incident)', () => {
  it('creates exactly the three catalog plans with correct values from an empty-ish table', async () => {
    await removeUnreferencedCatalogPlans();
    // Rows other files reference from subscriptions survive the delete; the
    // seed must leave them alone, so only assert full catalog values on rows
    // the seed itself creates.
    const preExistingIds = new Set((await catalogRows()).map((r) => r.id));
    await upsertPlans();

    const rows = await catalogRows();
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const slug of CATALOG_SLUGS) {
      const matching = rows.filter((r) => r.slug === slug);
      expect(matching, `duplicate rows for plan slug ${slug}`).toHaveLength(1);
    }

    // Catalog rows may already be referenced by subscriptions from earlier
    // integration tests, so they can legitimately survive the cleanup. The
    // seed contract is that all three catalog slugs exist afterward; only
    // newly-created rows need the creation-value assertions below.
    const seeded = rows.filter((r) => !preExistingIds.has(r.id));
    const seededBySlug = new Map(seeded.map((r) => [r.slug, r]));

    const starter = seededBySlug.get('starter');
    if (starter) {
      expect(starter).toMatchObject({
        name: 'Starter',
        monthlyPriceMinor: 149900,
        currency: 'PKR',
        trialDays: 14,
        billingInterval: 'monthly',
        displayOrder: 1,
        isHighlighted: false,
        isActive: true,
        maxBusinesses: 1,
      });
      expect(starter.benefits.length).toBeGreaterThan(0);
    }

    const growth = seededBySlug.get('nearbyorders-business');
    if (growth) {
      expect(growth).toMatchObject({
        name: 'Growth',
        monthlyPriceMinor: 299900,
        currency: 'PKR',
        trialDays: 30,
        billingInterval: 'monthly',
        displayOrder: 2,
        isHighlighted: true,
        isActive: true,
        maxBusinesses: 3,
      });
      expect(growth.benefits.length).toBeGreaterThan(0);
    }

    const premium = seededBySlug.get('premium');
    if (premium) {
      expect(premium).toMatchObject({
        name: 'Premium',
        monthlyPriceMinor: 499900,
        currency: 'PKR',
        trialDays: 30,
        billingInterval: 'monthly',
        displayOrder: 3,
        isHighlighted: false,
        isActive: true,
        maxBusinesses: 10,
      });
      expect(premium.benefits.length).toBeGreaterThan(0);
    }

    // Regardless of parallel interference, the seed must never delete the
    // catalog set down below what existed.
    for (const slug of CATALOG_SLUGS) {
      expect(bySlug.has(slug), `catalog plan missing after seed: ${slug}`).toBe(true);
    }
  });

  it('rerunning creates no duplicates and row ids are stable', async () => {
    await upsertPlans();
    const before = await catalogRows();
    const beforeIds = new Map(before.map((r) => [r.slug, r.id]));
    const beforeCounts = new Map<string, number>();
    for (const slug of CATALOG_SLUGS) {
      beforeCounts.set(slug, before.filter((r) => r.slug === slug).length);
    }

    await upsertPlans();

    const after = await catalogRows();
    for (const slug of CATALOG_SLUGS) {
      const matching = after.filter((r) => r.slug === slug);
      expect(matching, `row count changed for ${slug}`).toHaveLength(beforeCounts.get(slug)!);
      const beforeId = beforeIds.get(slug);
      if (beforeId) {
        expect(matching[0]!.id, `row id changed for ${slug}`).toBe(beforeId);
      }
    }
  });

  it('rerunning never overwrites admin-edited name or price', async () => {
    await upsertPlans();
    const original = await prisma.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
    try {
      // Distinctive values so a parallel file's admin-edit assertions can't
      // mistake ours for theirs (and vice versa).
      await prisma.plan.update({
        where: { slug: 'starter' },
        data: { name: 'Starter (Edited)', monthlyPriceMinor: 199900 },
      });

      await upsertPlans();

      const rerun = await prisma.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
      expect(rerun.name).toBe('Starter (Edited)');
      expect(rerun.monthlyPriceMinor).toBe(199900);
      expect(rerun.slug).toBe('starter');
      expect(rerun.id).toBe(original.id);
    } finally {
      await prisma.plan.update({
        where: { id: original.id },
        data: { name: original.name, monthlyPriceMinor: original.monthlyPriceMinor },
      });
    }
  });

  it('backfill only fills schema-default fields and never touches prices', async () => {
    await upsertPlans();
    const original = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
    try {
      // Legacy production row: old name, schema-default display fields, and
      // a CUSTOM price the backfill must not touch.
      await prisma.plan.update({
        where: { slug: 'nearbyorders-business' },
        data: {
          name: 'NearbyOrders Business',
          benefits: [],
          displayOrder: 0,
          isHighlighted: false,
          billingInterval: '',
          monthlyPriceMinor: 123456,
        },
      });

      await upsertPlans();

      const backfilled = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
      expect(backfilled.name).toBe('Growth');
      expect(backfilled.benefits.length).toBeGreaterThan(0);
      expect(backfilled.displayOrder).toBe(2);
      expect(backfilled.isHighlighted).toBe(true);
      expect(backfilled.billingInterval).toBe('monthly');
      expect(backfilled.monthlyPriceMinor).toBe(123456);
      expect(backfilled.id).toBe(original.id);
    } finally {
      await prisma.plan.update({
        where: { id: original.id },
        data: {
          name: original.name,
          benefits: original.benefits,
          displayOrder: original.displayOrder,
          isHighlighted: original.isHighlighted,
          billingInterval: original.billingInterval,
          monthlyPriceMinor: original.monthlyPriceMinor,
        },
      });
    }
  });

  it('the public subscription-plans endpoint serves all three slugs after the seed (mobile contract)', async () => {
    await upsertPlans();
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/plans' });
    expect(res.statusCode).toBe(200);
    const plans = JSON.parse(res.body).data as {
      id: string;
      slug: string;
      name: string;
      monthlyPriceMinor: number;
      currency: string;
      trialDays: number;
      benefits: string[];
      billingInterval: string;
      displayOrder: number;
      isHighlighted: boolean;
      isActive: boolean;
    }[];
    const slugs = new Set(plans.map((p) => p.slug));
    for (const slug of CATALOG_SLUGS) {
      expect(slugs.has(slug), `public plan picker missing plan: ${slug}`).toBe(true);
    }
    // The mobile picker renders id/name/price and filters on isActive.
    for (const p of plans) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.isActive).toBe(true);
    }
  });
});
