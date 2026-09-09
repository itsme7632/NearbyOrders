import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** Tomorrow's YYYY-MM-DD in business-local (Asia/Karachi) time — always in the future for bookings. */
const tomorrowPkt = (): string => {
  const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

/** Bookable fixture: approved business, 09:00–21:00 every day, 60-minute service. */
const bookableFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const customer = await registerAndLogin(app, 'CUSTOMER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await app.inject({
    method: 'PUT',
    url: `/api/v1/businesses/${businessId}/hours`,
    headers: authed(owner.token),
    payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '21:00' })),
  });
  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/services`,
    headers: authed(owner.token),
    payload: { name: 'Signature Service', priceMinor: 100000, durationMinutes: 60 },
  });
  const serviceId = JSON.parse(created.body).data.id as string;
  await approveBusiness(businessId);
  return { owner, customer, businessId, serviceId };
};

const createBooking = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/bookings', headers: authed(token), payload });

describe('availability', () => {
  it('returns duration-aligned slots inside business hours', async () => {
    const { businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${date}` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { closed: boolean; slots: { start: string; end: string; available: boolean }[] };
    expect(data.closed).toBe(false);
    // 09:00–21:00 with 60-minute slots → 09:00, 10:00, …, 20:00 starts.
    expect(data.slots.length).toBe(12);
    expect(data.slots[0]).toEqual({ start: '09:00', end: '10:00', available: true });
    expect(data.slots.at(-1)?.start).toBe('20:00');
    expect(data.slots.every((s) => s.available)).toBe(true);
  });

  it('marks overlapping booked slots as unavailable but keeps later slots open', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const created = await createBooking(customer.token, { businessId, serviceId, date, startTime: '10:00' });
    expect(created.statusCode).toBe(201);

    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${date}` });
    const slots = (JSON.parse(res.body).data as { slots: { start: string; available: boolean }[] }).slots;
    expect(slots.find((s) => s.start === '10:00')?.available).toBe(false);
    expect(slots.find((s) => s.start === '09:00')?.available).toBe(true);
    expect(slots.find((s) => s.start === '11:00')?.available).toBe(true);
  });

  it('closed days return no slots', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    // Close every day.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${businessId}/hours`,
      headers: authed(owner.token),
      payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: true })),
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name: 'Closed Day Service', priceMinor: 50000, durationMinutes: 30 },
    });
    const serviceId = JSON.parse(created.body).data.id as string;
    await approveBusiness(businessId);

    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${tomorrowPkt()}` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { closed: boolean; slots: unknown[] };
    expect(data.closed).toBe(true);
    expect(data.slots).toHaveLength(0);
  });

  it('cancelled bookings do not block slots', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const created = await createBooking(customer.token, { businessId, serviceId, date, startTime: '12:00' });
    const bookingId = JSON.parse(created.body).data.id as string;
    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/bookings/${bookingId}/cancel`, headers: authed(customer.token) });
    expect(cancelled.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${date}` });
    const slots = (JSON.parse(res.body).data as { slots: { start: string; available: boolean }[] }).slots;
    expect(slots.find((s) => s.start === '12:00')?.available).toBe(true);
  });

  it('past slots are marked unavailable', async () => {
    const { businessId, serviceId } = await bookableFixture();
    // Today in PKT: morning slots of the current day are (almost always) past.
    const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/services/${serviceId}/availability?date=${today}` });
    const data = JSON.parse(res.body).data as { slots: { start: string; available: boolean }[] };
    expect(data.slots[0].start).toBe('09:00');
    expect(data.slots[0].available).toBe(false);
  });
});

describe('booking creation', () => {
  it('customer creates a booking and the server derives the end time', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const res = await createBooking(customer.token, { businessId, serviceId, date, startTime: '10:00', notes: 'By the front door' });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data as { endTime: string; status: string; notes: string | null; startTime: string };
    expect(data.startTime).toBe('10:00');
    expect(data.endTime).toBe('11:00'); // 60-minute service duration, server-derived.
    expect(data.status).toBe('PENDING');
    expect(data.notes).toBe('By the front door');
  });

  it('rejects bookings extending past closing time', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const res = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '20:30' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('OUTSIDE_HOURS');
  });

  it('rejects bookings starting before opening time', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const res = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '08:30' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('OUTSIDE_HOURS');
  });

  it('rejects bookings in the past', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const yesterdayPkt = new Date(Date.now() + 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await createBooking(customer.token, { businessId, serviceId, date: yesterdayPkt, startTime: '10:00' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects overlapping bookings for the same business', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const other = await registerAndLogin(app, 'CUSTOMER');
    const first = await createBooking(customer.token, { businessId, serviceId, date, startTime: '13:00' });
    expect(first.statusCode).toBe(201);
    const second = await createBooking(other.token, { businessId, serviceId, date, startTime: '13:30' }); // 13:30–14:30 overlaps 13:00–14:00
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('SLOT_TAKEN');
  });

  it('allows back-to-back bookings at adjacent slot boundaries', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const first = await createBooking(customer.token, { businessId, serviceId, date, startTime: '15:00' });
    const second = await createBooking(customer.token, { businessId, serviceId, date, startTime: '16:00' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('rejects bookings for non-bookable services (no duration)', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name: 'No Duration Service', priceMinor: 20000 }, // durationMinutes omitted → not bookable
    });
    const serviceId = (await prisma.service.findFirstOrThrow({ where: { businessId, name: 'No Duration Service' } })).id;
    await approveBusiness(businessId);

    const res = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SERVICE');
  });

  it('customers only; owners cannot create customer bookings', async () => {
    const { owner, businessId, serviceId } = await bookableFixture();
    const res = await createBooking(owner.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    expect(res.statusCode).toBe(403);
  });
});

