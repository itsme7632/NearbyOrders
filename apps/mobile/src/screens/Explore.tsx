import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { ExploreIcon } from '../components/icons.js';
import { EmptyStateV3 } from '../components/EmptyStateV3.js';
import { PopularBusinessCard } from './Home.js';

/** Distance-aware sort uses the geolocation API when the user permits it. */
type SortMode = 'default' | 'distance';

export function ExploreScreen(props: {
  initialCategory?: string;
  initialQuery?: string;
  onOpenBusiness: (id: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(props.initialCategory);
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [sort, setSort] = useState<SortMode>('default');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(
    () =>
      listBusinesses({
        q: query || undefined,
        category: selectedCategory,
        nearLat: coords?.lat,
        nearLng: coords?.lng,
        radiusKm: coords ? 25 : undefined,
      }),
    [query, selectedCategory, coords],
  );

  const requestLocation = () => {
    setLocError(null);
    if (!('geolocation' in navigator)) {
      setLocError('Location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSort('distance');
      },
      () => setLocError('Location permission was denied. You can still browse all businesses.'),
      { timeout: 8000 },
    );
  };

  const results = businesses.data ?? [];
  const activeFilters = [selectedCategory ? 1 : 0, query ? 1 : 0].reduce((a, b) => a + b, 0);

  return (
    <div className="screen">
      {/* Discovery header: title + major search control. */}
      <section className="home-greeting" aria-label="Explore">
        <h1 className="home-greeting-title" style={{ fontSize: 'clamp(22px, 6vw, 26px)' }}>
          Explore <em>nearby</em>
        </h1>
        <p className="home-greeting-sub">Every approved business on NearbyOrders.</p>
      </section>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          // state change above already re-triggers the query via useAsyncData deps
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

      {/* Controls: sort toggle + category chips, visually one control band. */}
      <section aria-label="Filters" style={{ marginTop: 12 }}>
        <div className="filter-row">
          <button
            type="button"
            className={`chip${sort === 'distance' ? ' chip-active' : ''}`}
            onClick={() => {
              if (sort === 'distance') {
                setSort('default');
                setCoords(null);
              } else {
                requestLocation();
              }
            }}
          >
            📍 Sort by distance
          </button>
          {categories.data?.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className={`chip${selectedCategory === c.slug ? ' chip-active' : ''}`}
              onClick={() => setSelectedCategory(selectedCategory === c.slug ? undefined : c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <SectionHeader
        title={
          selectedCategory
            ? categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results'
            : query
              ? 'Search results'
              : 'All nearby'
        }
        action={
          businesses.loading ? null : (
            <span className="biz-distance">
              {results.length} {results.length === 1 ? 'business' : 'businesses'}
              {sort === 'distance' ? ' · by distance' : ''}
            </span>
          )
        }
      />
      {locError ? (
        <p className="hint" role="status">
          {locError}
        </p>
      ) : null}
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
      ) : !results.length ? (
        <EmptyStateV3
          icon={<ExploreIcon size={28} />}
          title="Nothing found"
          body={activeFilters > 0 ? 'Try a different search term or category filter.' : 'No businesses match yet. Check back soon.'}
        />
      ) : (
        <div className="popular-grid">
          {results.map((b) => (
            <PopularBusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
