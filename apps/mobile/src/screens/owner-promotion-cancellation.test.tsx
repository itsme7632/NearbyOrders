import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerPromotions } from './OwnerPromotionsScreen.js';
import { PromotionPaymentFlow } from './OwnerPromotionPayment.js';
import * as api from '../api.js';
import type { Promotion, PromotionRequest, PromotionPaymentRequest, PromotionLifecycleState } from '../api.js';

afterEach(cleanup);

const promotion: Promotion = {
  id: 'promo-1',
  slug: 'homepage-spotlight',
  name: 'Homepage spotlight',
  description: 'Feature your business.',
  benefits: ['Top placement'],
  priceMinor: 499900,
  currency: 'PKR',
  durationDays: 7,
  requirements: null,
  displayOrder: 0,
};

const baseRequest: PromotionRequest = {
  id: 'req-1',
  promotionId: 'promo-1',
  promotionName: 'Homepage spotlight',
  note: null,
  status: 'PENDING',
  lifecycleState: 'PENDING_REVIEW',
  submittedAt: '2026-09-10T00:00:00.000Z',
  reviewedAt: null,
  activatedAt: null,
  expiresAt: null,
  amountDueMinor: 499900,
  currency: 'PKR',
  paymentStatus: null,
  lastPaymentRejected: false,
  promotionPriceMinor: 499900,
  promotionCurrency: 'PKR',
  promotionDurationDays: 7,
  rejectionReason: null,
};

const withLifecycle = (state: PromotionLifecycleState, status: PromotionRequest['status']): PromotionRequest => ({
  ...baseRequest,
  lifecycleState: state,
  status,
});

const pendingPayment: PromotionPaymentRequest = {
  id: 'pay-1',
  promotionRequestId: 'req-1',
  status: 'PENDING',
  amountMinor: 499900,
  currency: 'PKR',
  transactionReference: 'TRX123',
  receiptStorageKey: 'receipts/abc.jpg',
  paidAt: null,
  note: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
  paymentMethod: { id: 'm-1', name: 'Easypaisa', type: 'EASYPAISA' },
};

let requestsSpy: MockInstance<(businessId: string) => Promise<PromotionRequest[]>>;
let cancelRequestSpy: MockInstance<(businessId: string, requestId: string) => Promise<PromotionRequest>>;
let cancelPaymentSpy: MockInstance<
  (businessId: string, requestId: string, paymentId: string) => Promise<PromotionPaymentRequest>
>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'listPromotions').mockResolvedValue([promotion]);
  requestsSpy = vi.spyOn(api, 'listPromotionRequests').mockResolvedValue([]);
  vi.spyOn(api, 'requestPromotion').mockResolvedValue(baseRequest);
  cancelRequestSpy = vi.spyOn(api, 'cancelPromotionRequest').mockResolvedValue({ ...baseRequest, status: 'CANCELLED', lifecycleState: 'CANCELLED' });
  cancelPaymentSpy = vi.spyOn(api, 'cancelPromotionPayment').mockResolvedValue({ ...pendingPayment, status: 'CANCELLED' });
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Promotion request cancellation', () => {
  it('shows a cancel button for a pending-review request', async () => {
    requestsSpy.mockResolvedValue([withLifecycle('PENDING_REVIEW', 'PENDING')]);
    render(<OwnerPromotions businessId="biz-1" />);
    // Switch to My requests tab
    const tab = await screen.findByRole('radio', { name: /my requests/i });
    fireEvent.click(tab);
    expect(await screen.findByRole('button', { name: /cancel request/i })).toBeTruthy();
  });

  it('shows a cancel button for a payment-required request', async () => {
    requestsSpy.mockResolvedValue([withLifecycle('PAYMENT_REQUIRED', 'APPROVED')]);
    render(<OwnerPromotions businessId="biz-1" />);
    const tab = await screen.findByRole('radio', { name: /my requests/i });
    fireEvent.click(tab);
    expect(await screen.findByRole('button', { name: /cancel request/i })).toBeTruthy();
  });

  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['REJECTED', 'REJECTED'],
    ['EXPIRED', 'EXPIRED'],
    ['CANCELLED', 'CANCELLED'],
  ] as Array<[PromotionLifecycleState, PromotionRequest['status']]> )(
    'does not show a cancel button for %s requests',
    async (lifecycle, status) => {
      requestsSpy.mockResolvedValue([withLifecycle(lifecycle, status)]);
      render(<OwnerPromotions businessId="biz-1" />);
      const tab = await screen.findByRole('radio', { name: /my requests/i });
      fireEvent.click(tab);
      await screen.findByText('Homepage spotlight');
      expect(screen.queryByRole('button', { name: /cancel request/i })).toBeNull();
    },
  );

  it('calls cancelPromotionRequest and reloads after confirmation', async () => {
    requestsSpy.mockResolvedValue([withLifecycle('PENDING_REVIEW', 'PENDING')]);
    render(<OwnerPromotions businessId="biz-1" />);
    const tab = await screen.findByRole('radio', { name: /my requests/i });
    fireEvent.click(tab);
    const btn = await screen.findByRole('button', { name: /cancel request/i });
    fireEvent.click(btn);
    await waitFor(() => expect(cancelRequestSpy).toHaveBeenCalledWith('biz-1', 'req-1'));
    // The list reloads so the cancelled state renders.
    await waitFor(() => expect(requestsSpy).toHaveBeenCalledTimes(2));
  });

  it('does not call the API when the owner dismisses the confirm dialog', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    requestsSpy.mockResolvedValue([withLifecycle('PENDING_REVIEW', 'PENDING')]);
    render(<OwnerPromotions businessId="biz-1" />);
    const tab = await screen.findByRole('radio', { name: /my requests/i });
    fireEvent.click(tab);
    const btn = await screen.findByRole('button', { name: /cancel request/i });
    fireEvent.click(btn);
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(cancelRequestSpy).not.toHaveBeenCalled();
  });
});

describe('Promotion payment cancellation', () => {
  const approvedRequest = withLifecycle('PAYMENT_REQUIRED', 'APPROVED');

  it('shows a cancel button for a pending payment', async () => {
    vi.spyOn(api, 'listPromotionPayments').mockResolvedValue([pendingPayment]);
    render(<PromotionPaymentFlow businessId="biz-1" request={approvedRequest} onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: /cancel payment/i })).toBeTruthy();
  });

  it('does not show a cancel button for reviewed payments', async () => {
    vi.spyOn(api, 'listPromotionPayments').mockResolvedValue([
      { ...pendingPayment, status: 'APPROVED' },
      { ...pendingPayment, id: 'pay-2', status: 'REJECTED' },
    ]);
    render(<PromotionPaymentFlow businessId="biz-1" request={approvedRequest} onBack={() => {}} />);
    await screen.findByText('Approved');
    expect(screen.queryByRole('button', { name: /cancel payment/i })).toBeNull();
  });

  it('calls cancelPromotionPayment and reloads the history', async () => {
    const listSpy = vi.spyOn(api, 'listPromotionPayments').mockResolvedValue([pendingPayment]);
    render(<PromotionPaymentFlow businessId="biz-1" request={approvedRequest} onBack={() => {}} />);
    const btn = await screen.findByRole('button', { name: /cancel payment/i });
    fireEvent.click(btn);
    await waitFor(() => expect(cancelPaymentSpy).toHaveBeenCalledWith('biz-1', 'req-1', 'pay-1'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });
});
