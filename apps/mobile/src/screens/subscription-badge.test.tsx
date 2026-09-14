import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import type { Business } from '../api.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getBusinessSubscription: vi.fn(),
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

  it('renders empty overview cards (zeros) rather than invented numbers', async () => {
    vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business()]);
    vi.spyOn(api, 'listBusinessOrders').mockResolvedValue([]);
    vi.spyOn(api, 'listBusinessBookings').mockResolvedValue([]);
    vi.spyOn(api, 'listOwnerPayments').mockResolvedValue({ bookingPayments: [], orderPayments: [] });
    const { OwnerBusinessHome } = await import('./OwnerBusinessHome.js');
    render(<OwnerBusinessHome onOpen={() => {}} onOpenOrder={() => {}} onOpenBooking={() => {}} />);
    expect(await screen.findByText('Butt Spices')).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Today's orders")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Today's bookings")).toBeTruthy());
    // No fake metrics: with empty server data every count is 0.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });
});
