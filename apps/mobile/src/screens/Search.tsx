import { useEffect, useMemo, useState } from 'react';
import './Search.css';
import {
  listCategories,
  searchMarketplace,
  resolveImageUrl,
  type Category,
  type SearchPage,
  type SearchResult,
  type SearchSort,
  type SearchTypeFilter,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Money, OpenBadge, RatingChip, VerifiedBadge } from '../components/ui.js';
import { ExploreIcon, PinIcon, StoreIcon } from '../components/icons.js';
import { formatDistanceKm, locationOutcomeHint, requestCustomerLocation, type LocationOutcome } from '../location.js';
import { clearRecentSearches, getRecentSearches, recordSearch } from '../recent-searches.js';

/**
 * Phase 14 customer search: one honest, server-side query across businesses,
 * services, and products. The client never invents distance or relevance —
 * every result, distance, and the effective sort come from the API. Location
 * is optional (Phase 11 semantics): denied permission just hides distance and
 * the "closest first" sort; search itself always stays usable.
 */

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

const TYPE_LABEL: Record<SearchTypeFilter, string> = {
  all: 'All',
  business: 'Businesses',
  service: 'Services',
  product: 'Products',
};

/** Honest sort label: `distance` requires coordinates, so offer it only then. */
const SORT_LABEL: Record<SearchSort, string> = {
  relevance: 'Best match',
  distance: 'Closest first',
  rating: 'Top rated',
};

