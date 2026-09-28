import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSubscriptionMakePayment } from './OwnerSubscriptionMakePaymentScreen.js';
import * as api from '../api.js';
import type { PaymentMethod, PaymentRequest, SubscriptionPlan, BusinessSubscriptionState } from '../api.js';

afterEach(cleanup);

const starter: SubscriptionPlan = {
  id: 'plan-starter',
  slug: 'starter',
  maxBusinesses: 1,
  name: 'Starter',
  description: null,
  monthlyPriceMinor: 149900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: [],
  displayOrder: 0,
  isHighlighted: false,
  isActive: true,
};

const business: SubscriptionPlan = {
  id: 'plan-business',
  slug: 'nearbyorders-business',
  maxBusinesses: 3,
  name: 'NearbyOrders Business',
  description: null,
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 30,
  billingInterval: 'MONTHLY',
  benefits: [],
  displayOrder: 1,
  isHighlighted: true,
  isActive: true,
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

const noSubState: BusinessSubscriptionState = {
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

const pendingRequest: PaymentRequest = {
  id: 'pay-1',
  status: 'PENDING',
  planName: 'NearbyOrders Business',
  amountMinor: 299900,
  currency: 'PKR',
  paymentMethodName: 'Easypaisa',
  transactionReference: 'TX-9',
  receiptStorageKey: 'receipts/r.jpg',
  note: null,
  paidAt: null,
  rejectionReason: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  subscriptionId: null,
  paymentMethod: { id: 'm-easypaisa', name: 'Easypaisa', type: 'EASYPAISA' },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.spyOn(api, 'getBusinessSubscription').mockResolvedValue({ ...noSubState });
  vi.spyOn(api, 'listSubscriptionPlans').mockResolvedValue([starter, business]);
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([method]);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
});

function pickReceipt(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['receipt-bytes'], 'receipt.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('OwnerSubscriptionMakePayment', () => {
  it('shows the server amount due and the server payment methods, step by step', async () => {
    render(<OwnerSubscriptionMakePayment businessId="biz-1" />);
    // The amount due comes from the highlighted server plan, not the client.
    expect(await screen.findByText('Rs 2,999')).toBeTruthy();
    expect(screen.queryByText('Rs 1,499')).toBeNull();
    expect(screen.getByText('NearbyOrders Business')).toBeTruthy();
    // Payment methods come from the server.
    expect(screen.getByRole('button', { name: 'Easypaisa' })).toBeTruthy();
    expect(screen.getByText('03001234567')).toBeTruthy();
    // Sectioned flow, no history underneath.
    expect(screen.getAllByText('Amount due').length).toBeGreaterThan(0);
    expect(screen.getByText('Payment proof')).toBeTruthy();
    expect(document.querySelector('.manage-list')).toBeNull();
  });

  it('never shows the inaccurate "image storage is not connected" notice for receipts', async () => {
    const { container } = render(<OwnerSubscriptionMakePayment businessId="biz-1" />);
    await screen.findByPlaceholderText('e.g. TX-123456789');
    pickReceipt(container);
    expect((await screen.findAllByText('receipt.jpg')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Image storage is not connected/)).toBeNull();
  });

  it('uploads the receipt through the real endpoint and submits the storage key to the server', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadPaymentReceipt').mockResolvedValue('receipts/abc.jpg');
    const submitSpy = vi.spyOn(api, 'submitPaymentRequest').mockResolvedValue({ ...pendingRequest });
    const { container } = render(<OwnerSubscriptionMakePayment businessId="biz-1" />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. TX-123456789'), { target: { value: 'TX-123456789' } });
    const file = pickReceipt(container);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(submitSpy).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({
          paymentMethodId: 'm-easypaisa',
          transactionReference: 'TX-123456789',
          receiptStorageKey: 'receipts/abc.jpg',
        }),
      ),
    );
    expect((await screen.findAllByText(/stays pending until/)).length).toBeGreaterThan(0);
  });

  it('validates the form before touching the network', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadPaymentReceipt');
    const { container } = render(<OwnerSubscriptionMakePayment businessId="biz-1" />);
    fireEvent.change(await screen.findByPlaceholderText('e.g. TX-123456789'), { target: { value: 'ab' } });
    pickReceipt(container);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/at least 4 characters/)).toBeTruthy();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('shows the awaiting-verification state instead of the form while a request is pending', async () => {
    const onOpen = vi.fn();
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([{ ...pendingRequest }]);
    render(<OwnerSubscriptionMakePayment businessId="biz-1" onOpen={onOpen} />);
    expect(await screen.findByText('Awaiting verification.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View payment history' }));
    expect(onOpen).toHaveBeenCalledWith('/owner/biz-1/subscription-payment-history');
  });

  it('shows an honest empty state when no payment methods are configured', async () => {
    vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
    render(<OwnerSubscriptionMakePayment businessId="biz-1" />);
    expect(
      await screen.findByText('No payment methods are available right now. Please try again later.'),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
  });
});
