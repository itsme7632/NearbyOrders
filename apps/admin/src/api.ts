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
  /** Phase 16 operational activity — real aggregates from the server. */
  counts: { orders: number; bookings: number; services: number; products: number; reviews: number };
};

export const listBusinesses = (params: { q?: string; status?: string }) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
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
};

export const listPaymentRequests = (status: string) =>
  request<{ data: { items: AdminPaymentRequest[] } }>(`/admin/subscription/payment-requests${status ? `?status=${status}` : ''}`).then((r) => r.data.items);

export const approvePaymentRequest = (id: string) =>
  request<{ data: AdminPaymentRequest }>(`/admin/subscription/payment-requests/${id}/approve`, { method: 'POST', body: {} }).then((r) => r.data);

export const rejectPaymentRequest = (id: string, reason: string) =>
  request<{ data: AdminPaymentRequest }>(`/admin/subscription/payment-requests/${id}/reject`, { method: 'POST', body: { reason } }).then((r) => r.data);

/**
 * Receipt image bytes; only the owning business and admins can read it. The
 * endpoint requires the caller's Bearer token, so the panel fetches it with
 * the session header and hands the image to the browser as a blob URL (never
 * a raw link that would 401 without credentials).
 */
export const fetchReceiptObjectUrl = async (storageKey: string): Promise<string> => {
  const session = getSession();
  const res = await fetch(`${API_BASE}/subscription/payment-receipts/${storageKey}`, {
    headers: session ? { authorization: `Bearer ${session.accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'RECEIPT_READ_FAILED', 'Could not load the receipt image.');
  return URL.createObjectURL(await res.blob());
};

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
