/**
 * Production category-seed regression test.
 *
 * Production incident (2026-09-22, Xiaomi device): the "List my business"
 * category selector was empty because GET /api/v1/categories returned
 * `{ "data": [] }` — the production database had zero category rows. The
 * mobile screen, the API route, and the auth story were all correct; the
 * data was simply never seeded.
 *
 * The production-safe fix is prisma/seed-categories.ts, which upserts ONLY
 * the 10 core categories (by slug, `update: {}` so admin edits survive).
 * Unlike `prisma:seed`, it must never prune categories, seed demo data, or
 * create dev/test payment methods in production.
 *
 * These tests pin that contract against the throwaway test database:
 *  1. From a (partially) empty category table, upsertCoreCategories()
 *     restores exactly the 10 core categories, all active.
 *  2. Re-running is idempotent and never overwrites an admin-edited name.
 *  3. The public GET /api/v1/categories route (what the mobile app calls)
 *     then serves the full catalog.
 *  4. Importing prisma/seed.js has NO side effects: the full seed (prune +
 *     demo data + dev payment methods) only runs when seed.ts is the
 *     executed entry point. This is the production-safety pin — a broken
 *     guard would let a categories-only import inject test payment methods
 *     into production.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { upsertCoreCategories } from '../prisma/seed.js';
import { makeApp } from './helpers.js';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedJsPath = join(apiDir, 'prisma', 'seed.js');

const app = await makeApp();

const CORE_SLUGS = [
  'food-restaurants',
  'beauty-salon',
  'health-medical',
  'home-services',
  'automotive',
  'education',
  'fitness',
  'shopping',
  'professional-services',
  'events-entertainment',
];

/** Remove core categories no business references, mimicking the empty production table. */
async function removeUnreferencedCoreCategories(): Promise<void> {
  const referenced = await prisma.businessCategory.findMany({ select: { categoryId: true } });
  const referencedIds = new Set(referenced.map((r) => r.categoryId));
  const cores = await prisma.category.findMany({ where: { slug: { in: CORE_SLUGS } }, select: { id: true } });
  const deletable = cores.map((c) => c.id).filter((id) => !referencedIds.has(id));
  if (deletable.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: deletable } } });
  }
}

describe('production category seed (empty catalog incident)', () => {
  it('restores the 10 core categories from an empty-ish table', async () => {
    await removeUnreferencedCoreCategories();
    await upsertCoreCategories();

    const rows = await prisma.category.findMany({
      where: { slug: { in: CORE_SLUGS } },
      orderBy: { slug: 'asc' },
    });
    expect(rows).toHaveLength(CORE_SLUGS.length);
    for (const row of rows) {
      expect(row.isActive).toBe(true);
      expect(row.name.length).toBeGreaterThan(2);
    }
    // Spot-check the canonical names the mobile selector displays.
    const bySlug = new Map(rows.map((r) => [r.slug, r.name]));
    expect(bySlug.get('food-restaurants')).toBe('Food & Restaurants');
    expect(bySlug.get('beauty-salon')).toBe('Beauty & Salon');
    expect(bySlug.get('shopping')).toBe('Shopping');
  });

  it('is idempotent and never overwrites an admin-edited name', async () => {
    await upsertCoreCategories();
    const before = await prisma.category.count({ where: { slug: { in: CORE_SLUGS } } });

    // Simulate an admin renaming a category in production.
    await prisma.category.update({
      where: { slug: 'fitness' },
      data: { name: 'Fitness & Gyms' },
    });
    try {
      await upsertCoreCategories();
      const after = await prisma.category.count({ where: { slug: { in: CORE_SLUGS } } });
      expect(after).toBe(before);
      const renamed = await prisma.category.findUniqueOrThrow({ where: { slug: 'fitness' } });
      expect(renamed.name).toBe('Fitness & Gyms');
    } finally {
      await prisma.category.update({ where: { slug: 'fitness' }, data: { name: 'Fitness' } });
    }
  });

  it('the public categories endpoint serves the seeded catalog (mobile contract)', async () => {
    await upsertCoreCategories();
    const res = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body).data as { id: string; name: string; slug: string; isActive: boolean }[];
    const slugs = new Set(list.map((c) => c.slug));
    for (const slug of CORE_SLUGS) {
      expect(slugs.has(slug), `public catalog missing core category: ${slug}`).toBe(true);
    }
    // The mobile selector maps id -> option value and name -> label.
    for (const c of list) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
    }
  });

  it('importing prisma/seed.js never runs the full seed (entry-point guard)', () => {
    // Run in a subprocess without any database env: if the guard were
    // broken, the import would execute main() and fail loudly on the DB
    // connection (or worse, seed). Success = silent import.
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    const out = execFileSync(
      'npx',
      ['tsx', '-e', `import(${JSON.stringify(seedJsPath)}).then(() => console.log('IMPORT_SIDE_EFFECT_FREE'))`],
      { cwd: apiDir, env, encoding: 'utf8', timeout: 120_000 },
    );
    expect(out.trim()).toBe('IMPORT_SIDE_EFFECT_FREE');
    expect(out).not.toContain('Seed complete.');
    expect(out).not.toContain('Seeded');
  });
});
