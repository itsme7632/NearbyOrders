/** Same-origin API base: the Vite dev proxy and the Capacitor https scheme both resolve this. */
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

export type Session = { accessToken: string; user: { id: string; email: string; role: string } };

/** Own-account fields as returned by /auth/me and /auth/profile. */
export type MyProfile = { id: string; email: string; role: string; firstName: string | null; lastName: string | null; phone?: string | null };

let session: Session | null = null;
const sessionListeners = new Set<(s: Session | null) => void>();

export function getSession(): Session | null {
  return session;
}

export function setSession(next: Session | null): void {
  session = next;
  for (const listener of sessionListeners) listener(next);
}

export function onSessionChange(listener: (s: Session | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.auth && session) headers.authorization = `Bearer ${session.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API. Is the API server running?');
  }

  if (res.status === 204) return undefined as T;

  const payload = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && session) setSession(null);
    // Validation failures carry a Zod field map — surface it so users see
    // which field to fix instead of a generic "Invalid request".
    const details = (payload as { error?: { details?: { fieldErrors?: Record<string, string[]> } } } | null)?.error?.details
      ?.fieldErrors;
    const fieldMessage =
      details && Object.keys(details).length > 0
        ? Object.entries(details)
            .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
            .join('; ')
        : null;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      fieldMessage ?? err?.message ?? `Request failed (${res.status})`,
    );
  }
  return ((payload as { data?: T })?.data ?? (payload as T)) as T;
}

/* ------------------------------ types ------------------------------ */

export type Category = { id: string; name: string; slug: string; isActive: boolean };

export type Business = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  /** Average rating shown to owners on their business profile (may be null). */
  averageRating?: number | null;
  reviewCount?: number | null;
  description: string | null;
  imageUrl: string | null;
  isVerified: boolean;
  address: string;
  city: string;
  locality: string | null;
  /** Real configured coordinates — null when the owner has not set a location. Never invented client-side. */
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  currency: string;
  isOpenNow?: boolean;
  distanceKm?: number;
  categories: Category[];
  hours?: BusinessHour[];
  services?: Service[];
  products?: Product[];
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  durationMinutes: number | null;
  isActive: boolean;
  /** Phase 7C advance requirement, always server-evaluated. */
  advanceType?: 'NONE' | 'FIXED' | 'PERCENTAGE';
  advanceAmountMinor?: number | null;
  advancePercent?: number | null;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  imageUrl: string | null;
  isActive: boolean;
};

export type OrderStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';

export type OrderItem = {
  id: string;
  productId: string;
  /** Purchase-time product name — stable even if the product changes later. */
  name: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  subtotalMinor: number;
  currency: string;
  fulfillmentType: string;
  createdAt: string;
  /** Phase 7C: server-computed; 0 for pickup/collection. */
  deliveryFeeMinor?: number;
  totalMinor?: number;
  notes: string | null;
  business: { id: string; name: string; slug: string; imageUrl?: string | null };
  /** First name / last name only — never email or credentials. */
  customer: { firstName: string | null; lastName: string | null } | null;
  items: OrderItem[];
};

export type BusinessHour = {
  id: string;
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type HourInput = { dayOfWeek: number; isClosed: boolean; opensAt?: string; closesAt?: string };

/* ------------------------------- auth ------------------------------ */

export const login = (email: string, password: string) =>
  request<Session>('/auth/login', { method: 'POST', body: { email, password } }).then((s) => {
    setSession(s);
    return s;
  });

export const logout = () => setSession(null);

/* ------------------------------ account ----------------------------- */

/** Current profile (names/phone) for the signed-in user. */
export const whoami = () => request<MyProfile>('/auth/me', { auth: true });

/**
 * Updates the signed-in user's own profile. There is no userId parameter by
 * design — the server derives ownership from the access token.
 */
export const updateMyProfile = (patch: { firstName?: string | null; lastName?: string | null; phone?: string | null }) =>
  request<MyProfile>('/auth/profile', { method: 'PATCH', body: patch, auth: true });

/**
 * Changes the signed-in user's password (server re-proves the current one and
 * revokes other sessions). The response is 204 with no body — passwords are
 * never returned or persisted client-side.
 */
export const changeMyPassword = (currentPassword: string, newPassword: string) =>
  request<void>('/auth/password', { method: 'PATCH', body: { currentPassword, newPassword }, auth: true });

/* --------------------------- categories ---------------------------- */

export const listCategories = () => request<Category[]>('/categories');

export const listAdminCategories = () => request<(Category & { _count: { businesses: number } })[]>('/admin/categories', { auth: true });

export const createCategory = (name: string) => request<Category>('/admin/categories', { method: 'POST', body: { name }, auth: true });

export const updateCategory = (id: string, patch: { name?: string; isActive?: boolean }) =>
  request<Category>(`/admin/categories/${id}`, { method: 'PATCH', body: patch, auth: true });

/* --------------------------- subscriptions ------------------------- */

/** Mirrors the server's SubscriptionStatus enum (Phase 7A foundation). */
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

/** Plan as embedded in a subscription response (display only). */
export type SubscriptionPlan = {
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  currency: string;
  trialDays: number;
};

/** The business's current (latest) subscription, or null before first trial. */
export type Subscription = {
  id: string;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStartAt: string;
  currentPeriodEndAt: string;
  cancelledAt: string | null;
  plan: SubscriptionPlan;
};

/** Current subscription for an owned business (server evaluates expiry). */
export const getBusinessSubscription = (businessId: string) =>
  request<Subscription | null>(`/businesses/${businessId}/subscription`, { auth: true });

/** Starts the plan's free trial; dates are server-generated, body is empty. */
export const startBusinessTrial = (businessId: string) =>
  request<Subscription>(`/businesses/${businessId}/subscription/trial`, { method: 'POST', auth: true });

/** Cancels the live subscription; access continues until the period ends. */
export const cancelBusinessSubscription = (businessId: string) =>
  request<Subscription>(`/businesses/${businessId}/subscription/cancel`, { method: 'POST', auth: true });

/* --------------------- manual subscription payments ---------------- */

/** Mirrors the server's PaymentMethodType enum. */
export type PaymentMethodType = 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER';

/** A manual pay-in channel (Easypaisa / JazzCash / bank transfer), server-configured. */
export type PaymentMethod = {
  id: string;
  name: string;
  type: PaymentMethodType;
  accountTitle: string;
  accountNumber: string;
  iban: string | null;
  instructions: string | null;
};

/** Mirrors the server's PaymentRequestStatus enum. */
export type PaymentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** One submitted payment proof as seen by the owning business. */
export type PaymentRequest = {
  id: string;
  status: PaymentRequestStatus;
  /** Server-computed plan price — the client never sends an amount. */
  amountMinor: number;
  currency: string;
  transactionReference: string;
  receiptStorageKey: string;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  subscriptionId: string | null;
  paymentMethod: { id: string; name: string; type: PaymentMethodType };
};

/** Wrapped list response for payment history: { data: { items, nextCursor } }. */
export type PaymentRequestPage = { items: PaymentRequest[]; nextCursor: string | null };

/** Active pay-in channels in display order (shown to any authenticated user). */
export const listPaymentMethods = () => request<PaymentMethod[]>('/subscription/payment-methods', { auth: true });

/** Payment history for an owned business, newest first. */
export const listPaymentRequests = (businessId: string, limit = 20, cursor?: string) => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return request<PaymentRequestPage>(`/businesses/${businessId}/subscription/payment-requests?${qs.toString()}`, { auth: true });
};

/**
 * Submits payment proof for admin verification. The body carries only the
 * chosen method, the transaction reference and the uploaded receipt's storage
 * key — amount and currency come from the server's plan catalog.
 */
export const submitPaymentRequest = (
  businessId: string,
  body: { paymentMethodId: string; transactionReference: string; receiptStorageKey: string },
) => request<PaymentRequest>(`/businesses/${businessId}/subscription/payment-requests`, { method: 'POST', body, auth: true });

/** Cancels the business's own PENDING request so a corrected one can be sent. */
export const cancelPaymentRequest = (businessId: string, requestId: string) =>
  request<PaymentRequest>(`/businesses/${businessId}/subscription/payment-requests/${requestId}/cancel`, { method: 'POST', auth: true });

/**
 * Uploads the picked receipt image to the API (multipart). The server stores
 * the bytes and returns an opaque, server-generated storage key — never a
 * user-facing URL. Receipts stay viewable only through authorized endpoints.
 */
export async function uploadPaymentReceipt(file: File): Promise<string> {
  const headers: Record<string, string> = {};
  if (session) headers.authorization = `Bearer ${session.accessToken}`;

  let res: Response;
  try {
    const form = new FormData();
    form.append('file', file);
    res = await fetch(`${API_BASE}/subscription/payment-receipts`, { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API. Is the API server running?');
  }

  const payload = (await res.json().catch(() => null)) as { data?: { storageKey?: string }; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    if (res.status === 401 && session) setSession(null);
    throw new ApiError(res.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? `Receipt upload failed (${res.status})`);
  }
  const storageKey = payload?.data?.storageKey;
  if (!storageKey) throw new ApiError(500, 'UNKNOWN', 'Receipt upload returned no storage key');
  return storageKey;
}

/* --------------------------- businesses ---------------------------- */

export type BusinessQuery = {
  q?: string;
  category?: string;
  city?: string;
  limit?: number;
  nearLat?: number;
  nearLng?: number;
  radiusKm?: number;
};

export function listBusinesses(query: BusinessQuery = {}): Promise<Business[]> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.city) params.set('city', query.city);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.nearLat !== undefined) params.set('nearLat', String(query.nearLat));
  if (query.nearLng !== undefined) params.set('nearLng', String(query.nearLng));
  if (query.radiusKm !== undefined) params.set('radiusKm', String(query.radiusKm));
  const qs = params.toString();
  return request<Business[]>(`/businesses${qs ? `?${qs}` : ''}`);
}

export const getBusiness = (idOrSlug: string) => request<Business>(`/businesses/${idOrSlug}`);

export const getMyBusinesses = () => request<Business[]>('/businesses/mine', { auth: true });

/* ------------------- location (Phase 11) --------------------------- */

export type NearbyQuery = { lat: number; lng: number; radiusKm?: number; limit?: number };

/** Dedicated nearby search; the server computes and orders by real distance. */
export function listNearbyBusinesses(query: NearbyQuery): Promise<Business[]> {
  const params = new URLSearchParams({ lat: String(query.lat), lng: String(query.lng) });
  if (query.radiusKm !== undefined) params.set('radiusKm', String(query.radiusKm));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return request<Business[]>(`/businesses/nearby?${params}`);
}

export type BusinessLocation = {
  latitude: number | null;
  longitude: number | null;
  isConfigured: boolean;
};

/** Owner-facing location state for a business they own. */
export const getBusinessLocation = (businessId: string) =>
  request<BusinessLocation>(`/businesses/${businessId}/location`, { auth: true });

/** Sets or clears (both nulls) the business's real coordinates. */
export const updateBusinessLocation = (
  businessId: string,
  payload: { latitude: number | null; longitude: number | null },
) => request<BusinessLocation>(`/businesses/${businessId}/location`, { method: 'PUT', body: payload, auth: true });

/** Self-service business creation; the server assigns ownership from the session. */
export const createBusiness = (input: {
  name: string;
  categoryIds: string[];
  description?: string;
  phone?: string;
  address: string;
  city: string;
}) => request<Business>('/businesses', { method: 'POST', body: input, auth: true });

export const updateBusiness = (
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    phone: string | null;
    email: string | null;
    address: string;
    city: string;
    locality: string | null;
    imageUrl: string | null;
    categoryIds: string[];
  }>,
) => request<Business>(`/businesses/${id}`, { method: 'PATCH', body: patch, auth: true });

/* ------------------- services / products / hours ------------------- */

export const listServices = (businessId: string) => request<Service[]>(`/businesses/${businessId}/services`);
export const createService = (
  businessId: string,
  body: {
    name: string;
    description?: string;
    priceMinor: number;
    durationMinutes?: number;
    /** Phase 7C advance requirement — the server validates against priceMinor. */
    advanceType?: 'NONE' | 'FIXED' | 'PERCENTAGE';
    advanceAmountMinor?: number;
    advancePercent?: number;
  },
) => request<Service>(`/businesses/${businessId}/services`, { method: 'POST', body, auth: true });
export const updateService = (
  id: string,
  patch: Partial<
    Pick<
      Service,
      | 'name'
      | 'description'
      | 'priceMinor'
      | 'durationMinutes'
      | 'isActive'
      | 'advanceType'
      | 'advanceAmountMinor'
      | 'advancePercent'
    >
  >,
) => request<Service>(`/services/${id}`, { method: 'PATCH', body: patch, auth: true });
export const deleteService = (id: string) => request<void>(`/services/${id}`, { method: 'DELETE', auth: true });

export const listProducts = (businessId: string) => request<Product[]>(`/businesses/${businessId}/products`);
export const createProduct = (
  businessId: string,
  body: { name: string; description?: string; priceMinor: number; imageUrl?: string },
) => request<Product>(`/businesses/${businessId}/products`, { method: 'POST', body, auth: true });
export const updateProduct = (id: string, patch: Partial<Pick<Product, 'name' | 'description' | 'priceMinor' | 'imageUrl' | 'isActive'>>) =>
  request<Product>(`/products/${id}`, { method: 'PATCH', body: patch, auth: true });
export const deleteProduct = (id: string) => request<void>(`/products/${id}`, { method: 'DELETE', auth: true });

export const getHours = (businessId: string) => request<BusinessHour[]>(`/businesses/${businessId}/hours`);
export const putHours = (businessId: string, days: HourInput[]) =>
  request<BusinessHour[]>(`/businesses/${businessId}/hours`, { method: 'PUT', body: days, auth: true });

/* ------------------------------ bookings --------------------------- */

export type Availability = {
  date: string;
  serviceDurationMinutes: number;
  businessHours: { open: string; close: string } | null;
  closed: boolean;
  slots: { start: string; end: string; available: boolean }[];
};

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';

export type Booking = {
  id: string;
  businessId: string;
  businessName: string;
  businessImageUrl?: string | null;
  businessSlug: string;
  serviceId: string | null;
  serviceName: string | null;
  priceMinor: number | null;
  currency: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  notes: string | null;
  createdAt: string;
  /** Phase 7C frozen snapshot — never recomputed from the service. */
  servicePriceMinor?: number;
  advanceRequiredMinor?: number;
  amountPaidMinor?: number;
  /** Remaining after the advance step: price − max(paid, advance). */
  amountDueMinor?: number;
  /** Only present on list endpoints — safe subset, never credentials. */
  customer?: { id: string; email: string; firstName: string | null; lastName: string | null };
};

export type BookingInput = { businessId: string; serviceId: string; date: string; startTime: string; notes?: string };

/** Per-date slot availability for a bookable service (Phase 3A endpoint). */
export const getAvailability = (businessId: string, serviceId: string, date: string) =>
  request<Availability>(`/businesses/${businessId}/services/${serviceId}/availability?date=${date}`);

export const createBooking = (input: BookingInput) => request<Booking>('/bookings', { method: 'POST', body: input, auth: true });

/** All bookings visible to the current user (customers see their own). */
export const listMyBookings = () => request<Booking[]>('/bookings', { auth: true });

export const getBooking = (id: string) => request<Booking>(`/bookings/${id}`, { auth: true });

export const cancelMyBooking = (id: string) => request<Booking>(`/bookings/${id}/cancel`, { method: 'POST', auth: true });

/** Business bookings for the signed-in owner (server enforces ownership). */
export const listBusinessBookings = (businessId: string) =>
  request<Booking[]>(`/businesses/${businessId}/bookings`, { auth: true });

/** Owner/admin status change; the backend enforces ownership + allowed transitions. */
export const setBookingStatus = (id: string, status: 'CONFIRMED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED') =>
  request<Booking>(`/bookings/${id}/status`, { method: 'PATCH', body: { status }, auth: true });

/* ---------------- customer→business payments (Phase 7C) ------------ */

/** A pay-in channel a BUSINESS offers its customers (distinct from 7B admin channels). */
export type BusinessPayInMethod = {
  id: string;
  type: 'CASH' | 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER' | 'OTHER';
  displayName: string;
  accountTitle: string | null;
  accountNumber: string | null;
  iban: string | null;
  instructions: string | null;
  /** Present on owner endpoints (which include inactive channels); absent on the public list. */
  isActive?: boolean;
  displayOrder?: number;
};

/** Mirrors the server's CustomerPaymentStatus enum. */
export type CustomerPaymentStatus = 'PENDING_VERIFICATION' | 'PAID' | 'FAILED' | 'UNPAID';

/** One customer payment proof (booking or order), as seen by its parties. */
export type CustomerPayment = {
  id: string;
  amountMinor: number;
  currency: string;
  status: CustomerPaymentStatus;
  transactionReference: string | null;
  receiptStorageKey: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  paymentMethod: { id: string; displayName: string; type: string } | null;
};

/** Active pay-in channels for an approved business, in display order. */
export const listBusinessPayInMethods = (businessId: string) =>
  request<BusinessPayInMethod[]>(`/businesses/${businessId}/payment-methods`);

/** Payment proofs on one booking (own or owned business). */
export const listBookingPayments = (bookingId: string) =>
  request<CustomerPayment[]>(`/bookings/${bookingId}/payments`, { auth: true });

/**
 * Submits booking payment proof. The server caps the amount against the
 * frozen booking snapshot; digital channels require a reference + receipt.
 */
export const submitBookingPayment = (
  bookingId: string,
  body: { amountMinor: number; paymentMethodId: string; transactionReference?: string; receiptStorageKey?: string },
) => request<CustomerPayment>(`/bookings/${bookingId}/payments`, { method: 'POST', body, auth: true });

/** Payment proofs on one order. */
export const listOrderPayments = (orderId: string) =>
  request<CustomerPayment[]>(`/orders/${orderId}/payments`, { auth: true });

/** Submits order payment proof; the server caps the amount at the total. */
export const submitOrderPayment = (
  orderId: string,
  body: { amountMinor: number; paymentMethodId: string; transactionReference?: string; receiptStorageKey?: string },
) => request<CustomerPayment>(`/orders/${orderId}/payments`, { method: 'POST', body, auth: true });

/**
 * Incoming orders for ONE owned business (Business-mode listing).
 * Distinct from listOrders, which is always the caller's own placed orders.
 */
export const listBusinessOrders = (businessId: string) =>
  request<Order[]>(`/owner/businesses/${businessId}/orders`, { auth: true });

/** Owner's verification queue across their businesses (both kinds). */
export type OwnerPaymentQueue = { bookingPayments: CustomerPayment[]; orderPayments: CustomerPayment[] };
export const listOwnerPayments = (status: 'PENDING_VERIFICATION' | 'PAID' | 'FAILED' = 'PENDING_VERIFICATION') =>
  request<OwnerPaymentQueue>(`/owner/payments?status=${status}`, { auth: true });

/** Owner verifies a pending booking/order payment they own. */
export const verifyOwnerPayment = (id: string, kind: 'booking' | 'order') =>
  request<CustomerPayment>(kind === 'booking' ? `/owner/payments/${id}/verify` : `/owner/order-payments/${id}/verify`, {
    method: 'POST',
    auth: true,
  });

/** Owner rejects a pending payment; a reason is required by the server. */
export const rejectOwnerPayment = (id: string, kind: 'booking' | 'order', reason: string) =>
  request<CustomerPayment>(
    kind === 'booking' ? `/owner/payments/${id}/reject` : `/owner/order-payments/${id}/reject`,
    { method: 'POST', body: { reason }, auth: true },
  );

/** Owner marks cash collected on an order (remaining balance). */
export const collectOrderCash = (orderId: string) =>
  request<CustomerPayment>(`/owner/orders/${orderId}/collect-cash`, { method: 'POST', auth: true });

/** Reads/updates delivery + COD settings for an owned business. */
export type DeliverySettings = { deliveryEnabled: boolean; codEnabled: boolean; deliveryFeeMinor: number };
export const getDeliverySettings = (businessId: string) =>
  request<DeliverySettings>(`/owner/businesses/${businessId}/delivery-settings`, { auth: true });
export const putDeliverySettings = (businessId: string, body: Partial<DeliverySettings> & { deliveryEnabled: boolean }) =>
  request<DeliverySettings>(`/owner/businesses/${businessId}/delivery-settings`, { method: 'PUT', body, auth: true });

/** Owner CRUD for their pay-in channels (deactivation only, never delete). */
export const listOwnerPayInMethods = (businessId: string) =>
  request<BusinessPayInMethod[]>(`/owner/businesses/${businessId}/payment-methods`, { auth: true });
export const createPayInMethod = (
  businessId: string,
  body: {
    type: BusinessPayInMethod['type'];
    displayName: string;
    accountTitle?: string;
    accountNumber?: string;
    iban?: string;
    instructions?: string;
  },
) => request<BusinessPayInMethod>(`/owner/businesses/${businessId}/payment-methods`, { method: 'POST', body, auth: true });
export const deactivatePayInMethod = (businessId: string, methodId: string) =>
  request<BusinessPayInMethod>(`/owner/businesses/${businessId}/payment-methods/${methodId}`, { method: 'DELETE', auth: true });

/* ------------------------------- orders ---------------------------- */

/** Creates an order; the server re-prices everything from the database. */
export const createOrder = (input: {
  businessId: string;
  items: { productId: string; quantity: number }[];
  notes?: string;
  /** PICKUP (default) or DELIVERY; the fee always comes from business settings. */
  fulfillmentType?: 'PICKUP' | 'DELIVERY' | 'COLLECTION';
  /** Manual digital channel id; omit for COD / pickup-cash. */
  paymentMethodId?: string;
}) => request<Order>('/orders', { method: 'POST', body: input, auth: true });

/** Orders visible to the current user (customer: own, owner: own businesses). */
export const listOrders = () => request<Order[]>('/orders', { auth: true });

/** Alias kept for readability at call sites. */
export const listMyOrders = listOrders;

export const getOrder = (id: string) => request<Order>(`/orders/${id}`, { auth: true });
export const getMyOrder = getOrder;

/** Owner lifecycle changes; customers may only cancel a PENDING order. */
export const setOrderStatus = (id: string, status: OrderStatus) =>
  request<Order>(`/orders/${id}/status`, { method: 'PATCH', body: { status }, auth: true });

/* ---------------------------- notifications ------------------------ */

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: 'Booking' | 'Order' | 'SubscriptionPaymentRequest';
  entityId: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

/** Matches the wrapped list response: { data: { items, nextCursor } }. */
export type NotificationPage = { items: Notification[]; nextCursor: string | null };

export const listNotifications = (limit = 30, cursor?: string) => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return request<NotificationPage>(`/notifications?${qs.toString()}`, { auth: true });
};

export const getUnreadCount = () => request<{ count: number }>('/notifications/unread-count', { auth: true });

/* --------------------- Push devices & preferences (Phase 13) --------------------- */

export type PushDevice = {
  id: string;
  platform: 'android' | 'ios' | 'web';
  deviceId: string | null;
  isActive: boolean;
  lastSeenAt: string;
  createdAt: string;
};

/** Registers (or re-activates) this device for push; idempotent per token. */
export const registerPushDevice = (payload: { platform: 'android' | 'ios' | 'web'; pushToken: string; deviceId?: string }) =>
  request<PushDevice>('/push/devices', { method: 'POST', body: payload, auth: true });

/** Deactivates one of the caller's own devices (logout on that device). */
export const deactivatePushDevice = (id: string) =>
  request<{ id: string; isActive: boolean }>(`/push/devices/${id}`, { method: 'DELETE', auth: true });

export type NotificationPreferences = {
  bookings: boolean;
  orders: boolean;
  payments: boolean;
  reviews: boolean;
  businessActivity: boolean;
  account: boolean;
};

export const getNotificationPreferences = () =>
  request<NotificationPreferences>('/notifications/preferences', { auth: true });

export const updateNotificationPreferences = (prefs: NotificationPreferences) =>
  request<NotificationPreferences>('/notifications/preferences', { method: 'PUT', body: prefs, auth: true });

export const markNotificationRead = (id: string) =>
  request<Notification>(`/notifications/${id}/read`, { method: 'PATCH', auth: true });

export const markAllNotificationsRead = () =>
  request<{ updated: number }>('/notifications/read-all', { method: 'PATCH', auth: true });

/* ------------------------------- reviews ------------------------------- */

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerName: string;
};

export type ReviewPage = {
  items: PublicReview[];
  nextCursor: string | null;
  averageRating: number | null;
  reviewCount: number;
};

export type MyReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  bookingId: string | null;
  orderId: string | null;
  business: { id: string; name: string; slug: string; imageUrl?: string | null };
};

export type OwnerReview = PublicReview & { business: { id: string; name: string } };

export type ReviewSource = { bookingId?: string; orderId?: string };

export const listBusinessReviews = (businessId: string, limit = 10, cursor?: string) => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return request<ReviewPage>(`/businesses/${businessId}/reviews?${qs.toString()}`);
};

export const createReview = (businessId: string, source: ReviewSource, rating: number, comment?: string) =>
  request<PublicReview>(`/businesses/${businessId}/reviews`, { method: 'POST', auth: true, body: { ...source, rating, ...(comment ? { comment } : {}) } });

export const listMyReviews = () => request<MyReview[]>('/my-reviews', { auth: true });

export const listMyBusinessReviews = () => request<OwnerReview[]>('/my-business-reviews', { auth: true });
