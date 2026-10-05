import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  checkPushPermission,
  onForegroundPush,
  requestPushPermission,
  setPushPluginLoader,
} from '../push.js';

/**
 * Contextual permission + foreground delivery. The plugin loader seam lets
 * these run in node/jsdom with a fake native runtime.
 */

const stubCapacitor = (platform: string) => {
  Object.defineProperty(globalThis, 'Capacitor', {
    configurable: true,
    value: {
      isNativePlatform: () => platform !== 'web',
      getPlatform: () => platform,
    },
  });
};

const originalCapacitor = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');

type ReceivedCb = (n: unknown) => void;

const stubPlugin = (receive: 'granted' | 'denied' | 'prompt', requestReceive: 'granted' | 'denied' = 'granted') => {
  const receivedCbs: ReceivedCb[] = [];
  let requestCalls = 0;
  setPushPluginLoader(async () => ({
    PushNotifications: {
      checkPermissions: async () => ({ receive }),
      requestPermissions: async () => {
        requestCalls += 1;
        return { receive: requestReceive };
      },
      register: async () => undefined,
      addListener: ((event: string, cb: (v: unknown) => void) => {
        if (event === 'pushNotificationReceived') receivedCbs.push(cb);
        return Promise.resolve({ remove: () => undefined });
      }) as never,
      removeAllListeners: async () => undefined,
    },
  }));
  return {
    emitReceived: (n: unknown) => receivedCbs.forEach((cb) => cb(n)),
    requestCalls: () => requestCalls,
  };
};

describe('contextual push permission', () => {
  beforeEach(() => {
    stubCapacitor('android');
    setPushPluginLoader(null);
  });

  afterEach(() => {
    if (originalCapacitor) Object.defineProperty(globalThis, 'Capacitor', originalCapacitor);
    else delete (globalThis as Record<string, unknown>).Capacitor;
    setPushPluginLoader(null);
  });

  it('checkPushPermission reports the OS state WITHOUT prompting', async () => {
    const h = stubPlugin('prompt');
    expect(await checkPushPermission()).toBe('prompt');
    expect(h.requestCalls()).toBe(0);

    stubPlugin('granted');
    expect(await checkPushPermission()).toBe('granted');

    stubPlugin('denied');
    expect(await checkPushPermission()).toBe('denied');
  });

  it('checkPushPermission reports denied (not prompt) on the web build', async () => {
    stubCapacitor('web');
    expect(await checkPushPermission()).toBe('denied');
  });

  it('requestPushPermission asks the OS exactly once and reports honestly', async () => {
    const h = stubPlugin('prompt', 'granted');
    expect(await requestPushPermission()).toBe('granted');
    expect(h.requestCalls()).toBe(1);

    const h2 = stubPlugin('prompt', 'denied');
    expect(await requestPushPermission()).toBe('denied');
    expect(h2.requestCalls()).toBe(1);
  });
});

describe('foreground push delivery', () => {
  beforeEach(() => {
    stubCapacitor('android');
    setPushPluginLoader(null);
  });

  afterEach(() => {
    if (originalCapacitor) Object.defineProperty(globalThis, 'Capacitor', originalCapacitor);
    else delete (globalThis as Record<string, unknown>).Capacitor;
    setPushPluginLoader(null);
  });

  it('normalizes title/body/deepLink from the native event', async () => {
    const h = stubPlugin('granted');
    const seen: unknown[] = [];
    const off = await onForegroundPush((p) => seen.push(p));
    h.emitReceived({
      title: 'Order accepted',
      body: 'Ahmed Auto Workshop accepted your order.',
      data: { deepLink: '/order/ord-123' },
    });
    expect(seen).toEqual([
      {
        title: 'Order accepted',
        body: 'Ahmed Auto Workshop accepted your order.',
        deepLink: '/order/ord-123',
      },
    ]);
    off();
  });

  it('drops deep links that are not app-relative paths (never navigates blindly)', async () => {
    const h = stubPlugin('granted');
    const seen: Array<{ deepLink?: string }> = [];
    await onForegroundPush((p) => seen.push(p));
    h.emitReceived({
      title: 'Hi',
      body: 'x',
      data: { deepLink: 'https://evil.example/phish' },
    });
    expect(seen[0]?.deepLink).toBeUndefined();
  });

  it('falls back to the app name when the native title is missing', async () => {
    const h = stubPlugin('granted');
    const seen: Array<{ title: string; body: string }> = [];
    await onForegroundPush((p) => seen.push(p));
    h.emitReceived({ body: 'Something happened.' });
    expect(seen[0]).toEqual({ title: 'NearbyOrders', body: 'Something happened.' });
  });

  it('is a no-op unsubscribe on the web build', async () => {
    stubCapacitor('web');
    const off = await onForegroundPush(() => {
      throw new Error('must not be called on web');
    });
    expect(() => off()).not.toThrow();
  });
});
