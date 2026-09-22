// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { Business, OwnerAnalytics, OwnerOverview } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getMyBusinesses: vi.fn(),
  getOwnerOverview: vi.fn(),
  getOwnerAnalytics: vi.fn(),
}));

const biz = (patch: Partial<Business> = {}): Business => ({
  id: 'biz-1',
  name: 'Butt Spices',
  slug: 'butt-spices',
  status: 'APPROVED',
  description: null,
  imageUrl: null,
  isVerified: false,
  address: '12 Food Street',
  city: 'Karachi',
  locality: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
  averageRating: 4.5,
  reviewCount: 12,
  ...patch,
});

const overview = (patch: Partial<OwnerOverview> = {}): OwnerOverview => ({
  business: { id: 'biz-1', name: 'Butt Spices', status: 'APPROVED', isVerified: false, currency: 'PKR', imageUrl: null },
  today: { orders: 2, bookings: 1, revenueMinor: 45500 },
  needsAttention: { pendingOrders: 1, pendingBookings: 1, pendingPayments: 2 },
  upcomingBookings: [],
  recentOrders: [],
  recentBookings: [],
  profileMissing: ['phone', 'image'],
  ...patch,
});

const analytics = (period: string): OwnerAnalytics => ({
  period: period as OwnerAnalytics['period'],
  window: { from: '2026-09-19', to: '2026-09-19' },
  orders: { total: 4, completed: 3, cancelled: 1, revenueMinor: 120000 },
  bookings: { total: 2, completed: 1, cancelled: 0, revenueMinor: 30000 },
  catalog: { activeServices: 3, activeProducts: 5 },
});

const renderHome = async (props: Record<string, unknown> = {}) => {
  const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
  return render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} {...props} />);
};

describe('business overview (redesigned hub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getOwnerAnalytics).mockImplementation(async (_id: string, period: 'today' | 'week' | 'month') => analytics(period));
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());
  });

  it('greets the owner and names the operating business', async () => {
    await renderHome();
    expect(await screen.findByText(/Good (morning|afternoon|evening),/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Butt Spices!' })).toBeTruthy();
    expect(screen.getByText('Manage your business and grow with NearbyOrders.')).toBeTruthy();
  });

  it('shows the live approval status of the business', async () => {
    await renderHome();
    const region = await screen.findByRole('region', { name: 'Business status' });
    expect(region).toHaveTextContent('Business active');
    expect(region).toHaveTextContent('visible to customers');
  });

  it('shows a pending state for an unapproved business', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz({ status: 'PENDING' })]);
    await renderHome();
    const region = await screen.findByRole('region', { name: 'Business status' });
    expect(region).toHaveTextContent('Pending approval');
    expect(region).toHaveTextContent('once approved');
  });

  it('renders this-month metrics verbatim from the server — never invented', async () => {
    await renderHome();
    await screen.findByText('Total bookings'); // loaded tiles, not the skeleton
    const region = screen.getByRole('region', { name: 'Key metrics' });
    // Bookings tile: server month total.
    expect(region).toHaveTextContent('Total bookings');
    expect(region).toHaveTextContent('This month');
    // Rating tile: the business record's real rating and review count.
    expect(region).toHaveTextContent('4.5');
    expect(region).toHaveTextContent('(12 reviews)');
    // Revenue tile: orders + bookings revenue from the server, integer paisa.
    expect(region).toHaveTextContent('Revenue');
    expect(screen.getByText('Rs 1,500')).toBeTruthy(); // 120000 + 30000 minor
    // The overview asks for exactly the month window for this business.
    await waitFor(() => expect(api.getOwnerAnalytics).toHaveBeenCalledWith('biz-1', 'month'));
  });

  it('shows a dash when the business has no rating yet', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz({ averageRating: null, reviewCount: 0 })]);
    await renderHome();
    // Wait for the loaded tiles, not the loading skeleton's empty region.
    await screen.findByText('Avg. rating');
    const region = screen.getByRole('region', { name: 'Key metrics' });
    expect(region).toHaveTextContent('No reviews yet');
  });

  it('leads with needs-attention and each item opens its queue', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    await screen.findByRole('button', { name: /1 order waiting for your accept or reject/i });

    fireEvent.click(screen.getByRole('button', { name: /1 order waiting for your accept or reject/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/orders');
    fireEvent.click(screen.getByRole('button', { name: /1 booking waiting for your confirm or decline/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/bookings');
    fireEvent.click(screen.getByRole('button', { name: /2 payment proofs awaiting verification/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/payments');
  });

  it('shows a calm all-caught-up state when nothing needs attention', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({ needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 } }),
    );
    await renderHome();
    expect(await screen.findByText(/all caught up/i)).toBeTruthy();
  });

  it('lists honest profile gaps linked to the right management screens', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    fireEvent.click(await screen.findByText('Add a contact phone number'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile'));
    fireEvent.click(screen.getByText('Add a business image'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile'));
  });

  it('shows no gaps section when the profile is complete', async () => {
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview({ profileMissing: [] }));
    await renderHome();
    await screen.findByText('Total bookings'); // metrics loaded
    expect(screen.queryByText('Complete your profile')).toBeNull();
  });

  it('groups management into Business, Catalog, and Growth & account', async () => {
    const onOpen = vi.fn();
    await renderHome({ onOpen });
    expect(await screen.findByText('Manage your business')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Business' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Catalog' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Growth & account' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Business information/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile');
    fireEvent.click(screen.getByRole('button', { name: /Location/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/location');
    fireEvent.click(screen.getByRole('button', { name: /Business hours/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/hours');
    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/services');
    fireEvent.click(screen.getByRole('button', { name: /Products \/ Menu/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/products');
    fireEvent.click(screen.getByRole('button', { name: /^Subscription/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription');
    fireEvent.click(screen.getByRole('button', { name: /Reviews/ }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/reviews');
  });

  it('shows the business switcher only when the owner has several businesses', async () => {
    await renderHome();
    await screen.findByText('Total bookings'); // metrics loaded
    expect(screen.queryByRole('group', { name: 'Switch business' })).toBeNull();

    cleanup();
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz(), biz({ id: 'biz-2', name: 'Second Shop', slug: 'second-shop' })]);
    await renderHome();
    expect(await screen.findByRole('group', { name: 'Switch business' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Second Shop' })).toBeTruthy();
  });

  it('announces a just-created business with its real approval state', async () => {
    await renderHome({ justCreatedName: 'Butt Spices', justCreatedStatus: 'PENDING' });
    const banner = await screen.findByText(/has been created/);
    const card = banner.closest('.created-banner');
    expect(card).toBeTruthy();
    expect(card).toHaveTextContent('Butt Spices');
    expect(card).toHaveTextContent('once approved');
  });
});
