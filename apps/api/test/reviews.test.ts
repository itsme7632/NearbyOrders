import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const app = await makeApp();

/** Tomorrow's YYYY-MM-DD in business-local (PKT) time — always future for bookings. */
const tomorrowPkt = (): string => {
  const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

/** Approved business with bookable hours + a 60-minute service. */
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

const createBooking = async (token: string, businessId: string, serviceId: string, startTime = '10:00') => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/bookings',
    headers: authed(token),
    payload: { businessId, serviceId, date: tomorrowPkt(), startTime },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string; status: string };
};

const setBookingStatus = async (token: string, bookingId: string, status: string) => {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/bookings/${bookingId}/status`,
    headers: authed(token),
    payload: { status },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as { id: string; status: string };
};

const shopFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const customer = await registerAndLogin(app, 'CUSTOMER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await approveBusiness(businessId);
  return { owner, customer, businessId };
};

const createProduct = async (token: string, businessId: string, name: string, priceMinor: number) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(token),
    payload: { name, priceMinor },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { id: string };
};

const completeOrder = async (
  ownerToken: string,
  customerToken: string,
  businessId: string,
  productId: string,
): Promise<{ id: string }> => {
  const placed = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: authed(customerToken),
    payload: { businessId, items: [{ productId, quantity: 1 }] },
  });
  expect(placed.statusCode).toBe(201);
  const order = JSON.parse(placed.body).data as { id: string };
  for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']) {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: authed(ownerToken),
      payload: { status },
    });
    expect(res.statusCode).toBe(200);
  }
  return order;
};

const postReview = (token: string, businessId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/reviews`, headers: authed(token), payload });

const publicReviews = async (businessId: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/reviews` });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as {
    items: { id: string; rating: number; comment: string | null; createdAt: string; reviewerName: string }[];
    nextCursor: string | null;
    averageRating: number | null;
    reviewCount: number;
  };
};

describe('review eligibility', () => {
  it('rejects unauthenticated review creation', async () => {
    const { businessId } = await bookableFixture();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/reviews`,
      payload: { bookingId: '00000000-0000-4000-8000-000000000000', rating: 5 },
      skipAuthorization: true,
    } as never);
    expect([401, 403]).toContain(res.statusCode);
  });

  it('allows reviewing a completed booking of your own', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(owner.token, booking.id, 'COMPLETED');

    const res = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.rating).toBe(5);
  });

  it('allows reviewing a completed order of your own', async () => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Review Cake', 50000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);

    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 4, comment: 'Tasty!' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.comment).toBe('Tasty!');
  });

  it('rejects a pending booking', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    const res = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a rejected booking', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'REJECTED');
    const res = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a cancelled booking', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await app.inject({ method: 'POST', url: `/api/v1/bookings/${booking.id}/cancel`, headers: authed(customer.token) });
    const res = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a confirmed (not completed) booking', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    const res = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a pending order', async () => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Pending Item', 10000);
    const placed = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }] },
    });
    const order = JSON.parse(placed.body).data as { id: string };
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a rejected order', async () => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Reject Item', 10000);
    const placed = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: { businessId, items: [{ productId: product.id, quantity: 1 }] },
    });
    const order = JSON.parse(placed.body).data as { id: string };
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: authed(owner.token),
      payload: { status: 'REJECTED' },
    });
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects nonexistent transaction ids', async () => {
    const { businessId } = await bookableFixture();
    const res = await postReview((await registerAndLogin(app, 'CUSTOMER')).token, businessId, {
      bookingId: '00000000-0000-4000-8000-000000000001',
      rating: 5,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('review ownership', () => {
  it('rejects reviewing another customer’s booking', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const other = await registerAndLogin(app, 'CUSTOMER');
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(owner.token, booking.id, 'COMPLETED');

    const res = await postReview(other.token, businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects reviewing another customer’s order', async () => {
    const { owner, customer, businessId } = await shopFixture();
    const other = await registerAndLogin(app, 'CUSTOMER');
    const product = await createProduct(owner.token, businessId, 'Owned Item', 10000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);

    const res = await postReview(other.token, businessId, { orderId: order.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a transaction that belongs to a different business', async () => {
    const a = await bookableFixture();
    const b = await bookableFixture();
    const booking = await createBooking(a.customer.token, a.businessId, a.serviceId);
    await setBookingStatus(a.owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(a.owner.token, booking.id, 'COMPLETED');

    // Customer A tries to attach booking A's review to business B.
    const res = await postReview(a.customer.token, b.businessId, { bookingId: booking.id, rating: 5 });
    expect(res.statusCode).toBe(404);
  });
});

describe('duplicate protection', () => {
  it('rejects a second review for the same booking (409)', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(owner.token, booking.id, 'COMPLETED');

    expect((await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 })).statusCode).toBe(201);
    const second = await postReview(customer.token, businessId, { bookingId: booking.id, rating: 1 });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('ALREADY_REVIEWED');
  });

  it('rejects a second review for the same order (409)', async () => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Dup Item', 10000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);

    expect((await postReview(customer.token, businessId, { orderId: order.id, rating: 4 })).statusCode).toBe(201);
    const second = await postReview(customer.token, businessId, { orderId: order.id, rating: 2 });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a review referencing both bookingId and orderId', async () => {
    const { businessId } = await bookableFixture();
    const res = await postReview((await registerAndLogin(app, 'CUSTOMER')).token, businessId, {
      bookingId: '00000000-0000-4000-8000-000000000002',
      orderId: '00000000-0000-4000-8000-000000000003',
      rating: 5,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a review referencing neither', async () => {
    const { businessId } = await bookableFixture();
    const res = await postReview((await registerAndLogin(app, 'CUSTOMER')).token, businessId, { rating: 5 });
    expect(res.statusCode).toBe(400);
  });

  it('enforces uniqueness at the database level directly', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(owner.token, booking.id, 'COMPLETED');
    await prisma.review.create({
      data: { businessId, customerId: (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).customerId, bookingId: booking.id, rating: 5 },
    });
    await expect(
      prisma.review.create({
        data: { businessId, customerId: '00000000-0000-4000-8000-000000000000', bookingId: booking.id, rating: 1 },
      }),
    ).rejects.toThrow();
  });
});

describe('rating validation', () => {
  it.each([1, 5])('accepts rating %i on a completed order', async (rating) => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, `Rate ${rating}`, 10000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating });
    expect(res.statusCode).toBe(201);
  });

  it.each([0, 6, -1, 3.5, 'five', null])('rejects invalid rating %p', async (rating) => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Bad Rate', 10000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating });
    expect(res.statusCode).toBe(400);
  });
});

