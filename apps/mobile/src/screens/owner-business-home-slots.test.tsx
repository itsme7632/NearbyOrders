import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OwnerBusinessHome } from './OwnerBusinessHome.js';
import * as api from '../api.js';
import type { Business, OwnerOverview, OwnerAnalytics } from '../api.js';

afterEach(cleanup);

const business = (id: string, name: string): Business => ({
  id,
  name,
  slug: `${id}-slug`,
  status: 'APPROVED',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '1 Test Street',
  city: 'Lahore',
  locality: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [],
});

const overview: OwnerOverview = {
  business: { id: 'b1', name: 'Shop One', status: 'APPROVED', isVerified: true, currency: 'PKR', imageUrl: null },
  today: { orders: 0, bookings: 0, revenueMinor: 0 },
  needsAttention: { pendingOrders: 0, pendingBookings: 0, pendingPayments: 0 },
  upcomingBookings: [],
  recentOrders: [],
  recentBookings: [],
  profileMissing: [],
};

const analytics: OwnerAnalytics = {
  period: 'month',
  window: { from: '2026-08-28', to: '2026-09-28' },
  orders: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
  bookings: { total: 0, completed: 0, cancelled: 0, revenueMinor: 0 },
  catalog: { activeServices: 0, activeProducts: 0 },
};

const mockEntitlement = (entitlement: { usedBusinesses: number; maxBusinesses: number; remainingBusinesses: number }) => {
  const owned = [business('b1', 'Shop One')];
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue(owned);
  vi.spyOn(api, 'getMyBusinessesWithEntitlement').mockResolvedValue({ businesses: owned, entitlement });
  vi.spyOn(api, 'getOwnerOverview').mockResolvedValue(overview);
  vi.spyOn(api, 'getOwnerAnalytics').mockResolvedValue(analytics);
};

const baseProps = {
  onOpen: () => {},
  onOpenOrder: () => {},
  onOpenBooking: () => {},
};

describe('OwnerBusinessHome business-slot usage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('with capacity: shows usage and a List-another action, never Upgrade', async () => {
    mockEntitlement({ usedBusinesses: 1, maxBusinesses: 3, remainingBusinesses: 2 });
    const onListBusiness = vi.fn();
    render(<OwnerBusinessHome {...baseProps} onListBusiness={onListBusiness} />);

    expect(await screen.findByText(/1 of 3 businesses used/)).toBeTruthy();
    const listAnother = screen.getByRole('button', { name: 'List another business' });
    expect(listAnother).toBeTruthy();
    // Upgrade must never appear while a slot is available.
    expect(screen.queryByRole('button', { name: /upgrade/i })).toBeNull();

    fireEvent.click(listAnother);
    expect(onListBusiness).toHaveBeenCalledTimes(1);
  });

  it('at the limit: shows usage and Upgrade, never List-another', async () => {
    mockEntitlement({ usedBusinesses: 3, maxBusinesses: 3, remainingBusinesses: 0 });
    render(<OwnerBusinessHome {...baseProps} onListBusiness={() => {}} />);

    expect(await screen.findByText(/3 of 3 businesses used/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upgrade your plan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'List another business' })).toBeNull();
  });

  it('without the list-business entry point: stays quiet when there is nothing actionable', async () => {
    mockEntitlement({ usedBusinesses: 1, maxBusinesses: 3, remainingBusinesses: 2 });
    render(<OwnerBusinessHome {...baseProps} />);

    // Single business with spare capacity and no list entry point: the
    // usage line stays hidden rather than stating a fact with no action.
    await screen.findByText('Shop One!');
    expect(screen.queryByText(/businesses used/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'List another business' })).toBeNull();
    expect(screen.queryByRole('button', { name: /upgrade/i })).toBeNull();
  });
});
