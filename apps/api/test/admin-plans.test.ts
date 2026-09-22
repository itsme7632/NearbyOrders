import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

const planBody = (slug: string) => ({
  slug,
  name: `Test Plan ${slug}`,
  description: 'A test plan',
  monthlyPriceMinor: 199900,
  currency: 'PKR',
  trialDays: 14,
  benefits: ['Benefit one', 'Benefit two'],
  billingInterval: 'monthly',
  displayOrder: 5,
  isHighlighted: false,
  isActive: true,
});

describe('admin subscription plan management', () => {
  it('admin lists all plans (including inactive) with usage counts', async () => {
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/plans', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const plans = res.json().data as { slug: string; isActive: boolean; usageCount: number }[];
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const slugs = plans.map((p) => p.slug);
    expect(slugs).toContain('starter');
    expect(slugs).toContain('nearbyorders-business');
    expect(slugs).toContain('premium');
    for (const plan of plans) expect(typeof plan.usageCount).toBe('number');
  });

  it('admin creates a plan; duplicate slug is rejected', async () => {
    const admin = await registerAdminAndLogin(app);
    const slug = `custom-${Date.now()}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/plans', headers: authed(admin.token), payload: planBody(slug) });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.slug).toBe(slug);
    expect(created.json().data.usageCount).toBe(0);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/plans', headers: authed(admin.token), payload: planBody(slug) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('PLAN_SLUG_IN_USE');
    // Clean up: the shared DB persists between runs, and an active plan
    // would leak into the public plan catalog assertions elsewhere.
    const planId = created.json().data.id;
    const gone = await app.inject({ method: 'DELETE', url: `/api/v1/admin/subscription/plans/${planId}`, headers: authed(admin.token) });
    expect(gone.statusCode).toBe(204);
  });

  it('admin patches a plan; live subscriptions keep their snapshots', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const business = await createBusiness(app, owner.token);
    await prisma.business.update({ where: { id: business.id }, data: { trialStatus: 'ELIGIBLE' } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${business.id}/subscription/trial/apply`,
      headers: authed(owner.token),
      payload: { planSlug: 'nearbyorders-business' },
    });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'nearbyorders-business' } });
    // Snapshot the full row so the shared catalog is restored exactly,
    // whatever the seed data currently holds.
    const original = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    try {
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/subscription/plans/${plan.id}`,
        headers: authed(admin.token),
        payload: { name: 'Growth Plus', monthlyPriceMinor: 349900, benefits: ['New benefit'] },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.name).toBe('Growth Plus');
      expect(patched.json().data.usageCount).toBeGreaterThanOrEqual(1);
      // The live subscription froze the commercial terms at activation.
      const sub = await prisma.businessSubscription.findFirstOrThrow({ where: { businessId: business.id } });
      expect(sub.planNameSnapshot).toBe('Growth');
      expect(sub.planPriceMinorSnapshot).toBe(299900);
    } finally {
      // Restore the canonical catalog row exactly as it was.
      await prisma.plan.update({
        where: { id: plan.id },
        data: {
          name: original.name,
          monthlyPriceMinor: original.monthlyPriceMinor,
          benefits: original.benefits,
          description: original.description,
          billingInterval: original.billingInterval,
          trialDays: original.trialDays,
          isActive: original.isActive,
          displayOrder: original.displayOrder,
        },
      });
    }
  });

  it('deleting a referenced plan is blocked with PLAN_IN_USE; an unused plan deletes', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const business = await createBusiness(app, owner.token);
    await prisma.business.update({ where: { id: business.id }, data: { trialStatus: 'ELIGIBLE' } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${business.id}/subscription/trial/apply`,
      headers: authed(owner.token),
      payload: { planSlug: 'starter' },
    });
    const starter = await prisma.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
    const blocked = await app.inject({ method: 'DELETE', url: `/api/v1/admin/subscription/plans/${starter.id}`, headers: authed(admin.token) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('PLAN_IN_USE');
    const slug = `disposable-${Date.now()}`;
    const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/plans', headers: authed(admin.token), payload: planBody(slug) })).json().data;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/subscription/plans/${created.id}`, headers: authed(admin.token) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/admin/subscription/plans/00000000-0000-4000-8000-000000000000', headers: authed(admin.token) })).statusCode).toBe(404);
  });

  it('non-admins cannot manage plans', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/subscription/plans', headers: authed(owner.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/subscription/plans', headers: authed(owner.token), payload: planBody('x') })).statusCode).toBe(403);
  });
});
