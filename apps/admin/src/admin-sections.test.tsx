// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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
  listSubscriptionPlans: vi.fn(),
  createSubscriptionPlan: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
  deleteSubscriptionPlan: vi.fn(),
  listPaymentMethods: vi.fn(),
  createPaymentMethod: vi.fn(),
  updatePaymentMethod: vi.fn(),
  deletePaymentMethod: vi.fn(),
  listVerifications: vi.fn(),
  getVerification: vi.fn(),
  approveVerification: vi.fn(),
  rejectVerification: vi.fn(),
  requestVerificationChanges: vi.fn(),
  listPromotions: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
  listPromotionRequests: vi.fn(),
  approvePromotionRequest: vi.fn(),
  rejectPromotionRequest: vi.fn(),
  listBusinesses: vi.fn(),
  listPaymentRequests: vi.fn(),
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

const plan = (patch: Record<string, unknown> = {}) => ({
  id: 'plan1',
  slug: 'business-plus',
  name: 'Business Plus',
  description: 'More visibility',
  monthlyPriceMinor: 299900,
  currency: 'PKR',
  trialDays: 14,
  billingInterval: 'MONTHLY',
  benefits: ['Unlimited products', 'Priority placement', 'Support'],
  displayOrder: 1,
  isHighlighted: true,
  isActive: true,
  usageCount: 3,
  ...patch,
});

const flush = () => act(async () => {});

describe('admin subscription plans', () => {
  it('renders the plans table with usage counts and live-copy notice', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listSubscriptionPlans).mockResolvedValue([plan()]);
    const { SubscriptionPlans } = await import('./sections.js');
    const c = await renderInto(<SubscriptionPlans />);
    expect(c.textContent).toContain('Business Plus');
    expect(c.textContent).toContain('business-plus');
    expect(c.textContent).toContain('reads these plans live');
    expect(c.textContent).toContain('3');
    expect(c.textContent).toContain('Featured');
  });

  it('creates a plan from the dialog, converting rupees to minor units', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listSubscriptionPlans).mockResolvedValue([]);
    vi.mocked(api.createSubscriptionPlan).mockResolvedValue(plan({ id: 'plan2', name: 'Starter' }));
    const { SubscriptionPlans } = await import('./sections.js');
    const c = await renderInto(<SubscriptionPlans />);
    await flush();

    const newBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'New plan')!;
    await act(async () => {
      newBtn.click();
    });

    const nameInput = c.querySelector('input[placeholder="Business Plus"]') as HTMLInputElement;
    const priceInput = c.querySelector('input[placeholder="2999"]') as HTMLInputElement;
    const benefitsBox = c.querySelector('textarea[placeholder*="Unlimited products"]') as HTMLTextAreaElement;
    // Controlled inputs: set through the native setter so React's onChange fires.
    const setNative = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
      const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      setNative(nameInput, 'Starter');
      setNative(priceInput, '999');
      setNative(benefitsBox, 'Line one\nLine two');
    });

    const form = c.querySelector('.modal-card form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(vi.mocked(api.createSubscriptionPlan)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Starter',
        monthlyPriceMinor: 99900,
        benefits: ['Line one', 'Line two'],
        isActive: true,
      }),
    );
  });

  it('shows deactivate-instead guidance when delete hits PLAN_IN_USE', async () => {
    const api = await import('./api.js');
    const { ApiError } = await import('./api.js');
    vi.mocked(api.listSubscriptionPlans).mockResolvedValue([plan()]);
    vi.mocked(api.deleteSubscriptionPlan).mockRejectedValue(new ApiError(409, 'PLAN_IN_USE', 'Plan in use'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { SubscriptionPlans } = await import('./sections.js');
    const c = await renderInto(<SubscriptionPlans />);
    await flush();

    const delBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!;
    await act(async () => {
      delBtn.click();
    });
    await flush();
    expect(c.textContent).toContain('Deactivate it instead');
    expect(c.textContent).toContain('3 businesses are on this plan');
  });
});

