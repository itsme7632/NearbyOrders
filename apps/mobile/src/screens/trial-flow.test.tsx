import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TrialFlow } from './TrialFlow.js';
import * as api from '../api.js';
import type { BusinessSubscriptionState, Subscription, SubscriptionPlan, SubscriptionRowPlan } from '../api.js';

afterEach(cleanup);

/**
 * P4: free-trial conversion flow.
 *
 * CHOOSE PLAN -> START FREE TRIAL -> USE BUSINESS -> CONTINUE WITH SAME PLAN.
 *
 * Every number in these fixtures comes from the "server" mocks — plan name,
 * price, trial days, and business allowance are never hard-coded in the
 * component. The tests assert the component renders what the server sends.
 */

const starter: SubscriptionPlan = {
  id: 'plan-starter',
  slug: 'starter',
  name: 'Starter',
  description: 'For a single shop getting started.',
  monthlyPriceMinor: 99900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: ['1 business listing'],
  displayOrder: 0,
  isHighlighted: false,
  isActive: true,
  maxBusinesses: 1,
};

const growth: SubscriptionPlan = {
  id: 'plan-growth',
  slug: 'growth',
  name: 'Growth',
  description: 'For growing businesses.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: ['Up to 3 businesses', 'Priority placement'],
  displayOrder: 1,
  isHighlighted: true,
  isActive: true,
  maxBusinesses: 3,
};

const premium: SubscriptionPlan = {
  id: 'plan-premium',
  slug: 'premium',
  name: 'Premium',
  description: 'For established brands.',
  monthlyPriceMinor: 599900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: ['Up to 10 businesses'],
  displayOrder: 2,
  isHighlighted: false,
  isActive: true,
  maxBusinesses: 10,
};

const plans = [starter, growth, premium];

const growthRow: SubscriptionRowPlan = {
  slug: 'growth',
  name: 'Growth',
  description: 'For growing businesses.',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 14,
  benefits: ['Up to 3 businesses', 'Priority placement'],
  billingInterval: 'MONTHLY',
  displayOrder: 1,
  isHighlighted: true,
};

function subscriptionState(overrides: Partial<BusinessSubscriptionState>): BusinessSubscriptionState {
  return {
    businessId: 'biz-1',
    subscription: null,
    status: null,
    trial: null,
    planNameSnapshot: null,
    planPriceMinorSnapshot: null,
    verificationStatus: null,
    trialStatus: null,
    businessStatus: null,
    ...overrides,
  };
}

const eligibleState = () =>
  subscriptionState({ trialStatus: 'ELIGIBLE', businessStatus: 'APPROVED' });

const trialSubscription = (daysRemaining: number): Subscription => ({
  id: 'sub-1',
  status: 'TRIAL',
  trialStartAt: '2026-09-14T00:00:00.000Z',
  trialEndAt: '2026-09-28T00:00:00.000Z',
  currentPeriodStartAt: '2026-09-14T00:00:00.000Z',
  currentPeriodEndAt: '2026-09-28T00:00:00.000Z',
  cancelledAt: null,
  planNameSnapshot: 'Growth',
  planPriceMinorSnapshot: 299900,
  plan: growthRow,
});

const activeTrialState = (daysRemaining: number) =>
  subscriptionState({
    subscription: trialSubscription(daysRemaining),
    status: 'TRIAL',
    trial: { startsAt: '2026-09-14T00:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z', daysRemaining },
    trialStatus: 'ACTIVE',
    businessStatus: 'APPROVED',
  });

const expiredTrialState = () =>
  subscriptionState({
    subscription: { ...trialSubscription(0), status: 'EXPIRED' },
    status: 'EXPIRED',
    trial: null,
    trialStatus: 'EXPIRED',
    businessStatus: 'APPROVED',
  });

