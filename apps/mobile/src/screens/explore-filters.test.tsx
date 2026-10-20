// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { Business, BusinessSearchResult, SearchPage } from '../api.js';
import { ExploreScreen } from './Explore.js';
import {
  ExploreFilterBar,
  ExploreFilterSheet,
  applyNearbyFilters,
  buildDiscoveryQuery,
  businessSearchResultToBusiness,
  countActiveFilters,
  DEFAULT_EXPLORE_FILTERS,
  type ExploreFilters,
} from '../components/ExploreFilters.js';
import { requestCustomerLocation, type LocationOutcome } from '../location.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listNearbyBusinesses: vi.fn(),
  listBusinesses: vi.fn(),
  listCategories: vi.fn(),
  searchMarketplace: vi.fn(),
}));

// Stateful shared-location mock: tests mutate `sharedLoc` to simulate grants.
export const sharedLoc = {
  coords: null as { lat: number; lng: number } | null,
  locating: false,
  locNotice: null as string | null,
  hasLocation: false,
  requestLocation: vi.fn(),
  clearLocation: vi.fn(),
};
vi.mock('../useSharedLocation.js', () => ({
  useSharedLocation: vi.fn(() => sharedLoc),
  __resetSharedLocationForTests: vi.fn(),
}));

vi.mock('../location.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../location.js')>()),
  requestCustomerLocation: vi.fn(),
  // The first-use explainer gate is tested separately; these tests exercise
  // the location flow itself, so simulate the already-decided state.
  checkLocationPermissionState: vi.fn().mockResolvedValue('granted'),
}));

/* ------------------------------- fixtures ------------------------------- */

const base = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Gulberg Grill',
  slug: 'gulberg-grill',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Lahore',
  locality: 'Gulberg',
  latitude: 31.5204,
  longitude: 74.3587,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }],
  ...patch,
});

const bizSearchResult: BusinessSearchResult = {
  type: 'business',
  id: 'biz-9',
  businessId: 'biz-9',
  businessName: 'Filtered Kebab House',
  businessSlug: 'filtered-kebab-house',
  name: 'Filtered Kebab House',
  description: 'Late-night kebabs',
  distanceKm: null,
  averageRating: 4.6,
  reviewCount: 12,
  score: 100,
  imageUrl: null,
  city: 'Lahore',
  locality: 'Gulberg',
  isVerified: true,
  isOpenNow: true,
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining' }],
  sampleServices: [],
};

const searchPage = (results: BusinessSearchResult[]): SearchPage => ({
  results,
  nextCursor: null,
  total: results.length,
  sort: 'relevance',
});

const granted: LocationOutcome = { status: 'granted', coords: { lat: 31.5204, lng: 74.3587 } };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset shared location state (individual tests opt into the granted state).
  sharedLoc.coords = null;
  sharedLoc.locating = false;
  sharedLoc.locNotice = null;
  sharedLoc.hasLocation = false;
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  ]);
  vi.mocked(api.listBusinesses).mockResolvedValue([base()]);
  vi.mocked(api.listNearbyBusinesses).mockResolvedValue([base({ name: 'Nearby Bistro', id: 'biz-2' })]);
  vi.mocked(api.searchMarketplace).mockResolvedValue(searchPage([bizSearchResult]));
  vi.mocked(requestCustomerLocation).mockResolvedValue(granted);
});

/* --------------------------- pure helpers --------------------------- */

describe('buildDiscoveryQuery', () => {
  it('omits every default (reset clears to an empty param map)', () => {
    expect(buildDiscoveryQuery(DEFAULT_EXPLORE_FILTERS)).toEqual({});
  });

  it('maps openNow to the server-honored openNow=true param', () => {
    expect(buildDiscoveryQuery({ ...DEFAULT_EXPLORE_FILTERS, openNow: true })).toEqual({ openNow: 'true' });
  });

  it('maps minRating as a plain number string', () => {
    expect(buildDiscoveryQuery({ ...DEFAULT_EXPLORE_FILTERS, minRating: 4.5 })).toEqual({ minRating: '4.5' });
  });

  it('maps a non-default sort key', () => {
    expect(buildDiscoveryQuery({ ...DEFAULT_EXPLORE_FILTERS, sort: 'rating' })).toEqual({ sort: 'rating' });
    expect(buildDiscoveryQuery({ ...DEFAULT_EXPLORE_FILTERS, sort: 'distance' })).toEqual({ sort: 'distance' });
  });

  it('combines all active filters', () => {
    expect(buildDiscoveryQuery({ openNow: true, minRating: 4, sort: 'rating' })).toEqual({
      openNow: 'true',
      minRating: '4',
      sort: 'rating',
    });
  });
});

describe('countActiveFilters', () => {
  it('is 0 for defaults and counts each active filter once', () => {
    expect(countActiveFilters(DEFAULT_EXPLORE_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_EXPLORE_FILTERS, openNow: true })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_EXPLORE_FILTERS, minRating: 3.5 })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_EXPLORE_FILTERS, sort: 'distance' })).toBe(1);
    expect(countActiveFilters({ openNow: true, minRating: 4, sort: 'rating' })).toBe(3);
  });
});

