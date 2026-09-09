import { useMemo, useState } from 'react';
import {
  cancelMyBooking,
  getBooking,
  listMyBookings,
  ApiError,
  type Booking,
  type BookingStatus,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { AlertIcon, BookingsIcon, CheckIcon } from '../components/icons.js';
import { daysBetween, formatSlotTime, longDateLabel, todayPkt } from '../time.js';

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export function BookingStatusBadge(props: { status: BookingStatus }) {
  return <span className={`booking-status booking-status-${props.status.toLowerCase()}`}>{STATUS_LABEL[props.status]}</span>;
}

function BookingCard(props: { booking: Booking; onOpen: () => void }) {
  const b = props.booking;
  return (
    <button type="button" className="booking-card" onClick={props.onOpen}>
      <span className="booking-card-main">
        <span className="booking-card-biz">{b.businessName}</span>
        {b.serviceName ? <span className="booking-card-service">{b.serviceName}</span> : null}
        <span className="booking-card-when">
          {longDateLabel(b.bookingDate)} · {formatSlotTime(b.startTime)}
          {b.endTime ? ` – ${formatSlotTime(b.endTime)}` : ''}
        </span>
      </span>
      <span className="booking-card-side">
        {b.priceMinor !== null ? <Money minor={b.priceMinor} currency={b.currency} /> : null}
        <BookingStatusBadge status={b.status} />
      </span>
    </button>
  );
}

/** Signed-in customer view of all their bookings, grouped upcoming/past. */
export function BookingsScreen(props: { onOpenBooking: (id: string) => void; onExplore: () => void }) {
  const bookings = useAsyncData<Booking[]>(() => listMyBookings(), []);
  const today = todayPkt();

  const groups = useMemo(() => {
    const all = bookings.data ?? [];
    // Upcoming = today or later, not cancelled/rejected/completed. Everything
    // else (past dates or terminal statuses) is history.
    const upcoming = all
      .filter((b) => b.status !== 'CANCELLED' && b.status !== 'REJECTED' && b.status !== 'COMPLETED' && daysBetween(today, b.bookingDate) >= 0)
      .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
    const past = all
      .filter((b) => !upcoming.includes(b))
      .sort((a, b) => (b.bookingDate + b.startTime).localeCompare(a.bookingDate + a.startTime));
    return { upcoming, past };
  }, [bookings.data, today]);

  if (bookings.loading) return <Loading label="Loading your bookings…" />;
  if (bookings.error) return <ErrorState message={bookings.error} onRetry={bookings.reload} />;

  if (!bookings.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<BookingsIcon size={30} />}
          title="No bookings yet"
          body="Book a service from any business and it will show up here."
          action={
            <Button onClick={props.onExplore} sm>
              Explore businesses
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen">
      {groups.upcoming.length ? (
        <section aria-label="Upcoming bookings">
          <div className="section-head">
            <h2>Upcoming</h2>
          </div>
          <div className="booking-list">
            {groups.upcoming.map((b) => (
              <BookingCard key={b.id} booking={b} onOpen={() => props.onOpenBooking(b.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {groups.past.length ? (
        <section aria-label="Past bookings">
          <div className="section-head">
            <h2>Past</h2>
          </div>
          <div className="booking-list">
            {groups.past.map((b) => (
              <BookingCard key={b.id} booking={b} onOpen={() => props.onOpenBooking(b.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Single booking detail with cancellation (API/transition permitting). */
export function BookingDetailScreen(props: { bookingId: string; onBack: () => void }) {
  const booking = useAsyncData<Booking>(() => getBooking(props.bookingId), [props.bookingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState<Booking | null>(null);

  const data = cancelled ?? booking.data;

  const doCancel = async () => {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCancelled(await cancelMyBooking(data.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('This booking can no longer be cancelled.');
      else if (e instanceof ApiError && e.status === 0) setError(e.message);
      else setError('Could not cancel the booking. Please try again.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (booking.loading) return <Loading label="Loading booking…" />;
  if (booking.error) return <ErrorState message={booking.error} onRetry={booking.reload} />;
  if (!data)
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState icon={<BookingsIcon size={30} />} title="Booking not found" body="It may have been removed." />
      </div>
    );

  const canCancel = data.status === 'PENDING' || data.status === 'CONFIRMED';

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      <div className="card booking-detail">
        <div className="booking-detail-head">
          <h1>{data.businessName}</h1>
          <BookingStatusBadge status={data.status} />
        </div>
        {data.serviceName ? <p className="booking-detail-service">{data.serviceName}</p> : null}

        <dl className="summary-list">
          <div>
            <dt>Business</dt>
            <dd>{data.businessName}</dd>
          </div>
          {data.serviceName ? (
            <div>
              <dt>Service</dt>
              <dd>{data.serviceName}</dd>
            </div>
          ) : null}
          <div>
            <dt>Date</dt>
            <dd>{longDateLabel(data.bookingDate)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>
              {formatSlotTime(data.startTime)}
              {data.endTime ? ` – ${formatSlotTime(data.endTime)}` : ''}
            </dd>
          </div>
          {data.priceMinor !== null ? (
            <div>
              <dt>Price</dt>
              <dd>
                <Money minor={data.priceMinor} currency={data.currency} />
              </dd>
            </div>
          ) : null}
          {data.notes ? (
            <div>
              <dt>Your note</dt>
              <dd>{data.notes}</dd>
            </div>
          ) : null}
        </dl>

        {data.status === 'PENDING' ? (
          <p className="booking-status-note">Waiting for the business to confirm.</p>
        ) : null}

        {error ? (
          <div className="auth-error" role="alert">
            <AlertIcon size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {data.status === 'CANCELLED' ? (
          <p className="booking-cancelled-note" role="status">
            <AlertIcon size={16} /> This booking was cancelled.
          </p>
        ) : canCancel ? (
          confirming ? (
            <div className="confirm-cancel">
              <p>Cancel this booking? This cannot be undone.</p>
              <div className="btn-row">
                <Button variant="danger" sm onClick={() => void doCancel()} disabled={busy}>
                  {busy ? 'Cancelling…' : 'Yes, cancel it'}
                </Button>
                <Button variant="ghost" sm onClick={() => setConfirming(false)} disabled={busy}>
                  Keep booking
                </Button>
              </div>
            </div>
          ) : (
            <Button full variant="danger" onClick={() => setConfirming(true)}>
              Cancel booking
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
