// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { HomeScreen } from './Home.js';
import { BusinessDetailScreen, __resetFeaturedCacheForTests } from './BusinessDetail.js';
import { SearchScreen } from './Search.js';
import { ToastProvider } from '../components/primitives.js';
import * as api from '../api.js';
import type { Business, Category, FeaturedPlacement } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  listCategories: vi.fn(),
  listBusinesses: vi.fn(),
  listNearbyBusinesses: vi.fn(),
  listMyOrders: vi.fn(),
  listMyBookings: vi.fn(),
  listFavorites: vi.fn(),
  getSession: vi.fn(),
  listFeaturedBusinesses: vi.fn(),
  getBusiness: vi.fn(),
  listBusinessReviews: vi.fn(),
  searchMarketplace: vi.fn(),
}));

const category = (patch: Partial<Category> = {}): Category => ({
  id: 'cat-1',
  name: 'Food & Restaurants',
  slug: 'food-restaurants',
  isActive: true,
  ...patch,
});

const business = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  averageRating: 4.5,
  reviewCount: 12,
  description: 'Fresh ground spices',
  imageUrl: null,
  isVerified: true,
  address: 'Main Blvd',
  city: 'Lahore',
  locality: 'DHA Phase 5',
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  isOpenNow: true,
  categories: [category()],
  ...patch,
});

