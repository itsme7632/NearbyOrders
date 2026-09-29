/**
 * TEMPORARY diagnostic flag for the Android WebView image-loading investigation.
 *
 * Enabled only when the build sets VITE_IMAGE_DEBUG=true. When enabled,
 * business-image <img> components attach an onError handler that captures
 * the exact failure details (src, currentSrc, dimensions, origin, user agent)
 * and render a visible diagnostic panel. When disabled (all normal builds),
 * image components behave exactly as before — no onError, no extra DOM.
 *
 * This is INSTRUMENTATION, not a fix. It exists to identify the root cause
 * of remote images failing to render inside the Android Capacitor WebView
 * while the same URLs work in Chrome on the same device.
 *
 * DO NOT use this flag to gate a fallback, proxy, or URL rewrite. The
 * diagnostic must not change image loading behavior.
 */
export const IMAGE_DEBUG: boolean = import.meta.env.VITE_IMAGE_DEBUG === 'true';
