import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerSubscriptionChangePlan } from './OwnerSubscriptionChangePlanScreen.js';
import { getStoredPlanSlug } from './OwnerSubscriptionShared.js';
import * as api from '../api.js';
import type { SubscriptionPlan, BusinessSubscriptionState } from '../api.js';

afterEach(cleanup);

const starter: SubscriptionPlan = {
  id: 'plan-starter',
  slug: 'starter',
  maxBusinesses: 1,
  name: 'Starter',
  description: 'For new businesses.',
  monthlyPriceMinor: 149900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: ['Business listing', 'Order management'],
  displayOrder: 0,
  isHighlighted: false,
  isActive: true,
};

const business: SubscriptionPlan = {
  id: 'plan-business',
  slug: 'nearbyorders-business',
  maxBusinesses: 3,
  name: 'Business',
  description: 'The full toolkit.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Everything in Starter', 'Homepage promotion slot'],
  displayOrder: 1,
  isHighlighted: true,
  isActive: true,
};

const premium: SubscriptionPlan = {
  id: 'plan-premium',
  slug: 'premium',
  maxBusinesses: 10,
  name: 'Premium',
  description: 'Maximum visibility.',
  monthlyPriceMinor: 499900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Everything in Business', 'Priority support'],
  displayOrder: 2,
  isHighlighted: false,
  isActive: true,
};

/** The business already subscribes to the highlighted plan. */
const subscribedState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: {
    id: 'sub-1',
    status: 'ACTIVE',
    trialStartAt: null,
    trialEndAt: null,
    currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
    currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
    cancelledAt: null,
    planNameSnapshot: 'Business',
    planPriceMinorSnapshot: 299900,
    plan: {
      slug: 'nearbyorders-business',
      name: 'Business',
      description: 'The full toolkit.',
      monthlyPriceMinor: 299900,
      currency: 'PKR',
      trialDays: 30,
      benefits: ['Everything in Starter', 'Homepage promotion slot'],
      billingInterval: 'MONTHLY',
      displayOrder: 1,
      isHighlighted: true,
    },
  },
  status: 'ACTIVE',
  trial: null,
  planNameSnapshot: 'Business',
  planPriceMinorSnapshot: 299900,
  verificationStatus: null,
  trialStatus: 'CONVERTED',
  businessStatus: 'APPROVED',
};

const radioBy = (nameStart: string) => screen.findByRole('radio', { name: (n: string) => n.startsWith(nameStart) });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([starter, business, premium]);
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...subscribedState });
});

describe('OwnerSubscriptionChangePlan', () => {
  it('renders every live plan from the API with price, trial, and benefits', async () => {
    render(<OwnerSubscriptionChangePlan businessId="biz-1" onBack={vi.fn()} />);
    const group = await screen.findByRole('radiogroup', { name: 'Subscription plans' });
    const text = group.textContent?.replace(/ /g, ' ') ?? '';
    expect(text).toContain('Starter');
    expect(text).toContain('Business');
    expect(text).toContain('Premium');
    expect(text).toContain('Rs 2,999');
    expect(text).toContain('30-day free trial included');
    expect(text).toContain('Homepage promotion slot');
  });

  it('shows the Recommended badge only from the server isHighlighted flag', async () => {
    render(<OwnerSubscriptionChangePlan businessId="biz-1" onBack={vi.fn()} />);
    const businessRadio = await radioBy('Business');
    expect(businessRadio.textContent).toContain('Recommended');
    expect((await radioBy('Starter')).textContent).not.toContain('Recommended');
    expect((await radioBy('Premium')).textContent).not.toContain('Recommended');
  });

  it('marks the subscription plan as the current plan', async () => {
    render(<OwnerSubscriptionChangePlan businessId="biz-1" onBack={vi.fn()} />);
    const businessRadio = await radioBy('Business');
    expect(businessRadio.textContent).toContain('Current plan');
    expect((await radioBy('Starter')).textContent).not.toContain('Current plan');
  });

  it('selecting a plan persists the choice and returns to the hub', async () => {
    const onBack = vi.fn();
    render(<OwnerSubscriptionChangePlan businessId="biz-1" onBack={onBack} />);
    fireEvent.click(await radioBy('Starter'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Starter' }));
    expect(getStoredPlanSlug('biz-1')).toBe('starter');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows an honest empty state when no plans are live', async () => {
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([]);
    render(<OwnerSubscriptionChangePlan businessId="biz-1" onBack={vi.fn()} />);
    expect(await screen.findByText('No plans available right now')).toBeTruthy();
  });
});
