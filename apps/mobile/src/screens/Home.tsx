import { RemoteImage } from '../components/RemoteImage.js';
import { useEffect, useState } from 'react';
import {
  getSession,
  listBusinesses,
  listCategories,
  listFavorites,
  listFeaturedBusinesses,
  listMyBookings,
  listMyOrders,
  listNearbyBusinesses,
  searchMarketplace,
  resolveImageUrl,
  whoami,
  type Booking,
  type Business,
  type Category,
  type FavoriteEntry,
  type FeaturedPlacement,
  type MyProfile,
  type Order,
  type ProductSearchResult,
  type SearchPage,
  type ServiceSearchResult,
} from '../api.js';
import { formatDistanceKm } from '../location.js';
import { useSharedLocation } from '../useSharedLocation.js';
import { useLocationExplainer } from '../components/LocationPermissionExplainer.js';
import { longDateLabel } from '../time.js';
import { useAsyncData } from '../hooks.js';
import { BusinessRow, EmptyState, ErrorState, Money, RatingChip, SectionHeader } from '../components/ui.js';
import { BookingStatusBadge } from './Bookings.js';
import { orderLabel } from './Orders.js';
import { BookingsIcon, ExploreIcon, HeartIcon, HomeIcon, OrdersIcon, PinIcon, ProfileIcon, StoreIcon } from '../components/icons.js';

/** Primary categories shown on Home; the rest live in Explore behind "See all". */
const HOME_CATEGORY_LIMIT = 8;

/** Radius used for the opt-in nearby feed — tight enough to feel local. */
const NEARBY_RADIUS_KM = 10;

/** Category name → icon glyph. Unknown categories get the generic storefront. */
const CATEGORY_ICONS: Record<string, (size: number) => React.ReactNode> = {
  food: (s) => <BookingsIcon size={s} />,
  beauty: (s) => <ProfileIcon size={s} />,
  automotive: (s) => <OrdersIcon size={s} />,
  home: (s) => <HomeIcon size={s} />,
  health: (s) => <ProfileIcon size={s} />,
  shopping: (s) => <StoreIcon size={s} />,
  fitness: (s) => <OrdersIcon size={s} />,
  education: (s) => <BookingsIcon size={s} />,
  events: (s) => <BookingsIcon size={s} />,
  professional: (s) => <StoreIcon size={s} />,
};

function categoryIcon(slug: string, name: string, size = 20) {
  const haystack = `${slug} ${name}`.toLowerCase();
  const key = Object.keys(CATEGORY_ICONS).find((k) => haystack.includes(k));
  return (key ? CATEGORY_ICONS[key] : (s: number) => <StoreIcon size={s} />)(size);
}

/** Time-of-day greeting derived from the real clock — never fabricated. */
function daypartGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Order statuses that represent work still in flight for the customer. */
const ACTIVE_ORDER_STATUSES: ReadonlySet<Order['status']> = new Set(['PENDING', 'ACCEPTED', 'PREPARING', 'READY']);

type Coords = { lat: number; lng: number };

/**
 * One subtle, data-driven contextual section — at most one renders. Priority:
 * an in-flight order beats an upcoming booking beats a reorder prompt beats
 * saved places. Everything comes from real customer data; nothing is faked.
 */
type HomeContext =
  | { kind: 'order'; order: Order }
  | { kind: 'booking'; booking: Booking }
  | { kind: 'reorder'; order: Order }
  | { kind: 'saved'; favorites: FavoriteEntry[] };

function pickContext(orders: Order[], bookings: Booking[], favorites: FavoriteEntry[]): HomeContext | null {
  const byCreatedDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
    b.createdAt.localeCompare(a.createdAt);
  const active = orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).sort(byCreatedDesc)[0];
  if (active) return { kind: 'order', order: active };

  // bookingDate is an ISO calendar date (YYYY-MM-DD), so a lexicographic
  // comparison against today is a correct chronological comparison.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings
    .filter((b) => (b.status === 'CONFIRMED' || b.status === 'PENDING') && b.bookingDate >= today)
    .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.startTime.localeCompare(b.startTime))[0];
  if (upcoming) return { kind: 'booking', booking: upcoming };

  const lastCompleted = orders.filter((o) => o.status === 'COMPLETED').sort(byCreatedDesc)[0];
  if (lastCompleted) return { kind: 'reorder', order: lastCompleted };

  if (favorites.length) return { kind: 'saved', favorites: favorites.slice(0, 3) };
  return null;
}

