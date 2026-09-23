import { describe, expect, it } from 'vitest';
import { validatePaymentForm } from './OwnerSubscriptionShared.js';

/**
 * Pure unit coverage for the payment-proof validator shared by the
 * subscription and promotion payment flows. The validator only guards the
 * form before touching the network; the server re-validates everything.
 */
describe('validatePaymentForm', () => {
  const valid = { transactionReference: 'TX-123456789', hasReceipt: true };

  it('accepts a well-formed payment proof', () => {
    expect(validatePaymentForm(valid)).toBeNull();
    expect(validatePaymentForm({ ...valid, paidAt: '2026-09-20', note: 'Paid via Easypaisa.' })).toBeNull();
  });

  it('rejects a short or missing transaction reference', () => {
    expect(validatePaymentForm({ ...valid, transactionReference: '' })).toMatch(/at least 4 characters/);
    expect(validatePaymentForm({ ...valid, transactionReference: 'abc' })).toMatch(/at least 4 characters/);
    expect(validatePaymentForm({ ...valid, transactionReference: 'x'.repeat(101) })).toMatch(/at most 100 characters/);
  });

  it('requires a receipt photo', () => {
    expect(validatePaymentForm({ ...valid, hasReceipt: false })).toMatch(/photo of your payment receipt/);
  });

  it('rejects invalid or future payment dates', () => {
    expect(validatePaymentForm({ ...valid, paidAt: 'not-a-date' })).toMatch(/valid payment date/);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(validatePaymentForm({ ...valid, paidAt: tomorrow })).toMatch(/cannot be in the future/);
  });

  it('rejects an overlong note', () => {
    expect(validatePaymentForm({ ...valid, note: 'n'.repeat(501) })).toMatch(/at most 500 characters/);
  });
});
