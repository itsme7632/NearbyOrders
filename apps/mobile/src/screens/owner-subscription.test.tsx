import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import * as api from '../api.js';
import type { Subscription, SubscriptionPlan, SubscriptionRowPlan, BusinessSubscriptionState, PaymentMethod } from '../api.js';

afterEach(cleanup);

const plan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Accept bookings and orders', 'Showcase your services & products', 'Customer reviews and ratings'],
  displayOrder: 0,
  isHighlighted: true,
  isActive: true,
};

/** Plan summary as embedded in a subscription row (server shape). */
const rowPlan: SubscriptionRowPlan = {
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  benefits: ['Accept bookings and orders', 'Showcase your services & products', 'Customer reviews and ratings'],
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

/** Server envelope with no subscription and no trial signal yet. */
const noTrialState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: null,
};

const eligibleState: BusinessSubscriptionState = { ...noTrialState, trialStatus: 'ELIGIBLE' };

const liveTrialState: BusinessSubscriptionState = {
  ...noTrialState,
  subscription: trialRow,
  status: 'TRIAL',
  trial: { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', daysRemaining: 30 },
  trialStatus: 'ACTIVE',
};

const usedTrialState: BusinessSubscriptionState = {
  ...noTrialState,
  subscription: { ...trialRow, status: 'EXPIRED' },
  status: 'EXPIRED',
  trial: null,
  trialStatus: 'EXPIRED',
};

const paymentRequest = {
  id: 'pay-1',
  status: 'PENDING' as const,
  planName: 'NearbyOrders Business',
  amountMinor: 299900,
  currency: 'PKR',
  paymentMethodName: 'Easypaisa (Test)',
  transactionReference: 'TX-1',
  receiptStorageKey: 'receipts/r.jpg',
  note: null,
  paidAt: null,
  rejectionReason: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  subscriptionId: null,
  paymentMethod: { id: 'method-easypaisa', name: 'Easypaisa (Test)', type: 'EASYPAISA' as const },
};

beforeEach(() => {
  // Spies persist across tests in a file: clear call history so per-test
  // assertions like "not called yet" see only this test's activity.
  vi.clearAllMocks();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...noTrialState });
  // The screen reads the plan catalog so the price is never hard-coded.
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([plan]);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
});

describe('OwnerSubscription (no subscription yet)', () => {
  it('shows the plan price from the API catalog and the trial CTA', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...eligibleState });
    render(<OwnerSubscription businessId="biz-1" />);
    await screen.findByRole('button', { name: 'Start 30-day free trial' });
    // 299900 minor = Rs 2,999 — integer paisa rendering, no float artifacts.
    // It renders on the subscription summary and on the live plan card.
    expect(screen.getAllByText('Rs 2,999').length).toBeGreaterThan(0);
    expect(screen.getByText('No subscription')).toBeTruthy();
    expect(screen.getByText(/No payment required now/)).toBeTruthy();
  });

  it('never advertises a free trial when the plan has zero trial days', async () => {
    const noTrialPlan: SubscriptionPlan = { ...plan, trialDays: 0 };
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...eligibleState });
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([noTrialPlan]);
    render(<OwnerSubscription businessId="biz-1" />);
    // The plan card and summary render (the plan itself is real), but the
    // trial banner must not promise a "0-day free trial".
    await screen.findByText('No subscription');
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });

  it('applies the trial with the selected plan slug and reloads the status', async () => {
    const applySpy = vi.spyOn(api, 'applyTrial').mockResolvedValue({ ...trialRow });
    const reloadSpy = vi.spyOn(api, 'getBusinessSubscription');
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-day free trial' }));
    // The chosen plan slug travels to the API — the server decides eligibility.
    await waitFor(() => expect(applySpy).toHaveBeenCalledWith('biz-1', 'nearbyorders-business'));
    expect(await screen.findByText(/Free trial started/)).toBeTruthy();
    // The reload happens in a follow-up effect; give React a beat to run it.
    await waitFor(() => expect(reloadSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('surfaces the server ineligibility reason verbatim when the trial is refused', async () => {
    vi.spyOn(api, 'applyTrial').mockRejectedValue(
      new api.ApiError(409, 'TRIAL_ALREADY_USED', 'A free trial was already used for this business.'),
    );
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-day free trial' }));
    expect(await screen.findByText(/A free trial was already used for this business\./)).toBeTruthy();
  });

  it('explains honestly when the trial is already used', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...usedTrialState });
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(
      await screen.findByText(/Your free trial has already been used for this business\./),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
  });

  it('renders every active plan, marks the highlighted one Recommended, and trials the highlighted plan by default', async () => {
    const other: SubscriptionPlan = {
      ...plan,
      id: 'plan-9',
      slug: 'some-other-plan',
      name: 'Some Other Plan',
      monthlyPriceMinor: 99900,
      trialDays: 7,
      isHighlighted: false,
    };
    const applySpy = vi.spyOn(api, 'applyTrial').mockResolvedValue({ ...trialRow });
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([other, plan]);
    render(<OwnerSubscription businessId="biz-1" />);
    // Both live catalog plans render — nothing is hidden or hard-coded.
    expect(await screen.findByText('Some Other Plan')).toBeTruthy();
    expect(screen.getAllByText('NearbyOrders Business').length).toBeGreaterThan(0);
    // Only the server-highlighted plan reads as recommended.
    const recommended = screen.getByText('Recommended');
    expect(recommended.closest('article')?.textContent).toContain('NearbyOrders Business');
    // The trial CTA defaults to the highlighted plan, not the first row.
    fireEvent.click(await screen.findByRole('button', { name: 'Start 30-day free trial' }));
    await waitFor(() => expect(applySpy).toHaveBeenCalledWith('biz-1', 'nearbyorders-business'));
  });

  it('choosing another plan retargets the trial CTA to that plan', async () => {
    const other: SubscriptionPlan = {
      ...plan,
      id: 'plan-9',
      slug: 'some-other-plan',
      name: 'Some Other Plan',
      monthlyPriceMinor: 99900,
      trialDays: 7,
      isHighlighted: false,
    };
    const applySpy = vi.spyOn(api, 'applyTrial').mockResolvedValue({ ...trialRow });
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([other, plan]);
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Some Other Plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start 7-day free trial' }));
    await waitFor(() => expect(applySpy).toHaveBeenCalledWith('biz-1', 'some-other-plan'));
  });

  it('shows an honest empty state when no plans are active', async () => {
    vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([]);
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('No plans available right now')).toBeTruthy();
  });
});

