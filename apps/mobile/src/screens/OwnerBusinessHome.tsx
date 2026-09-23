import { useState } from 'react';
import {
  getMyBusinesses,
  getOwnerAnalytics,
  getOwnerOverview,
  type Business,
  type OwnerAnalytics,
  type OwnerOverview,
} from '../api.js';
import { useAsyncData, type AsyncState } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Money } from '../components/ui.js';
import {
  ActivityIcon,
  AlertIcon,
  BookingsIcon,
  CheckIcon,
  ExploreIcon,
  HeartIcon,
  ImageIcon,
  InfoIcon,
  OrdersIcon,
  PinIcon,
  StarIcon,
  StoreIcon,
  HelpIcon,
} from '../components/icons.js';
import { OwnerHubRow } from './owner-ui.js';
import { OwnerPlanCard } from './subscription-badge.js';

/**
 * Business-mode Overview: "How is my business doing?" at a glance.
 *
 * Hierarchy: greeting → business status → plan → monthly snapshot →
 * needs attention → quick actions → calmly grouped management sections
 * (Manage, Catalog, Grow, Account & settings). The app header is rendered
 * once at the shell level (main.tsx) — this screen renders no app header.
 * Every old dashboard destination is still one tap away; the Overview
 * restructures presentation, never destinations.
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

  return (
    <OverviewBody
      businesses={businesses.data}
      selectedId={selectedId}
      onSelectBusiness={setSelectedId}
      onOpen={props.onOpen}
      onOpenOrder={props.onOpenOrder}
      onOpenBooking={props.onOpenBooking}
      justCreatedName={props.justCreatedName}
      justCreatedStatus={props.justCreatedStatus}
    />
  );
}

/** The overview body: one data layer per business, shared by the sections. */
function OverviewBody(props: {
  businesses: Business[];
  selectedId: string | undefined;
  onSelectBusiness: (id: string) => void;
  onOpen: (path: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
  justCreatedName?: string | null;
  justCreatedStatus?: string | null;
}) {
  const { businesses, selectedId, onSelectBusiness, onOpen } = props;

  // The selected business defaults to the first owned one; switching updates
  // every stat and management link below (server ownership still enforced).
  const active = businesses.find((b) => b.id === selectedId) ?? businesses[0];
  const base = `/owner/${active.id}`;

  // One overview fetch, shared by the greeting's supporting line and the
  // needs-attention band below.
  const overview = useAsyncData<OwnerOverview>(() => getOwnerOverview(active.id), [active.id]);

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

      {/* Greeting: who is operating, with one useful data-driven line. */}
      <header className="owner-greet">
        <div className="owner-greet-text">
          <p className="owner-greet-hello">{greeting},</p>
          <h1 className="owner-greet-name">{active.name}!</h1>
          <p className="owner-sub">{supportLineFor(active, overview.data)}</p>
        </div>
      </header>

      {/* Business switcher (only when the owner runs several businesses). */}
      {businesses.length > 1 ? (
        <div className="filter-row" role="group" aria-label="Switch business" style={{ marginTop: 8 }}>
          {businesses.map((b) => (
            <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => onSelectBusiness(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Business status: the first answer to "how is my business doing?" */}
      <BusinessStatusCard business={active} />

      {/* Plan: the single subscription entry point on this screen. The real
          plan, price, trial and payment state come from OwnerPlanCard. */}
      <section aria-label="Your plan" className="ov-section">
        <h2 className="ov-section-title">Your plan</h2>
        <OwnerPlanCard
          businessId={active.id}
          onManagePlan={() => onOpen(`${base}/subscription`)}
          onViewPayments={() => onOpen(`${base}/subscription`)}
        />
      </section>

      {/* Monthly snapshot: server-computed figures plus the real rating. */}
      <MonthlySnapshot businessId={active.id} business={active} />

      {/* Everything actionable: attention items, then profile gaps. */}
      <OverviewAttention
        overview={overview}
        onOpen={onOpen}
        base={base}
        onOpenBooking={props.onOpenBooking}
        onOpenOrder={props.onOpenOrder}
      />

      <QuickActions base={base} onOpen={onOpen} />

      <OvSection label="Manage">
        <OwnerHubRow icon={<StoreIcon size={18} />} title="Business profile" subtitle="Name, address, contact, category" onClick={() => onOpen(`${base}/profile`)} />
        <OwnerHubRow icon={<PinIcon size={18} />} title="Location" subtitle="Set your address and pin on map" onClick={() => onOpen(`${base}/location`)} />
        <OwnerHubRow icon={<BookingsIcon size={18} />} title="Business hours" subtitle="Set your operating hours" onClick={() => onOpen(`${base}/hours`)} />
      </OvSection>

      {/* Catalog: the full management destinations for what the business
          sells. Kept visually distinct from the quick-action shortcuts
          above so Services/Products never feel tripled. */}
      <OvSection label="Catalog" sub="Manage everything you sell" className="ov-section-catalog">
        <OwnerHubRow icon={<ActivityIcon size={18} />} title="Services" subtitle="Add and manage your services" onClick={() => onOpen(`${base}/services`)} />
        <OwnerHubRow icon={<OrdersIcon size={18} />} title="Products / Menu" subtitle="Add products or menu items" onClick={() => onOpen(`${base}/products`)} />
      </OvSection>

      <OvSection label="Grow">
        <OwnerHubRow icon={<CheckIcon size={18} />} title="Verification" subtitle="Get the verified badge on your listing" onClick={() => onOpen(`${base}/verification`)} />
        <OwnerHubRow icon={<StarIcon size={18} />} title="Promotions" subtitle="Deals and offers to attract customers" onClick={() => onOpen(`${base}/promotions`)} />
      </OvSection>

      <OvSection label="Account & settings">
        <OwnerHubRow icon={<HeartIcon size={18} />} title="Reviews" subtitle="What customers say about you" onClick={() => onOpen(`${base}/reviews`)} />
        <OwnerHubRow icon={<AlertIcon size={18} />} title="Customer payments" subtitle="Verify customer payment proofs" onClick={() => onOpen(`${base}/payments`)} />
        <OwnerHubRow icon={<CheckIcon size={18} />} title="Business payment methods" subtitle="Channels customers pay you through" onClick={() => onOpen(`${base}/payment-methods`)} />
        <OwnerHubRow icon={<ExploreIcon size={18} />} title="Delivery & COD" subtitle="Own-rider delivery and cash on delivery" onClick={() => onOpen(`${base}/delivery`)} />
        <OwnerHubRow icon={<InfoIcon size={18} />} title="Service advance settings" subtitle="Per-service advance requirements" onClick={() => onOpen(`${base}/advances`)} />
        <OwnerHubRow icon={<HelpIcon size={18} />} title="Business settings" subtitle="Delivery, COD and payment channels" onClick={() => onOpen(`${base}/settings`)} />
      </OvSection>
    </div>
  );
}

/** A labelled section of hub rows: the card treatment, but a readable h2. */
function OvSection(props: { label: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`ov-section${props.className ? ` ${props.className}` : ''}`} aria-label={props.label}>
      <h2 className="ov-section-title">{props.label}</h2>
      {props.sub ? <p className="ov-section-sub">{props.sub}</p> : null}
      <div className="hub-card">{props.children}</div>
    </section>
  );
}

/**
 * The single supporting line under the greeting: pending attention from the
 * live overview, otherwise the honest visibility state. Never invented.
 */
function supportLineFor(active: Business, o: OwnerOverview | null): string {
  const n = o?.needsAttention;
  const total = (n?.pendingOrders ?? 0) + (n?.pendingBookings ?? 0) + (n?.pendingPayments ?? 0);
  if (total > 0) return `${total} item${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} your attention today.`;
  if (active.status === 'APPROVED') return 'Your business is live and visible to customers.';
  if (active.status === 'PENDING') return 'Your listing goes live in customer search once approved.';
  return 'Check your business status with support.';
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
 * Monthly snapshot: this month's bookings, the real average customer
 * rating, and this month's collected revenue. All server-computed; an
 * honest zero/empty state when there is no data yet.
 */
function MonthlySnapshot({ businessId, business }: { businessId: string; business: Business }) {
  const analytics = useAsyncData<OwnerAnalytics>(() => getOwnerAnalytics(businessId, 'month'), [businessId]);

  const rating = business.averageRating;
  const reviewCount = business.reviewCount ?? 0;

  return (
    <section aria-label="Monthly snapshot" className="ov-section">
      <h2 className="ov-section-title">Monthly snapshot</h2>
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
            <span className="metric-tile-num">{rating != null ? rating.toFixed(1) : '-'}</span>
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
  overview: AsyncState<OwnerOverview>;
  onOpen: (path: string) => void;
  base: string;
  onOpenBooking: (id: string) => void;
  onOpenOrder: (id: string) => void;
}) {
  const { overview, onOpen, base } = props;

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
          onClick: () => onOpen(`${base}/orders`),
        }
      : null,
    o.needsAttention.pendingBookings > 0
      ? {
          key: 'bookings',
          count: o.needsAttention.pendingBookings,
          label: o.needsAttention.pendingBookings === 1 ? 'booking' : 'bookings',
          detail: 'waiting for your confirm or decline',
          onClick: () => onOpen(`${base}/bookings`),
        }
      : null,
    o.needsAttention.pendingPayments > 0
      ? {
          key: 'payments',
          count: o.needsAttention.pendingPayments,
          label: o.needsAttention.pendingPayments === 1 ? 'payment proof' : 'payment proofs',
          detail: 'awaiting verification',
          onClick: () => onOpen(`${base}/payments`),
        }
      : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <>
      <section aria-label="Needs attention" className="ov-section">
        <h2 className="ov-section-title">Needs attention</h2>
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
            <CheckIcon size={16} /> All caught up. Nothing needs your attention right now.
          </p>
        )}
      </section>
      {renderProfileGaps(o.profileMissing, base, onOpen)}
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
    <section aria-label="Complete your profile" className="ov-section">
      <h2 className="ov-section-title">Complete your profile</h2>
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

/**
 * Quick actions: the four most-used destinations, as one compact grid.
 * Every destination also appears in the sections below; these are the
 * shortcuts for daily operation.
 */
function QuickActions(props: { base: string; onOpen: (path: string) => void }) {
  const { base, onOpen } = props;
  const actions = [
    { key: 'profile', icon: <StoreIcon size={20} />, label: 'Edit profile', path: `${base}/profile` },
    { key: 'services', icon: <ActivityIcon size={20} />, label: 'Services', path: `${base}/services` },
    { key: 'products', icon: <ImageIcon size={20} />, label: 'Products', path: `${base}/products` },
    { key: 'orders', icon: <OrdersIcon size={20} />, label: 'Orders', path: `${base}/orders` },
  ];
  return (
    <section aria-label="Quick actions" className="ov-section">
      <h2 className="ov-section-title">Quick actions</h2>
      <div className="ov-quick-grid">
        {actions.map((a) => (
          <button key={a.key} type="button" className="ov-quick-btn" onClick={() => onOpen(a.path)}>
            <span className="ov-quick-icon" aria-hidden>
              {a.icon}
            </span>
            <span className="ov-quick-label">{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
