import { useState } from 'react';
import { getMyBusinesses, listBusinessBookings, type Booking } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { BookingsIcon, StoreIcon } from '../components/icons.js';
import { daysBetween, todayPkt } from '../time.js';
import { BookingGroup } from './OwnerBookings.js';

/**
 * Business-mode Bookings tab: incoming bookings for the selected owned
 * business, grouped the same way as the shared owner bookings screen.
 */
export function OwnerBusinessBookings(props: { onOpenBooking: (id: string) => void; onListBusiness?: () => void }) {
  const businesses = useAsyncData(() => getMyBusinesses(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile to start taking bookings."
          action={props.onListBusiness ? <Button onClick={props.onListBusiness}>List my business</Button> : null}
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === selectedId) ?? businesses.data[0];
  const switcher =
    businesses.data.length > 1 ? (
      <div className="filter-row" aria-label="Switch business">
        {businesses.data.map((b) => (
          <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    ) : null;

  return <BookingsForBusiness businessId={active.id} switcher={switcher} onOpenBooking={props.onOpenBooking} />;
}

function BookingsForBusiness(props: { businessId: string; switcher?: React.ReactNode; onOpenBooking: (id: string) => void }) {
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);
  const today = todayPkt();

  if (bookings.loading) return <Loading label="Loading bookings…" />;
  if (bookings.error) return <ErrorState message={bookings.error} onRetry={bookings.reload} />;

  // Same grouping as the shared OwnerBookings screen.
  const data = bookings.data ?? [];
  const pending = data
    .filter((b) => b.status === 'PENDING')
    .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
  const upcoming = data
    .filter((b) => b.status === 'CONFIRMED' && daysBetween(today, b.bookingDate) >= 0)
    .sort((a, b) => (a.bookingDate + a.startTime).localeCompare(b.bookingDate + b.startTime));
  const past = data
    .filter((b) => !pending.includes(b) && !upcoming.includes(b))
    .sort((a, b) => (b.bookingDate + b.startTime).localeCompare(a.bookingDate + a.startTime));

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Bookings</h1>
      </header>
      {props.switcher}
      {!data.length ? (
        /* Business-mode empty state: never the customer wording. */
        <EmptyState
          icon={<BookingsIcon size={30} />}
          title="No customer bookings yet"
          body="Bookings made with your business will appear here."
        />
      ) : (
        <>
          {pending.length ? (
            <BookingGroup label="Incoming" hint="Waiting for your response" bookings={pending} onOpenBooking={props.onOpenBooking} />
          ) : null}
          {upcoming.length ? <BookingGroup label="Upcoming" bookings={upcoming} onOpenBooking={props.onOpenBooking} /> : null}
          {past.length ? <BookingGroup label="History" bookings={past} onOpenBooking={props.onOpenBooking} /> : null}
        </>
      )}
    </div>
  );
}
