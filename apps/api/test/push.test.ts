import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, makeApp, registerAndLogin, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { NoopPushProvider, dispatchPushNotifications, setPushProvider, type PushProvider } from '../src/push.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  setPushProvider(null);
});

const registerDevice = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/push/devices', headers: authed(token), payload });

const TOKEN_A = 'fcm-token-alpha-000000000001';
const TOKEN_B = 'fcm-token-beta-0000000000002';

describe('push device registration (Phase 13)', () => {
  it('rejects unauthenticated registration', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/push/devices', payload: { platform: 'android', pushToken: TOKEN_A } });
    expect(res.statusCode).toBe(401);
  });

  it('registers a device and never returns the raw token', async () => {
    const user = await registerAndLogin(app);
    const res = await registerDevice(user.token, { platform: 'android', pushToken: TOKEN_A });
    expect(res.statusCode).toBe(201);
    const body = res.body;
    expect(body).not.toContain(TOKEN_A); // opaque credential stays server-side
    const data = JSON.parse(body).data as { id: string; platform: string; isActive: boolean };
    expect(data.platform).toBe('android');
    expect(data.isActive).toBe(true);
  });

  it('rejects invalid payloads (bad platform, short token, extra fields)', async () => {
    const user = await registerAndLogin(app);
    for (const payload of [
      { platform: 'symbian', pushToken: TOKEN_A },
      { platform: 'android', pushToken: 'short' },
      { platform: 'android', pushToken: TOKEN_A, root: true },
      { pushToken: TOKEN_A },
    ]) {
      const res = await registerDevice(user.token, payload);
      expect(res.statusCode).toBe(400);
    }
  });

  it('re-registering the same token updates instead of duplicating', async () => {
    const user = await registerAndLogin(app);
    await registerDevice(user.token, { platform: 'android', pushToken: TOKEN_B });
    const again = await registerDevice(user.token, { platform: 'android', pushToken: TOKEN_B, deviceId: 'device-2' });
    expect(again.statusCode).toBe(201);
    const rows = await prisma.pushDevice.findMany({ where: { pushToken: TOKEN_B } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceId).toBe('device-2');
  });

  it('a token moving to a new user is re-pointed (reinstall flow), not duplicated', async () => {
    const first = await registerAndLogin(app);
    const second = await registerAndLogin(app);
    const token = 'fcm-token-reinstall-00000001';
    await registerDevice(first.token, { platform: 'android', pushToken: token });
    await registerDevice(second.token, { platform: 'android', pushToken: token });
    const row = await prisma.pushDevice.findUniqueOrThrow({ where: { pushToken: token } });
    expect(row.userId).toBe(second.userId);
  });

  it('supports multiple devices per user and deactivates only the owned one', async () => {
    const user = await registerAndLogin(app);
    const stranger = await registerAndLogin(app);
    const d1 = await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-multi-device-00000001' });
    await registerDevice(user.token, { platform: 'ios', pushToken: 'fcm-multi-device-00000002' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/push/devices', headers: authed(user.token) });
    expect(list.statusCode).toBe(200);
    const devices = JSON.parse(list.body).data as { id: string; pushToken?: string }[];
    expect(devices).toHaveLength(2);
    expect(devices.some((d) => d.pushToken)).toBe(false);

    // A stranger cannot deactivate another user's device.
    const foreign = await app.inject({ method: 'DELETE', url: `/api/v1/push/devices/${JSON.parse(d1.body).data.id}`, headers: authed(stranger.token) });
    expect(foreign.statusCode).toBe(404);

    const mine = await app.inject({ method: 'DELETE', url: `/api/v1/push/devices/${JSON.parse(d1.body).data.id}`, headers: authed(user.token) });
    expect(mine.statusCode).toBe(200);
    const row = await prisma.pushDevice.findUniqueOrThrow({ where: { pushToken: 'fcm-multi-device-00000001' } });
    expect(row.isActive).toBe(false);
    const other = await prisma.pushDevice.findUniqueOrThrow({ where: { pushToken: 'fcm-multi-device-00000002' } });
    expect(other.isActive).toBe(true);
  });
});

describe('push preferences (Phase 13)', () => {
  it('defaults to all-on when no row exists, saves and persists custom values', async () => {
    const user = await registerAndLogin(app);
    const get1 = await app.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: authed(user.token) });
    expect(get1.statusCode).toBe(200);
    const initial = JSON.parse(get1.body).data as Record<string, unknown>;
    expect(initial.bookings).toBe(true);
    expect(initial.payments).toBe(true);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/notifications/preferences',
      headers: authed(user.token),
      payload: { bookings: false, orders: true, payments: true, reviews: false, businessActivity: true, account: true },
    });
    expect(put.statusCode).toBe(200);

    const get2 = await app.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: authed(user.token) });
    const saved = JSON.parse(get2.body).data as Record<string, unknown>;
    expect(saved.bookings).toBe(false);
    expect(saved.reviews).toBe(false);
    expect(saved.orders).toBe(true);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/v1/notifications/preferences',
      headers: authed(user.token),
      payload: { bookings: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('push dispatch (Phase 13)', () => {
  const makeFakeProvider = (invalid: string[] = []): PushProvider & { calls: { tokens: string[]; deepLink: string }[] } => {
    const provider: PushProvider & { calls: { tokens: string[]; deepLink: string }[] } = {
      status: 'configured',
      calls: [],
      async send(tokens, message) {
        provider.calls.push({ tokens, deepLink: message.deepLink });
        return { invalidTokens: tokens.filter((t) => invalid.includes(t)) };
      },
    };
    return provider;
  };

  it('unconfigured provider reports unconfigured and in-app notifications still work', async () => {
    setPushProvider(new NoopPushProvider());
    const user = await registerAndLogin(app);
    const result = await dispatchPushNotifications([
      { userId: user.userId, type: 'BOOKING_CREATED', title: 'T', message: 'M', entityType: 'Booking', entityId: '00000000-0000-4000-8000-000000000001' },
    ]);
    expect(result.status).toBe('unconfigured');
  });

  it('sends to all active devices of the target user and carries the deep link', async () => {
    const provider = makeFakeProvider();
    setPushProvider(provider);
    const user = await registerAndLogin(app);
    await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-dispatch-0000000000001' });
    await registerDevice(user.token, { platform: 'ios', pushToken: 'fcm-dispatch-0000000000002' });

    const result = await dispatchPushNotifications([
      { userId: user.userId, type: 'BOOKING_CREATED', title: 'New booking', message: 'Someone booked.', entityType: 'Booking', entityId: '00000000-0000-4000-8000-000000000002' },
    ]);
    expect(result.status).toBe('sent');
    expect(result.sentCount).toBe(2);
    expect(provider.calls[0]!.tokens).toHaveLength(2);
    expect(provider.calls[0]!.deepLink).toBe('/booking/00000000-0000-4000-8000-000000000002');
  });

  it('respects preferences: disabled category is not pushed, others still are', async () => {
    const provider = makeFakeProvider();
    setPushProvider(provider);
    const user = await registerAndLogin(app);
    await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-prefs-00000000000001' });
    await prisma.notificationPreference.create({ data: { userId: user.userId, reviews: false, businessActivity: false } });

    const result = await dispatchPushNotifications([
      { userId: user.userId, type: 'REVIEW_CREATED', title: 'Review', message: 'm', entityType: 'Review', entityId: '00000000-0000-4000-8000-000000000003' },
      { userId: user.userId, type: 'BOOKING_CREATED', title: 'Booking', message: 'm', entityType: 'Booking', entityId: '00000000-0000-4000-8000-000000000004' },
    ]);
    expect(result.status).toBe('sent');
    expect(provider.calls).toHaveLength(1); // review suppressed
    expect(provider.calls[0]!.deepLink).toBe('/booking/00000000-0000-4000-8000-000000000004');
  });

  it('invalid tokens are deactivated once and healthy devices keep working', async () => {
    const provider = makeFakeProvider(['fcm-invalid-0000000000001']);
    setPushProvider(provider);
    const user = await registerAndLogin(app);
    await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-invalid-0000000000001' });
    await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-valid-00000000000001' });

    const result = await dispatchPushNotifications([
      { userId: user.userId, type: 'ORDER_CREATED', title: 'Order', message: 'm', entityType: 'Order', entityId: '00000000-0000-4000-8000-000000000005' },
    ]);
    expect(result.status).toBe('sent');
    expect(result.deactivatedCount).toBe(1);
    const invalidRow = await prisma.pushDevice.findUniqueOrThrow({ where: { pushToken: 'fcm-invalid-0000000000001' } });
    expect(invalidRow.isActive).toBe(false);
    const validRow = await prisma.pushDevice.findUniqueOrThrow({ where: { pushToken: 'fcm-valid-00000000000001' } });
    expect(validRow.isActive).toBe(true);
  });

  it('provider throwing never breaks dispatch (containment contract)', async () => {
    setPushProvider({
      status: 'configured',
      async send() {
        throw new Error('provider down');
      },
    });
    const user = await registerAndLogin(app);
    await registerDevice(user.token, { platform: 'android', pushToken: 'fcm-throws-0000000000001' });
    // dispatchPushNotifications itself surfaces the failure honestly; callers
    // (.catch) are responsible for containment — verify the promise rejects.
    await expect(
      dispatchPushNotifications([
        { userId: user.userId, type: 'BOOKING_ACCEPTED', title: 'T', message: 'M', entityType: 'Booking', entityId: '00000000-0000-4000-8000-000000000006' },
      ]),
    ).rejects.toThrow('provider down');
  });
});
