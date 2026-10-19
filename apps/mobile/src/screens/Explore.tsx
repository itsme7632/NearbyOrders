import { useEffect, useState } from 'react';
import { listBusinesses, listCategories, listNearbyBusinesses, searchMarketplace, type Business, type Category } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { BusinessRow, EmptyState, ErrorState, SectionHeader } from '../components/ui.js';
import { SegmentedControl } from '../components/primitives.js';
import {
  ExploreFilterBar,
  applyNearbyFilters,
  businessSearchResultToBusiness,
  countActiveFilters,
  DEFAULT_EXPLORE_FILTERS,
  type ExploreFilters,
} from '../components/ExploreFilters.js';
import { ExploreIcon, PinIcon } from '../components/icons.js';
import { clearCustomerCoords, requestCustomerLocation, locationOutcomeHint, isDeniedOutcome, restoreCustomerCoords, saveCustomerCoords, type LocationOutcome } from '../location.js';
import { useLocationExplainer } from '../components/LocationPermissionExplainer.js';
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
  /** Phase 14: opens the dedicated unified search screen. */
  onOpenSearch?: (query: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(props.initialCategory);
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [input, setInput] = useState(props.initialQuery ?? '');
  const [mode, setMode] = useState<DiscoveryMode>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [locDismissed, setLocDismissed] = useState(false);
  const [locating, setLocating] = useState(false);
  const { requestWithExplainer, explainer: locationExplainer } = useLocationExplainer();

  // Restore persisted coordinates on mount when the OS permission is still granted.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await restoreCustomerCoords();
      if (cancelled || !restored) return;
      setCoords(restored);
      setMode('nearby');
    })();
    return () => { cancelled = true; };
  }, []);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_EXPLORE_FILTERS);
  const { handle: mapHandle } = useMapProvider();

  const categories = useAsyncData<Category[]>(() => listCategories(), []);
  // The /search endpoint identifies categories by ID (uuid), while the
  // category band works in slugs — resolve once the list has loaded.
  const categoryId = selectedCategory ? categories.data?.find((c) => c.slug === selectedCategory)?.id : undefined;
  const advancedFiltersActive = countActiveFilters(filters) > 0;

  const businesses = useAsyncData<Business[]>(
    async () => {
      // Nearby mode: the dedicated endpoint stays authoritative — the map
      // needs real coordinates, which /search does not return. The extra
      // filters narrow/reorder its server result set via server-computed
      // fields (see applyNearbyFilters); nothing is invented.
      if (mode === 'nearby' && coords) {
        const rows = await listNearbyBusinesses({ lat: coords.lat, lng: coords.lng, radiusKm, limit: 50 });
        return applyNearbyFilters(rows, filters);
      }
      // Filtered discovery goes through the unified /search endpoint — the
      // only discovery API whose contract supports openNow/minRating/sort
      // (apps/api/src/lib.ts:176). Unfiltered browsing keeps the existing
      // list endpoint and its behavior untouched.
      if (advancedFiltersActive) {
        const page = await searchMarketplace({
          q: query || undefined,
          categoryId,
          type: 'business',
          limit: 50,
          ...(filters.openNow ? { openNow: true } : {}),
          ...(filters.minRating !== null ? { minRating: filters.minRating } : {}),
          ...(filters.sort !== 'relevance' ? { sort: filters.sort } : {}),
        });
        return page.results.filter((r) => r.type === 'business').map(businessSearchResultToBusiness);
      }
      return listBusinesses({
        q: query || undefined,
        category: selectedCategory,
      });
    },
    [query, selectedCategory, categoryId, mode, coords, radiusKm, filters],
  );

  const enableNearby = () => {
    // First-use gate: the in-app explainer appears before the native dialog
    // on a fresh device; granted/denied states go straight through.
    requestWithExplainer(() => {
      setLocNote(null);
      setLocDenied(false);
      setLocDismissed(false);
      setLocating(true);
      requestCustomerLocation()
        .then((outcome: LocationOutcome) => {
          if (outcome.status === 'granted') {
            setCoords(outcome.coords);
            saveCustomerCoords(outcome.coords);
            setRadiusKm(DEFAULT_RADIUS_KM);
            setMode('nearby');
            setLocDenied(false);
          } else if (isDeniedOutcome(outcome)) {
            // Denied stays non-blocking: the full list keeps working and a calm
            // card explains the situation with a retry and a dismiss path.
            setCoords(null);
            clearCustomerCoords();
            setLocNote(locationOutcomeHint(outcome));
            setLocDenied(true);
            setLocDismissed(false);
          } else {
            setCoords(null);
            setLocNote(locationOutcomeHint(outcome));
            setLocDenied(false);
          }
        })
        .finally(() => setLocating(false));
    });
  };

  const disableNearby = () => {
    setMode('all');
    setCoords(null);
    clearCustomerCoords();
    setLocNote(null);
    setLocDenied(false);
    setLocDismissed(false);
    setSelectedMarker(null);
    setView('list');
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
  const activeFilters = (selectedCategory ? 1 : 0) + (query ? 1 : 0) + countActiveFilters(filters);
  const mapUsable = mode === 'nearby' && coords !== null;

  return (
    <div className="screen explore-screen">
      {/* Atlas hero: confident commerce-first framing. The sticky search bar
          below stays the working entry point; this header scrolls away. */}
      <header className="explore-hero">
        <h1>Explore</h1>
        <p>Find businesses you can order from or book, near you.</p>
      </header>
      {/* Sticky discovery controls: search commits to unified search; the
          location pill toggles spatial nearby mode. */}
      <div className="explore-top">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            // Phase 14: committed searches go to the dedicated unified search
            // screen, which also matches services and products.
            if (input.trim()) props.onOpenSearch?.(input.trim());
          }}
        >
          <div className="search-bar-v3 explore-search">
            <span className="search-hero-icon" style={{ position: 'static', transform: 'none' }} aria-hidden>
              <ExploreIcon size={18} />
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search this area"
              aria-label="Search businesses"
            />
            <button type="submit" className="search-go" aria-label="Search">
              <ExploreIcon size={16} />
            </button>
          </div>
        </form>
        <div className="filter-row explore-controls">
          {mode === 'nearby' ? (
            <button type="button" className="chip chip-active" onClick={disableNearby}>
              <PinIcon size={14} /> Near you ✓
            </button>
          ) : (
            <button type="button" className="chip" onClick={enableNearby} disabled={locating}>
              <PinIcon size={14} /> {locating ? 'Finding you…' : 'Near you'}
            </button>
          )}
          {mapUsable ? (
            <SegmentedControl
              label="Result view"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'map', label: 'Map' },
              ]}
            />
          ) : null}
        </div>
      </div>

      {/* Category band: horizontally scrollable so every category stays reachable. */}
      <section aria-label="Category filters" style={{ marginTop: 10 }}>
        <div className="filter-row">
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
      </section>

      {/* Filter bar: quick toggles + full filter sheet (Phase 2B). */}
      <section aria-label="Discovery filters" style={{ marginTop: 2 }}>
        <ExploreFilterBar filters={filters} onChange={setFilters} canSortByDistance={coords !== null} />
      </section>

      {/* Radius: only meaningful in nearby mode; drives the server query. */}
      {mode === 'nearby' ? (
        <section aria-label="Search radius" style={{ marginTop: 8 }}>
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

      {locDenied && !locDismissed ? (
        <div className="location-denied-card" role="status" aria-live="polite">
          <span className="location-denied-icon" aria-hidden>
            <PinIcon size={16} />
          </span>
          <div className="location-denied-body">
            <p className="location-denied-title">Location is off</p>
            <p className="location-denied-text">
              {locNote ?? 'Nearby mode needs location access. You can keep browsing every business in the list either way.'}
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
      ) : locNote ? (
        <p className="hint" role="status">
          {locNote}
        </p>
      ) : null}

      {/* MAP-FIRST: when a spatial result set exists, the map is the hero and
          results render as a bottom sheet over it. */}
      {mapUsable && view === 'map' ? (
        <div className="map-sheet">
          {businesses.loading ? (
            <p className="hint" role="status" style={{ marginTop: 8 }}>
              Loading nearby businesses…
            </p>
          ) : businesses.error ? (
            <ErrorState message={businesses.error} onRetry={businesses.reload} />
          ) : !results.length ? (
            <div className="map-empty-note">
              <p className="hint" role="status" style={{ margin: 0 }}>
                No businesses with map locations in this area yet. Pan the map and use “Search this area”, or switch back to
                the list.
              </p>
            </div>
          ) : (
            <>
              <SectionHeader
                title="Near you"
                action={
                  <span className="biz-distance">
                    {results.length} {results.length === 1 ? 'business' : 'businesses'} · within {radiusKm} km ·{' '}
                    {filters.sort === 'rating' ? 'top rated first' : 'closest first'}
                  </span>
                }
              />
              <ExploreMapView
                handle={mapHandle}
                results={results}
                searchCenter={coords}
                selectedId={selectedMarker}
                onSelect={setSelectedMarker}
                onOpenBusiness={props.onOpenBusiness}
                onSearchArea={searchThisArea}
              />
              <div className="sheet-rows">
                {results.map((b) => (
                  <BusinessRow key={b.id} business={b} selected={selectedMarker === b.id} onOpen={() => props.onOpenBusiness(b.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* LIST VIEW: full-height editorial rows (and the default for non-nearby). */}
      {!(mapUsable && view === 'map') ? (
        <>
          <SectionHeader
            title={
              mode === 'nearby'
                ? 'Near you'
                : selectedCategory
                  ? (categories.data?.find((c) => c.slug === selectedCategory)?.name ?? 'Results')
                  : query
                    ? 'Search results'
                    : advancedFiltersActive
                      ? 'Filtered businesses'
                      : 'All businesses'
            }
            action={
              businesses.loading ? null : (
                <span className="biz-distance">
                  {results.length} {results.length === 1 ? 'business' : 'businesses'}
                  {mode === 'nearby'
                    ? ` · ${filters.sort === 'rating' ? 'top rated first' : 'closest first'} · within ${radiusKm} km`
                    : ''}
                </span>
              )
            }
          />
          {businesses.loading ? (
            <div className="biz-rows" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="biz-row" style={{ pointerEvents: 'none' }}>
                  <span className="biz-row-media skeleton" />
                  <span className="biz-row-main">
                    <div className="skeleton skeleton-line w-60" />
                    <div className="skeleton skeleton-line w-40" style={{ marginTop: 6 }} />
                  </span>
                </div>
              ))}
            </div>
          ) : businesses.error ? (
            <ErrorState message={businesses.error} onRetry={businesses.reload} />
          ) : !results.length ? (
            <EmptyState
              icon={<ExploreIcon size={28} />}
              title={mode === 'nearby' ? 'Nothing nearby yet' : 'Nothing found'}
              body={
                mode === 'nearby'
                  ? `No businesses within ${radiusKm} km of you have set a map location yet. Try All businesses instead.`
                  : activeFilters > 0
                    ? 'Try a different search term or category, or widen your filters.'
                    : 'No businesses match yet. Check back soon.'
              }
            />
          ) : (
            <div className="biz-rows">
              {results.map((b) => (
                <BusinessRow key={b.id} business={b} onOpen={() => props.onOpenBusiness(b.id)} showDescription />
              ))}
            </div>
          )}
        </>
      ) : null}
      {locationExplainer}
    </div>
  );
}
