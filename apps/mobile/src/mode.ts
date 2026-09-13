import { useEffect, useState } from 'react';
import { getSession, onSessionChange, type Session } from './api.js';

/**
 * App context: CUSTOMER or BUSINESS.
 *
 * One authenticated account can act in either context — a business owner is
 * still a person who can order lunch from another business. The context only
 * changes WHICH experience the app shows (navigation, screens, datasets); it
 * never changes ownership or permissions, which stay server-enforced.
 */
export type AppMode = 'CUSTOMER' | 'BUSINESS';

const STORAGE_KEY = 'nearbyorders.mode';

function loadMode(): AppMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'BUSINESS' ? 'BUSINESS' : 'CUSTOMER';
  } catch {
    return 'CUSTOMER';
  }
}

let mode: AppMode = loadMode();
const listeners = new Set<(m: AppMode) => void>();

/** Business mode only makes sense for owners; anything else stays customer. */
function sanitize(next: AppMode, session: Session | null): AppMode {
  if (next === 'BUSINESS' && session?.user.role !== 'BUSINESS_OWNER') return 'CUSTOMER';
  return next;
}

function persist(next: AppMode): void {
  mode = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode / storage disabled: in-memory only */
  }
  for (const listener of listeners) listener(next);
}

export function getAppMode(): AppMode {
  return mode;
}

/** Switches context; callers react through useAppMode(). */
export function setAppMode(next: AppMode, session: Session | null = getSession()): void {
  persist(sanitize(next, session));
}

/** Called on sign-out/sign-in so a stale context never leaks across accounts. */
export function syncModeWithSession(session: Session | null): void {
  persist(sanitize(mode, session));
}

/** React binding: re-renders whenever the active context changes. */
export function useAppMode(): { mode: AppMode; setMode: (m: AppMode) => void } {
  const [current, setCurrent] = useState<AppMode>(mode);
  useEffect(() => {
    const update = (m: AppMode) => setCurrent(m);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return { mode: current, setMode: (m) => setAppMode(m) };
}

/** Registers session sync once for the app (idempotent). */
export function initModeSessionSync(): () => void {
  return onSessionChange((session) => syncModeWithSession(session));
}
