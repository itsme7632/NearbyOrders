// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useAsyncData } from '../hooks.js';
import { OrdersScreen, orderLabel } from './Orders.js';
import { NotificationsScreen } from './Notifications.js';
import { EditProfileScreen } from './Profile.js';
import * as api from '../api.js';
import type { Notification, Order, OrderStatus } from '../api.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* D: render-exception safety — orderLabel default                       */
/* ------------------------------------------------------------------ */

describe('orderLabel (render-exception guard)', () => {
  it('falls back for an unknown future status instead of returning undefined', () => {
    const label = orderLabel('FUTURE_STATUS' as OrderStatus);
    expect(label).toEqual({ text: 'FUTURE_STATUS', cls: 'status-pending' });
  });

  it('still covers every known status', () => {
    for (const s of ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REJECTED'] as OrderStatus[]) {
      expect(orderLabel(s).text).toBeTruthy();
    }
  });

  const order = (patch: Partial<Order> = {}): Order => ({
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    status: 'PENDING',
    subtotalMinor: 215000,
    currency: 'PKR',
    fulfillmentType: 'PICKUP',
    notes: null,
    createdAt: '2026-09-09T12:00:00.000Z',
    business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices', imageUrl: null },
    customer: { firstName: 'Ayesha', lastName: 'Khan' },
    items: [{ id: 'i1', productId: 'p1', name: 'Chicken Biryani', unitPriceMinor: 45000, quantity: 2, lineTotalMinor: 90000 }],
    ...patch,
  });

  it('renders the list without crashing when an order carries an unknown status', async () => {
    vi.spyOn(api, 'listMyOrders').mockResolvedValue([order({ status: 'FUTURE_STATUS' as OrderStatus })]);
    render(<OrdersScreen onOpenOrder={() => {}} onBrowse={() => {}} />);
    // The screen renders (no blank crash) and shows the raw status honestly.
    expect(await screen.findByText('FUTURE_STATUS')).toBeTruthy();
    expect(screen.getByText('Butt Spices')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* M: mount-heavy hooks fire exactly once                               */
/* ------------------------------------------------------------------ */

function Probe(props: { fn: () => Promise<string> }) {
  const s = useAsyncData(props.fn, []);
  return <span>{s.loading ? 'loading' : s.data}</span>;
}

describe('useAsyncData (single-fire on mount)', () => {
  it('fires the fetcher exactly once on mount', async () => {
    const fn = vi.fn<() => Promise<string>>().mockResolvedValue('ok');
    render(<Probe fn={fn} />);
    await screen.findByText('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fires exactly once per reload() call', async () => {
    const fn = vi.fn<() => Promise<string>>().mockResolvedValue('ok');
    function Reloadable() {
      const s = useAsyncData(fn, []);
      return (
        <div>
          <span>{s.loading ? 'loading' : s.data}</span>
          <button type="button" onClick={s.reload}>
            retry
          </button>
        </div>
      );
    }
    render(<Reloadable />);
    await screen.findByText('ok');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});

/* ------------------------------------------------------------------ */
/* M: Notifications loadMore double-tap must not duplicate the page     */
/* ------------------------------------------------------------------ */

const notif = (patch: Partial<Notification> = {}): Notification => ({
  id: 'n-1',
  type: 'ORDER_ACCEPTED',
  title: 'Order accepted',
  message: 'Butt Spices accepted your order.',
  entityType: 'Order',
  entityId: 'order-1',
  isRead: false,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...patch,
});

describe('NotificationsScreen loadMore in-flight guard', () => {
  it('fires exactly one page request on a rapid double-tap and appends each page once', async () => {
    let resolvePage2!: (v: { items: Notification[]; nextCursor: string | null }) => void;
    const page2Items = [notif({ id: 'n-2', title: 'Order shipped' })];
    vi.spyOn(api, 'listNotifications')
      .mockResolvedValueOnce({ items: [notif({ id: 'n-1' })], nextCursor: 'cursor-1' })
      .mockImplementationOnce(
        () => new Promise<{ items: Notification[]; nextCursor: string | null }>((res) => { resolvePage2 = res; }),
      );
    render(<NotificationsScreen onOpenNotification={() => {}} />);
    await screen.findByText('Order accepted');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    // Second tap while the page-2 request is still in flight (the button is
    // disabled by then, but the handler must guard regardless).
    fireEvent.click(screen.getByRole('button', { name: 'Loading…' }));

    expect(api.listNotifications).toHaveBeenCalledTimes(2); // initial + exactly one page-2

    resolvePage2({ items: page2Items, nextCursor: null });
    await screen.findByText('Order shipped');
    // Each notification row appears exactly once.
    expect(screen.getAllByText('Order accepted')).toHaveLength(1);
    expect(screen.getAllByText('Order shipped')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* D: EditProfile load failure offers a working retry                   */
/* ------------------------------------------------------------------ */

describe('EditProfileScreen load retry', () => {
  it('retries the profile fetch after a failed load', async () => {
    const profile = {
      id: 'u1',
      email: 'a@b.c',
      role: 'CUSTOMER',
      firstName: 'Ayesha',
      lastName: 'Khan',
      phone: null as string | null,
    };
    const spy = vi
      .spyOn(api, 'whoami')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(profile);
    render(<EditProfileScreen onBack={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText(/Could not load your profile/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByDisplayValue('Ayesha');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
