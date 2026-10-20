/**
 * Shared customer location state: ONE authoritative store for the whole app.
 *
 * Why a module store + useSyncExternalStore (root-cause fix, 2026-10-20):
 * the previous version of this hook kept React state per component and ran
 * the async restore inside the FIRST mounted component's effect, guarded by
 * that component's `mounted` ref. If that screen unmounted before the restore
 * promise settled, the restored coordinates were silently dropped and no
 * other screen ever retried, so the app flipped between "Set your location"
 * and "Near you" depending on navigation timing. Screens also held divergent
 * snapshots of the same logical state.
 *
 * Now the store lives outside React:
 * - Every screen subscribes to the same snapshot.
 * - Restore runs once, independent of any component's lifecycle; its result
 *   always lands in the store.
 * - Saved coordinates seed the store synchronously (first paint is correct).
 * - The async permission verification only clears them when the OS reports
 *   permission DENIED. An inconclusive check ('prompt', plugin error) keeps
 *   them: an unverifiable check is not proof the grant was revoked.
 * - A failed background refresh NEVER clears valid coordinates and never
 *   raises a notice. Only a newer successful fix replaces them.
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  acquirePosition,
  checkLocationPermissionState,
  clearCustomerCoords,
  loadCustomerCoords,
  locationOutcomeHint,
  saveCustomerCoords,
} from './location.js';

type Coords = { lat: number; lng: number };

export type SharedLocation = {
  coords: Coords | null;
  locating: boolean;
  locNotice: string | null;
  /** True when we have coordinates (restored or fresh). */
  hasLocation: boolean;
  /** Request a fresh GPS fix (user-initiated, e.g. "tap to retry"). */
  requestLocation: () => void;
  /** Disable nearby mode: clears coords and persistence. */
  clearLocation: () => void;
};

type StoreState = {
  coords: Coords | null;
  locating: boolean;
  locNotice: string | null;
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let state: StoreState = {
  coords: loadCustomerCoords(),
  locating: false,
  locNotice: null,
};
const listeners = new Set<() => void>();
let restoreStarted = false;

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureRestore();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreState {
  return state;
}

/**
 * One-time startup sequence, decoupled from any component:
 * 1. If saved coords exist, verify the OS permission is still granted; clear
 *    ONLY on an explicit denial.
 * 2. Kick off a background GPS refresh; success replaces the coords, failure
 *    changes nothing (no clear, no notice).
 */
function ensureRestore() {
  if (restoreStarted) return;
  restoreStarted = true;
  void (async () => {
    if (state.coords) {
      try {
        const perm = await checkLocationPermissionState();
        if (perm === 'denied') {
          clearCustomerCoords();
          setState({ coords: null });
          return;
        }
      } catch {
        // Inconclusive check: keep the saved coords.
      }
      // Only a device that has granted before (proven by the saved fix) gets
      // a background refresh; a fresh install must never trigger a
      // permission prompt without a user action.
      const outcome = await acquirePosition(20000);
      if (outcome.status === 'granted' && outcome.coords) {
        saveCustomerCoords(outcome.coords);
        setState({ coords: outcome.coords, locNotice: null });
      }
    }
  })();
}

function requestLocation() {
  setState({ locating: true, locNotice: null });
  void (async () => {
    const outcome = await acquirePosition(20000);
    if (outcome.status === 'granted' && outcome.coords) {
      saveCustomerCoords(outcome.coords);
      setState({ coords: outcome.coords, locating: false, locNotice: null });
    } else {
      const hint = locationOutcomeHint(outcome);
      // Do NOT clear existing coords on a failed refresh.
      setState({ locating: false, locNotice: hint });
    }
  })();
}

function clearLocation() {
  clearCustomerCoords();
  setState({ coords: null, locNotice: null });
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useSharedLocation(): SharedLocation {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const request = useCallback(() => requestLocation(), []);
  const clear = useCallback(() => clearLocation(), []);
  return {
    coords: snap.coords,
    locating: snap.locating,
    locNotice: snap.locNotice,
    hasLocation: snap.coords !== null,
    requestLocation: request,
    clearLocation: clear,
  };
}

/** Reset the store (tests only). */
export function __resetSharedLocationForTests() {
  state = { coords: loadCustomerCoords(), locating: false, locNotice: null };
  restoreStarted = false;
  listeners.clear();
}