function renderFlow(state: BusinessSubscriptionState, onOpen = vi.fn(), onTrialStarted = vi.fn()) {
  return {
    ...render(
      <TrialFlow
        businessId="biz-1"
        state={state}
        activePlans={plans}
        onOpen={onOpen}
        onTrialStarted={onTrialStarted}
      />,
    ),
    onOpen,
    onTrialStarted,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('P4 trial flow', () => {
  it('1. eligible approved business sees plan selection', async () => {
    renderFlow(eligibleState());
    const group = await screen.findByRole('radiogroup', { name: /choose a plan/i });
    expect(group).toBeTruthy();
    // All three server plans are offered.
    expect(screen.getByRole('radio', { name: /starter/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /growth/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /premium/i })).toBeTruthy();
  });

  it('2. pending business cannot see/start trial', async () => {
    renderFlow(subscriptionState({ trialStatus: 'ELIGIBLE', businessStatus: 'PENDING' }));
    await screen.findByText(/waiting for listing approval/i);
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('3. rejected business cannot see/start trial', async () => {
    renderFlow(subscriptionState({ trialStatus: 'NOT_ELIGIBLE', businessStatus: 'REJECTED' }));
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('4. verified but listing-pending business shows waiting for listing approval', async () => {
    renderFlow(subscriptionState({ trialStatus: 'ELIGIBLE', businessStatus: 'VERIFIED' }));
    expect(await screen.findByText(/waiting for listing approval/i)).toBeTruthy();
    // Never claims the business is live, never offers the trial CTA.
    expect(screen.queryByText(/your business is live/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
  });

  it('5. plan prices come from server data', async () => {
    // The fixtures price Growth at Rs 2,999.00 — the UI must show the
    // server's number, not a client constant.
    renderFlow(eligibleState());
    const radios = await screen.findAllByRole('radio');
    const growthRadio = radios.find((r) => (r.textContent ?? '').includes('Growth'));
    expect(growthRadio?.textContent).toContain('2,999');
  });

  it('6. trial duration comes from server data', async () => {
    const customPlans = plans.map((p) => ({ ...p, trialDays: 21 }));
    render(
      <TrialFlow
        businessId="biz-1"
        state={eligibleState()}
        activePlans={customPlans}
        onOpen={vi.fn()}
        onTrialStarted={vi.fn()}
      />,
    );
    // 21 days from the server, not a hard-coded 14.
    expect(await screen.findByRole('button', { name: 'Start 21-Day Free Trial' })).toBeTruthy();
    expect(screen.getByText(/try growth free for 21 days/i)).toBeTruthy();
  });

  it('7. selected plan is displayed correctly', async () => {
    renderFlow(eligibleState());
    // Growth is the highlighted (recommended) plan, pre-selected.
    const growthRadio = await screen.findByRole('radio', { name: /growth/i });
    expect(growthRadio.getAttribute('aria-checked')).toBe('true');
    // Switch to Premium: the confirmation follows the selection.
    fireEvent.click(await screen.findByRole('radio', { name: /premium/i }));
    expect(await screen.findByText(/try premium free for 14 days/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start 14-Day Free Trial' })).toBeTruthy();
  });

  it('8. Start Trial sends the correct server request', async () => {
    const applySpy = vi.spyOn(api, 'applyTrial').mockResolvedValue(trialSubscription(14));
    const { onTrialStarted } = renderFlow(eligibleState());
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-Day Free Trial' }));
    await screen.findByText(/free trial started/i);
    expect(applySpy).toHaveBeenCalledWith('biz-1', 'growth');
    expect(onTrialStarted).toHaveBeenCalled();
  });

  it('9. success displays the active trial state', async () => {
    vi.spyOn(api, 'applyTrial').mockResolvedValue(trialSubscription(14));
    renderFlow(eligibleState());
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-Day Free Trial' }));
    const notice = await screen.findByText(/free trial started/i);
    expect(notice).toBeTruthy();
    expect(screen.getByText(/no payment has been taken/i)).toBeTruthy();
  });

  it('10. trial start does not display payment collection', async () => {
    vi.spyOn(api, 'applyTrial').mockResolvedValue(trialSubscription(14));
    renderFlow(eligibleState());
    const offer = await screen.findByRole('region', { name: /start your free trial/i });
    const text = (offer.textContent ?? '').toLowerCase();
    expect(text).not.toContain('card');
    expect(text).not.toContain('checkout');
    expect(text).not.toContain('pay now');
    fireEvent.click(screen.getByRole('button', { name: 'Start 14-Day Free Trial' }));
    const done = await screen.findByText(/free trial started/i);
    expect((done.parentElement?.textContent ?? '').toLowerCase()).not.toContain('card');
  });

  it('11. active trial shows remaining time/state', async () => {
    renderFlow(activeTrialState(12));
    expect(await screen.findByText(/12 days remaining/i)).toBeTruthy();
    expect(screen.getByText(/growth/i)).toBeTruthy();
    expect(screen.getAllByText(/trial ends/i).length).toBeGreaterThanOrEqual(1);
  });

  it('12. trial ending soon displays honest continuation copy', async () => {
    const onOpen = vi.fn();
    renderFlow(activeTrialState(2), onOpen);
    expect(await screen.findByText(/your trial ends soon\./i)).toBeTruthy();
    expect(screen.getByText(/choose a plan to continue your subscription\./i)).toBeTruthy();
    // Same-plan continuation into the manual payment flow.
    const cta = screen.getByRole('button', { name: /continue with growth/i });
    fireEvent.click(cta);
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription-make-payment');
    // Honest: no auto-renew language.
    const panel = screen.getByRole('region', { name: /active free trial/i });
    expect((panel.textContent ?? '').toLowerCase()).not.toContain('renew');
  });

  it('13. expired trial displays honest continuation state', async () => {
    renderFlow(expiredTrialState());
    expect(await screen.findByText(/your free trial has ended\./i)).toBeTruthy();
    expect(screen.getByText(/your business is still here\./i)).toBeTruthy();
    expect(screen.getByText(/choose a plan to continue/i)).toBeTruthy();
  });

  it('14. expired trial does not hide/delete the business', async () => {
    renderFlow(expiredTrialState());
    const panel = await screen.findByRole('status', { name: /free trial ended/i });
    const text = (panel.textContent ?? '').toLowerCase();
    expect(text).not.toContain('gone');
    expect(text).not.toContain('removed');
    expect(text).not.toContain('deleted');
  });

  it('15. no "Renews" language anywhere in the flow', async () => {
    const { container } = renderFlow(eligibleState());
    await screen.findByRole('radiogroup');
    expect(container.textContent ?? '').not.toMatch(/renews?/i);
    expect(container.textContent ?? '').not.toMatch(/auto-renew/i);

    cleanup();
    const { container: active } = renderFlow(activeTrialState(12));
    await screen.findByText(/12 days remaining/i);
    expect(active.textContent ?? '').not.toMatch(/renews?/i);

    cleanup();
    const { container: expired } = renderFlow(expiredTrialState());
    await screen.findByText(/your free trial has ended/i);
    expect(expired.textContent ?? '').not.toMatch(/renews?/i);
    expect(expired.textContent ?? '').not.toMatch(/card was charged/i);
  });

  it('16. no misleading generic "Payment required" trial state', async () => {
    renderFlow(expiredTrialState());
    await screen.findByText(/your free trial has ended/i);
    expect(screen.queryByText(/^payment required$/i)).toBeNull();
    expect(screen.queryByText(/payment required/i)).toBeNull();
  });

  it('17. same-plan continuation is clearly represented', async () => {
    const onOpen = vi.fn();
    renderFlow(expiredTrialState(), onOpen);
    const cta = await screen.findByRole('button', { name: /continue with growth/i });
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    // Manual payment route — the existing architecture, not a new one.
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription-make-payment');
  });

  it('18. P3 business allowance is displayed from server data', async () => {
    renderFlow(eligibleState());
    const radios = await screen.findAllByRole('radio');
    const byName = (n: string) => radios.find((r) => (r.textContent ?? '').includes(n))?.textContent ?? '';
    // Server maxBusinesses: Starter 1, Growth 3, Premium 10.
    expect(byName('Starter')).toContain('1 business');
    expect(byName('Growth')).toContain('3 businesses');
    expect(byName('Premium')).toContain('10 businesses');

    cleanup();
    renderFlow(activeTrialState(12));
    const active = await screen.findByRole('region', { name: /active free trial/i });
    expect(active.textContent ?? '').toContain('3 businesses');
  });

  it('19. BUSINESS_NOT_APPROVED is handled correctly', async () => {
    const serverError = Object.assign(new Error('Business must be approved before starting a trial'), {
      code: 'BUSINESS_NOT_APPROVED',
    });
    vi.spyOn(api, 'applyTrial').mockRejectedValue(serverError);
    renderFlow(eligibleState());
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-Day Free Trial' }));
    // The server's reason is surfaced; no false success.
    expect(await screen.findByText(/must be approved before starting a trial/i)).toBeTruthy();
    expect(screen.queryByText(/free trial started/i)).toBeNull();
  });

  it('20. network/server errors are handled without false success', async () => {
    vi.spyOn(api, 'applyTrial').mockRejectedValue(new Error('Network request failed'));
    renderFlow(eligibleState());
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-Day Free Trial' }));
    expect(await screen.findByText(/network request failed/i)).toBeTruthy();
    expect(screen.queryByText(/free trial started/i)).toBeNull();
    // The CTA is available again for a retry.
    expect(screen.getByRole('button', { name: 'Start 14-Day Free Trial' })).toBeTruthy();
  });

  it('already-used trial explains honestly instead of offering again', async () => {
    renderFlow(subscriptionState({ trialStatus: 'EXPIRED', businessStatus: 'APPROVED' }));
    expect(await screen.findByText(/your free trial has already been used/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start .* free trial/i })).toBeNull();
  });

  it('zero-trial-day plans never advertise a free trial', async () => {
    const noTrial = plans.map((p) => ({ ...p, trialDays: 0 }));
    render(
      <TrialFlow
        businessId="biz-1"
        state={eligibleState()}
        activePlans={noTrial}
        onOpen={vi.fn()}
        onTrialStarted={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });
});
