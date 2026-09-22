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

const kindLabelFor = (type: string): string =>
  type.startsWith('BOOKING') ? 'Booking' : type.startsWith('ORDER') ? 'Order' : 'Update';

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/** One date bucket in the restructured notification list. */
export type NotificationGroup = {
  key: 'today' | 'earlier';
  /** Heading shown above the bucket ("Today" / "Earlier"). */
  title: string;
  items: Notification[];
};

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Pure helper: buckets notifications by local calendar day relative to `now`.
 * "Today" holds items created on the same local day as `now`; everything
 * else (including unparseable dates) goes to "Earlier". Order within a bucket
 * is preserved. Buckets with no items are omitted.
 */
export function groupNotifications(notifications: Notification[], now: Date = new Date()): NotificationGroup[] {
  const today: Notification[] = [];
  const earlier: Notification[] = [];
  for (const n of notifications) {
    const created = new Date(n.createdAt);
    if (!Number.isNaN(created.getTime()) && sameLocalDay(created, now)) today.push(n);
    else earlier.push(n);
  }
  const groups: NotificationGroup[] = [];
  if (today.length) groups.push({ key: 'today', title: 'Today', items: today });
  if (earlier.length) groups.push({ key: 'earlier', title: 'Earlier', items: earlier });
  return groups;
}

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
  /** Opens the push-notification preferences screen. */
  onOpenPreferences?: () => void;
}) {
  const [state, setState] = useState<{ items: Notification[]; cursor: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const page = useAsyncData(() => listNotifications(), []);

  if (page.loading && !state) return <ListSkeleton count={4} />;
  if (page.error && !state) return <ErrorState message={page.error} onRetry={page.reload} />;

  const items = state?.items ?? page.data?.items ?? [];
  const cursor = state?.cursor ?? page.data?.nextCursor ?? null;
  const unread = items.filter((n) => !n.isRead);
  // Cheap O(n) bucketing; intentionally not memoized — this component has
  // early returns above, and a hook here would violate hook ordering.
  const groups = groupNotifications(items);

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
    // In-flight guard: rapid taps must not fire overlapping page requests,
    // which would each append the same page and duplicate the list.
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await listNotifications(30, cursor);
      setState({ items: [...items, ...next.items], cursor: next.nextCursor });
    } catch {
      // Leave the current page visible; the next attempt can retry.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Notifications</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {props.onOpenPreferences ? (
            <button type="button" className="header-link" onClick={props.onOpenPreferences}>
              Settings
            </button>
          ) : null}
          {unread.length > 0 ? (
            <button type="button" className="header-link" onClick={() => void markAll()} disabled={markingAll}>
              {markingAll ? 'Marking…' : 'Mark all read'}
            </button>
          ) : null}
        </div>
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
        groups.map((g) => {
          const groupUnread = g.items.filter((n) => !n.isRead).length;
          return (
            <section key={g.key} aria-label={g.title}>
              <h2
                className="type-section"
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '18px 0 8px' }}
              >
                {g.title}
                {groupUnread > 0 ? <span className="type-meta">{groupUnread} new</span> : null}
              </h2>
              <ul className="notif-list">
                {g.items.map((n) => {
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
                          <span className="notif-time">
                            <span className="type-label">{kindLabelFor(n.type)}</span>
                            {' · '}
                            <span className="type-meta">{relativeWhen(n.createdAt)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      {cursor ? (
        <Button full variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
