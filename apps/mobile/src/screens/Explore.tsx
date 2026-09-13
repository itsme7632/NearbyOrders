import { useState } from 'react';
import { listBusinesses, listCategories, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessCard, BusinessCardSkeleton, EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { ExploreIcon } from '../components/icons.js';

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

  // Nearby results are already distance-sorted by the API; without a fix
  // there is no client-side distance sort.
  const results = businesses.data ?? [];

  return (
    <div className="screen">
      <form
        className="search-hero"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          // state change above already re-triggers the query via useAsyncData deps
        }}
      >
        <span className="search-hero-icon" aria-hidden>
          <ExploreIcon size={18} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search businesses or services"
          aria-label="Search businesses"
        />
      </form>

      <section aria-label="Category filters">
        {categories.loading ? (
          <ListSkeletonFallback />
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="filter-row">
            <button className={`chip${!selectedCategory ? ' chip-active' : ''}`} onClick={() => setSelectedCategory(undefined)}>
              All
            </button>
            {categories.data?.map((c) => (
              <button
                key={c.id}
                className={`chip${selectedCategory === c.slug ? ' chip-active' : ''}`}
                onClick={() => setSelectedCategory(selectedCategory === c.slug ? undefined : c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Results">
        <SectionHeader
          title={selectedCategory ? categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results' : 'All nearby'}
          action={
            sort === 'distance' ? (
              <span className="biz-distance">Sorted by distance</span>
            ) : (
              <button type="button" className="see-all-link" onClick={requestLocation} disabled={businesses.loading}>
                Sort by distance
              </button>
            )
          }
        />
        {locError ? (
          <p className="hint" role="status">
            {locError}
          </p>
        ) : null}
        {businesses.loading ? (
          <BusinessCardSkeleton count={4} />
        ) : businesses.error ? (
          <ErrorState message={businesses.error} onRetry={businesses.reload} />
        ) : !results.length ? (
          <EmptyState icon={<ExploreIcon size={30} />} title="Nothing found" body="Try a different search term or category filter." />
        ) : (
          <div className="business-list">
            {results.map((b) => (
              <BusinessCard key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ListSkeletonFallback() {
  return (
    <div className="filter-row" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: 86, height: 38, borderRadius: 999 }} />
      ))}
    </div>
  );
}
