import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const ownerFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id } = await createBusiness(app, owner.token);
  return { owner, businessId: id };
};

describe('services', () => {
  it('owner creates and updates a service', async () => {
    const { owner, businessId } = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name: 'Deep Cleaning', priceMinor: 150000, durationMinutes: 60 },
    });
    expect(created.statusCode).toBe(201);
    const serviceId = JSON.parse(created.body).data.id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/services/${serviceId}`,
      headers: authed(owner.token),
      payload: { priceMinor: 175000, isActive: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).data.priceMinor).toBe(175000);
    expect(JSON.parse(updated.body).data.isActive).toBe(false);
  });

  it("owner cannot modify another business's service", async () => {
    const a = await ownerFixture();
    const b = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${a.businessId}/services`,
      headers: authed(a.owner.token),
      payload: { name: 'Service A', priceMinor: 100000 },
    });
    const serviceId = JSON.parse(created.body).data.id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/services/${serviceId}`,
      headers: authed(b.owner.token),
      payload: { priceMinor: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('invalid price is rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name: 'Bad Price', priceMinor: 12.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('customer can view active services of an approved business', async () => {
    const { businessId } = await ownerFixture();
    await approveBusiness(businessId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services` });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body).data)).toBe(true);
  });
});

describe('products', () => {
  it('owner creates and updates a product with image url', async () => {
    const { owner, businessId } = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Burger', priceMinor: 65000, imageUrl: 'https://cdn.test/burger.png' },
    });
    expect(created.statusCode).toBe(201);
    const productId = JSON.parse(created.body).data.id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: authed(owner.token),
      payload: { priceMinor: 70000 },
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).data.priceMinor).toBe(70000);
  });

  it("owner cannot modify another business's product", async () => {
    const a = await ownerFixture();
    const b = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${a.businessId}/products`,
      headers: authed(a.owner.token),
      payload: { name: 'Product A', priceMinor: 50000 },
    });
    const productId = JSON.parse(created.body).data.id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: authed(b.owner.token),
      payload: { priceMinor: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('invalid price is rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Bad Product', priceMinor: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('owner deletes a product', async () => {
    const { owner, businessId } = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Doomed Product', priceMinor: 100 },
    });
    const productId = JSON.parse(created.body).data.id as string;

    const res = await app.inject({ method: 'DELETE', url: `/api/v1/products/${productId}`, headers: authed(owner.token) });
    expect(res.statusCode).toBe(204);
    expect(await prisma.product.findUnique({ where: { id: productId } })).toBeNull();
  });

  it('delete is refused with 409 PRODUCT_IN_USE when an order references the product', async () => {
    const { owner, businessId } = await ownerFixture();
    await approveBusiness(businessId);
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Ordered Product', priceMinor: 50000 },
    });
    const productId = JSON.parse(created.body).data.id as string;

    // A customer order references the product (historical integrity fixture).
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId, quantity: 2 }], fulfillmentType: 'PICKUP' },
    });
    expect(order.statusCode).toBe(201);

    const res = await app.inject({ method: 'DELETE', url: `/api/v1/products/${productId}`, headers: authed(owner.token) });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PRODUCT_IN_USE');
    // The product must still exist — disabling is the non-destructive path.
    expect(await prisma.product.findUnique({ where: { id: productId } })).not.toBeNull();

    // Disable instead: allowed, and the product leaves the customer listing.
    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: authed(owner.token),
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(200);
    const customerView = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/products` });
    expect(JSON.parse(customerView.body).data.some((p: { id: string }) => p.id === productId)).toBe(false);
  });

  it('unauthenticated requests cannot manage products', async () => {
    const { owner, businessId } = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Authless Target', priceMinor: 500 },
    });
    const productId = JSON.parse(created.body).data.id as string;

    const noAuth = { skipAuthorization: true } as const;
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      payload: { name: 'Anon Product', priceMinor: 500 },
      ...noAuth,
    });
    expect([401, 403]).toContain(createRes.statusCode);

    const patchRes = await app.inject({ method: 'PATCH', url: `/api/v1/products/${productId}`, payload: { priceMinor: 1 }, ...noAuth });
    expect([401, 403]).toContain(patchRes.statusCode);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/v1/products/${productId}`, ...noAuth });
    expect([401, 403]).toContain(deleteRes.statusCode);
  });

  it('customer role cannot create or modify products', async () => {
    const { owner, businessId } = await ownerFixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'Customer Target', priceMinor: 500 },
    });
    const productId = JSON.parse(created.body).data.id as string;
    const customer = await registerAndLogin(app, 'CUSTOMER');

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(customer.token),
      payload: { name: 'Sneaky Product', priceMinor: 500 },
    });
    expect([401, 403]).toContain(createRes.statusCode);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productId}`,
      headers: authed(customer.token),
      payload: { priceMinor: 1 },
    });
    expect([401, 403]).toContain(patchRes.statusCode);
  });

  it('create works without imageUrl and the saved product has none (image is optional, never a URL field contract)', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/products`,
      headers: authed(owner.token),
      payload: { name: 'No Image Product', priceMinor: 25000, description: 'Created without any image' },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data as { imageUrl: string | null };
    expect(data.imageUrl).toBeNull();
  });

  it('invalid priceMinor values (fractional, non-integer) are rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    for (const priceMinor of [12.5, '450', Number.NaN]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${businessId}/products`,
        headers: authed(owner.token),
        payload: { name: 'Bad Money', priceMinor },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('business hours', () => {
  const validWeek = (opensAt = '09:00', closesAt = '18:00') =>
    Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt, closesAt }));

  it('owner creates and replaces hours', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: validWeek(),
    });
    expect(res.statusCode).toBe(200);
    const hours = JSON.parse(res.body).data as unknown[];
    expect(hours).toHaveLength(7);

    const replaced = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: validWeek('10:00', '20:00'),
    });
    expect(replaced.statusCode).toBe(200);
  });

  it('invalid time format is rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: validWeek('25:99', '18:00'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('closing before opening is rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: validWeek('18:00', '09:00'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('duplicate or missing days are rejected', async () => {
    const { owner, businessId } = await ownerFixture();
    const days = validWeek();
    days.pop();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: days,
    });
    expect(res.statusCode).toBe(400);
  });

  it('customer can view hours of an approved business', async () => {
    const { owner, businessId } = await ownerFixture();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: validWeek(),
    });
    await approveBusiness(businessId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/hours` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toHaveLength(7);
  });
});
