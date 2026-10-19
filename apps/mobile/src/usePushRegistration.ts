import { useCallback, useEffect, useRef, useState } from 'react';
import { getSession, registerPushDevice, type Session } from './api.js';
import {
  checkPushPermission,
  onForegroundPush,
  onPushTap,
  registerForPush,
  requestPushPermission,
  type ForegroundPush,
} from './push.js';

/** localStorage key for this device's server-side PushDevice id (per user). */
export const PUSH_DEVICE_ID_KEY = 'no_push_device_id';

export type PushPermissionState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unavailable';

/**
 * Push registration lifecycle for the signed-in user.
 *
 * - Session start does a SILENT permission check: when already granted we
 *   register in the background; otherwise we do NOT prompt. The app waits
 *   for a contextual moment (see PushPermissionCard) instead of ambushing.
 * - `requestPermission()` is for that contextual moment: it explains first
 *   (the caller's UI), asks the OS once, and registers on grant.
 * - Denial is graceful: in-app notifications keep working; nothing retries
 *   on a timer.
 * - Registers once per session; the API deduplicates by token, and a fresh
 *   FCM token is re-registered automatically via the registration listener.
 * - Logout deactivates this device's registration server-side (see api.ts
 *   logout()), so a shared device stops receiving the previous user's pushes.
 */
export function usePushRegistration(opts: {
  onDeepLink: (link: string) => void;
  onForegroundNotification: (push: ForegroundPush) => void;
  /** Current session; when it changes (sign-in/out) the permission check re-runs. */
  session: Session | null;
}): { permission: PushPermissionState; requestPermission: () => Promise<boolean> } {
  const [permission, setPermission] = useState<PushPermissionState>('unknown');
  const registeredFor = useRef<string | null>(null);
  const sessionUserId = opts.session?.user.id ?? null;
  const sessionRef = useRef<Session | null>(getSession());
  sessionRef.current = getSession();
  const deepLinkRef = useRef(opts.onDeepLink);
  deepLinkRef.current = opts.onDeepLink;
  const foregroundRef = useRef(opts.onForegroundNotification);
  foregroundRef.current = opts.onForegroundNotification;

  const registerToken = useCallback(async (session: Session) => {
    const outcome = await registerForPush();
    if (outcome.status === 'registered') {
      try {
        const device = await registerPushDevice({ platform: outcome.platform, pushToken: outcome.token });
        // Remember which server-side device belongs to THIS app install so
        // logout can deactivate exactly it (best effort, never fatal).
        if (device && typeof device.id === 'string') {
          try {
            localStorage.setItem(PUSH_DEVICE_ID_KEY, device.id);
          } catch {
            /* storage unavailable: logout simply skips deactivation */
          }
        }
      } catch {
        /* network failure: token stays server-side from a previous register */
      }
    }
  }, []);

  // Silent session-start check: register only when permission is already granted.
  // Re-runs when the session changes so a sign-in after app start is handled.
  useEffect(() => {
    const session = opts.session;
    if (!session) {
      registeredFor.current = null;
      return;
    }
    if (registeredFor.current === session.user.id) return;
    registeredFor.current = session.user.id;

    let cancelled = false;
    void (async () => {
      const state = await checkPushPermission();
      if (cancelled) return;
      setPermission(state);
      if (state === 'granted') {
        await registerToken(session);
      }
      // prompt/denied/unavailable: silent. The contextual prompt handles it.
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerToken, sessionUserId]);

  // Contextual permission request (user tapped "Enable notifications").
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    const result = await requestPushPermission();
    setPermission(result);
    if (result === 'granted' && session) {
      await registerToken(session);
      return true;
    }
    return false;
  }, [registerToken]);

  // Notification tap: deep link (background/terminated launches included).
  useEffect(() => {
    let off: (() => void) | undefined;
    void onPushTap((link) => deepLinkRef.current(link)).then((unsub) => {
      off = unsub;
    });
    return () => off?.();
  }, []);

  // Foreground notification: in-app banner (the OS shows nothing when the
  // app is open, so we surface it ourselves).
  useEffect(() => {
    let off: (() => void) | undefined;
    void onForegroundPush((push) => foregroundRef.current(push)).then((unsub) => {
      off = unsub;
    });
    return () => off?.();
  }, []);

  return { permission, requestPermission };
}