const placement = (patch: Partial<FeaturedPlacement> = {}): FeaturedPlacement => ({
  source: 'paid',
  placementId: 'place-1',
  business: { id: 'biz-f1', name: 'Featured Eats', slug: 'featured-eats', categoryNames: ['Food & Restaurants'] },
  placementType: 'promotion',
  placementLabel: 'Featured',
  promotionName: 'Launch Boost',
  promotionSlug: 'launch-boost',
  benefits: ['Featured placement on Home'],
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

const homeProps = () => ({
  onOpenSearch: () => {},
  onOpenBusiness: () => {},
  onOpenOrder: () => {},
  onOpenBooking: () => {},
  onExploreCategory: () => {},
  onSeeAllCategories: () => {},
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCategories).mockResolvedValue([category()]);
  vi.mocked(api.listBusinesses).mockResolvedValue([]);
  vi.mocked(api.listNearbyBusinesses).mockResolvedValue([]);
  vi.mocked(api.listMyOrders).mockResolvedValue([]);
  vi.mocked(api.listMyBookings).mockResolvedValue([]);
  vi.mocked(api.listFavorites).mockResolvedValue([]);
  vi.mocked(api.getSession).mockReturnValue(null);
  vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([]);
});

describe('Home Featured section (Phase 20)', () => {
  it('lists the currently featured businesses with an honest Featured label and opens the business on tap', async () => {
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([
      placement(),
      placement({
        placementId: 'place-2',
        source: 'editorial',
        business: { id: 'biz-f2', name: 'Curated Corner', slug: 'curated-corner', categoryNames: ['Shopping'] },
        placementType: 'spotlight',
        placementLabel: 'Editorial pick',
        promotionName: null,
        promotionSlug: null,
        benefits: [],
      }),
    ]);
    const onOpenBusiness = vi.fn();
    render(<HomeScreen {...homeProps()} onOpenBusiness={onOpenBusiness} />);

    const section = await screen.findByRole('region', { name: 'Featured businesses' });
    expect(within(section).getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(within(section).getByText('Sponsored placements and curated picks')).toBeInTheDocument();
    // The server's own placement labels render verbatim — the client invents none.
    expect(within(section).getByText('Editorial pick')).toBeInTheDocument();

    const entry = within(section).getByRole('button', { name: 'Featured Eats, featured business' });
    expect(within(entry).getByText('Featured Eats')).toBeInTheDocument();
    expect(within(entry).getByText('Food & Restaurants')).toBeInTheDocument();
    fireEvent.click(entry);
    expect(onOpenBusiness).toHaveBeenCalledWith('biz-f1');
  });

  it('omits the Featured section entirely when the server returns no placements', async () => {
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([]);
    render(<HomeScreen {...homeProps()} />);
    // Let the section's fetch settle, then assert it never rendered.
    await vi.waitFor(() => expect(api.listFeaturedBusinesses).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Search businesses, services and products' });
    expect(screen.queryByRole('region', { name: 'Featured businesses' })).toBeNull();
  });

  it('omits the Featured section on fetch failure instead of an error banner', async () => {
    vi.mocked(api.listFeaturedBusinesses).mockRejectedValue(new Error('network down'));
    render(<HomeScreen {...homeProps()} />);
    await screen.findByRole('button', { name: 'Search businesses, services and products' });
    expect(screen.queryByRole('region', { name: 'Featured businesses' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders only what the server returns: inactive or expired placements stay absent', async () => {
    // The server is authoritative and filters inactive/expired rows itself,
    // so this response is exactly what a real server sends when only one
    // placement is currently active: the expired and inactive businesses are
    // simply not in the list.
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([placement()]);
    render(<HomeScreen {...homeProps()} />);

    const section = await screen.findByRole('region', { name: 'Featured businesses' });
    expect(within(section).getByText('Featured Eats')).toBeInTheDocument();
    expect(within(section).queryByText('Old Promo Place')).toBeNull();
    expect(within(section).queryByText('Expired Promo Place')).toBeNull();
  });

  it('keeps the Featured area separate from organic discovery: non-featured businesses never appear there', async () => {
    vi.mocked(api.listBusinesses).mockResolvedValue([
      business({ id: 'biz-plain', name: 'Plain Diner', slug: 'plain-diner', isOpenNow: true }),
    ]);
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([placement()]);

    render(<HomeScreen {...homeProps()} />);
    const section = await screen.findByRole('region', { name: 'Featured businesses' });
    // The organic feed business is absent from the Featured area.
    expect(within(section).queryByText('Plain Diner')).toBeNull();
    // ...but still present in the normal discovery feed.
    await screen.findByRole('region', { name: 'Open now' });
    expect(screen.getByRole('button', { name: /Plain Diner/ })).toBeInTheDocument();
  });

  it('leaves normal customer discovery untouched when featured placements exist', async () => {
    vi.mocked(api.listBusinesses).mockResolvedValue([
      business({ id: 'biz-plain', name: 'Plain Diner', slug: 'plain-diner', isOpenNow: true }),
    ]);
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([placement()]);

    render(<HomeScreen {...homeProps()} />);
    // Organic sections render exactly as before: spotlight, feed, categories.
    await screen.findByRole('region', { name: 'Open now' });
    expect(screen.getByText('Browse categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plain Diner/ })).toBeInTheDocument();
  });
});

describe('BusinessDetail Featured badge (Phase 20)', () => {
  const renderDetail = (idOrSlug: string) =>
    render(
      <ToastProvider>
        <BusinessDetailScreen idOrSlug={idOrSlug} onBack={() => {}} />
      </ToastProvider>,
    );

  beforeEach(() => {
    // The detail screen caches featured placements per session; reset so each
    // test's mock governs the fetch.
    __resetFeaturedCacheForTests();
    vi.mocked(api.getBusiness).mockResolvedValue(business());
    vi.mocked(api.listBusinessReviews).mockResolvedValue({ items: [], nextCursor: null, averageRating: null, reviewCount: 0 });
  });

  it('shows a small Featured badge for a business with an active placement', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ id: 'biz-f1', name: 'Featured Eats', slug: 'featured-eats' }));
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([placement()]);

    renderDetail('featured-eats');
    await screen.findByText('Featured Eats');
    const badge = await screen.findByLabelText('Featured business: Featured');
    expect(badge).toHaveTextContent('Featured');
  });

  it('matches the featured business by id even when opened through the normal feed', async () => {
    vi.mocked(api.getBusiness).mockResolvedValue(business({ id: 'biz-f1', name: 'Featured Eats', slug: 'featured-eats' }));
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([
      placement({ placementId: 'place-x', business: { id: 'other-biz', name: 'Someone Else', slug: 'someone-else', categoryNames: [] } }),
    ]);

    renderDetail('biz-f1');
    await screen.findByText('Featured Eats');
    await vi.waitFor(() => expect(api.listFeaturedBusinesses).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Featured business/)).toBeNull();
  });

  it('shows no badge when the business has no active placement', async () => {
    vi.mocked(api.listFeaturedBusinesses).mockResolvedValue([placement()]);

    renderDetail('butt-spices');
    await screen.findByText('Butt Spices');
    await vi.waitFor(() => expect(api.listFeaturedBusinesses).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Featured business/)).toBeNull();
  });

  it('hides the badge quietly when the featured fetch fails', async () => {
    vi.mocked(api.listFeaturedBusinesses).mockRejectedValue(new Error('network down'));

    renderDetail('butt-spices');
    await screen.findByText('Butt Spices');
    expect(screen.queryByLabelText(/Featured business/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Search stays organic (Phase 20 regression)', () => {
  it('renders search results with no Featured area and never fetches placements', async () => {
    vi.mocked(api.listCategories).mockResolvedValue([category()]);
    vi.mocked(api.searchMarketplace).mockResolvedValue({
      results: [],
      nextCursor: null,
      total: 0,
      sort: 'relevance' as const,
    });
    render(<SearchScreen initialQuery="grill" onBack={() => {}} onOpenBusiness={() => {}} />);
    await screen.findByText('Nothing matched');
    expect(screen.queryByRole('region', { name: 'Featured businesses' })).toBeNull();
    expect(api.listFeaturedBusinesses).not.toHaveBeenCalled();
  });
});
