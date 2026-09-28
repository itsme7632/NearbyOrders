import { describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';
import { prisma } from '../src/lib.js';

const app = await makeApp();

const approvedBusiness = async (name: string, city = 'Lahore') => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id, slug } = await createBusiness(app, owner.token, { name, city });
  await approveBusiness(id);
  return { id, slug };
};

describe('discovery', () => {
  it('filters businesses by category', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const food = await prisma.category.upsert({
      where: { slug: 'food-restaurants' },
      update: {},
      create: { name: 'Food & Restaurants', slug: 'food-restaurants' },
    });
    const beauty = await prisma.category.upsert({
      where: { slug: 'beauty-salon' },
      update: {},
      create: { name: 'Beauty & Salon', slug: 'beauty-salon' },
    });

    const foodBiz = await createBusiness(app, owner.token, { name: `Kebab Karahi ${Date.now()}`, categoryIds: [food.id] });
    // P3: the base allowance is 1 business per owner — a second owner keeps
    // this category-filtering scenario independent of plan slots.
    const owner2 = await registerAndLogin(app, 'BUSINESS_OWNER');
    const beautyBiz = await createBusiness(app, owner2.token, { name: `Style Studio ${Date.now()}`, categoryIds: [beauty.id] });
    await approveBusiness(foodBiz.id);
    await approveBusiness(beautyBiz.id);

    const res = await app.inject({ method: 'GET', url: '/api/v1/businesses?category=food-restaurants' });
    expect(res.statusCode).toBe(200);
    const ids = JSON.parse(res.body).data.map((b: { id: string }) => b.id);
    expect(ids).toContain(foodBiz.id);
    expect(ids).not.toContain(beautyBiz.id);
  });

  it('searches businesses by name and description', async () => {
    const unique = Date.now();
    await approvedBusiness(`Sizzler House ${unique}`, 'Lahore');
    await approvedBusiness(`Unrelated Co ${unique}`, 'Karachi');

    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses?q=sizzler%20house%20${unique}` });
    expect(res.statusCode).toBe(200);
    const names = JSON.parse(res.body).data.map((b: { name: string }) => b.name);
    expect(names.some((n: string) => n.includes(`Sizzler House ${unique}`))).toBe(true);
    expect(names.some((n: string) => n.includes(`Unrelated Co ${unique}`))).toBe(false);
  });

  it('supports nearby search with radius and distance sorting', async () => {
    const unique = Date.now();
    // Lahore coords used by the helper: 31.5204, 74.3587
    await approvedBusiness(`Near Spot ${unique}`, 'Lahore');
    await approvedBusiness(`Far Spot ${unique}`, 'Karachi');
    // Move the second business far away geographically.
    const far = await prisma.business.findFirstOrThrow({ where: { name: `Far Spot ${unique}` } });
    await prisma.business.update({ where: { id: far.id }, data: { latitude: 24.8607, longitude: 67.0011 } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/businesses?nearLat=31.5204&nearLng=74.3587&radiusKm=50&limit=100' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { name: string; distanceKm: number }[];
    expect(data.some((b) => b.name === `Near Spot ${unique}`)).toBe(true);
    expect(data.some((b) => b.name === `Far Spot ${unique}`)).toBe(false);
    const distances = data.map((b) => b.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('business detail loads by id and by slug', async () => {
    const unique = Date.now();
    const { id, slug } = await approvedBusiness(`Detail House ${unique}`);

    const byId = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(byId.statusCode).toBe(200);
    expect(JSON.parse(byId.body).data.slug).toBe(slug);

    const bySlug = await app.inject({ method: 'GET', url: `/api/v1/businesses/${slug}` });
    expect(bySlug.statusCode).toBe(200);
    expect(JSON.parse(bySlug.body).data.id).toBe(id);
  });

  it('business detail includes hours, services and products', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token, { name: `Full House ${Date.now()}` });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/hours`,
      headers: authed(owner.token),
      payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '21:00' })),
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/services`,
      headers: authed(owner.token),
      payload: { name: 'Consultation', priceMinor: 500000, durationMinutes: 30 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/products`,
      headers: authed(owner.token),
      payload: { name: 'Widget', priceMinor: 120000 },
    });
    await approveBusiness(id);

    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    const data = JSON.parse(res.body).data;
    expect(data.hours).toHaveLength(7);
    expect(data.services).toHaveLength(1);
    expect(data.products).toHaveLength(1);
    expect(typeof data.isOpenNow).toBe('boolean');
  });

  it('owner lists their own businesses including non-approved ones', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token, { name: `Pending Mine ${Date.now()}` });

    const res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(owner.token) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.map((b: { id: string }) => b.id)).toContain(id);
  });
});
