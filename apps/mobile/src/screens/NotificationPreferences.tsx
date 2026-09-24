import { useState } from 'react';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, ListSkeleton } from '../components/ui.js';
import { Toggle, useToast } from '../components/primitives.js';
import { AlertIcon } from '../components/icons.js';

/**
 * Notification preferences (Phase 3D). These settings gate PUSH alerts
 * only: verified against the server's push dispatch, which skips delivery
 * per category while in-app notifications are still recorded. The copy
 * says exactly that so nobody thinks "off" means "gone".
 *
 * Toggles save immediately (optimistic, revert on failure) because these
 * are independent booleans: no "save" button to forget.
 */

const ROWS: {
  key: keyof NotificationPreferences;
  title: string;
  body: string;
}[] = [
  { key: 'orders', title: 'Orders', body: 'Placed, accepted, ready, and completed order updates.' },
  { key: 'bookings', title: 'Bookings', body: 'Confirmed, changed, or cancelled booking updates.' },
  { key: 'payments', title: 'Payments', body: 'Payment confirmations and receipts.' },
  { key: 'reviews', title: 'Reviews', body: 'New reviews on your businesses (owners).' },
  {
    key: 'businessActivity',
    title: 'Business activity',
    body: 'New orders and bookings on your businesses, subscription updates (owners).',
  },
  { key: 'account', title: 'Account', body: 'Security and important account notices.' },
];

function ScreenHead(props: { title: string; sub?: string }) {
  return (
    <header className="owner-head saved-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub ? <p className="owner-sub">{props.sub}</p> : null}
      </div>
    </header>
  );
}

export function NotificationPreferencesScreen(props: { onBack: () => void }) {
  const page = useAsyncData(() => getNotificationPreferences(), []);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { error } = useToast();

  if (page.loading && !prefs) return <ListSkeleton count={6} />;
  if (page.error && !prefs) return <ErrorState message={page.error} onRetry={page.reload} />;

  const current: NotificationPreferences | null = prefs ?? page.data ?? null;

  const flip = async (key: keyof NotificationPreferences) => {
    if (!current || savingKey) return;
    const next = { ...current, [key]: !current[key] };
    const prev = current;
    setPrefs(next);
    setSavingKey(key);
    setActionError(null);
    try {
      const saved = await updateNotificationPreferences(next);
      setPrefs(saved);
    } catch {
      // Revert the optimistic flip so the UI never lies about the server.
      setPrefs(prev);
      const row = ROWS.find((r) => r.key === key);
      setActionError(`Could not update “${row?.title ?? key}”. Please try again.`);
      error('Preference not saved. Please try again.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="screen">
      <ScreenHead title="Notification settings" sub="Which push alerts reach your phone" />
      <div style={{ marginBottom: 8 }}>
        <Button variant="ghost" onClick={props.onBack}>
          ‹ Back
        </Button>
      </div>

      <p className="hint" style={{ margin: '4px 0 12px' }}>
        These control push alerts only. Everything still appears in Notifications here in the app, whether a category
        is on or off.
      </p>

      {actionError ? (
        <div className="error-state" role="alert">
          <p>⚠ {actionError}</p>
        </div>
      ) : null}

      {current ? (
        <ul className="pref-list" aria-label="Push notification categories">
          {ROWS.map((row) => (
            <li key={row.key} className="pref-row">
              <div className="pref-text">
                <span className="pref-title">{row.title}</span>
                <span className="pref-body">{row.body}</span>
              </div>
              <Toggle
                checked={current[row.key]}
                disabled={savingKey !== null}
                label={`${row.title} push notifications`}
                onChange={() => void flip(row.key)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="error-state" role="status">
          <p>
            <AlertIcon size={16} /> Could not load your settings. Pull to retry from Notifications.
          </p>
        </div>
      )}
    </div>
  );
}
