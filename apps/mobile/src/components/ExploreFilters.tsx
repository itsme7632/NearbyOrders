import { useEffect, useState } from 'react';
import { Sheet } from './primitives.js';
import type { Business, BusinessSearchResult } from '../api.js';
import './ExploreFilters.css';

/* ==================================================================
   Explore filter system (Phase 2B).

   Only filters the discovery backend meaningfully supports are modeled
   here:

     GET /api/v1/search  ->  q, categoryId, type, openNow, minRating, sort,
                             lat/lng, radiusKm
       schema:   apps/api/src/lib.ts:176  (searchQuerySchema)
       handler:  apps/api/src/server.ts:436
       - openNow: only 'true' applies a filter (the handler checks
         `openNow === 'true'`; 'false' means "no constraint").
       - minRating: server-side filter on the business's average rating.
       - sort: relevance | distance | rating; 'distance' without
         coordinates degrades honestly to 'relevance' (echoed back).

   The plain list (GET /api/v1/businesses, server.ts:300) and the nearby
   endpoint (GET /api/v1/businesses/nearby, server.ts:372) accept NO
   openNow/minRating/sort params, and /search business hits carry no
   coordinates — so in nearby mode the nearby endpoint stays the single
   source of truth (the map needs real coordinates) and the extra
   filters apply to its server result set via the server-computed fields
   (isOpenNow, averageRating). Nothing is ever fabricated client-side.

   Deliberately NOT implemented (no backend support anywhere in the
   discovery endpoints): delivery-available, booking-available,
   price level. `hasDelivery`/`hasBooking`/`priceLevel` appear nowhere in
   the /search, /businesses, or /businesses/nearby query contracts.
   ================================================================== */

/** Sort keys the filter UI offers; a subset of the server's SearchSort. */
export type ExploreSort = 'relevance' | 'distance' | 'rating';

export type ExploreFilters = {
  /** Show only businesses currently open (server-evaluated hours). */
  openNow: boolean;
  /** Minimum average rating, or null for "any rating". */
  minRating: number | null;
  /** Result ordering. 'distance' needs coordinates (nearby mode). */
  sort: ExploreSort;
};

export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = {
  openNow: false,
  minRating: null,
  sort: 'relevance',
};

/** Rating thresholds offered in the sheet; null = "Any rating". */
export const MIN_RATING_OPTIONS: (number | null)[] = [null, 3, 3.5, 4, 4.5];

/** Quick-chip threshold for "Top rated"-style toggling. */
export const QUICK_TOP_RATED = 4;

/** Number of active (non-default) filters — drives the badge + clear-all. */
export function countActiveFilters(f: ExploreFilters): number {
  return (f.openNow ? 1 : 0) + (f.minRating !== null ? 1 : 0) + (f.sort !== 'relevance' ? 1 : 0);
}

/**
 * Pure mapping from filter state to the /api/v1/search query params the
 * backend validates (searchQuerySchema). Defaults are omitted so the
 * request stays minimal — the server treats a missing param as "no
 * constraint". Reset = DEFAULT_EXPLORE_FILTERS, which maps to {}.
 */
export function buildDiscoveryQuery(filters: ExploreFilters): Record<string, string> {
  const params: Record<string, string> = {};
  // The server only honors openNow='true'; anything else is "no constraint".
  if (filters.openNow) params.openNow = 'true';
  if (filters.minRating !== null) params.minRating = String(filters.minRating);
  if (filters.sort !== 'relevance') params.sort = filters.sort;
  return params;
}

/**
 * Nearby-mode filtering. The /businesses/nearby result set is already
 * server-authoritative (real distances, closest-first); these predicates
 * only narrow/reorder it using the server-computed fields on each row.
 * 'distance' is the endpoint's native order (no-op); 'relevance' without
 * a query term falls back to it.
 */
export function applyNearbyFilters(businesses: Business[], filters: ExploreFilters): Business[] {
  let rows = businesses;
  if (filters.openNow) rows = rows.filter((b) => b.isOpenNow === true);
  if (filters.minRating !== null) {
    const min = filters.minRating;
    rows = rows.filter((b) => (b.averageRating ?? -1) >= min);
  }
  if (filters.sort === 'rating') {
    rows = [...rows].sort(
      (a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    );
  }
  return rows;
}

/**
 * Adapts a business-type /search hit to the Business shape BusinessRow
 * renders. Every displayed field comes from the server hit; fields the
 * search contract omits (address, coordinates, contact details) stay
 * null/empty — opening the row re-fetches the full business by id, so
 * nothing the user can act on is invented.
 */
export function businessSearchResultToBusiness(r: BusinessSearchResult): Business {
  return {
    id: r.businessId,
    name: r.name,
    slug: r.businessSlug,
    description: r.description,
    imageUrl: r.imageUrl,
    isVerified: r.isVerified,
    address: '',
    city: r.city,
    locality: r.locality,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    currency: '',
    isOpenNow: r.isOpenNow,
    distanceKm: r.distanceKm ?? undefined,
    averageRating: r.averageRating,
    reviewCount: r.reviewCount,
    categories: r.categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isActive: true })),
  };
}

const SORT_LABELS: Record<ExploreSort, string> = {
  relevance: 'Recommended',
  distance: 'Nearest',
  rating: 'Highest rated',
};

