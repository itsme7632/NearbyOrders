import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OwnerSubscriptionPaymentMethods } from './OwnerSubscriptionPaymentMethodsScreen.js';
import * as api from '../api.js';
import type { PaymentMethod } from '../api.js';

afterEach(cleanup);

const methods: PaymentMethod[] = [
  {
    id: 'm-easypaisa',
    name: 'Easypaisa',
    type: 'EASYPAISA',
    accountTitle: 'NearbyOrders',
    accountNumber: '03001234567',
    iban: null,
    instructions: 'Send to the number above and keep the receipt.',
    qrImageUrl: null,
    displayOrder: 0,
  },
  {
    id: 'm-bank',
    name: 'Bank Transfer',
    type: 'BANK_TRANSFER',
    accountTitle: 'Nearby Labs',
    accountNumber: '1234567890',
    iban: 'PK00BANK1234567890',
    instructions: null,
    qrImageUrl: null,
    displayOrder: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, 'listPaymentMethods').mockResolvedValue(methods);
});

describe('OwnerSubscriptionPaymentMethods', () => {
  it('renders the admin-configured methods with title, account title, number, and instructions', async () => {
    render(<OwnerSubscriptionPaymentMethods />);
    expect(await screen.findByText('Easypaisa')).toBeTruthy();
    expect(screen.getByText('Bank Transfer')).toBeTruthy();
    expect(screen.getByText('03001234567')).toBeTruthy();
    expect(screen.getByText('NearbyOrders')).toBeTruthy();
    expect(screen.getByText('PK00BANK1234567890')).toBeTruthy();
    expect(screen.getByText('Send to the number above and keep the receipt.')).toBeTruthy();
    expect(api.listPaymentMethods).toHaveBeenCalledTimes(1);
  });

  it('shows the honest pay-then-submit line', async () => {
    render(<OwnerSubscriptionPaymentMethods />);
    expect(
      await screen.findByText('Send your payment using one of the methods below, then submit your payment proof.'),
    ).toBeTruthy();
  });

  it('renders nothing else: no submission form and no history', async () => {
    render(<OwnerSubscriptionPaymentMethods />);
    await screen.findByText('Easypaisa');
    expect(screen.queryByPlaceholderText('e.g. TX-123456789')).toBeNull();
    expect(screen.queryByText('Transaction reference')).toBeNull();
    expect(screen.queryByText('Payment history')).toBeNull();
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
  });

  it('shows an honest empty state when no methods are configured', async () => {
    vi.spyOn(api, 'listPaymentMethods').mockResolvedValue([]);
    render(<OwnerSubscriptionPaymentMethods />);
    expect(await screen.findByText('No payment methods are available right now. Please try again later.')).toBeTruthy();
  });
});
