import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** Booking needs open business hours; give the shop a simple Mon–Sun window. */
async function ensureHours(businessId: string): Promise<void> {
  const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: false,
    opensAt: '08:00',
    closesAt: '23:00',
  }));
  await prisma.businessHour.deleteMany({ where: { businessId } });
  await prisma.businessHour.createMany({ data: days.map((d) => ({ ...d, businessId })) });
}

const shopFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id: businessId } = await createBusiness(app, owner.token);
  await approveBusiness(businessId);
  await ensureHours(businessId);
  return { owner, businessId };
};

const createProduct = async (token: string, businessId: string, priceMinor = 45000) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/products`,
    headers: authed(token),
    payload: { name: 'Order Item', priceMinor },
  });
  return JSON.parse(res.body).data as { id: string };
};

const createBookableService = async (token: string, businessId: string) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/services`,
    headers: authed(token),
    payload: { name: 'Consultation', priceMinor: 50000, durationMinutes: 60 },
  });
  return JSON.parse(res.body).data as { id: string };
};

/** A future business-local (PKT) date/time so booking validation passes. */
const futureSlot = () => {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000 + 48 * 60 * 60 * 1000); // +48h, PKT
  const date = now.toISOString().slice(0, 10);
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
  // Choose an open weekday per the default 09:00–18:00 fixture hours.
  const openDay = day === 0 ? 1 : day;
  const adjusted = new Date(Date.parse(`${date}T00:00:00Z`) + (openDay - day) * 86_400_000);
  return { date: adjusted.toISOString().slice(0, 10), startTime: '10:00' };
};

const notificationsFor = async (token: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: authed(token) });
  // The list is wrapped like every other endpoint: { data: { items, nextCursor } }.
  return (JSON.parse(res.body).data as {
    items: {
      id: string;
      type: string;
      title: string;
      message: string;
      entityType: string;
      entityId: string;
      isRead: boolean;
    }[];
  }).items;
};

const unreadCount = async (token: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', headers: authed(token) });
  return JSON.parse(res.body).data.count as number;
};

describe('notification endpoints & security', () => {
  it('rejects unauthenticated access to all notification endpoints', async () => {
    const opts = { skipAuthorization: true } as const;
    const list = await app.inject({ method: 'GET', url: '/api/v1/notifications', ...opts } as never);
    const count = await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', ...opts } as never);
    const read = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/00000000-0000-4000-8000-000000000000/read', ...opts } as never);
    const readAll = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/read-all', ...opts } as never);
    for (const res of [list, count, read, readAll]) expect([401, 403]).toContain(res.statusCode);
  });

  it('a user sees only their own notifications and cannot read another user’s notification', async () => {
    const c1 = await registerAndLogin(app, 'CUSTOMER');
    const c2 = await registerAndLogin(app, 'CUSTOMER');
    await prisma.notification.create({
      data: { userId: c1.userId, type: 'ORDER_READY', title: 'T', message: 'M', entityType: 'Order', entityId: '00000000-0000-4000-8000-000000000001' },
    });

    const mine = await notificationsFor(c1.token);
    expect(mine).toHaveLength(1);
    const theirs = await notificationsFor(c2.token);
    expect(theirs).toHaveLength(0);

    // c2 cannot mark c1's notification read (404, not 403).
    const foreign = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${mine[0]!.id}/read`,
      headers: authed(c2.token),
    });
    expect(foreign.statusCode).toBe(404);
    // …and it stays unread.
    expect((await prisma.notification.findFirstOrThrow({ where: { id: mine[0]!.id } })).isRead).toBe(false);

    // c2's read-all cannot touch c1's rows.
    await app.inject({ method: 'PATCH', url: '/api/v1/notifications/read-all', headers: authed(c2.token) });
    expect((await prisma.notification.findFirstOrThrow({ where: { id: mine[0]!.id } })).isRead).toBe(false);
  });

  it('unread count, mark one read, and mark all read work', async () => {
    const c = await registerAndLogin(app, 'CUSTOMER');
    await prisma.notification.createMany({
      data: [
        { userId: c.userId, type: 'ORDER_ACCEPTED', title: 'A', message: 'a', entityType: 'Order', entityId: '00000000-0000-4000-8000-00000000000a' },
        { userId: c.userId, type: 'ORDER_READY', title: 'B', message: 'b', entityType: 'Order', entityId: '00000000-0000-4000-8000-00000000000b' },
      ],
    });
    expect(await unreadCount(c.token)).toBe(2);

    const list = await notificationsFor(c.token);
    const marked = await app.inject({ method: 'PATCH', url: `/api/v1/notifications/${list[0]!.id}/read`, headers: authed(c.token) });
    expect(marked.statusCode).toBe(200);
    expect(JSON.parse(marked.body).data.isRead).toBe(true);
    expect(JSON.parse(marked.body).data.readAt).not.toBeNull();
    expect(await unreadCount(c.token)).toBe(1);

    const readAll = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/read-all', headers: authed(c.token) });
    expect(JSON.parse(readAll.body).data.updated).toBe(1);
    expect(await unreadCount(c.token)).toBe(0);
    // Idempotent: read-all again updates nothing.
    const again = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/read-all', headers: authed(c.token) });
    expect(JSON.parse(again.body).data.updated).toBe(0);
  });

  it('list is paginated and newest-first, with a safe DTO', async () => {
    const c = await registerAndLogin(app, 'CUSTOMER');
    for (let i = 0; i < 5; i++) {
      await prisma.notification.create({
        data: { userId: c.userId, type: 'ORDER_READY', title: `N${i}`, message: `m${i}`, entityType: 'Order', entityId: `00000000-0000-4000-8000-00000000010${i}` },
      });
    }
    const page1 = await app.inject({ method: 'GET', url: '/api/v1/notifications?limit=3', headers: authed(c.token) });
    const body1 = JSON.parse(page1.body);
    expect(body1.data.items).toHaveLength(3);
    // Newest first: createdAt desc, then id desc as a stable tiebreaker.
    const times = body1.data.items.map((n: { createdAt: string }) => Date.parse(n.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(body1.data.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications?limit=3&cursor=${body1.data.nextCursor}`,
      headers: authed(c.token),
    });
    const body2 = JSON.parse(page2.body);
    expect(body2.data.items).toHaveLength(2);
    expect(body2.data.nextCursor).toBeNull();

    // Safe DTO: no user object, no credentials anywhere.
    const serialized = JSON.stringify(body1).toLowerCase();
    expect(serialized).not.toContain('passwordhash');
    expect(serialized).not.toContain('token');
    expect(body1.data.items[0].user).toBeUndefined();
  });
});

