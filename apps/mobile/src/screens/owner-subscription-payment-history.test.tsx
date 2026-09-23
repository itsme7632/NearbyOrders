import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSubscriptionPaymentHistory } from './OwnerSubscriptionPaymentHistoryScreen.js';
import * as api from '../api.js';
import type { PaymentRequest } from '../api.js';

afterEach(cleanup);

const base: PaymentRequest = {
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

const approved: PaymentRequest = {
  ...base,
  id: 'pay-2',
  status: 'APPROVED',
  transactionReference: 'TX-8',
  reviewedAt: '2026-09-12T00:00:00.000Z',
};

const rejected: PaymentRequest = {
  ...base,
  id: 'pay-3',
  status: 'REJECTED',
  transactionReference: 'TX-7',
  rejectionReason: 'Receipt unreadable.',
  paidAt: '2026-09-10T00:00:00.000Z',
  note: 'Paid from a different number.',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([{ ...base }, { ...approved }, { ...rejected }]);
});

describe('OwnerSubscriptionPaymentHistory', () => {
  it('renders every record with method, amount, dates, reference, and status badge', async () => {
    render(<OwnerSubscriptionPaymentHistory businessId="biz-1" />);
    expect(await screen.findByText('Ref TX-9')).toBeTruthy();
    expect(screen.getByText('Ref TX-8')).toBeTruthy();
    expect(screen.getByText('Ref TX-7')).toBeTruthy();
    // Method and amount come from the server record.
    expect(screen.getAllByText('Easypaisa').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rs 2,999').length).toBeGreaterThan(0);
    // Status badges: Pending review / Approved / Rejected.
    expect(screen.getByText('Pending review')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    // Reviewed date, paid date, rejection reason, note.
    expect(screen.getByText(/Reviewed/)).toBeTruthy();
    expect(screen.getByText(/Paid on/)).toBeTruthy();
    expect(screen.getByText(/Receipt unreadable\./)).toBeTruthy();
    expect(screen.getByText(/Paid from a different number\./)).toBeTruthy();
    expect(api.listPaymentRequests).toHaveBeenCalledWith('biz-1');
  });

  it('opens the stored receipt through the authorized endpoint', async () => {
    const blob = new Blob(['receipt-bytes'], { type: 'image/jpeg' });
    const downloadSpy = vi.spyOn(api, 'downloadReceipt').mockResolvedValue(blob);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const createSpy = vi.fn(() => 'blob:mock-receipt');
    Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true, writable: true });
    try {
      render(<OwnerSubscriptionPaymentHistory businessId="biz-1" />);
      const buttons = await screen.findAllByRole('button', { name: 'View receipt' });
      fireEvent.click(buttons[0]);
      await waitFor(() => expect(downloadSpy).toHaveBeenCalledWith('receipts/r.jpg'));
      expect(createSpy).toHaveBeenCalledWith(blob);
      expect(openSpy).toHaveBeenCalledWith('blob:mock-receipt', '_blank', 'noopener');
    } finally {
      openSpy.mockRestore();
    }
  });

  it('shows a professional empty state and no submission form when nothing was submitted', async () => {
    vi.spyOn(api, 'listPaymentRequests').mockResolvedValue([]);
    render(<OwnerSubscriptionPaymentHistory businessId="biz-1" />);
    expect(await screen.findByText('No payments submitted yet')).toBeTruthy();
    expect(
      screen.getByText(/it appears here with its review status: pending review, approved, or rejected/),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).toBeNull();
  });
});
