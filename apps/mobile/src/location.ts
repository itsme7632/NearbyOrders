import type { PermissionState } from '@capacitor/core';

/**
 * Phase 11 customer location service.
 *
 * Customer location is always OPTIONAL: nothing in the app depends on it, and
 * a denied/unavailable permission leaves normal discovery fully functional.
 * No location is ever invented — when we cannot obtain a real fix we report
 * `unavailable` and the UI simply hides distance/nearby features.
 *
 * The acquisition layer is abstracted at one seam (`acquirePosition`): on
 * Capacitor it delegates to the Capacitor Geolocation plugin (web fallback is
 * built into the plugin), and on the plain web it uses the standard
 * navigator.geolocation API directly.
 */

/** Outcome of a location request. `coords` only exists on `granted`. */
export type LocationOutcome =
  | { status: 'granted'; coords: { lat: number; lng: number } }
  | { status: 'denied' }
  | { status: 'permanently-denied' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

/** True for both denial states: the calm "location off" card + retry applies. */
export const isDeniedOutcome = (outcome: LocationOutcome): boolean =>
  outcome.status === 'denied' || outcome.status === 'permanently-denied';

/** User-facing explanation for each non-granted outcome (no fake data ever). */
export const locationOutcomeHint = (outcome: LocationOutcome): string | null => {
  switch (outcome.status) {
    case 'granted':
      return null;
    case 'denied':
      return 'Location permission was denied. You can still browse all businesses.';
    case 'permanently-denied':
      return 'Location is turned off for NearbyOrders. Enable it in your device settings to see nearby businesses.';
    case 'unavailable':
      return 'Location is not available on this device.';
    case 'error':
      return outcome.message;
  }
};

type MinimalGeolocationError = { code: number };
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

/** Standard navigator.geolocation wrapper (web browsers and jsdom tests). */
const acquireViaNavigator = (timeoutMs: number): Promise<LocationOutcome> =>
  new Promise((resolve) => {
    const geo = (globalThis as { navigator?: { geolocation?: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void, err: (e: MinimalGeolocationError) => void, opts?: { timeout?: number }) => void } } }).navigator;
    if (!geo?.geolocation) {
      resolve({ status: 'unavailable' });
      return;
    }
    geo.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // A non-finite fix is not a location — reporting it as granted would
        // fabricate nearby results. Treat it as unavailable.
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          resolve({ status: 'unavailable' });
          return;
        }
        resolve({ status: 'granted', coords: { lat: latitude, lng: longitude } });
      },
      (err) => {
        if (err.code === PERMISSION_DENIED) resolve({ status: 'denied' });
        else if (err.code === POSITION_UNAVAILABLE) resolve({ status: 'unavailable' });
        else resolve({ status: 'error', message: 'Could not determine your location. Please try again.' });
      },
      { timeout: timeoutMs },
    );
  });

/**
 * Acquires a one-shot position. Overridable in tests; the Capacitor branch
 * keeps a thin seam so the plugin can be mocked without importing it in jsdom.
 */
export type PositionAcquirer = (timeoutMs: number) => Promise<LocationOutcome>;

type PermissionStatus = { location: PermissionState; coarseLocation: PermissionState };

/**
 * Minimal surface of the Capacitor Geolocation plugin used here. A structural
 * type (instead of importing the plugin) keeps this unit-testable in jsdom.
 */
export type CapacitorGeolocationLike = {
  checkPermissions: () => Promise<PermissionStatus>;
  requestPermissions: () => Promise<PermissionStatus>;
  getCurrentPosition: (opts?: { timeout?: number }) => Promise<{ coords: { latitude: number; longitude: number } }>;
};

/**
 * Either alias granted is enough for a fix: on Android 12+ the user may grant
 * approximate (coarse) location while denying precise (fine) location.
 */
const hasFixPermission = (s: PermissionStatus): boolean => s.location === 'granted' || s.coarseLocation === 'granted';

/** True when the OS can still show the runtime permission prompt. */
const canStillPrompt = (s: PermissionStatus): boolean =>
  s.location === 'prompt' ||
  s.location === 'prompt-with-rationale' ||
  s.coarseLocation === 'prompt' ||
  s.coarseLocation === 'prompt-with-rationale';

/**
 * Classifies a Capacitor Geolocation failure. The plugin's stable `code`
 * (e.g. OS-PLUG-GLOC-0003) takes precedence; the message is only a fallback,
 * so a reworded native message cannot silently change the outcome.
 */
