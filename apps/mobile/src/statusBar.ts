/**
 * Android status-bar inset guarantee.
 *
 * Root cause it addresses: Capacitor 8's built-in SystemBars plugin is
 * supposed to inject the real native inset as `--safe-area-inset-top`, but in
 * its non-passthrough path (WebView below v140, or the viewport-fit=cover
 * DOM handshake not completing) it explicitly zeroes the WindowInsets
 * delivered to the WebView — so BOTH the injected `--safe-area-inset-top`
 * and Chromium's `env(safe-area-inset-top)` are 0 — while its compensating
 * native parent-view padding only runs on Android 15+. Net effect on
 * affected devices: the CSS top inset is 0 on every screen and the status
 * bar covers the app header/content.
 *
 * The classic alternative, `StatusBar.setOverlaysWebView({ overlay: false })`,
 * cannot fix this: it toggles deprecated systemUiVisibility flags that are
 * no-ops on Android 15+ (the plugin's own typings say "Not available on
 * Android 15+").
 *
 * What this module does instead: read the REAL status-bar height through
 * `StatusBar.getInfo()`, which is WindowInsets-based
 * (`getCurrentWindowMetrics().getWindowInsets()` on API 30+) and therefore
 * reliable on every Android version and WebView version, and expose it as
 * the `--native-statusbar-height` CSS variable. styles.css consumes it via
 * the `--sat` token:
 *
 *   --sat: max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)),
 *              var(--native-statusbar-height, 0px));
 *
 * In modes where the SystemBars plugin works, max() is a no-op (both sides
 * agree); in the zeroed mode the native measurement supplies the inset.
 * iOS and web never set the variable, so their behavior is unchanged.
 *
 * Never throws, never blocks rendering: call once at startup and forget.
 */

export const NATIVE_STATUS_BAR_VAR = '--native-statusbar-height';

/** Minimal structural surface of @capacitor/core used here. */
type CapacitorLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

/** Minimal structural surface of @capacitor/status-bar used here. */
type StatusBarLike = {
  getInfo?: () => Promise<{ height?: number }>;
};

export type StatusBarDeps = {
  capacitor?: CapacitorLike | null;
  statusBar?: StatusBarLike | null;
};

const loadCapacitor = async (): Promise<CapacitorLike | undefined> => {
  try {
    return (await import('@capacitor/core')).Capacitor as CapacitorLike | undefined;
  } catch {
    return undefined;
  }
};

const loadStatusBar = async (): Promise<StatusBarLike | undefined> => {
  try {
    return (await import('@capacitor/status-bar')).StatusBar as unknown as StatusBarLike | undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reads the real native Android status-bar height in CSS px (== dp).
 * Returns null on web, on non-Android platforms, when the plugin is
 * unavailable, or when it reports no height. Overridable in tests.
 */
export const readNativeStatusBarHeight = async (deps: StatusBarDeps = {}): Promise<number | null> => {
  try {
    const cap = deps.capacitor ?? (await loadCapacitor());
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return null;
    const bar = deps.statusBar ?? (await loadStatusBar());
    if (typeof bar?.getInfo !== 'function') return null;
    const info = await bar.getInfo().catch(() => undefined);
    const height = Number(info?.height);
    return Number.isFinite(height) && height > 0 ? height : null;
  } catch {
    return null;
  }
};

/**
 * Measures the native status-bar height and publishes it as
 * `--native-statusbar-height` on documentElement. Idempotent, never throws,
 * safe to call before first paint (fire-and-forget).
 */
export const applyNativeStatusBarInset = async (deps: StatusBarDeps = {}): Promise<void> => {
  const height = await readNativeStatusBarHeight(deps);
  if (height == null) return;
  try {
    document.documentElement.style.setProperty(NATIVE_STATUS_BAR_VAR, `${Math.round(height)}px`);
  } catch {
    /* Non-fatal: the SystemBars/env() fallbacks still apply. */
  }
};
