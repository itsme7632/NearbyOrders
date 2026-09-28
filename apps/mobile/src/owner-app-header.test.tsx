// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { App } from './main.js';
import * as api from './api.js';
import { setAppMode } from './mode.js';

afterEach(cleanup);

const ownerSession: api.Session = {
  accessToken: 'tok',
  user: { id: 'u9', email: 'owner@example.com', role: 'BUSINESS_OWNER' },
};

const business = {
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
} as unknown as api.Business;

const overview = {
  business: { id: 'biz-1', name: 'Butt Spices', status: 'APPROVED', isVerified: false, currency: 'PKR', imageUrl: null },
  today: { orders: 0, bookings: 0, revenueMinor: 0 },
  needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 },
  upcomingBookings: [],
  recentOrders: [],
  recentBookings: [],
  profileMissing: [],
} as unknown as api.OwnerOverview;

const analytics = {
  period: 'month',
  window: { from: '2026-09-01', to: '2026-09-23' },
  orders: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
  bookings: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
  catalog: { activeServices: 0, activeProducts: 0 },
} as unknown as api.OwnerAnalytics;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSession').mockReturnValue(ownerSession);
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([business]);
  vi.spyOn(api, 'getOwnerOverview').mockResolvedValue(overview);
  vi.spyOn(api, 'getOwnerAnalytics').mockResolvedValue(analytics);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 3 });
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
    businessId: 'biz-1',
    subscription: null,
    status: 'NONE',
    trial: null,
    planNameSnapshot: null,
    planPriceMinorSnapshot: null,
    verificationStatus: null,
    trialStatus: null,
    businessStatus: 'APPROVED',
  } as unknown as api.BusinessSubscriptionState);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
  vi.spyOn(api, 'getVerification').mockResolvedValue({ application: null, documents: [] });
  // Owner with a business opens straight into Business mode.
  setAppMode('BUSINESS', ownerSession);
});

describe('business-mode app header (shell level)', () => {
  it('renders exactly one app header in business mode, no duplicate topbar or bell', async () => {
    const { container } = render(<App />);
    // Business Overview is up (business mode).
    await screen.findByRole('heading', { name: 'Butt Spices!' });

    const headers = container.querySelectorAll('header.app-header');
    expect(headers).toHaveLength(1);
    expect(headers[0].classList.contains('owner-app-header')).toBe(true);

    // Exactly one bell total, carrying the unread badge behavior.
    expect(container.querySelectorAll('.bell-btn')).toHaveLength(1);
    expect(container.querySelector('.bell-badge')?.textContent).toBe('3');

    // The old in-screen owner top bar is gone: no second header, no second bell.
    expect(container.querySelector('.owner-topbar')).toBeNull();

    // Owner badge shown; the customer-mode "My business" entry point is gone.
    expect(container.querySelector('.owner-mode-badge')?.textContent).toBe('Owner');
    expect(screen.queryByRole('button', { name: /My business/ })).toBeNull();
  });

  it('bell navigates to notifications from the owner header', async () => {
    render(<App />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    fireEvent.click(bell);
    expect(window.location.hash).toContain('/notifications');
  });

  it('avatar opens the business Profile tab', async () => {
    render(<App />);
    const avatar = await screen.findByRole('button', { name: 'Butt Spices business profile' });
    fireEvent.click(avatar);
    // The business Profile tab (owner identity hub) renders.
    await screen.findByRole('heading', { name: 'Business Profile' });
  });
});
