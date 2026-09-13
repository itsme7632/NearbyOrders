import { listBusinessBookings, type Booking } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { EmptyState, ErrorState, Loading } from '../components/ui.js';
import { BookingsIcon } from '../components/icons.js';
import { daysBetween, todayPkt } from '../time.js';
import { BookingGroup } from './OwnerBookings.js';

/**
 * Business bookings for one owned business, grouped the same way as the
 * shared OwnerBookings screen (Incoming / Upcoming / History). Reached from
 * Business Dashboard → Bookings.
 */
export function OwnerBookingsList(props: { businessId: string; onOpenBooking: (id: string) => void }) {
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);
  const today = todayPkt();

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

  if (!bookings.data?.length) {
    return (
      <EmptyState
        icon={<BookingsIcon size={30} />}
        title="No customer bookings yet"
        body="Bookings made with your business will appear here."
      />
    );
  }

  return (
    <>
      {pending?.length ? (
        <BookingGroup label="Incoming" hint="Waiting for your response" bookings={pending} onOpenBooking={props.onOpenBooking} />
      ) : null}
      {upcoming?.length ? <BookingGroup label="Upcoming" bookings={upcoming} onOpenBooking={props.onOpenBooking} /> : null}
      {past?.length ? <BookingGroup label="History" bookings={past} onOpenBooking={props.onOpenBooking} /> : null}
    </>
  );
}
