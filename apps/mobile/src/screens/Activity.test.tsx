import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ActivityScreen } from './Activity.js';
import { isActiveOrder, isTerminalBooking, partitionActivity, type ActivityFilter } from './activityData.js';
import * as api from '../api.js';
import type { Booking, Order } from '../api.js';
import { addDays, longDateLabel, todayPkt } from '../time.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const session = { accessToken: 'tok', user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' } };

const order = (patch: Partial<Order> = {}): Order => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PREPARING',
  subtotalMinor: 215000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  notes: null,
  createdAt: '2026-09-20T12:00:00.000Z',
  business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices', imageUrl: null },
  customer: null,
  items: [{ id: 'i1', productId: 'p1', name: 'Chicken Biryani', unitPriceMinor: 45000, quantity: 2, lineTotalMinor: 90000 }],
  ...patch,
});

const booking = (patch: Partial<Booking> = {}): Booking => ({
  id: 'bk-1',
  businessId: 'biz-2',
  businessName: 'DHA Glow Salon',
  businessSlug: 'dha-glow-salon',
  serviceId: 'svc-1',
  serviceName: 'Hair Consultation',
  priceMinor: 250000,
  currency: 'PKR',
  bookingDate: todayPkt(),
  startTime: '09:00',
  endTime: '09:30',
  status: 'CONFIRMED',
  notes: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  ...patch,
});

function mockSignedIn(orders: Order[] = [], bookings: Booking[] = []) {
  vi.spyOn(api, 'getSession').mockReturnValue(session);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue(orders);
  vi.spyOn(api, 'listMyBookings').mockResolvedValue(bookings);
}

/* ---------------- partitionActivity (pure logic) ---------------- */

