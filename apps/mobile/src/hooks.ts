import { useCallback, useEffect, useState } from 'react';
import { parseHash, type Route } from './navigation.js';
import { ApiError } from './api.js';

/** Hash router with push/replace/back support. */
export function useRoute(): [Route, (to: string) => void, () => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const push = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const back = useCallback(() => {
    window.history.back();
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