describe('booking listing and visibility', () => {
  it('customer sees only their own bookings; owner sees bookings for their businesses', async () => {
    const { customer, owner, businessId, serviceId } = await bookableFixture();
    await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });

    const mine = await app.inject({ method: 'GET', url: '/api/v1/bookings', headers: authed(customer.token) });
    expect(mine.statusCode).toBe(200);
    const mineData = JSON.parse(mine.body).data as { customerId: string }[];
    expect(mineData).toHaveLength(1);

    const ownerList = await app.inject({ method: 'GET', url: `/api/v1/bookings`, headers: authed(owner.token) });
    const ownerData = JSON.parse(ownerList.body).data as { businessId: string; customer: { id: string } }[];
    expect(ownerData).toHaveLength(1);
    expect(ownerData[0].businessId).toBe(businessId);
    expect(ownerData[0].customer.id).toBe(customer.userId);

    const stranger = await registerAndLogin(app, 'CUSTOMER');
    const strangerList = await app.inject({ method: 'GET', url: '/api/v1/bookings', headers: authed(stranger.token) });
    expect(JSON.parse(strangerList.body).data).toHaveLength(0);
  });

  it('owner per-business listing requires ownership', async () => {
    const { owner, businessId } = await bookableFixture();
    const ok = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/bookings`, headers: authed(owner.token) });
    expect(ok.statusCode).toBe(200);

    const stranger = await registerAndLogin(app, 'BUSINESS_OWNER');
    const denied = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/bookings`, headers: authed(stranger.token) });
    expect(denied.statusCode).toBe(404);
  });

  it('single booking is visible to its customer but not to other customers', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '11:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const ok = await app.inject({ method: 'GET', url: `/api/v1/bookings/${bookingId}`, headers: authed(customer.token) });
    expect(ok.statusCode).toBe(200);

    const stranger = await registerAndLogin(app, 'CUSTOMER');
    const denied = await app.inject({ method: 'GET', url: `/api/v1/bookings/${bookingId}`, headers: authed(stranger.token) });
    expect(denied.statusCode).toBe(404);
  });
});

describe('booking status transitions', () => {
  it('owner confirms a pending booking', async () => {
    const { customer, owner, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(owner.token), payload: { status: 'CONFIRMED' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('CONFIRMED');
  });

  it('customer cannot change booking status', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(customer.token), payload: { status: 'CONFIRMED' } });
    expect(res.statusCode).toBe(403);
  });

  it("owner of another business cannot change someone else's booking", async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const stranger = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(stranger.token), payload: { status: 'CONFIRMED' } });
    expect(res.statusCode).toBe(404);
  });

  it('invalid transitions are rejected', async () => {
    const { customer, owner, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    // PENDING → COMPLETED is not allowed.
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(owner.token), payload: { status: 'COMPLETED' } });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_TRANSITION');
  });

  it('customer cancels their own pending booking; cancelled bookings cannot be re-cancelled', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/bookings/${bookingId}/cancel`, headers: authed(customer.token) });
    expect(cancelled.statusCode).toBe(200);
    expect(JSON.parse(cancelled.body).data.status).toBe('CANCELLED');

    const again = await app.inject({ method: 'POST', url: `/api/v1/bookings/${bookingId}/cancel`, headers: authed(customer.token) });
    expect(again.statusCode).toBe(409);
  });

  it('customer cannot cancel someone else’s booking', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const created = await createBooking(customer.token, { businessId, serviceId, date: tomorrowPkt(), startTime: '10:00' });
    const bookingId = JSON.parse(created.body).data.id as string;

    const stranger = await registerAndLogin(app, 'CUSTOMER');
    const res = await app.inject({ method: 'POST', url: `/api/v1/bookings/${bookingId}/cancel`, headers: authed(stranger.token) });
    expect(res.statusCode).toBe(404);
  });
});

describe('time helpers (Asia/Karachi)', () => {
  it('stores the business-local date and UTC instants consistently', async () => {
    const { customer, businessId, serviceId } = await bookableFixture();
    const date = tomorrowPkt();
    const res = await createBooking(customer.token, { businessId, serviceId, date, startTime: '10:00' });
    const bookingId = JSON.parse(res.body).data.id as string;

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    // bookingDate column must match the requested local calendar date.
    expect(row.bookingDate.toISOString().slice(0, 10)).toBe(date);
    // 10:00 PKT = 05:00 UTC.
    expect(row.startAt.toISOString()).toBe(`${date}T05:00:00.000Z`);
    expect(row.endAt.toISOString()).toBe(`${date}T06:00:00.000Z`);
  });
});
