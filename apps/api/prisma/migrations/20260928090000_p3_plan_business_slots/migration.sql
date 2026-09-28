-- P3: plan-based business slots.
--
-- Adds Plan.maxBusinesses — the per-plan cap on how many live businesses one
-- owner account may create while that plan is their highest live plan. The
-- plan catalog stays the source of truth; clients must never hard-code it.
--
-- Existing rows all receive the new column's DEFAULT (1) first; the UPDATEs
-- below then fix the seeded catalog rows to their intended values. Rows
-- created afterwards by the idempotent seed (or the API's plan-ensure
-- helper) carry the catalog value directly, so this backfill runs exactly
-- once per row. Deployable through the standard `prisma migrate deploy`
-- production process — no manual data changes needed.

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "maxBusinesses" INTEGER NOT NULL DEFAULT 1;

-- Backfill the seeded catalog to its intended slot values.
-- 'starter' intentionally keeps the default 1.
UPDATE "Plan" SET "maxBusinesses" = 3 WHERE "slug" = 'nearbyorders-business';
UPDATE "Plan" SET "maxBusinesses" = 10 WHERE "slug" = 'premium';
