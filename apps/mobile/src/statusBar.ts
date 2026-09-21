/**
 * Android status-bar inset guarantee.
 *
 * Verified chain (2026-09-22, against the installed @capacitor 8.5.1 tree):
 * there is NO SystemBars plugin in this project — no such package exists in
 * node_modules, `insetsHandling` appears nowhere in the Capacitor sources,
 * and `cap sync` registers only geolocation/push-notifications/status-bar —
 * so nothing ever injects `--safe-area-inset-top`, and on affected Android
 * devices Chromium's `env(safe-area-inset-top)` reports 0 even with
 * `viewport-fit=cover`. The only reliable measurement is
 * `StatusBar.getInfo()`, which is WindowInsets-based
 * (`getCurrentWindowMetrics().getWindowInsets()` on API 30+) and therefore
 * correct on every Android version and WebView version.
 *
 * The classic alternative, `StatusBar.setOverlaysWebView({ overlay: false })`,
 * cannot fix this: it toggles deprecated systemUiVisibility flags that are
 * no-ops on Android 15+ (the plugin's own typings say "Not available on
 * Android 15+").
 *
 * What this module does instead: read the REAL status-bar height through
 * `StatusBar.getInfo()` and expose it as the `--native-statusbar-height`
 * CSS variable. styles.css consumes it via the `--sat` token:
 *
 *   --sat: max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)),
 *              var(--native-statusbar-height, 0px));
 *
 * max() keeps the sources from ever double-applying. iOS and web never set
 * the variable, so their behavior is unchanged.
 *
 * The OTHER half of the guarantee lives in styles.css: every `main` padding
 * rule (including later cascade overrides) must keep var(--sat) in its top
 * component — a flat padding-top on a later rule silently discards the
 * inset and was the actual cause of the status-bar overlap (2026-09-22).
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
    /* Non-fatal: the env() fallbacks still apply. */
  }
};
