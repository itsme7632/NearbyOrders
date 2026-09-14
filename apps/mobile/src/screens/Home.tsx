import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { EmptyState, ErrorState, OpenBadge, RatingChip, SectionHeader } from '../components/ui.js';
import { BellIcon, BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, PinIcon, ProfileIcon, StoreIcon } from '../components/icons.js';
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
  const hasMoreCategories = (categories.data?.length ?? 0) > HOME_CATEGORY_LIMIT;
  const popular = businesses.data ?? [];

  return (
    <div className="screen">
      {/* Greeting + search: the two anchors of the marketplace home. */}
      <section className="home-greeting" aria-label="Welcome">
        <h1 className="home-greeting-title">
          Find the best
          <br />
          <em>near you</em>
        </h1>
        <p className="home-greeting-sub">Great businesses. Better services. Nearby.</p>
      </section>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSearch(query);
        }}
      >
        <div className="search-bar-v3">
          <span className="search-hero-icon" style={{ position: 'static', transform: 'none' }} aria-hidden>
            <ExploreIcon size={18} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search food, services, shops…"
            aria-label="Search businesses"
          />
          <button type="submit" className="search-go" aria-label="Search">
            <ExploreIcon size={17} />
          </button>
        </div>
      </form>

      {/* Categories: compact icon grid with consistent brand containers. */}
      <section aria-label="Categories">
        <SectionHeader
          title="Categories"
          action={
            hasMoreCategories ? (
              <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
                See all
              </button>
            ) : null
          }
        />
        {categories.loading ? (
          <div className="category-tile-grid" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="category-tile">
                <span className="skeleton" style={{ width: 38, height: 38, borderRadius: 12 }} />
                <span className="skeleton skeleton-line w-60" style={{ height: 10 }} />
              </div>
            ))}
          </div>
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="category-tile-grid">
            {homeCategories.map((c) => (
              <CategoryTileButton
                key={c.id}
                name={c.name}
                icon={categoryIcon(c.slug, c.name)}
                onClick={() => props.onExploreCategory(c.slug)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Local deals banner: platform-level promo surface. */}
      <section className="deals-banner" aria-label="Local deals">
        <p className="deals-banner-kicker">Local deals</p>
        <p className="deals-banner-title">Support local businesses</p>
        <p className="deals-banner-sub">Book a service or order from businesses near you.</p>
        <button
          type="button"
          className="deals-cta"
          onClick={() => {
            setQuery('');
            props.onSeeAllCategories();
          }}
        >
          Explore now
        </button>
      </section>

      {/* Popular near you: compact marketplace cards. */}
      <section aria-label="Businesses">
        <SectionHeader
          title="Popular near you"
          action={
            <button type="button" className="see-all-link" onClick={props.onSeeAllCategories}>
              See all
            </button>
          }
        />
        {businesses.loading ? (
          <div className="popular-grid" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="skeleton" style={{ height: 96, borderRadius: 0 }} />
                <div style={{ padding: 12 }}>
                  <div className="skeleton skeleton-line w-60" />
                  <div className="skeleton skeleton-line w-40" style={{ marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : businesses.error ? (
          <ErrorState message={businesses.error} onRetry={businesses.reload} />
        ) : !popular.length ? (
          <EmptyStateV3
            icon={<StoreIcon size={28} />}
            title="No businesses yet"
            body="Approved nearby businesses will appear here as they join NearbyOrders."
          />
        ) : (
          <div className="popular-grid">
            {popular.map((b) => (
              <PopularBusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryTileButton(props: { name: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="category-tile" onClick={props.onClick}>
      <span className="category-tile-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="category-tile-name">{props.name}</span>
    </button>
  );
}

/**
 * Compact marketplace card: brand-gradient media block (business image when
 * available, otherwise an intentional branded monogram fallback), name,
 * rating, category and open/closed status.
 */
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
