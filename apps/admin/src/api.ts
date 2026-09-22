export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Role = 'CUSTOMER' | 'BUSINESS_OWNER' | 'ADMIN';

export type Session = { accessToken: string; user: { id: string; email: string; role: string } };

const TOKEN_KEY = 'nearbyorders.admin.token';

export function getSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(next: Session | null): void {
  try {
    if (next) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lives for this page only */
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.authorization = `Bearer ${session.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401) setSession(null);
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Request failed');
  }
  return payload as T;
}

/* -------------------------------- auth -------------------------------- */

export const login = (email: string, password: string) =>
  request<{ data: Session }>('/auth/login', { method: 'POST', body: { email, password } }).then((r) => {
    if (r.data.user.role !== 'ADMIN') throw new ApiError(403, 'NOT_ADMIN', 'This account is not an administrator.');
    setSession(r.data);
    return r.data;
  });

export const logout = () => setSession(null);

/* ------------------------------ dashboard ----------------------------- */

export type AdminDashboard = {
  users: number;
  customers: number;
  businessOwners: number;
  businesses: number;
  activeBusinesses: number;
  pendingBusinesses: number;
  suspendedBusinesses: number;
  bookings: number;
  pendingBookings: number;
  orders: number;
  pendingOrders: number;
  pendingSubscriptionPayments: number;
  reviews: number;
  hiddenReviews: number;
  pushDevices: { total: number; active: number; android: number; ios: number; web: number };
};

export const getDashboard = () => request<{ data: AdminDashboard }>('/admin/dashboard').then((r) => r.data);

/* -------------------------------- users ------------------------------- */

export type AdminUser = {
  id: string;
  email: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isSuspended: boolean;
  createdAt: string;
  counts?: { businesses: number; bookings: number; orders: number; reviews: number };
};

export const listUsers = (q: string) => request<{ data: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.data);
export const getUser = (id: string) => request<{ data: AdminUser }>(`/admin/users/${id}`).then((r) => r.data);
export const setUserSuspended = (id: string, suspended: boolean) =>
  request<{ data: AdminUser }>(`/admin/users/${id}/suspension`, { method: 'PATCH', body: { suspended } }).then((r) => r.data);

/* ------------------------------ businesses ---------------------------- */

export type AdminBusiness = {
  id: string;
  name: string;
  slug: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'ARCHIVED';
  isVerified: boolean;
  city: string;
  address: string;
  createdAt: string;
  owner: { id: string; email: string; firstName: string | null; lastName: string | null };
  category?: { id: string; name: string } | null;
  /** Verification application lifecycle; null when the owner never applied. */
  verificationStatus?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | null;
  /** Id of the latest verification application, when one exists. */
  verificationApplicationId?: string | null;
  trialStatus?: string;
  subscriptionStatus?: string | null;
  /** Phase 16 operational activity: real aggregates from the server. */
  counts: { orders: number; bookings: number; services: number; products: number; reviews: number };
};

export type BusinessListParams = { q?: string; status?: string; verificationStatus?: string };

export const listBusinesses = (params: BusinessListParams) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.verificationStatus) search.set('verificationStatus', params.verificationStatus);
  return request<{ data: AdminBusiness[] }>(`/admin/businesses?${search}`).then((r) => r.data);
};

export const setBusinessStatus = (id: string, status: AdminBusiness['status']) =>
  request<{ data: AdminBusiness }>(`/admin/businesses/${id}/status`, { method: 'PATCH', body: { status } }).then((r) => r.data);
export const setBusinessVerified = (id: string, verified: boolean) =>
  request<{ data: { id: string; isVerified: boolean } }>(`/admin/businesses/${id}/verification`, { method: 'PATCH', body: { verified } }).then((r) => r.data);

/* ---------------------------- orders/bookings -------------------------- */

export type AdminOrder = {
  id: string;
  status: string;
  subtotalMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  business: { id: string; name: string };
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
};

export const listOrders = (status: string) =>
  request<{ data: AdminOrder[] }>(`/admin/orders${status ? `?status=${status}` : ''}`).then((r) => r.data);

export type AdminBooking = {
  id: string;
  status: string;
  bookingDate: string;
  startAt: string;
  amountDueMinor: number | null;
  amountPaidMinor: number;
  currency: string;
  createdAt: string;
  business: { id: string; name: string };
  service: { id: string; name: string } | null;
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
};

export const listBookings = (status: string) =>
  request<{ data: AdminBooking[] }>(`/admin/bookings${status ? `?status=${status}` : ''}`).then((r) => r.data);

/* ------------------------------- reviews ------------------------------ */

export type AdminReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  isHidden: boolean;
  hiddenAt: string | null;
  business: { id: string; name: string };
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
};

export const listReviews = (status: '' | 'visible' | 'hidden') =>
  request<{ data: AdminReview[] }>(`/admin/reviews${status ? `?status=${status}` : ''}`).then((r) => r.data);

/** Soft-moderation: hides/restores a review from every public surface. */
export const setReviewVisibility = (id: string, hidden: boolean) =>
  request<{ data: { id: string; isHidden: boolean } }>(`/admin/reviews/${id}/visibility`, { method: 'PATCH', body: { hidden } }).then((r) => r.data);

/* ------------------------------ categories ----------------------------- */

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  businessCount: number;
};

export const listCategories = () => request<{ data: AdminCategory[] }>('/admin/categories').then((r) => r.data);

export const createCategory = (name: string) =>
  request<{ data: AdminCategory }>('/admin/categories', { method: 'POST', body: { name } }).then((r) => r.data);

export const setCategoryActive = (id: string, isActive: boolean) =>
  request<{ data: AdminCategory }>(`/admin/categories/${id}`, { method: 'PATCH', body: { isActive } }).then((r) => r.data);

/* ----------------------------- subscriptions -------------------------- */

export type AdminSubscription = {
  id: string;
  status: string;
  currentPeriodEndAt: string;
  createdAt: string;
  business: { id: string; name: string };
  plan: { id: string; name: string; monthlyPriceMinor: number; currency: string } | null;
};

export const listSubscriptions = (status: string) =>
  request<{ data: AdminSubscription[] }>(`/admin/subscriptions${status ? `?status=${status}` : ''}`).then((r) => r.data);

export type AdminPaymentRequest = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  transactionReference: string | null;
  receiptStorageKey: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  business: { id: string; name: string };
  plan?: { id: string; name: string } | null;
  paymentMethod?: { id: string; name: string; type: string } | null;
  paidAt?: string | null;
  note?: string | null;
  reviewer?: { id: string; email: string } | null;
};

export type PaymentRequestListParams = {
  status?: string;
  businessId?: string;
  q?: string;
  planId?: string;
  paymentMethodId?: string;
  from?: string;
  to?: string;
};

export const listPaymentRequests = (params: PaymentRequestListParams) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return request<{ data: { items: AdminPaymentRequest[] } }>(`/admin/subscription/payment-requests${qs ? `?${qs}` : ''}`).then(
    (r) => r.data.items,
  );
};

export const approvePaymentRequest = (id: string) =>
  request<{ data: AdminPaymentRequest }>(`/admin/subscription/payment-requests/${id}/approve`, { method: 'POST', body: {} }).then((r) => r.data);

export const rejectPaymentRequest = (id: string, reason: string) =>
  request<{ data: AdminPaymentRequest }>(`/admin/subscription/payment-requests/${id}/reject`, { method: 'POST', body: { reason } }).then((r) => r.data);

/* ------------------------------ audit log ----------------------------- */

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string; role: string } | null;
};

export const listAuditLog = (action: string) =>
  request<{ data: AuditEntry[] }>(`/admin/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`).then((r) => r.data);

/* ----------------------- subscription plans (live) --------------------- */
/* The mobile app reads these values live: creating, editing or deactivating
   a plan here changes what business owners see immediately. */

export type AdminSubscriptionPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  currency: string;
  trialDays: number;
  billingInterval: string;
  benefits: string[];
  displayOrder: number;
  isHighlighted: boolean;
  isActive: boolean;
  usageCount: number;
};

export type SubscriptionPlanInput = {
  name: string;
  slug?: string;
  description?: string | null;
  monthlyPriceMinor: number;
  currency?: string;
  trialDays: number;
  billingInterval: string;
  benefits: string[];
  displayOrder: number;
  isHighlighted: boolean;
  isActive: boolean;
};

export const listSubscriptionPlans = () => request<{ data: AdminSubscriptionPlan[] }>('/admin/subscription/plans').then((r) => r.data);

export const createSubscriptionPlan = (input: SubscriptionPlanInput) =>
  request<{ data: AdminSubscriptionPlan }>('/admin/subscription/plans', { method: 'POST', body: input }).then((r) => r.data);

export const updateSubscriptionPlan = (id: string, input: Partial<SubscriptionPlanInput>) =>
  request<{ data: AdminSubscriptionPlan }>(`/admin/subscription/plans/${id}`, { method: 'PATCH', body: input }).then((r) => r.data);

/** 409 PLAN_IN_USE when businesses subscribe on this plan. Deactivate instead. */
export const deleteSubscriptionPlan = (id: string) =>
  request<void>(`/admin/subscription/plans/${id}`, { method: 'DELETE' });

/* --------------------------- payment methods --------------------------- */
/* Account details shown in the business app: editing the Easypaisa number
   here updates the business app immediately, no developer needed. */

export type AdminPaymentMethod = {
  id: string;
  name: string;
  type: 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER' | 'OTHER';
  accountTitle: string | null;
  accountNumber: string | null;
  iban: string | null;
  instructions: string | null;
  qrImageUrl: string | null;
  isActive: boolean;
  displayOrder: number;
  usageCount?: number;
};

export type PaymentMethodInput = {
  name: string;
  type: string;
  accountTitle?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  instructions?: string | null;
  qrImageUrl?: string | null;
  isActive: boolean;
  displayOrder: number;
};

export const listPaymentMethods = () =>
  request<{ data: AdminPaymentMethod[] }>('/admin/subscription/payment-methods').then((r) => r.data);

export const createPaymentMethod = (input: PaymentMethodInput) =>
  request<{ data: AdminPaymentMethod }>('/admin/subscription/payment-methods', { method: 'POST', body: input }).then((r) => r.data);

export const updatePaymentMethod = (id: string, input: Partial<PaymentMethodInput>) =>
  request<{ data: AdminPaymentMethod }>(`/admin/subscription/payment-methods/${id}`, { method: 'PATCH', body: input }).then((r) => r.data);

/** 409 when payment requests reference this method. Deactivate instead. */
export const deletePaymentMethod = (id: string) =>
  request<void>(`/admin/subscription/payment-methods/${id}`, { method: 'DELETE' });

/* ------------------------- verification review ------------------------- */

/**
 * One row of the admin verification queue, exactly as the server renders it.
 *
 * Production incident (2026-09-23): the Verification page went blank because
 * the client assumed the list endpoint returned `{ data: [...] }` and the
 * detail endpoint returned `{ data: { application, documents, business } }`,
 * while the server actually returns `{ data: { items, nextCursor } }` for the
 * list and `{ data: <this row> }` for the detail (the row already nests
 * `business` and `documents`). The mismatch made `apps.map` throw during
 * render. These types pin the real contract so the two cannot drift again.
 */
export type VerificationDocument = {
  id: string;
  docType: string;
  storageKey: string;
  status: string;
  uploadedAt: string;
};

export type VerificationApplication = {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  legalName: string | null;
  publicName: string | null;
  ownerName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  categoryId: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  registrationInfo: string | null;
  adminNotes: string | null;
  reviewerMessage: string | null;
  reviewedByUserId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  business: {
    id: string;
    name: string;
    slug: string;
    owner: { id: string; email: string; firstName: string | null; lastName: string | null };
  };
  documents: VerificationDocument[];
};

export const listVerifications = (params: { status?: string; q?: string }) => {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  // The admin queue is paginated server-side ({ data: { items, nextCursor } }).
  // The review page shows the first page of the filtered queue.
  return request<{ data: { items: VerificationApplication[]; nextCursor: string | null } }>(
    `/admin/verifications?${search}`,
  ).then((r) => r.data.items);
};

export const getVerification = (id: string) =>
  request<{ data: VerificationApplication }>(`/admin/verifications/${id}`).then((r) => r.data);

export const approveVerification = (id: string, body: { adminNotes?: string; reviewerMessage?: string }) =>
  request<{ data: VerificationApplication }>(`/admin/verifications/${id}/approve`, { method: 'POST', body }).then((r) => r.data);

export const rejectVerification = (id: string, body: { reviewerMessage: string; adminNotes?: string }) =>
  request<{ data: VerificationApplication }>(`/admin/verifications/${id}/reject`, { method: 'POST', body }).then((r) => r.data);

export const requestVerificationChanges = (id: string, body: { reviewerMessage: string; adminNotes?: string }) =>
  request<{ data: VerificationApplication }>(`/admin/verifications/${id}/request-changes`, { method: 'POST', body }).then((r) => r.data);

/* ------------------------------ promotions ----------------------------- */

export type AdminPromotion = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  benefits: string[];
  priceMinor: number;
  currency: string;
  durationDays: number;
  requirements: string | null;
  isActive: boolean;
  displayOrder: number;
  requestCount?: number;
};

export type PromotionInput = {
  name: string;
  slug?: string;
  description?: string | null;
  benefits: string[];
  priceMinor: number;
  currency?: string;
  durationDays: number;
  requirements?: string | null;
  isActive: boolean;
  displayOrder: number;
};

export const listPromotions = () => request<{ data: AdminPromotion[] }>('/admin/promotions').then((r) => r.data);

export const createPromotion = (input: PromotionInput) =>
  request<{ data: AdminPromotion }>('/admin/promotions', { method: 'POST', body: input }).then((r) => r.data);

export const updatePromotion = (id: string, input: Partial<PromotionInput>) =>
  request<{ data: AdminPromotion }>(`/admin/promotions/${id}`, { method: 'PATCH', body: input }).then((r) => r.data);

export const deletePromotion = (id: string) => request<void>(`/admin/promotions/${id}`, { method: 'DELETE' });

export type PromotionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
export type PromotionPaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | null;

/**
 * One row of the admin promotion-request queue, exactly as the server renders
 * it. `payments` is newest-first and carries only ids/statuses; fetch the
 * full payment record to review it.
 */
export type AdminPromotionRequest = {
  id: string;
  status: PromotionRequestStatus;
  note: string | null;
  reviewerMessage: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  paymentStatus: PromotionPaymentStatus;
  business: {
    id: string;
    name: string;
    slug: string;
    owner: { id: string; email: string; firstName: string | null; lastName: string | null };
  };
  promotion: {
    id: string;
    name: string;
    slug: string;
    priceMinor: number;
    currency: string;
    durationDays: number;
  } | null;
  payments: Array<{ id: string; status: string; amountMinor: number; submittedAt: string }>;
};

export type PromotionRequestListParams = { status?: string; promotionId?: string; limit?: number };

export const listPromotionRequests = (statusOrParams?: string | PromotionRequestListParams) => {
  const params: PromotionRequestListParams = typeof statusOrParams === 'string' ? { status: statusOrParams } : (statusOrParams ?? {});
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.promotionId) search.set('promotionId', params.promotionId);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<{ data: AdminPromotionRequest[] }>(`/admin/promotion-requests${qs ? `?${qs}` : ''}`).then((r) => r.data);
};

export const approvePromotionRequest = (id: string, reviewerMessage?: string) =>
  request<{ data: AdminPromotionRequest }>(`/admin/promotion-requests/${id}/approve`, { method: 'POST', body: { reviewerMessage } }).then((r) => r.data);

export const rejectPromotionRequest = (id: string, reviewerMessage?: string) =>
  request<{ data: AdminPromotionRequest }>(`/admin/promotion-requests/${id}/reject`, { method: 'POST', body: { reviewerMessage } }).then((r) => r.data);

/* ------------------- promotion payment requests (admin) ------------------- */

export type AdminPromotionPayment = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  transactionReference: string | null;
  receiptStorageKey: string | null;
  paidAt: string | null;
  note: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  business: { id: string; name: string };
  promotionRequest: { id: string };
  promotion: { id: string; name: string; slug: string };
  paymentMethod: { id: string; name: string; type: string };
};

export type PromotionPaymentListParams = {
  status?: string;
  promotionRequestId?: string;
  businessId?: string;
  limit?: number;
  cursor?: string;
};

export const listPromotionPaymentRequests = (params: PromotionPaymentListParams = {}) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const qs = search.toString();
  return request<{ data: { items: AdminPromotionPayment[]; nextCursor: string | null } }>(
    `/admin/promotion-payment-requests${qs ? `?${qs}` : ''}`,
  ).then((r) => r.data);
};

export const getPromotionPaymentRequest = (id: string) =>
  request<{ data: AdminPromotionPayment }>(`/admin/promotion-payment-requests/${id}`).then((r) => r.data);

/** Approving a payment activates the promotion server-side with server-set start/end dates. */
export const approvePromotionPayment = (id: string) =>
  request<{ data: AdminPromotionPayment }>(`/admin/promotion-payment-requests/${id}/approve`, { method: 'POST', body: {} }).then((r) => r.data);

/** Rejecting a payment keeps the promotion request APPROVED so the business can resubmit. */
export const rejectPromotionPayment = (id: string, reason?: string) =>
  request<{ data: AdminPromotionPayment }>(`/admin/promotion-payment-requests/${id}/reject`, { method: 'POST', body: { reason } }).then(
    (r) => r.data,
  );

/* ------------------------- authorized blob viewing ---------------------- */
/* Verification documents are viewed through the same authorized receipt
   endpoint contract: the caller fetches with the admin Bearer token and
   hands the browser a blob URL (never a raw link that would 401). */

export const fetchAuthorizedBlobUrl = async (path: string): Promise<string> => {
  const session = getSession();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: session ? { authorization: `Bearer ${session.accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'BLOB_READ_FAILED', 'Could not load the file.');
  return URL.createObjectURL(await res.blob());
};

export const fetchReceiptObjectUrl = (storageKey: string): Promise<string> =>
  fetchAuthorizedBlobUrl(`/subscription/payment-receipts/${encodeURIComponent(storageKey)}`);

/** Verification application documents are served from their own authorized endpoint. */
export const fetchVerificationDocumentUrl = (storageKey: string): Promise<string> =>
  fetchAuthorizedBlobUrl(`/verification/documents/${encodeURIComponent(storageKey)}`);
