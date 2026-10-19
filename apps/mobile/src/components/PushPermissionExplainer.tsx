import { useState } from 'react';
import { BellIcon } from './icons.js';
import { Button } from './ui.js';

/** localStorage: the first-use explainer was shown or dismissed; never show it again. */
const SHOWN_KEY = 'no_push_explainer_shown';

export function wasPushExplainerShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPushExplainerShown(): void {
  try {
    localStorage.setItem(SHOWN_KEY, '1');
  } catch {
    /* non-persistent: the modal just stays hidden for this session */
  }
}

/**
 * First-use push permission explainer. Shown once, to a signed-in customer,
 * at a calm moment (Home, shortly after arrival). Never on the first frame.
 * Explains the value first; only "Enable notifications" touches the OS
 * permission dialog, via the existing push registration flow.
 */
export function PushPermissionExplainer(props: {
  onEnable: () => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      await props.onEnable();
    } finally {
      setBusy(false);
      markPushExplainerShown();
      props.onDismiss();
    }
  };

  const notNow = () => {
    markPushExplainerShown();
    props.onDismiss();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="push-explainer-title">
      <div className="modal-card push-explainer">
        <span className="push-explainer-icon" aria-hidden>
          <BellIcon size={28} />
        </span>
        <h2 id="push-explainer-title">Stay updated on your orders</h2>
        <p className="muted">
          Get notified when your order is accepted, being prepared, ready, out for delivery, or delivered.
        </p>
        <div className="push-explainer-actions">
          <Button full variant="primary" disabled={busy} onClick={() => void enable()}>
            {busy ? 'Requesting…' : 'Enable notifications'}
          </Button>
          <Button full variant="ghost" onClick={notNow}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
