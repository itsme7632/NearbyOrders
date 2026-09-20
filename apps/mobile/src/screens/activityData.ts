import type { Booking, BookingStatus, Order, OrderStatus } from '../api.js';

/* ------------------------------------------------------------------ */
/* Activity (Warm Proximity Phase 2) — pure grouping logic.            */
/* The Activity screen composes existing orders + bookings data; this  */
/* module holds the partition rules so they are unit-testable without  */
/* rendering. Fetching stays with the existing screens (no changes).   */
/* ------------------------------------------------------------------ */

export type ActivityFilter = 'all' | 'orders' | 'bookings';

/** A booking that can no longer move — it belongs in history. */
export function isTerminalBooking(status: BookingStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED';
}

/**
 * An order still in flight. Mirrors the Orders screen's active lens:
 * PENDING/ACCEPTED/PREPARING/READY; COMPLETED/CANCELLED/REJECTED are history.
 */
export function isActiveOrder(status: OrderStatus): boolean {
  return !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(status);
}

export type ActivityPartition = {
  /** In-flight orders plus today's unresolved bookings. */
  happeningNowOrders: Order[];
  happeningNowBookings: Booking[];
  /** Future unresolved bookings, soonest first. */
  upcomingBookings: Booking[];
  /** Terminal orders, newest first. */
  recentOrders: Order[];
  /** Past-dated or terminal bookings, most recent first. */
  recentBookings: Booking[];
};

const bookingAsc = (a: Booking, b: Booking) => `${a.bookingDate}${a.startTime}`.localeCompare(`${b.bookingDate}${b.startTime}`);

/**
 * Splits orders + bookings into the Activity sections. `today` is a
 * YYYY-MM-DD business-local date (see time.ts `todayPkt`); pass it in so
 * tests control time deterministically.
 */
export function partitionActivity(orders: Order[], bookings: Booking[], today: string): ActivityPartition {
  const happeningNowOrders = orders.filter((o) => isActiveOrder(o.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const todays = bookings
    .filter((b) => !isTerminalBooking(b.status) && b.bookingDate === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const upcoming = bookings.filter((b) => !isTerminalBooking(b.status) && b.bookingDate > today).sort(bookingAsc);
  const todaysSet = new Set(todays);
  const upcomingSet = new Set(upcoming);
  const past = bookings.filter((b) => !todaysSet.has(b) && !upcomingSet.has(b)).sort((a, b) => -bookingAsc(a, b));

  return {
    happeningNowOrders,
    happeningNowBookings: todays,
    upcomingBookings: upcoming,
    recentOrders: orders.filter((o) => !isActiveOrder(o.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    recentBookings: past,
  };
}