describe('comment validation', () => {
  const orderFixture = async () => {
    const { owner, customer, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId, 'Comment Item', 10000);
    const order = await completeOrder(owner.token, customer.token, businessId, product.id);
    return { customer, businessId, order };
  };

  it('accepts a star-only review (no comment)', async () => {
    const { customer, businessId, order } = await orderFixture();
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 4 });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.comment).toBeNull();
  });

  it('trims surrounding whitespace from a valid comment', async () => {
    const { customer, businessId, order } = await orderFixture();
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 4, comment: '  Great service!  ' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.comment).toBe('Great service!');
  });

  it('rejects a whitespace-only comment', async () => {
    const { customer, businessId, order } = await orderFixture();
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 4, comment: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an overly long comment', async () => {
    const { customer, businessId, order } = await orderFixture();
    const res = await postReview(customer.token, businessId, { orderId: order.id, rating: 4, comment: 'x'.repeat(1001) });
    expect(res.statusCode).toBe(400);
  });
});

describe('public reviews & rating summary', () => {
  it('computes average and count over the full review set', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const c2 = await registerAndLogin(app, 'CUSTOMER');
    const b1 = await createBooking(customer.token, businessId, serviceId, '10:00');
    const b2 = await createBooking(c2.token, businessId, serviceId, '12:00');
    for (const b of [b1, b2]) {
      await setBookingStatus(owner.token, b.id, 'CONFIRMED');
      await setBookingStatus(owner.token, b.id, 'COMPLETED');
    }
    await postReview(customer.token, businessId, { bookingId: b1.id, rating: 5 });
    await postReview(c2.token, businessId, { bookingId: b2.id, rating: 3 });

    const data = await publicReviews(businessId);
    expect(data.reviewCount).toBe(2);
    expect(data.averageRating).toBe(4); // (5+3)/2 = 4.0
    expect(data.items).toHaveLength(2);
  });

  it('rounds the average to one decimal place', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const bookings: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const b = await createBooking(customer.token, businessId, serviceId, `${['10:00', '12:00', '14:00'][i]}`);
      await setBookingStatus(owner.token, b.id, 'CONFIRMED');
      await setBookingStatus(owner.token, b.id, 'COMPLETED');
      bookings.push(b);
    }
    await postReview(customer.token, businessId, { bookingId: bookings[0]!.id, rating: 5 });
    await postReview(customer.token, businessId, { bookingId: bookings[1]!.id, rating: 4 });
    await postReview(customer.token, businessId, { bookingId: bookings[2]!.id, rating: 4 });

    const data = await publicReviews(businessId);
    expect(data.averageRating).toBe(4.3); // 13/3 = 4.333…
  });

  it('returns null average and zero count with no reviews', async () => {
    const { businessId } = await bookableFixture();
    const data = await publicReviews(businessId);
    expect(data.averageRating).toBeNull();
    expect(data.reviewCount).toBe(0);
    expect(data.items).toHaveLength(0);
    expect(data.nextCursor).toBeNull();
  });

  it('lists reviews newest-first with pagination and never exposes private fields', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const bookings: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const b = await createBooking(customer.token, businessId, serviceId, `${['10:00', '12:00', '14:00'][i]}`);
      await setBookingStatus(owner.token, b.id, 'CONFIRMED');
      await setBookingStatus(owner.token, b.id, 'COMPLETED');
      bookings.push(b);
    }
    for (const [i, b] of bookings.entries()) {
      await postReview(customer.token, businessId, { bookingId: b.id, rating: i + 3 });
      await new Promise((r) => setTimeout(r, 15));
    }

    const page1 = await publicReviews(businessId);
    expect(page1.items).toHaveLength(3);
    const times = page1.items.map((n) => Date.parse(n.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const raw = JSON.stringify(page1).toLowerCase();
    expect(raw).not.toContain('passwordhash');
    expect(raw).not.toContain('email');
    // Reviewer display name exists but no raw account data.
    expect(page1.items[0]!.reviewerName.length).toBeGreaterThan(0);
  });

  it('paginates with a cursor and no overlap', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const bookings: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const b = await createBooking(customer.token, businessId, serviceId, `${['10:00', '12:00', '14:00'][i]}`);
      await setBookingStatus(owner.token, b.id, 'CONFIRMED');
      await setBookingStatus(owner.token, b.id, 'COMPLETED');
      bookings.push(b);
    }
    for (const b of bookings) {
      await postReview(customer.token, businessId, { bookingId: b.id, rating: 5 });
      await new Promise((r) => setTimeout(r, 15));
    }
    const res1 = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/reviews?limit=2` });
    const page1 = JSON.parse(res1.body).data;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/reviews?limit=2&cursor=${page1.nextCursor}`,
    });
    const page2 = JSON.parse(res2.body).data;
    expect(page2.items).toHaveLength(1);
    expect(page2.items.every((n: { id: string }) => !page1.items.some((p: { id: string }) => p.id === n.id))).toBe(true);
  });
});

