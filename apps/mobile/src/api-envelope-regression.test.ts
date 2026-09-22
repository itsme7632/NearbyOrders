// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  setSession,
  listPaymentRequests,
  listPromotionRequests,
  getVerification,
  type PaymentRequest,
} from './api.js';

/**
 * Regression tests for the owner-screen wire-shape mismatches that blanked
 * screens in production:
 *
 * - GET /businesses/:id/subscription/payment-requests returns a PAGINATED
 *   envelope { data: { items: [...], nextCursor } }, NOT { data: [...] }.
 *   The client used to hand the envelope to the screen as PaymentRequest[],
 *   so `history.find(...)` threw during render and React unmounted the whole
 *   OwnerSubscription screen (blank white screen behind both "Manage plan"
 *   and "View payment history").
 * - GET /businesses/:id/verification returns the application object itself
 *   (documents nested), NOT { application, documents }.
 * - GET /businesses/:id/promotion-requests returns owner DTOs shaped as
 *   { promotion: { id, name, slug }, createdAt, reviewerMessage }, NOT
 *   { promotionId, promotionName, submittedAt, rejectionReason }.
 *
 * Every mock below uses the REAL server wire shape, so these tests fail if
 * the client ever stops normalizing it.
 */

const okJson = (payload: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(payload) });

beforeEach(() => {
  setSession({ accessToken: 'tok-owner', user: { id: 'u1', email: 'o@x.com', role: 'BUSINESS_OWNER' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

/**
 * One subscription payment request EXACTLY as the server's owner DTO sends
 * it: note there is NO planName and NO paymentMethodName on the wire.
 */
const wirePaymentItem = {
  id: 'pay-1',
  status: 'PENDING',
  amountMinor: 299900,
  currency: 'PKR',
  transactionReference: 'TX-REAL-1',
  receiptStorageKey: 'receipts/r.jpg',
  paidAt: null,
  note: null,
  rejectionReason: null,
  submittedAt: '2026-09-11T00:00:00.000Z',
  reviewedAt: null,
  subscriptionId: null,
  paymentMethod: { id: 'method-easypaisa', name: 'Easypaisa (Test)', type: 'EASYPAISA' },
};

describe('listPaymentRequests unwraps the server paginated envelope', () => {
  it('returns a real array from { data: { items, nextCursor } } so history.find cannot throw (blank-screen regression)', async () => {
    vi.stubGlobal('fetch', okJson({ data: { items: [wirePaymentItem], nextCursor: null } }));
    const history: PaymentRequest[] = await listPaymentRequests('biz-1');
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(1);
    // The exact call that threw "history.find is not a function" in production.
    expect(history.find((p) => p.status === 'PENDING')?.id).toBe('pay-1');
  });

  it('keeps only the items when the server sends a nextCursor page', async () => {
    vi.stubGlobal('fetch', okJson({ data: { items: [wirePaymentItem], nextCursor: 'pay-1' } }));
    const history = await listPaymentRequests('biz-1');
    expect(history).toEqual([expect.objectContaining({ id: 'pay-1' })]);
  });

  it('returns [] for an empty items page', async () => {
    vi.stubGlobal('fetch', okJson({ data: { items: [], nextCursor: null } }));
    await expect(listPaymentRequests('biz-1')).resolves.toEqual([]);
  });

  it('returns [] when the envelope body is missing', async () => {
    vi.stubGlobal('fetch', okJson({ data: null }));
    await expect(listPaymentRequests('biz-1')).resolves.toEqual([]);
  });
});

describe('listPromotionRequests normalizes the server owner DTO', () => {
  it('maps promotion.id/name, createdAt and reviewerMessage onto the client shape', async () => {
    vi.stubGlobal(
      'fetch',
      okJson({
        data: [
          {
            id: 'pr-1',
            status: 'REJECTED',
            note: null,
            reviewerMessage: 'Receipt was unreadable',
            createdAt: '2026-09-12T00:00:00.000Z',
            reviewedAt: '2026-09-13T00:00:00.000Z',
            promotion: { id: 'promo-1', name: 'Eid Boost', slug: 'eid-boost' },
          },
        ],
      }),
    );
    const [req] = await listPromotionRequests('biz-1');
    expect(req.promotionId).toBe('promo-1');
    expect(req.promotionName).toBe('Eid Boost');
    expect(req.submittedAt).toBe('2026-09-12T00:00:00.000Z');
    expect(req.rejectionReason).toBe('Receipt was unreadable');
    expect(req.status).toBe('REJECTED');
  });
});

describe('getVerification normalizes the server application-object response', () => {
  /**
   * The application EXACTLY as GET /businesses/:id/verification sends it:
   * the application object itself (documents nested) — there is no
   * { application, documents } wrapper on the wire.
   */
  const wireApplication = {
    id: 'app-1',
    status: 'DRAFT',
    legalName: 'Acme Foods',
    publicName: null,
    ownerName: 'Ali',
    phone: '03000000000',
    address: null,
    city: 'Lahore',
    categoryId: null,
    description: null,
    latitude: null,
    longitude: null,
    registrationInfo: null,
    reviewerMessage: null,
    submittedAt: null,
    reviewedAt: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    documents: [{ id: 'doc-1', docType: 'ID_PROOF', status: 'PENDING', uploadedAt: '2026-09-10T00:00:00.000Z' }],
  };

  it('exposes the application and its nested documents as { application, documents }', async () => {
    vi.stubGlobal('fetch', okJson({ data: wireApplication }));
    const state = await getVerification('biz-1');
    expect(state.application?.id).toBe('app-1');
    expect(state.application?.legalName).toBe('Acme Foods');
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0].docType).toBe('ID_PROOF');
  });

  it('returns an empty state when the server has no application (data: null)', async () => {
    vi.stubGlobal('fetch', okJson({ data: null }));
    const state = await getVerification('biz-1');
    expect(state.application).toBeNull();
    expect(state.documents).toEqual([]);
  });
});