describe('OwnerSubscription (live trial)', () => {
  it('shows TRIAL status with the server-computed days remaining', async () => {
    vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...liveTrialState });
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Free trial')).toBeTruthy();
    expect(screen.getByText(/30 days remaining/i)).toBeTruthy();
    // The trial section hides once the trial is live.
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
  });
});

describe('OwnerSubscription (plan management rows)', () => {
  const rowBy = (title: string) =>
    screen.findByRole('button', { name: (n: string) => n.startsWith(title) });

  it('shows the management rows and the plain-language payment explainer', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    for (const name of ['Plan details', 'Change plan', 'Payment methods', 'Make a payment', 'Payment history']) {
      expect(await rowBy(name)).toBeTruthy();
    }
    expect(screen.getByText(/How manual payment works/)).toBeTruthy();
    expect(screen.getByText(/activates only after approval/)).toBeTruthy();
  });

  it('Plan details expands the working plan facts from the server', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await rowBy('Plan details'));
    expect(await screen.findByText('Billing')).toBeTruthy();
    expect(screen.getByText('Monthly')).toBeTruthy();
    expect(screen.getByText('30 days')).toBeTruthy();
    // The benefit renders on the plan card and again inside the details panel.
    expect(screen.getAllByText('Accept bookings and orders').length).toBeGreaterThan(0);
  });

  it('Change plan opens the inline chooser and applies the selection', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await rowBy('Change plan'));
    expect(await screen.findByRole('radiogroup', { name: 'Subscription plans' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: (n: string) => n.startsWith('NearbyOrders Business') }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with NearbyOrders Business' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  });

  it('Make a payment opens the payment form', async () => {
    const method: PaymentMethod = {
      id: 'm1',
      name: 'Easypaisa',
      type: 'EASYPAISA',
      accountTitle: 'NearbyOrders',
      accountNumber: '03001234567',
      iban: null,
      instructions: null,
      qrImageUrl: null,
      displayOrder: 0,
    };
    vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([method]);
    render(<OwnerSubscription businessId="biz-1" />);
    fireEvent.click(await rowBy('Make a payment'));
    expect(await screen.findByPlaceholderText('e.g. TX-123456789')).toBeTruthy();
    expect(screen.getByText('03001234567')).toBeTruthy();
  });
});

describe('OwnerSubscription (payment status)', () => {
  it('shows the pending payment state from the latest request', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([paymentRequest]);
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Payment under review by the NearbyOrders team')).toBeTruthy();
  });

  it('shows the approved payment state with the review date', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([
      { ...paymentRequest, status: 'APPROVED', reviewedAt: '2026-09-12T00:00:00.000Z' },
    ]);
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText(/Last payment approved/)).toBeTruthy();
  });

  it('shows the rejection reason from the latest rejected request', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([
      { ...paymentRequest, status: 'REJECTED', rejectionReason: 'Receipt unreadable.' },
    ]);
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('Last payment was rejected (see history)')).toBeTruthy();
    expect(screen.getByText('Receipt unreadable.')).toBeTruthy();
  });

  it('shows the honest empty payment state when nothing was submitted', async () => {
    render(<OwnerSubscription businessId="biz-1" />);
    expect(await screen.findByText('No payments submitted yet')).toBeTruthy();
  });
});