function formatBookingWhen(booking: Booking): string {
  try {
    const [y, m, d] = booking.bookingDate.split('-').map(Number);
    const date = new Date(y, (m ?? 1) - 1, d ?? 1);
    const day = date.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} · ${booking.startTime}`;
  } catch {
    return `${booking.bookingDate} · ${booking.startTime}`;
  }
}

export function HomeScreen(props: {
  onOpenSearch: () => void;
  onOpenBusiness: (id: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
  onExploreCategory: (slug: string) => void;
  onSeeAllCategories: () => void;
}) {
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  // Signed-in customers get a personal greeting; signed-out sessions skip the
  // profile fetch entirely. A profile failure degrades to the generic greeting.
  const signedIn = getSession() !== null;
  const me = useAsyncData<MyProfile | null>(() => (signedIn ? whoami().catch(() => null) : Promise.resolve(null)), [signedIn]);

  // Opt-in nearby mode: no permission prompt fires until the customer taps the
  // location context. On grant the feed comes from the dedicated nearby
  // endpoint with server-computed distances; every other state keeps the
  // Shared location state: Home, Explore, and Search all read the same
  // coords so one screen can never show "Near you" while another shows
  // "Set your location" after the same grant.
  const { coords, locating, locNotice, hasLocation, requestLocation, clearLocation } = useSharedLocation();
  const [locDenied, setLocDenied] = useState(false);
  const [locDismissed, setLocDismissed] = useState(false);
  const { requestWithExplainer, explainer: locationExplainer } = useLocationExplainer();
  const nearbyKey = coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : 'all';

  const businesses = useAsyncData<Business[]>(async () => {
    if (coords) {
      return listNearbyBusinesses({ lat: coords.lat, lng: coords.lng, radiusKm: NEARBY_RADIUS_KM, limit: 20 });
    }
    return listBusinesses({ q: '', limit: 20 });
  }, [nearbyKey]);

  // Contextual section data: signed-in customers only, fetched in parallel.
  // Each fetch degrades to an empty list so one failure never kills the card.
  const contextData = useAsyncData<{ orders: Order[]; bookings: Booking[]; favorites: FavoriteEntry[] } | null>(
    async () => {
      if (!signedIn) return null;
      const [orders, bookings, favorites] = await Promise.all([
        listMyOrders().catch((): Order[] => []),
        listMyBookings().catch((): Booking[] => []),
        listFavorites().catch((): FavoriteEntry[] => []),
      ]);
      return { orders, bookings, favorites };
    },
    [signedIn],
  );
  const context = contextData.data ? pickContext(contextData.data.orders, contextData.data.bookings, contextData.data.favorites) : null;

  const enableNearby = () => {
    // First-use gate: on a fresh device the in-app explainer appears before
    // the native location dialog. Granted/denied states go straight through.
    requestWithExplainer(() => {
      setLocDenied(false);
      setLocDismissed(false);
      requestLocation();
    });
  };

  const disableNearby = () => {
    clearLocation();
    setLocDenied(false);
    setLocDismissed(false);
  };

  const homeCategories = categories.data?.slice(0, HOME_CATEGORY_LIMIT) ?? [];
  const popular = businesses.data ?? [];

  // Actionable hierarchy: businesses the server says are open right now form
  // their own section; everything else continues below as the discovery feed.
  const openNow = popular.filter((b) => b.isOpenNow === true);
  const hasStatusData = popular.some((b) => b.isOpenNow !== undefined);
  const showOpenNow = hasStatusData && openNow.length > 0;
  const spotlightPool = showOpenNow ? openNow : popular;
  const [spotlight, ...spotlightRest] = spotlightPool;
  const feed = showOpenNow ? popular.filter((b) => b.isOpenNow !== true) : spotlightRest;
  const firstName = me.data?.firstName?.trim() || null;
  const nearby = hasLocation;

  return (
    <div className="screen home-screen">
      {/* Location context: tappable. Idle shows the honest area summary;
          granted switches the feed to real nearby results with distances. */}
      <div className="home-context" aria-label="Location context" aria-live="polite">
        {locating ? (
          <span className="home-context-place" aria-label="Locating">
            <PinIcon size={13} />
            Locating…
          </span>
        ) : nearby ? (
          <button type="button" className="home-context-place home-context-toggle" onClick={disableNearby} aria-label="Nearby mode on. Tap to show all businesses.">
            <PinIcon size={13} />
            Near you
          </button>
        ) : locNotice ? (
          <button type="button" className="home-context-place home-context-toggle" onClick={enableNearby} aria-label="Location is off. Tap to try again.">
            <PinIcon size={13} />
            Location off. Tap to retry
          </button>
        ) : (
          <button type="button" className="home-context-place home-context-toggle" onClick={enableNearby} aria-label="Show businesses near your location">
            <PinIcon size={13} />
            Set your location
          </button>
        )}
        {showOpenNow ? (
          <span className="home-context-open">
            {openNow.length} open now
          </span>
        ) : null}
      </div>
      {locDenied && !locDismissed && !nearby ? (
        <div className="location-denied-card" role="status" aria-live="polite">
          <span className="location-denied-icon" aria-hidden>
            <PinIcon size={16} />
          </span>
          <div className="location-denied-body">
            <p className="location-denied-title">Location is off</p>
            <p className="location-denied-text">
              {locNotice ?? 'Nearby discovery works best with location access. You can keep browsing and searching all businesses either way.'}
            </p>
            <div className="location-denied-actions">
              <button type="button" className="btn btn-sm btn-secondary" onClick={enableNearby} disabled={locating}>
                {locating ? 'Trying again…' : 'Try again'}
              </button>
              <button type="button" className="link-inline" onClick={() => setLocDismissed(true)}>
                Continue without location
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hero: editorial greeting fused with the primary search entry. The
          entry is a single tappable control that opens the real Search
          screen — Home implements no search of its own. */}
      <section className="home-hero" aria-label="Welcome">
        <p className="home-hero-kicker">
          {daypartGreeting()}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="home-hero-title">
          Find the best <em>near you</em>
        </h1>
        <button
          type="button"
          className="home-hero-search home-hero-search-entry"
          onClick={props.onOpenSearch}
          aria-label="Search businesses, services and products"
        >
          <span className="home-hero-search-icon" aria-hidden>
            <ExploreIcon size={18} />
          </span>
          <span className="home-hero-search-placeholder">Search businesses, products & services</span>
          <span className="search-go" aria-hidden>
            <ExploreIcon size={16} />
          </span>
        </button>
      </section>

      {/* Categories: one horizontal rail — high density, low bulk. */}
      <section aria-label="Categories" className="rail-section">
        <SectionHeader
          title="Browse categories"
          action={
            categories.data && categories.data.length > HOME_CATEGORY_LIMIT ? (
              <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
                See all
              </button>
            ) : null
          }
        />
        {categories.loading ? (
          <div className="category-rail" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="category-rail-item">
                <span className="skeleton" style={{ width: 44, height: 44, borderRadius: 14 }} />
                <span className="skeleton skeleton-line w-60" style={{ height: 9 }} />
              </div>
            ))}
          </div>
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="category-rail">
            {homeCategories.map((c) => (
              <button type="button" className="category-rail-item" key={c.id} onClick={() => props.onExploreCategory(c.slug)}>
                <span className="category-rail-icon" aria-hidden>
                  {categoryIcon(c.slug, c.name)}
                </span>
                <span className="category-rail-name">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Discovery feed: an actionable "open now" lead when the server provides
          open/closed status, followed by the remaining places as a scannable
          editorial list. Real data only. */}
      {businesses.loading ? (
        <section aria-label="Businesses" className="rail-section">
          <SectionHeader title={nearby ? 'Near you' : 'Popular near you'} />
          <div className="skeleton-card" style={{ padding: 0, overflow: 'hidden' }} aria-hidden>
            <div className="skeleton" style={{ height: 130, borderRadius: 0 }} />
            <div style={{ padding: 12 }}>
              <div className="skeleton skeleton-line w-60" />
              <div className="skeleton skeleton-line w-40" style={{ marginTop: 8 }} />
            </div>
          </div>
        </section>
      ) : businesses.error ? (
        <ErrorState message={businesses.error} onRetry={businesses.reload} />
      ) : !popular.length ? (
        <section aria-label="Businesses" className="rail-section">
          <SectionHeader title={nearby ? 'Near you' : 'Popular near you'} />
          <EmptyState
            icon={<StoreIcon size={28} />}
            title="No businesses yet"
            body="Approved nearby businesses will appear here as they join NearbyOrders."
          />
        </section>
      ) : (
        <>
          <section aria-label={showOpenNow ? 'Open now' : 'Featured business'} className="rail-section">
            <SectionHeader
              title={showOpenNow ? 'Open now near you' : nearby ? 'Near you' : 'Popular near you'}
              action={
                <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
                  See all
                </button>
              }
            />
            <SpotlightCard business={spotlight} onOpen={() => props.onOpenBusiness(spotlight.id)} />
            {showOpenNow && spotlightRest.length ? (
              <div className="biz-rows home-feed-rows">
                {spotlightRest.slice(0, 3).map((b) => (
                  <BusinessRow key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} userCoords={coords} />
                ))}
              </div>
            ) : null}
          </section>

          {feed.length ? (
            <section aria-label="More businesses" className="rail-section">
              <SectionHeader
                title={showOpenNow ? 'More to explore' : 'More near you'}
                action={
                  <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
                    See all
                  </button>
                }
              />
              <div className="biz-rows home-feed-rows">
                {feed.slice(0, 10).map((b) => (
                  <BusinessRow key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} showDescription userCoords={coords} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Support-local strip: platform message, kept small and purposeful. */}
          <button type="button" className="support-strip" onClick={props.onSeeAllCategories}>
            <span className="support-strip-icon" aria-hidden>
              <PinIcon size={18} />
            </span>
            <span className="support-strip-text">
              <span className="support-strip-title">Support local businesses</span>
              <span className="support-strip-sub">Book a service or order near you</span>
            </span>
            <span className="support-strip-cta" aria-hidden>
              Explore
            </span>
          </button>
        </>
      )}

      {/* Products & services: what can actually be ordered or booked. */}
      <DiscoverSection coords={coords} onOpenBusiness={props.onOpenBusiness} onSeeAll={props.onOpenSearch} />

      {/* Featured placements: clearly labeled as sponsored/curated — never
          part of organic ranking. The section is omitted entirely when the
          server returns nothing. */}
      <FeaturedSection onOpenBusiness={props.onOpenBusiness} />

      {/* Recent activity: the in-flight context card leads, then the latest
          orders and bookings as compact rows. Signed-in customers only. */}
      {context && context.kind !== 'saved' ? (
        <section aria-label="Recent activity" className="rail-section">
          <SectionHeader title="Recent activity" />
          <ContextCard context={context} onOpenBusiness={props.onOpenBusiness} onOpenOrder={props.onOpenOrder} onOpenBooking={props.onOpenBooking} />
          <RecentActivityRows
            orders={contextData.data?.orders ?? []}
            bookings={contextData.data?.bookings ?? []}
            excludeOrderId={context.kind === 'order' || context.kind === 'reorder' ? context.order.id : null}
            excludeBookingId={context.kind === 'booking' ? context.booking.id : null}
            onOpenOrder={props.onOpenOrder}
            onOpenBooking={props.onOpenBooking}
          />
        </section>
      ) : null}
      {context && context.kind === 'saved' ? (
        <section aria-label="Recent activity" className="rail-section">
          <ContextCard context={context} onOpenBusiness={props.onOpenBusiness} onOpenOrder={props.onOpenOrder} onOpenBooking={props.onOpenBooking} />
        </section>
      ) : null}
      {locationExplainer}
    </div>
  );
}

/**
 * Products & services discovery: what the customer can actually ORDER or
 * BOOK, pulled from the real unified search endpoint (type-filtered, never
 * fabricated). Products lead, services follow; each card opens the owning
 * business. The section is omitted when the server returns nothing.
 */
function DiscoverSection(props: { coords: Coords | null; onOpenBusiness: (id: string) => void; onSeeAll: () => void }) {
  const geoKey = props.coords ? `${props.coords.lat.toFixed(4)},${props.coords.lng.toFixed(4)}` : 'all';
  const discover = useAsyncData<{ products: ProductSearchResult[]; services: ServiceSearchResult[] }>(async () => {
    const geo = props.coords
      ? { lat: props.coords.lat, lng: props.coords.lng, radiusKm: NEARBY_RADIUS_KM, sort: 'distance' as const }
      : {};
    const [productsPage, servicesPage] = await Promise.all([
      searchMarketplace({ ...geo, type: 'product', limit: 6 }).catch((): SearchPage | null => null),
      searchMarketplace({ ...geo, type: 'service', limit: 6 }).catch((): SearchPage | null => null),
    ]);
    return {
      products: (productsPage?.results ?? []).filter((r): r is ProductSearchResult => r.type === 'product'),
      services: (servicesPage?.results ?? []).filter((r): r is ServiceSearchResult => r.type === 'service'),
    };
  }, [geoKey]);

  if (discover.loading) {
    return (
      <section aria-label="Products and services" className="rail-section">
        <SectionHeader title="Products & services" />
        <div className="discover-rail" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="discover-card">
              <span className="skeleton" style={{ width: 64, height: 64, borderRadius: 14 }} />
              <span className="skeleton skeleton-line w-60" style={{ marginTop: 8 }} />
              <span className="skeleton skeleton-line w-40" style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  const items: (ProductSearchResult | ServiceSearchResult)[] = [
    ...(discover.data?.products ?? []),
    ...(discover.data?.services ?? []),
  ].slice(0, 8);
  if (!items.length) return null;
  return (
    <section aria-label="Products and services" className="rail-section">
      <SectionHeader
        title="Products & services"
        action={
          <button type="button" className="see-all-link" onClick={props.onSeeAll}>
            See all
          </button>
        }
      />
      <p className="section-sub">Order products or book services near you</p>
      <div className="discover-rail">
        {items.map((r) => (
          <DiscoverCard key={`${r.type}-${r.id}`} result={r} onOpen={() => props.onOpenBusiness(r.businessId)} />
        ))}
      </div>
    </section>
  );
}

function DiscoverCard(props: { result: ProductSearchResult | ServiceSearchResult; onOpen: () => void }) {
  const r = props.result;
  const isProduct = r.type === 'product';
  const distance = r.distanceKm !== undefined && r.distanceKm !== null ? formatDistanceKm(r.distanceKm) : null;
  return (
    <button
      type="button"
      className="discover-card"
      onClick={props.onOpen}
      aria-label={`${r.name}, ${isProduct ? 'product' : 'service'} at ${r.businessName}`}
    >
      <span className="discover-media" aria-hidden>
        {isProduct && r.imageUrl ? (
          <RemoteImage src={resolveImageUrl(r.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="discover-initial">{r.name[0]?.toUpperCase() ?? '?'}</span>
        )}
      </span>
      <span className="discover-kind">{isProduct ? 'Product' : 'Service'}</span>
      <span className="discover-name">{r.name}</span>
      <span className="discover-biz">{r.businessName}</span>
      <span className="discover-meta">
        <Money minor={r.priceMinor} currency={r.currency} />
        {!isProduct && r.durationMinutes ? ` · ${r.durationMinutes} min` : null}
        {distance ? ` · ${distance}` : null}
      </span>
    </button>
  );
}

/**
 * Compact rows for the latest orders and bookings, excluding whatever the
 * context card already surfaces. Real customer data only.
 */
function RecentActivityRows(props: {
  orders: Order[];
  bookings: Booking[];
  excludeOrderId: string | null;
  excludeBookingId: string | null;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
}) {
  const orders = props.orders
    .filter((o) => o.id !== props.excludeOrderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  const bookings = props.bookings
    .filter((b) => b.id !== props.excludeBookingId)
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || b.startTime.localeCompare(a.startTime))
    .slice(0, 2);
  if (!orders.length && !bookings.length) return null;
  return (
    <div className="recent-rows">
      {orders.map((o) => {
        const label = orderLabel(o.status);
        const itemCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
        return (
          <button
            key={o.id}
            type="button"
            className="recent-row"
            onClick={() => props.onOpenOrder(o.id)}
            aria-label={`Order from ${o.business.name}, ${label.text}`}
          >
            <span className="recent-row-icon" aria-hidden>
              <OrdersIcon size={18} />
            </span>
            <span className="recent-row-main">
              <span className="recent-row-title">{o.business.name}</span>
              <span className="recent-row-sub">
                {itemCount} item{itemCount === 1 ? '' : 's'}
                {o.totalMinor !== undefined ? (
                  <>
                    {' · '}
                    <Money minor={o.totalMinor} currency={o.currency} />
                  </>
                ) : null}
              </span>
            </span>
            <span className={`badge ${label.cls}`}>{label.text}</span>
          </button>
        );
      })}
      {bookings.map((b) => (
        <button
          key={b.id}
          type="button"
          className="recent-row"
          onClick={() => props.onOpenBooking(b.id)}
          aria-label={`Booking ${b.serviceName ?? ''} at ${b.businessName}`}
        >
          <span className="recent-row-icon" aria-hidden>
            <BookingsIcon size={18} />
          </span>
          <span className="recent-row-main">
            <span className="recent-row-title">
              {b.serviceName ?? 'Booking'} · {b.businessName}
            </span>
            <span className="recent-row-sub">
              {longDateLabel(b.bookingDate)} · {b.startTime}
            </span>
          </span>
          <BookingStatusBadge status={b.status} />
        </button>
      ))}
    </div>
  );
}

/**
 * Featured placements from GET /api/v1/featured-businesses — the only
 * promotion surface on the customer app. Server-authoritative: the endpoint
 * returns only currently-active placements, so the client filters nothing
 * and invents nothing. Labeled honestly as "Featured" with the server's own
 * placement label per entry; a failure degrades to an empty list so the
 * section is omitted instead of showing an error banner.
 */
function FeaturedSection(props: { onOpenBusiness: (id: string) => void }) {
  const featured = useAsyncData<FeaturedPlacement[]>(() => listFeaturedBusinesses().catch((): FeaturedPlacement[] => []), []);
  if (featured.loading) {
    return (
      <section aria-label="Featured businesses" className="rail-section">
        <SectionHeader title="Featured" />
        <div className="featured-rail" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="featured-card">
              <span className="skeleton skeleton-line w-40" />
              <span className="skeleton skeleton-line w-60" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (!featured.data?.length) return null;
  return (
    <section aria-label="Featured businesses" className="rail-section">
      <SectionHeader title="Featured" />
      <p className="featured-note">Sponsored placements and curated picks</p>
      <div className="featured-rail">
        {featured.data.map((f) => (
          <button
            type="button"
            key={f.placementId}
            className="featured-card"
            onClick={() => props.onOpenBusiness(f.business.id)}
            aria-label={`${f.business.name}, featured business`}
          >
            <span className="featured-chip">{f.placementLabel}</span>
            <span className="featured-name">{f.business.name}</span>
            {f.business.categoryNames.length ? (
              <span className="featured-cats">{f.business.categoryNames.join(' • ')}</span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The single contextual card, chosen by pickContext. Subtle, data-driven. */
function ContextCard(props: {
  context: HomeContext;
  onOpenBusiness: (id: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenBooking: (id: string) => void;
}) {
  const { context } = props;
  if (context.kind === 'order') {
    const o = context.order;
    const label = orderLabel(o.status);
    const itemCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
    return (
      <button type="button" className="home-context-card" onClick={() => props.onOpenOrder(o.id)}>
        <span className="home-context-card-icon" aria-hidden>
          <OrdersIcon size={20} />
        </span>
        <span className="home-context-card-body">
          <span className="home-context-card-kicker">
            Your order <span className={`badge ${label.cls}`}>{label.text}</span>
          </span>
          <span className="home-context-card-title">{o.business.name}</span>
          <span className="home-context-card-sub">
            {itemCount} item{itemCount === 1 ? '' : 's'}
            {o.totalMinor !== undefined ? (
              <>
                {' · '}
                <Money minor={o.totalMinor} currency={o.currency} />
              </>
            ) : null}
          </span>
        </span>
        <span className="home-context-card-cta" aria-hidden>
          View ›
        </span>
      </button>
    );
  }
  if (context.kind === 'booking') {
    const b = context.booking;
    return (
      <button type="button" className="home-context-card" onClick={() => props.onOpenBooking(b.id)}>
        <span className="home-context-card-icon" aria-hidden>
          <BookingsIcon size={20} />
        </span>
        <span className="home-context-card-body">
          <span className="home-context-card-kicker">
            Upcoming booking <BookingStatusBadge status={b.status} />
          </span>
          <span className="home-context-card-title">{b.serviceName ?? 'Booking'} · {b.businessName}</span>
          <span className="home-context-card-sub">{formatBookingWhen(b)}</span>
        </span>
        <span className="home-context-card-cta" aria-hidden>
          View ›
        </span>
      </button>
    );
  }
  if (context.kind === 'reorder') {
    const o = context.order;
    return (
      <button type="button" className="home-context-card" onClick={() => props.onOpenBusiness(o.business.id)}>
        <span className="home-context-card-icon" aria-hidden>
          <OrdersIcon size={20} />
        </span>
        <span className="home-context-card-body">
          <span className="home-context-card-kicker">Order again</span>
          <span className="home-context-card-title">{o.business.name}</span>
          <span className="home-context-card-sub">Your favorites are one tap away</span>
        </span>
        <span className="home-context-card-cta" aria-hidden>
          Reorder ›
        </span>
      </button>
    );
  }
  return (
    <section aria-label="Saved places" className="home-saved">
      <SectionHeader title="Your saved places" />
      <div className="biz-rows home-feed-rows">
        {context.favorites.map((f) => (
          <button type="button" key={f.business.id} className="biz-row" onClick={() => props.onOpenBusiness(f.business.id)}>
            <span className="biz-row-media" aria-hidden>
              {f.business.imageUrl ? (
                <RemoteImage src={resolveImageUrl(f.business.imageUrl) ?? undefined} alt="" loading="lazy" />
              ) : (
                <span className="pop-card-initial">{f.business.name[0]?.toUpperCase() ?? '?'}</span>
              )}
            </span>
            <span className="biz-row-main">
              <span className="biz-row-name">{f.business.name}</span>
              <span className="biz-row-meta">
                <RatingChip average={f.business.averageRating} count={f.business.reviewCount} />
                {f.business.isVerified ? <HeartIcon size={13} /> : null}
              </span>
            </span>
            <span className="biz-row-chevron" aria-hidden>
              ›
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Spotlight card: full-width editorial layout — media left (real image or
 * branded monogram), identity and trust signals right, open state always
 * honest. Tap opens the business profile.
 */
function SpotlightCard(props: { business: Business; onOpen: () => void }) {
  const b = props.business;
  const category = b.categories[0]?.name;
  const place = [b.locality, b.city].filter(Boolean).join(', ');
  const distance = b.distanceKm !== undefined && b.distanceKm !== null ? formatDistanceKm(b.distanceKm) : null;
  return (
    <button type="button" className="spotlight-card" onClick={props.onOpen}>
      <span className="spotlight-media">
        {b.imageUrl ? (
          <RemoteImage src={resolveImageUrl(b.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="spotlight-initial" aria-hidden>
            {b.name[0]?.toUpperCase() ?? '?'}
          </span>
        )}
        {b.isOpenNow !== undefined ? (
          <span className={`pop-card-open${b.isOpenNow ? '' : ' closed'}`}>{b.isOpenNow ? 'Open' : 'Closed'}</span>
        ) : null}
      </span>
      <span className="spotlight-body">
        <span className="spotlight-kicker">{category ?? 'Local business'}</span>
        <span className="spotlight-name">{b.name}</span>
        <RatingChip average={b.averageRating} count={b.reviewCount ?? undefined} />
        {b.description ? <span className="spotlight-desc">{b.description}</span> : null}
        {distance || place ? (
          <span className="spotlight-place">
            {distance ? `${distance} · ` : ''}
            {place}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Kept for other screens that import the marketplace card style. */
export function PopularBusinessCard(props: { business: Business; onOpen: () => void }) {
  const b = props.business;
  const category = b.categories[0]?.name;
  return (
    <button type="button" className="pop-card" onClick={props.onOpen}>
      <span className="pop-card-media">
        {b.imageUrl ? (
          <RemoteImage src={resolveImageUrl(b.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="pop-card-initial" aria-hidden>
            {b.name[0]?.toUpperCase() ?? '?'}
          </span>
        )}
        {b.isOpenNow !== undefined ? (
          <span className={`pop-card-open${b.isOpenNow ? '' : ' closed'}`}>{b.isOpenNow ? 'Open' : 'Closed'}</span>
        ) : null}
      </span>
      <span className="pop-card-body">
        <span className="pop-card-name">{b.name}</span>
        <RatingChip average={b.averageRating} count={b.reviewCount ?? undefined} />
        {category ? <span className="pop-card-cat">{category}</span> : null}
      </span>
    </button>
  );
}
