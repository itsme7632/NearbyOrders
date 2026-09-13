import { useState } from 'react';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading } from '../components/ui.js';
import { BookingsIcon, OrdersIcon, AlertIcon } from '../components/icons.js';

type NotifIcon = 'booking' | 'order' | 'generic';

const iconFor = (type: string): NotifIcon => (type.startsWith('BOOKING') ? 'booking' : type.startsWith('ORDER') ? 'order' : 'generic');

const relativeWhen = (iso: string): string => {
  const diffMs = Date.now() - Date.parse(iso);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
};

export function NotificationsScreen(props: {
  onOpenNotification: (n: Notification) => void;
  /** Refreshes the nav badge after read-state changes. */
  onReadStateChange?: () => void;
}) {
  const [state, setState] = useState<{ items: Notification[]; cursor: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const page = useAsyncData(() => listNotifications(), []);

  if (page.loading && !state) return <ListSkeleton count={4} />;
  if (page.error && !state) return <ErrorState message={page.error} onRetry={page.reload} />;

  const items = state?.items ?? page.data?.items ?? [];
  const cursor = state?.cursor ?? page.data?.nextCursor ?? null;
  const unread = items.filter((n) => !n.isRead);

  const apply = (next: Notification[]) => {
    setState({ items: next, cursor });
    props.onReadStateChange?.();
  };

  const markRead = async (n: Notification) => {
    if (n.isRead || busyId) return;
    setBusyId(n.id);
    setActionError(null);
    try {
      await markNotificationRead(n.id);
      apply(items.map((x) => (x.id === n.id ? { ...x, isRead: true, readAt: new Date().toISOString() } : x)));
    } catch {
      // Keep the notification unread so the user can retry the tap.
      setActionError('Could not mark that notification as read. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    setActionError(null);
    try {
      await markAllNotificationsRead();
      apply(items.map((x) => ({ ...x, isRead: true, readAt: x.readAt ?? new Date().toISOString() })));
    } catch {
      setActionError('Could not mark all notifications as read. Please try again.');
    } finally {
      setMarkingAll(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    try {
      const next = await listNotifications(30, cursor);
      setState({ items: [...items, ...next.items], cursor: next.nextCursor });
    } catch {
      // Leave the current page visible; the next attempt can retry.
    }
  };

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Notifications</h1>
        {unread.length > 0 ? (
          <button type="button" className="header-link" onClick={() => void markAll()} disabled={markingAll}>
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        ) : null}
      </header>

      {actionError ? (
        <div className="error-state" role="alert">
          <p>⚠ {actionError}</p>
        </div>
      ) : null}

      {!items.length ? (
        <EmptyState
          icon={<AlertIcon size={30} />}
          title="No notifications yet"
          body="Updates about your bookings and orders will appear here."
        />
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const icon = iconFor(n.type);
            const IconCmp = icon === 'booking' ? BookingsIcon : icon === 'order' ? OrdersIcon : AlertIcon;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={`notif-item${n.isRead ? '' : ' notif-unread'}`}
                  onClick={() => {
                    void markRead(n);
                    props.onOpenNotification(n);
                  }}
                >
                  <span className="notif-icon" aria-hidden>
                    <IconCmp size={20} />
                  </span>
                  <span className="notif-body">
                    <span className="notif-top">
                      <span className="notif-title">{n.title}</span>
                      {!n.isRead ? <span className="notif-dot" aria-label="Unread" /> : null}
                    </span>
                    <span className="notif-message">{n.message}</span>
                    <span className="notif-time">{relativeWhen(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {cursor ? (
        <Button full variant="ghost" onClick={() => void loadMore()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
