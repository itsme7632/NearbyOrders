import { useEffect, useRef } from 'react';
import { getSession, registerPushDevice, type Session } from './api.js';
import { onPushTap, registerForPush } from './push.js';

/**
 * Phase 13: push registration lifecycle for the signed-in user.
 *
 * - Runs only for authenticated sessions (an appropriate, non-first-screen
 *   moment: the user has already chosen to use the product).
 * - Never blocks and never navigates: a denied permission or a missing native
 *   runtime leaves the app fully functional (in-app notifications unaffected).
 * - Registers once per session; FCM tokens are stable per app install, and
 *   the API deduplicates by token.
 * - Logout deactivates this device's registration server-side, so a shared
 *   device stops receiving the previous user's pushes.
 */
export function usePushRegistration(onDeepLink: (link: string) => void): void {
  const registeredFor = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(getSession());
  sessionRef.current = getSession();

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (registeredFor.current === session.user.id) return;
    registeredFor.current = session.user.id;

    let cancelled = false;
    void (async () => {
      const outcome = await registerForPush();
      if (cancelled) return;
      if (outcome.status === 'registered') {
        await registerPushDevice({ platform: outcome.platform, pushToken: outcome.token }).catch(() => undefined);
      }
      // denied / unavailable / error: silent. In-app notifications keep working.
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Notification tap → deep link (background/terminated launches included).
  useEffect(() => {
    let off: (() => void) | undefined;
    void onPushTap((link) => onDeepLink(link)).then((unsub) => {
      off = unsub;
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