describe('admin payment methods', () => {
  const method = {
    id: 'pm1',
    name: 'Easypaisa main',
    type: 'EASYPAISA' as const,
    accountTitle: 'NearbyOrders Pvt Ltd',
    accountNumber: '0345 1234567',
    iban: null,
    instructions: 'Send the exact amount, then upload the receipt.',
    qrImageUrl: null,
    isActive: true,
    displayOrder: 0,
    usageCount: 5,
  };

  it('renders methods with account details and the no-developer copy', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPaymentMethods).mockResolvedValue([method]);
    const { PaymentMethods } = await import('./sections.js');
    const c = await renderInto(<PaymentMethods />);
    expect(c.textContent).toContain('Easypaisa main');
    expect(c.textContent).toContain('0345 1234567');
    expect(c.textContent).toContain('no developer needed');
  });

  it('creates a method through the dialog', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPaymentMethods).mockResolvedValue([]);
    vi.mocked(api.createPaymentMethod).mockResolvedValue({ ...method, id: 'pm2', name: 'JazzCash backup' });
    const { PaymentMethods } = await import('./sections.js');
    const c = await renderInto(<PaymentMethods />);
    await flush();

    const newBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'New payment method')!;
    await act(async () => {
      newBtn.click();
    });
    const nameInput = c.querySelector('input[placeholder="Easypaisa (business account)"]') as HTMLInputElement;
    const setNative = (el: HTMLInputElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      setNative(nameInput, 'JazzCash backup');
    });
    const form = c.querySelector('.modal-card form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(vi.mocked(api.createPaymentMethod)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'JazzCash backup', type: 'EASYPAISA', isActive: true }),
    );
  });
});

describe('admin verification review', () => {
  // Mirrors the server's adminVerification() output: the detail endpoint
  // returns { data: <this row> } with business and documents nested.
  const application = {
    id: 'v1',
    status: 'SUBMITTED' as const,
    legalName: 'Cafe Aroma LLC',
    publicName: 'Cafe Aroma',
    ownerName: 'Ali Khan',
    phone: '03001234567',
    address: 'Main Blvd',
    city: 'Lahore',
    categoryId: null,
    description: 'Cozy cafe',
    latitude: null,
    longitude: null,
    registrationInfo: null,
    reviewerMessage: null,
    adminNotes: null,
    reviewedByUserId: null,
    submittedAt: '2026-09-20T10:00:00.000Z',
    reviewedAt: null,
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    business: {
      id: 'b1',
      name: 'Cafe Aroma',
      slug: 'cafe-aroma',
      owner: { id: 'u1', email: 'owner@example.com', firstName: 'Ali', lastName: 'Khan' },
    },
    documents: [
      { id: 'd1', docType: 'TRADE_LICENSE', storageKey: 'docs/k1', status: 'PENDING', uploadedAt: '2026-09-20T10:00:00.000Z' },
    ],
  };

  it('lists applications and approves from the detail modal', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listVerifications).mockResolvedValue([application]);
    vi.mocked(api.getVerification).mockResolvedValue(application);
    vi.mocked(api.approveVerification).mockResolvedValue({ ...application, status: 'APPROVED' });
    const { VerificationReview } = await import('./sections.js');
    const c = await renderInto(<VerificationReview />);
    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('owner@example.com');
    expect(c.textContent).toContain('SUBMITTED');

    const reviewBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Review')!;
    await act(async () => {
      reviewBtn.click();
    });
    await flush();
    expect(c.textContent).toContain('TRADE LICENSE');
    expect(c.textContent).toContain('Cozy cafe');
    expect(c.textContent).toContain('verified badge');

    const approveBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Approve verification')!;
    await act(async () => {
      approveBtn.click();
    });
    await flush();
    expect(vi.mocked(api.approveVerification)).toHaveBeenCalledWith('v1', expect.objectContaining({}));
  });

  it('requires a reviewer message for rejection', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listVerifications).mockResolvedValue([application]);
    vi.mocked(api.getVerification).mockResolvedValue({ ...application, documents: [] });
    const { VerificationReview } = await import('./sections.js');
    const c = await renderInto(<VerificationReview />);
    const reviewBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Review')!;
    await act(async () => {
      reviewBtn.click();
    });
    await flush();

    const rejectBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Reject')!;
    await act(async () => {
      rejectBtn.click();
    });
    await flush();
    expect(vi.mocked(api.rejectVerification)).not.toHaveBeenCalled();
    expect(c.textContent).toContain('reviewer message is required');
  });
});

