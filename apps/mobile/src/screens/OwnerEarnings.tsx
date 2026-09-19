import { useState } from 'react';
import { getMyBusinesses, getOwnerEarnings, type OwnerEarnings as OwnerEarningsData } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Money } from '../components/ui.js';
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
  const earnings = useAsyncData<OwnerEarningsData>(() => getOwnerEarnings(props.businessId), [props.businessId]);

  if (earnings.loading) return <ListSkeleton count={3} />;
  if (earnings.error) return <ErrorState message={earnings.error} onRetry={earnings.reload} />;
  if (!earnings.data) return null;
  const e = earnings.data;
  const currency = e.currency;

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
              <Money minor={e.collected.totalMinor} currency={currency} />
            </span>
            <span className="metric-label">Total collected</span>
          </div>
          <div className="metric-card">
            <span className="metric-num">{e.collected.completedOrders + e.collected.completedBookings}</span>
            <span className="metric-label">Completed transactions</span>
          </div>
        </div>
        <div className="cart-summary">
          <div className="cart-line">
            <span>Completed orders ({e.collected.completedOrders})</span>
            <Money minor={e.collected.ordersRevenueMinor} currency={currency} />
          </div>
          <div className="cart-line">
            <span>Completed bookings ({e.collected.completedBookings})</span>
            <Money minor={e.collected.bookingsRevenueMinor} currency={currency} />
          </div>
        </div>
        {e.awaitingVerification.count > 0 ? (
          <div className="cart-summary">
            <div className="cart-line">
              <span>Awaiting verification ({e.awaitingVerification.count})</span>
              <Money minor={e.awaitingVerification.amountMinor} currency={currency} />
            </div>
          </div>
        ) : null}
        {e.inProgress.orders > 0 ? (
          <>
            <h2>In progress</h2>
            <div className="cart-summary">
              <div className="cart-line">
                <span>Active orders ({e.inProgress.orders})</span>
                <Money minor={e.inProgress.valueMinor} currency={currency} />
              </div>
            </div>
            <p className="hint">These amounts are still with customers or awaiting verification; they are not collected yet.</p>
          </>
        ) : null}
        <p className="hint">
          Collected counts only completed orders and bookings, at their frozen totals. Cancelled, rejected and unpaid amounts are never counted. Customers pay you directly — NearbyOrders never holds customer money and takes no cut of these amounts.
        </p>
      </section>
    </div>
  );
}
