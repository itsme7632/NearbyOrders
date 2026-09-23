// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AdminPromotionPayment } from './api.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  listPromotions: vi.fn(),
  listPromotionRequests: vi.fn(),
  listPromotionPaymentRequests: vi.fn(),
  getPromotionPaymentRequest: vi.fn(),
  approvePromotionPayment: vi.fn(),
  rejectPromotionPayment: vi.fn(),
  fetchReceiptObjectUrl: vi.fn(),
}));

async function renderInto(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

const flush = () => act(async () => {});

const setNative = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const clickText = async (c: HTMLDivElement, text: string) => {
  const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  await act(async () => {
    btn.click();
  });
  await flush();
};

const payment = (patch: Partial<AdminPromotionPayment> = {}): AdminPromotionPayment => ({
  id: 'pay1',
  status: 'PENDING',
  amountMinor: 499900,
  currency: 'PKR',
  transactionReference: 'TRX-2026-001',
  receiptStorageKey: 'receipts/k1',
  paidAt: '2026-09-21T11:00:00.000Z',
  note: 'Sent via Easypaisa.',
  rejectionReason: null,
  submittedAt: '2026-09-21T12:00:00.000Z',
  reviewedAt: null,
  reviewedByUserId: null,
  business: { id: 'b1', name: 'Cafe Aroma' },
  promotionRequest: { id: 'rq1' },
  promotion: { id: 'pr1', name: 'Ramadan Spotlight', slug: 'ramadan-spotlight', priceMinor: 499900, durationDays: 30 },
  paymentMethod: { id: 'pm1', name: 'Easypaisa main', type: 'EASYPAISA' },
  ...patch,
});

async function openPaymentsTab(items: AdminPromotionPayment[] = []) {
  const api = await import('./api.js');
  vi.mocked(api.listPromotions).mockResolvedValue([]);
  vi.mocked(api.listPromotionRequests).mockResolvedValue([]);
  vi.mocked(api.listPromotionPaymentRequests).mockResolvedValue({ items, nextCursor: null });
  const { PromotionCenter } = await import('./promotion-center.js');
  const c = await renderInto(<PromotionCenter />);
  await clickText(c, 'Payments');
  return c;
}

describe('promotion payments tab', () => {
  it('lists payments with business, promotion, amount, method, reference, submitted date, and status', async () => {
    const api = await import('./api.js');
    const c = await openPaymentsTab([payment()]);

    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('Ramadan Spotlight');
    expect(c.textContent).toContain('Easypaisa main');
    expect(c.textContent).toContain('TRX-2026-001');
    for (const h of ['Business', 'Promotion', 'Amount', 'Method', 'Reference', 'Submitted', 'Status']) {
      expect(c.querySelectorAll('th')).toSatisfy((ths) => Array.from(ths as unknown as Element[]).some((th) => th.textContent === h));
    }
  });

  it('filters by Pending review / Approved / Rejected', async () => {
    const api = await import('./api.js');
    const c = await openPaymentsTab();
    expect(vi.mocked(api.listPromotionPaymentRequests)).toHaveBeenCalledWith({ status: 'PENDING' });

    vi.mocked(api.listPromotionPaymentRequests).mockClear();
    await clickText(c, 'Approved');
    expect(vi.mocked(api.listPromotionPaymentRequests)).toHaveBeenCalledWith({ status: 'APPROVED' });

    vi.mocked(api.listPromotionPaymentRequests).mockClear();
    await clickText(c, 'Rejected');
    expect(vi.mocked(api.listPromotionPaymentRequests)).toHaveBeenCalledWith({ status: 'REJECTED' });

    vi.mocked(api.listPromotionPaymentRequests).mockClear();
    await clickText(c, 'All');
    expect(vi.mocked(api.listPromotionPaymentRequests)).toHaveBeenCalledWith({ status: undefined });
  });

  it('opens the review drawer with full payment context and amount-vs-catalog comparison', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment());
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');

    expect(vi.mocked(api.getPromotionPaymentRequest)).toHaveBeenCalledWith('pay1');
    const drawer = c.querySelector('.drawer');
    expect(drawer).toBeTruthy();
    expect(drawer!.textContent).toContain('Cafe Aroma');
    expect(drawer!.textContent).toContain('Ramadan Spotlight');
    expect(drawer!.textContent).toContain('TRX-2026-001');
    expect(drawer!.textContent).toContain('Easypaisa main');
    expect(drawer!.textContent).toContain('Sent via Easypaisa.');
    // Amount matches the catalog price, so the reviewer sees the confirmation.
    expect(drawer!.textContent).toContain('Matches the catalog price.');
  });

  it('warns when the paid amount does not match the catalog price', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment({ amountMinor: 400000 }));
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');

    const drawer = c.querySelector('.drawer');
    expect(drawer!.textContent).toContain('Does not match the catalog price');
  });

  it('approves the payment after confirmation and reloads the list', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment());
    vi.mocked(api.approvePromotionPayment).mockResolvedValue(payment({ status: 'APPROVED' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');
    await clickText(c, 'Approve payment');

    expect(window.confirm).toHaveBeenCalled();
    expect(vi.mocked(api.approvePromotionPayment)).toHaveBeenCalledWith('pay1');
    // List reloads after the decision.
    expect(vi.mocked(api.listPromotionPaymentRequests).mock.calls.length).toBeGreaterThan(1);
    expect(c.querySelector('.drawer')).toBeNull();
  });

  it('does not approve when the confirmation is dismissed', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');
    await clickText(c, 'Approve payment');

    expect(vi.mocked(api.approvePromotionPayment)).not.toHaveBeenCalled();
  });

  it('rejects the payment with a required reason', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment());
    vi.mocked(api.rejectPromotionPayment).mockResolvedValue(payment({ status: 'REJECTED', rejectionReason: 'Amount does not match invoice' }));
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');
    await clickText(c, 'Reject payment');

    const reasonInput = c.querySelector('input[aria-label="Payment rejection reason"]') as HTMLInputElement;
    expect(reasonInput).toBeTruthy();
    await act(async () => {
      setNative(reasonInput, 'Amount does not match invoice');
    });
    await flush();
    await clickText(c, 'Confirm rejection');

    expect(vi.mocked(api.rejectPromotionPayment)).toHaveBeenCalledWith('pay1', 'Amount does not match invoice');
  });

  it('opens the receipt through the authorized receipt endpoint', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment());
    vi.mocked(api.fetchReceiptObjectUrl).mockResolvedValue('blob:receipt-1');
    const c = await openPaymentsTab([payment()]);
    await clickText(c, 'Review');
    await clickText(c, 'View receipt');

    expect(vi.mocked(api.fetchReceiptObjectUrl)).toHaveBeenCalledWith('receipts/k1');
    const img = c.querySelector('img.receipt-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('blob:receipt-1');
  });
});
