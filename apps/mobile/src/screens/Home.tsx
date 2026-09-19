import { useState } from 'react';
import { getSession, listBusinesses, listCategories, whoami, type Business, type Category, type MyProfile } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessRow, ErrorState, RatingChip, SectionHeader } from '../components/ui.js';
import { BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, PinIcon, ProfileIcon, StoreIcon } from '../components/icons.js';
import { EmptyStateV3 } from '../components/EmptyStateV3.js';

/** Primary categories shown on Home; the rest live in Explore behind "See all". */
const HOME_CATEGORY_LIMIT = 8;

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

/**
 * Area context for the location bar: the locality/city most common among the
 * loaded businesses. Honest by construction — it can only name a place that
 * the real result set actually contains, so it never invents a location.
 */
function dominantPlace(businesses: Business[]): string | null {
  const counts = new Map<string, number>();
  for (const b of businesses) {
    const place = b.locality?.trim() || b.city?.trim();
    if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [place, count] of counts) {
    if (count > bestCount) {
      best = place;
      bestCount = count;
    }
  }
  return best;
}

export function HomeScreen(props: {
  onSearch: (q: string) => void;
  onOpenBusiness: (id: string) => void;
  onExploreCategory: (slug: string) => void;
  onSeeAllCategories: () => void;
}) {
  const [query, setQuery] = useState('');
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(() => listBusinesses({ q: '', limit: 20 }), []);
  // Signed-in customers get a personal greeting; signed-out sessions skip the
  // profile fetch entirely. A profile failure degrades to the generic greeting.
  const signedIn = getSession() !== null;
  const me = useAsyncData<MyProfile | null>(() => (signedIn ? whoami().catch(() => null) : Promise.resolve(null)), []);

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
  const place = dominantPlace(popular);
  const firstName = me.data?.firstName?.trim() || null;

  return (
    <div className="screen">
      {/* Location context: where the customer is, answered by real data. */}
      <div className="home-context" aria-label="Location context">
        <span className="home-context-place">
          <PinIcon size={13} />
          {place ? `Around ${place}` : 'Your neighborhood'}
        </span>
        {showOpenNow ? (
          <span className="home-context-open">
            {openNow.length} open now
          </span>
        ) : null}
      </div>

      {/* Hero: editorial greeting fused with the primary search control. */}
      <section className="home-hero" aria-label="Welcome">
        <p className="home-hero-kicker">
          {daypartGreeting()}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="home-hero-title">
          Find the best <em>near you</em>
        </h1>
        <form
          role="search"
          className="home-hero-search"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSearch(query);
          }}
        >
          <span className="home-hero-search-icon" aria-hidden>
            <ExploreIcon size={18} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search food, services, shops…"
            aria-label="Search businesses"
          />
          <button type="submit" className="search-go" aria-label="Search">
            <ExploreIcon size={16} />
          </button>
        </form>
      </section>

      {/* Categories: one horizontal rail — high density, low bulk. */}
      <section aria-label="Categories" className="rail-section">
        <SectionHeader
          title="Browse categories"
          action={
            <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
              See all
            </button>
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
          <SectionHeader title="Popular near you" />
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
          <SectionHeader title="Popular near you" />
          <EmptyStateV3
            icon={<StoreIcon size={28} />}
            title="No businesses yet"
            body="Approved nearby businesses will appear here as they join NearbyOrders."
          />
        </section>
      ) : (
        <>
          <section aria-label={showOpenNow ? 'Open now' : 'Featured business'} className="rail-section">
            <SectionHeader
              title={showOpenNow ? 'Open now near you' : 'Popular near you'}
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
                  <BusinessRow key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
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
                  <BusinessRow key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} showDescription />
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
    </div>
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
  return (
    <button type="button" className="spotlight-card" onClick={props.onOpen}>
      <span className="spotlight-media">
        {b.imageUrl ? (
          <img src={b.imageUrl} alt="" loading="lazy" />
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
        {place ? <span className="spotlight-place">📍 {place}</span> : null}
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
          <img src={b.imageUrl} alt="" loading="lazy" />
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
