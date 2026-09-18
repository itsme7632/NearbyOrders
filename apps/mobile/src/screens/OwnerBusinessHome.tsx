import { useState } from 'react';
import {
  getMyBusinesses,
  listBusinessBookings,
  listBusinessOrders,
  listBusinessReviews,
  listOwnerPayments,
  type Booking,
  type Business,
  type Order,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton } from '../components/ui.js';
import { AlertIcon, BookingsIcon, CheckIcon, OrdersIcon, PinIcon, StoreIcon } from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';
import { SubscriptionBadge } from './subscription-badge.js';
import { OrderThumb } from './Orders.js';

/** Business-mode Overview (/owner): real numbers, real activity, real state. */
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
      {/* Identity band: the operating business, its state, and the switcher. */}
      <section aria-label="Selected business" style={{ marginTop: 4 }}>
        <div className="biz-identity">
          <OrderThumb name={active.name} imageUrl={active.imageUrl} />
          <span className="biz-identity-main">
            <span className="biz-identity-name">{active.name}</span>
            <span className="biz-identity-sub">{place || active.address}</span>
          </span>
          <span className={`badge ${active.status === 'APPROVED' ? 'badge-open' : 'badge-closed'}`}>
            {active.status ?? 'PENDING'}
          </span>
        </div>
        {businesses.data.length > 1 ? (
          <div className="filter-row" aria-label="Switch business" style={{ marginTop: 10 }}>
            {businesses.data.map((b) => (
              <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* Business plan: the real subscription state from the backend. */}
      <PlanCard businessId={active.id} onOpen={() => props.onOpen(`${base}/subscription`)} />

      <OverviewStats businessId={active.id} onOpen={props.onOpen} base={base} />

      <RecentActivity
        businessId={active.id}
        onOpenOrder={props.onOpenOrder}
        onOpenBooking={props.onOpenBooking}
        onOpenPayments={() => props.onOpen(`${base}/payments`)}
        onOpenReviews={() => props.onOpen(`${base}/reviews`)}
      />

      {/* Manage band: dense icon rail into the catalog + operations. */}
      <section aria-label="Quick actions" style={{ marginTop: 14 }}>
        <div className="manage-rail">
          <QuickTile icon={<OrdersIcon size={19} />} label="Orders" onClick={() => props.onOpen(`${base}/orders`)} />
          <QuickTile icon={<BookingsIcon size={19} />} label="Bookings" onClick={() => props.onOpen(`${base}/bookings`)} />
          <QuickTile icon={<StoreIcon size={19} />} label="Services" onClick={() => props.onOpen(`${base}/services`)} />
          <QuickTile icon={<StoreIcon size={19} />} label="Products" onClick={() => props.onOpen(`${base}/products`)} />
        </div>
      </section>

      <h2 className="hub-manage-title">Manage</h2>
      <OwnerHubSection label="Business">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business Profile" subtitle="Name, description, contact, categories" onClick={() => props.onOpen(`${base}/profile`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Business Hours" subtitle="Opening times and closed days" onClick={() => props.onOpen(`${base}/hours`)} />
        <OwnerHubRow icon={<PinIcon size={18} />} title="Location" subtitle="Map coordinates so nearby customers find you" onClick={() => props.onOpen(`${base}/location`)} />
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

function QuickTile(props: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="quick-tile" onClick={props.onClick}>
      <span className="quick-tile-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="quick-tile-name">{props.label}</span>
    </button>
  );
}

/**
 * Plan card: renders the real SubscriptionBadge (which owns all fetching)
 * inside the navy hero treatment; the CTA opens the subscription screen.
 */
function PlanCard(props: { businessId: string; onOpen: () => void }) {
  return (
    <section aria-label="Business plan" style={{ marginTop: 14 }}>
      <SubscriptionBadge businessId={props.businessId} variant="hero" onOpen={props.onOpen} />
    </section>
  );
}

/** Real metrics for the selected business; cards link to their screens. */
function OverviewStats(props: { businessId: string; onOpen: (path: string) => void; base: string }) {
  const orders = useAsyncData<Order[]>(() => listBusinessOrders(props.businessId), [props.businessId]);
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);

  if (orders.loading || bookings.loading) return <ListSkeleton count={2} />;
  if (orders.error || bookings.error)
    return <ErrorState message={orders.error ?? bookings.error ?? 'Could not load your numbers.'} />;

  // Metrics come straight from the scoped endpoints — never invented.
  const ordersHere = (orders.data ?? []).filter((o) => o.business.id === props.businessId);
  const today = new Date().toISOString().slice(0, 10);
  const pendingOrders = ordersHere.filter((o) => o.status === 'PENDING');
  const todaysOrders = ordersHere.filter((o) => o.createdAt.slice(0, 10) === today && !['CANCELLED', 'REJECTED'].includes(o.status));
  const pendingBookings = (bookings.data ?? []).filter((b) => b.status === 'PENDING');
  const todaysBookings = (bookings.data ?? []).filter((b) => b.bookingDate === today && ['PENDING', 'CONFIRMED'].includes(b.status));

  return (
    <section aria-label="Overview metrics" style={{ marginTop: 12 }}>
      <div className="metric-grid-v3">
        <button type="button" className="metric-card-v3" onClick={() => props.onOpen(`${props.base}/orders`)}>
          <span className="metric-card-v3-top">
            <span className="metric-card-v3-icon" aria-hidden>
              <OrdersIcon size={16} />
            </span>
            <span className="metric-card-v3-label">Today's orders</span>
          </span>
          <span className="metric-card-v3-num">{todaysOrders.length}</span>
          <span className="metric-card-v3-label">{pendingOrders.length} pending</span>
        </button>
        <button type="button" className="metric-card-v3" onClick={() => props.onOpen(`${props.base}/bookings`)}>
          <span className="metric-card-v3-top">
            <span className="metric-card-v3-icon" aria-hidden>
              <BookingsIcon size={16} />
            </span>
            <span className="metric-card-v3-label">Today's bookings</span>
          </span>
          <span className="metric-card-v3-num">{todaysBookings.length}</span>
          <span className="metric-card-v3-label">{pendingBookings.length} pending</span>
        </button>
      </div>
    </section>
  );
}

type ActivityItem =
  | { kind: 'order'; id: string; title: string; sub: string; when: string }
  | { kind: 'booking'; id: string; title: string; sub: string; when: string }
  | { kind: 'payment'; count: number; title: string; sub: string }
  | { kind: 'review'; title: string; sub: string; when: string };

/**
 * Recent activity built ONLY from real records: the newest orders, bookings,
 * pending payment proofs and reviews for the selected business.
 */
function RecentActivity(props: {
  businessId: string;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
  onOpenPayments: () => void;
  onOpenReviews: () => void;
}) {
  const orders = useAsyncData<Order[]>(() => listBusinessOrders(props.businessId), [props.businessId]);
  const bookings = useAsyncData<Booking[]>(() => listBusinessBookings(props.businessId), [props.businessId]);
  const payments = useAsyncData(() => listOwnerPayments('PENDING_VERIFICATION'), [props.businessId]);
  const reviews = useAsyncData(() => listBusinessReviews(props.businessId, 3), [props.businessId]);

  if (orders.loading || bookings.loading || payments.loading || reviews.loading) return <ListSkeleton count={2} />;
  // Individual feed failures don't sink the whole card; skip the failed source.
  const items: ActivityItem[] = [];

  const rel = (iso: string) => {
    const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  };

  const customerName = (o: Order) => [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || 'Customer';

  for (const o of (orders.data ?? []).filter((x) => x.business.id === props.businessId).slice(0, 3)) {
    items.push({ kind: 'order', id: o.id, title: `New order: ${customerName(o)}`, sub: `${o.items.length} item(s)`, when: rel(o.createdAt) });
  }
  for (const bk of (bookings.data ?? []).filter((x) => x.businessId === props.businessId).slice(0, 2)) {
    items.push({ kind: 'booking', id: bk.id, title: 'New booking', sub: bk.serviceName ?? 'Service', when: rel(bk.createdAt) });
  }
  const orderPayments = payments.data?.orderPayments ?? [];
  const bookingPayments = payments.data?.bookingPayments ?? [];
  const pendingCount = orderPayments.length + bookingPayments.length;
  if (pendingCount > 0) {
    items.push({
      kind: 'payment',
      count: pendingCount,
      title: 'Payment proof submitted',
      sub: 'Waiting for your verification',
    });
  }
  for (const rv of reviews.data?.items.slice(0, 2) ?? []) {
    items.push({ kind: 'review', title: 'New review', sub: `${rv.rating}★ from ${rv.reviewerName}`, when: rel(rv.createdAt) });
  }

  if (!items.length) return null;

  return (
    <section aria-label="Recent activity" style={{ marginTop: 18 }}>
      <div className="section-head-v3">
        <h2>Recent activity</h2>
      </div>
      <div className="activity-card">
        {items.slice(0, 6).map((item) => {
          if (item.kind === 'order')
            return (
              <button key={`o-${item.id}`} type="button" className="activity-row" onClick={() => props.onOpenOrder(item.id)}>
                <span className="activity-icon tone-indigo" aria-hidden>
                  <OrdersIcon size={18} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{item.title}</span>
                  <span className="activity-sub">{item.sub}</span>
                </span>
                <span className="activity-when">{item.when}</span>
              </button>
            );
          if (item.kind === 'booking')
            return (
              <button key={`b-${item.id}`} type="button" className="activity-row" onClick={() => props.onOpenBooking(item.id)}>
                <span className="activity-icon tone-green" aria-hidden>
                  <BookingsIcon size={18} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{item.title}</span>
                  <span className="activity-sub">{item.sub}</span>
                </span>
                <span className="activity-when">{item.when}</span>
              </button>
            );
          if (item.kind === 'payment')
            return (
              <button key="pay" type="button" className="activity-row" onClick={props.onOpenPayments}>
                <span className="activity-icon tone-orange" aria-hidden>
                  <AlertIcon size={18} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{item.title}</span>
                  <span className="activity-sub">{item.count} awaiting verification</span>
                </span>
                <span className="activity-when" aria-hidden>›</span>
              </button>
            );
          return (
            <button key={`r-${item.sub}`} type="button" className="activity-row" onClick={props.onOpenReviews}>
              <span className="activity-icon tone-yellow" aria-hidden>
                ★
              </span>
              <span className="activity-main">
                <span className="activity-title">{item.title}</span>
                <span className="activity-sub">{item.sub}</span>
              </span>
              <span className="activity-when">{item.when}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
