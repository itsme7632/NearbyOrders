import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessCard, BusinessCardSkeleton, CategoryTile, EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { BookingsIcon, ExploreIcon, HomeIcon, OrdersIcon, PinIcon, ProfileIcon, StoreIcon } from '../components/icons.js';

/** Primary categories shown on Home; the rest live in Explore behind "See all". */
const HOME_CATEGORY_LIMIT = 8;

/** Category name → icon glyph. Unknown categories get the generic storefront. */
const CATEGORY_ICONS: Record<string, (size: number) => React.ReactNode> = {
  'food-restaurants': (s) => <BookingsIcon size={s} />,
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
  const key = Object.keys(CATEGORY_ICONS).find((k) => slug.includes(k) || name.toLowerCase().includes(k));
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

  // Deterministic trim: the API already orders by name, so the first N are
  // stable across renders and reloads.
  const homeCategories = categories.data?.slice(0, HOME_CATEGORY_LIMIT) ?? [];
  const hasMoreCategories = (categories.data?.length ?? 0) > HOME_CATEGORY_LIMIT;

  return (
    <div className="screen">
      <header className="home-top">
        <div>
          <h1>NearbyOrders</h1>
          <p className="home-tagline">Find nearby. Book or order.</p>
        </div>
      </header>

      <form
        className="search-hero"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSearch(query);
        }}
      >
        <span className="search-hero-icon" aria-hidden>
          <ExploreIcon size={18} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search restaurants, services, shops…"
          aria-label="Search businesses"
        />
      </form>

      <section aria-label="Categories">
        <SectionHeader
          title="Explore categories"
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
              <CategoryTile
                key={c.id}
                name={c.name}
                icon={categoryIcon(c.slug, c.name)}
                onClick={() => props.onExploreCategory(c.slug)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Businesses">
        <SectionHeader title="Popular near you" />
        {businesses.loading ? (
          <BusinessCardSkeleton count={3} />
        ) : businesses.error ? (
          <ErrorState message={businesses.error} onRetry={businesses.reload} />
        ) : !businesses.data?.length ? (
          <EmptyState
            icon={<StoreIcon size={30} />}
            title="No businesses yet"
            body="Approved nearby businesses will appear here as they join NearbyOrders."
          />
        ) : (
          <div className="business-list">
            {businesses.data.map((b) => (
              <BusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
