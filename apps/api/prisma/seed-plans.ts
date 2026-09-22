/**
 * Production-safe subscription-plan seeding.
 *
 * The production incident: the intended 3-plan catalog (Starter, Growth,
 * Premium — PLAN_CATALOG in src/lib.ts) existed only in code. upsertPlans()
 * in prisma/seed.ts is idempotent (upsert by slug with `update: {}`, plus a
 * backfill that only fills schema-default fields), BUT it was only wired
 * into the dev seed main() (`pnpm prisma:seed`), which production never runs
 * (it also prunes categories and creates dev payment methods). Production's
 * single nearbyorders-business row was lazily created by findPlan() in
 * src/server.ts on first subscription use — so the public plan picker only
 * ever saw one plan instead of three.
 *
 * This script reuses upsertPlans() for a production-safe plans-only run —
 * mirroring prisma/seed-categories.ts:
 *  - Upsert by slug, `update: {}` — re-running never overwrites admin edits.
 *  - Backfill only fills schema-default fields (empty benefits, displayOrder
 *    0, unset highlighted, blank billingInterval) and renames the legacy
 *    nearbyorders-business row from "NearbyOrders Business" to "Growth".
 *    Prices (monthlyPriceMinor) and any admin-set values are NEVER touched.
 *  - It must NEVER create demo data, prune categories, or touch payment
 *    methods — safe to run against the production database any number of
 *    times; the only change is ensuring the 3 catalog plans exist.
 *
 * Usage (on the VPS, from the repo root, after git pull):
 *   pnpm --filter @nearbyorders/api prisma:seed:plans
 */
import { prisma, upsertPlans } from './seed.js';

try {
  await upsertPlans();
  console.log('Plan seed complete.');
} finally {
  await prisma.$disconnect();
}
