// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { OwnerSubscription } from './OwnerSubscriptionScreen.js';
import { setSession, type SubscriptionPlan } from '../api.js';

afterEach(cleanup);

/**
 * Blank-screen regression: both "Manage plan" and "View payment history"
 * render the OwnerSubscription screen, which crashed in production because
 * the client passed the server's paginated payment-request envelope
 * ({ data: { items, nextCursor } }) through as PaymentRequest[] and
 * `history.find(...)` threw during render, unmounting the whole screen.
 *
 * This mounts the REAL screen with fetch stubbed at the network level using
 * the REAL server wire shapes — no api-module mocking. Any envelope-vs-array
 * regression throws here instead of on a device.
 */

/** One payment request EXACTLY as the server's owner DTO sends it. */
const wirePaymentItem = {
  id: 'pay-1',
  status: 'PENDING',
  amountMinor: 299900,
  currency: 'PKR',
  transactionReference: 'TX-REAL-1',
  receiptStorageKey: 'receipts/r.jpg',
  paidAt: null,
  note: null,
  rejectionReason: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  subscriptionId: null,
  paymentMethod: { id: 'method-easypaisa', name: 'Easypaisa (Test)', type: 'EASYPAISA' },
};

const plan: SubscriptionPlan = {
  id: 'plan-1',
  slug: 'nearbyorders-business',
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: ['Accept bookings and orders'],
  displayOrder: 0,
  isHighlighted: true,
  isActive: true,
};

/** GET /businesses/:id/subscription wire shape: the state object itself. */
const subscriptionState = {
  businessId: 'biz-1',
  subscription: null,
  status: null,
  trial: null,
  planNameSnapshot: null,
  planPriceMinorSnapshot: null,
  verificationStatus: null,
  trialStatus: 'EXPIRED',
};

/** One pay-in channel EXACTLY as the server's public DTO sends it (no displayOrder on the wire). */
const wirePaymentMethod = {
  id: 'method-easypaisa',
  name: 'Easypaisa (Test)',
  type: 'EASYPAISA',
  accountTitle: 'NearbyOrders Test',
  accountNumber: '03000000000',
  iban: null,
  qrImageUrl: null,
  instructions: 'Pay to this account, then submit your proof below.',
};

const jsonOk = (payload: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(payload) });

beforeEach(() => {
  setSession({ accessToken: 'tok-owner', user: { id: 'u1', email: 'o@x.com', role: 'BUSINESS_OWNER' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/subscription/payment-requests'))
        return jsonOk({ data: { items: [wirePaymentItem], nextCursor: null } });
      // OwnerPayments early-returns on an empty method list, so the fixture
      // carries one real channel to reach the history section.
      if (url.includes('/subscription/payment-methods')) return jsonOk({ data: [wirePaymentMethod] });
      if (url.includes('/subscription/plans')) return jsonOk({ data: [plan] });
      if (url.includes('/businesses/biz-1/subscription')) return jsonOk({ data: subscriptionState });
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('OwnerSubscription with the real paginated payment-request envelope', () => {
  it('renders the payment history instead of throwing history.find is not a function', async () => {
    // If the envelope leaks through as the requests value, history.find
    // throws during render and React unmounts the screen — these assertions
    // would never resolve.
    render(<OwnerSubscription businessId="biz-1" />);
    // The redesigned screen also has a "Payment history" management row, so
    // there are two honest matches; the regression intent is unchanged: the
    // history section renders instead of throwing on the envelope.
    expect((await screen.findAllByText('Payment history')).length).toBeGreaterThan(0);
    // The history row renders the reference as "Ref TX-REAL-1" (the pending
    // banner also mentions the reference, so match the row's exact text).
    expect(await screen.findByText('Ref TX-REAL-1')).toBeTruthy();
    // The wire DTO carries no paymentMethodName, so the channel name falls
    // back to the nested paymentMethod.name. Scoped to the history block:
    // the always-visible methods section also names the channel.
    const historyBlock = document.getElementById('sub-pay-history');
    expect(historyBlock).toBeTruthy();
    expect(within(historyBlock!).getByText('Easypaisa (Test)')).toBeTruthy();
    expect(await screen.findByText(/Payment under review/)).toBeTruthy();
  });
});