const SORT_ORDER: ExploreSort[] = ['relevance', 'rating', 'distance'];

/* ------------------------- Filter bar ------------------------- */

/**
 * Compact, horizontally scrollable filter bar: quick-toggle chips
 * ("Open now", "4.0+"), a sort chip reflecting the current ordering, a
 * "Filters" button with an active-count badge, and a "Clear all"
 * affordance whenever any filter is active. The full filter set lives in
 * the sheet below; the bar owns its open state.
 */
export function ExploreFilterBar(props: {
  filters: ExploreFilters;
  onChange: (f: ExploreFilters) => void;
  /** True when coordinates exist, so "Nearest" sort is meaningful. */
  canSortByDistance: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { filters, onChange } = props;
  const active = countActiveFilters(filters);

  const toggle = (patch: Partial<ExploreFilters>) => onChange({ ...filters, ...patch });

  return (
    <>
      <div className="explore-filter-bar" role="group" aria-label="Quick filters">
        <button
          type="button"
          className={`chip${filters.openNow ? ' chip-active' : ''}`}
          aria-pressed={filters.openNow}
          onClick={() => toggle({ openNow: !filters.openNow })}
        >
          Open now
        </button>
        <button
          type="button"
          className={`chip${filters.minRating === QUICK_TOP_RATED ? ' chip-active' : ''}`}
          aria-pressed={filters.minRating === QUICK_TOP_RATED}
          onClick={() => toggle({ minRating: filters.minRating === QUICK_TOP_RATED ? null : QUICK_TOP_RATED })}
        >
          4.0+
        </button>
        <button
          type="button"
          className={`chip${filters.sort !== 'relevance' ? ' chip-active' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          Sort: {SORT_LABELS[filters.sort]}
        </button>
        <button
          type="button"
          className={`chip explore-filters-btn${active > 0 ? ' chip-active' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          Filters
          {active > 0 ? (
            <span className="filter-badge" aria-label={`${active} active filters`}>
              {active}
            </span>
          ) : null}
        </button>
        {active > 0 ? (
          <button type="button" className="filter-clear" onClick={() => onChange(DEFAULT_EXPLORE_FILTERS)}>
            Clear all
          </button>
        ) : null}
      </div>
      <ExploreFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => {
          onChange(f);
          setSheetOpen(false);
        }}
        initial={filters}
        canSortByDistance={props.canSortByDistance}
      />
    </>
  );
}

/* ------------------------- Filter sheet ------------------------- */

/**
 * Full filter set in a Phase 1 Sheet. Edits go to a draft that is only
 * committed on Apply; dismissing via backdrop, Escape, or the close
 * button discards the draft. The draft re-seeds from the applied
 * filters every time the sheet opens.
 */
export function ExploreFilterSheet(props: {
  open: boolean;
  onClose: () => void;
  onApply: (f: ExploreFilters) => void;
  initial: ExploreFilters;
  canSortByDistance: boolean;
}) {
  const [draft, setDraft] = useState<ExploreFilters>(props.initial);

  useEffect(() => {
    if (props.open) setDraft(props.initial);
    // Re-seed on every open; a discarded session must not leak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const active = countActiveFilters(draft);
  const set = (patch: Partial<ExploreFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Filters"
      subtitle="Only businesses matching every filter are shown."
    >
      <fieldset className="ff-group">
        <legend className="type-label ff-legend">Availability</legend>
        <label className="ff-option">
          <input
            type="checkbox"
            checked={draft.openNow}
            onChange={(e) => set({ openNow: e.target.checked })}
          />
          <span>
            <span className="ff-option-title">Open now</span>
            <span className="ff-option-hint type-meta">Hide businesses that are currently closed</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="ff-group">
        <legend className="type-label ff-legend">Minimum rating</legend>
        <div role="radiogroup" aria-label="Minimum rating">
          {MIN_RATING_OPTIONS.map((v) => (
            <label key={v === null ? 'any' : String(v)} className="ff-option">
              <input
                type="radio"
                name="explore-min-rating"
                checked={draft.minRating === v}
                onChange={() => set({ minRating: v })}
              />
              <span className="ff-option-title">{v === null ? 'Any rating' : `${v.toFixed(1)} & up`}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="ff-group">
        <legend className="type-label ff-legend">Sort by</legend>
        <div role="radiogroup" aria-label="Sort by">
          {SORT_ORDER.map((s) => {
            const disabled = s === 'distance' && !props.canSortByDistance;
            return (
              <label key={s} className={`ff-option${disabled ? ' ff-option-disabled' : ''}`}>
                <input
                  type="radio"
                  name="explore-sort"
                  checked={draft.sort === s}
                  disabled={disabled}
                  onChange={() => set({ sort: s })}
                />
                <span>
                  <span className="ff-option-title">{SORT_LABELS[s]}</span>
                  {s === 'distance' && !props.canSortByDistance ? (
                    <span className="ff-option-hint type-meta">Turn on “Near you” to sort by distance</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="ff-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setDraft(DEFAULT_EXPLORE_FILTERS)}>
          Reset
        </button>
        <button type="button" className="btn btn-primary ff-apply" onClick={() => props.onApply(draft)}>
          {active > 0 ? `Apply · ${active} active` : 'Apply'}
        </button>
      </div>
    </Sheet>
  );
}
