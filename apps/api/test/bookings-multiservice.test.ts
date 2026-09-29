import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const tomorrowPkt = (): string => {
  const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

/** Approved business with 09:00–21:00 hours and three services. */
const multiFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const customer = await registerAndLogin(app, 'CUSTOMER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await app.inject({
    method: 'PUT',
    url: `/api/v1/businesses/${businessId}/hours`,
    headers: authed(owner.token),
    payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '21:00' })),
  });
  const mkService = async (name: string, priceMinor: number, durationMinutes: number, extra: Record<string, unknown> = {}) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name, priceMinor, durationMinutes, ...extra },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data as { id: string };
  };
  const svcA = await mkService('Haircut', 100000, 30);
  const svcB = await mkService('Shave', 50000, 20);
  const svcC = await mkService('Facial', 200000, 45, { advanceType: 'FIXED', advanceAmountMinor: 50000 });
  await approveBusiness(businessId);
  return { owner, customer, businessId, svcA, svcB, svcC };
};

const createBooking = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/bookings', headers: authed(token), payload });

describe('multi-service bookings', () => {
  it('creates a booking with combined duration, price, and advance', async () => {
    const { customer, businessId, svcA, svcB, svcC } = await multiFixture();
    const res = await createBooking(customer.token, {
      businessId,
      serviceIds: [svcA.id, svcB.id, svcC.id],
      date: tomorrowPkt(),
      startTime: '10:00',
    });
    expect(res.statusCode).toBe(201);
    const b = JSON.parse(res.body).data as {
      serviceItems: { name: string; priceMinor: number; durationMinutes: number }[];
      totalDurationMinutes: number;
      servicePriceMinor: number;
      advanceRequiredMinor: number;
      serviceId: string;
    };
    expect(b.serviceItems).toHaveLength(3);
    expect(b.serviceItems.map((i) => i.name)).toEqual(['Haircut', 'Shave', 'Facial']);
    expect(b.totalDurationMinutes).toBe(95); // 30+20+45
    expect(b.servicePriceMinor).toBe(350000); // 100k+50k+200k
    expect(b.advanceRequiredMinor).toBe(50000); // only Facial has advance
    expect(b.serviceId).toBe(svcA.id); // legacy compat: first service
  });

  it('legacy single serviceId still works and creates one item', async () => {
    const { customer, businessId, svcA } = await multiFixture();
    const res = await createBooking(customer.token, {
      businessId,
      serviceId: svcA.id,
      date: tomorrowPkt(),
      startTime: '10:00',
    });
    expect(res.statusCode).toBe(201);
    const b = JSON.parse(res.body).data as {
      serviceItems: { name: string }[];
      totalDurationMinutes: number;
      servicePriceMinor: number;
    };
    expect(b.serviceItems).toHaveLength(1);
    expect(b.serviceItems[0].name).toBe('Haircut');
    expect(b.totalDurationMinutes).toBe(30);
    expect(b.servicePriceMinor).toBe(100000);
  });

  it('rejects duplicate service selection', async () => {
    const { customer, businessId, svcA } = await multiFixture();
    const res = await createBooking(customer.token, {
      businessId,
      serviceIds: [svcA.id, svcA.id],
      date: tomorrowPkt(),
      startTime: '10:00',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('DUPLICATE_SERVICE');
  });

  it('rejects cross-business service combinations', async () => {
    const { customer, businessId, svcA } = await multiFixture();
    const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: otherBusinessId } = await createBusiness(app, otherOwner.token);
    const svcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${otherBusinessId}/services`,
      headers: authed(otherOwner.token),
      payload: { name: 'Other Service', priceMinor: 10000, durationMinutes: 15 },
    });
    const otherSvc = JSON.parse(svcRes.body).data as { id: string };
    await approveBusiness(otherBusinessId);

    const res = await createBooking(customer.token, {
      businessId,
      serviceIds: [svcA.id, otherSvc.id],
      date: tomorrowPkt(),
      startTime: '10:00',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SERVICE');
  });

  it('rejects inactive services', async () => {
    const { owner, customer, businessId, svcA, svcB } = await multiFixture();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${businessId}/services/${svcB.id}`,
      headers: authed(owner.token),
      payload: { isActive: false },
    });
    const res = await createBooking(customer.token, {
      businessId,
      serviceIds: [svcA.id, svcB.id],
      date: tomorrowPkt(),
      startTime: '10:00',
    });
    expect(res.statusCode).toBe(400);
  });

  it('multi-service availability uses the combined duration', async () => {
    const { businessId, svcA, svcB } = await multiFixture();
    const date = tomorrowPkt();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/availability?date=${date}&serviceIds=${svcA.id},${svcB.id}`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { serviceDurationMinutes: number; slots: { start: string; end: string }[] };
    expect(data.serviceDurationMinutes).toBe(50); // 30+20
    // 09:00–21:00 with 50-minute slots → 09:00, 09:50, …, last start ≤ 20:10
    expect(data.slots[0]).toEqual({ start: '09:00', end: '09:50', available: true });
    expect(data.slots.every((s) => s.end > s.start)).toBe(true);
  });

  it('concurrent overlapping multi-service bookings still return 409', async () => {
    const { customer, businessId, svcA, svcB } = await multiFixture();
    const date = tomorrowPkt();
    const payload = { businessId, serviceIds: [svcA.id, svcB.id], date, startTime: '10:00' };
    const first = await createBooking(customer.token, payload);
    expect(first.statusCode).toBe(201);
    // Overlapping: 10:00+50min overlaps 10:30+50min
    const second = await createBooking(customer.token, { ...payload, startTime: '10:30' });
    expect(second.statusCode).toBe(409);
  });

  it('booking notification mentions all selected services', async () => {
    const { owner, customer, businessId, svcA, svcB } = await multiFixture();
    await createBooking(customer.token, {
      businessId,
      serviceIds: [svcA.id, svcB.id],
      date: tomorrowPkt(),
      startTime: '11:00',
    });
    const notes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: authed(owner.token),
    });
    const items = JSON.parse(notes.body).data as { type: string; message: string }[];
    const created = items.find((n) => n.type === 'BOOKING_CREATED');
    expect(created).toBeDefined();
    expect(created!.message).toContain('Haircut');
    expect(created!.message).toContain('Shave');
  });

  it('backfills BookingServiceItem rows for legacy bookings', async () => {
    const { customer, businessId, svcA } = await multiFixture();
    // Create via legacy path, then verify the item row exists in the DB.
    const res = await createBooking(customer.token, {
      businessId,
      serviceId: svcA.id,
      date: tomorrowPkt(),
      startTime: '12:00',
    });
    expect(res.statusCode).toBe(201);
    const bookingId = (JSON.parse(res.body).data as { id: string }).id;
    const items = await prisma.bookingServiceItem.findMany({ where: { bookingId } });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Haircut');
    expect(items[0].priceMinor).toBe(100000);
    expect(items[0].durationMinutes).toBe(30);
    expect(items[0].serviceId).toBe(svcA.id);
  });
});
