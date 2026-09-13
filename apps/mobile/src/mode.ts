import { useEffect, useState } from 'react';
import { getMyBusinesses, getSession, onSessionChange, type Session } from './api.js';

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

/**
 * Resolves the mode a signed-in user should open in.
 *
 * Business owners land directly in BUSINESS mode: their business IS their app,
 * and requiring an extra "Manage my business" tap buried their work behind the
 * customer home. Everyone else (and owners with no businesses at all) gets the
 * customer experience. Ownership is whatever the server currently returns, so
 * an owner whose businesses were all removed falls back to Customer mode.
 * Explicit in-session switches still work: the default only applies when a
 * session starts (login), never mid-session.
 */
export async function resolveDefaultMode(session: Session | null): Promise<AppMode> {
  if (!session) return 'CUSTOMER';
  if (session.user.role !== 'BUSINESS_OWNER') return 'CUSTOMER';
  try {
    const businesses = await getMyBusinesses();
    return businesses.length > 0 ? 'BUSINESS' : 'CUSTOMER';
  } catch {
    // Ownership check failed (offline, 401, etc.): open the customer app; the
    // header's "My business" button still reaches Business mode in one tap.
    return 'CUSTOMER';
  }
}

/**
 * Applies the ownership-aware default when a session starts (login or app
 * mount with a live session). Deliberately unconditional: a stale stored
 * choice from a PREVIOUS session must never override the fresh default, so an
 * owner always opens in Business mode after logging in. Switching modes after
 * that is an explicit in-session action and stays sticky until the next
 * login. Callers show a neutral loading state until this settles so an owner
 * never glimpses the customer home before their business dashboard appears.
 */
export async function applyDefaultModeForSession(session: Session | null): Promise<void> {
  setAppMode(await resolveDefaultMode(session), session);
}