describe('partitionActivity', () => {
  const today = '2026-09-21';

  it('classifies order statuses: in-flight vs terminal', () => {
    expect(isActiveOrder('PENDING')).toBe(true);
    expect(isActiveOrder('ACCEPTED')).toBe(true);
    expect(isActiveOrder('PREPARING')).toBe(true);
    expect(isActiveOrder('READY')).toBe(true);
    expect(isActiveOrder('COMPLETED')).toBe(false);
    expect(isActiveOrder('CANCELLED')).toBe(false);
    expect(isActiveOrder('REJECTED')).toBe(false);
    expect(isTerminalBooking('COMPLETED')).toBe(true);
    expect(isTerminalBooking('CANCELLED')).toBe(true);
    expect(isTerminalBooking('REJECTED')).toBe(true);
    expect(isTerminalBooking('CONFIRMED')).toBe(false);
    expect(isTerminalBooking('PENDING')).toBe(false);
  });

  it('puts in-flight orders and today bookings in happening now', () => {
    const p = partitionActivity(
      [order({ id: 'o1', status: 'PENDING' }), order({ id: 'o2', status: 'PREPARING' })],
      [booking({ id: 'b1', bookingDate: today, status: 'CONFIRMED' })],
      today,
    );
    expect(p.happeningNowOrders.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(p.happeningNowBookings.map((b) => b.id)).toEqual(['b1']);
    expect(p.upcomingBookings).toEqual([]);
    expect(p.recentOrders).toEqual([]);
    expect(p.recentBookings).toEqual([]);
  });

  it('puts future bookings in upcoming, soonest first', () => {
    const p = partitionActivity(
      [],
      [
        booking({ id: 'b3', bookingDate: addDays(today, 5), startTime: '10:00', status: 'CONFIRMED' }),
        booking({ id: 'b2', bookingDate: addDays(today, 2), startTime: '14:00', status: 'PENDING' }),
      ],
      today,
    );
    expect(p.upcomingBookings.map((b) => b.id)).toEqual(['b2', 'b3']);
    expect(p.happeningNowBookings).toEqual([]);
  });

  it('puts terminal orders and past/terminal bookings in recent activity', () => {
    const p = partitionActivity(
      [
        order({ id: 'o1', status: 'COMPLETED', createdAt: '2026-09-18T10:00:00.000Z' }),
        order({ id: 'o2', status: 'CANCELLED', createdAt: '2026-09-19T10:00:00.000Z' }),
      ],
      [
        booking({ id: 'b1', bookingDate: addDays(today, -3), status: 'COMPLETED' }),
        booking({ id: 'b2', bookingDate: addDays(today, 2), status: 'CANCELLED' }),
        booking({ id: 'b3', bookingDate: addDays(today, -10), status: 'CONFIRMED' }),
      ],
      today,
    );
    // Recent orders newest first.
    expect(p.recentOrders.map((o) => o.id)).toEqual(['o2', 'o1']);
    // Past-dated open bookings AND future terminal bookings are history.
    expect(p.recentBookings.map((b) => b.id)).toEqual(['b2', 'b1', 'b3']);
    expect(p.upcomingBookings).toEqual([]);
  });
});

/* ---------------- ActivityScreen ---------------- */

describe('ActivityScreen', () => {
  it('shows the auth-friendly empty state when signed out (and never fetches)', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(null);
    const listOrders = vi.spyOn(api, 'listMyOrders');
    const listBookings = vi.spyOn(api, 'listMyBookings');

    render(<ActivityScreen onOpenOrder={() => {}} onOpenBooking={() => {}} onBrowse={() => {}} />);

    expect(await screen.findByText('Your activity')).toBeTruthy();
    expect(screen.getByText('Sign in to see your orders and bookings in one place.')).toBeTruthy();
    expect(listOrders).not.toHaveBeenCalled();
    expect(listBookings).not.toHaveBeenCalled();
  });

  it('shows the browse empty state when signed in with nothing yet', async () => {
    mockSignedIn();
    const onBrowse = vi.fn();
    render(<ActivityScreen onOpenOrder={() => {}} onOpenBooking={() => {}} onBrowse={onBrowse} />);

    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    fireEvent.click(screen.getByText('Find businesses'));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('groups into happening now / upcoming / recent activity with distinct headings', async () => {
    const today = todayPkt();
    mockSignedIn(
      [
        order({ id: 'o-active', status: 'PREPARING' }),
        order({ id: 'o-old', status: 'COMPLETED', createdAt: '2026-09-10T10:00:00.000Z' }),
      ],
      [
        booking({ id: 'b-today', bookingDate: today, status: 'CONFIRMED' }),
        booking({ id: 'b-future', bookingDate: addDays(today, 3), status: 'PENDING' }),
        booking({ id: 'b-past', bookingDate: addDays(today, -4), status: 'COMPLETED' }),
      ],
    );
    render(<ActivityScreen onOpenOrder={() => {}} onOpenBooking={() => {}} onBrowse={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'Happening now' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy();

    // Happening now: the active order (serif identity + status line) and today's booking.
    expect(screen.getByRole('button', { name: /from Butt Spices, Preparing/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /DHA Glow Salon, Today/ })).toBeTruthy();
    // Recent: the completed order is in the compact history, not happening now.
    const recent = screen.getByRole('button', { name: /from Butt Spices, Completed/ });
    expect(recent).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(`at DHA Glow Salon, ${longDateLabel(addDays(today, -4))}`) })).toBeTruthy();
  });

  it('deep-links rows to order and booking detail', async () => {
    mockSignedIn([order({ id: 'o-1', status: 'READY' })], [booking({ id: 'b-1', bookingDate: todayPkt(), status: 'CONFIRMED' })]);
    const onOpenOrder = vi.fn();
    const onOpenBooking = vi.fn();
    render(<ActivityScreen onOpenOrder={onOpenOrder} onOpenBooking={onOpenBooking} onBrowse={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /from Butt Spices/ }));
    expect(onOpenOrder).toHaveBeenCalledWith('o-1');
    fireEvent.click(screen.getByRole('button', { name: /DHA Glow Salon, Today/ }));
    expect(onOpenBooking).toHaveBeenCalledWith('b-1');
  });

  it('filters kinds via the segmented control', async () => {
    mockSignedIn([order({ id: 'o-1', status: 'PENDING' })], [booking({ id: 'b-1', bookingDate: addDays(todayPkt(), 2), status: 'PENDING' })]);
    render(<ActivityScreen onOpenOrder={() => {}} onOpenBooking={() => {}} onBrowse={() => {}} />);
    await screen.findByRole('heading', { name: 'Upcoming' });

    // Bookings only: the order row disappears, the booking section stays.
    fireEvent.click(screen.getByRole('radio', { name: 'Bookings' }));
    expect(screen.queryByRole('button', { name: /from Butt Spices/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Happening now' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeTruthy();

    // Orders only: the booking row disappears.
    fireEvent.click(screen.getByRole('radio', { name: 'Orders' }));
    expect(screen.queryByRole('button', { name: /DHA Glow Salon/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Upcoming' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Happening now' })).toBeTruthy();

    // All restores both.
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByRole('button', { name: /from Butt Spices/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeTruthy();
  });

  it('surfaces an error with retry when either fetch fails', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(session);
    vi.spyOn(api, 'listMyOrders').mockRejectedValue(new api.ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.'));
    vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
    render(<ActivityScreen onOpenOrder={() => {}} onOpenBooking={() => {}} onBrowse={() => {}} />);

    expect(await screen.findByText(/Cannot reach the NearbyOrders API/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the filter type in sync with the segmented options', () => {
    const values: ActivityFilter[] = ['all', 'orders', 'bookings'];
    expect(values).toHaveLength(3);
  });
});
