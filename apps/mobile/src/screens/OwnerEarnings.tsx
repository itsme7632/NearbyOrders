import { useState } from 'react';
import {
  getMyBusinesses,
  listBusinessBookings,
  listBusinessOrders,
  type Booking,
  type Order,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money } from '../components/ui.js';
import { StoreIcon } from '../components/icons.js';

/**
 * Business-mode Earnings tab: reporting only, from data the app already has.
 * Money stays where it always was — collected directly by the business from
 * the customer. NearbyOrders holds nothing and pays out nothing.
 */
export function OwnerEarnings(props: { onListBusiness?: () => void }) {
  const businesses = useAsyncData(() => getMyBusinesses(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <ListSkeleton count={2} />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Earnings appear once customers complete orders and bookings."
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

  return <EarningsForBusiness businessId={active.id} switcher={switcher} />;
}

function EarningsForBusiness(props: { businessId: string; switcher?: React.ReactNode }) {
  const orders = useAsyncData<Order[]>(() => listBusinessOrders(props.businessId), [props.businessId]);
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);

  if (orders.loading || bookings.loading) return <ListSkeleton count={3} />;
  if (orders.error) return <ErrorState message={orders.error} onRetry={orders.reload} />;
  if (bookings.error) return <ErrorState message={bookings.error} onRetry={bookings.reload} />;

  const ordersHere = (orders.data ?? []).filter((o) => o.business.id === props.businessId);
  const completedOrders = ordersHere.filter((o) => o.status === 'COMPLETED');
  // Collected revenue: completed order totals the business received.
  const orderRevenue = completedOrders.reduce((sum, o) => sum + (o.totalMinor ?? o.subtotalMinor), 0);
  const openOrders = ordersHere.filter((o) => !['CANCELLED', 'REJECTED', 'COMPLETED'].includes(o.status));
  const openValue = openOrders.reduce((sum, o) => sum + (o.totalMinor ?? o.subtotalMinor), 0);

  const bookingsHere = bookings.data ?? [];
  const completedBookings = bookingsHere.filter((b) => b.status === 'COMPLETED');
  const bookingRevenue = completedBookings.reduce((sum, b) => sum + (b.amountPaidMinor ?? b.priceMinor ?? 0), 0);
  const currency = ordersHere[0]?.currency ?? bookingsHere[0]?.currency ?? 'PKR';

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Earnings</h1>
      </header>
      {props.switcher}
      <section className="card" aria-label="Earnings summary">
        <h2>Collected</h2>
        <div className="metric-grid" style={{ marginTop: 10 }}>
          <div className="metric-card">
            <span className="metric-num">
              <Money minor={orderRevenue + bookingRevenue} currency={currency} />
            </span>
            <span className="metric-label">Total collected</span>
          </div>
          <div className="metric-card">
            <span className="metric-num">{completedOrders.length + completedBookings.length}</span>
            <span className="metric-label">Completed transactions</span>
          </div>
        </div>
        <div className="cart-summary">
          <div className="cart-line">
            <span>Completed orders ({completedOrders.length})</span>
            <Money minor={orderRevenue} currency={currency} />
          </div>
          <div className="cart-line">
            <span>Completed bookings ({completedBookings.length})</span>
            <Money minor={bookingRevenue} currency={currency} />
          </div>
        </div>
        {openOrders.length > 0 ? (
          <>
            <h2>In progress</h2>
            <div className="cart-summary">
              <div className="cart-line">
                <span>Active orders ({openOrders.length})</span>
                <Money minor={openValue} currency={currency} />
              </div>
            </div>
            <p className="hint">These amounts are still with customers or awaiting verification; they are not collected yet.</p>
          </>
        ) : null}
        <p className="hint">
          Customers pay you directly. NearbyOrders never holds customer money and takes no cut of these amounts.
        </p>
      </section>
    </div>
  );
}
