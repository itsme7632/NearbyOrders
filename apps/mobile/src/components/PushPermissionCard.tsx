import { useState } from 'react';
import { BellIcon } from './icons.js';
import { Button } from './ui.js';
import type { PushPermissionState } from '../usePushRegistration.js';

/** localStorage: the user dismissed the explainer; do not ask again here. */
const DISMISSED_KEY = 'no_push_permission_dismissed';

/**
 * Contextual push-permission explainer. Shown where notifications already
 * matter (the Notifications screen), never on a timer and never on login:
 * the value is explained first, denial is graceful, and dismissal sticks.
 */
export function PushPermissionCard(props: {
  permission: PushPermissionState;
  onEnable: () => Promise<boolean>;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  if (props.permission === 'granted' || props.permission === 'unavailable') return null;
  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* non-persistent: the card just hides for this session */
    }
    setDismissed(true);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const ok = await props.onEnable();
      if (!ok) setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-permission-card" role="region" aria-label="Push notifications">
      <span className="push-permission-icon" aria-hidden>
        <BellIcon size={22} />
      </span>
      <div>
        <h3>Get instant order updates</h3>
        {denied || props.permission === 'denied' ? (
          <p className="push-permission-denied-note">
            Notifications are turned off. You can enable them anytime in your phone's Settings, Apps,
            NearbyOrders, Notifications. Your in-app notifications below keep working either way.
          </p>
        ) : (
          <>
            <p>
              We will alert you the moment your order is accepted, ready, or out for delivery, and when a
              payment needs your attention. Nothing else, no spam.
            </p>
            <div className="btn-row">
              <Button sm variant="primary" disabled={busy} onClick={() => void enable()}>
                {busy ? 'Requesting…' : 'Enable notifications'}
              </Button>
              <Button sm variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
