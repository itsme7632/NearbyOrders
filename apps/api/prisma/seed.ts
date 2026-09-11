/**
 * Development seed. Safe to run repeatedly.
 *
 * 1. Core categories: always upserted (idempotent, production-safe).
 * 2. Demo data: ONLY created when SEED_DEMO_DATA=1 is set. Demo records are
 *    prefixed "[Demo]" and use fixed `demo-*` slugs/emails so they can never be
 *    mistaken for real businesses. Never run with this flag in production.
 *
 * Usage:
 *   pnpm --filter @nearbyorders/api prisma:seed
 *   SEED_DEMO_DATA=1 pnpm --filter @nearbyorders/api prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { PLAN_CATALOG } from '../src/lib.js';

const prisma = new PrismaClient();

const CORE_CATEGORIES: { name: string; slug: string }[] = [
  { name: 'Food & Restaurants', slug: 'food-restaurants' },
  { name: 'Beauty & Salon', slug: 'beauty-salon' },
  { name: 'Health & Medical', slug: 'health-medical' },
  { name: 'Home Services', slug: 'home-services' },
  { name: 'Automotive', slug: 'automotive' },
  { name: 'Education', slug: 'education' },
  { name: 'Fitness', slug: 'fitness' },
  { name: 'Shopping', slug: 'shopping' },
  { name: 'Professional Services', slug: 'professional-services' },
  { name: 'Events & Entertainment', slug: 'events-entertainment' },
];

/**
 * Development seeds accidentally produced by test fixtures that once ran
 * against the shared dev database ("Admin Cat 178…", "Helper Category", …).
 * They are only deleted when no business references them; any category with
 * attached businesses is left untouched for an admin to rename instead.
 */
export async function pruneStrayCategories(): Promise<void> {
  const strays = await prisma.category.findMany({
    where: { businesses: { none: {} } },
    select: { id: true, name: true, slug: true },
  });
  const junk = strays.filter((c) => !CORE_CATEGORIES.some((core) => core.slug === c.slug));
  if (junk.length === 0) return;
  const result = await prisma.category.deleteMany({ where: { id: { in: junk.map((c) => c.id) } } });
  console.log(`Pruned ${result.count} stray test categories (none referenced by businesses).`);
}

