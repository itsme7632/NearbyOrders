import { useCallback, useEffect, useState } from 'react';
import { getSession, getUnreadCount, onSessionChange } from './api.js';

/**
 * Unread notification count for the signed-in user.
 *
 * Refresh policy for V1 (no sockets): app open, window focus, and manual
 * `refresh()` after relevant mutations. Cleared immediately on logout so one
 * account's badge never bleeds into another's on a shared device.
 */
export function useUnreadNotifications(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    const session = getSession();
    if (!session) {
      setCount(0);
      return;
    }
    getUnreadCount()
      .then((r) => setCount(r.count))
      .catch(() => setCount(0));
  }, []);

  useEffect(() => {
    refresh();
    const offSession = onSessionChange(() => refresh());
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      offSession();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { count, refresh };
}
