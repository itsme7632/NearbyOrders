/**
 * Unified marketplace search contract (Phase 14).
 *
 * One server endpoint (`GET /api/v1/search`) answers "what can I book or buy?"
 * across businesses, services, and products. These types are the single source
 * of truth for the response shape on both sides — the API builds them and the
 * mobile client renders them — so a field can never drift between tiers.
 *
 * Server-authoritative by design: distances are computed over real configured
 * coordinates, radius clamps live in the API schema, and the effective sort is
 * echoed back (`sort`) so the client never displays a claim it cannot back.
 */

/** The sort keys the server accepts; `relevance` is the default. */
export type SearchSort = 'relevance' | 'distance' | 'rating';

/** The result-type filter: `all` mixes all three kinds in one ranked list. */
export type SearchTypeFilter = 'all' | 'business' | 'service' | 'product';

/** Shared fields every result kind carries. */
export type SearchResultBase = {
  /** The matched entity's id (`businessId` differs only for catalog results). */
  id: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  /** Display title: business name, or the service/product's own name. */
  name: string;
  description: string | null;
  /** Server-computed Haversine distance in km; null when no location was sent. */
  distanceKm: number | null;
  averageRating: number | null;
  reviewCount: number;
  /** Internal relevance score (documented ordering; not a fake number). */
  score: number;
};

/** A business hit: the business itself matched the query. */
export type BusinessSearchResult = SearchResultBase & {
  type: 'business';
  imageUrl: string | null;
  city: string;
  locality: string | null;
  isVerified: boolean;
  isOpenNow: boolean;
  categories: { id: string; name: string; slug: string }[];
  /** Up to three active services as a "what they offer" preview. */
  sampleServices: { id: string; name: string; priceMinor: number; currency: string; durationMinutes: number | null }[];
};

/** A service hit: a bookable service of a matching business. */
export type ServiceSearchResult = SearchResultBase & {
  type: 'service';
  priceMinor: number;
  currency: string;
  durationMinutes: number | null;
};

/** A product hit: an orderable product of a matching business. */
export type ProductSearchResult = SearchResultBase & {
  type: 'product';
  priceMinor: number;
  currency: string;
  imageUrl: string | null;
};

export type SearchResult = BusinessSearchResult | ServiceSearchResult | ProductSearchResult;

/** Wrapped list response: { data: { results, nextCursor, total, sort } }. */
export type SearchPage = {
  results: SearchResult[];
  /** Offset-style cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  /** Total matches for this query + filters (not just this page). */
  total: number;
  /** The sort actually applied — `distance` degrades to `relevance` without coordinates. */
  sort: SearchSort;
};
