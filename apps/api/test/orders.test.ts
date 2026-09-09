import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const app = await makeApp();

const PASSWORD = 'Str0ngPassphrase!42';

/** Registers a fresh customer, returning token + id. */
const customer = async (a: FastifyInstance) => registerAndLogin(a, 'CUSTOMER');

/** Owner with an approved business, ready to receive products/orders. */
const shopFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await approveBusiness(businessId);
  return { owner, businessId };
};

const createProduct = async (token: string, businessId: string, name: string, priceMinor: number) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(token),
    payload: { name, priceMinor },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string; priceMinor: number; name: string };
};

/** Places an order as a customer; returns the response. */
const placeOrder = (
  token: string,
  businessId: string,
  items: { productId: string; quantity: number }[],
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: authed(token),
    payload: { businessId, items, fulfillmentType: 'PICKUP' },
  });

const ORDER_REGEX = /PENDING|ACCEPTED|REJECTED|PREPARING|READY|COMPLETED|CANCELLED/;

describe('order creation (customer)', () => {
  it('rejects unauthenticated creation', async () => {
    const { owner, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'X Item', 100);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }] },
      skipAuthorization: true,
    } as never);
    expect([401, 403]).toContain(res.statusCode);
  });

  it('creates an order: server re-reads prices, computes total, stores purchase-time data', async () => {
    const { owner, businessId } = await shopFixture();
    const biryani = await createProduct(owner.token, businessId, 'Chicken Biryani', 45000);
    const karahi = await createProduct(owner.token, businessId, 'Chicken Karahi', 125000);
    const c = await customer(app);

    const res = await placeOrder(c.token, businessId, [
      { productId: biryani.id, quantity: 2 },
      { productId: karahi.id, quantity: 1 },
    ]);
    expect(res.statusCode).toBe(201);
    const order = JSON.parse(res.body).data;

    // Server-side total from DB prices: 2×450 + 1×1250 = 2150 rupees.
    expect(order.subtotalMinor).toBe(2 * 45000 + 125000);
    expect(order.status).toBe('PENDING');
    expect(order.items).toHaveLength(2);
    for (const item of order.items) {
      expect(item.lineTotalMinor).toBe(item.unitPriceMinor * item.quantity);
    }
    expect(order.business.id).toBe(businessId);
    // No customer email / passwordHash leakage.
    expect(JSON.stringify(order)).not.toContain(c.token);
    expect(JSON.stringify(order)).not.toContain('@test.local');
    expect(JSON.stringify(order).toLowerCase()).not.toContain('passwordhash');
  });

  it('ignores client-supplied prices entirely', async () => {
    const { owner, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Burger', 65000);
    const c = await customer(app);

    // Client tries to pay 1 paisa per unit — the schema strips unknown fields
    // and the server prices from the DB regardless.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(c.token),
      payload: {
        businessId,
        items: [{ productId: product.id, quantity: 2, unitPriceMinor: 1, priceMinor: 1, lineTotalMinor: 2 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.subtotalMinor).toBe(130000);
  });

  it('rejects invalid quantity, nonexistent product, inactive product, and foreign-business product', async () => {
    const a = await shopFixture();
    const b = await shopFixture();
    const own = await createProduct(a.owner.token, a.businessId, 'Own Item', 50000);
    const foreign = await createProduct(b.owner.token, b.businessId, 'Foreign Item', 50000);
    const c = await customer(app);

    const zeroQty = await placeOrder(c.token, a.businessId, [{ productId: own.id, quantity: 0 }]);
    expect(zeroQty.statusCode).toBe(400);

    const missing = await placeOrder(c.token, a.businessId, [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }]);
    expect(missing.statusCode).toBe(400);

    // Disable the product, then try to order it.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${own.id}`,
      headers: authed(a.owner.token),
      payload: { isActive: false },
    });
    const inactive = await placeOrder(c.token, a.businessId, [{ productId: own.id, quantity: 1 }]);
    expect(inactive.statusCode).toBe(400);
    expect(JSON.parse(inactive.body).error.code).toBe('INVALID_PRODUCTS');

    const crossBusiness = await placeOrder(c.token, a.businessId, [{ productId: foreign.id, quantity: 1 }]);
    expect(crossBusiness.statusCode).toBe(400);
  });

  it('rejects orders for unapproved businesses', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await createBusiness(app, owner.token); // stays PENDING
    const product = await createProduct(owner.token, businessId, 'Hidden Item', 10000);
    const c = await customer(app);

    const res = await placeOrder(c.token, businessId, [{ productId: product.id, quantity: 1 }]);
    expect(res.statusCode).toBe(404);
  });

  it('rejects duplicate product lines', async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'Duplicate Me', 10000);
    const c = await customer(app);
    const res = await placeOrder(c.token, businessId, [
      { productId: p.id, quantity: 1 },
      { productId: p.id, quantity: 2 },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('orders via a BUSINESS_OWNER account are rejected (role enforcement)', async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'Owner Food', 10000);
    const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await placeOrder(otherOwner.token, businessId, [{ productId: p.id, quantity: 1 }]);
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('historical integrity', () => {
  it('order keeps purchase-time name and price after product edits and deletion', async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'Seasonal Special', 65000);
    const c = await customer(app);
    const placed = await placeOrder(c.token, businessId, [{ productId: p.id, quantity: 2 }]);
    const orderId = JSON.parse(placed.body).data.id as string;

    // Owner changes the product price and name afterwards.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${p.id}`,
      headers: authed(owner.token),
      payload: { priceMinor: 75000, name: 'Renamed Special' },
    });

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(c.token) });
    const order = JSON.parse(fetched.body).data;
    expect(order.items[0].name).toBe('Seasonal Special');
    expect(order.items[0].unitPriceMinor).toBe(65000);
    expect(order.items[0].lineTotalMinor).toBe(130000);
    expect(order.subtotalMinor).toBe(130000);

    // Ordered products can never be hard-deleted (Phase 4A PRODUCT_IN_USE).
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/products/${p.id}`, headers: authed(owner.token) });
    expect(del.statusCode).toBe(409);
    expect(JSON.parse(del.body).error.code).toBe('PRODUCT_IN_USE');

    // …and the historical order still renders after the product is disabled.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${p.id}`,
      headers: authed(owner.token),
      payload: { isActive: false },
    });
    const still = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(c.token) });
    expect(still.statusCode).toBe(200);
    expect(JSON.parse(still.body).data.items[0].unitPriceMinor).toBe(65000);
  });
});

