import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { ErrorState, RatingChip, SectionHeader } from '../components/ui.js';
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

export function HomeScreen(props: {
  onSearch: (q: string) => void;
  onOpenBusiness: (id: string) => void;
  onExploreCategory: (slug: string) => void;
  onSeeAllCategories: () => void;
}) {
  const [query, setQuery] = useState('');
  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(() => listBusinesses({ q: '', limit: 20 }), []);

  const homeCategories = categories.data?.slice(0, HOME_CATEGORY_LIMIT) ?? [];
  const popular = businesses.data ?? [];
  const [spotlight, ...rest] = popular;

  return (
    <div className="screen">
      {/* Hero: editorial greeting fused with the primary search control. */}
      <section className="home-hero" aria-label="Welcome">
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

      {/* Spotlight: the top business gets a full editorial card; the rest ride
          a horizontal rail of compact cards. Real data only. */}
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
          <section aria-label="Featured business" className="rail-section">
            <SectionHeader
              title="Popular near you"
              action={
                <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
                  See all
                </button>
              }
            />
            <SpotlightCard business={spotlight} onOpen={() => props.onOpenBusiness(spotlight.id)} />
            {rest.length ? (
              <div className="mini-rail" style={{ marginTop: 12 }}>
                {rest.slice(0, 8).map((b) => (
                  <MiniBusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
                ))}
              </div>
            ) : null}
          </section>

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
        {place ? <span className="spotlight-place">📍 {place}</span> : null}
      </span>
    </button>
  );
}

/**
 * Compact rail card: slim vertical tile with a fixed media block, name and
 * rating — several visible per viewport width.
 */
function MiniBusinessCard(props: { business: Business; onOpen: () => void }) {
  const b = props.business;
  return (
    <button type="button" className="mini-card" onClick={props.onOpen}>
      <span className="mini-card-media">
        {b.imageUrl ? (
          <img src={b.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="pop-card-initial" aria-hidden>
            {b.name[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </span>
      <span className="mini-card-name">{b.name}</span>
      {b.averageRating !== null && b.averageRating !== undefined ? (
        <span className="mini-card-rating">
          ★ {b.averageRating.toFixed(1)}
        </span>
      ) : (
        <span className="mini-card-rating mini-card-rating-empty">{b.categories[0]?.name ?? ''}</span>
      )}
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