const DEFAULT_HOURS = [
  { dayOfWeek: 0, isClosed: true, opensAt: null, closesAt: null },
  { dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  { dayOfWeek: 2, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  { dayOfWeek: 3, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  { dayOfWeek: 4, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  { dayOfWeek: 5, isClosed: false, opensAt: '09:00', closesAt: '22:00' },
  { dayOfWeek: 6, isClosed: false, opensAt: '10:00', closesAt: '23:00' },
];

export async function upsertCoreCategories() {
  for (const c of CORE_CATEGORIES) {
    try {
      await prisma.category.upsert({
        where: { slug: c.slug },
        update: {},
        create: { name: c.name, slug: c.slug, isActive: true },
      });
    } catch (err) {
      // Fresh-DB race (the test suite boots an unseeded database and runs
      // files in parallel workers): a sibling worker's first insert can win
      // between our SELECT and INSERT, so our upsert fails with P2002 on the
      // other unique constraint (name). The winner wrote the identical
      // canonical row — confirm it exists and move on.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const row = await prisma.category.findUnique({ where: { slug: c.slug } });
      if (!row) throw err;
    }
  }
  console.log(`Seeded ${CORE_CATEGORIES.length} core categories.`);
}

async function createDemoData() {
  const passwordHash = await argon2.hash('DemoPassw0rd!2026', { type: argon2.argon2id });

  const owner = await prisma.user.upsert({
    where: { email: 'demo-owner@nearbyorders.test' },
    update: {},
    create: { email: 'demo-owner@nearbyorders.test', passwordHash, role: 'BUSINESS_OWNER', firstName: 'Demo', lastName: 'Owner' },
  });

  await prisma.user.upsert({
    where: { email: 'demo-customer@nearbyorders.test' },
    update: {},
    create: { email: 'demo-customer@nearbyorders.test', passwordHash, role: 'CUSTOMER', firstName: 'Demo', lastName: 'Customer' },
  });

  // Admin used for approving self-service listings in preview environments.
  await prisma.user.upsert({
    where: { email: 'demo-admin@nearbyorders.test' },
    update: {},
    create: { email: 'demo-admin@nearbyorders.test', passwordHash, role: 'ADMIN', firstName: 'Demo', lastName: 'Admin' },
  });

  const categories = await prisma.category.findMany();
  const bySlug = (slug: string) => categories.find((c) => c.slug === slug)!.id;

  const demoBusinesses = [
    {
      slug: 'demo-gulberg-grill',
      name: '[Demo] Gulberg Grill',
      description: 'Demo restaurant serving burgers, pizza and drinks for preview purposes only.',
      categorySlug: 'food-restaurants',
      city: 'Lahore',
      locality: 'Gulberg III',
      address: '12 Demo Lane, Gulberg III',
      latitude: 31.5155,
      longitude: 74.3436,
      isVerified: true,
      phone: '+92 300 0000001',
    },
    {
      slug: 'demo-dha-glow-salon',
      name: '[Demo] DHA Glow Salon',
      description: 'Demo beauty salon offering hair and skincare services for preview purposes only.',
      categorySlug: 'beauty-salon',
      city: 'Lahore',
      locality: 'DHA Phase 5',
      address: '8 Sample Street, DHA Phase 5',
      latitude: 31.4697,
      longitude: 74.4103,
      isVerified: true,
      phone: '+92 300 0000002',
    },
    {
      slug: 'demo-clifton-cakes',
      name: '[Demo] Clifton Cake Studio',
      description: 'Demo cake business with custom and birthday cakes for preview purposes only.',
      categorySlug: 'shopping',
      city: 'Karachi',
      locality: 'Clifton',
      address: '3 Frosting Road, Clifton',
      latitude: 24.8138,
      longitude: 67.0299,
      isVerified: false,
      phone: '+92 321 0000003',
    },
  ];

  for (const b of demoBusinesses) {
    await prisma.business.upsert({
      where: { slug: b.slug },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: b.description,
        ownerId: owner.id,
        status: 'APPROVED',
        isVerified: b.isVerified,
        phone: b.phone,
        city: b.city,
        locality: b.locality,
        address: b.address,
        latitude: b.latitude,
        longitude: b.longitude,
        categories: { create: [{ categoryId: bySlug(b.categorySlug) }] },
        hours: { create: DEFAULT_HOURS },
      },
    });
  }

  const grill = await prisma.business.findUniqueOrThrow({ where: { slug: 'demo-gulberg-grill' } });
  const salon = await prisma.business.findUniqueOrThrow({ where: { slug: 'demo-dha-glow-salon' } });
  const cakes = await prisma.business.findUniqueOrThrow({ where: { slug: 'demo-clifton-cakes' } });

  const productSeed = (businessId: string, name: string, priceMinor: number, description?: string) => ({
    businessId,
    name,
    priceMinor,
    description,
  });

  const products = [
    productSeed(grill.id, 'Beef Burger', 65000, 'Grilled beef patty with house sauce'),
    productSeed(grill.id, 'Chicken Pizza (Large)', 145000, '12-inch pizza with chicken tikka topping'),
    productSeed(grill.id, 'Fresh Lime Soda', 25000),
    productSeed(cakes.id, 'Custom Cake (per kg)', 350000, 'Made to order, 48h notice'),
    productSeed(cakes.id, 'Birthday Cake (per kg)', 280000),
  ];
  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { businessId: p.businessId, name: p.name } });
    if (!existing) await prisma.product.create({ data: p });
  }

  const services = [
    { businessId: salon.id, name: 'Haircut & Styling', priceMinor: 120000, durationMinutes: 45 },
    { businessId: salon.id, name: 'Facial (60 min)', priceMinor: 250000, durationMinutes: 60 },
    { businessId: cakes.id, name: 'Cake Tasting Session', priceMinor: 150000, durationMinutes: 30 },
  ];
  for (const s of services) {
    const existing = await prisma.service.findFirst({ where: { businessId: s.businessId, name: s.name } });
    if (!existing) await prisma.service.create({ data: s });
  }

  console.log('Demo data ready (owner demo-owner@nearbyorders.test / DemoPassw0rd!2026 — DEV ONLY).');
}

/**
 * Ensures the commercial plan catalog exists (Phase 7A). Idempotent upsert by
 * slug; the update is a no-op so re-seeding never clobbers admin-edited
 * prices. PLAN_CATALOG (src/lib.ts) is the single source of truth.
 */
export async function upsertPlans() {
  for (const spec of PLAN_CATALOG) {
    await prisma.plan.upsert({
      where: { slug: spec.slug },
      update: {},
      create: { ...spec },
    });
  }
  console.log(`Seeded ${PLAN_CATALOG.length} subscription plan(s).`);
}

async function main() {
  await pruneStrayCategories();
  await upsertCoreCategories();
  await upsertPlans();
  if (process.env.SEED_DEMO_DATA === '1') {
    console.log('SEED_DEMO_DATA=1: creating clearly-marked demo data…');
    await createDemoData();
  }
}

main()
  .then(() => console.log('Seed complete.'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