describe('order visibility & security', () => {
  it('customer lists only their own orders; other customers cannot see them', async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'List Item', 20000);
    const c1 = await customer(app);
    const c2 = await customer(app);
    const placed = await placeOrder(c1.token, businessId, [{ productId: p.id, quantity: 1 }]);
    const orderId = JSON.parse(placed.body).data.id as string;

    const mine = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(c1.token) });
    const mineData = JSON.parse(mine.body).data as { id: string; customer: unknown }[];
    expect(mineData.some((o) => o.id === orderId)).toBe(true);
    // Customer list must not include email/passwordHash of anyone.
    expect(JSON.stringify(mineData).toLowerCase()).not.toContain('passwordhash');
    expect(JSON.stringify(mineData)).not.toContain('@test.local');

    const theirs = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(c2.token) });
    expect(JSON.parse(theirs.body).data.some((o: { id: string }) => o.id === orderId)).toBe(false);

    const direct = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(c2.token) });
    expect(direct.statusCode).toBe(404);
  });

  it('owner sees own-business orders and order detail; another owner gets 404', async () => {
    const a = await shopFixture();
    const b = await shopFixture();
    const pa = await createProduct(a.owner.token, a.businessId, 'A Item', 30000);
    const c = await customer(app);
    const placed = await placeOrder(c.token, a.businessId, [{ productId: pa.id, quantity: 3 }]);
    const orderId = JSON.parse(placed.body).data.id as string;

    const ownerList = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(a.owner.token) });
    const ownerData = JSON.parse(ownerList.body).data as { id: string }[];
    expect(ownerData.some((o) => o.id === orderId)).toBe(true);
    // Owner view carries safe customer fields for fulfillment, never credentials.
    expect(JSON.stringify(ownerData).toLowerCase()).not.toContain('passwordhash');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(a.owner.token) });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).data.items[0].quantity).toBe(3);

    const foreign = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(b.owner.token) });
    expect(foreign.statusCode).toBe(404);

    const foreignList = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(b.owner.token) });
    expect(JSON.parse(foreignList.body).data.some((o: { id: string }) => o.id === orderId)).toBe(false);
  });

  it('unauthenticated listing/detail is rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders', skipAuthorization: true } as never);
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('order lifecycle', () => {
  const fullJourney = async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'Journey Item', 15000);
    const c = await customer(app);
    const placed = await placeOrder(c.token, businessId, [{ productId: p.id, quantity: 1 }]);
    return { owner, businessId, c, orderId: JSON.parse(placed.body).data.id as string };
  };

  const setStatus = (token: string, orderId: string, status: string) =>
    app.inject({ method: 'PATCH', url: `/api/v1/orders/${orderId}/status`, headers: authed(token), payload: { status } });

  it('owner drives PENDING → ACCEPTED → PREPARING → READY → COMPLETED', async () => {
    const { owner, c, orderId } = await fullJourney();

    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']) {
      const res = await setStatus(owner.token, orderId, status);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.status).toMatch(ORDER_REGEX);
    }
    const final = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: authed(c.token) });
    expect(JSON.parse(final.body).data.status).toBe('COMPLETED');
  });

  it('invalid owner transitions are rejected', async () => {
    const { owner, orderId } = await fullJourney();
    // PENDING → COMPLETED is not allowed (owner must accept first).
    const res = await setStatus(owner.token, orderId, 'COMPLETED');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_TRANSITION');
  });

  it('terminal states accept no further transitions', async () => {
    const { owner, orderId } = await fullJourney();
    await setStatus(owner.token, orderId, 'REJECTED');
    const res = await setStatus(owner.token, orderId, 'ACCEPTED');
    expect(res.statusCode).toBe(409);
  });

  it('customer may cancel own PENDING order but never set owner statuses', async () => {
    const { owner, c, orderId } = await fullJourney();

    const complete = await setStatus(c.token, orderId, 'COMPLETED');
    expect(complete.statusCode).toBe(404); // hidden action → not found

    const accept = await setStatus(c.token, orderId, 'ACCEPTED');
    expect(accept.statusCode).toBe(404);

    const cancel = await setStatus(c.token, orderId, 'CANCELLED');
    expect(cancel.statusCode).toBe(200);
    expect(JSON.parse(cancel.body).data.status).toBe('CANCELLED');
  });

  it('customer cannot modify another customer order at all', async () => {
    const { owner, businessId } = await shopFixture();
    const p = await createProduct(owner.token, businessId, 'X Item', 10000);
    const c1 = await customer(app);
    const c2 = await customer(app);
    const placed = await placeOrder(c1.token, businessId, [{ productId: p.id, quantity: 1 }]);
    const orderId = JSON.parse(placed.body).data.id as string;

    const res = await setStatus(c2.token, orderId, 'CANCELLED');
    expect(res.statusCode).toBe(404);
  });

  it('another owner cannot transition someone else’s order', async () => {
    const a = await shopFixture();
    const b = await shopFixture();
    const pa = await createProduct(a.owner.token, a.businessId, 'A Only', 10000);
    const c = await customer(app);
    const placed = await placeOrder(c.token, a.businessId, [{ productId: pa.id, quantity: 1 }]);
    const orderId = JSON.parse(placed.body).data.id as string;

    const res = await setStatus(b.owner.token, orderId, 'ACCEPTED');
    expect(res.statusCode).toBe(404);
  });

  it('customer cannot see orders whose business they do not own (owner route scoping)', async () => {
    // Owners are also users; their own customer orders (none here) must never
    // leak into another owner's list. Sanity: owner list only has own biz.
    const a = await shopFixture();
    const b = await shopFixture();
    const pb = await createProduct(b.owner.token, b.businessId, 'B Item', 10000);
    const ownerCustomer = await registerAndLogin(app, 'CUSTOMER');
    await placeOrder(ownerCustomer.token, b.businessId, [{ productId: pb.id, quantity: 1 }]);

    const listA = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(a.owner.token) });
    expect(JSON.parse(listA.body).data.every((o: { business: { id: string } }) => o.business.id === a.businessId)).toBe(true);
  });

  it('unauthenticated status change is rejected', async () => {
    const { orderId } = await fullJourney();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderId}/status`,
      payload: { status: 'COMPLETED' },
      skipAuthorization: true,
    } as never);
    expect([401, 403]).toContain(res.statusCode);
  });
});
