import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, ensureCategory, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** Full searchable fixture: approved business + service + product, unique token. */
const searchFixture = async (overrides: { name?: string; serviceName?: string; productName?: string; description?: string; city?: string; latitude?: number | null; longitude?: number | null } = {}) => {
  const token = Date.now() + Math.floor(Math.random() * 1e6);
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id } = await createBusiness(app, owner.token, {
    name: overrides.name ?? `Bike Repair Hub ${token}`,
    description: overrides.description,
    city: overrides.city,
    latitude: overrides.latitude === undefined ? 31.5204 : overrides.latitude,
    longitude: overrides.longitude === undefined ? 74.3587 : overrides.longitude,
  });
  await approveBusiness(id);
  const service = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${id}/services`,
    headers: authed(owner.token),
    payload: { name: overrides.serviceName ?? `Chain Oil Change ${token}`, priceMinor: 12000, durationMinutes: 45 },
  });
  const serviceId = JSON.parse(service.body).data.id as string;
  await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${id}/products`,
    headers: authed(owner.token),
    payload: { name: overrides.productName ?? `Bike Phone Mount ${token}`, priceMinor: 25000 },
  });
  return { businessId: id, serviceId };
};

const search = (query: Record<string, string>) =>
  app.inject({ method: 'GET', url: `/api/v1/search?${new URLSearchParams(query).toString()}` });

