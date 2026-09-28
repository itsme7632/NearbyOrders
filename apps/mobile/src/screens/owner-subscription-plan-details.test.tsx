import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OwnerSubscriptionPlanDetails } from './OwnerSubscriptionPlanScreen.js';
import * as api from '../api.js';
import type { Subscription, SubscriptionPlan, SubscriptionRowPlan, BusinessSubscriptionState } from '../api.js';

afterEach(cleanup);

const currentPlan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'nearbyorders-business',
  maxBusinesses: 3,
  name: 'NearbyOrders Business',
  description: 'The full toolkit.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Accept bookings and orders', 'Showcase your services & products', 'Customer reviews and ratings'],
  displayOrder: 0,
  isHighlighted: true,
  isActive: true,
};

const otherPlan: SubscriptionPlan = {
  ...currentPlan,
  id: 'plan-2',
  slug: 'starter',
  name: 'Starter',
  monthlyPriceMinor: 149900,
  trialDays: 14,
  isHighlighted: false,
};

const rowPlan: SubscriptionRowPlan = {
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: 'The full toolkit.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  benefits: ['Accept bookings and orders', 'Showcase your services & products', 'Customer reviews and ratings'],
  billingInterval: 'MONTHLY',
  displayOrder: 0,
  isHighlighted: true,
};

const activeRow: Subscription = {
  id: 'sub-1',
  status: 'ACTIVE',
  trialStartAt: null,
  trialEndAt: null,
  currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
  currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  planNameSnapshot: 'NearbyOrders Business',
  planPriceMinorSnapshot: 299900,
  plan: rowPlan,
};

const activeState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: activeRow,
  status: 'ACTIVE',
  trial: null,
  planNameSnapshot: 'NearbyOrders Business',
  planPriceMinorSnapshot: 299900,
  verificationStatus: null,
  trialStatus: 'CONVERTED',
  businessStatus: 'APPROVED',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...activeState });
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([otherPlan, currentPlan]);
});

describe('OwnerSubscriptionPlanDetails', () => {
  it('shows the current plan only: name, price, billing, trial, status, full benefits', async () => {
    render(<OwnerSubscriptionPlanDetails businessId="biz-1" />);
    expect(await screen.findByText('NearbyOrders Business')).toBeTruthy();
    expect(screen.getAllByText('Rs 2,999').length).toBeGreaterThan(0);
    expect(screen.getByText('Monthly')).toBeTruthy();
    expect(screen.getByText('30 days')).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    for (const benefit of rowPlan.benefits) {
      expect(screen.getByText(benefit)).toBeTruthy();
    }
  });

  it('never renders the rest of the catalog', async () => {
    render(<OwnerSubscriptionPlanDetails businessId="biz-1" />);
    await screen.findByText('NearbyOrders Business');
    expect(screen.queryByText('Starter')).toBeNull();
    expect(screen.queryByText('Rs 1,499')).toBeNull();
  });

  it('shows an honest empty state when no plan is available', async () => {
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([]);
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
      ...activeState,
      subscription: null,
      status: null,
    });
    render(<OwnerSubscriptionPlanDetails businessId="biz-1" />);
    expect(await screen.findByText('No plan to show')).toBeTruthy();
  });
});
