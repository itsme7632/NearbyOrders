import { useCallback, useRef, useState } from 'react';
import { PinIcon } from './icons.js';
import { Button } from './ui.js';
import { checkLocationPermissionState } from '../location.js';

/** localStorage: the first-use location explainer was shown or dismissed; never show it again. */
const SHOWN_KEY = 'no_location_explainer_shown';

export function wasLocationExplainerShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLocationExplainerShown(): void {
  try {
    localStorage.setItem(SHOWN_KEY, '1');
  } catch {
    /* non-persistent: the modal just stays hidden for this session */
  }
}

/**
 * First-use location permission explainer. Explains the value before the OS
 * dialog; only "Allow location" touches the native permission request, via
 * the existing location flow. Shown at most once per device.
 */
export function LocationPermissionExplainer(props: { onAllow: () => void; onDismiss: () => void }) {
  const notNow = () => {
    markLocationExplainerShown();
    props.onDismiss();
  };

  const allow = () => {
    markLocationExplainerShown();
    props.onAllow();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="location-explainer-title">
      <div className="modal-card push-explainer">
        <span className="push-explainer-icon" aria-hidden>
          <PinIcon size={28} />
        </span>
        <h2 id="location-explainer-title">Find businesses near you</h2>
        <p className="muted">NearbyOrders uses your location to show businesses, products and services near you.</p>
        <div className="push-explainer-actions">
          <Button full variant="primary" onClick={allow}>
            Allow location
          </Button>
          <Button full variant="ghost" onClick={notNow}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * First-use gate for location: wraps an existing location request (e.g. the
 * "Nearby" toggle) so the in-app explainer appears before the native dialog,
 * but only when the OS can still show a prompt and the user has never been
 * asked. Granted/denied states and repeat taps go straight through — the
 * existing flow already handles them gracefully and we never nag.
 *
 * Returns the wrapped request function and the explainer element to render.
 */
export function useLocationExplainer(): {
  requestWithExplainer: (proceed: () => void) => void;
  explainer: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const requestWithExplainer = useCallback((proceed: () => void) => {
    void (async () => {
      let state: Awaited<ReturnType<typeof checkLocationPermissionState>>;
      try {
        state = await checkLocationPermissionState();
      } catch {
        state = 'prompt';
      }
      if (state !== 'prompt' || wasLocationExplainerShown()) {
        proceed();
        return;
      }
      pendingRef.current = proceed;
      setOpen(true);
    })();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    pendingRef.current = null;
  }, []);

  const allow = useCallback(() => {
    markLocationExplainerShown();
    const pending = pendingRef.current;
    close();
    pending?.();
  }, [close]);

  const dismiss = useCallback(() => {
    markLocationExplainerShown();
    close();
  }, [close ]);

  const explainer = open ? <LocationPermissionExplainer onAllow={allow} onDismiss={dismiss} /> : null;

  return { requestWithExplainer, explainer };
}