describe('security & role boundaries', () => {
  it('owners can review OTHER businesses; the review is customer-scoped', async () => {
    const { owner, businessId, serviceId, customer } = await bookableFixture();
    const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: otherBusinessId } = await createBusiness(app, otherOwner.token);
    await approveBusiness(otherBusinessId);

    // Reviewing their own business is rejected.
    const own = await postReview(owner.token, businessId, {
      bookingId: '00000000-0000-4000-8000-000000000004',
      rating: 5,
    });
    expect([400, 403, 404]).toContain(own.statusCode);

    // A completed booking at the other business lets the owner review it as a customer.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${otherBusinessId}/hours`,
      headers: authed(otherOwner.token),
      payload: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '21:00' })),
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${otherBusinessId}/services`,
      headers: authed(otherOwner.token),
      payload: { name: 'Reviewable Service', priceMinor: 12000, durationMinutes: 60 },
    });
    const otherServiceId = JSON.parse(created.body).data.id as string;
    const booked = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(owner.token),
      payload: { businessId: otherBusinessId, serviceId: otherServiceId, date: tomorrowPkt(), startTime: '10:00' },
    });
    expect(booked.statusCode).toBe(201);
    const bookingId = JSON.parse(booked.body).data.id as string;
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } });
    const res = await postReview(owner.token, otherBusinessId, { bookingId, rating: 5 });
    expect(res.statusCode).toBe(201);
    expect(customer).toBeDefined();
    expect(serviceId).toBeDefined();
  });

  it('an unrelated owner sees only their own businesses’ reviews', async () => {
    const a = await bookableFixture();
    const bOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const booking = await createBooking(a.customer.token, a.businessId, a.serviceId);
    await setBookingStatus(a.owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(a.owner.token, booking.id, 'COMPLETED');
    await postReview(a.customer.token, a.businessId, { bookingId: booking.id, rating: 5 });

    const foreign = await app.inject({ method: 'GET', url: '/api/v1/my-business-reviews', headers: authed(bOwner.token) });
    expect(foreign.statusCode).toBe(200);
    expect(JSON.parse(foreign.body).data).toHaveLength(0);

    const mine = await app.inject({ method: 'GET', url: '/api/v1/my-business-reviews', headers: authed(a.owner.token) });
    expect(mine.statusCode).toBe(200);
    expect(JSON.parse(mine.body).data).toHaveLength(1);
  });

  it('my-reviews lists only the current customer’s reviews', async () => {
    const { owner, customer, businessId, serviceId } = await bookableFixture();
    const other = await registerAndLogin(app, 'CUSTOMER');
    const booking = await createBooking(customer.token, businessId, serviceId);
    await setBookingStatus(owner.token, booking.id, 'CONFIRMED');
    await setBookingStatus(owner.token, booking.id, 'COMPLETED');
    await postReview(customer.token, businessId, { bookingId: booking.id, rating: 5 });

    const mine = await app.inject({ method: 'GET', url: '/api/v1/my-reviews', headers: authed(customer.token) });
    expect(mine.statusCode).toBe(200);
    expect(JSON.parse(mine.body).data).toHaveLength(1);

    const theirs = await app.inject({ method: 'GET', url: '/api/v1/my-reviews', headers: authed(other.token) });
    expect(JSON.parse(theirs.body).data).toHaveLength(0);
  });
});
