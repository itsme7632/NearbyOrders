import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerPromotions } from './OwnerPromotionsScreen.js';
import { PromotionPaymentFlow } from './OwnerPromotionPayment.js';
import * as api from '../api.js';
import type { PaymentMethod, Promotion, PromotionPaymentRequest, PromotionRequest } from '../api.js';

afterEach(cleanup);

const methods: PaymentMethod[] = [
  {
    id: 'method-easypaisa',
    name: 'Easypaisa (Test)',
    type: 'EASYPAISA',
    accountTitle: 'NearbyOrders Test',
    accountNumber: '03000000000',
    iban: null,
    instructions: 'Pay to this number and keep your receipt.',
    qrImageUrl: null,
    displayOrder: 0,
  },
];

const promotions: Promotion[] = [
  {
    id: 'promo-2',
    slug: 'category-boost',
    name: 'Category boost',
    description: 'Boost your category ranking for a month.',
    benefits: ['Higher placement for 30 days'],
    priceMinor: 199900,
    currency: 'PKR',
    durationDays: 30,
    requirements: null,
    displayOrder: 0,
  },
];

const payRequest: PromotionRequest = {
  id: 'req-pay',
  promotionId: 'promo-2',
  promotionName: 'Category boost',
  note: null,
  status: 'APPROVED',
  lifecycleState: 'PAYMENT_REQUIRED',
  submittedAt: '2026-09-10T00:00:00.000Z',
  reviewedAt: '2026-09-12T00:00:00.000Z',
  activatedAt: null,
  expiresAt: null,
  amountDueMinor: 199900,
  currency: 'PKR',
  paymentStatus: null,
  lastPaymentRejected: false,
  promotionPriceMinor: 199900,
  promotionCurrency: 'PKR',
  promotionDurationDays: 30,
  rejectionReason: null,
};

const pendingPayment: PromotionPaymentRequest = {
  id: 'ppay-1',
  status: 'PENDING',
  amountMinor: 199900,
  currency: 'PKR',
  transactionReference: 'TX-PENDING-1',
  receiptStorageKey: 'receipts/r.jpg',
  paidAt: null,
  note: null,
  rejectionReason: null,
  submittedAt: '2026-09-13T00:00:00.000Z',
  reviewedAt: null,
  paymentMethod: { id: 'method-easypaisa', name: 'Easypaisa (Test)', type: 'EASYPAISA' },
  promotionRequestId: 'req-pay',
};

let methodsSpy: MockInstance<() => Promise<PaymentMethod[]>>;
let paymentsSpy: MockInstance<(businessId: string, requestId: string) => Promise<PromotionPaymentRequest[]>>;
let uploadSpy: MockInstance<(file: File) => Promise<string>>;
let submitSpy: MockInstance<
  (
    businessId: string,
    requestId: string,
    body: {
      paymentMethodId: string;
      transactionReference: string;
      receiptStorageKey: string;
      paidAt?: string;
      note?: string;
    },
  ) => Promise<PromotionPaymentRequest>
>;

beforeEach(() => {
  vi.clearAllMocks();
  methodsSpy = vi.spyOn(api, 'listPaymentMethods').mockResolvedValue(methods);
  paymentsSpy = vi.spyOn(api, 'listPromotionPayments').mockResolvedValue([]);
  uploadSpy = vi.spyOn(api, 'uploadPaymentReceipt').mockResolvedValue('receipts/uploaded.jpg');
  submitSpy = vi.spyOn(api, 'submitPromotionPayment').mockResolvedValue({ ...pendingPayment, id: 'ppay-2' });
  vi.spyOn(api, 'listPromotions').mockResolvedValue(promotions);
  vi.spyOn(api, 'listPromotionRequests').mockResolvedValue([payRequest]);
});

