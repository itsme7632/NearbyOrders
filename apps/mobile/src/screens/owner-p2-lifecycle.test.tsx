// @vitest-environment jsdom
/**
 * P2 lifecycle honesty tests: approval + free-trial lifecycle.
 *
 * Covers §19 of the P2 brief - the owner-facing state matrix and copy rules:
 * verification vs listing approval, trial CTA gating, honest per-state
 * messaging, no "Renews", no "Payment required" collapse, no
 * "unlock visibility" claim. Tests state and behavior, never incidental CSS.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import { OwnerVerification } from './OwnerVerificationScreen.js';
import { OwnerPlanCard, SubscriptionBadge } from './subscription-badge.js';
import { OwnerAttentionItems } from './OwnerDashboard.js';
import * as api from '../api.js';
import type {
  BusinessSubscriptionState,
  Subscription,
  SubscriptionPlan,
  SubscriptionRowPlan,
  VerificationState,
} from '../api.js';

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
  benefits: ['Accept bookings and orders'],
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
  benefits: ['Accept bookings and orders'],
  billingInterval: 'MONTHLY',
  displayOrder: 0,
  isHighlighted: true,
};

const subRow = (patch: Partial<Subscription> = {}): Subscription => ({
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
  ...patch,
});

const subState = (patch: Partial<BusinessSubscriptionState> = {}): BusinessSubscriptionState => ({
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: null,
  businessStatus: 'APPROVED',
  ...patch,
});

const verificationState = (status: string | null): VerificationState =>
  ({
    application: status ? { id: 'ver-1', status, reviewerMessage: null } : null,
    documents: [],
  }) as unknown as VerificationState;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([plan]);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
  vi.spyOn(api, 'listCategories').mockResolvedValue([]);
  vi.spyOn(api, 'getVerification').mockResolvedValue(verificationState(null));
});

const mockSubscription = (s: BusinessSubscriptionState) =>
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue(s);

describe('OwnerSubscriptionScreen: trial CTA gating (§9)', () => {
  it('offers the trial only when APPROVED + ELIGIBLE + no live subscription', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'APPROVED' }));
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByRole('button', { name: /start 30-day free trial/i })).toBeTruthy();
  });

  it('does NOT offer the trial while the listing is pending (verified but not live)', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'PENDING' }));
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Waiting for listing approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
    // Never claims the business is live while it waits.
    expect(screen.queryByText(/your business is live/i)).toBeNull();
  });

  it('does not offer the trial when a live subscription exists', async () => {
    const row = subRow({ status: 'ACTIVE', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'ACTIVE', trialStatus: 'CONVERTED' }));
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Active');
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
  });

  it('surfaces the server BUSINESS_NOT_APPROVED reason when apply is rejected', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'APPROVED' }));
    vi.spyOn(api, 'applyTrial').mockRejectedValue(
      new Error('Your business must be approved before you can start the free trial.'),
    );
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /start 30-day free trial/i }));
    expect(await screen.findByText(/must be approved before you can start the free trial/i)).toBeTruthy();
  });
});

describe('OwnerSubscriptionScreen: honest copy (§10-§12, §15-§16)', () => {
  it('says the trial starts immediately - never "the team activates it"', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'APPROVED' }));
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByRole('button', { name: /start 30-day free trial/i });
    expect(screen.getByText(/your trial starts immediately when you apply/i)).toBeTruthy();
    expect(screen.queryByText(/the team activates it on our side/i)).toBeNull();
  });

  it('never renders "Renews" for manual billing', async () => {
    const row = subRow({ status: 'ACTIVE', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'ACTIVE', trialStatus: 'CONVERTED' }));
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Active');
    expect(container.textContent).not.toMatch(/renews/i);
    expect(screen.getByText(/plan active until/i)).toBeTruthy();
  });

  it('trial active: honest countdown, no renewal language', async () => {
    const row = subRow({ status: 'TRIAL' });
    mockSubscription(
      subState({
        subscription: row,
        status: 'TRIAL',
        trial: { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', daysRemaining: 12 },
        trialStatus: 'ACTIVE',
      }),
    );
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    // P4: the hub summary and the trial detail panel both badge the trial.
    await screen.findAllByText('Free trial');
    // P4: the hub summary and the trial detail panel both show the countdown.
    expect(screen.getAllByText(/12 days remaining/i).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toMatch(/renews/i);
  });

  it('trial ending: "ends in 3 days" / "ends tomorrow", never "renews tomorrow"', async () => {
    const row = subRow({ status: 'TRIAL' });
    mockSubscription(
      subState({
        subscription: row,
        status: 'TRIAL',
        trial: { startsAt: '2026-09-20T00:00:00.000Z', endsAt: '2026-09-23T00:00:00.000Z', daysRemaining: 3 },
        trialStatus: 'ACTIVE',
      }),
    );
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText(/your trial ends in 3 days/i);
    expect(container.textContent).not.toMatch(/renews/i);

    cleanup();
    mockSubscription(
      subState({
        subscription: row,
        status: 'TRIAL',
        trial: { startsAt: '2026-09-20T00:00:00.000Z', endsAt: '2026-09-21T00:00:00.000Z', daysRemaining: 1 },
        trialStatus: 'ACTIVE',
      }),
    );
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText(/your trial ends tomorrow/i);
  });

  it('trial expired: truthful copy, no "Payment required", no hidden-business claim', async () => {
    const row = subRow({ status: 'EXPIRED' });
    mockSubscription(subState({ subscription: row, status: 'EXPIRED', trialStatus: 'EXPIRED' }));
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Plan expired');
    expect(screen.getAllByText(/your free trial has ended/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/your business is still here/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/payment required/i);
    expect(container.textContent).not.toMatch(/automatically hidden/i);
  });

  it('paid expired: "Plan expired", not "Payment required"', async () => {
    const row = subRow({ status: 'EXPIRED', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'EXPIRED', trialStatus: 'CONVERTED' }));
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Plan expired');
    expect(screen.getAllByText(/your plan has expired/i).length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toMatch(/payment required/i);
  });

  it('suspended: "Subscription suspended", never collapsed into payment-required', async () => {
    const row = subRow({ status: 'SUSPENDED', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'SUSPENDED', trialStatus: 'CONVERTED' }));
    const { container } = render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Subscription suspended');
    expect(container.textContent).not.toMatch(/payment required/i);
  });

  it('cancelled: "Plan cancelled"', async () => {
    const row = subRow({ status: 'CANCELLED', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'CANCELLED', trialStatus: 'CONVERTED' }));
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByText('Plan cancelled');
  });
});

describe('OwnerVerificationScreen: verification vs listing approval (§5, §7)', () => {
  const renderVerification = (appStatus: string | null, businessStatus: string, trialStatus: string | null = null) => {
    vi.spyOn(api, 'getVerification').mockResolvedValue(verificationState(appStatus));
    mockSubscription(subState({ businessStatus, trialStatus }));
    return render(<OwnerVerification businessId="biz-1" />);
  };

  it('not submitted: explains verification unlocks the trial', async () => {
    renderVerification(null, 'PENDING');
    expect(await screen.findByText(/complete verification to unlock your free trial/i)).toBeTruthy();
  });

  it('submitted: shows the application is under review', async () => {
    renderVerification('SUBMITTED', 'PENDING');
    expect(await screen.findByText(/your application is with the review team/i)).toBeTruthy();
  });

  it('verified but listing pending: waiting state, never "live", no trial offer', async () => {
    renderVerification('APPROVED', 'PENDING', 'ELIGIBLE');
    expect(await screen.findByText(/verification approved/i)).toBeTruthy();
    expect(
      screen.getByText(/still waiting for listing approval before customers can find it/i),
    ).toBeTruthy();
    expect(screen.getByText('Waiting for listing approval')).toBeTruthy();
    expect(screen.queryByText(/your business is live/i)).toBeNull();
  });

  it('verified and listed: live, with the trial pointer when eligible', async () => {
    renderVerification('APPROVED', 'APPROVED', 'ELIGIBLE');
    expect(await screen.findByText(/your business is live and visible to customers/i)).toBeTruthy();
    expect(screen.getByText(/you can now start your free trial/i)).toBeTruthy();
  });

  it('does not invent review times', async () => {
    const { container } = renderVerification('SUBMITTED', 'PENDING');
    await screen.findByText(/your application is with the review team/i);
    expect(container.textContent).not.toMatch(/few working days/i);
  });
});

describe('OwnerPlanCard: honest plan copy (§11-§13)', () => {
  const renderCard = (s: BusinessSubscriptionState) => {
    mockSubscription(s);
    return render(
      <OwnerPlanCard businessId="biz-1" onManagePlan={() => {}} onViewPayments={() => {}} />,
    );
  };

  it('never claims a plan unlocks visibility', async () => {
    const { container } = renderCard(subState({}));
    await waitFor(() => expect(container.textContent).toMatch(/choose a plan/i));
    expect(screen.getByText(/choose a plan to continue after your trial/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/unlock bookings, orders and visibility/i);
  });

  it('active plan: "Plan active until", never "Renews"', async () => {
    const row = subRow({ status: 'ACTIVE', trialStartAt: null, trialEndAt: null });
    const { container } = renderCard(subState({ subscription: row }));
    await screen.findByText('Active');
    expect(screen.getByText(/plan active until/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/renews/i);
  });

  it('suspended plan: honest label', async () => {
    const row = subRow({ status: 'SUSPENDED', trialStartAt: null, trialEndAt: null });
    renderCard(subState({ subscription: row }));
    await screen.findByText('Subscription suspended');
  });

  it('expired plan: prompts to choose a plan, not to "renew"', async () => {
    const row = subRow({ status: 'EXPIRED' });
    const { container } = renderCard(subState({ subscription: row }));
    await screen.findByText('Plan expired');
    expect(container.textContent).not.toMatch(/renew to continue/i);
  });
});

describe('SubscriptionBadge: honest states (§11)', () => {
  it('labels a suspended subscription honestly', async () => {
    const row = subRow({ status: 'SUSPENDED', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row }));
    render(<SubscriptionBadge businessId="biz-1" />);
    expect(await screen.findByText(/subscription suspended/i)).toBeTruthy();
  });
});

describe('OwnerAttentionItems: trial gating (§6, §9)', () => {
  const props = { businessId: 'biz-1', onOpenVerification: () => {}, onOpenSubscription: () => {} };

  it('offers the trial when ELIGIBLE + APPROVED', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'APPROVED' }));
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Start your free trial')).toBeTruthy();
  });

  it('shows the waiting state - not the trial - when ELIGIBLE + PENDING', async () => {
    mockSubscription(subState({ trialStatus: 'ELIGIBLE', businessStatus: 'PENDING' }));
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Waiting for listing approval')).toBeTruthy();
    expect(screen.queryByText('Start your free trial')).toBeNull();
  });

  it('labels a suspended subscription honestly', async () => {
    const row = subRow({ status: 'SUSPENDED', trialStartAt: null, trialEndAt: null });
    mockSubscription(subState({ subscription: row, status: 'SUSPENDED', trialStatus: 'CONVERTED' }));
    render(<OwnerAttentionItems {...props} />);
    expect(await screen.findByText('Your plan needs attention')).toBeTruthy();
    expect(screen.getByText('Your subscription is suspended')).toBeTruthy();
  });
});
