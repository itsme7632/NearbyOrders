import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusinessSubscription: vi.fn(),
  // Phase 16: the overview hub reads the server snapshot instead of
  // deriving metrics client-side.
  getOwnerOverview: vi.fn().mockResolvedValue({
    business: { id: 'biz-1', name: 'Butt Spices', status: 'APPROVED', isVerified: false, currency: 'PKR', imageUrl: null },
    today: { orders: 0, bookings: 0, revenueMinor: 0 },
    needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 },
    upcomingBookings: [],
    recentOrders: [],
    recentBookings: [],
    profileMissing: [],
  }),
  getOwnerAnalytics: vi.fn().mockResolvedValue({
    period: 'today',
    window: { from: '2026-09-19', to: '2026-09-19' },
    orders: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
    bookings: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
    catalog: { activeServices: 0, activeProducts: 0 },
  }),
}));

const business = (patch: Partial<Business> = {}): Business => ({
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

describe('subscription badge', () => {
  it('shows real trial state with days remaining', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue({
      id: 'sub-1',
      status: 'TRIAL',
      trialStartAt: new Date().toISOString(),
      trialEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      currentPeriodStartAt: new Date().toISOString(),
      currentPeriodEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      cancelledAt: null,
      plan: {
        slug: 'p',
        name: 'NearbyOrders Business',
        description: null,
        monthlyPriceMinor: 299900,
        currency: 'PKR',
        trialDays: 30,
      },
    });
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Free Trial/)).toBeTruthy();
    expect(screen.getByText(/3 days remaining/)).toBeTruthy();
  });

  it('shows an active plan with its renewal date', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue({
      id: 'sub-2',
      status: 'ACTIVE',
      trialStartAt: null,
      trialEndAt: null,
      currentPeriodStartAt: new Date().toISOString(),
      currentPeriodEndAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
      cancelledAt: null,
      plan: { slug: 'p', name: 'NearbyOrders Business', description: null, monthlyPriceMinor: 299900, currency: 'PKR', trialDays: 30 },
    });
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Business Plan: Active/)).toBeTruthy();
    expect(screen.getByText(/Renews/)).toBeTruthy();
  });

  it('shows the expired state instead of a generic row', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue({
      id: 'sub-3',
      status: 'EXPIRED',
      trialStartAt: null,
      trialEndAt: null,
      currentPeriodStartAt: new Date().toISOString(),
      currentPeriodEndAt: new Date().toISOString(),
      cancelledAt: null,
      plan: { slug: 'p', name: 'NearbyOrders Business', description: null, monthlyPriceMinor: 299900, currency: 'PKR', trialDays: 30 },
    });
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Plan Expired/)).toBeTruthy();
  });
});

describe('business overview uses real data and business wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(null);
  });

  it('renders honest zero states rather than invented numbers', async () => {
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business()]);
    vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);
    vi.spyOn(api, 'listBusinessBookings').mockResolvedValue([]);
    vi.spyOn(api, 'listOwnerPayments').mockResolvedValue({ bookingPayments: [], orderPayments: [] });
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);
    expect(await screen.findByText('Butt Spices!')).toBeTruthy();
    // The redesigned Overview shows month-scoped tiles, not day cards.
    await screen.findByText('Total bookings');
    const region = screen.getByRole('region', { name: 'Key metrics' });
    // No fake metrics: with empty server data every count is a real zero.
    expect(within(region).getByText('0')).toBeTruthy();
    expect(region).toHaveTextContent('Rs 0');
  });
});
