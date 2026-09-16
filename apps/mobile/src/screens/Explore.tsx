import { useState } from 'react';
import { listBusinesses, listCategories, listNearbyBusinesses, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { ExploreIcon, PinIcon } from '../components/icons.js';
import { EmptyStateV3 } from '../components/EmptyStateV3.js';
import { PopularBusinessCard } from './Home.js';
import { requestCustomerLocation, locationOutcomeHint, type LocationOutcome } from '../location.js';
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS_KM } from '@nearbyorders/shared';
import { useMapProvider } from '../maps/useMapProvider.js';
import { ExploreMapView } from './ExploreMapView.js';
import type { LatLng } from '../maps/provider.js';

/**
 * Explore with Phase 11 "Near You" discovery and the Phase 12 map experience.
 * Customer location is optional: the default list is unaffected until the user
 * explicitly turns on nearby mode, and a denied/unavailable permission simply
 * returns to that list. All distances come from the server (Haversine over
 * configured coordinates); the map only renders the same server result set.
 */
type DiscoveryMode = 'all' | 'nearby';
type ViewMode = 'list' | 'map';

export function ExploreScreen(props: {
  initialCategory?: string;
  initialQuery?: string;
  onOpenBusiness: (id: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(props.initialCategory);
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const { handle: mapHandle } = useMapProvider();

  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  const businesses = useAsyncData<Business[]>(
    () =>
      // Nearby mode uses the dedicated endpoint (server-side distance + radius);
      // the default list keeps its existing search/filter behavior untouched.
      mode === 'nearby' && coords
        ? listNearbyBusinesses({ lat: coords.lat, lng: coords.lng, radiusKm, limit: 50 })
        : listBusinesses({
            q: query || undefined,
            category: selectedCategory,
          }),
    [query, selectedCategory, mode, coords, radiusKm],
  );

  const enableNearby = () => {
    setLocNote(null);
    setLocating(true);
    requestCustomerLocation()
      .then((outcome: LocationOutcome) => {
        if (outcome.status === 'granted') {
          setCoords(outcome.coords);
          setRadiusKm(DEFAULT_RADIUS_KM);
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
    setSelectedMarker(null);
  };

  const searchThisArea = (center: LatLng) => {
    // The visible map center becomes the new search center; distance stays
    // server-authoritative. Nearby mode is required for a map search.
    setCoords(center);
    setSelectedMarker(null);
    setLocNote(null);
    if (mode !== 'nearby') setMode('nearby');
  };

  const results = businesses.data ?? [];
  const activeFilters = [selectedCategory ? 1 : 0, query ? 1 : 0].reduce((a, b) => a + b, 0);
  const mapUsable = mode === 'nearby' && coords !== null;

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

      {/* Radius control: only meaningful in nearby mode; drives the server query. */}
      {mode === 'nearby' ? (
        <section aria-label="Search radius" style={{ marginTop: 10 }}>
          <div className="filter-row" role="radiogroup" aria-label="Search radius">
            {RADIUS_OPTIONS_KM.map((km) => (
              <button
                key={km}
                type="button"
                role="radio"
                aria-checked={radiusKm === km}
                className={`chip${radiusKm === km ? ' chip-active' : ''}`}
                onClick={() => {
                  setRadiusKm(km);
                  setSelectedMarker(null);
                }}
              >
                {km} km
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* List/map switch — only offered when a map result set exists. */}
      {mapUsable ? (
        <div className="view-switch" role="tablist" aria-label="Result view" style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            className={`chip${view === 'list' ? ' chip-active' : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'map'}
            className={`chip${view === 'map' ? ' chip-active' : ''}`}
            onClick={() => setView('map')}
          >
            Map
          </button>
        </div>
      ) : null}

      <SectionHeader
        title={mode === 'nearby' ? 'Near you' : selectedCategory ? (categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results') : query ? 'Search results' : 'All businesses'}
        action={
          businesses.loading ? null : (
            <span className="biz-distance">
              {results.length} {results.length === 1 ? 'business' : 'businesses'}
              {mode === 'nearby' ? ` · closest first · within ${radiusKm} km` : ''}
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
        view === 'map' && mapUsable ? (
          <p className="hint" role="status" style={{ marginTop: 8 }}>
            Loading nearby businesses…
          </p>
        ) : (
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
        )
      ) : businesses.error ? (
        <ErrorState message={businesses.error} onRetry={businesses.reload} />
      ) : !results.length ? (
        view === 'map' && mapUsable ? (
          <div className="map-empty-note" style={{ marginTop: 10 }}>
            <p className="hint" role="status" style={{ margin: 0 }}>
              No businesses with map locations in this area yet. Pan the map and use “Search this area”, or switch back to
              the list.
            </p>
          </div>
        ) : (
          <EmptyStateV3
            icon={<ExploreIcon size={28} />}
            title={mode === 'nearby' ? 'Nothing nearby yet' : 'Nothing found'}
            body={
              mode === 'nearby'
                ? `No businesses within ${radiusKm} km of you have set a map location yet. Try All businesses instead.`
                : activeFilters > 0
                  ? 'Try a different search term or category filter.'
                  : 'No businesses match yet. Check back soon.'
            }
          />
        )
      ) : view === 'map' && mapUsable ? (
        <ExploreMapView
          handle={mapHandle}
          results={results}
          searchCenter={coords}
          selectedId={selectedMarker}
          onSelect={setSelectedMarker}
          onOpenBusiness={props.onOpenBusiness}
          onSearchArea={searchThisArea}
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