const openPaymentFlow = async () => {
  render(<OwnerPromotions businessId="biz-1" />);
  fireEvent.click(await screen.findByRole('radio', { name: 'My requests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
};

const setReceipt = () =>
  fireEvent.change(screen.getByLabelText('Payment receipt', { selector: 'input' }), {
    target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] },
  });

describe('PromotionPaymentFlow (opening)', () => {
  it('opens from Pay now, clearly labeled as a promotion payment with the server amount due', async () => {
    await openPaymentFlow();
    expect(await screen.findByText('Promotion payment')).toBeTruthy();
    expect(screen.getByText('Promotion approved')).toBeTruthy();
    expect(screen.getByText(/approved your request for/)).toBeTruthy();
    // Server amount due, never a client-typed number.
    expect(screen.getByText('Rs 1,999')).toBeTruthy();
    // Admin-configured pay-in channels, never hardcoded.
    expect(await screen.findByText('Payment methods')).toBeTruthy();
    expect(screen.getAllByText('03000000000').length).toBeGreaterThan(0);
    expect(paymentsSpy).toHaveBeenCalledWith('biz-1', 'req-pay');
  });

  it('returns to the request list with back navigation', async () => {
    const onBack = vi.fn();
    render(<PromotionPaymentFlow businessId="biz-1" request={payRequest} onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to my requests' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('explains when no payment methods are configured', async () => {
    methodsSpy.mockResolvedValue([]);
    render(<PromotionPaymentFlow businessId="biz-1" request={payRequest} onBack={() => {}} />);
    expect(await screen.findByText(/No payment methods are available/i)).toBeTruthy();
  });

  it('surfaces payment-method load errors with a retry', async () => {
    methodsSpy.mockRejectedValue(new api.ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.'));
    render(<PromotionPaymentFlow businessId="biz-1" request={payRequest} onBack={() => {}} />);
    expect(await screen.findByText(/Cannot reach the NearbyOrders API/)).toBeTruthy();
  });
});

describe('PromotionPaymentFlow (submitting proof)', () => {
  it('uploads the receipt and submits the promotion payment with the right body', async () => {
    await openPaymentFlow();
    fireEvent.change(await screen.findByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'TX-PROMO-1' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    await waitFor(() =>
      expect(submitSpy).toHaveBeenCalledWith('biz-1', 'req-pay', {
        paymentMethodId: 'method-easypaisa',
        transactionReference: 'TX-PROMO-1',
        receiptStorageKey: 'receipts/uploaded.jpg',
      }),
    );
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    // Submission lands in the payment-under-review state.
    expect(await screen.findByText(/Promotion payment submitted/)).toBeTruthy();
    expect(paymentsSpy).toHaveBeenCalledTimes(2); // initial load + post-submit reload
  });

  it('shows the payment-under-review state when a submission is already pending', async () => {
    paymentsSpy.mockResolvedValue([pendingPayment]);
    render(<PromotionPaymentFlow businessId="biz-1" request={payRequest} onBack={() => {}} />);
    expect(await screen.findByText(/Payment under review/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).toBeNull();
    // History still renders with the receipt reference.
    expect(screen.getAllByText(/TX-PENDING-1/).length).toBeGreaterThan(0);
  });

  it('validates the transaction reference before submitting', async () => {
    await openPaymentFlow();
    fireEvent.change(await screen.findByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'ab' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/at least 4 characters/)).toBeTruthy();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('maps promotion payment error codes to friendly wording', async () => {
    submitSpy.mockRejectedValue(new api.ApiError(409, 'PAYMENT_ALREADY_PENDING', 'already pending'));
    await openPaymentFlow();
    fireEvent.change(await screen.findByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'TX-PROMO-2' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/already under review for this request/)).toBeTruthy();
  });

  it('never shows a payment form for free promotions', async () => {
    const freeRequest: PromotionRequest = {
      ...payRequest,
      id: 'req-free',
      amountDueMinor: 0,
      promotionPriceMinor: 0,
    };
    render(<PromotionPaymentFlow businessId="biz-1" request={freeRequest} onBack={() => {}} />);
    expect(await screen.findByText(/No payment is needed for this promotion/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).toBeNull();
  });
});
