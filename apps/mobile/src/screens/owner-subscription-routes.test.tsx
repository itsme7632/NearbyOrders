import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerScreen } from './OwnerScreen.js';
import { parseHash, ownerScreens } from '../navigation.js';
import * as api from '../api.js';
import type { SubscriptionPlan, BusinessSubscriptionState, PaymentMethod } from '../api.js';

afterEach(cleanup);

const plan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'nearbyorders-business',
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

const noSubState: BusinessSubscriptionState = {
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: 'ELIGIBLE',
};

const method: PaymentMethod = {
  id: 'm-easypaisa',
  name: 'Easypaisa',
  type: 'EASYPAISA',
  accountTitle: 'NearbyOrders',
  accountNumber: '03001234567',
  iban: null,
  instructions: null,
  qrImageUrl: null,
  displayOrder: 0,
};

const renderOwner = (screenName: string, onOpen = vi.fn()) =>
  render(
    <OwnerScreen screen={screenName} businessId="biz-1" onBack={vi.fn()} onOpenBooking={vi.fn()} onOpen={onOpen} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...noSubState });
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([plan]);
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([method]);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
});

describe('subscription route hierarchy', () => {
  it('registers all five subscription sub-routes plus the hub', () => {
    for (const name of [
      'subscription',
      'subscription-plan',
      'subscription-change-plan',
      'subscription-payment-methods',
      'subscription-make-payment',
      'subscription-payment-history',
    ]) {
      expect(ownerScreens).toContain(name);
    }
  });

  it('parses deep links for every subscription route', () => {
    const cases: Array<[string, string]> = [
      ['#/owner/biz-1/subscription', 'subscription'],
      ['#/owner/biz-1/subscription-plan', 'subscription-plan'],
      ['#/owner/biz-1/subscription-change-plan', 'subscription-change-plan'],
      ['#/owner/biz-1/subscription-payment-methods', 'subscription-payment-methods'],
      ['#/owner/biz-1/subscription-make-payment', 'subscription-make-payment'],
      ['#/owner/biz-1/subscription-payment-history', 'subscription-payment-history'],
    ];
    for (const [hash, screen] of cases) {
      const route = parseHash(hash);
      expect(route).toEqual({ name: 'owner-screen', screen, businessId: 'biz-1' });
    }
  });

  it('renders each sub-screen on its own route with the right title', async () => {
    const titles: Array<[string, string]> = [
      ['subscription', 'Business Subscription'],
      ['subscription-plan', 'Plan Details'],
      ['subscription-change-plan', 'Change Plan'],
      ['subscription-payment-methods', 'Payment Methods'],
      ['subscription-make-payment', 'Make a Payment'],
      ['subscription-payment-history', 'Payment History'],
    ];
    for (const [name, title] of titles) {
      const { unmount } = renderOwner(name);
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
      unmount();
    }
  });

  it('the chrome back button on every sub-screen returns to the hub, never history.back()', async () => {
    for (const name of [
      'subscription-plan',
      'subscription-change-plan',
      'subscription-payment-methods',
      'subscription-make-payment',
      'subscription-payment-history',
    ]) {
      const onOpen = vi.fn();
      const { unmount } = renderOwner(name, onOpen);
      expect((await screen.findAllByRole('heading')).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
      expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription');
      unmount();
    }
  });

  it('the hub back button still returns to the dashboard', async () => {
    const onBack = vi.fn();
    render(<OwnerScreen screen="subscription" businessId="biz-1" onBack={onBack} onOpenBooking={vi.fn()} onOpen={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Business Subscription' });
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('legacy choose-plan route still renders the change-plan screen', async () => {
    const route = parseHash('#/owner/biz-1/choose-plan');
    expect(route).toEqual({ name: 'owner-screen', screen: 'choose-plan', businessId: 'biz-1' });
    const onOpen = vi.fn();
    renderOwner('choose-plan', onOpen);
    expect(await screen.findByRole('radiogroup', { name: 'Subscription plans' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription');
  });
});
