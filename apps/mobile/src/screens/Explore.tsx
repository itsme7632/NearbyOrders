import { useState } from 'react';
import { listBusinesses, listCategories, listNearbyBusinesses, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { ExploreIcon, PinIcon } from '../components/icons.js';
import { EmptyStateV3 } from '../components/EmptyStateV3.js';
import { PopularBusinessCard } from './Home.js';
import { requestCustomerLocation, locationOutcomeHint, type LocationOutcome } from '../location.js';

/**
 * Explore with Phase 11 "Near You" discovery. Customer location is optional:
 * the default list is unaffected until the user explicitly turns on nearby
 * mode, and a denied/unavailable permission simply returns to that list. All
 * distances come from the server (Haversine over configured coordinates).
 */
type DiscoveryMode = 'all' | 'nearby';

export function ExploreScreen(props: {
  initialCategory?: string;
  initialQuery?: string;
  onOpenBusiness: (id: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(props.initialCategory);
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(
    () =>
      // Nearby mode uses the dedicated endpoint (server-side distance + radius);
      // the default list keeps its existing search/filter behavior untouched.
      mode === 'nearby' && coords
        ? listNearbyBusinesses({ lat: coords.lat, lng: coords.lng, radiusKm: 25, limit: 50 })
        : listBusinesses({
            q: query || undefined,
            category: selectedCategory,
          }),
    [query, selectedCategory, mode, coords],
  );

  const enableNearby = () => {
    setLocNote(null);
    setLocating(true);
    requestCustomerLocation()
      .then((outcome: LocationOutcome) => {
        if (outcome.status === 'granted') {
          setCoords(outcome.coords);
          setMode('nearby');
        } else {
          setLocNote(locationOutcomeHint(outcome));
        }
      })
      .finally(() => setLocating(false));
  };

  const disableNearby = () => {
    setMode('all');
    setCoords(null);
    setLocNote(null);
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

      {/* Controls: Near You toggle + category chips, visually one control band. */}
      <section aria-label="Filters" style={{ marginTop: 12 }}>
        <div className="filter-row">
          {mode === 'nearby' ? (
            <button type="button" className="chip chip-active" onClick={disableNearby}>
              <PinIcon size={14} /> Near you ✓
            </button>
          ) : (
            <button type="button" className="chip" onClick={enableNearby} disabled={locating}>
              <PinIcon size={14} /> {locating ? 'Finding you…' : 'Near you'}
            </button>
          )}
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
        title={mode === 'nearby' ? 'Near you' : selectedCategory ? (categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results') : query ? 'Search results' : 'All businesses'}
        action={
          businesses.loading ? null : (
            <span className="biz-distance">
              {results.length} {results.length === 1 ? 'business' : 'businesses'}
              {mode === 'nearby' ? ' · closest first' : ''}
            </span>
          )
        }
      />
      {locNote ? (
        <p className="hint" role="status">
          {locNote}
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
          title={mode === 'nearby' ? 'Nothing nearby yet' : 'Nothing found'}
          body={
            mode === 'nearby'
              ? 'No businesses within 25 km of you have set a map location yet. Try All businesses instead.'
              : activeFilters > 0
                ? 'Try a different search term or category filter.'
                : 'No businesses match yet. Check back soon.'
          }
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
