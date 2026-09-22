import { describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const ownerFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id } = await createBusiness(app, owner.token);
  return { owner, businessId: id };
};

const createService = (token: string, businessId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/services`,
    headers: authed(token),
    payload: body,
  });

const createProduct = (token: string, businessId: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(token),
    payload: body,
  });

describe('owner-scoped management reads (pending businesses never 404)', () => {
  it('owner reads own hours while the business is still PENDING', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/businesses/${businessId}/hours`,
      headers: authed(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body).data)).toBe(true);
    // The public endpoint still 404s for the pending business (approval
    // filter intact) — this is the exact bug the owner endpoints fix.
    const pub = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/hours` });
    expect(pub.statusCode).toBe(404);
  });

  it('owner reads own services and products while PENDING, inactive items included', async () => {
    const { owner, businessId } = await ownerFixture();
    const svc = await createService(owner.token, businessId, { name: 'Hidden Service', priceMinor: 50000 });
    expect(svc.statusCode).toBe(201);
    const serviceId = JSON.parse(svc.body).data.id as string;
    const deactivated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/services/${serviceId}`,
      headers: authed(owner.token),
      payload: { isActive: false },
    });
    expect(deactivated.statusCode).toBe(200);

    const prod = await createProduct(owner.token, businessId, { name: 'Hidden Product', priceMinor: 25000 });
    expect(prod.statusCode).toBe(201);
    const productId = JSON.parse(prod.body).data.id as string;
    const prodOff = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: authed(owner.token),
      payload: { isActive: false },
    });
    expect(prodOff.statusCode).toBe(200);

    const services = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/businesses/${businessId}/services`,
      headers: authed(owner.token),
    });
    expect(services.statusCode).toBe(200);
    const serviceRows = JSON.parse(services.body).data as { id: string; isActive: boolean }[];
    expect(serviceRows.some((s) => s.id === serviceId && s.isActive === false)).toBe(true);

    const products = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/businesses/${businessId}/products`,
      headers: authed(owner.token),
    });
    expect(products.statusCode).toBe(200);
    const productRows = JSON.parse(products.body).data as { id: string; isActive: boolean }[];
    expect(productRows.some((p) => p.id === productId && p.isActive === false)).toBe(true);

    // Public catalog stays approval/active filtered even after approval.
    await approveBusiness(businessId);
    const pubServices = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services` });
    expect(pubServices.statusCode).toBe(200);
    const pubRows = JSON.parse(pubServices.body).data as { id: string }[];
    expect(pubRows.some((s) => s.id === serviceId)).toBe(false);
  });

  it("another owner cannot read a business they don't own", async () => {
    const a = await ownerFixture();
    const b = await ownerFixture();
    for (const path of ['hours', 'services', 'products']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/owner/businesses/${a.businessId}/${path}`,
        headers: authed(b.owner.token),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('unauthenticated requests are rejected', async () => {
    const { businessId } = await ownerFixture();
    const res = await app.inject({ method: 'GET', url: `/api/v1/owner/businesses/${businessId}/services` });
    expect(res.statusCode).toBe(401);
  });
});

describe('public subscription plan catalog', () => {
  it('returns the real plan with real pricing, never an invented tier', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscription/plans' });
    expect(res.statusCode).toBe(200);
    const plans = JSON.parse(res.body).data as {
      slug: string;
      name: string;
      description: string | null;
      monthlyPriceMinor: number;
      currency: string;
      trialDays: number;
    }[];
    expect(plans.length).toBeGreaterThanOrEqual(1);
    const plan = plans.find((p) => p.slug === 'nearbyorders-business');
    expect(plan).toBeTruthy();
    expect(plan!.name).toBe('Growth');
    expect(plan!.monthlyPriceMinor).toBe(299900);
    expect(plan!.currency).toBe('PKR');
    expect(plan!.trialDays).toBe(30);
  });
});