describe('applyNearbyFilters', () => {
  const rows = () => [
    base({ id: 'a', name: 'Open Star', isOpenNow: true, averageRating: 4.8, reviewCount: 10 }),
    base({ id: 'b', name: 'Closed Cafe', isOpenNow: false, averageRating: 4.9, reviewCount: 200 }),
    base({ id: 'c', name: 'Unrated Diner', isOpenNow: true, averageRating: null, reviewCount: 0 }),
  ];

  it('is a no-op for default filters', () => {
    const input = rows();
    expect(applyNearbyFilters(input, DEFAULT_EXPLORE_FILTERS)).toEqual(input);
  });

  it('keeps only open businesses when openNow is set', () => {
    const out = applyNearbyFilters(rows(), { ...DEFAULT_EXPLORE_FILTERS, openNow: true });
    expect(out.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('drops businesses below the rating threshold (unrated counts as below)', () => {
    const out = applyNearbyFilters(rows(), { ...DEFAULT_EXPLORE_FILTERS, minRating: 4.5 });
    expect(out.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('sorts by rating with review-count tiebreak, keeping distance order otherwise', () => {
    const out = applyNearbyFilters(rows(), { ...DEFAULT_EXPLORE_FILTERS, sort: 'rating' });
    expect(out.map((b) => b.id)).toEqual(['b', 'a', 'c']);
    const distanceOrder = applyNearbyFilters(rows(), { ...DEFAULT_EXPLORE_FILTERS, sort: 'distance' });
    expect(distanceOrder.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('businessSearchResultToBusiness', () => {
  it('maps every rendered field and leaves unknown coordinates null', () => {
    const b = businessSearchResultToBusiness(bizSearchResult);
    expect(b.id).toBe('biz-9');
    expect(b.name).toBe('Filtered Kebab House');
    expect(b.slug).toBe('filtered-kebab-house');
    expect(b.description).toBe('Late-night kebabs');
    expect(b.isOpenNow).toBe(true);
    expect(b.isVerified).toBe(true);
    expect(b.averageRating).toBe(4.6);
    expect(b.reviewCount).toBe(12);
    expect(b.city).toBe('Lahore');
    expect(b.categories).toEqual([{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true }]);
    // The search contract carries no coordinates: honest nulls, never invented.
    expect(b.latitude).toBeNull();
    expect(b.longitude).toBeNull();
  });
});

/* ------------------------- filter bar (unit) ------------------------- */

describe('ExploreFilterBar', () => {
  const renderBar = (filters: ExploreFilters = DEFAULT_EXPLORE_FILTERS, onChange = vi.fn()) => {
    render(<ExploreFilterBar filters={filters} onChange={onChange} canSortByDistance={false} />);
    return onChange;
  };

  it('shows no badge and no Clear all when nothing is active', () => {
    renderBar();
    expect(screen.queryByLabelText(/active filters/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
  });

  it('toggles Open now and marks the chip pressed', () => {
    const onChange = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Open now' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPLORE_FILTERS, openNow: true });
  });

  it('toggles the 4.0+ quick rating chip on and off', () => {
    const onChange = renderBar();
    fireEvent.click(screen.getByRole('button', { name: '4.0+' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPLORE_FILTERS, minRating: 4 });
    expect(screen.getByRole('button', { name: '4.0+' })).toHaveAttribute('aria-pressed', 'false');

    cleanup();
    const onChange2 = renderBar({ ...DEFAULT_EXPLORE_FILTERS, minRating: 4 });
    expect(screen.getByRole('button', { name: '4.0+' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '4.0+' }));
    expect(onChange2).toHaveBeenCalledWith(DEFAULT_EXPLORE_FILTERS);
  });

  it('reflects the current sort on the sort chip and shows a count badge', () => {
    renderBar({ openNow: true, minRating: 4, sort: 'rating' });
    expect(screen.getByRole('button', { name: /sort: highest rated/i })).toBeInTheDocument();
    expect(screen.getByLabelText('3 active filters')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('Clear all resets to defaults', () => {
    const onChange = renderBar({ openNow: true, minRating: null, sort: 'relevance' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_EXPLORE_FILTERS);
  });

  it('opens the filter sheet from the Filters button', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
  });
});

/* ------------------------- filter sheet (unit) ------------------------- */

describe('ExploreFilterSheet', () => {
  const renderSheet = (props: Partial<ComponentProps<typeof ExploreFilterSheet>> = {}) => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    render(
      <ExploreFilterSheet
        open
        onClose={onClose}
        onApply={onApply}
        initial={DEFAULT_EXPLORE_FILTERS}
        canSortByDistance={false}
        {...props}
      />,
    );
    return { onClose, onApply };
  };

  it('applies the draft on Apply', () => {
    const { onApply } = renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: /open now/i }));
    fireEvent.click(screen.getByRole('radio', { name: '4.0 & up' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Highest rated' }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({ openNow: true, minRating: 4, sort: 'rating' });
  });

  it('Reset clears the draft before applying', () => {
    const { onApply } = renderSheet({ initial: { openNow: true, minRating: 4, sort: 'rating' } });
    expect(screen.getByRole('checkbox', { name: /open now/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('checkbox', { name: /open now/i })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledWith(DEFAULT_EXPLORE_FILTERS);
  });

  it('Escape discards the draft without applying', () => {
    const { onClose, onApply } = renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: /open now/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('the close button discards the draft without applying', () => {
    const { onClose, onApply } = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Highest rated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Filters' }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables Nearest sort without coordinates, with an honest hint', () => {
    renderSheet({ canSortByDistance: false });
    const nearest = screen.getByRole('radio', { name: /nearest/i });
    expect(nearest).toBeDisabled();
    expect(screen.getByText(/turn on “near you” to sort by distance/i)).toBeInTheDocument();
  });

  it('enables Nearest sort when coordinates exist', () => {
    renderSheet({ canSortByDistance: true });
    expect(screen.getByRole('radio', { name: /nearest/i })).not.toBeDisabled();
  });

  it('re-seeds the draft from the applied filters every time it opens', () => {
    const { rerender } = render(
      <ExploreFilterSheet
        open={false}
        onClose={vi.fn()}
        onApply={vi.fn()}
        initial={DEFAULT_EXPLORE_FILTERS}
        canSortByDistance={false}
      />,
    );
    rerender(
      <ExploreFilterSheet
        open
        onClose={vi.fn()}
        onApply={vi.fn()}
        initial={{ openNow: true, minRating: null, sort: 'relevance' }}
        canSortByDistance={false}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /open now/i })).toBeChecked();
  });
});

/* ------------------- Explore integration (re-query) ------------------- */

describe('ExploreScreen filter integration (Phase 2B)', () => {
  it('does not touch /search until an advanced filter is active', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(api.listBusinesses).toHaveBeenCalledWith({ q: undefined, category: undefined });
    expect(api.searchMarketplace).not.toHaveBeenCalled();
  });

  it('re-queries /search with API-supported params when Open now is toggled', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: 'Open now' }));

    await waitFor(() =>
      expect(api.searchMarketplace).toHaveBeenCalledWith(
        expect.objectContaining({ openNow: true, type: 'business', limit: 50 }),
      ),
    );
    // The adapted business hit renders through the existing BusinessRow.
    await screen.findByText('Filtered Kebab House');
    expect(screen.getByRole('button', { name: 'Open now' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('maps the category slug to the categoryId the /search contract requires', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(await screen.findByRole('button', { name: 'Food & Dining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open now' }));

    await waitFor(() =>
      expect(api.searchMarketplace).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-1' })),
    );
  });

  it('applies sort + rating from the sheet through /search', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('radio', { name: '4.5 & up' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Highest rated' }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() =>
      expect(api.searchMarketplace).toHaveBeenCalledWith(
        expect.objectContaining({ minRating: 4.5, sort: 'rating', type: 'business' }),
      ),
    );
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('2 active filters')).toBeInTheDocument();
  });

  it('Clear all drops back to the plain list endpoint', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: 'Open now' }));
    await waitFor(() => expect(api.searchMarketplace).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(api.listBusinesses).toHaveBeenCalledTimes(2));
    await screen.findByText('Gulberg Grill');
  });

  it('discarding the sheet does not re-query', async () => {
    render(<ExploreScreen onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /open now/i }));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument());
    expect(api.searchMarketplace).not.toHaveBeenCalled();
    expect(api.listBusinesses).toHaveBeenCalledTimes(1);
  });

  it('nearby mode keeps the nearby endpoint and filters its server result set', async () => {
    vi.mocked(api.listNearbyBusinesses).mockResolvedValue([
      base({ id: 'open-1', name: 'Open Star', isOpenNow: true, averageRating: 4.8 }),
      base({ id: 'closed-1', name: 'Closed Cafe', isOpenNow: false, averageRating: 4.9 }),
    ]);
    // Simulate the already-granted shared location: the mount effect switches
    // the component into nearby mode, so no click-through is needed.
    sharedLoc.coords = { lat: 31.5204, lng: 74.3587 };
    sharedLoc.hasLocation = true;
    render(<ExploreScreen onOpenBusiness={() => {}} />);

    await screen.findByText('Closed Cafe');
    expect(api.listNearbyBusinesses).toHaveBeenCalledTimes(1);

    // The filter narrows the already-fetched server rows client-side: the
    // nearby query carries no filter params, and /search is never consulted
    // in nearby mode (the map needs the nearby endpoint's coordinates).
    fireEvent.click(screen.getByRole('button', { name: 'Open now' }));
    await waitFor(() => expect(screen.queryByText('Closed Cafe')).not.toBeInTheDocument());
    expect(screen.getByText('Open Star')).toBeInTheDocument();
    expect(api.listNearbyBusinesses).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 31.5204, lng: 74.3587, limit: 50 }),
    );
    for (const call of vi.mocked(api.listNearbyBusinesses).mock.calls) {
      expect(call[0]).not.toHaveProperty('openNow');
      expect(call[0]).not.toHaveProperty('minRating');
      expect(call[0]).not.toHaveProperty('sort');
    }
    expect(api.searchMarketplace).not.toHaveBeenCalled();
  });
});