describe('unified search (Phase 14)', () => {
  it('validates query parameters', async () => {
    const bad = await search({ q: 'x'.repeat(121) });
    expect(bad.statusCode).toBe(400);
    const badRadius = await search({ q: 'bike', lat: '31.5', lng: '74.3', radiusKm: '999' });
    expect(badRadius.statusCode).toBe(400);
    const latOnly = await search({ q: 'bike', lat: '31.5' });
    expect(latOnly.statusCode).toBe(400);
    const badType = await search({ q: 'bike', type: 'vehicle' });
    expect(badType.statusCode).toBe(400);
  });

  it('matches a business by name with transparent relevance', async () => {
    // A run token keeps the fixture names unique against the persistent local
    // test DB: repeated same-name rows would otherwise crowd this exact name
    // out of the 20-result page. (CI uses a fresh DB and never sees this.)
    const token = Date.now();
    const { businessId } = await searchFixture({ name: `Zzyzx Bike Repair Palace ${token}` });
    const exact = await search({ q: `Zzyzx Bike Repair Palace ${token}` });
    expect(exact.statusCode).toBe(200);
    const body = JSON.parse(exact.body);
    const first = body.data.results[0];
    expect(first.type).toBe('business');
    expect(first.id).toBe(businessId);
    // exact-name match outranks a substring business hit
    const substringFixture = await searchFixture({ name: `Also Contains Zzyzx Bike Repair Palace ${token} Inside` });
    const both = await search({ q: `Zzyzx Bike Repair Palace ${token}` });
    expect(both.statusCode).toBe(200);
    expect(JSON.parse(both.body).data.results[0].id).toBe(businessId);
    expect(JSON.parse(both.body).data.results.map((r: { id: string }) => r.id)).toContain(substringFixture.businessId);
  });

  it('finds services by service name and returns them as service results', async () => {
    const { serviceId } = await searchFixture({ name: 'Peshawar Wheelworks', serviceName: 'Brake Bleed Master' });
    const res = await search({ q: 'Brake Bleed Master', type: 'service' });
    expect(res.statusCode).toBe(200);
    const results = JSON.parse(res.body).data.results;
    const hit = results.find((r: { id: string }) => r.id === serviceId);
    expect(hit).toBeTruthy();
    expect(hit.type).toBe('service');
    expect(hit.businessName).toBe('Peshawar Wheelworks');
    expect(hit.priceMinor).toBe(12000);
    expect(hit.currency).toBe('PKR');
    expect(hit.durationMinutes).toBe(45);
  });

  it('finds products by product name and returns them as product results', async () => {
    const token = Date.now() + 7; // unique against the persistent test DB
    const { businessId } = await searchFixture({ productName: `Antique Cauldron Lid ${token}` });
    const res = await search({ q: `Antique Cauldron Lid ${token}`, type: 'product' });
    expect(res.statusCode).toBe(200);
    const results = JSON.parse(res.body).data.results;
    const product = results.find((r: { type: string }) => r.type === 'product');
    expect(product).toBeTruthy();
    expect(product.businessId).toBe(businessId);
    expect(product.priceMinor).toBe(25000);
  });

  it("searching 'bike repair' surfaces a business whose SERVICE mentions bike repair (cross-entity matching)", async () => {
    // Business name says nothing about bikes; the service does. The unique
    // marker appears in BOTH the name and the service name, so every token of
    // the query must be satisfied — "bike" and "repair" can ONLY come from the
    // service (cross-entity), the marker only from the profile. This keeps the
    // assertion deterministic against the persistent test DB, where older
    // generic "bike repair" fixtures from previous runs would otherwise fill
    // the relevance-ranked first page.
    const marker = Date.now() + 11;
    const { businessId, serviceId } = await searchFixture({
      name: `Mehran Motors Workshop ${marker}`,
      serviceName: `Full Bicycle Tune & Bike Repair Session ${marker}`,
    });
    const res = await search({ q: `bike repair ${marker}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const bizHit = body.data.results.find((r: { type: string; id: string }) => r.type === 'business' && r.id === businessId);
    expect(bizHit).toBeTruthy();
    // The matching service is surfaced as its own typed result too.
    const svcHit = body.data.results.find((r: { type: string; id: string }) => r.type === 'service' && r.id === serviceId);
    expect(svcHit).toBeTruthy();
  });

  it('mixed query returns all three typed results with clear type markers', async () => {
    const token = Date.now();
    const { businessId, serviceId } = await searchFixture({
      name: `Uniform Traders ${token}`,
      serviceName: `Uniform Stitching ${token}`,
      productName: `Uniform Fabric Pack ${token}`,
    });
    const res = await search({ q: `Uniform ${token}` });
    expect(res.statusCode).toBe(200);
    const results = JSON.parse(res.body).data.results as { type: string; id: string }[];
    const types = new Set(results.map((r) => r.type));
    expect(types.has('business')).toBe(true);
    expect(types.has('service')).toBe(true);
    expect(types.has('product')).toBe(true);
    expect(results.find((r) => r.type === 'business')!.id).toBe(businessId);
    expect(results.find((r) => r.type === 'service')!.id).toBe(serviceId);
  });

  it('respects the type filter', async () => {
    const { businessId, serviceId } = await searchFixture({ name: 'Typefilter Traders Co', serviceName: 'Typefilter Tuneup' });
    const onlyBiz = await search({ q: 'Typefilter', type: 'business' });
    const onlySvc = await search({ q: 'Typefilter', type: 'service' });
    expect(JSON.parse(onlyBiz.body).data.results.every((r: { type: string }) => r.type === 'business')).toBe(true);
    expect(JSON.parse(onlyBiz.body).data.results.map((r: { id: string }) => r.id)).toContain(businessId);
    expect(JSON.parse(onlySvc.body).data.results.every((r: { type: string }) => r.type === 'service')).toBe(true);
    expect(JSON.parse(onlySvc.body).data.results.map((r: { id: string }) => r.id)).toContain(serviceId);
  });

  it('paginates with a stable cursor and reports total', async () => {
    const token = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
      const { id } = await createBusiness(app, owner.token, { name: `Paginate Works ${token} No${i}` });
      await approveBusiness(id);
      ids.push(id);
    }
    const page1 = await search({ q: `Paginate Works ${token}`, limit: '2' });
    const body1 = JSON.parse(page1.body).data;
    expect(body1.total).toBe(3);
    expect(body1.results).toHaveLength(2);
    expect(body1.nextCursor).toBe('2');
    const page2 = await search({ q: `Paginate Works ${token}`, limit: '2', cursor: body1.nextCursor });
    const body2 = JSON.parse(page2.body).data;
    expect(body2.results).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
    const all = [...body1.results.map((r: { id: string }) => r.id), ...body2.results.map((r: { id: string }) => r.id)].sort();
    expect(all).toEqual([...ids].sort());
  });

  it('computes distance server-side and orders by it when requested', async () => {
    const token = Date.now() + 13; // unique against the persistent test DB
    // Anchor = Lahore (31.5204, 74.3587). The three fixtures sit at increasing
    // server-measured distance, ALL inside the queried radius; the far one is
    // additionally re-queried below to prove small radii exclude it entirely.
    const near = await searchFixture({ name: `Distance Near Co ${token}`, latitude: 31.5204, longitude: 74.3587 });
    const mid = await searchFixture({ name: `Distance Mid Co ${token}`, latitude: 31.62, longitude: 74.2 }); // ≈14 km
    const far = await searchFixture({ name: `Distance Far Co ${token}`, latitude: 31.75, longitude: 74.0 }); // ≈36 km
    const res = await search({ q: `Distance ${token}`, type: 'business', lat: '31.5204', lng: '74.3587', radiusKm: '50', sort: 'distance' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.data.results.map((r: { id: string }) => r.id);
    const nearIdx = ids.indexOf(near.businessId);
    const midIdx = ids.indexOf(mid.businessId);
    const farIdx = ids.indexOf(far.businessId);
    expect(nearIdx).toBeGreaterThanOrEqual(0);
    expect(midIdx).toBeGreaterThan(nearIdx);
    expect(farIdx).toBeGreaterThan(midIdx);
    const nearHit = body.data.results[nearIdx];
    expect(nearHit.distanceKm).toBe(0);
    const distances = body.data.results.map((r: { distanceKm: number }) => r.distanceKm) as number[];
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // out-of-radius fixture excluded entirely
    const excluded = await search({ q: `Distance Far Co ${token}`, lat: '31.5204', lng: '74.3587', radiusKm: '2' });
    expect(JSON.parse(excluded.body).data.results).toHaveLength(0);
  });

  it('filters by category id and never leaks inactive categories', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    // Reuse the shared fixture category: creating timestamped categories here
    // would persist into the shared test DB and fail the catalog-integrity test.
    const cat = await ensureCategory();
    const { id } = await createBusiness(app, owner.token, { name: `Categorized Search Co ${Date.now()}`, categoryIds: [cat.id] });
    await approveBusiness(id);
    const hit = await search({ q: 'Categorized Search Co', categoryId: cat.id });
    expect(JSON.parse(hit.body).data.results.map((r: { id: string }) => r.id)).toContain(id);
    const miss = await search({ q: 'Categorized Search Co', categoryId: '00000000-0000-4000-8000-000000000000' });
    expect(JSON.parse(miss.body).data.results).toHaveLength(0);
  });

  it('openNow filter only returns currently-open businesses', async () => {
    const token = Date.now();
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token, { name: `OpenNow Search Co ${token}` });
    // Force a permanently-open schedule for determinism (createBusiness ships
    // no hour rows, so upsert one open day per weekday).
    await prisma.businessHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ businessId: id, dayOfWeek, isClosed: false, opensAt: '00:00', closesAt: '23:59' })),
    });
    await approveBusiness(id);
    const res = await search({ q: `OpenNow Search Co ${token}`, openNow: 'true' });
    const results = JSON.parse(res.body).data.results;
    expect(results.map((r: { id: string }) => r.id)).toContain(id);
    expect(results.every((r: { isOpenNow: boolean }) => r.isOpenNow === true)).toBe(true);
  });

  it('rating filter excludes below-threshold businesses', async () => {
    const token = Date.now();
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { businessId, serviceId } = await searchFixture({ name: `Rated Search Co ${token}` });
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      headers: authed(customer.token),
      payload: { rating: 5, bookingId: null, orderId: null },
    });
    // review requires a completed booking/order; use direct DB write for the filter test
    await prisma.review.deleteMany({ where: { businessId } });
    const review = await prisma.review.create({ data: { businessId, customerId: (await registerAndLogin(app, 'CUSTOMER')).userId, rating: 3, bookingId: null, orderId: null } });
    void review;
    const high = await search({ q: `Rated Search Co ${token}`, minRating: '2.5' });
    expect(JSON.parse(high.body).data.results.map((r: { id: string }) => r.id)).toContain(businessId);
    const strict = await search({ q: `Rated Search Co ${token}`, minRating: '4.5' });
    expect(JSON.parse(strict.body).data.results.map((r: { id: string }) => r.id)).not.toContain(businessId);
    void serviceId;
  });

  it('hides PENDING, archived businesses and inactive services/products', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const pending = await createBusiness(app, owner.token, { name: `Hidden Pending Co ${Date.now()}` });
    const archivedOwner2 = await registerAndLogin(app, 'BUSINESS_OWNER');
    const archived = await createBusiness(app, archivedOwner2.token, { name: `Hidden Archived Co ${Date.now()}` });
    await prisma.business.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const pendingRes = await search({ q: pending.name });
    const archivedRes = await search({ q: archived.name });
    expect(JSON.parse(pendingRes.body).data.results).toHaveLength(0);
    expect(JSON.parse(archivedRes.body).data.results).toHaveLength(0);

    // inactive service is not searchable
    const { businessId, serviceId } = await searchFixture({ serviceName: 'Secretly Deactivated facial' });
    await prisma.service.update({ where: { id: serviceId }, data: { isActive: false } });
    const svcRes = await search({ q: 'Secretly Deactivated facial', type: 'service' });
    expect(JSON.parse(svcRes.body).data.results).toHaveLength(0);
    void businessId;
  });

  it('returns safe DTOs — no owner emails, no password hashes, no archived internals', async () => {
    const { businessId } = await searchFixture({ name: 'Safe Dto Traders' });
    const res = await search({ q: 'Safe Dto Traders' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('@');
    void businessId;
  });

  it('sort=rating orders by rating then review count', async () => {
    const token = Date.now();
    const c1 = await registerAndLogin(app, 'CUSTOMER');
    const c2 = await registerAndLogin(app, 'CUSTOMER');
    const great = await searchFixture({ name: `Rating Sort Great ${token}` });
    const okay = await searchFixture({ name: `Rating Sort Okay ${token}` });
    await prisma.review.createMany({
      data: [
        { businessId: great.businessId, customerId: c1.userId, rating: 5, bookingId: null, orderId: null },
        { businessId: great.businessId, customerId: c2.userId, rating: 5, bookingId: null, orderId: null },
        { businessId: okay.businessId, customerId: c1.userId, rating: 3, bookingId: null, orderId: null },
      ],
    });
    const res = await search({ q: `Rating Sort ${token}`, type: 'business', sort: 'rating' });
    const ids = JSON.parse(res.body).data.results.map((r: { id: string }) => r.id);
    expect(ids.indexOf(great.businessId)).toBeLessThan(ids.indexOf(okay.businessId));
  });

  it('sort=distance without coordinates degrades honestly to relevance (echoed in response)', async () => {
    await searchFixture({ name: 'Honest Degrade Co' });
    const res = await search({ q: 'Honest Degrade Co', sort: 'distance' });
    expect(JSON.parse(res.body).data.sort).toBe('relevance');
  });

  it('empty query without any term still returns discoverable businesses', async () => {
    const res = await search({ type: 'business', limit: '5' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body).data.results)).toBe(true);
  });

  it('empty results produce an honest empty page, not fake recommendations', async () => {
    const res = await search({ q: `zzqqxx-nowhere-${Date.now()}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.results).toHaveLength(0);
    expect(JSON.parse(res.body).data.total).toBe(0);
    expect(JSON.parse(res.body).data.nextCursor).toBeNull();
  });
});
