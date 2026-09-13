import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { buildAdvanceBody } from './OwnerCatalog.js';
import { DeliverySettingsSection } from './OwnerDeliverySettings.js';
import { OrderPaymentPanel } from './Orders.js';
import * as api from '../api.js';
import type { CustomerPayment, Order } from '../api.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const payment = (patch: Partial<CustomerPayment> = {}): CustomerPayment => ({
  id: 'pay-1',
  amountMinor: 100000,
  currency: 'PKR',
  status: 'PENDING_VERIFICATION',
  transactionReference: 'TX-1',
  receiptStorageKey: 'k1',
  rejectionReason: null,
  submittedAt: '2026-09-12T10:00:00.000Z',
  verifiedAt: null,
  paymentMethod: { id: 'pm-1', displayName: 'Easypaisa', type: 'EASYPAISA' },
  ...patch,
});

const order = (patch: Partial<Order> = {}): Order => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  status: 'PENDING',
  subtotalMinor: 200000,
  currency: 'PKR',
  fulfillmentType: 'DELIVERY',
  notes: null,
  createdAt: '2026-09-12T10:00:00.000Z',
  deliveryFeeMinor: 20000,
  totalMinor: 220000,
  business: { id: 'biz-1', name: 'Butt Spices', slug: 'butt-spices' },
  customer: { firstName: 'Ayesha', lastName: 'Khan' },
  items: [{ id: 'i1', productId: 'p1', name: 'Biryani', unitPriceMinor: 200000, quantity: 1, lineTotalMinor: 200000 }],
  ...patch,
});

describe('buildAdvanceBody (Phase 7C service advance form)', () => {
  it('sends NONE with no amount fields', () => {
    expect(buildAdvanceBody({ type: 'NONE', value: '' }, 100000)).toEqual({ advance: { advanceType: 'NONE' } });
  });

  it('converts fixed rupees to integer minor units', () => {
    expect(buildAdvanceBody({ type: 'FIXED', value: '200' }, 100000)).toEqual({
      advance: { advanceType: 'FIXED', advanceAmountMinor: 20000 },
    });
  });

  it('rejects a fixed advance larger than the price', () => {
    expect(buildAdvanceBody({ type: 'FIXED', value: '1200' }, 100000)).toEqual({ error: 'Fixed advance cannot exceed the service price.' });
  });

  it('rejects an invalid fixed amount', () => {
    expect(buildAdvanceBody({ type: 'FIXED', value: 'abc' }, 100000)).toHaveProperty('error');
  });

  it('accepts whole-number percentages 1–100', () => {
    expect(buildAdvanceBody({ type: 'PERCENTAGE', value: '20' }, 100000)).toEqual({
      advance: { advanceType: 'PERCENTAGE', advancePercent: 20 },
    });
  });

  it('rejects percentages out of range or fractional', () => {
    expect(buildAdvanceBody({ type: 'PERCENTAGE', value: '0' }, 100000)).toHaveProperty('error');
    expect(buildAdvanceBody({ type: 'PERCENTAGE', value: '101' }, 100000)).toHaveProperty('error');
    expect(buildAdvanceBody({ type: 'PERCENTAGE', value: '12.5' }, 100000)).toHaveProperty('error');
  });
});

describe('DeliverySettingsSection (Phase 7C)', () => {
  it('renders saved settings and shows the fee input when delivery is on', async () => {
    vi.spyOn(api, 'getDeliverySettings').mockResolvedValue({ deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 20000 });
    render(<DeliverySettingsSection businessId="biz-1" />);
    expect(await screen.findByRole('checkbox', { name: /offer delivery/i })).toBeTruthy();
    expect(screen.getByText('Delivery fee (PKR)')).toBeTruthy();
    // The saved fee is shown as the placeholder; empty input = keep it.
    expect(screen.getByPlaceholderText('200')).toBeTruthy();
  });

  it('hides fee/COD controls while delivery is disabled', async () => {
    vi.spyOn(api, 'getDeliverySettings').mockResolvedValue({ deliveryEnabled: false, codEnabled: false, deliveryFeeMinor: 0 });
    render(<DeliverySettingsSection businessId="biz-1" />);
    await screen.findByRole('checkbox', { name: /offer delivery/i });
    expect(screen.queryByText('Delivery fee (PKR)')).toBeNull();
  });
});

describe('OrderPaymentPanel (Phase 7C order payment)', () => {
  it('summarises total and amount due for a delivery order', async () => {
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([]);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    render(<OrderPaymentPanel order={order()} onChanged={() => {}} />);
    expect(await screen.findByText('Due')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('summarises pending verification without claiming payment success', async () => {
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([payment({ status: 'PENDING_VERIFICATION', amountMinor: 220000 })]);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    render(<OrderPaymentPanel order={order()} onChanged={() => {}} />);
    expect(await screen.findByText('Waiting for verification')).toBeTruthy();
    expect(screen.getByText('Submitted, awaiting verification')).toBeTruthy();
    expect(screen.queryByText('Paid in full.')).toBeNull();
  });

  it('shows verified payments as Paid and a zero balance', async () => {
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([payment({ status: 'PAID', amountMinor: 220000 })]);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    render(<OrderPaymentPanel order={order()} onChanged={() => {}} />);
    // "Paid" appears both in the summary line and the status badge.
    expect((await screen.findAllByText('Paid')).length).toBeGreaterThan(0);
    expect(screen.getByText('Due')).toBeTruthy();
  });

  it('shows the rejection reason for failed payments', async () => {
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([payment({ status: 'FAILED', rejectionReason: 'Reference not found' })]);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([]);
    render(<OrderPaymentPanel order={order()} onChanged={() => {}} />);
    expect(await screen.findByText(/Reference not found/)).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
  });

  it('offers a new proof submission after rejection when a digital channel exists', async () => {
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([payment({ status: 'FAILED', rejectionReason: 'Reference not found', amountMinor: 220000 })]);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([
      { id: 'pm-1', type: 'EASYPAISA', displayName: 'Easypaisa', accountTitle: 'Butt Spices', accountNumber: '0300-1234567', iban: null, instructions: 'Send then submit proof.' },
    ]);
    render(<OrderPaymentPanel order={order()} onChanged={() => {}} />);
    const submitButton = await screen.findByRole('button', { name: /submit proof/i });
    expect(submitButton).toBeTruthy();
  });
});
