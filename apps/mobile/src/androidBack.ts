import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { parseHash } from './navigation.js';

/* ==================================================================
   Central Android system-back handling.

   ROOT CAUSE (fixed here): the app had no system back-button handling
   at all — no `App.addListener('backButton', …)`, no native
   onBackPressed override (Capacitor 8's BridgeActivity does not ship
   one), and `@capacitor/app` was not even installed. Every Android
   system back press / back gesture therefore ran the Activity's default
   behavior and finished the app, landing the user on the home screen —
   even with in-app history, an open sheet, or a nested flow on screen.

   This module is the single place that owns the back button:

   1. An open overlay (bottom sheet, dialog preview, …) dismisses first.
   2. Otherwise the WebView history goes back (hash router included —
      every `location.hash` push is a history entry).
   3. With no history and a non-root route (cold-launch deep link, push
      notification, restored session), back lands on the tab root `#/`
      instead of exiting — mirroring the in-app back affordance.
   4. Only at the genuine root with no history does normal Android
      behavior apply: the app is backgrounded.

   Nothing here changes routes, the information architecture, or any
   screen: it only decides what a back press *does*.
   ================================================================== */

/** The decision the central handler makes for one back press. */
export type BackAction =
  | { type: 'dismiss-overlay' }
  | { type: 'history-back' }
  | { type: 'go-home' }
  | { type: 'exit' };

/**
 * Pure decision function — no platform calls, fully unit-testable.
 *
 * - overlayOpen: any overlay registered via registerOverlayBackHandler
 *   (or useOverlayBackHandler) is currently on screen.
 * - canGoBack: the WebView reports history entries behind the current
 *   one (the `backButton` event payload).
 * - hash: the current location hash; the tab shell `#/` is the root in
 *   both customer and business-owner mode (the shell renders the
 *   mode-appropriate tabs for it).
 */
export function resolveBackAction(opts: { overlayOpen: boolean; canGoBack: boolean; hash: string }): BackAction {
  if (opts.overlayOpen) return { type: 'dismiss-overlay' };
  if (opts.canGoBack) return { type: 'history-back' };
  if (!isRootHash(opts.hash)) return { type: 'go-home' };
  return { type: 'exit' };
}

/** True when the hash addresses the tab shell — the root screen. */
export function isRootHash(hash: string): boolean {
  return parseHash(hash).name === 'tabs';
}

/* --------------------- Overlay back-handler stack --------------------- */

type OverlayDismiss = () => void;

/**
 * Stack of overlay dismiss callbacks, newest (topmost) last. Overlays —
 * the Sheet primitive, dialog previews, … — register while open and
 * unregister on close/unmount. Screen-specific back logic stays out:
 * components only declare "I am an overlay; this closes me".
 */
const overlayStack: OverlayDismiss[] = [];

/**
 * Registers an overlay's dismiss callback for system-back handling.
 * Returns an unregister function; safe to call more than once.
 */
export function registerOverlayBackHandler(dismiss: OverlayDismiss): () => void {
  overlayStack.push(dismiss);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const i = overlayStack.lastIndexOf(dismiss);
    if (i >= 0) overlayStack.splice(i, 1);
  };
}

/**
 * React hook for overlay components: while `open`, a system back press
 * calls `onDismiss` instead of navigating. `onDismiss` is read through a
 * ref so registration is stable across renders.
 */
export function useOverlayBackHandler(open: boolean, onDismiss: () => void): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    return registerOverlayBackHandler(() => dismissRef.current());
  }, [open]);
}

/* ------------------------- Listener bootstrap ------------------------- */

let initialized = false;

/**
 * Installs the single Android system-back listener. Idempotent and a
 * no-op on web/iOS (the `backButton` event only exists on Android).
 * Call once at app bootstrap, next to the other native integrations.
 */
export function initAndroidBackNavigation(): void {
  if (initialized) return;
  initialized = true;
  if (Capacitor.getPlatform() !== 'android') return;

  void App.addListener('backButton', (event) => {
    // 1. An open overlay dismisses before anything navigates.
    const top = overlayStack.pop();
    if (top) {
      top();
      return;
    }

    // 2. In-app history (hash-router pushes included) goes back.
    const canGoBack = event?.canGoBack ?? window.history.length > 1;
    const action = resolveBackAction({ overlayOpen: false, canGoBack, hash: window.location.hash });
    switch (action.type) {
      case 'history-back':
        window.history.back();
        return;
      case 'go-home':
        // 3. No history but not at the root (cold-launch deep link, push
        // notification, restored session): land on the tab root instead
        // of exiting, mirroring the in-app back affordance.
        window.location.hash = '/';
        return;
      case 'exit':
        // 4. Genuinely at the root with no history: normal Android
        // behavior — background the app.
        void App.minimizeApp();
        return;
      case 'dismiss-overlay':
        // Unreachable: the overlay stack was already drained above.
        return;
    }
  });
}
