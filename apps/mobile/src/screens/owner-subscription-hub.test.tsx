import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import * as api from '../api.js';
import type { Subscription, SubscriptionPlan, SubscriptionRowPlan, BusinessSubscriptionState } from '../api.js';

afterEach(cleanup);

const plan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'nearbyorders-business',
  maxBusinesses: 3,
  name: 'NearbyOrders Business',
  description: 'The full toolkit.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Accept bookings and orders', 'Showcase your services & products'],
  displayOrder: 0,
  isHighlighted: true,
  isActive: true,
};

const rowPlan: SubscriptionRowPlan = {
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: 'The full toolkit.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  benefits: ['Accept bookings and orders', 'Showcase your services & products'],
  billingInterval: 'MONTHLY',
  displayOrder: 0,
  isHighlighted: true,
};

const trialRow: Subscription = {
  id: 'sub-1',
  status: 'TRIAL',
  trialStartAt: '2026-09-01T00:00:00.000Z',
  trialEndAt: '2026-10-01T00:00:00.000Z',
  currentPeriodStartAt: '2026-09-01T00:00:00.000Z',
  currentPeriodEndAt: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  planNameSnapshot: 'NearbyOrders Business',
  planPriceMinorSnapshot: 299900,
  plan: rowPlan,
};

const liveTrialState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: trialRow,
  status: 'TRIAL',
  trial: { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', daysRemaining: 30 },
  planNameSnapshot: 'NearbyOrders Business',
  planPriceMinorSnapshot: 299900,
  verificationStatus: null,
  trialStatus: 'ACTIVE',
  businessStatus: 'APPROVED',
};

const eligibleState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: 'ELIGIBLE',
  businessStatus: 'APPROVED',
};

const rowBy = (title: string) => screen.findByRole('button', { name: (n: string) => n.startsWith(title) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...liveTrialState });
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([plan]);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
});

describe('OwnerSubscription hub (summary)', () => {
  it('shows the current plan summary with status, trial info, and payment status', async () => {
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    const summary = await screen.findByLabelText('My subscription');
    const text = summary.textContent?.replace(/ /g, ' ') ?? '';
    expect(text).toContain('NearbyOrders Business');
    expect(text).toContain('Rs 2,999');
    expect(text).toContain('Free trial');
    expect(text).toContain('30 days remaining');
    expect(text).toContain('No payments submitted yet');
  });

  it('shows the five navigation rows, each opening its dedicated route', async () => {
    const onOpen = vi.fn();
    render(<OwnerSubscription businessId="biz-1" onOpen={onOpen} />);
    const routes: Record<string, string> = {
      'Plan details': '/owner/biz-1/subscription-plan',
      'Change plan': '/owner/biz-1/subscription-change-plan',
      'Payment methods': '/owner/biz-1/subscription-payment-methods',
      'Make a payment': '/owner/biz-1/subscription-make-payment',
      'Payment history': '/owner/biz-1/subscription-payment-history',
    };
    for (const [title, path] of Object.entries(routes)) {
      fireEvent.click(await rowBy(title));
      expect(onOpen).toHaveBeenCalledWith(path);
    }
  });

  it('renders no destination inline: no plan chooser, no payment form, no methods list, no history', async () => {
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    await rowBy('Plan details');
    // No inline plan catalog.
    expect(screen.queryByRole('radiogroup', { name: 'Subscription plans' })).toBeNull();
    // No inline payment form.
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
    // No inline pay-in channels or history records.
    expect(screen.queryByText('Account title')).toBeNull();
    expect(screen.queryByText('Transaction reference')).toBeNull();
  });

  it('explains the manual payment flow honestly in plain language', async () => {
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    expect(await screen.findByText('How manual payment works')).toBeTruthy();
    expect(screen.getByText(/activates only after approval/)).toBeTruthy();
    expect(screen.getByText(/There is no online checkout/)).toBeTruthy();
  });

  it('offers the server trial with the working plan slug and reloads after apply', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...eligibleState });
    const applySpy = vi.spyOn(api, 'applyTrial').mockResolvedValue({ ...trialRow });
    const reloadSpy = vi.spyOn(api, 'getBusinessSubscription');
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-Day Free Trial' }));
    await waitFor(() => expect(applySpy).toHaveBeenCalledWith('biz-1', 'nearbyorders-business'));
    expect(await screen.findByText(/Free trial started/)).toBeTruthy();
    await waitFor(() => expect(reloadSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('shows "No plan yet" (never a generic "Payment required") when there is no live subscription', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...eligibleState });
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    const summary = await screen.findByLabelText('My subscription');
    expect(summary.textContent).toContain('No plan yet');
    expect(summary.textContent).not.toContain('Payment required');
  });

  it('explains honestly when the trial was already used', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({
      ...eligibleState,
      trialStatus: 'EXPIRED',
      businessStatus: 'APPROVED',
    });
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    expect(await screen.findByText('Your free trial has already been used for this business.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
  });

  it('never advertises a free trial when the working plan has zero trial days', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...eligibleState });
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([{ ...plan, trialDays: 0 }]);
    render(<OwnerSubscription businessId="biz-1" onOpen={vi.fn()} />);
    await rowBy('Plan details');
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });
});
