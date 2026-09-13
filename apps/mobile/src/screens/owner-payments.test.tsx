import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerPayments, validatePaymentForm } from './OwnerSubscriptionPayments.js';
import * as api from '../api.js';
import type { PaymentMethod, PaymentRequest } from '../api.js';

afterEach(cleanup);

const methods: PaymentMethod[] = [
  {
    id: 'method-easypaisa',
    name: 'Easypaisa (Test)',
    type: 'EASYPAISA',
    accountTitle: 'NearbyOrders Test',
    accountNumber: '03000000000',
    iban: null,
    instructions: 'DEVELOPMENT TEST ACCOUNT — not a real Easypaisa number.',
  },
  {
    id: 'method-bank',
    name: 'Bank Transfer (Test)',
    type: 'BANK_TRANSFER',
    accountTitle: 'NearbyOrders Test',
    accountNumber: '0000000000000',
    iban: 'PK00TEST0000000000000000',
    instructions: null,
  },
];

const historyItem: PaymentRequest = {
  id: 'pay-1',
  status: 'PENDING',
  amountMinor: 299900,
  currency: 'PKR',
  transactionReference: 'TX-HISTORY-1',
  receiptStorageKey: 'receipts/r.jpg',
  rejectionReason: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  subscriptionId: null,
  paymentMethod: { id: 'method-easypaisa', name: 'Easypaisa (Test)', type: 'EASYPAISA' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue(methods);
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue({ items: [], nextCursor: null });
});

const openForm = async () => {
  fireEvent.click(await screen.findByRole('button', { name: "I've paid: submit proof" }));
};

const setReceipt = () =>
  fireEvent.change(screen.getByLabelText('Payment receipt', { selector: 'input' }), {
    target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] },
  });

describe('OwnerPayments (pay-in details)', () => {
  it('renders server-configured pay-in details, never hardcoded numbers', async () => {
    render(<OwnerPayments businessId="biz-1" />);
    await openForm();
    expect(await screen.findByText('NearbyOrders Test')).toBeTruthy();
    expect(screen.getByText('03000000000')).toBeTruthy(); // from the mocked API
  });

  it('shows the IBAN for bank transfers and the number for wallets', async () => {
    render(<OwnerPayments businessId="biz-1" />);
    await openForm();
    await screen.findByText('NearbyOrders Test');
    // Default selection is the first method (Easypaisa): shows the number.
    expect(screen.getByText('03000000000')).toBeTruthy();
    // Switching to the bank shows its IBAN instead.
    fireEvent.click(screen.getByRole('button', { name: 'Bank Transfer (Test)' }));
    expect(screen.getByText('PK00TEST0000000000000000')).toBeTruthy();
  });

  it('explains when no payment methods are configured', async () => {
    vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
    render(<OwnerPayments businessId="biz-1" />);
    expect(await screen.findByText(/No payment methods are available/i)).toBeTruthy();
  });
});

describe('OwnerPayments (submitting proof)', () => {
  it('validates the form before submission', async () => {
    expect(validatePaymentForm({ transactionReference: 'ab', hasReceipt: true })).toMatch(/at least 4/i);
    expect(validatePaymentForm({ transactionReference: 'TX-123', hasReceipt: false })).toMatch(/receipt/i);
    expect(validatePaymentForm({ transactionReference: 'TX-123', hasReceipt: true })).toBeNull();
  });

  it('blocks submission without a receipt pick', async () => {
    render(<OwnerPayments businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: "I've paid: submit proof" }));
    const submit = screen.getByRole('button', { name: 'Submit for verification' });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('uploads the receipt, submits the server storage key and reloads history', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadPaymentReceipt').mockResolvedValue('receipts/uploaded.jpg');
    const submitSpy = vi.spyOn(api, 'submitPaymentRequest').mockResolvedValue(historyItem);
    render(<OwnerPayments businessId="biz-1" />);
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'TX-NEW-1' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    await waitFor(() =>
      expect(submitSpy).toHaveBeenCalledWith('biz-1', {
        paymentMethodId: 'method-easypaisa',
        transactionReference: 'TX-NEW-1',
        receiptStorageKey: 'receipts/uploaded.jpg',
      }),
    );
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Payment submitted/i)).toBeTruthy();
  });

  it('surfaces a failed receipt upload without submitting', async () => {
    vi.spyOn(api, 'uploadPaymentReceipt').mockRejectedValue(new api.ApiError(400, 'VALIDATION_ERROR', 'Receipts must be JPG, PNG or WebP images'));
    const submitSpy = vi.spyOn(api, 'submitPaymentRequest');
    render(<OwnerPayments businessId="biz-1" />);
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'TX-BAD-FILE' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/Receipts must be JPG, PNG or WebP images/i)).toBeTruthy();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('surfaces API errors without crashing', async () => {
    vi.spyOn(api, 'uploadPaymentReceipt').mockResolvedValue('receipts/x.jpg');
    vi.spyOn(api, 'submitPaymentRequest').mockRejectedValue(
      new api.ApiError(409, 'PAYMENT_ALREADY_PENDING', 'You already have a payment awaiting verification'),
    );
    render(<OwnerPayments businessId="biz-1" />);
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('e.g. TX-123456789'), {
      target: { value: 'TX-ERR-1' },
    });
    setReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(await screen.findByText(/already have a payment awaiting verification/i)).toBeTruthy();
  });
});

describe('OwnerPayments (history)', () => {
  it('lists history with status labels and the server-computed amount', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue({ items: [historyItem], nextCursor: null });
    render(<OwnerPayments businessId="biz-1" />);
    expect(await screen.findByText('Awaiting verification')).toBeTruthy();
    expect(screen.getByText('Ref TX-HISTORY-1')).toBeTruthy();
    expect(screen.getByText('Rs 2,999')).toBeTruthy();
  });

  it('shows the rejection reason on rejected requests', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue({
      items: [{ ...historyItem, id: 'pay-2', status: 'REJECTED', rejectionReason: 'Receipt unreadable.' }],
      nextCursor: null,
    });
    render(<OwnerPayments businessId="biz-1" />);
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/Reason: Receipt unreadable\./)).toBeTruthy();
  });

  it('cancels its own pending request after confirmation', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue({ items: [historyItem], nextCursor: null });
    const cancelSpy = vi
      .spyOn(api, 'cancelPaymentRequest')
      .mockResolvedValue({ ...historyItem, status: 'CANCELLED', reviewedAt: '2026-09-11T01:00:00.000Z' });
    render(<OwnerPayments businessId="biz-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    // Confirmation step first.
    expect(cancelSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('biz-1', 'pay-1'));
    expect(await screen.findByText(/Payment request cancelled/i)).toBeTruthy();
  });

  it('keeps the pending banner while a request awaits verification', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue({ items: [historyItem], nextCursor: null });
    render(<OwnerPayments businessId="biz-1" />);
    expect(await screen.findByText(/Awaiting verification\./)).toBeTruthy();
    // The submit CTA is hidden while a request is pending.
    expect(screen.queryByRole('button', { name: "I've paid: submit proof" })).toBeNull();
  });
});
