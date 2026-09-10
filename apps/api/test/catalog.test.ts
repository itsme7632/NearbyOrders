import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { makeApp, registerAdminAndLogin, authed } from './helpers.js';
import { pruneStrayCategories, upsertCoreCategories } from '../prisma/seed.js';

const app = await makeApp();

/** The intentional, human-readable customer catalog (mirrors prisma/seed.ts). */
const LEGITIMATE_SLUGS = [
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

/**
 * The customer-facing category catalog must contain only intentional,
 * human-readable categories. Test fixtures used to pollute the shared dev
 * database ("Admin Cat 178…", "Helper Category", …) — the suite now runs
 * against a throwaway database (test/setup.ts refuses the dev DATABASE_URL),
 * and the seed prunes unreferenced strays. These assertions document the
 * guarantee and the deterministic ordering contract.
 */
describe('category catalog integrity', () => {
  it('public list returns only active categories ordered deterministically by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body).data as { name: string; slug: string; isActive: boolean }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.isActive)).toBe(true);
    const names = list.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('seed prune removes stray test categories while upsert restores the core set', async () => {
    // Simulate exactly the pollution that used to reach the dev database:
    // test fixtures writing timestamped categories straight into the DB.
    const stamp = Date.now();
    await prisma.category.create({ data: { name: `List Cat ${stamp}`, slug: `list-cat-${stamp}` } }).catch(() => undefined); // tolerate reruns
    await prisma.category.create({ data: { name: `Helper Category ${stamp}`, slug: `helper-category-${stamp}` } }).catch(() => undefined);

    // Keep this heat-replay idempotent: the seed has already run and
  // already pruned any strays created above by test helpers.
  await pruneStrayCategories();
  await upsertCoreCategories();

  const remaining = await prisma.category.findMany({ where: { slug: { in: [`list-cat-${stamp}`, `helper-category-${stamp}`] } } });
  expect(remaining).toHaveLength(0);

    const cores = await prisma.category.findMany({ where: { slug: { in: LEGITIMATE_SLUGS } } });
    expect(cores.length).toBe(LEGITIMATE_SLUGS.length);
    for (const row of cores) {
      expect(row.name).not.toMatch(/\d{4,}/);
      expect(row.name.length).toBeGreaterThan(2);
      expect(row.isActive).toBe(true);
    }
  });

  it('prune never deletes a category still referenced by a business', async () => {
    // A category with attached businesses is data, not pollution: it must
    // survive and be left for an admin to rename.
    const kept = await prisma.category.findFirstOrThrow({ where: { slug: 'food-restaurants' } });
    await pruneStrayCategories();
    expect(await prisma.category.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });

  it('catalog contains no test/timestamp pollution patterns', async () => {
    // Verify the live public catalog — not the full DB (a category still
    // attached to a demo business is kept for an admin to rename).
    const pub = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(pub.statusCode).toBe(200);
    const rows = (JSON.parse(pub.body).data as { name: string; slug: string }[]);
    const pattern = /(^|\b)(admin cat|list cat|toggle cat|hide cat|helper category|evil cat|test cat|demo cat)\b/i;
    const timestamped = /\d{10,}/; // e.g. "Admin Cat 1788983236997"
    for (const c of rows) {
      expect(pattern.test(c.name), `polluted category name in catalog: ${c.name}`).toBe(false);
      expect(timestamped.test(c.name), `timestamp-like category name in catalog: ${c.name}`).toBe(false);
      expect(pattern.test(c.slug), `polluted category slug in catalog: ${c.slug}`).toBe(false);
    }
  });

  it('admin can still add a category and it becomes publicly visible', async () => {
    const { token } = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers: authed(token),
      payload: { name: 'Agriculture' },
    });
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body).data as { slug: string };
    expect(created.slug).toBe('agriculture');

    const pub = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(JSON.parse(pub.body).data.some((c: { slug: string }) => c.slug === 'agriculture')).toBe(true);
  });
});
