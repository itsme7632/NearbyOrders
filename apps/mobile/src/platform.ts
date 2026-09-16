/**
 * Platform identity for native-optional features (Phase 11 geolocation,
 * Phase 13 push). On the plain web build everything Capacitor-specific is
 * skipped honestly — no fake native behavior.
 *
 * Read through globalThis (=== window in browsers and Capacitor webviews)
 * so module loading never depends on `window` existing at import time.
 */
export const isNativePlatform = (): boolean => {
  const g = globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return g.Capacitor?.isNativePlatform?.() ?? false;
};
