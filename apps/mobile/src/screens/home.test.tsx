// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HomeScreen } from './Home.js';
import * as api from '../api.js';
import * as location from '../location.js';
import * as sharedLocation from '../useSharedLocation.js';
import type { Booking, Business, Category, FavoriteEntry, Order } from '../api.js';

afterEach(cleanup);

// Mock the shared location hook: tests control coords directly.
const mockUseSharedLocation = (overrides: Partial<ReturnType<typeof sharedLocation.useSharedLocation>> = {}) => {
  vi.spyOn(sharedLocation, 'useSharedLocation').mockReturnValue({
    coords: null,
    locating: false,
    locNotice: null,
    hasLocation: false,
    requestLocation: vi.fn(),
    clearLocation: vi.fn(),
    ...overrides,
  });
};

beforeEach(() => {
  mockUseSharedLocation();
});

const manyCategories: Category[] = [
  'Automotive',
  'Beauty & Salon',
  'Education',
  'Events & Entertainment',
  'Fitness',
  'Food & Restaurants',
  'Health & Medical',
  'Home Services',
  'Professional Services',
  'Shopping',
].map((name, i) => ({ id: `cat-${i}`, name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), isActive: true }));

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
  latitude: 31.47,
  longitude: 74.4,
  phone: null,
  email: null,
  currency: 'PKR',
  isOpenNow: true,
  categories: [{ id: 'cat-5', name: 'Food & Restaurants', slug: 'food-restaurants', isActive: true }],
  ...patch,
});

const order = (patch: Partial<Order> = {}): Order => ({
  id: 'order-1',
  status: 'PREPARING',
  subtotalMinor: 215000,
  totalMinor: 215000,
  currency: 'PKR',
  fulfillmentType: 'PICKUP',
  notes: null,
  createdAt: '2026-09-20T12:00:00.000Z',
  business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices', imageUrl: null },
  customer: null,
  items: [{ id: 'i1', productId: 'p1', name: 'Chicken Biryani', unitPriceMinor: 45000, quantity: 2, lineTotalMinor: 90000 }],
  ...patch,
});

const booking = (patch: Partial<Booking> = {}): Booking => ({
  id: 'bk-1',
  businessId: 'biz-2',
  businessName: 'DHA Glow Salon',
  businessSlug: 'dha-glow-salon',
  serviceId: 'svc-1',
  serviceName: 'Hair Consultation',
  priceMinor: 250000,
  currency: 'PKR',
  // Relative to "now": the Home screen treats a booking as upcoming when
  // bookingDate >= today (UTC), so a hardcoded calendar date rots as soon
  // as it passes. Tomorrow keeps the fixture upcoming on every run.
  bookingDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  startTime: '09:00',
  endTime: '09:30',
  status: 'CONFIRMED',
  notes: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  ...patch,
});

const favorite = (patch: Partial<FavoriteEntry> = {}): FavoriteEntry => ({
  business: {
    id: 'biz-9',
    name: 'Lahore Bakers',
    slug: 'lahore-bakers',
    imageUrl: null,
    city: 'Lahore',
    address: 'Main Blvd',
    isVerified: true,
    averageRating: 4.2,
    reviewCount: 30,
  },
  savedAt: '2026-09-18T10:00:00.000Z',
  ...patch,
});

