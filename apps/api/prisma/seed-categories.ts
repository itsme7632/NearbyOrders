/**
 * Production-safe category seeding.
 *
 * The production database has no category rows, so
 * GET /api/v1/categories returns `{ "data": [] }` and the "List my business"
 * category selector is empty. The 10 core categories already exist as the
 * single source of truth in prisma/seed.ts (CORE_CATEGORIES); this script
 * upserts ONLY those rows — by slug, with `update: {}`, so re-running never
 * overwrites admin edits.
 *
 * Unlike `prisma:seed`, this script does NOT prune stray categories, seed
 * plans/demo data, or create dev/test payment methods — it is safe to run
 * against the production database any number of times and changes nothing
 * except ensuring the 10 core categories exist and are active.
 *
 * Usage (on the VPS, from the repo root):
 *   pnpm --filter @nearbyorders/api prisma:seed:categories
 */
import { prisma, upsertCoreCategories } from './seed.js';

try {
  await upsertCoreCategories();
  console.log('Category seed complete.');
} finally {
  await prisma.$disconnect();
}
