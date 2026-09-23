import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OwnerSubscriptionPaymentHistory } from './OwnerSubscriptionPaymentHistoryScreen.js';
import { setSession } from '../api.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSession(null);
});

/**
 * Blank-screen regression for the dedicated Payment history route: the
 * server paginates GET /businesses/:id/subscription/payment-requests as
 * { data: { items, nextCursor } }. If that envelope ever leaked through as
 * the requests value, history.find would throw during render and unmount
 * the screen. This mounts the real screen with fetch stubbed at the network
 * level using the real server wire shapes — no api-module mocking.
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

const jsonOk = (payload: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(payload) });

beforeEach(() => {
  setSession({ accessToken: 'tok-owner', user: { id: 'u1', email: 'o@x.com', role: 'BUSINESS_OWNER' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/subscription/payment-requests'))
        return jsonOk({ data: { items: [wirePaymentItem], nextCursor: null } });
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
});

describe('OwnerSubscriptionPaymentHistory with the real paginated payment-request envelope', () => {
  it('renders the records instead of throwing on the envelope', async () => {
    render(<OwnerSubscriptionPaymentHistory businessId="biz-1" />);
    // The record renders from the unwrapped items: reference, channel name
    // (falls back to the nested paymentMethod.name), amount, status badge.
    expect(await screen.findByText('Ref TX-REAL-1')).toBeTruthy();
    expect(screen.getByText('Easypaisa (Test)')).toBeTruthy();
    expect(screen.getByText('Pending review')).toBeTruthy();
  });
});
