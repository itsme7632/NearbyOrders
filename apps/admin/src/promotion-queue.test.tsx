// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AdminPromotionPayment, AdminPromotionRequest } from './api.js';

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
  approvePromotionRequest: vi.fn(),
  rejectPromotionRequest: vi.fn(),
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

const owner = { id: 'u1', email: 'owner@example.com', firstName: 'Ali', lastName: 'Khan' };

const paidPromotion = {
  id: 'pr1',
  name: 'Ramadan Spotlight',
  slug: 'ramadan-spotlight',
  priceMinor: 499900,
  currency: 'PKR',
  durationDays: 30,
};

const request = (patch: Partial<AdminPromotionRequest> = {}): AdminPromotionRequest => ({
  id: 'rq1',
  status: 'APPROVED',
  note: 'Please feature us for the festival.',
  reviewerMessage: 'Looks good.',
  reviewedByUserId: 'admin1',
  createdAt: '2026-09-20T10:00:00.000Z',
  reviewedAt: '2026-09-21T10:00:00.000Z',
  activatedAt: null,
  expiresAt: null,
  paymentStatus: 'PENDING',
  business: { id: 'b1', name: 'Cafe Aroma', slug: 'cafe-aroma', owner },
  promotion: paidPromotion,
  payments: [{ id: 'pay1', status: 'PENDING', amountMinor: 499900, submittedAt: '2026-09-21T12:00:00.000Z' }],
  ...patch,
});

const payment: AdminPromotionPayment = {
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
  promotion: { id: 'pr1', name: 'Ramadan Spotlight', slug: 'ramadan-spotlight' },
  paymentMethod: { id: 'pm1', name: 'Easypaisa main', type: 'EASYPAISA' },
};

async function openQueueTab() {
  const api = await import('./api.js');
  vi.mocked(api.listPromotions).mockResolvedValue([]);
  const { PromotionCenter } = await import('./sections.js');
  const c = await renderInto(<PromotionCenter />);
  const queueTab = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Requests queue')!;
  await act(async () => {
    queueTab.click();
  });
  await flush();
  return c;
}

async function expandDetails(c: HTMLDivElement) {
  const api = await import('./api.js');
  vi.mocked(api.getPromotionPaymentRequest).mockResolvedValue(payment);
  const detailsBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Details')!;
  await act(async () => {
    detailsBtn.click();
  });
  await flush();
}

describe('promotion request queue lifecycle', () => {
  it('renders the lifecycle columns, all status filters, and active/expires info', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotionRequests).mockResolvedValue([
      request(),
      request({
        id: 'rq2',
        status: 'ACTIVE',
        paymentStatus: 'APPROVED',
        activatedAt: '2026-09-22T10:00:00.000Z',
        expiresAt: '2026-10-22T10:00:00.000Z',
        payments: [],
      }),
      request({ id: 'rq3', status: 'PENDING', paymentStatus: null, promotion: { ...paidPromotion, priceMinor: 0, name: 'Free Boost' }, payments: [] }),
    ]);
    const c = await openQueueTab();

    for (const h of ['Requested', 'Business', 'Promotion', 'Price', 'Applied', 'Application status', 'Payment status', 'Promotion status', 'Actions']) {
      expect(c.querySelectorAll('th')).toSatisfy((ths) => Array.from(ths as unknown as Element[]).some((th) => th.textContent === h));
    }

    const select = c.querySelector('select[aria-label="Filter promotion requests by status"]') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(
      expect.arrayContaining(['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
    );

    expect(c.textContent).toContain('Free');
    expect(c.textContent).toContain('Active');
    expect(c.textContent).toContain('until');
    expect(c.textContent).toContain('owner@example.com');
    // The application note only appears once the detail row is expanded.
    expect(c.textContent).not.toContain('Please feature us for the festival.');
  });

  it('approves a pending promotion payment from the detail view', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotionRequests).mockResolvedValue([request()]);
    vi.mocked(api.approvePromotionPayment).mockResolvedValue({ ...payment, status: 'APPROVED' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = await openQueueTab();
    await expandDetails(c);

    expect(c.textContent).toContain('TRX-2026-001');
    expect(c.textContent).toContain('Easypaisa main');
    expect(c.textContent).toContain('Sent via Easypaisa.');

    const approveBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Approve payment')!;
    await act(async () => {
      approveBtn.click();
    });
    await flush();
    expect(vi.mocked(api.approvePromotionPayment)).toHaveBeenCalledWith('pay1');
  });

  it('rejects a promotion payment with a required reason', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotionRequests).mockResolvedValue([request()]);
    vi.mocked(api.rejectPromotionPayment).mockResolvedValue({ ...payment, status: 'REJECTED', rejectionReason: 'Receipt is unreadable' });
    const c = await openQueueTab();
    await expandDetails(c);

    const rejectBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Reject payment')!;
    await act(async () => {
      rejectBtn.click();
    });
    await flush();

    const confirmBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Confirm rejection')! as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const reasonInput = c.querySelector('input[placeholder="Rejection reason (required)"]') as HTMLInputElement;
    await act(async () => {
      setNative(reasonInput, 'Receipt is unreadable');
    });
    expect(confirmBtn.disabled).toBe(false);
    await act(async () => {
      confirmBtn.click();
    });
    await flush();
    expect(vi.mocked(api.rejectPromotionPayment)).toHaveBeenCalledWith('pay1', 'Receipt is unreadable');
  });

  it('opens the receipt through the authorized receipt endpoint', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotionRequests).mockResolvedValue([request()]);
    vi.mocked(api.fetchReceiptObjectUrl).mockResolvedValue('blob:receipt');
    const c = await openQueueTab();
    await expandDetails(c);

    const receiptBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View receipt')!;
    await act(async () => {
      receiptBtn.click();
    });
    await flush();
    expect(vi.mocked(api.fetchReceiptObjectUrl)).toHaveBeenCalledWith('receipts/k1');
  });

  it('shows activated and expiry dates for active requests in the detail view', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotionRequests).mockResolvedValue([
      request({
        id: 'rq2',
        status: 'ACTIVE',
        paymentStatus: 'APPROVED',
        activatedAt: '2026-09-22T10:00:00.000Z',
        expiresAt: '2026-10-22T10:00:00.000Z',
        payments: [],
      }),
    ]);
    const c = await openQueueTab();
    const detailsBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Details')!;
    await act(async () => {
      detailsBtn.click();
    });
    await flush();
    expect(c.textContent).toContain('Activated');
    expect(c.textContent).toContain('Expires');
  });
});
