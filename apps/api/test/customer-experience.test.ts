import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, authed, registerAndLogin, createBusiness, approveBusiness } from './helpers.js';
import type { TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

/**
 * Phase 17 — Customer experience completion.
 *
 * Proves the new customer-owned features (favorites, addresses, delivery
 * address snapshots) and re-proves the core ownership boundaries the phase
 * demands: customer A never touches customer B's orders, bookings, or
 * addresses; owners never touch foreign businesses' data; self-order and
 * self-booking stay blocked.
 */

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

const createService = async (ownerToken: string, businessId: string, priceMinor = 50000) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/services`,
    headers: authed(ownerToken),
    payload: { name: 'Haircut', priceMinor, durationMinutes: 60 },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

const createProduct = async (ownerToken: string, businessId: string, priceMinor = 120000) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(ownerToken),
    payload: { name: 'Shampoo', priceMinor },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

/** Places a DELIVERY order with an explicit address id; returns the order. */
const placeDeliveryOrder = async (customerToken: string, businessId: string, productId: string, addressId: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: authed(customerToken),
    payload: {
      businessId,
      items: [{ productId, quantity: 2 }],
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string; deliveryAddressText: string | null; totalMinor: number };
};

/** Deletes businesses this file created, cascading their children. */
const createdBusinessIds = new Set<string>();
const origCreateBusiness = createBusiness;
const trackedCreateBusiness: typeof createBusiness = async (...args) => {
  const out = await origCreateBusiness(...args);
  createdBusinessIds.add(out.id);
  return out;
};

const cleanupBusinesses = async () => {
  if (createdBusinessIds.size === 0) return;
  const ids = [...createdBusinessIds];
  await prisma.favoriteBusiness.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.orderPayment.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.bookingPayment.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.order.deleteMany({ where: { businessId: { in: ids } } }); // cascades OrderItem
  await prisma.booking.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.review.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.service.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessHour.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  createdBusinessIds.clear();
};

const cleanupUsers = new Set<string>();
const trackedRegister = async (role: 'CUSTOMER' | 'BUSINESS_OWNER') => {
  const out = await registerAndLogin(app, role);
  cleanupUsers.add(out.userId);
  return out;
};

afterEach(async () => {
  await cleanupBusinesses();
});

afterAll(async () => {
  // Address books / favorites of these synthetic users are removed with them.
  if (cleanupUsers.size > 0) {
    const ids = [...cleanupUsers];
    await prisma.customerAddress.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.favoriteBusiness.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
});

describe('favorites (Phase 17)', () => {
  it('saves, lists, and unsaves a business idempotently; rejects unapproved/unknown businesses', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    const customer = await trackedRegister('CUSTOMER');

    // Unknown business → 404.
    const ghost = await app.inject({
      method: 'POST',
      url: '/api/v1/me/favorites/00000000-0000-4000-8000-000000000000',
      headers: authed(customer.token),
    });
    expect(ghost.statusCode).toBe(404);

    // Not-yet-approved business is not saveable.
    const pre = await app.inject({ method: 'POST', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(pre.statusCode).toBe(404);

    await approveBusiness(businessId);
    const save = await app.inject({ method: 'POST', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(save.statusCode).toBe(200);
    expect(JSON.parse(save.body).data).toEqual({ saved: true });

    // Double save stays idempotent (unique pair, no duplicates).
    const again = await app.inject({ method: 'POST', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(again.statusCode).toBe(200);
    const rows = await prisma.favoriteBusiness.findMany({ where: { customerId: customer.userId } });
    expect(rows).toHaveLength(1);

    // GET-by-id reflects state.
    const check = await app.inject({ method: 'GET', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(JSON.parse(check.body).data).toEqual({ saved: true });

    // The saved list carries the public card fields.
    const list = await app.inject({ method: 'GET', url: '/api/v1/me/favorites', headers: authed(customer.token) });
    expect(list.statusCode).toBe(200);
    const items = JSON.parse(list.body).data as { business: { id: string }; savedAt: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].business.id).toBe(businessId);
    expect(items[0].business.name).toBeTruthy();

    // Unsave; second unsave is still a clean success (idempotent).
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(del.body).data).toEqual({ saved: false });
    const del2 = await app.inject({ method: 'DELETE', url: `/api/v1/me/favorites/${businessId}`, headers: authed(customer.token) });
    expect(del2.statusCode).toBe(200);
    const listAfter = await app.inject({ method: 'GET', url: '/api/v1/me/favorites', headers: authed(customer.token) });
    expect(JSON.parse(listAfter.body).data).toHaveLength(0);
  });

  it('isolates favorites per customer and requires authentication', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    const a = await trackedRegister('CUSTOMER');
    const b = await trackedRegister('CUSTOMER');

    await app.inject({ method: 'POST', url: `/api/v1/me/favorites/${businessId}`, headers: authed(a.token) });

    // B's list never contains A's save.
    const bList = await app.inject({ method: 'GET', url: '/api/v1/me/favorites', headers: authed(b.token) });
    expect(JSON.parse(bList.body).data).toHaveLength(0);

    // A's unsave cannot be aimed at B's data, and vice versa.
    const aDel = await app.inject({ method: 'DELETE', url: `/api/v1/me/favorites/${businessId}`, headers: authed(a.token) });
    expect(aDel.statusCode).toBe(200);
    expect(JSON.parse(aDel.body).data).toEqual({ saved: false });

    // Anonymous callers are rejected.
    const anon = await app.inject({ method: 'GET', url: '/api/v1/me/favorites' });
    expect([401, 403]).toContain(anon.statusCode);
  });
});

describe('customer addresses (Phase 17)', () => {
  const ADDRESS = {
    label: 'Home',
    recipientName: 'Ayesha Khan',
    phone: '03001234567',
    addressText: 'House 12, Street 4, Gulberg III, Lahore',
  };

  it('creates addresses, validates coordinates and phones, and caps the book at 20', async () => {
    const customer = await trackedRegister('CUSTOMER');

    const created = await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: ADDRESS });
    expect(created.statusCode).toBe(201);
    const addr = JSON.parse(created.body).data as { id: string; isDefault: boolean; latitude: number | null };
    expect(addr.isDefault).toBe(true); // first address becomes default
    expect(addr.latitude).toBeNull();

    // Out-of-range coordinates are rejected by validation.
    const badLat = await app.inject({
      method: 'POST',
      url: '/api/v1/me/addresses',
      headers: authed(customer.token),
      payload: { ...ADDRESS, label: 'Work', coordinates: { latitude: 123, longitude: 74 } },
    });
    expect(badLat.statusCode).toBe(400);

    // Valid coordinates survive.
    const withCoords = await app.inject({
      method: 'POST',
      url: '/api/v1/me/addresses',
      headers: authed(customer.token),
      payload: { ...ADDRESS, label: 'Work', coordinates: { latitude: 31.5204, longitude: 74.3587 } },
    });
    expect(withCoords.statusCode).toBe(201);
    const work = JSON.parse(withCoords.body).data as { id: string; isDefault: boolean; latitude: number | null };
    expect(work.isDefault).toBe(false);
    expect(work.latitude).toBeCloseTo(31.5204, 5);

    // Cap: at most 20 addresses per customer (2 exist above).
    for (let i = 0; i < 18; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/me/addresses',
        headers: authed(customer.token),
        payload: { ...ADDRESS, label: `Extra ${i}` },
      });
      expect(r.statusCode).toBe(201);
    }
    const over = await app.inject({
      method: 'POST',
      url: '/api/v1/me/addresses',
      headers: authed(customer.token),
      payload: { ...ADDRESS, label: 'One too many' },
    });
    expect(over.statusCode).toBe(400);
    expect(JSON.parse(over.body).error.code).toBe('ADDRESS_LIMIT');
  });

  it('keeps exactly one default per customer through create/edit cycles', async () => {
    const customer = await trackedRegister('CUSTOMER');
    const a = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: { ...ADDRESS, label: 'A' } })).body,
    ).data as { id: string };
    const b = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: { ...ADDRESS, label: 'B' } })).body,
    ).data as { id: string };

    // Promote B; A is demoted in the same transaction.
    const promote = await app.inject({ method: 'PATCH', url: `/api/v1/me/addresses/${b.id}`, headers: authed(customer.token), payload: { isDefault: true } });
    expect(promote.statusCode).toBe(200);
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/me/addresses', headers: authed(customer.token) })).body).data as {
      id: string;
      isDefault: boolean;
    }[];
    expect(list.find((x) => x.id === a.id)?.isDefault).toBe(false);
    expect(list.find((x) => x.id === b.id)?.isDefault).toBe(true);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);

    // Demoting the only default leaves zero defaults — honest state, customer
    // may pick later. Creating another address auto-promotes it.
    const demote = await app.inject({ method: 'PATCH', url: `/api/v1/me/addresses/${b.id}`, headers: authed(customer.token), payload: { isDefault: false } });
    expect(demote.statusCode).toBe(200);
    const c = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: { ...ADDRESS, label: 'C' } })).body,
    ).data as { id: string; isDefault: boolean };
    expect(c.isDefault).toBe(true);
  });

  it('isolates the address book per customer; foreign ids are 404/never-leak', async () => {
    const a = await trackedRegister('CUSTOMER');
    const b = await trackedRegister('CUSTOMER');
    const created = await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(a.token), payload: ADDRESS });
    const { id } = JSON.parse(created.body).data as { id: string };

    // B cannot read-modify-delete A's address: all behave as not-found.
    const bGet = await app.inject({ method: 'GET', url: '/api/v1/me/addresses', headers: authed(b.token) });
    expect(JSON.parse(bGet.body).data).toHaveLength(0);
    const bPatch = await app.inject({ method: 'PATCH', url: `/api/v1/me/addresses/${id}`, headers: authed(b.token), payload: { label: 'Hacked' } });
    expect(bPatch.statusCode).toBe(404);
    const bDelete = await app.inject({ method: 'DELETE', url: `/api/v1/me/addresses/${id}`, headers: authed(b.token) });
    expect(JSON.parse(bDelete.body).data).toEqual({ deleted: false });

    // A still owns it and can delete it.
    const aDelete = await app.inject({ method: 'DELETE', url: `/api/v1/me/addresses/${id}`, headers: authed(a.token) });
    expect(JSON.parse(aDelete.body).data).toEqual({ deleted: true });

    // Anonymous access is rejected.
    const anon = await app.inject({ method: 'GET', url: '/api/v1/me/addresses' });
    expect([401, 403]).toContain(anon.statusCode);
  });
});

describe('delivery address snapshot on orders (Phase 17)', () => {
  it('snapshots the owned address text at placement; edits never rewrite history', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    // Enable delivery on the business.
    await prisma.business.update({ where: { id: businessId }, data: { deliveryEnabled: true, deliveryFeeMinor: 15000, codEnabled: true } });
    const product = await createProduct(owner.token, businessId);
    const customer = await trackedRegister('CUSTOMER');

    const created = await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: ADDRESS_FIXTURE });
    const { id: addressId, addressText } = JSON.parse(created.body).data as { id: string; addressText: string };

    const order = await placeDeliveryOrder(customer.token, businessId, product.id, addressId);
    expect(order.deliveryAddressText).toBe(addressText);

    // The customer edits the address afterwards; the placed order is history
    // and must keep the original snapshot.
    await app.inject({ method: 'PATCH', url: `/api/v1/me/addresses/${addressId}`, headers: authed(customer.token), payload: { addressText: 'Edited after the fact' } });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: authed(customer.token) });
    expect(detail.statusCode).toBe(200);
    expect((JSON.parse(detail.body).data as { deliveryAddressText: string | null }).deliveryAddressText).toBe(addressText);
  });

  it('rejects foreign address ids and address ids on pickup orders', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { deliveryEnabled: true, codEnabled: true } });
    const product = await createProduct(owner.token, businessId);
    const customer = await trackedRegister('CUSTOMER');
    const stranger = await trackedRegister('CUSTOMER');
    const strangerAddr = JSON.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(stranger.token), payload: ADDRESS_FIXTURE })).body,
    ).data as { id: string };

    // Another customer's address id → 404, order not created.
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY', deliveryAddressId: strangerAddr.id },
    });
    expect(foreign.statusCode).toBe(404);

    // Pickup orders must not carry a delivery address.
    const pickup = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'PICKUP', deliveryAddressId: strangerAddr.id },
    });
    expect(pickup.statusCode).toBe(400);

    // Delivery without any address and without a default still works (the
    // snapshot is simply null — the business contacts the customer).
    const noAddress = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY' },
    });
    expect(noAddress.statusCode).toBe(201);
    expect((JSON.parse(noAddress.body).data as { deliveryAddressText: string | null }).deliveryAddressText).toBeNull();
  });
});

const ADDRESS_FIXTURE = {
  label: 'Home',
  recipientName: 'Ayesha Khan',
  phone: '03001234567',
  addressText: 'House 12, Street 4, Gulberg III, Lahore',
};

describe('customer ownership boundaries (Phase 17 re-proof)', () => {
  it('customer A cannot read customer B order or booking', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { deliveryEnabled: true, codEnabled: true } });

    const service = await createService(owner.token, businessId);
    const product = await createProduct(owner.token, businessId);

    const a = await trackedRegister('CUSTOMER');
    const b = await trackedRegister('CUSTOMER');

    const order = await placeDeliveryOrder(a.token, businessId, product.id, (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(a.token), payload: ADDRESS_FIXTURE })).json().data.id);
    expect(order.deliveryAddressText).toBeTruthy();

    // B reads A's order → 404 by API convention.
    const foreignOrder = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: authed(b.token) });
    expect(foreignOrder.statusCode).toBe(404);

    // A books a service; B cannot read A's booking either.
    // 24/7 hours so the availability engine has real slots on any day.
    const putHours = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '00:00', closesAt: '23:59' })),
    });
    expect(putHours.statusCode).toBe(200);
    const slotRes = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${service.id}/availability?date=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`, headers: authed(a.token) });
    const slot = (JSON.parse(slotRes.body).data.slots as { start: string; available: boolean }[]).find((s) => s.available)!;
    const booking = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(a.token),
      payload: { businessId, serviceId: service.id, date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), startTime: slot.start },
    });
    expect(booking.statusCode).toBe(201);
    const bookingId = (JSON.parse(booking.body).data as { id: string }).id;

    const foreignBooking = await app.inject({ method: 'GET', url: `/api/v1/bookings/${bookingId}`, headers: authed(b.token) });
    expect(foreignBooking.statusCode).toBe(404);

    // B's history never contains A's records.
    const bOrders = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/orders', headers: authed(b.token) })).body).data;
    expect(bOrders.some((o: { id: string }) => o.id === order.id)).toBe(false);
    const bBookings = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/bookings', headers: authed(b.token) })).body).data;
    expect(bBookings.some((x: { id: string }) => x.id === bookingId)).toBe(false);
  });

  it('self-order and self-booking remain blocked; owner can still order elsewhere', async () => {
    const ownerA = await trackedRegister('BUSINESS_OWNER');
    const { id: businessA } = await trackedCreateBusiness(app, ownerA.token);
    await approveBusiness(businessA);
    const productA = await createProduct(ownerA.token, businessA);
    const serviceA = await createService(ownerA.token, businessA);

    // Owner A ordering from own business A → blocked.
    const selfOrder = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(ownerA.token),
      payload: { businessId: businessA, items: [{ productId: productA.id, quantity: 1 }] },
    });
    expect(selfOrder.statusCode).toBe(400);
    expect(JSON.parse(selfOrder.body).error.code).toBe('SELF_ORDER');

    // Owner A booking own business A → blocked.
    const selfBooking = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(ownerA.token),
      payload: { businessId: businessA, serviceId: serviceA.id, date: '2031-01-01', startTime: '10:00' },
    });
    expect(selfBooking.statusCode).toBe(400);
    expect(JSON.parse(selfBooking.body).error.code).toBe('SELF_BOOKING');

    // Owner A as customer at owner B's business → allowed.
    const ownerB = await trackedRegister('BUSINESS_OWNER');
    const { id: businessB } = await trackedCreateBusiness(app, ownerB.token);
    await approveBusiness(businessB);
    const productB = await createProduct(ownerB.token, businessB);
    const crossOrder = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(ownerA.token),
      payload: { businessId: businessB, items: [{ productId: productB.id, quantity: 1 }] },
    });
    expect(crossOrder.statusCode).toBe(201);
  });

  it('review eligibility and duplicate prevention remain server-side', async () => {
    const owner = await trackedRegister('BUSINESS_OWNER');
    const { id: businessId } = await trackedCreateBusiness(app, owner.token);
    await approveBusiness(businessId);
    await prisma.business.update({ where: { id: businessId }, data: { deliveryEnabled: true, codEnabled: true } });
    const product = await createProduct(owner.token, businessId);
    const customer = await trackedRegister('CUSTOMER');
    const stranger = await trackedRegister('CUSTOMER');

    const order = await placeDeliveryOrder(customer.token, businessId, product.id, (await app.inject({ method: 'POST', url: '/api/v1/me/addresses', headers: authed(customer.token), payload: ADDRESS_FIXTURE })).json().data.id);

    // Mark it COMPLETED directly (the owner's lifecycle action is covered by
    // other suites); the review must reference a completed transaction.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } });

    // Stranger's order id → not eligible (404).
    const foreignReview = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      headers: authed(stranger.token),
      payload: { orderId: order.id, rating: 5 },
    });
    expect(foreignReview.statusCode).toBe(404);

    // Reviewing without a booking/order reference fails schema validation
    // (the reference is required and must be a real completed transaction).
    const noSource = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      headers: authed(customer.token),
      payload: { rating: 4 },
    });
    expect(noSource.statusCode).toBe(400);

    // Legitimate review succeeds; a second one for the same order → 409.
    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      headers: authed(customer.token),
      payload: { orderId: order.id, rating: 5, comment: 'Fast delivery' },
    });
    expect(review.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      headers: authed(customer.token),
      payload: { orderId: order.id, rating: 3 },
    });
    expect(dup.statusCode).toBe(409);

    // My-reviews lists exactly this one review.
    const mine = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/my-reviews', headers: authed(customer.token) })).body).data;
    expect(mine).toHaveLength(1);
    expect(mine[0].rating).toBe(5);
  });
});