describe('admin promotions', () => {
  const promo = {
    id: 'pr1',
    slug: 'ramadan-spotlight',
    name: 'Ramadan Spotlight',
    description: 'Banner placement',
    benefits: ['Homepage banner', 'Social mention'],
    priceMinor: 499900,
    currency: 'PKR',
    durationDays: 30,
    requirements: 'Active subscription',
    isActive: true,
    displayOrder: 0,
    requestCount: 2,
  };

  const promoRequest = {
    id: 'rq1',
    status: 'PENDING' as const,
    note: 'Feature us for the festival weekend.',
    reviewerMessage: null,
    reviewedByUserId: null,
    createdAt: '2026-09-21T10:00:00.000Z',
    reviewedAt: null,
    activatedAt: null,
    expiresAt: null,
    paymentStatus: null as 'PENDING' | 'APPROVED' | 'REJECTED' | null,
    business: {
      id: 'b1',
      name: 'Cafe Aroma',
      slug: 'cafe-aroma',
      owner: { id: 'u1', email: 'owner@example.com', firstName: 'Ali', lastName: 'Khan' },
    },
    promotion: {
      id: 'pr1',
      name: 'Ramadan Spotlight',
      slug: 'ramadan-spotlight',
      priceMinor: 499900,
      currency: 'PKR',
      durationDays: 30,
    },
    payments: [] as Array<{ id: string; status: string; amountMinor: number; submittedAt: string }>,
  };

  it('renders the catalog and the requests queue with approve/reject', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotions).mockResolvedValue([promo]);
    vi.mocked(api.listPromotionRequests).mockResolvedValue([promoRequest]);
    vi.mocked(api.approvePromotionRequest).mockResolvedValue({
      ...promoRequest,
      status: 'APPROVED',
      reviewedAt: '2026-09-22T10:00:00.000Z',
    });
    const { PromotionCenter } = await import('./sections.js');
    const c = await renderInto(<PromotionCenter />);
    expect(c.textContent).toContain('Ramadan Spotlight');
    expect(c.textContent).toContain('30 days');

    const queueTab = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Requests queue')!;
    await act(async () => {
      queueTab.click();
    });
    await flush();
    expect(c.textContent).toContain('Cafe Aroma');

    const decideBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Decide')!;
    await act(async () => {
      decideBtn.click();
    });
    // Paid promotions wait for the owner's payment after approval.
    expect(c.textContent).toContain('the owner must pay before the promotion goes live');
    const confirmBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Confirm approval')!;
    await act(async () => {
      confirmBtn.click();
    });
    await flush();
    expect(vi.mocked(api.approvePromotionRequest)).toHaveBeenCalledWith('rq1', undefined);
  });

  it('shows the free-promotion activation message for free promotions', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotions).mockResolvedValue([]);
    vi.mocked(api.listPromotionRequests).mockResolvedValue([
      { ...promoRequest, id: 'rq2', promotion: { ...promoRequest.promotion, priceMinor: 0, name: 'Free Boost' } },
    ]);
    const { PromotionCenter } = await import('./sections.js');
    const c = await renderInto(<PromotionCenter />);
    const queueTab = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Requests queue')!;
    await act(async () => {
      queueTab.click();
    });
    await flush();

    expect(c.textContent).toContain('Free');
    const decideBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Decide')!;
    await act(async () => {
      decideBtn.click();
    });
    expect(c.textContent).toContain('Approving activates this free promotion immediately');
  });
});

describe('admin business review', () => {
  const business = {
    id: 'b1',
    name: 'Cafe Aroma',
    slug: 'cafe-aroma',
    status: 'PENDING' as const,
    isVerified: false,
    city: 'Lahore',
    address: 'Main Blvd 12',
    createdAt: '2026-09-19T10:00:00.000Z',
    owner: { id: 'u1', email: 'owner@example.com', firstName: 'Ali', lastName: 'Khan' },
    categories: [{ id: 'c1', name: 'Food & Drink', slug: 'food-drink' }],
    imageUrl: null,
    verificationStatus: 'SUBMITTED' as const,
    verificationApplicationId: 'v1',
    trialStatus: 'ELIGIBLE',
    subscriptionStatus: null,
    counts: { orders: 4, bookings: 2, services: 3, products: 9, reviews: 5 },
  };

  it('renders review columns and opens the detail drawer with a payment-history link', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listBusinesses).mockResolvedValue([business]);
    const { Businesses } = await import('./main.js');
    const onOpenPayments = vi.fn();
    const c = await renderInto(<Businesses onOpenPayments={onOpenPayments} />);
    await flush();

    expect(vi.mocked(api.listBusinesses)).toHaveBeenCalledWith({ status: undefined, q: undefined, verificationStatus: undefined });
    expect(c.textContent).toContain('Food & Drink');
    expect(c.textContent).toContain('Lahore');
    expect(c.textContent).toContain('Eligible');

    const reviewBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Review')!;
    await act(async () => {
      reviewBtn.click();
    });
    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('Main Blvd 12');
    expect(c.textContent).toContain('View payment history');

    const payBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'View payment history')!;
    await act(async () => {
      payBtn.click();
    });
    expect(onOpenPayments).toHaveBeenCalledWith('b1');
  });

  it('filters by verification status', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listBusinesses).mockResolvedValue([]);
    const { Businesses } = await import('./main.js');
    const c = await renderInto(<Businesses onOpenPayments={vi.fn()} />);
    await flush();

    const select = c.querySelector('select[aria-label="Verification status"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'UNDER_REVIEW';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(vi.mocked(api.listBusinesses)).toHaveBeenLastCalledWith({ status: undefined, q: undefined, verificationStatus: 'UNDER_REVIEW' });
  });
});
