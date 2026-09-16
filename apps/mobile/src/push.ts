import { isNativePlatform } from './platform.js';

/**
 * Phase 13: push notification registration.
 *
 * Mirrors the location service's philosophy: the native capability is
 * OPTIONAL and every failure is honest. The app is fully usable when the
 * user denies notification permission — in-app notifications are the source
 * of history and always work.
 *
 * On Capacitor (Android today; iOS through the same plugin when the Apple
 * credentials exist) this delegates to @capacitor/push-notifications. On the
 * plain web build it reports `unavailable` rather than pretending. The
 * dynamic import keeps the plugin out of the web bundle entirely.
 */

export type PushRegistrationOutcome =
  | { status: 'registered'; token: string; platform: 'android' | 'ios' }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

/** Registration is a pure side-effect seam for tests. */
type PushPluginLike = {
  checkPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }>;
  register(): Promise<void>;
  addListener(event: 'registration', cb: (value: { value: string }) => void): Promise<unknown>;
  addListener(event: 'registrationError', cb: (error: { error: string }) => void): Promise<unknown>;
  addListener(event: 'pushNotificationReceived', cb: (notification: unknown) => void): Promise<unknown>;
  addListener(event: 'pushNotificationActionPerformed', cb: (notification: { notification: { data?: { deepLink?: string } } }) => void): Promise<PluginListenerHandleLike>;
  removeAllListeners(): Promise<void>;
};

type PushPluginModule = { PushNotifications: PushPluginLike };

type PluginListenerHandleLike = { remove: () => Promise<void> | void };

/** Overridable for tests (jsdom has no Capacitor runtime). */
let pluginLoaderOverride: (() => Promise<PushPluginModule>) | null = null;
export const setPushPluginLoader = (loader: (() => Promise<PushPluginModule>) | null) => {
  pluginLoaderOverride = loader;
};

const loadPlugin = async (): Promise<PushPluginModule> => {
  if (pluginLoaderOverride) return pluginLoaderOverride();
  return (await import('@capacitor/push-notifications')) as PushPluginModule;
};

export const pushPlatform = (): 'android' | 'ios' | 'web' => {
  if (!isNativePlatform()) return 'web';
  // Capacitor exposes the platform identity without importing the plugin.
  const cap = (globalThis as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = cap?.getPlatform?.();
  return p === 'ios' ? 'ios' : 'android';
};

/**
 * Requests permission (only when the caller decides it is appropriate),
 * registers with FCM and resolves the device token. One registration per
 * call; the API deduplicates by token.
 */
export const registerForPush = async (onReceived?: (notification: unknown) => void): Promise<PushRegistrationOutcome> => {
  const platform = pushPlatform();
  if (platform === 'web') return { status: 'unavailable' };
  try {
    const { PushNotifications } = await loadPlugin();

    const check = await PushNotifications.checkPermissions();
    let receive = check.receive;
    if (receive !== 'granted') {
      // Requesting happens only when the caller reached an appropriate moment.
      const request = await PushNotifications.requestPermissions();
      receive = request.receive;
    }
    if (receive !== 'granted') return { status: 'denied' };

    const token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Push registration timed out')), 30_000);
      void PushNotifications.addListener('registration', (value) => {
        clearTimeout(timer);
        resolve(value.value);
      });
      void PushNotifications.addListener('registrationError', (error) => {
        clearTimeout(timer);
        reject(new Error(error.error || 'Push registration failed'));
      });
      void PushNotifications.register();
    });

    if (onReceived) {
      void PushNotifications.addListener('pushNotificationReceived', (notification) => onReceived(notification));
    }

    return { status: 'registered', token, platform };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Push registration failed' };
  }
};

/** tap deep link from a notification that LAUNCHED or RESUMED the app. */
export const onPushTap = async (handler: (deepLink: string) => void): Promise<() => void> => {
  const platform = pushPlatform();
  if (platform === 'web') return () => undefined;
  try {
    const { PushNotifications } = await loadPlugin();
    const handle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const deepLink = action.notification.data?.deepLink;
      if (typeof deepLink === 'string' && deepLink.startsWith('/')) handler(deepLink);
    });
    return () => void handle.remove();
  } catch {
    return () => undefined;
  }
};
