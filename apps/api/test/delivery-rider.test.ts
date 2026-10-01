import { describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const ADDRESS = {
  label: 'Home',
  phone: '03001234567',
  recipientName: 'Test Customer',
  addressText: 'House 12, Street 4, Gulberg III, Lahore',
};

/** Owner + approved business with a product, delivery enabled; customer with an address. */
const deliveryFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const customer = await registerAndLogin(app, 'CUSTOMER');
  const stranger = await registerAndLogin(app, 'CUSTOMER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await approveBusiness(businessId);
  // Enable delivery on the business.
  const deliverySettings = await app.inject({
    method: 'PUT',
    url: `/api/v1/owner/businesses/${businessId}/delivery-settings`,
    headers: authed(owner.token),
    payload: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 20000 },
  });
  expect(deliverySettings.statusCode).toBe(200);
  const prod = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(owner.token),
    payload: { name: 'Biryani', priceMinor: 50000 },
  });
  const productId = (JSON.parse(prod.body).data as { id: string }).id;
  const addr = await app.inject({
    method: 'POST',
    url: '/api/v1/me/addresses',
    headers: authed(customer.token),
    payload: ADDRESS,
  });
  const addressId = (JSON.parse(addr.body).data as { id: string }).id;
  return { owner, customer, stranger, businessId, productId, addressId };
};

const placeOrder = async (token: string, businessId: string, productId: string, extra: Record<string, unknown> = {}) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: authed(token),
    payload: { businessId, items: [{ productId, quantity: 1 }], fulfillmentType: 'PICKUP', ...extra },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string; status: string };
};

const setStatus = (token: string, orderId: string, status: string) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/orders/${orderId}/status`,
    headers: authed(token),
    payload: { status },
  });

const createRider = async (token: string, businessId: string, isActive = true) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/owner/businesses/${businessId}/riders`,
    headers: authed(token),
    payload: { name: 'Test Rider', phone: '+92 300 1112223', isActive },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

