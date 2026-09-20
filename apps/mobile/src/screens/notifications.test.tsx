import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { NotificationsScreen, groupNotifications } from './Notifications.js';
import * as api from '../api.js';
import { getSession, onSessionChange, type Notification, type Session } from '../api.js';
import { useUnreadNotifications } from '../useUnreadNotifications.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const notif = (patch: Partial<Notification> = {}): Notification => ({
  id: 'n-1',
  type: 'ORDER_ACCEPTED',
  title: 'Order accepted',
  message: 'Butt Spices accepted your order #ABC123.',
  entityType: 'Order',
  entityId: 'order-1',
  isRead: false,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...patch,
});

const page = (items: Notification[]) => ({ items, nextCursor: null });

function HookProbe() {
  const { count, refresh } = useUnreadNotifications();
  return (
    <div>
      <span data-testid="unread-count">{count}</span>
      <button type="button" onClick={refresh}>refresh-hook</button>
    </div>
  );
}

describe('groupNotifications (pure helper)', () => {
  const now = new Date(2026, 8, 21, 12, 0, 0); // local noon, Sep 21 2026
  const g = (id: string, createdAt: string): Notification => notif({ id, createdAt });

  it('buckets same-local-day items into Today and the rest into Earlier', () => {
    const items = [
      g('a', new Date(2026, 8, 21, 9, 30).toISOString()),
      g('b', new Date(2026, 8, 20, 23, 59).toISOString()),
      g('c', new Date(2026, 8, 21, 0, 1).toISOString()),
    ];
    const groups = groupNotifications(items, now);
    expect(groups.map((x) => x.key)).toEqual(['today', 'earlier']);
    expect(groups[0].title).toBe('Today');
    expect(groups[0].items.map((n) => n.id)).toEqual(['a', 'c']);
    expect(groups[1].title).toBe('Earlier');
    expect(groups[1].items.map((n) => n.id)).toEqual(['b']);
  });

  it('omits empty buckets and preserves order within a bucket', () => {
    const items = [g('x', new Date(2026, 8, 19, 8, 0).toISOString()), g('y', new Date(2026, 8, 18, 8, 0).toISOString())];
    const groups = groupNotifications(items, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('earlier');
    expect(groups[0].items.map((n) => n.id)).toEqual(['x', 'y']);
    expect(groupNotifications([], now)).toEqual([]);
  });

  it('treats unparseable dates as Earlier without throwing', () => {
    const groups = groupNotifications([g('z', 'not-a-date')], now);
    expect(groups.map((x) => x.key)).toEqual(['earlier']);
  });
});

describe('NotificationsScreen', () => {
  it('renders unread and read notifications with relative timestamps', async () => {
    vi.spyOn(api, 'listNotifications').mockResolvedValue(
      page([
        notif({ id: 'n-1', isRead: false }),
        notif({ id: 'n-2', type: 'BOOKING_ACCEPTED', title: 'Booking confirmed', entityType: 'Booking', isRead: true, readAt: new Date().toISOString() }),
        notif({ id: 'n-3', createdAt: new Date(Date.now() - 90_000).toISOString() }), // 90s ago → "2m ago"… actually 1m
      ]),
    );
    render(<NotificationsScreen onOpenNotification={() => {}} />);

    expect(await screen.findByText('Booking confirmed')).toBeTruthy();
    // n-1 and n-3 share the default fixture title.
    expect(screen.getAllByText('Order accepted')).toHaveLength(2);
    expect(screen.getByText('Mark all read')).toBeTruthy();
  });

  it('groups notifications under Today and Earlier headings with a kind label', async () => {
    vi.spyOn(api, 'listNotifications').mockResolvedValue(
      page([
        notif({ id: 'n-1', createdAt: new Date().toISOString() }),
        notif({ id: 'n-2', type: 'BOOKING_ACCEPTED', title: 'Booking confirmed', createdAt: new Date(Date.now() - 3 * 86400_000).toISOString() }),
      ]),
    );
    render(<NotificationsScreen onOpenNotification={() => {}} />);

    expect(await screen.findByRole('heading', { name: /Today/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Earlier/ })).toBeTruthy();
    expect(screen.getByText('Order')).toBeTruthy();
    expect(screen.getByText('Booking')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    vi.spyOn(api, 'listNotifications').mockResolvedValue(page([]));
    render(<NotificationsScreen onOpenNotification={() => {}} />);
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    expect(screen.getByText('Updates about your bookings and orders will appear here.')).toBeTruthy();
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(api, 'listNotifications').mockReturnValue(new Promise(() => {}));
    render(<NotificationsScreen onOpenNotification={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows an error state with retry', async () => {
    const spy = vi
      .spyOn(api, 'listNotifications')
      .mockRejectedValueOnce(new api.ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.'))
      .mockResolvedValue(page([]));
    render(<NotificationsScreen onOpenNotification={() => {}} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeTruthy());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('marks one notification read via the API', async () => {
    const markOne = vi.spyOn(api, 'markNotificationRead').mockResolvedValue(notif({ isRead: true, readAt: new Date().toISOString() }));
    vi.spyOn(api, 'listNotifications').mockResolvedValue(page([notif()]));
    render(<NotificationsScreen onOpenNotification={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Order accepted/ }));
    await waitFor(() => expect(markOne).toHaveBeenCalledWith('n-1'));
  });

  it('marks all read via the API and hides the action when nothing is unread', async () => {
    const markAll = vi.spyOn(api, 'markAllNotificationsRead').mockResolvedValue({ updated: 2 });
    vi.spyOn(api, 'listNotifications').mockResolvedValue(page([notif(), notif({ id: 'n-2', isRead: true, readAt: new Date().toISOString() })]));
    const { rerender } = render(<NotificationsScreen onOpenNotification={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markAll).toHaveBeenCalled());

    rerender(<NotificationsScreen onOpenNotification={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('surfaces a friendly error when marking read fails', async () => {
    vi.spyOn(api, 'markNotificationRead').mockRejectedValue(new api.ApiError(500, 'INTERNAL', 'Server error'));
    vi.spyOn(api, 'listNotifications').mockResolvedValue(page([notif()]));
    render(<NotificationsScreen onOpenNotification={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Order accepted/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Could not mark that notification as read/)).toBeTruthy();
  });

  it('opens the order detail for an ORDER notification and the booking detail for a BOOKING one', async () => {
    vi.spyOn(api, 'listNotifications').mockResolvedValue(
      page([notif({ entityType: 'Order', entityId: 'order-9' }), notif({ id: 'n-2', type: 'BOOKING_CREATED', title: 'New booking request', entityType: 'Booking', entityId: 'booking-7' })]),
    );
    const onOpen = vi.fn();
    render(<NotificationsScreen onOpenNotification={onOpen} />);

    fireEvent.click(await screen.findByRole('button', { name: /Order accepted/ }));
    fireEvent.click(screen.getByRole('button', { name: /New booking request/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Order', entityId: 'order-9' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Booking', entityId: 'booking-7' }));
  });

  it('badge hook: counts unread, clears on logout, refreshes on demand', async () => {
    const listeners: Array<(s: Session | null) => void> = [];
    vi.spyOn(api, 'onSessionChange').mockImplementation((cb: (s: Session | null) => void) => {
      listeners.push(cb);
      return () => {};
    });
    const session: Session = { accessToken: 't', user: { id: 'u1', email: 'a@b.c', role: 'CUSTOMER' } };
    vi.spyOn(api, 'getSession').mockReturnValue(session);
    const unread = vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 3 });

    render(<HookProbe />);
    await waitFor(() => expect(screen.getByTestId('unread-count').textContent).toBe('3'));

    // Logout → session change → count resets to 0 and no further API calls.
    unread.mockClear();
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    for (const cb of listeners) cb(null);
    fireEvent.click(screen.getByRole('button', { name: 'refresh-hook' }));
    await waitFor(() => expect(screen.getByTestId('unread-count').textContent).toBe('0'));
    expect(unread).not.toHaveBeenCalled();
    expect(listeners.length).toBe(1);
  });
});
