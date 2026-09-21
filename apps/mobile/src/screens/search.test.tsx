// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import { SearchScreen } from './Search.js';
import type { SearchPage, SearchResult } from '../api.js';
import { requestCustomerLocation } from '../location.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  searchMarketplace: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('../location.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../location.js')>()),
  requestCustomerLocation: vi.fn(),
}));

const bizResult: SearchResult = {
  type: 'business',
  id: 'biz-1',
  businessId: 'biz-1',
  businessName: 'Gulberg Grill',
  businessSlug: 'gulberg-grill',
  name: 'Gulberg Grill',
  description: 'Grill house',
  distanceKm: null,
  averageRating: 4.5,
  reviewCount: 2,
  score: 400,
  imageUrl: null,
  city: 'Lahore',
  locality: 'Gulberg',
  isVerified: true,
  isOpenNow: true,
  categories: [{ id: 'cat-1', name: 'Food & Dining', slug: 'food-dining' }],
  sampleServices: [{ id: 'svc-1', name: 'Catapult catering', priceMinor: 500000, currency: 'PKR', durationMinutes: 60 }],
};

const svcResult: SearchResult = {
  type: 'service',
  id: 'svc-9',
  businessId: 'biz-1',
  businessName: 'Gulberg Grill',
  businessSlug: 'gulberg-grill',
  name: 'Oil change',
  description: null,
  distanceKm: 3.21,
  averageRating: null,
  reviewCount: 0,
  score: 200,
  priceMinor: 250000,
  currency: 'PKR',
  durationMinutes: 45,
};

const prodResult: SearchResult = {
  type: 'product',
  id: 'prod-7',
  businessId: 'biz-1',
  businessName: 'Gulberg Grill',
  businessSlug: 'gulberg-grill',
  name: 'Pizza',
  description: null,
  distanceKm: null,
  averageRating: null,
  reviewCount: 0,
  score: 300,
  priceMinor: 120000,
  currency: 'PKR',
  imageUrl: null,
};

const page = (results: SearchResult[], extra: Partial<SearchPage> = {}): SearchPage => ({
  results,
  nextCursor: null,
  total: results.length,
  sort: 'relevance',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 'cat-1', name: 'Food & Dining', slug: 'food-dining', isActive: true },
  ]);
  vi.mocked(api.searchMarketplace).mockResolvedValue(page([bizResult]));
  vi.mocked(requestCustomerLocation).mockResolvedValue({ status: 'granted', coords: { lat: 31.5, lng: 74.3 } });
});

describe('SearchScreen (Phase 14 unified search)', () => {
  it('submits a query and renders business, service, and product hits', async () => {
    vi.mocked(api.searchMarketplace).mockResolvedValue(page([bizResult, svcResult, prodResult], { total: 3 }));
    render(<SearchScreen onBack={() => {}} onOpenBusiness={() => {}} />);

    const input = screen.getByLabelText(/search businesses, services, and products/i);
    fireEvent.change(input, { target: { value: 'grill' } });
    fireEvent.submit(input.closest('form')!);

    await screen.findByText('Gulberg Grill');
    await screen.findByText('Oil change');
    await screen.findByText('Pizza');
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
  });

  it('sends server-authoritative parameters (type filter, coordinates) to the API', async () => {
    render(<SearchScreen initialQuery="pizza" onBack={() => {}} onOpenBusiness={() => {}} />);

    // Wait for the debounced initial search.
    await screen.findByText('Gulberg Grill');
    expect(api.searchMarketplace).toHaveBeenCalledWith(expect.objectContaining({ q: 'pizza' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Services' }));
    await waitFor(() =>
      expect(api.searchMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'pizza', type: 'service' })),
    );

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await waitFor(() =>
      expect(api.searchMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 31.5, lng: 74.3 })),
    );
  });

  it('shows the honest result count and the effective sort from the server', async () => {
    vi.mocked(api.searchMarketplace).mockResolvedValue(page([bizResult], { total: 42, sort: 'relevance' }));
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText(/42 results · Best match/i);
  });

  it('empty results show an honest empty state with retry hints', async () => {
    vi.mocked(api.searchMarketplace).mockResolvedValue(page([]));
    render(<SearchScreen initialQuery="zzz-nothing" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Nothing matched');
  });

  it('denied location keeps search usable and never sends coordinates', async () => {
    vi.mocked(requestCustomerLocation).mockResolvedValue({ status: 'denied' });
    render(<SearchScreen initialQuery="pizza" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText(/location permission was denied/i);
    const calls = vi.mocked(api.searchMarketplace).mock.calls;
    expect(calls.every((c) => c[0].lat === undefined && c[0].lng === undefined)).toBe(true);
  });

  it('opening a result navigates to that result business', async () => {
    const onOpenBusiness = vi.fn();
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={onOpenBusiness} />);
    await screen.findByText('Gulberg Grill');
    fireEvent.click(screen.getByText('Gulberg Grill'));
    expect(onOpenBusiness).toHaveBeenCalledWith('biz-1');
  });

  it('load more fetches the next cursor page and appends results', async () => {
    vi.mocked(api.searchMarketplace)
      .mockResolvedValueOnce(page([bizResult], { nextCursor: '1', total: 2 }))
      .mockResolvedValueOnce(page([prodResult], { nextCursor: null, total: 2 }));
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');

    fireEvent.click(screen.getByRole('button', { name: /load more results/i }));
    await screen.findByText('Pizza');
    expect(api.searchMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '1' }));
  });

  it('groups mixed results under Businesses, Services, and Products headings', async () => {
    vi.mocked(api.searchMarketplace).mockResolvedValue(page([prodResult, bizResult, svcResult], { total: 3 }));
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');
    expect(screen.getByRole('heading', { name: /businesses/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /services/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /products/i })).toBeInTheDocument();
    // The server order inside each group is preserved.
    const businesses = screen.getByRole('list', { name: /businesses results/i });
    expect(businesses).toHaveTextContent('Gulberg Grill');
  });

  it('clear button resets the input and the committed query', async () => {
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Gulberg Grill');
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    await waitFor(() => expect(api.searchMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined })));
    expect(screen.getByLabelText(/search businesses, services, and products/i)).toHaveValue('');
  });

  it('recent searches appear before searching and clear on demand', async () => {
    window.localStorage.setItem('nearbyorders.recentSearches', JSON.stringify(['pizza', 'bike repair']));
    try {
      render(<SearchScreen onBack={() => {}} onOpenBusiness={() => {}} />);
      await screen.findByText('Recent');
      expect(screen.getByRole('button', { name: 'pizza' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'pizza' })).not.toBeInTheDocument());
      expect(window.localStorage.getItem('nearbyorders.recentSearches')).toBe('[]');
    } finally {
      window.localStorage.removeItem('nearbyorders.recentSearches');
    }
  });

  it('tapping a recent search re-runs it', async () => {
    window.localStorage.setItem('nearbyorders.recentSearches', JSON.stringify(['pizza']));
    try {
      render(<SearchScreen onBack={() => {}} onOpenBusiness={() => {}} />);
      await screen.findByText('Recent');
      fireEvent.click(screen.getByRole('button', { name: 'pizza' }));
      await waitFor(() =>
        expect(api.searchMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'pizza' })),
      );
    } finally {
      window.localStorage.removeItem('nearbyorders.recentSearches');
    }
  });
});
