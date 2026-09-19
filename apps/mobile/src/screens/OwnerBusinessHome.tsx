import { useState } from 'react';
import {
  getMyBusinesses,
  getOwnerAnalytics,
  getOwnerOverview,
  type Business,
  type OwnerAnalytics,
  type OwnerAnalyticsPeriod,
  type OwnerOverview,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Money } from '../components/ui.js';
import { AlertIcon, BookingsIcon, CheckIcon, OrdersIcon, PinIcon, StoreIcon } from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';
import { SubscriptionBadge } from './subscription-badge.js';
import { OrderThumb } from './Orders.js';

/** Business-mode Overview (/owner): server-computed metrics, never invented. */
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

      <OverviewData businessId={active.id} onOpen={props.onOpen} base={base} onOpenBooking={props.onOpenBooking} />
      <PeriodAnalytics businessId={active.id} />

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

/**
 * Everything on the overview that comes from the server snapshot: metrics,
 * today's completed revenue, pending-verification nudge, upcoming bookings
 * and profile gaps. ONE fetch, passed down — no duplicate requests.
 */
function OverviewData(props: {
  businessId: string;
  onOpen: (path: string) => void;
  base: string;
  onOpenBooking: (id: string) => void;
}) {
  const overview = useAsyncData<OwnerOverview>(() => getOwnerOverview(props.businessId), [props.businessId]);

  if (overview.loading) return <ListSkeleton count={2} />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return null;
  const o = overview.data;

  return (
    <>
      <section aria-label="Overview metrics" style={{ marginTop: 12 }}>
        <div className="metric-grid-v3">
          <button type="button" className="metric-card-v3" onClick={() => props.onOpen(`${props.base}/orders`)}>
            <span className="metric-card-v3-top">
              <span className="metric-card-v3-icon" aria-hidden>
                <OrdersIcon size={16} />
              </span>
              <span className="metric-card-v3-label">Today's orders</span>
            </span>
            <span className="metric-card-v3-num">{o.today.orders}</span>
            <span className="metric-card-v3-label">{o.needsAttention.pendingOrders} pending</span>
          </button>
          <button type="button" className="metric-card-v3" onClick={() => props.onOpen(`${props.base}/bookings`)}>
            <span className="metric-card-v3-top">
              <span className="metric-card-v3-icon" aria-hidden>
                <BookingsIcon size={16} />
              </span>
              <span className="metric-card-v3-label">Today's bookings</span>
            </span>
            <span className="metric-card-v3-num">{o.today.bookings}</span>
            <span className="metric-card-v3-label">{o.needsAttention.pendingBookings} pending</span>
          </button>
        </div>
      </section>

      {/* Completed revenue today, straight from the server's PKT day window. */}
      <section aria-label="Today's revenue" className="card" style={{ marginTop: 12 }}>
        <div className="cart-line">
          <span>Completed revenue today</span>
          <span className="metric-num">
            <Money minor={o.today.revenueMinor} currency={o.business.currency} />
          </span>
        </div>
        {o.needsAttention.pendingPayments > 0 ? (
          <button type="button" className="cart-line attention-row" onClick={() => props.onOpen(`${props.base}/payments`)}>
            <span className="attention-text">
              <strong>{o.needsAttention.pendingPayments}</strong> payment proof{o.needsAttention.pendingPayments === 1 ? '' : 's'} awaiting verification
            </span>
            <span aria-hidden>›</span>
          </button>
        ) : null}
      </section>

      {o.upcomingBookings.length > 0 ? (
        <section aria-label="Upcoming bookings" style={{ marginTop: 18 }}>
          <div className="section-head-v3">
            <h2>Upcoming</h2>
          </div>
          <div className="activity-card">
            {o.upcomingBookings.map((b) => (
              <button key={b.id} type="button" className="activity-row" onClick={() => props.onOpenBooking(b.id)}>
                <span className="activity-icon tone-green" aria-hidden>
                  <BookingsIcon size={18} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">{b.serviceName ?? 'Booking'}</span>
                  <span className="activity-sub">
                    {b.date} · {b.startTime} · {b.customerName} · {b.status.toLowerCase()}
                  </span>
                </span>
                <span className="activity-when" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {renderProfileGaps(o.profileMissing, props.base, props.onOpen)}
    </>
  );
}

/** Missing profile pieces computed from persisted fields — honest, tappable. */
const GAP_LABELS: Record<string, { title: string; suffix: string }> = {
  description: { title: 'Add a business description', suffix: 'profile' },
  phone: { title: 'Add a contact phone number', suffix: 'profile' },
  image: { title: 'Add a business image', suffix: 'profile' },
  hours: { title: 'Set your opening hours', suffix: 'hours' },
  location: { title: 'Set your map location', suffix: 'location' },
  catalog: { title: 'Add your first service or product', suffix: 'services' },
};

function renderProfileGaps(missing: string[], base: string, onOpen: (path: string) => void) {
  if (!missing.length) return null;
  return (
    <section aria-label="Profile gaps" style={{ marginTop: 18 }}>
      <div className="section-head-v3">
        <h2>Complete your profile</h2>
      </div>
      <div className="activity-card">
        {missing.map((key) => {
          const gap = GAP_LABELS[key];
          if (!gap) return null;
          return (
            <button key={key} type="button" className="activity-row" onClick={() => onOpen(`${base}/${gap.suffix}`)}>
              <span className="activity-icon tone-orange" aria-hidden>
                <AlertIcon size={18} />
              </span>
              <span className="activity-main">
                <span className="activity-title">{gap.title}</span>
                <span className="activity-sub">Customers see complete businesses first</span>
              </span>
              <span className="activity-when" aria-hidden>›</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Today / this week / this month performance, server-computed per period. */
function PeriodAnalytics(props: { businessId: string }) {
  const [period, setPeriod] = useState<OwnerAnalyticsPeriod>('today');
  const analytics = useAsyncData<OwnerAnalytics>(() => getOwnerAnalytics(props.businessId, period), [props.businessId, period]);

  return (
    <section aria-label="Performance" style={{ marginTop: 18 }}>
      <div className="section-head-v3">
        <h2>Performance</h2>
      </div>
      <div className="filter-row" role="tablist" aria-label="Performance period">
        {(['today', 'week', 'month'] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} className={`chip${period === p ? ' chip-active' : ''}`} onClick={() => setPeriod(p)}>
            {p === 'today' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
          </button>
        ))}
      </div>
      {analytics.loading ? (
        <ListSkeleton count={1} />
      ) : analytics.error ? (
        <ErrorState message={analytics.error} onRetry={analytics.reload} />
      ) : analytics.data ? (
        <div className="card">
          <div className="cart-line">
            <span>Orders</span>
            <span>
              {analytics.data.orders.total} total · {analytics.data.orders.completed} completed
            </span>
          </div>
          <div className="cart-line">
            <span>Bookings</span>
            <span>
              {analytics.data.bookings.total} total · {analytics.data.bookings.completed} completed
            </span>
          </div>
          <div className="cart-line">
            <span>Completed revenue</span>
            <span className="metric-num">
              <Money minor={analytics.data.orders.revenueMinor + analytics.data.bookings.revenueMinor} currency="PKR" />
            </span>
          </div>
          <div className="cart-line">
            <span>Active catalog</span>
            <span>
              {analytics.data.catalog.activeServices} services · {analytics.data.catalog.activeProducts} products
            </span>
          </div>
          <p className="hint">
            {analytics.data.window.from === analytics.data.window.to ? analytics.data.window.from : `${analytics.data.window.from} – ${analytics.data.window.to}`} · business-local dates
          </p>
        </div>
      ) : null}
    </section>
  );
}
