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
  getBusinessSubscription: vi.fn().mockResolvedValue(null),
}));

vi.mock('./subscription-badge.js', () => ({ SubscriptionBadge: () => null }));
vi.mock('./PlanCard.js', () => ({ PlanCard: () => null }));
vi.mock('../useCartCount.js', () => ({ useCartCount: () => 0 }));

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
  ...patch,
});

const overview = (patch: Partial<OwnerOverview> = {}): OwnerOverview => ({
  business: { id: 'biz-1', name: 'Butt Spices', status: 'APPROVED', isVerified: false, currency: 'PKR', imageUrl: null },
  today: { orders: 2, bookings: 1, revenueMinor: 45500 },
  needsAttention: { pendingOrders: 1, pendingBookings: 1, pendingPayments: 2 },
  upcomingBookings: [
    { id: 'bk-9', serviceName: 'Catering', customerName: 'Ayesha K.', date: '2026-09-21', startTime: '18:00', status: 'CONFIRMED' },
  ],
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

describe('business overview (Phase 16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getOwnerAnalytics).mockImplementation(async (_id: string, period: 'today' | 'week' | 'month') => analytics(period));
  });

  it('renders server metrics verbatim — never derived client-side', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());

    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    await screen.findByText("Today's orders");
    await waitFor(() => expect(screen.getByText("Today's bookings")).toBeTruthy());
    // Pending nudges come from the server snapshot (orders AND bookings).
    expect(screen.getAllByText('1 pending').length).toBe(2);
    expect(screen.getByText(/awaiting verification/)).toBeTruthy();
    // Completed revenue is the server's PKT-day figure, not a client sum.
    expect(screen.getByText(/455/)).toBeTruthy();
    // The overview fetch is exactly the server call for this business.
    expect(api.getOwnerOverview).toHaveBeenCalledWith('biz-1');
  });

  it('exposes upcoming bookings with real service, time, and customer', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());

    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    expect(await screen.findByText('Catering')).toBeTruthy();
    expect(screen.getByText(/2026-09-21 · 18:00 · Ayesha K\./)).toBeTruthy();
  });

  it('lists honest profile gaps linked to the right management screens', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());

    const onOpen = vi.fn();
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={onOpen} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    fireEvent.click(await screen.findByText('Add a contact phone number'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/profile'));
  });

  it('shows no gaps section when the profile is complete', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview({ profileMissing: [] }));

    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    await screen.findByText("Today's orders");
    await waitFor(() => expect(screen.queryByText('Complete your profile')).toBeNull());
  });

  it('switches performance periods and refetches analytics', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());

    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'This week' }));
    await waitFor(() => expect(api.getOwnerAnalytics).toHaveBeenCalledWith('biz-1', 'week'));
    // Completed revenue row = orders + bookings revenue from the server.
    await waitFor(() => expect(screen.getAllByText(/1,500/).length).toBeGreaterThanOrEqual(1));
  });

  it('Today view leads with needs-attention and each item opens its queue', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview());

    const onOpen = vi.fn();
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={onOpen} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    // Wait for the server overview before asserting on the queue.
    await screen.findByText("Today's orders");
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /1 order waiting for your accept or reject/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/orders');
    fireEvent.click(screen.getByRole('button', { name: /1 booking waiting for your confirm or decline/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/bookings');
    fireEvent.click(screen.getByRole('button', { name: /2 payment proofs awaiting verification/i }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/payments');
  });

  it('shows a calm all-caught-up state when nothing needs attention', async () => {
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(
      overview({ needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 } }),
    );

    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);

    expect(await screen.findByText(/all caught up/i)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeTruthy();
  });

  it('renders the newest orders as an actionable queue opening order detail', async () => {
    const order = {
      id: 'ord-1',
      status: 'PENDING',
      subtotalMinor: 120000,
      totalMinor: 125000,
      currency: 'PKR',
      fulfillmentType: 'DELIVERY',
      createdAt: new Date().toISOString(),
      notes: null,
      business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices' },
      customer: { firstName: 'Ayesha', lastName: 'Khan' },
      items: [],
    };
    vi.mocked(api.getMyBusinesses).mockResolvedValue([biz()]);
    vi.mocked(api.getOwnerOverview).mockResolvedValue(overview({ recentOrders: [order] as never }));

    const onOpenOrder = vi.fn();
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={onOpenOrder} onOpenBooking={() => {}} />);

    const row = await screen.findByRole('button', { name: /order · pending/i });
    expect(row).toHaveTextContent('Ayesha Khan');
    fireEvent.click(row);
    expect(onOpenOrder).toHaveBeenCalledWith('ord-1');
  });
});
