/**
 * Shared customer location state.
 *
 * Home, Explore, and Search previously each kept their own `coords` useState,
 * so one screen could show "Near you" while another showed "Set your location"
 * after the same grant. This hook provides a single source of truth:
 *
 * - On mount, restores persisted coordinates (only if OS permission is still
 *   granted) and kicks off a background refresh for a fresh fix.
 * - All screens read the same coords/locating/notice state.
 * - Successful acquisitions persist; failures set a retry notice without
 *   silently clearing valid coords.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acquirePosition,
  checkLocationPermissionState,
  clearCustomerCoords,
  loadCustomerCoords,
  locationOutcomeHint,
  restoreCustomerCoords,
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

// Module-level cache so the state survives screen remounts within a session.
// The hook still uses React state for reactivity; this just seeds it.
let cachedCoords: Coords | null | undefined;
let restoreAttempted = false;

export function useSharedLocation(): SharedLocation {
  const [coords, setCoords] = useState<Coords | null>(() => {
    if (cachedCoords !== undefined) return cachedCoords;
    // First mount: try the synchronous localStorage read. The async
    // permission check happens in the effect below.
    const saved = loadCustomerCoords();
    cachedCoords = saved;
    return saved;
  });
  const [locating, setLocating] = useState(false);
  const [locNotice, setLocNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // On first mount: verify the OS permission is still granted for the
  // restored coords; if not, clear them. Then kick off a background refresh
  // so a stale fix gets replaced by a fresh one without blocking the UI.
  useEffect(() => {
    if (restoreAttempted) return;
    restoreAttempted = true;
    (async () => {
      const restored = await restoreCustomerCoords();
      if (!mounted.current) return;
      if (restored) {
        cachedCoords = restored;
        setCoords(restored);
        setLocNotice(null);
        // Background refresh: don't show "Locating…" for this, the restored
        // coords are already usable.
        const outcome = await acquirePosition(20000);
        if (!mounted.current) return;
        if (outcome.status === 'granted' && outcome.coords) {
          cachedCoords = outcome.coords;
          setCoords(outcome.coords);
          saveCustomerCoords(outcome.coords);
        }
        // A failed background refresh never clears valid restored coords
        // and never shows a notice — the user already has a working location.
      } else {
        // No valid restored coords (or permission revoked): clear everything
        // so no screen shows a stale "Near you".
        cachedCoords = null;
        setCoords(null);
      }
    })();
  }, []);

  const requestLocation = useCallback(() => {
    setLocating(true);
    setLocNotice(null);
    (async () => {
      const outcome = await acquirePosition(20000);
      if (!mounted.current) return;
      setLocating(false);
      if (outcome.status === 'granted' && outcome.coords) {
        cachedCoords = outcome.coords;
        setCoords(outcome.coords);
        saveCustomerCoords(outcome.coords);
        setLocNotice(null);
      } else {
        const hint = locationOutcomeHint(outcome);
        if (hint) setLocNotice(hint);
        // Do NOT clear existing coords on a failed refresh — a timeout is
        // not proof the saved location is wrong.
      }
    })();
  }, []);

  const clearLocation = useCallback(() => {
    cachedCoords = null;
    setCoords(null);
    setLocNotice(null);
    clearCustomerCoords();
  }, []);

  return {
    coords,
    locating,
    locNotice,
    hasLocation: coords !== null,
    requestLocation,
    clearLocation,
  };
}

/** Reset module state (tests only). */
export function __resetSharedLocationForTests() {
  cachedCoords = undefined;
  restoreAttempted = false;
}
