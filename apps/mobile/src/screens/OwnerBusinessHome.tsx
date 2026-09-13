import { useState } from 'react';
import {
  getMyBusinesses,
  listBusinessBookings,
  listBusinessOrders,
  listOwnerPayments,
  type Booking,
  type Business,
  type Order,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading } from '../components/ui.js';
import { AlertIcon, BookingsIcon, CheckIcon, OrdersIcon, StoreIcon } from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';
import { SubscriptionBadge } from './subscription-badge.js';

/**
 * Business-mode Overview (/owner): the owner's real numbers for the selected
 * business plus the Manage My Business hub. Real data only: every count comes
 * from the server endpoints; nothing is invented while loading.
 */
export function OwnerBusinessHome(props: {
  onOpen: (path: string) => void;
  onListBusiness?: () => void;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
}) {
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <ListSkeleton count={3} />;
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

  // The selected business defaults to the first owned one; switching updates
  // every stat and management link below (server ownership still enforced).
  const active = businesses.data.find((b) => b.id === selectedId) ?? businesses.data[0];
  const base = `/owner/${active.id}`;
  const place = [active.locality, active.city].filter(Boolean).join(', ');

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Business Overview</h1>
      </header>

      {/* Selected business identity: image, name, place, status. */}
      <div className="biz-card" aria-label="Selected business">
        <span className="biz-card-imgwrap biz-card-imgwrap-sm">
          {active.imageUrl ? (
            <img className="biz-card-img" src={active.imageUrl} alt="" />
          ) : (
            <span className="detail-hero-fallback" aria-hidden>
              <StoreIcon size={30} />
            </span>
          )}
          <span className="biz-card-cat">{active.status ?? 'PENDING'}</span>
        </span>
        <span className="biz-card-body">
          <span className="biz-card-titlerow">
            <span className="biz-card-name">{active.name}</span>
            {active.isVerified ? <span className="verified-dot" title="Verified">✓</span> : null}
          </span>
          {place ? <span className="biz-card-meta">📍 {place}</span> : null}
        </span>
      </div>

      {businesses.data.length > 1 ? (
        <div className="filter-row" aria-label="Switch business">
          {businesses.data.map((b) => (
            <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      <SubscriptionBadge businessId={active.id} />

      <OverviewStats businessId={active.id} onOpen={props.onOpen} base={base} />

      <h2 className="hub-manage-title">Manage my business</h2>
      <OwnerHubSection label="Business">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business Profile" subtitle="Name, description, contact, categories" onClick={() => props.onOpen(`${base}/profile`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Business Hours" subtitle="Opening times for each day" onClick={() => props.onOpen(`${base}/hours`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Delivery & COD" subtitle="Own-rider delivery and cash on delivery" onClick={() => props.onOpen(`${base}/delivery`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Catalog">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Services" subtitle="Bookable services and advances" onClick={() => props.onOpen(`${base}/services`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Products & Menu" subtitle="Products customers can order" onClick={() => props.onOpen(`${base}/products`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Operations">
        <OwnerHubRow icon={<BookingsIcon size={18} />} title="Bookings" subtitle="Incoming and upcoming bookings" onClick={() => props.onOpen(`${base}/bookings`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Orders" subtitle="Incoming orders and cash collection" onClick={() => props.onOpen(`${base}/orders`)} />
        <OwnerHubRow icon={<AlertIcon size={18} />} title="Customer Payments" subtitle="Verify customer payment proofs" onClick={() => props.onOpen(`${base}/payments`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Payments">
        <OwnerHubRow icon={<AlertIcon size={18} />} title="Business Payment Methods" subtitle="Channels customers pay you through" onClick={() => props.onOpen(`${base}/payment-methods`)} />
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Service Advance Settings" subtitle="Per-service advance requirements" onClick={() => props.onOpen(`${base}/advances`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Trust">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Reviews" subtitle="What customers say about you" onClick={() => props.onOpen(`${base}/reviews`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Account">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business Subscription" subtitle="Trial, plan and manual payments" onClick={() => props.onOpen(`${base}/subscription`)} />
        <OwnerHubRow icon={<CheckIcon size={18} />} title="Business Settings" subtitle="Delivery, COD and payment channels" onClick={() => props.onOpen(`${base}/settings`)} />
      </OwnerHubSection>

      {props.onListBusiness ? (
        <div className="card">
          <Button full variant="ghost" onClick={props.onListBusiness}>
            List another business
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Real metrics for the selected business; cards link to their screens. */
function OverviewStats(props: { businessId: string; onOpen: (path: string) => void; base: string }) {
  const orders = useAsyncData<Order[]>(() => listBusinessOrders(props.businessId), [props.businessId]);
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);
  const payments = useAsyncData(() => listOwnerPayments('PENDING_VERIFICATION'), [props.businessId]);

  if (orders.loading || bookings.loading || payments.loading) return <ListSkeleton count={2} />;
  if (orders.error || bookings.error || payments.error)
    return <ErrorState message={orders.error ?? bookings.error ?? payments.error ?? 'Could not load your numbers.'} />;

  // Metrics come straight from the scoped endpoints — never invented.
  const ordersHere = (orders.data ?? []).filter((o) => o.business.id === props.businessId);
  const today = new Date().toISOString().slice(0, 10);
  const pendingOrders = ordersHere.filter((o) => o.status === 'PENDING');
  const todaysOrders = ordersHere.filter((o) => o.createdAt.slice(0, 10) === today && !['CANCELLED', 'REJECTED'].includes(o.status));
  const pendingBookings = (bookings.data ?? []).filter((b) => b.status === 'PENDING');
  const todaysBookings = (bookings.data ?? []).filter((b) => b.bookingDate === today && ['PENDING', 'CONFIRMED'].includes(b.status));
  const pendingPayments = (payments.data?.bookingPayments.length ?? 0) + (payments.data?.orderPayments.length ?? 0);

  return (
    <section aria-label="Overview metrics">
      <div className="metric-grid">
        <button type="button" className="metric-card" onClick={() => props.onOpen(`${props.base}/orders`)}>
          <span className="metric-num">{pendingOrders.length}</span>
          <span className="metric-label">Pending orders</span>
        </button>
        <div className="metric-card">
          <span className="metric-num">{todaysOrders.length}</span>
          <span className="metric-label">Today's orders</span>
        </div>
        <button type="button" className="metric-card" onClick={() => props.onOpen(`${props.base}/bookings`)}>
          <span className="metric-num">{pendingBookings.length}</span>
          <span className="metric-label">Pending bookings</span>
        </button>
        <div className="metric-card">
          <span className="metric-num">{todaysBookings.length}</span>
          <span className="metric-label">Today's bookings</span>
        </div>
      </div>
      <button type="button" className="metric-card metric-card-wide" onClick={() => props.onOpen(`${props.base}/payments`)}>
        <span className="metric-num">{pendingPayments}</span>
        <span className="metric-label">Payments to verify</span>
      </button>
    </section>
  );
}