const classifyPluginFailure = (e: unknown): LocationOutcome => {
  const codeValue = (e as { code?: unknown } | null)?.code;
  const code = typeof codeValue === 'string' ? codeValue : '';
  const messageValue = (e as { message?: unknown } | null)?.message;
  const message = (e instanceof Error ? e.message : String(messageValue ?? e ?? '')).toLowerCase();

  // Build defect, not a user decision: the native manifest does not declare
  // the location permissions, so no prompt can ever appear. Report it
  // honestly instead of blaming the user with a "denied" card.
  if (code === 'OS-PLUG-GLOC-0018' || message.includes('not declared in manifest')) {
    return { status: 'error', message: 'Location is not set up in this build of the app. Please update and try again.' };
  }
  // The user refused the permission (or the request to enable location).
  if (code === 'OS-PLUG-GLOC-0003' || code === 'OS-PLUG-GLOC-0009' || message.includes('denied')) {
    return { status: 'denied' };
  }
  // No fix is obtainable right now: location services off, no providers,
  // timeout, Play Services/settings problems — never a fabricated position.
  if (
    code === 'OS-PLUG-GLOC-0002' ||
    code === 'OS-PLUG-GLOC-0007' ||
    code === 'OS-PLUG-GLOC-0010' ||
    code === 'OS-PLUG-GLOC-0014' ||
    code === 'OS-PLUG-GLOC-0015' ||
    code === 'OS-PLUG-GLOC-0016' ||
    code === 'OS-PLUG-GLOC-0017' ||
    message.includes('unavailable') ||
    message.includes('not available') ||
    message.includes('not enabled') ||
    message.includes('disabled') ||
    message.includes('timeout') ||
    message.includes('in time')
  ) {
    return { status: 'unavailable' };
  }
  if (message.includes('permission')) return { status: 'denied' };
  return { status: 'error', message: 'Could not determine your location. Please try again.' };
};

/**
 * Explicit native permission flow: check the current state first, request the
 * permission only when the OS can show a prompt, then read the position.
 *
 * Denied (the user said no just now — a retry may prompt again) and
 * permanently-denied (the OS will not show a prompt anymore — the user must
 * enable it in Settings) are distinct outcomes so the UI can guide
 * accordingly. Retrying re-runs this whole flow, so enabling the permission
 * in Settings and tapping retry genuinely recovers.
 *
 * Exported for tests; production passes the real plugin (see acquirePosition).
 */
export const acquireViaCapacitorPlugin = async (
  geo: CapacitorGeolocationLike,
  timeoutMs: number,
): Promise<LocationOutcome> => {
  let status: PermissionStatus;
  try {
    // Throws when location services are disabled — that is "unavailable",
    // not a permission decision.
    status = await geo.checkPermissions();
  } catch (e) {
    return classifyPluginFailure(e);
  }

  if (!hasFixPermission(status)) {
    // Never re-prompt when the OS will not show one: on Android that call is
    // a silent no-op and the user would be stuck on the denied card forever.
    if (!canStillPrompt(status)) return { status: 'permanently-denied' };
    try {
      status = await geo.requestPermissions();
    } catch (e) {
      return classifyPluginFailure(e);
    }
    if (!hasFixPermission(status)) {
      return canStillPrompt(status) ? { status: 'denied' } : { status: 'permanently-denied' };
    }
  }

  try {
    const pos = await geo.getCurrentPosition({ timeout: timeoutMs });
    const { latitude, longitude } = pos.coords;
    // A non-finite fix is not a location — reporting it as granted would
    // fabricate nearby results. Treat it as unavailable.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { status: 'unavailable' };
    return { status: 'granted', coords: { lat: latitude, lng: longitude } };
  } catch (e) {
    return classifyPluginFailure(e);
  }
};

export const acquirePosition: PositionAcquirer = async (timeoutMs) => {
  // Capacitor native: dynamic import keeps the plugin out of the web bundle
  // and lets jsdom tests run without a native bridge.
  try {
    const mod = (await import('@capacitor/core')) as {
      Capacitor: { isNativePlatform?: () => boolean };
    };
    if (mod.Capacitor.isNativePlatform?.()) {
      const plugin = (await import('@capacitor/geolocation')) as {
        Geolocation: CapacitorGeolocationLike;
      };
      return acquireViaCapacitorPlugin(plugin.Geolocation, timeoutMs);
    }
  } catch {
    /* @capacitor/core not resolvable (plain web/test) — fall through. */
  }
  return acquireViaNavigator(timeoutMs);
};

/** Requests the customer's location once. Optional by design — never throws.
 *  The acquirer is injectable for tests; production always uses acquirePosition. */
export const requestCustomerLocation = (
  timeoutMs = 8000,
  acquirer: PositionAcquirer = acquirePosition,
): Promise<LocationOutcome> =>
  acquirer(timeoutMs).catch(() => ({
    status: 'error' as const,
    message: 'Could not determine your location. Please try again.',
  }));

/* --------------------------- distance display --------------------------- */

/** Formats a server-computed distance (km) as a human-readable string. */
export const formatDistanceKm = (distanceKm: number): string | null =>
  Number.isFinite(distanceKm) && distanceKm >= 0
    ? distanceKm >= 1
      ? `${distanceKm.toFixed(1)} km`
      : `${Math.round(distanceKm * 1000)} m`
    : null;

/** True when the business has real configured coordinates (never invented). */
export const hasCoordinates = (b: { latitude?: unknown; longitude?: unknown }): boolean =>
  b.latitude !== null &&
  b.latitude !== undefined &&
  b.longitude !== null &&
  b.longitude !== undefined;

/** Deep link into an external maps provider. Address fallback keeps directions usable pre-geocode. */
export const directionsUrl = (b: { latitude?: number | null; longitude?: number | null; address?: string; city?: string }): string | null => {
  if (hasCoordinates(b)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(b.latitude)},${Number(b.longitude)}`;
  }
  const place = [b.address, b.city].filter(Boolean).join(', ');
  return place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null;
};
