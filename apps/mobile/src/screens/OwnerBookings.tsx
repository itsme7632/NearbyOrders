import { useState } from 'react';
import {
  getBooking,
  getMyBusinesses,
  listBusinessBookings,
  setBookingStatus,
  ApiError,
  type Booking,
  type BookingStatus,
  type Business,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { AlertIcon, BookingsIcon, CheckIcon, StoreIcon } from '../components/icons.js';
import { daysBetween, formatSlotTime, longDateLabel, todayPkt } from '../time.js';
import { BookingStatusBadge } from './Bookings.js';

/** Display name for the customer on a booking (safe fields only). */
export const customerName = (customer?: Booking['customer']): string => {
  if (!customer) return 'Customer';
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  return name || customer.email;
};

/** Owner list entry: customer + service + when + price + status. */
function OwnerBookingCard(props: { booking: Booking; onOpen: () => void; onChanged: () => void }) {
  const b = props.booking;
  const [busy, setBusy] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (status: 'CONFIRMED' | 'REJECTED') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setBookingStatus(b.id, status);
      setConfirmingReject(false);
      props.onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This booking was already updated. Refreshing…');
        props.onChanged();
      } else {
        setError(e instanceof Error ? e.message : 'Could not update the booking');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="booking-card">
      <button type="button" className="booking-card-open" onClick={props.onOpen} aria-label={`Open booking for ${customerName(b.customer)}`}>
        <span className="booking-card-main">
          <span className="booking-card-biz">{customerName(b.customer)}</span>
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
      {b.status === 'PENDING' ? (
        <div className="booking-card-actions">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {confirmingReject ? (
            <>
              <span className="confirm-delete-text" role="alert">Reject this booking? This cannot be undone.</span>
              <Button sm variant="danger" disabled={busy} onClick={() => void apply('REJECTED')}>
                {busy ? 'Rejecting…' : 'Yes, reject'}
              </Button>
              <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmingReject(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              <Button sm disabled={busy} onClick={() => void apply('CONFIRMED')}>
                {busy ? 'Accepting…' : 'Accept'}
              </Button>
              <Button sm variant="ghost" disabled={busy} onClick={() => setConfirmingReject(true)}>
                Reject
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Exported for the dedicated Business Bookings dashboard screen. */
export function BookingGroup(props: { label: string; hint?: string; bookings: Booking[]; onOpenBooking: (id: string) => void; onChanged: () => void }) {
  return (
    <section aria-label={`${props.label} section`}>
      <div className="section-head">
        <h2>
          {props.label}
          {props.bookings.length > 0 ? <span className="count-pill">{props.bookings.length}</span> : null}
        </h2>
      </div>
      {props.hint ? <p className="section-hint">{props.hint}</p> : null}
      <div className="booking-list">
        {props.bookings.map((b) => (
          <OwnerBookingCard key={b.id} booking={b} onOpen={() => props.onOpenBooking(b.id)} onChanged={props.onChanged} />
        ))}
      </div>
    </section>
  );
}

/** Business-owner view of all bookings across their businesses, grouped by action needed. */
export function OwnerBookingsScreen(props: { onOpenBooking: (id: string) => void; onListBusiness?: () => void }) {
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses(), []);
  const [businessId, setBusinessId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile and start accepting bookings."
          action={props.onListBusiness ? <Button onClick={props.onListBusiness}>List my business</Button> : null}
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === businessId) ?? businesses.data[0];
  const switcher =
    businesses.data.length > 1 ? (
      <div className="filter-row" aria-label="Switch business">
        {businesses.data.map((b) => (
          <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setBusinessId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    ) : null;

  return <OwnerBookingList businessId={active.id} switcher={switcher} onOpenBooking={props.onOpenBooking} />;
}

function OwnerBookingList(props: { businessId: string; switcher: React.ReactNode; onOpenBooking: (id: string) => void }) {
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);
  const today = todayPkt();

  // Incoming: awaiting a decision (earliest first). Upcoming: confirmed and
  // today or later. Everything else (completed/cancelled/declined/past) is history.
  const pending = bookings.data
    ?.filter((b) => b.status === 'PENDING')
    .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
  const upcoming = bookings.data
    ?.filter((b) => b.status === 'CONFIRMED' && daysBetween(today, b.bookingDate) >= 0)
    .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
  const past = bookings.data
    ?.filter((b) => !pending?.includes(b) && !upcoming?.includes(b))
    .sort((a, b) => (b.bookingDate + b.startTime).localeCompare(a.bookingDate + a.startTime));

  if (bookings.loading) return <Loading label="Loading bookings…" />;
  if (bookings.error) return <ErrorState message={bookings.error} onRetry={bookings.reload} />;

  return (
    <div className="screen">
      {props.switcher}
      {!bookings.data?.length ? (
        <EmptyState
          icon={<BookingsIcon size={30} />}
          title="No customer bookings yet"
          body="Bookings made with your business will appear here."
        />
      ) : (
        <>
          {pending?.length ? (
            <BookingGroup label="Incoming" hint="Waiting for your response" bookings={pending} onOpenBooking={props.onOpenBooking} onChanged={bookings.reload} />
          ) : null}
          {upcoming?.length ? <BookingGroup label="Upcoming" bookings={upcoming} onOpenBooking={props.onOpenBooking} onChanged={bookings.reload} /> : null}
          {past?.length ? <BookingGroup label="History" bookings={past} onOpenBooking={props.onOpenBooking} onChanged={bookings.reload} /> : null}
        </>
      )}
    </div>
  );
}

type Action = 'CONFIRMED' | 'REJECTED' | 'COMPLETED';

/** Owner booking detail with lifecycle actions; the API stays authoritative. */
export function OwnerBookingDetailScreen(props: { bookingId: string; onBack: () => void }) {
  const booking = useAsyncData<Booking>(() => getBooking(props.bookingId), [props.bookingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [updated, setUpdated] = useState<Booking | null>(null);

  const data = updated ?? booking.data;

  const apply = async (action: Action) => {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      setUpdated(await setBookingStatus(data.id, action));
      setConfirming(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setStale(true);
        setError('This booking has already been updated. Please refresh.');
      } else if (e instanceof ApiError && e.status === 404) {
        setError('This booking was not found.');
      } else if (e instanceof ApiError && e.status === 0) {
        setError(e.message);
      } else {
        setError('Could not update the booking. Please try again.');
      }
    } finally {
      setBusy(false);
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

  const status: BookingStatus = data.status;
  const note = confirming
    ? confirming === 'REJECTED'
      ? 'Reject this booking? This cannot be undone.'
      : confirming === 'COMPLETED'
        ? 'Mark this booking as completed?'
        : 'Accept this booking?'
    : null;

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>

      <div className="card booking-detail">
        <div className="booking-detail-head">
          <h1>{customerName(data.customer)}</h1>
          <BookingStatusBadge status={status} />
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
          {data.customer ? (
            <div>
              <dt>Customer email</dt>
              <dd>{data.customer.email}</dd>
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
          {data.endTime ? (
            <div>
              <dt>Duration</dt>
              <dd>{durationMinutesLabel(data.startTime, data.endTime)}</dd>
            </div>
          ) : null}
          {data.priceMinor !== null ? (
            <div>
              <dt>Price</dt>
              <dd>
                <Money minor={data.priceMinor} currency={data.currency} />
              </dd>
            </div>
          ) : null}
          {(data.advanceRequiredMinor ?? 0) > 0 ? (
            <div>
              <dt>Advance required</dt>
              <dd>
                <Money minor={data.advanceRequiredMinor ?? 0} currency={data.currency} />
              </dd>
            </div>
          ) : null}
          {(data.advanceRequiredMinor ?? 0) > 0 ? (
            <div>
              <dt>Advance paid</dt>
              <dd>
                <Money minor={data.amountPaidMinor ?? 0} currency={data.currency} />
                {(data.amountPaidMinor ?? 0) >= (data.advanceRequiredMinor ?? 0) ? ' ✓' : ''}
              </dd>
            </div>
          ) : null}
          {data.notes ? (
            <div>
              <dt>Customer note</dt>
              <dd>{data.notes}</dd>
            </div>
          ) : null}
        </dl>

        {status === 'PENDING' ? <p className="booking-status-note">Waiting for your response.</p> : null}
        {status === 'CONFIRMED' ? <p className="booking-status-note">Upcoming booking.</p> : null}
        {status === 'COMPLETED' ? <p className="booking-status-note">This booking is completed.</p> : null}
        {status === 'REJECTED' ? (
          <p className="booking-cancelled-note" role="status">
            <AlertIcon size={16} /> This booking was declined.
          </p>
        ) : null}
        {status === 'CANCELLED' ? (
          <p className="booking-cancelled-note" role="status">
            <AlertIcon size={16} /> This booking was cancelled by the customer.
          </p>
        ) : null}

        {error ? (
          <div className="auth-error" role="alert">
            <AlertIcon size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {stale ? (
          <Button variant="secondary" full onClick={booking.reload}>
            Refresh booking
          </Button>
        ) : status === 'PENDING' ? (
          confirming ? (
            <div className="confirm-cancel">
              <p>{note}</p>
              <div className="btn-row">
                {confirming === 'REJECTED' ? (
                  <Button variant="danger" sm onClick={() => void apply('REJECTED')} disabled={busy}>
                    {busy ? 'Rejecting…' : 'Yes, reject it'}
                  </Button>
                ) : (
                  <Button sm onClick={() => void apply(confirming)} disabled={busy}>
                    {busy ? 'Saving…' : confirming === 'COMPLETED' ? 'Yes, complete it' : 'Yes, accept it'}
                  </Button>
                )}
                <Button variant="ghost" sm onClick={() => setConfirming(null)} disabled={busy}>
                  Keep booking
                </Button>
              </div>
            </div>
          ) : (
            <div className="btn-row">
              <Button full onClick={() => void apply('CONFIRMED')} disabled={busy}>
                <CheckIcon size={16} /> Accept booking
              </Button>
              <Button full variant="danger" onClick={() => setConfirming('REJECTED')} disabled={busy}>
                Reject booking
              </Button>
            </div>
          )
        ) : status === 'CONFIRMED' ? (
          confirming === 'COMPLETED' ? (
            <div className="confirm-cancel">
              <p>{note}</p>
              <div className="btn-row">
                <Button sm onClick={() => void apply('COMPLETED')} disabled={busy}>
                  {busy ? 'Saving…' : 'Yes, complete it'}
                </Button>
                <Button variant="ghost" sm onClick={() => setConfirming(null)} disabled={busy}>
                  Keep booking
                </Button>
              </div>
            </div>
          ) : (
            <Button full variant="secondary" onClick={() => setConfirming('COMPLETED')} disabled={busy}>
              Mark completed
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

/** Human duration between two HH:MM times (server-derived start/end). */
export const durationMinutesLabel = (startHHMM: string, endHHMM: string): string => {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = mins(endHHMM) - mins(startHHMM);
  return diff > 0 ? `${diff} minutes` : '—';
};
