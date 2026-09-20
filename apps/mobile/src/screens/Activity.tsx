import { useMemo, useState } from 'react';
import { getSession, listMyBookings, listMyOrders, type Booking, type Order } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Money } from '../components/ui.js';
import { SegmentedControl } from '../components/primitives.js';
import { ActivityIcon } from '../components/icons.js';
import { formatSlotTime, longDateLabel, todayPkt } from '../time.js';
import { orderLabel, orderNumber, OrderTrack } from './Orders.js';
import { BookingStatusBadge } from './Bookings.js';
import { partitionActivity, type ActivityFilter } from './activityData.js';
import './Activity.css';

export type ActivityScreenProps = {
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
  onBrowse: () => void;
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'orders', label: 'Orders' },
  { value: 'bookings', label: 'Bookings' },
] as const;

const formatPlaced = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Warm Proximity Activity: one timeline of the customer's orders + bookings,
 * composed from the existing Orders/Bookings data sources (no new API).
 *
 * Sections:
 *  - Happening now: in-flight orders + today's unresolved bookings
 *  - Upcoming: future bookings
 *  - Recent activity: completed/cancelled orders + past bookings
 */
export function ActivityScreen(props: ActivityScreenProps) {
  // Read live on every render (not memoized): signing in/out re-renders the
  // app shell, so the screen tracks the session without its own listener.
  const signedIn = getSession() !== null;
  const [filter, setFilter] = useState<ActivityFilter>('all');
  // Signed-out users must not hit authenticated endpoints — resolve to empty.
  const orders = useAsyncData<Order[]>(() => (signedIn ? listMyOrders() : Promise.resolve([])), [signedIn]);
  const bookings = useAsyncData<Booking[]>(() => (signedIn ? listMyBookings() : Promise.resolve([])), [signedIn]);
  const today = todayPkt();

  const parts = useMemo(
    () => partitionActivity(orders.data ?? [], bookings.data ?? [], today),
    [orders.data, bookings.data, today],
  );

  const showOrders = filter !== 'bookings';
  const showBookings = filter !== 'orders';

  const recentItems = useMemo(() => {
    const items: { key: string; t: number; kind: 'order' | 'booking'; order?: Order; booking?: Booking }[] = [];
    if (showOrders)
      for (const order of parts.recentOrders) items.push({ key: `o-${order.id}`, t: Date.parse(order.createdAt), kind: 'order', order });
    if (showBookings)
      for (const booking of parts.recentBookings)
        items.push({
          key: `b-${booking.id}`,
          t: Date.parse(`${booking.bookingDate}T${booking.startTime}:00`),
          kind: 'booking',
          booking,
        });
    return items.sort((a, b) => b.t - a.t);
  }, [parts, showOrders, showBookings]);

  if (!signedIn) {
    // Auth-friendly fallback mirroring the old Orders tab's signed-out state.
    return (
      <div className="screen">
        <EmptyState
          icon={<ActivityIcon size={30} />}
          title="Your activity"
          body="Sign in to see your orders and bookings in one place."
        />
      </div>
    );
  }

  if (orders.loading || bookings.loading) {
    return (
      <div className="screen">
        <header className="owner-head">
          <h1>Activity</h1>
        </header>
        <ListSkeleton count={4} />
      </div>
    );
  }

  if (orders.error || bookings.error) {
    const retry = () => {
      orders.reload();
      bookings.reload();
    };
    return (
      <div className="screen">
        <header className="owner-head">
          <h1>Activity</h1>
        </header>
        <ErrorState message={orders.error ?? bookings.error ?? 'Could not load your activity.'} onRetry={retry} />
      </div>
    );
  }

  const hasAny = parts.happeningNowOrders.length + parts.happeningNowBookings.length + parts.upcomingBookings.length + parts.recentOrders.length + parts.recentBookings.length > 0;
  if (!hasAny) {
    return (
      <div className="screen">
        <header className="owner-head">
          <h1>Activity</h1>
        </header>
        <EmptyState
          icon={<ActivityIcon size={30} />}
          title="Nothing here yet"
          body="Your orders and bookings will show up here as they happen."
          action={<Button onClick={props.onBrowse}>Find businesses</Button>}
        />
      </div>
    );
  }

  const nowOrders = showOrders ? parts.happeningNowOrders : [];
  const nowBookings = showBookings ? parts.happeningNowBookings : [];
  const upcoming = showBookings ? parts.upcomingBookings : [];
  const filterHidesAll = nowOrders.length + nowBookings.length + upcoming.length + recentItems.length === 0;

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Activity</h1>
      </header>

      <div className="act-filter">
        <SegmentedControl
          label="Filter activity"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          full
        />
      </div>

      {filterHidesAll ? (
        <EmptyState
          icon={<ActivityIcon size={26} />}
          title="Nothing in this view"
          body="Try a different filter to see more of your activity."
        />
      ) : (
        <>
          {nowOrders.length + nowBookings.length > 0 ? (
            <section className="act-section" aria-label="Happening now">
              <h2 className="type-section act-section-title">Happening now</h2>
              <ul className="act-list">
                {nowOrders.map((o) => (
                  <li key={`order-${o.id}`}>
                    <NowOrderRow order={o} onOpen={() => props.onOpenOrder(o.id)} />
                  </li>
                ))}
                {nowBookings.map((b) => (
                  <li key={`booking-${b.id}`}>
                    <NowBookingRow booking={b} onOpen={() => props.onOpenBooking(b.id)} todayLabel />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="act-section" aria-label="Upcoming bookings">
              <h2 className="type-section act-section-title">Upcoming</h2>
              <ul className="act-list">
                {upcoming.map((b) => (
                  <li key={b.id}>
                    <NowBookingRow booking={b} onOpen={() => props.onOpenBooking(b.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {recentItems.length > 0 ? (
            <section className="act-section" aria-label="Recent activity">
              <h2 className="type-section act-section-title">Recent activity</h2>
              <ul className="act-list act-list-recent">
                {recentItems.map((it) => {
                  if (it.kind === 'order' && it.order) {
                    const o = it.order;
                    return (
                      <li key={it.key}>
                        <RecentOrderRow order={o} onOpen={() => props.onOpenOrder(o.id)} />
                      </li>
                    );
                  }
                  if (it.booking) {
                    const b = it.booking;
                    return (
                      <li key={it.key}>
                        <RecentBookingRow booking={b} onOpen={() => props.onOpenBooking(b.id)} />
                      </li>
                    );
                  }
                  return null;
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ----------------------- row treatments ----------------------- */

/**
 * Happening-now order row: the fullest treatment. Serif business identity,
 * status line (progress track + badge) that always reads without opening
 * the order, then items/total/placed meta.
 */
function NowOrderRow(props: { order: Order; onOpen: () => void }) {
  const o = props.order;
  const label = orderLabel(o.status);
  const itemCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <button
      type="button"
      className="act-row"
      onClick={props.onOpen}
      aria-label={`Order ${orderNumber(o)} from ${o.business.name}, ${label.text}`}
    >
      <span className="act-main">
        <span className="act-name">{o.business.name}</span>
        <span className="type-meta act-sub">
          {orderNumber(o)} · {itemCount} item{itemCount === 1 ? '' : 's'} · Placed {formatPlaced(o.createdAt)}
        </span>
        <span className="act-status-line">
          <OrderTrack status={o.status} compact />
          <span className={`badge ${label.cls}`}>{label.text}</span>
        </span>
      </span>
      <span className="act-side">
        <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
        <span className="act-chev" aria-hidden>
          ›
        </span>
      </span>
    </button>
  );
}

/**
 * Happening-now / upcoming booking row: calendar block anchors the date so
 * "when" scans instantly, serif business identity, service + time meta,
 * restrained status on the right.
 */
function NowBookingRow(props: { booking: Booking; onOpen: () => void; todayLabel?: boolean }) {
  const b = props.booking;
  const d = new Date(`${b.bookingDate}T00:00:00`);
  const when = props.todayLabel ? `Today, ${formatSlotTime(b.startTime)}` : `${longDateLabel(b.bookingDate)} · ${formatSlotTime(b.startTime)}`;
  return (
    <button
      type="button"
      className="act-row"
      onClick={props.onOpen}
      aria-label={`Booking ${b.serviceName ?? ''} at ${b.businessName}, ${when}`}
    >
      <span className="bk-date" aria-hidden>
        <span className="bk-date-num">{d.getDate()}</span>
        <span className="bk-date-month">{d.toLocaleDateString('en-PK', { month: 'short' })}</span>
      </span>
      <span className="act-main">
        <span className="act-name">{b.businessName}</span>
        <span className="type-meta act-sub">
          {b.serviceName ?? 'Booking'} · {when}
          {b.endTime ? ` – ${formatSlotTime(b.endTime)}` : ''}
        </span>
      </span>
      <span className="act-side">
        <BookingStatusBadge status={b.status} />
        <span className="act-chev" aria-hidden>
          ›
        </span>
      </span>
    </button>
  );
}

/** Recent rows are deliberately compact: name + status + when, no imagery. */
function RecentOrderRow(props: { order: Order; onOpen: () => void }) {
  const o = props.order;
  const label = orderLabel(o.status);
  return (
    <button
      type="button"
      className="act-row act-row-compact"
      onClick={props.onOpen}
      aria-label={`Order ${orderNumber(o)} from ${o.business.name}, ${label.text}`}
    >
      <span className="act-main">
        <span className="act-recent-name">{o.business.name}</span>
        <span className="type-meta act-sub">
          Order {orderNumber(o)} · {label.text} · {formatPlaced(o.createdAt)}
        </span>
      </span>
      <span className="act-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}

function RecentBookingRow(props: { booking: Booking; onOpen: () => void }) {
  const b = props.booking;
  return (
    <button
      type="button"
      className="act-row act-row-compact"
      onClick={props.onOpen}
      aria-label={`Booking ${b.serviceName ?? ''} at ${b.businessName}, ${longDateLabel(b.bookingDate)}`}
    >
      <span className="act-main">
        <span className="act-recent-name">{b.serviceName ?? 'Booking'}</span>
        <span className="type-meta act-sub">
          {b.businessName} · {longDateLabel(b.bookingDate)}
        </span>
      </span>
      <span className="act-side">
        <BookingStatusBadge status={b.status} />
        <span className="act-chev" aria-hidden>
          ›
        </span>
      </span>
    </button>
  );
}
