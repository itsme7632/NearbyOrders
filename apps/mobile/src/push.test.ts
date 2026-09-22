import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { onPushTap, pushPlatform, registerForPush, setPushPluginLoader } from './push.js';

/**
 * Phase 13 push registration tests. The plugin loader is the seam: tests
 * install a fake Capacitor push plugin and assert the honest outcomes the
 * real flows produce. jsdom/node have no Capacitor runtime, so the default
 * path is the same "unavailable" a plain web build reports.
 */

const cap = () => (globalThis as unknown as { Capacitor?: Record<string, unknown> }).Capacitor;

const originalCapacitor = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');

/** Installs a fake Capacitor global (native runtime present, given platform). */
const stubCapacitor = (platform: string) => {
  Object.defineProperty(globalThis, 'Capacitor', {
    configurable: true,
    value: {
      isNativePlatform: () => platform !== 'web',
      getPlatform: () => platform,
    },
  });
};

type Harness = {
  emitRegistration: (token: string) => void;
  emitRegistrationError: (message: string) => void;
  emitReceived: (notification: unknown) => void;
  registrationCallCount: () => number;
};

type StubOptions = { receive?: 'granted' | 'denied' | 'prompt'; requestReceive?: 'granted' | 'denied' };

/** Installs a fake @capacitor/push-notifications module and returns a harness. */
const stubPlugin = ({ receive = 'granted', requestReceive = 'granted' }: StubOptions = {}): Harness => {
  const registrationCbs: Array<(v: { value: string }) => void> = [];
  const errorCbs: Array<(e: { error: string }) => void> = [];
  const receivedCbs: Array<(n: unknown) => void> = [];
  let registrations = 0;
  setPushPluginLoader(async () => ({
    PushNotifications: {
      checkPermissions: async () => ({ receive }),
      requestPermissions: async () => ({ receive: requestReceive }),
      register: async () => {
        registrations += 1;
      },
      addListener: ((event: string, cb: (v: unknown) => void) => {
        if (event === 'registration') registrationCbs.push(cb as (v: { value: string }) => void);
        if (event === 'registrationError') errorCbs.push(cb as (e: { error: string }) => void);
        if (event === 'pushNotificationReceived') receivedCbs.push(cb);
        return Promise.resolve({ remove: () => undefined });
      }) as never,
      removeAllListeners: async () => undefined,
    },
  }));
  return {
    emitRegistration: (token) => registrationCbs.forEach((cb) => cb({ value: token })),
    emitRegistrationError: (message) => errorCbs.forEach((cb) => cb({ error: message })),
    emitReceived: (notification) => receivedCbs.forEach((cb) => cb(notification)),
    registrationCallCount: () => registrations,
  };
};

/** Waits for the plugin's register() call (production reaches it after
 *  permission checks + dynamic import, i.e. several microtask hops). */
const waitForRegister = async (harness: Harness) => {
  await vi.waitFor(() => expect(harness.registrationCallCount()).toBe(1), { timeout: 2000 });
};

describe('push registration service (Phase 13)', () => {
  beforeEach(() => {
    vi.resetModules();
    setPushPluginLoader(null);
  });

  afterEach(() => {
    setPushPluginLoader(null);
    if (originalCapacitor) Object.defineProperty(globalThis, 'Capacitor', originalCapacitor);
    else delete (globalThis as { Capacitor?: unknown }).Capacitor;
    vi.restoreAllMocks();
  });

  it('reports unavailable on the plain web build, with no fabricated token', async () => {
    stubCapacitor('web');
    const outcome = await registerForPush();
    expect(outcome.status).toBe('unavailable');
  });

  it('reports unavailable when there is no Capacitor runtime at all', async () => {
    expect(cap()).toBeUndefined();
    const outcome = await registerForPush();
    expect(outcome.status).toBe('unavailable');
  });

  it('identifies the native platform for the device registration payload', () => {
    stubCapacitor('android');
    expect(pushPlatform()).toBe('android');
    stubCapacitor('ios');
    expect(pushPlatform()).toBe('ios');
    stubCapacitor('web');
    expect(pushPlatform()).toBe('web');
  });

  it('registers when permission is granted and resolves the device token', async () => {
    stubCapacitor('android');
    const harness = stubPlugin();
    const pending = registerForPush();
    await waitForRegister(harness);
    harness.emitRegistration('fcm-token-abc');
    const outcome = await pending;
    expect(outcome.status).toBe('registered');
    if (outcome.status === 'registered') {
      expect(outcome.token).toBe('fcm-token-abc');
      expect(outcome.platform).toBe('android');
    }
  });

  it('requests permission when prompted and denies honestly when refused (register never called)', async () => {
    stubCapacitor('android');
    const harness = stubPlugin({ receive: 'prompt', requestReceive: 'denied' });
    const outcome = await registerForPush();
    expect(outcome.status).toBe('denied');
    expect(harness.registrationCallCount()).toBe(0);
  });

  it('maps a registrationError to an error outcome (no throw, no fake token)', async () => {
    stubCapacitor('android');
    const harness = stubPlugin();
    const pending = registerForPush();
    await waitForRegister(harness);
    harness.emitRegistrationError('SERVICE_NOT_AVAILABLE');
    const outcome = await pending;
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.message).toContain('SERVICE_NOT_AVAILABLE');
  });

  it('forwards received foreground notifications to the callback', async () => {
    stubCapacitor('android');
    const harness = stubPlugin();
    const onReceived = vi.fn();
    const pending = registerForPush(onReceived);
    await waitForRegister(harness);
    harness.emitRegistration('fcm-token-abc');
    await pending;
    harness.emitReceived({ title: 'New booking request' });
    expect(onReceived).toHaveBeenCalledWith({ title: 'New booking request' });
  });

  it('delivers a tap deep link that starts with "/" and ignores arbitrary data', async () => {
    stubCapacitor('android');
    let tapCbs: Array<(a: unknown) => void> = [];
    setPushPluginLoader(async () => ({
      PushNotifications: {
        checkPermissions: async () => ({ receive: 'granted' }),
        requestPermissions: async () => ({ receive: 'granted' }),
        register: async () => undefined,
        addListener: ((event: string, cb: unknown) => {
          if (event === 'pushNotificationActionPerformed') tapCbs.push(cb as (a: unknown) => void);
          return Promise.resolve({ remove: () => undefined });
        }) as never,
        removeAllListeners: async () => undefined,
      },
    }));
    const handler = vi.fn();
    const off = await onPushTap(handler);
    tapCbs.forEach((cb) => cb({ notification: { data: { deepLink: '/business/abc/bookings' } } }));
    expect(handler).toHaveBeenCalledWith('/business/abc/bookings');
    tapCbs.forEach((cb) => cb({ notification: { data: { deepLink: 'http://evil.example' } } }));
    expect(handler).toHaveBeenCalledTimes(1);
    tapCbs.forEach((cb) => cb({ notification: {} }));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('returns a no-op unsubscribe on the web instead of throwing', async () => {
    stubCapacitor('web');
    const off = await onPushTap(vi.fn());
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});
