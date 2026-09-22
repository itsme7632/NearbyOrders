import { useState } from 'react';
import {
  getMyBusinesses,
  getOwnerAnalytics,
  getOwnerOverview,
  type Business,
  type OwnerAnalytics,
  type OwnerOverview,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Money } from '../components/ui.js';
import {
  ActivityIcon,
  AlertIcon,
  BookingsIcon,
  CheckIcon,
  ExploreIcon,
  HeartIcon,
  InfoIcon,
  OrdersIcon,
  PinIcon,
  StarIcon,
  StoreIcon,
  HelpIcon,
} from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';
import { OrderThumb } from './Orders.js';

/**
 * Business-mode Overview: "How is my business doing?" at a glance.
 *
 * Hierarchy (per the Business Owner reference): greeting header → business
 * status → key metrics (all server-computed, never invented) → needs
 * attention → calmly grouped management rows. Every old dashboard
 * destination is still one tap away via the tab bar or a management row;
 * the Overview itself is now a calm summary — recent orders, upcoming
 * bookings, and earnings detail live on their dedicated tabs.
 */
export function OwnerBusinessHome(props: {
  onOpen: (path: string) => void;
  onListBusiness?: () => void;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
  justCreatedName?: string | null;
  justCreatedStatus?: string | null;
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="screen">
      {props.justCreatedName ? (
        <div className="created-banner" role="status">
          <CheckIcon size={16} />
          <span>
            <strong>{props.justCreatedName}</strong> has been created. Add your services and opening hours below.
            {props.justCreatedStatus === 'APPROVED'
              ? " It's now visible to customers."
              : ' It will appear in customer search once approved.'}
          </span>
        </div>
      ) : null}

      {/* Greeting header: who is operating, and the business avatar. */}
      <header className="owner-greet">
        <div className="owner-greet-text">
          <p className="owner-greet-hello">{greeting},</p>
          <h1 className="owner-greet-name">{active.name}!</h1>
          <p className="owner-sub">Manage your business and grow with NearbyOrders.</p>
        </div>
        <span className="owner-avatar" aria-hidden>
          <OrderThumb name={active.name} imageUrl={active.imageUrl} />
        </span>
      </header>

      {/* Business switcher (only when the owner runs several businesses). */}
      {businesses.data.length > 1 ? (
        <div className="filter-row" role="group" aria-label="Switch business" style={{ marginTop: 4 }}>
          {businesses.data.map((b) => (
            <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Business status: the first answer to "how is my business doing?" */}
      <BusinessStatusCard business={active} />

      {/* Key metrics — server-computed this-month figures plus the real
          customer rating. Deltas are not shown: the backend does not track
          them, and they are never invented. */}
      <OverviewMetrics businessId={active.id} business={active} />

      {/* Everything actionable, then the calm management groups. */}
      <OverviewAttention
        businessId={active.id}
        onOpen={props.onOpen}
        base={base}
        onOpenBooking={props.onOpenBooking}
        onOpenOrder={props.onOpenOrder}
      />

      <h2 className="hub-manage-title">Manage your business</h2>
      <OwnerHubSection label="Business">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business information" subtitle="Name, address, contact, category" onClick={() => props.onOpen(`${base}/profile`)} />
        <OwnerHubRow icon={<PinIcon size={18} />} title="Location" subtitle="Set your address and pin on map" onClick={() => props.onOpen(`${base}/location`)} />
        <OwnerHubRow icon={<BookingsIcon size={18} />} title="Business hours" subtitle="Set your operating hours" onClick={() => props.onOpen(`${base}/hours`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Catalog">
        <OwnerHubRow icon={<ActivityIcon size={18} />} title="Services" subtitle="Add and manage your services" onClick={() => props.onOpen(`${base}/services`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Products / Menu" subtitle="Add products or menu items" onClick={() => props.onOpen(`${base}/products`)} />
      </OwnerHubSection>
      <OwnerHubSection label="Growth & account">
        <OwnerHubRow icon={<StarIcon size={18} />} title="Subscription" subtitle="Trial, plan and manual payments" onClick={() => props.onOpen(`${base}/subscription`)} />
        <OwnerHubRow icon={<HeartIcon size={18} />} title="Reviews" subtitle="What customers say about you" onClick={() => props.onOpen(`${base}/reviews`)} />
        <OwnerHubRow icon={<AlertIcon size={18} />} title="Customer payments" subtitle="Verify customer payment proofs" onClick={() => props.onOpen(`${base}/payments`)} />
        <OwnerHubRow icon={<ExploreIcon size={18} />} title="Delivery & COD" subtitle="Own-rider delivery and cash on delivery" onClick={() => props.onOpen(`${base}/delivery`)} />
        <OwnerHubRow icon={<CheckIcon size={18} />} title="Business payment methods" subtitle="Channels customers pay you through" onClick={() => props.onOpen(`${base}/payment-methods`)} />
        <OwnerHubRow icon={<InfoIcon size={18} />} title="Service advance settings" subtitle="Per-service advance requirements" onClick={() => props.onOpen(`${base}/advances`)} />
        <OwnerHubRow icon={<HelpIcon size={18} />} title="Business settings" subtitle="Delivery, COD and payment channels" onClick={() => props.onOpen(`${base}/settings`)} />
      </OwnerHubSection>

      {props.onListBusiness ? (
        <div className="card" style={{ marginTop: 12 }}>
          <Button full variant="ghost" onClick={props.onListBusiness}>
            List another business
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Live/pending status of the operating business — honest, from the server. */
function BusinessStatusCard({ business }: { business: Business }) {
  const approved = business.status === 'APPROVED';
  const pending = business.status === 'PENDING';
  return (
    <section className="biz-status" aria-label="Business status" data-status={approved ? 'active' : pending ? 'pending' : 'other'}>
      <span className="biz-status-dot" aria-hidden />
      <span className="biz-status-main">
        <span className="biz-status-title">
          {approved ? 'Business active' : pending ? 'Pending approval' : `Status: ${business.status ?? 'Unknown'}`}
        </span>
        <span className="biz-status-sub">
          {approved
            ? 'Your business is visible to customers.'
            : pending
              ? 'Your business will appear in customer search once approved.'
              : 'Check your business status with support.'}
        </span>
      </span>
    </section>
  );
}

/**
 * The three headline metrics: this month's bookings, the real average
 * customer rating, and this month's collected revenue. All server-computed.
 */
function OverviewMetrics({ businessId, business }: { businessId: string; business: Business }) {
  const analytics = useAsyncData<OwnerAnalytics>(() => getOwnerAnalytics(businessId, 'month'), [businessId]);

  const rating = business.averageRating;
  const reviewCount = business.reviewCount ?? 0;

  return (
    <section aria-label="Key metrics" style={{ marginTop: 12 }}>
      {analytics.loading ? (
        <ListSkeleton count={1} />
      ) : analytics.error ? (
        <ErrorState message={analytics.error} onRetry={analytics.reload} />
      ) : analytics.data ? (
        <div className="metric-trio">
          <div className="metric-tile">
            <span className="metric-tile-num">{analytics.data.bookings.total}</span>
            <span className="metric-tile-label">Total bookings</span>
            <span className="metric-tile-sub">This month</span>
          </div>
          <div className="metric-tile">
            <span className="metric-tile-num">{rating != null ? rating.toFixed(1) : '—'}</span>
            <span className="metric-tile-label">Avg. rating</span>
            <span className="metric-tile-sub">{reviewCount > 0 ? `(${reviewCount} review${reviewCount === 1 ? '' : 's'})` : 'No reviews yet'}</span>
          </div>
          <div className="metric-tile">
            <span className="metric-tile-num metric-tile-money">
              <Money minor={analytics.data.orders.revenueMinor + analytics.data.bookings.revenueMinor} currency="PKR" />
            </span>
            <span className="metric-tile-label">Revenue</span>
            <span className="metric-tile-sub">Collected this month</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Needs attention + profile gaps: the only interruptive content on the
 * overview. Every item is one tap from its action; when there is nothing,
 * the dashboard stays quiet.
 */
function OverviewAttention(props: {
  businessId: string;
  onOpen: (path: string) => void;
  base: string;
  onOpenBooking: (id: string) => void;
  onOpenOrder: (id: string) => void;
}) {
  const overview = useAsyncData<OwnerOverview>(() => getOwnerOverview(props.businessId), [props.businessId]);

  if (overview.loading) return <ListSkeleton count={1} />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return null;
  const o = overview.data;

  const attention = [
    o.needsAttention.pendingOrders > 0
      ? {
          key: 'orders',
          count: o.needsAttention.pendingOrders,
          label: o.needsAttention.pendingOrders === 1 ? 'order' : 'orders',
          detail: 'waiting for your accept or reject',
          onClick: () => props.onOpen(`${props.base}/orders`),
        }
      : null,
    o.needsAttention.pendingBookings > 0
      ? {
          key: 'bookings',
          count: o.needsAttention.pendingBookings,
          label: o.needsAttention.pendingBookings === 1 ? 'booking' : 'bookings',
          detail: 'waiting for your confirm or decline',
          onClick: () => props.onOpen(`${props.base}/bookings`),
        }
      : null,
    o.needsAttention.pendingPayments > 0
      ? {
          key: 'payments',
          count: o.needsAttention.pendingPayments,
          label: o.needsAttention.pendingPayments === 1 ? 'payment proof' : 'payment proofs',
          detail: 'awaiting verification',
          onClick: () => props.onOpen(`${props.base}/payments`),
        }
      : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <>
      <section aria-label="Needs attention" style={{ marginTop: 12 }}>
        {attention.length ? (
          <div className="activity-card">
            {attention.map((a) => (
              <button key={a.key} type="button" className="activity-row attention-row" onClick={a.onClick}>
                <span className="activity-icon tone-yellow" aria-hidden>
                  <AlertIcon size={18} />
                </span>
                <span className="activity-main">
                  <span className="activity-title">
                    {a.count} {a.label}
                  </span>{' '}
                  <span className="activity-sub">{a.detail}</span>
                </span>
                <span className="activity-when" aria-hidden>
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="calm-note" role="status">
            <CheckIcon size={16} /> All caught up. Nothing needs your action right now.
          </p>
        )}
      </section>
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
    <section aria-label="Complete your profile" style={{ marginTop: 14 }}>
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
              <span className="activity-when" aria-hidden>
                ›
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