describe('booking notifications', () => {
  it('creation notifies the owner; acceptance/rejection notify the customer', async () => {
    const { owner, businessId } = await shopFixture();
    const service = await createBookableService(owner.token, businessId);
    const c = await registerAndLogin(app, 'CUSTOMER');
    const slot = futureSlot();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(c.token),
      payload: { businessId, serviceId: service.id, ...slot },
    });
    expect(created.statusCode).toBe(201);
    const bookingId = JSON.parse(created.body).data.id as string;

    const ownerNotes = await notificationsFor(owner.token);
    const createdNotice = ownerNotes.find((n) => n.type === 'BOOKING_CREATED');
    expect(createdNotice).toBeTruthy();
    expect(createdNotice!.entityId).toBe(bookingId);
    expect(createdNotice!.entityType).toBe('Booking');
    expect(createdNotice!.message).toContain('Consultation');
    // No customer email leaks into the message.
    expect(createdNotice!.message).not.toContain('@');

    // Acceptance notifies the customer.
    await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(owner.token), payload: { status: 'CONFIRMED' } });
    let cNotes = await notificationsFor(c.token);
    expect(cNotes.find((n) => n.type === 'BOOKING_ACCEPTED')).toBeTruthy();

    // A second booking: rejection path.
    const slot2 = futureSlot();
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(c.token),
      payload: { businessId, serviceId: service.id, date: slot2.date, startTime: '14:00' },
    });
    expect(second.statusCode).toBe(201);
    const booking2 = JSON.parse(second.body).data.id as string;
    await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${booking2}/status`, headers: authed(owner.token), payload: { status: 'REJECTED' } });
    cNotes = await notificationsFor(c.token);
    expect(cNotes.find((n) => n.type === 'BOOKING_REJECTED')).toBeTruthy();
  });

  it('customer cancellation notifies the owner; invalid transitions notify nobody', async () => {
    const { owner, businessId } = await shopFixture();
    const service = await createBookableService(owner.token, businessId);
    const c = await registerAndLogin(app, 'CUSTOMER');
    const slot = futureSlot();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(c.token),
      payload: { businessId, serviceId: service.id, ...slot },
    });
    const bookingId = JSON.parse(created.body).data.id as string;

    // Owner has exactly the creation notice so far.
    const before = (await notificationsFor(owner.token)).filter((n) => n.entityId === bookingId);
    expect(before.map((n) => n.type)).toEqual(['BOOKING_CREATED']);

    // Invalid transition (REJECTED → ACCEPTED): no new notification.
    await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(owner.token), payload: { status: 'REJECTED' } });
    const afterReject = (await notificationsFor(c.token)).length;
    const invalid = await app.inject({ method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: authed(owner.token), payload: { status: 'CONFIRMED' } });
    expect(invalid.statusCode).toBe(409);
    expect((await notificationsFor(c.token)).length).toBe(afterReject);

    // Fresh booking cancelled by the customer → owner gets BOOKING_CANCELLED.
    const slot2 = futureSlot();
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(c.token),
      payload: { businessId, serviceId: service.id, date: slot2.date, startTime: '16:00' },
    });
    const booking2 = JSON.parse(second.body).data.id as string;
    await app.inject({ method: 'POST', url: `/api/v1/bookings/${booking2}/cancel`, headers: authed(c.token) });
    const ownerNotes = (await notificationsFor(owner.token)).filter((n) => n.entityId === booking2);
    // Newest first; both events for this booking must exist exactly once.
    expect(ownerNotes.map((n) => n.type).sort()).toEqual(['BOOKING_CANCELLED', 'BOOKING_CREATED']);
  });
});

describe('order notifications', () => {
  const orderFixture = async () => {
    const { owner, businessId } = await shopFixture();
    const product = await createProduct(owner.token, businessId);
    const c = await registerAndLogin(app, 'CUSTOMER');
    return { owner, businessId, product, c };
  };

  const placeOrder = async (token: string, businessId: string, productId: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(token),
      payload: { businessId, items: [{ productId, quantity: 2 }] },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data as { id: string; subtotalMinor: number };
  };

  it('creation notifies the owner; each owner transition notifies the customer', async () => {
    const { owner, businessId, product, c } = await orderFixture();
    const order = await placeOrder(c.token, businessId, product.id);

    const ownerNotes = await notificationsFor(owner.token);
    const created = ownerNotes.find((n) => n.type === 'ORDER_CREATED');
    expect(created).toBeTruthy();
    expect(created!.entityId).toBe(order.id);
    expect(created!.message).toContain('2 items');
    expect(created!.message).toContain('Rs 900'); // 2 × Rs 450

    const journey: [string, string][] = [
      ['ACCEPTED', 'ORDER_ACCEPTED'],
      ['PREPARING', 'ORDER_PREPARING'],
      ['READY', 'ORDER_READY'],
      ['COMPLETED', 'ORDER_COMPLETED'],
    ];
    for (const [status, expectedType] of journey) {
      const res = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status } });
      expect(res.statusCode).toBe(200);
      const notes = await notificationsFor(c.token);
      expect(notes.some((n) => n.type === expectedType && n.entityId === order.id)).toBe(true);
    }
  });

  it('customer cancellation notifies the owner; invalid transition creates nothing', async () => {
    const { owner, businessId, product, c } = await orderFixture();
    const order = await placeOrder(c.token, businessId, product.id);

    const invalid = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(owner.token), payload: { status: 'COMPLETED' } });
    expect(invalid.statusCode).toBe(409);
    const customerNotes = await notificationsFor(c.token);
    expect(customerNotes.find((n) => n.entityId === order.id)).toBeUndefined();

    const cancel = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: authed(c.token), payload: { status: 'CANCELLED' } });
    expect(cancel.statusCode).toBe(200);
    const ownerNotes = (await notificationsFor(owner.token)).filter((n) => n.entityId === order.id);
    expect(ownerNotes.map((n) => n.type).sort()).toEqual(['ORDER_CANCELLED', 'ORDER_CREATED']);
  });

  it('a retried identical event does not duplicate notifications (unique event key)', async () => {
    const { owner, businessId, product, c } = await orderFixture();
    const order = await placeOrder(c.token, businessId, product.id);
    // The same (userId, type, entityId) row already exists — direct re-create
    // via the service contract (skipDuplicates) must not add another row.
    await prisma.notification.createMany({
      data: [{ userId: owner.userId, type: 'ORDER_CREATED', title: 'dup', message: 'dup', entityType: 'Order', entityId: order.id }],
      skipDuplicates: true,
    });
    const rows = await prisma.notification.findMany({ where: { userId: owner.userId, type: 'ORDER_CREATED', entityId: order.id } });
    expect(rows).toHaveLength(1);
  });
});