const session = { accessToken: 'tok', user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' } };

const defaultProps = () => ({
  onOpenSearch: () => {},
  onOpenBusiness: () => {},
  onOpenOrder: () => {},
  onOpenBooking: () => {},
  onExploreCategory: () => {},
  onSeeAllCategories: () => {},
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listCategories').mockResolvedValue(manyCategories);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'listNearbyBusinesses').mockResolvedValue([]);
  vi.spyOn(api, 'listMyOrders').mockResolvedValue([]);
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listFavorites').mockResolvedValue([]);
  vi.spyOn(api, 'getSession').mockReturnValue(null);
  // The first-use explainer gate is tested separately; these tests exercise
  // the location flow itself, so simulate the already-decided state.
  vi.spyOn(location, 'checkLocationPermissionState').mockResolvedValue('granted');
});

describe('Home category display', () => {
  it('shows at most 8 primary categories and never the full wall', async () => {
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Beauty & Salon' });
    const chips = screen.getAllByRole('button', { name: /Automotive|Beauty & Salon|Education|Events & Entertainment|Fitness|Food & Restaurants|Health & Medical|Home Services|Professional Services|Shopping/ });
    expect(chips.length).toBe(8);
    expect(screen.queryByRole('button', { name: 'Shopping' })).toBeNull();
  });

  it('shows See all only when more categories exist and wires it to Explore', async () => {
    const onSeeAll = vi.fn();
    render(<HomeScreen {...defaultProps()} onSeeAllCategories={onSeeAll} />);
    await screen.findByText('See all');
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('omits See all when there are exactly 8 categories', async () => {
    vi.spyOn(api, 'listCategories').mockResolvedValue(manyCategories.slice(0, 8));
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Beauty & Salon' });
    // No business sections render (empty feed), so no See all at all.
    await waitFor(() => expect(screen.queryByText('See all')).toBeNull());
  });

  it('navigates to Explore with the chosen category slug', async () => {
    const onExplore = vi.fn();
    render(<HomeScreen {...defaultProps()} onExploreCategory={onExplore} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Food & Restaurants' }));
    expect(onExplore).toHaveBeenCalledWith('food-restaurants');
  });
});

describe('Home search entry', () => {
  it('opens the real Search screen instead of searching inline', async () => {
    const onOpenSearch = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenSearch={onOpenSearch} />);
    const entry = await screen.findByRole('button', { name: 'Search businesses, services and products' });
    expect(entry).toHaveTextContent('Search businesses, products & services');
    fireEvent.click(entry);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('implements no inline search input', async () => {
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Search businesses, services and products' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});

describe('Home nearby mode', () => {
  it('switches to the nearby feed with real distances when location is granted', async () => {
    mockUseSharedLocation({
      coords: { lat: 31.47, lng: 74.4 },
      hasLocation: true,
    });
    vi.spyOn(api, 'listNearbyBusinesses').mockResolvedValue([
      business({ id: 'biz-n1', name: 'Near Bakery', distanceKm: 1.2 }),
      business({ id: 'biz-n2', name: 'Near Tailor', distanceKm: 2.8, isOpenNow: false }),
    ]);
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByText('Near you');
    expect(api.listNearbyBusinesses).toHaveBeenCalledWith({ lat: 31.47, lng: 74.4, radiusKm: 10, limit: 20 });
    // Server-computed distances surface on the rows.
    expect(await screen.findByText(/1\.2 km/)).toBeTruthy();
  });

  it('shows a retry affordance when location is denied, without breaking the feed', async () => {
    mockUseSharedLocation({
      locNotice: 'Location permission was denied.',
    });
    vi.spyOn(api, 'listBusinesses').mockResolvedValue([business()]);
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Location is off. Tap to try again.' });
    // The plain discovery feed still renders — nothing is faked.
    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    expect(api.listNearbyBusinesses).not.toHaveBeenCalled();
  });

  it('tapping "Near you" refreshes the fix and never clears the shared location', async () => {
    // Regression (2026-10-20): this button used to call clearLocation(),
    // wiping the shared coordinates for every screen whenever the status
    // label was tapped — the on-device "Near you" flip. It is a status +
    // refresh control now.
    const state = {
      coords: { lat: 31.47, lng: 74.4 } as { lat: number; lng: number } | null,
      locating: false,
      locNotice: null as string | null,
      hasLocation: true,
      requestLocation: vi.fn(),
      clearLocation: vi.fn(),
    };
    vi.spyOn(sharedLocation, 'useSharedLocation').mockImplementation(() => state);
    render(<HomeScreen {...defaultProps()} />);
    const toggle = await screen.findByRole('button', { name: 'Nearby mode on. Tap to refresh your location.' });
    fireEvent.click(toggle);
    expect(state.requestLocation).toHaveBeenCalled();
    expect(state.clearLocation).not.toHaveBeenCalled();
    // The nearby feed is still what renders — the location survived the tap.
    expect(api.listNearbyBusinesses).toHaveBeenCalled();
  });
});

describe('Home contextual section', () => {
  const signIn = (orders: Order[] = [], bookings: Booking[] = [], favorites: FavoriteEntry[] = []) => {
    vi.spyOn(api, 'getSession').mockReturnValue(session);
    vi.spyOn(api, 'whoami').mockResolvedValue({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER', firstName: 'Zach', lastName: null });
    vi.spyOn(api, 'listMyOrders').mockResolvedValue(orders);
    vi.spyOn(api, 'listMyBookings').mockResolvedValue(bookings);
    vi.spyOn(api, 'listFavorites').mockResolvedValue(favorites);
  };

  it('renders nothing contextual for signed-out customers', async () => {
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Search businesses, services and products' });
    expect(api.listMyOrders).not.toHaveBeenCalled();
    expect(screen.queryByText('Your order')).toBeNull();
    expect(screen.queryByText('Your saved places')).toBeNull();
  });

  it('surfaces the active order first and opens it on tap', async () => {
    signIn([order({ id: 'order-9', status: 'PREPARING' }), order({ id: 'order-old', status: 'COMPLETED', createdAt: '2026-09-10T12:00:00.000Z' })], [booking()], [favorite()]);
    const onOpenOrder = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenOrder={onOpenOrder} />);
    const card = await screen.findByRole('button', { name: /Your order/ });
    expect(card).toHaveTextContent('Butt Spices');
    expect(card).toHaveTextContent('Preparing');
    fireEvent.click(card);
    expect(onOpenOrder).toHaveBeenCalledWith('order-9');
  });

  it('falls back to the upcoming booking when no order is in flight', async () => {
    signIn([], [booking({ id: 'bk-7', status: 'CONFIRMED' })]);
    const onOpenBooking = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenBooking={onOpenBooking} />);
    const card = await screen.findByRole('button', { name: /Upcoming booking/ });
    expect(card).toHaveTextContent('DHA Glow Salon');
    fireEvent.click(card);
    expect(onOpenBooking).toHaveBeenCalledWith('bk-7');
  });

  it('offers a reorder from the most recent completed order', async () => {
    signIn([order({ id: 'order-c1', status: 'COMPLETED', createdAt: '2026-09-20T12:00:00.000Z' })]);
    const onOpenBusiness = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenBusiness={onOpenBusiness} />);
    const card = await screen.findByRole('button', { name: /Order again/ });
    expect(card).toHaveTextContent('Butt Spices');
    fireEvent.click(card);
    expect(onOpenBusiness).toHaveBeenCalledWith('biz-1');
  });

  it('shows saved places when there is no order or booking history', async () => {
    signIn([], [], [favorite()]);
    const onOpenBusiness = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenBusiness={onOpenBusiness} />);
    await screen.findByText('Your saved places');
    fireEvent.click(await screen.findByRole('button', { name: /Lahore Bakers/ }));
    expect(onOpenBusiness).toHaveBeenCalledWith('biz-9');
  });

  it('greets the signed-in customer by first name', async () => {
    signIn();
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByText(/Good (morning|afternoon|evening)|Up late, Zach/);
  });
});

describe('Home products & services discovery', () => {
  const productResult = (patch = {}) => ({
    type: 'product' as const,
    id: 'prod-1',
    businessId: 'biz-1',
    businessName: 'Butt Spices',
    businessSlug: 'butt-spices',
    name: 'Chicken Biryani',
    description: null,
    distanceKm: 1.2,
    averageRating: 4.5,
    reviewCount: 12,
    score: 1,
    priceMinor: 45000,
    currency: 'PKR',
    imageUrl: null,
    ...patch,
  });
  const serviceResult = (patch = {}) => ({
    type: 'service' as const,
    id: 'svc-1',
    businessId: 'biz-2',
    businessName: 'DHA Glow Salon',
    businessSlug: 'dha-glow-salon',
    name: 'Hair Consultation',
    description: null,
    distanceKm: null,
    averageRating: null,
    reviewCount: 0,
    score: 1,
    priceMinor: 250000,
    currency: 'PKR',
    durationMinutes: 30,
    ...patch,
  });

  it('renders orderable products and bookable services from real search results', async () => {
    vi.spyOn(api, 'searchMarketplace').mockImplementation(async (q: { type?: string }) => ({
      results: q.type === 'product' ? [productResult()] : [serviceResult()],
      nextCursor: null,
      total: 1,
      sort: 'relevance' as const,
    }));
    const onOpenBusiness = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenBusiness={onOpenBusiness} />);
    await screen.findByText('Products & services');
    expect(screen.getByText('Chicken Biryani')).toBeTruthy();
    expect(screen.getByText('Hair Consultation')).toBeTruthy();
    // Prices render through the real Money component (PKR).
    expect(screen.getAllByText(/Rs/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Chicken Biryani, product at Butt Spices/ }));
    expect(onOpenBusiness).toHaveBeenCalledWith('biz-1');
  });

  it('omits the section when search returns nothing', async () => {
    vi.spyOn(api, 'searchMarketplace').mockResolvedValue({ results: [], nextCursor: null, total: 0, sort: 'relevance' as const });
    render(<HomeScreen {...defaultProps()} />);
    await screen.findByRole('button', { name: 'Search businesses, services and products' });
    await waitFor(() => expect(screen.queryByText('Products & services')).toBeNull());
  });
});

describe('Home recent activity', () => {
  const signIn = (orders: Order[] = [], bookings: Booking[] = [], favorites: FavoriteEntry[] = []) => {
    vi.spyOn(api, 'getSession').mockReturnValue(session);
    vi.spyOn(api, 'whoami').mockResolvedValue({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER', firstName: 'Zach', lastName: null });
    vi.spyOn(api, 'listMyOrders').mockResolvedValue(orders);
    vi.spyOn(api, 'listMyBookings').mockResolvedValue(bookings);
    vi.spyOn(api, 'listFavorites').mockResolvedValue(favorites);
  };

  it('lists recent orders and bookings below the context card', async () => {
    signIn(
      [
        order({ id: 'order-9', status: 'PREPARING', createdAt: '2026-09-21T12:00:00.000Z' }),
        order({ id: 'order-old', status: 'COMPLETED', createdAt: '2026-09-10T12:00:00.000Z' }),
      ],
      [booking({ id: 'bk-2', status: 'COMPLETED' })],
    );
    const onOpenOrder = vi.fn();
    render(<HomeScreen {...defaultProps()} onOpenOrder={onOpenOrder} />);
    // In-flight order leads as the context card...
    await screen.findByRole('button', { name: /Your order/ });
    // ...and the section is labeled Recent activity.
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy();
    // Completed history follows as compact rows (the in-flight order is not repeated).
    const row = screen.getByRole('button', { name: /Order from Butt Spices, Completed/ });
    fireEvent.click(row);
    expect(onOpenOrder).toHaveBeenCalledWith('order-old');
  });
});