const assignRider = (token: string, orderId: string, riderId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/orders/${orderId}/assign-rider`,
    headers: authed(token),
    payload: { riderId },
  });

const advanceToReady = async (ownerToken: string, orderId: string) => {
  for (const s of ['ACCEPTED', 'PREPARING', 'READY']) {
    const res = await setStatus(ownerToken, orderId, s);
    expect(res.statusCode).toBe(200);
  }
};

describe('delivery lifecycle', () => {
  it('pickup order keeps READY -> COMPLETED', async () => {
    const { owner, customer, businessId, productId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId);
    await advanceToReady(owner.token, order.id);
    const res = await setStatus(owner.token, order.id, 'COMPLETED');
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body).data as { status: string }).status).toBe('COMPLETED');
  });

  it('delivery order rejects READY -> COMPLETED (must go through out-for-delivery)', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const res = await setStatus(owner.token, order.id, 'COMPLETED');
    expect(res.statusCode).toBe(409);
  });

  it('delivery READY -> OUT_FOR_DELIVERY requires an assigned active rider', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    // No rider assigned → 409
    const noRider = await setStatus(owner.token, order.id, 'OUT_FOR_DELIVERY');
    expect(noRider.statusCode).toBe(409);
    expect(JSON.parse(noRider.body).error.code).toBe('RIDER_REQUIRED');

    // Assign an active rider → transition works
    const rider = await createRider(owner.token, businessId, true);
    const assigned = await assignRider(owner.token, order.id, rider.id);
    expect(assigned.statusCode).toBe(200);
    const ofd = await setStatus(owner.token, order.id, 'OUT_FOR_DELIVERY');
    expect(ofd.statusCode).toBe(200);
    expect((JSON.parse(ofd.body).data as { status: string }).status).toBe('OUT_FOR_DELIVERY');

    // OUT_FOR_DELIVERY -> DELIVERED works
    const delivered = await setStatus(owner.token, order.id, 'DELIVERED');
    expect(delivered.statusCode).toBe(200);
    expect((JSON.parse(delivered.body).data as { status: string }).status).toBe('DELIVERED');
  });

  it('pickup order cannot use delivery states', async () => {
    const { owner, customer, businessId, productId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId);
    await advanceToReady(owner.token, order.id);
    const res = await setStatus(owner.token, order.id, 'OUT_FOR_DELIVERY');
    expect(res.statusCode).toBe(409);
  });
});

describe('rider assignment', () => {
  it('rejects assignment for pickup orders', async () => {
    const { owner, customer, businessId, productId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId);
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId);
    const res = await assignRider(owner.token, order.id, rider.id);
    expect(res.statusCode).toBe(409);
  });

  it('rejects assignment when order is not READY', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    const rider = await createRider(owner.token, businessId);
    const res = await assignRider(owner.token, order.id, rider.id);
    expect(res.statusCode).toBe(409);
  });

  it('rejects inactive rider assignment', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId, false);
    const res = await assignRider(owner.token, order.id, rider.id);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('RIDER_INACTIVE');
  });

  it('rejects cross-business rider assignment', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: otherBusinessId } = await createBusiness(app, otherOwner.token);
    await approveBusiness(otherBusinessId);
    const otherRider = await createRider(otherOwner.token, otherBusinessId);

    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const res = await assignRider(owner.token, order.id, otherRider.id);
    expect(res.statusCode).toBe(404);
  });

  it('assignment is idempotent and supports reassignment', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const riderA = await createRider(owner.token, businessId);
    const riderBRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/businesses/${businessId}/riders`,
      headers: authed(owner.token),
      payload: { name: 'Second Rider', phone: '+92 300 9998888' },
    });
    const riderB = JSON.parse(riderBRes.body).data as { id: string };

    const first = await assignRider(owner.token, order.id, riderA.id);
    expect(first.statusCode).toBe(200);
    const firstAt = (JSON.parse(first.body).data as { riderAssignedAt: string }).riderAssignedAt;

    // Same rider again → idempotent success
    const repeat = await assignRider(owner.token, order.id, riderA.id);
    expect(repeat.statusCode).toBe(200);
    expect((JSON.parse(repeat.body).data as { assignedRider: { id: string } }).assignedRider.id).toBe(riderA.id);

    // Different rider → reassignment
    const reassign = await assignRider(owner.token, order.id, riderB.id);
    expect(reassign.statusCode).toBe(200);
    expect((JSON.parse(reassign.body).data as { assignedRider: { id: string } }).assignedRider.id).toBe(riderB.id);
    expect((JSON.parse(reassign.body).data as { riderAssignedAt: string }).riderAssignedAt).not.toBe(firstAt);
  });

  it('customer cannot assign a rider', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId);
    const res = await assignRider(customer.token, order.id, rider.id);
    expect([401, 403]).toContain(res.statusCode);
  });

  it('sends RIDER_ASSIGNED notification without phone number', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId);
    await assignRider(owner.token, order.id, rider.id);

    const notes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: authed(customer.token),
    });
    const items = JSON.parse(notes.body).data as { type: string; message: string }[];
    const assigned = items.find((n) => n.type === 'RIDER_ASSIGNED');
    expect(assigned).toBeDefined();
    expect(assigned!.message).toContain('Test Rider');
    expect(assigned!.message).not.toContain('+92 300 1112223');
  });
});

describe('rider privacy', () => {
  it('customer sees rider name+phone only for their own delivery order', async () => {
    const { owner, customer, stranger, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId);
    await assignRider(owner.token, order.id, rider.id);

    // Own order → phone visible
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: authed(customer.token),
    });
    expect(own.statusCode).toBe(200);
    const ownRider = (JSON.parse(own.body).data as { assignedRider: { name: string; phone?: string } | null }).assignedRider;
    expect(ownRider?.name).toBe('Test Rider');
    expect(ownRider?.phone).toBe('+92 300 1112223');

    // Stranger → 404 (not enumerable)
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: authed(stranger.token),
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('owner sees rider phone for their business orders', async () => {
    const { owner, customer, businessId, productId, addressId } = await deliveryFixture();
    const order = await placeOrder(customer.token, businessId, productId, {
      fulfillmentType: 'DELIVERY',
      deliveryAddressId: addressId,
    });
    await advanceToReady(owner.token, order.id);
    const rider = await createRider(owner.token, businessId);
    await assignRider(owner.token, order.id, rider.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: authed(owner.token),
    });
    const riderOut = (JSON.parse(res.body).data as { assignedRider: { phone?: string } | null }).assignedRider;
    expect(riderOut?.phone).toBe('+92 300 1112223');
  });
});
