import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import * as api from '../api.js';
import type { Business, SubscriptionPlan, Subscription, SubscriptionRowPlan, BusinessSubscriptionState } from '../api.js';

const testPlan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'p',
  maxBusinesses: 1,
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: [],
  displayOrder: 0,
  isHighlighted: true,
  isActive: true,
};

/** Plan summary as embedded in a subscription row (server shape). */
const testRowPlan: SubscriptionRowPlan = {
  slug: 'p',
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  benefits: [],
  billingInterval: 'MONTHLY',
  displayOrder: 0,
  isHighlighted: true,
};

/** Wraps a subscription row in the server's subscription-state envelope. */
const stateOf = (row: Subscription | null, patch: Partial<BusinessSubscriptionState> = {}): BusinessSubscriptionState => ({
  businessId: 'biz-1',
  subscription: row,
  status: row?.status ?? null,
  trial: null,
  planNameSnapshot: row?.planNameSnapshot ?? null,
  planPriceMinorSnapshot: row?.planPriceMinorSnapshot ?? null,
  verificationStatus: null,
  trialStatus: null,
  businessStatus: 'APPROVED',
  ...patch,
});

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
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(
      stateOf({
        id: 'sub-1',
        status: 'TRIAL',
        trialStartAt: new Date().toISOString(),
        trialEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        currentPeriodStartAt: new Date().toISOString(),
        currentPeriodEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        cancelledAt: null,
        planNameSnapshot: 'NearbyOrders Business',
        planPriceMinorSnapshot: 299900,
        plan: testRowPlan,
      }),
    );
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Free Trial/)).toBeTruthy();
    expect(screen.getByText(/3 days remaining/)).toBeTruthy();
  });

  it('shows an active plan with its renewal date', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(
      stateOf({
        id: 'sub-2',
        status: 'ACTIVE',
        trialStartAt: null,
        trialEndAt: null,
        currentPeriodStartAt: new Date().toISOString(),
        currentPeriodEndAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
        cancelledAt: null,
        planNameSnapshot: 'NearbyOrders Business',
        planPriceMinorSnapshot: 299900,
        plan: testRowPlan,
      }),
    );
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Business Plan: Active/)).toBeTruthy();
    expect(screen.getByText(/Plan active until/)).toBeTruthy();
  });

  it('shows the expired state instead of a generic row', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(
      stateOf({
        id: 'sub-3',
        status: 'EXPIRED',
        trialStartAt: null,
        trialEndAt: null,
        currentPeriodStartAt: new Date().toISOString(),
        currentPeriodEndAt: new Date().toISOString(),
        cancelledAt: null,
        planNameSnapshot: 'NearbyOrders Business',
        planPriceMinorSnapshot: 299900,
        plan: testRowPlan,
      }),
    );
    const { SubscriptionBadge } = await import('./subscription-badge.js');
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/Plan Expired/)).toBeTruthy();
  });
});

describe('business overview uses real data and business wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(stateOf(null));
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
    const region = screen.getByRole('region', { name: 'Performance' });
    // No fake metrics: with empty server data every count is a real zero.
    expect(within(region).getByText('0')).toBeTruthy();
    expect(region).toHaveTextContent('Rs 0');
  });
});

describe('OwnerPlanCard', () => {
  it('renders the server plan with price, trial status and both actions', async () => {
    vi.mocked(api.getBusinessSubscription).mockResolvedValue(
      stateOf({
        id: 'sub-1',
        status: 'TRIAL',
        trialStartAt: new Date().toISOString(),
        trialEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        currentPeriodStartAt: new Date().toISOString(),
        currentPeriodEndAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        cancelledAt: null,
        planNameSnapshot: 'NearbyOrders Business',
        planPriceMinorSnapshot: 299900,
        plan: testRowPlan,
      }),
    );
    const { OwnerPlanCard } = await import('./subscription-badge.js');
    const onManagePlan = vi.fn();
    const onViewPayments = vi.fn();
    render(<OwnerPlanCard businessId="biz-1" onManagePlan={onManagePlan} onViewPayments={onViewPayments} />);
    // All plan facts come from the server snapshot, never hard-coded.
    expect(await screen.findByText('NearbyOrders Business')).toBeTruthy();
    expect(screen.getByText('Rs 2,999')).toBeTruthy();
    expect(screen.getByText(/3 days remaining/)).toBeTruthy();
    expect(screen.getByText('No payments yet')).toBeTruthy();
    // Both entry points route to the subscription screen via the host.
    fireEvent.click(screen.getByRole('button', { name: 'Manage plan' }));
    expect(onManagePlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'View payment history' }));
    expect(onViewPayments).toHaveBeenCalledTimes(1);
  });
});
