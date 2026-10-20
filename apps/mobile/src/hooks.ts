import { useCallback, useEffect, useRef, useState } from 'react';
import { parseHash, isRouteHash, type Route } from './navigation.js';
import { ApiError } from './api.js';

const LAST_ROUTE_KEY = 'no_last_route';

/**
 * Routes worth restoring after a WebView recreation: in-progress flows the
 * user reached by tapping a business. Root-cause fix (2026-10-20): actions
 * on Business Detail that leave the app (Call dialer, Directions maps,
 * system Share sheet) can get the Android activity/WebView destroyed while
 * backgrounded; on return Capacitor reloads the start URL with an empty
 * hash and the user landed on Home despite never navigating away. The tab
 * root and auth/owner flows are deliberately NOT restored.
 */
export function restorableRoute(hash: string): string | null {
  const route = parseHash(hash);
  return route.name === 'business' || route.name === 'book' ? hash : null;
}

/** Hash router with push/replace/back support. */
export function useRoute(): [Route, (to: string) => void, () => void] {
  const [route, setRoute] = useState<Route>(() => {
    const current = window.location.hash;
    if (parseHash(current).name === 'tabs') {
      try {
        const saved = window.sessionStorage.getItem(LAST_ROUTE_KEY);
        if (saved && restorableRoute(saved)) {
          window.history.replaceState(null, '', saved);
          return parseHash(saved);
        }
      } catch {
        /* storage unavailable: fall through to the parsed root */
      }
    }
    return parseHash(current);
  });
  // The last hash that parsed to a REAL route. A stray fragment (in-page
  // anchor, WebView fragment residue) is repaired back to this value
  // instead of being routed: parseHash's tabs fallthrough would otherwise
  // turn ANY unrecognized fragment into a trip Home, mid-interaction.
  const lastGoodHash = useRef<string>(window.location.hash);
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (!isRouteHash(hash)) {
        window.history.replaceState(null, '', lastGoodHash.current || '#/');
        return;
      }
      lastGoodHash.current = hash;
      try {
        if (restorableRoute(hash)) window.sessionStorage.setItem(LAST_ROUTE_KEY, hash);
        else window.sessionStorage.removeItem(LAST_ROUTE_KEY);
      } catch {
        /* storage unavailable: routing still works, restore just won't */
      }
      setRoute(parseHash(hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const push = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const back = useCallback(() => {
    // A cold-launched deep link (push notification, restored session, shared
    // URL) has no in-app history behind it: history.back() would exit the app
    // outright. Fall back to the home route so back always lands on a real
    // screen instead of closing the app.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = '/';
    }
  }, []);

  return [route, push, back];
}

export type AsyncState<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

/** Fetches async data with loading/error states and a manual reload. */
export function useAsyncData<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