export function SearchScreen(props: { initialQuery?: string; onBack: () => void; onOpenBusiness: (id: string) => void }) {
  const [input, setInput] = useState(props.initialQuery ?? '');
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [type, setType] = useState<SearchTypeFilter>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // Cursor pagination: the first page comes from useAsyncData; "Load more"
  // accumulates further pages without refetching what is already visible.
  const [extraPages, setExtraPages] = useState<SearchPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const categories = useAsyncData<Category[]>(() => listCategories(), []);

  // Debounce keystrokes into committed queries so typing "bike repair" makes
  // ONE network round-trip, not one per character.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  // Phase 3B: device-local recent searches. Recorded only for committed,
  // non-empty queries — never sent anywhere, cleared explicitly by the user.
  const [recents, setRecents] = useState<string[]>(() => getRecentSearches());
  useEffect(() => {
    if (query) {
      recordSearch(query);
      setRecents(getRecentSearches());
    }
  }, [query]);

  const clearSearch = () => {
    setInput('');
    setQuery('');
  };

  const rerunRecent = (q: string) => {
    setInput(q);
    setQuery(q);
  };

  const page = useAsyncData<SearchPage>(
    () =>
      searchMarketplace({
        q: query || undefined,
        type,
        sort,
        categoryId,
        lat: coords?.lat,
        lng: coords?.lng,
        limit: PAGE_SIZE,
      }),
    [query, type, sort, categoryId, coords],
  );

  // Any new primary search resets the accumulated pages.
  useEffect(() => {
    setExtraPages([]);
    setMoreError(null);
  }, [page.data]);

  const loadMore = async () => {
    // Paginate from the LAST loaded page, not the first: after the first
    // extra page lands, its cursor (possibly null) is the source of truth.
    const cursor = (extraPages.at(-1) ?? page.data)?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await searchMarketplace({
        q: query || undefined,
        type,
        sort,
        categoryId,
        lat: coords?.lat,
        lng: coords?.lng,
        limit: PAGE_SIZE,
        cursor,
      });
      setExtraPages((prev) => [...prev, next]);
    } catch {
      setMoreError('Could not load more results. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const enableLocation = () => {
    setLocNote(null);
    setLocating(true);
    requestCustomerLocation()
      .then((outcome: LocationOutcome) => {
        if (outcome.status === 'granted') {
          setCoords(outcome.coords);
          setLocNote(null);
        } else {
          setCoords(null);
          setLocNote(locationOutcomeHint(outcome));
        }
      })
      .finally(() => setLocating(false));
  };

  const disableLocation = () => {
    setCoords(null);
    setLocNote(null);
    if (sort === 'distance') setSort('relevance');
  };

  const results: SearchResult[] = useMemo(
    () => [...(page.data?.results ?? []), ...extraPages.flatMap((p) => p.results)],
    [page.data, extraPages],
  );
  // Phase 3B: group mixed results by kind so each section reads as one
  // scannable list. Grouping is purely presentational — the server's order
  // inside each group is preserved.
  const grouped = useMemo(() => {
    const groups: { key: SearchResult['type']; title: string; items: SearchResult[] }[] = [];
    const byType = new Map<SearchResult['type'], SearchResult[]>();
    for (const r of results) {
      const list = byType.get(r.type);
      if (list) list.push(r);
      else byType.set(r.type, [r]);
    }
    const titles = { business: 'Businesses', service: 'Services', product: 'Products' } as const;
    for (const t of ['business', 'service', 'product'] as const) {
      const items = byType.get(t);
      if (items?.length) groups.push({ key: t, title: titles[t], items });
    }
    return groups;
  }, [results]);
  const hasMore = Boolean((extraPages.at(-1) ?? page.data)?.nextCursor);
  const total = page.data?.total ?? 0;
  const effectiveSort = page.data?.sort ?? sort;
  const searched = query.length > 0;
  const hasFilters = type !== 'all' || categoryId !== undefined;

  return (
    <div className="screen search-screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <section className="home-greeting search-greeting" aria-label="Search">
        <h1 className="home-greeting-title" style={{ fontSize: 'clamp(24px, 7vw, 30px)' }}>
          Search businesses, products &amp; services
        </h1>
        <p className="home-greeting-sub">Everything nearby you can order or book, in one search.</p>
      </section>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
      >
        <div className="search-bar-v3">
          <span className="search-hero-icon" style={{ position: 'static', transform: 'none' }} aria-hidden>
            <ExploreIcon size={18} />
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && input) {
                e.preventDefault();
                clearSearch();
              }
            }}
            placeholder="Try “bike repair”, “pizza”, or a business name…"
            aria-label="Search businesses, services, and products"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoFocus
          />
          {input ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              ×
            </button>
          ) : null}
          <button type="submit" className="search-go" aria-label="Search">
            <ExploreIcon size={17} />
          </button>
        </div>
      </form>

      {/* Device-local recent searches: one-tap repeat, explicit clear. Shown
          only before a search is committed — never mixed into results. */}
      {!searched && !hasFilters && !page.loading && !page.error && recents.length > 0 ? (
        <section aria-label="Recent searches" style={{ marginTop: 12 }}>
          <div className="section-head-v3" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2>Recent</h2>
            <button
              type="button"
              className="header-link"
              onClick={() => {
                clearRecentSearches();
                setRecents([]);
              }}
            >
              Clear
            </button>
          </div>
          <div className="filter-row" aria-label="Recent searches">
            {recents.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => rerunRecent(q)}>
                {q}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Result-type filter chips. */}
      <section aria-label="Result type" style={{ marginTop: 12 }}>
        <div className="filter-row" role="radiogroup" aria-label="Filter by type">
          {(Object.keys(TYPE_LABEL) as SearchTypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={`chip${type === t ? ' chip-active' : ''}`}
              onClick={() => setType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </section>

      {/* Category chips — same authoritative category IDs as Explore. */}
      {categories.data?.length ? (
        <section aria-label="Category" style={{ marginTop: 8 }}>
          <div className="filter-row" role="radiogroup" aria-label="Filter by category">
            {categories.data.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={categoryId === c.id}
                className={`chip${categoryId === c.id ? ' chip-active' : ''}`}
                onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Sort + location controls. Distance sorts only exist with a real location. */}
      <section aria-label="Sort and location" style={{ marginTop: 8 }}>
        <div className="filter-row">
          {(['relevance', 'distance', 'rating'] as SearchSort[]).map((s) => {
            const usable = s !== 'distance' || coords !== null;
            if (!usable && sort !== 'distance') return null;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sort === s}
                className={`chip${sort === s ? ' chip-active' : ''}`}
                onClick={() => usable && setSort(s)}
              >
                {SORT_LABEL[s]}
              </button>
            );
          })}
          {coords ? (
            <button type="button" className="chip chip-active" onClick={disableLocation}>
              <PinIcon size={14} /> Location on ✓
            </button>
          ) : (
            <button type="button" className="chip" onClick={enableLocation} disabled={locating}>
              <PinIcon size={14} /> {locating ? 'Finding you…' : 'Use my location'}
            </button>
          )}
        </div>
      </section>

      {locNote ? (
        <p className="hint" role="status">
          {locNote}
        </p>
      ) : null}

      {/* Honest count + effective sort from the server response. */}
      {!page.loading && !page.error ? (
        <p className="hint" role="status" aria-live="polite">
          {searched || hasFilters
            ? total === 0
              ? 'No results.'
              : `${total} ${total === 1 ? 'result' : 'results'} · ${SORT_LABEL[effectiveSort]}`
            : total === 0
              ? 'Type above to search everything on NearbyOrders.'
              : `${total} ${total === 1 ? 'result' : 'results'} · ${SORT_LABEL[effectiveSort]}`}
        </p>
      ) : null}

      {page.loading ? (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden /> Searching…
        </div>
      ) : page.error ? (
        <ErrorState message={page.error} onRetry={page.reload} />
      ) : results.length === 0 ? (
        searched || hasFilters ? (
          <EmptyState
            icon={<ExploreIcon size={28} />}
            title="Nothing matched"
            body={
              hasFilters
                ? 'Try removing a filter, checking the spelling, or searching a shorter phrase.'
                : 'Try a different phrase. Service and product names count too.'
            }
          />
        ) : (
          <EmptyState
            icon={<ExploreIcon size={28} />}
            title="Search businesses, products & services"
            body="Find businesses by what they do, bookable services, or orderable products, all in one search."
          />
        )
      ) : (
        <>
          {grouped.map((g) => (
            <section key={g.key} aria-label={g.title} style={{ marginTop: 4 }}>
              <h2 className="type-section" style={{ margin: '14px 0 6px' }}>
                {g.title}
                <span className="type-meta"> · {g.items.length}</span>
              </h2>
              <ul className="search-result-list" aria-label={`${g.title} results`}>
                {g.items.map((r) => (
                  <SearchResultRow key={`${r.type}-${r.id}`} result={r} onOpen={() => props.onOpenBusiness(r.businessId)} />
                ))}
              </ul>
            </section>
          ))}
          {moreError ? (
            <p className="auth-error" role="alert">
              {moreError}
            </p>
          ) : null}
          {hasMore ? (
            <Button full variant="secondary" sm onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more results'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One typed result row. Every claim rendered comes straight from the server. */
function SearchResultRow(props: { result: SearchResult; onOpen: () => void }) {
  const r = props.result;
  const distance = r.distanceKm !== null ? formatDistanceKm(r.distanceKm) : null;
  const place = r.type === 'business' ? [r.locality, r.city].filter(Boolean).join(', ') : null;

  return (
    <li>
      <button type="button" className="search-result-row" onClick={props.onOpen}>
        <span className="search-result-main">
          <span className="item-row">
            <span className="item-name">{r.name}</span>
            <span className={`search-kind search-kind-${r.type}`}>
              {r.type === 'business' ? 'Business' : r.type === 'service' ? 'Service' : 'Product'}
            </span>
          </span>
          <span className="item-desc">
            {r.type === 'business' ? (
              <>
                {r.categories[0]?.name ? `${r.categories[0].name} · ` : ''}
                {r.sampleServices.length > 0 ? `Offers ${r.sampleServices.map((s) => s.name).slice(0, 2).join(', ')}` : r.description ?? ''}
              </>
            ) : (
              <>
                at {r.businessName}
                {r.type === 'service' && r.durationMinutes ? ` · ${r.durationMinutes} min` : ''}
              </>
            )}
          </span>
          <span className="search-result-meta">
            {r.type === 'business' ? <VerifiedBadge verified={r.isVerified} /> : null}
            {r.type === 'business' ? <OpenBadge open={r.isOpenNow} /> : null}
            {r.type === 'service' || r.type === 'product' ? <Money minor={r.priceMinor} currency={r.currency} /> : null}
            {distance ? (
              <span className="biz-distance search-result-place">
                <PinIcon size={13} /> {distance}
              </span>
            ) : place ? (
              <span className="biz-place search-result-place">
                <PinIcon size={13} /> {place}
              </span>
            ) : null}
            <RatingChip average={r.averageRating} count={r.reviewCount} />
          </span>
        </span>
        {r.type === 'product' && r.imageUrl ? (
          <img className="search-result-thumb" src={resolveImageUrl(r.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : r.type === 'business' && r.imageUrl ? (
          <img className="search-result-thumb" src={resolveImageUrl(r.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="search-result-thumb search-result-thumb-fallback" aria-hidden>
            <StoreIcon size={22} />
          </span>
        )}
      </button>
    </li>
  );
}
