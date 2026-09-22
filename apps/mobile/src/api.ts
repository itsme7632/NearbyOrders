import type { SearchPage } from '@nearbyorders/shared';
import { getRefreshTokenStorage } from './auth-storage.js';

/**
 * API base URL.
 *
 * Default is the same-origin relative path '/api/v1', which works for web
 * (Vite dev proxy) builds. For a Capacitor Android build installed on a
 * physical device there is no same-origin API, so bake in an absolute URL at
 * build time via the VITE_API_BASE_URL env var, e.g.:
 *
 *   VITE_API_BASE_URL=https://api.example.com/api/v1 pnpm build
 *
 * The value must include the full path prefix (…/api/v1); trailing slashes
 * are stripped. Never point a device build at localhost or 127.0.0.1.
 */
const configuredBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
export const API_BASE = configuredBase?.replace(/\/+$/, '') || '/api/v1';

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

/**
 * Drops the whole auth state: the memory-only access token/session and the
 * securely stored refresh token. Used when the server rejects the session
 * (401) so a revoked or expired login consistently returns to the login
 * screen instead of retrying with a dead refresh token on next launch.
 */
export function clearAuthState(): void {
  setSession(null);
  void getRefreshTokenStorage()
    .clearRefreshToken()
    .catch(() => {
      // Storage already unreachable — the memory session is what matters here.
    });
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
    if (res.status === 401 && session) clearAuthState();
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
  /** Phase 3H: authoritative delivery capability from the public detail DTO. */
  deliveryEnabled?: boolean;
  codEnabled?: boolean;
  /** Delivery fee in minor units; null when delivery is not enabled. */
  deliveryFeeMinor?: number | null;
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
  /** Phase 17: DELIVERY snapshot captured at placement; null for pickup. */
  deliveryAddressText?: string | null;
  notes: string | null;
  business: { id: string; name: string; slug: string; imageUrl?: string | null };
  /** First name / last name only — never email or credentials. */
  customer: { firstName: string | null; lastName: string | null } | null;
  items: OrderItem[];
};

/** Phase 17: a customer-saved (favorite) business entry. */
export type FavoriteEntry = {
  business: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    city: string;
    address: string;
    isVerified: boolean;
    averageRating: number | null;
    reviewCount: number;
  };
  savedAt: string;
};

/** Phase 17: a customer delivery address. Coordinates optional, honest. */
export type CustomerAddress = {
  id: string;
  label: string;
  recipientName: string;
  phone: string | null;
  addressText: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
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

/** Login response also carries a rotating refresh token (persisted securely). */
type LoginResult = Session & { refreshToken?: string };

export const login = (email: string, password: string) =>
  request<LoginResult>('/auth/login', { method: 'POST', body: { email, password } }).then(async (s) => {
    // The access token lives in memory only. The refresh token goes straight
    // into the secure store — never beside the session, never in our own
    // plaintext.
    setSession({ accessToken: s.accessToken, user: s.user });
    if (s.refreshToken) {
      try {
        await getRefreshTokenStorage().setRefreshToken(s.refreshToken);
      } catch {
        // Login still succeeded; the session just won't survive an app restart.
      }
    }
    return s;
  });

/** Result of POST /auth/register: the created account (no session — callers log in next). */
export type RegisterResult = { id: string; email: string; role: string };

/**
 * Creates a new account through the configured API base (never a raw
 * relative fetch, which breaks on Capacitor where there is no same-origin
 * API). The server returns 201 with the created user; callers then call
 * login() to establish the native session.
 */
export const register = (email: string, password: string, role: 'CUSTOMER' | 'BUSINESS_OWNER') =>
  request<RegisterResult>('/auth/register', { method: 'POST', body: { email, password, role } });

/**
 * Logs out everywhere this device knows about: clears the in-memory session
 * synchronously (the UI drops it at once), then revokes the stored refresh
 * token server-side and wipes it from the secure store. Revocation failures
 * never block logout — the local secret is gone either way.
 */
export const logout = (): Promise<void> => {
  setSession(null);
  return (async () => {
    let refreshToken: string | null = null;
    try {
      refreshToken = await getRefreshTokenStorage().getRefreshToken();
    } catch {
      // Storage unreachable — local state is already cleared above.
    }
    try {
      await getRefreshTokenStorage().clearRefreshToken();
    } catch {
      // Clearing is idempotent.
    }
    if (refreshToken) {
      try {
        await request<void>('/auth/logout', { method: 'POST', body: { refreshToken } });
      } catch {
        // Revoked-or-gone is the goal; never fail a logout over it.
      }
    }
  })();
};

/**
 * App-startup session restore (persistent login). When a refresh token was
 * stored securely, exchange it for a fresh access/refresh pair, rotate the
 * stored token, then re-read the user through GET /auth/me and restore the
 * in-memory session. Any failure (expired, revoked, invalid, or offline)
 * clears the stored token and returns false so the app shows the login
 * screen. Passwords are never stored.
 */
export async function bootstrapSession(): Promise<boolean> {
  let refreshToken: string | null = null;
  try {
    refreshToken = await getRefreshTokenStorage().getRefreshToken();
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) return false;
  try {
    const refreshed = await request<{ accessToken: string; refreshToken: string; user: Session['user'] }>(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken } },
    );
    try {
      await getRefreshTokenStorage().setRefreshToken(refreshed.refreshToken);
    } catch {
      // Rotation write failed; the new pair still works for this run.
    }
    setSession({ accessToken: refreshed.accessToken, user: refreshed.user });
    // Authoritative user restore after the token exchange.
    const me = await whoami();
    setSession({ accessToken: refreshed.accessToken, user: { id: me.id, email: me.email, role: me.role } });
    return true;
  } catch {
    try {
      await getRefreshTokenStorage().clearRefreshToken();
    } catch {
      // Clearing is idempotent.
    }
    setSession(null);
    return false;
  }
}

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

/**
 * Plan as listed by GET /subscription/plans: the full public catalog row.
 * Plans, prices and trial terms always come from this endpoint — never
 * hard-coded in the app.
 */
export type SubscriptionPlan = {
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
};

/** Plan summary embedded in a subscription row (server shape: no id/isActive). */
export type SubscriptionRowPlan = {
  slug: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  currency: string;
  trialDays: number;
  benefits: string[];
  billingInterval: string;
  displayOrder: number;
  isHighlighted: boolean;
};

/**
 * A business subscription row as returned by the API. Trial eligibility lives
 * on the enclosing BusinessSubscriptionState (server-computed) — never
 * guessed client-side.
 */
export type Subscription = {
  id: string;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStartAt: string;
  currentPeriodEndAt: string;
  cancelledAt: string | null;
  planNameSnapshot: string | null;
  planPriceMinorSnapshot: number | null;
  plan: SubscriptionRowPlan | null;
};

/** Live trial window computed by the server; null when no trial is live. */
export type TrialWindow = { startsAt: string; endsAt: string; daysRemaining: number };

/**
 * Full subscription state for an owned business, exactly as
 * GET /businesses/:id/subscription returns it: the latest subscription row
 * (or null before the first trial), the live trial window, the
 * server-computed trial status (NOT_ELIGIBLE / ELIGIBLE / ACTIVE / EXPIRED /
 * CONVERTED), and the verification status — one round trip, server evaluates
 * expiry.
 */
export type BusinessSubscriptionState = {
  businessId: string;
  subscription: Subscription | null;
  status: SubscriptionStatus | null;
  trial: TrialWindow | null;
  planNameSnapshot: string | null;
  planPriceMinorSnapshot: number | null;
  verificationStatus: string | null;
  trialStatus: string | null;
};

/** Current subscription state for an owned business (server evaluates expiry). */
export const getBusinessSubscription = (businessId: string) =>
  request<BusinessSubscriptionState>(`/businesses/${businessId}/subscription`, { auth: true });

/** Public plan catalog: real plans and pricing, never hard-coded client-side. */
export const listSubscriptionPlans = () => request<SubscriptionPlan[]>('/subscription/plans');

/**
 * Applies the free trial for the chosen plan slug. Eligibility is decided
 * server-side: 403 NOT_ELIGIBLE / 409 ALREADY_SUBSCRIBED surface as ApiError
 * codes for the UI to explain honestly. Returns the created subscription row;
 * its trialEndAt is server-generated from the plan's trial days.
 */
export const applyTrial = (businessId: string, planSlug: string) =>
  request<Subscription>(`/businesses/${businessId}/subscription/trial/apply`, {
    method: 'POST',
    body: { planSlug },
    auth: true,
  });

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
  /** Optional QR image for the pay-in channel (server-provided URL or null). */
  qrImageUrl: string | null;
  /**
   * The server sorts channels by displayOrder but does not include it in the
   * public DTO — present only on admin-managed rows.
   */
  displayOrder?: number;
};

/** Mirrors the server's PaymentRequestStatus enum. */
export type PaymentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** One submitted payment proof as seen by the owning business. */
export type PaymentRequest = {
  id: string;
  status: PaymentRequestStatus;
  /** Plan the payment was made for (server-resolved display name). Not sent by the current owner DTO. */
  planName?: string | null;
  /** Server-computed plan price — the client never sends an amount. */
  amountMinor: number;
  currency: string;
  /** Pay-in channel display name (server-resolved). Not sent by the current owner DTO. */
  paymentMethodName?: string | null;
  transactionReference: string;
  receiptStorageKey: string;
  /** Optional note the owner attached to the submission. */
  note: string | null;
  /** When the owner says the payment was made (their input, ISO string). */
  paidAt: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  subscriptionId: string | null;
  paymentMethod: { id: string; name: string; type: PaymentMethodType };
};

/** Active pay-in channels in display order (shown to any authenticated user). */
export const listPaymentMethods = () => request<PaymentMethod[]>('/subscription/payment-methods', { auth: true });

/** Payment history for an owned business, newest first. The server paginates
 * this endpoint: GET returns { data: { items: [...], nextCursor } }. The
 * client unwraps the envelope so callers always receive a PaymentRequest[]
 * (an unwrapped envelope is truthy, so passing it through would make
 * `history.find` throw during render and blank the whole screen).
 */
export const listPaymentRequests = async (businessId: string): Promise<PaymentRequest[]> => {
  const page = await request<{ items: PaymentRequest[]; nextCursor: string | null }>(
    `/businesses/${businessId}/subscription/payment-requests`,
    { auth: true },
  );
  return page?.items ?? [];
};

/**
 * Submits payment proof for admin verification. The body carries only the
 * chosen method, the transaction reference, the uploaded receipt's storage
 * key, and the owner's optional note/payment date — amount and currency come
 * from the server's plan catalog. Submission alone never activates anything:
 * the NearbyOrders team reviews every request.
 */
export const submitPaymentRequest = (
  businessId: string,
  body: {
    paymentMethodId: string;
    transactionReference: string;
    receiptStorageKey: string;
    paidAt?: string;
    note?: string;
  },
) => request<PaymentRequest>(`/businesses/${businessId}/subscription/payment-requests`, { method: 'POST', body, auth: true });

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
    if (res.status === 401 && session) clearAuthState();
    throw new ApiError(res.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? `Receipt upload failed (${res.status})`);
  }
  const storageKey = payload?.data?.storageKey;
  if (!storageKey) throw new ApiError(500, 'UNKNOWN', 'Receipt upload returned no storage key');
  return storageKey;
}

/**
 * Downloads a stored receipt/proof through the authorized endpoint and
 * returns it as a Blob the owner can view. Receipts are never rendered from
 * a public URL — every read goes through this authenticated fetch.
 */
export async function downloadReceipt(storageKey: string): Promise<Blob> {
  const s = getSession();
  const headers: Record<string, string> = {};
  if (s) headers.authorization = `Bearer ${s.accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/subscription/payment-receipts/${encodeURIComponent(storageKey)}`, { headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API. Is the API server running?');
  }
  if (!res.ok) {
    if (res.status === 401 && s) clearAuthState();
    throw new ApiError(res.status, 'UNKNOWN', `Receipt download failed (${res.status})`);
  }
  return res.blob();
}

/* --------------------------- verification -------------------------- */

/** Mirrors the server's verification application status enum. */
export type VerificationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/** One uploaded verification document (identity or business proof). The
 * server never exposes the storage key on owner DTOs — only the id, type,
 * status and upload time. */
export type VerificationDocument = {
  id: string;
  docType: string;
  storageKey?: string;
  status: string;
  uploadedAt: string;
};

/** The business's verification application (draft until submitted). */
export type VerificationApplication = {
  id: string;
  status: VerificationStatus;
  reviewerMessage: string | null;
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
  submittedAt: string | null;
  reviewedAt: string | null;
};

/** Full verification state: the application plus its uploaded documents. */
export type VerificationState = {
  application: VerificationApplication | null;
  documents: VerificationDocument[];
};

/** Editable draft fields for the verification application. */
export type VerificationDraft = {
  legalName?: string | null;
  publicName?: string | null;
  ownerName?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  categoryId?: string | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  registrationInfo?: string | null;
};

/** Reads the verification application + documents for an owned business.
 * The server returns the application object itself (documents nested) or
 * null — never { application, documents }. The client normalizes it to the
 * VerificationState shape the screens consume.
 */
export const getVerification = async (businessId: string): Promise<VerificationState> => {
  type ServerVerificationApplication = VerificationApplication & {
    documents?: { id: string; docType: string; status: string; uploadedAt: string }[] | null;
  };
  const raw = await request<ServerVerificationApplication | null>(`/businesses/${businessId}/verification`, {
    auth: true,
  });
  // The server sends { data: null } when there is no application; request()
  // unwraps a null data to the bare payload object, so anything without an
  // application id counts as "no application".
  const application = raw && typeof raw === 'object' && 'id' in raw ? raw : null;
  if (!application) return { application: null, documents: [] };
  const { documents, ...rest } = application;
  return { application: rest, documents: documents ?? [] };
};

/** Saves draft verification fields (no validation until submit). */
export const updateVerificationDraft = (businessId: string, draft: VerificationDraft) =>
  request<VerificationApplication>(`/businesses/${businessId}/verification`, { method: 'PUT', body: draft, auth: true });

/** Submits the verification application: the server validates required fields + documents. */
export const submitVerification = (businessId: string) =>
  request<VerificationApplication>(`/businesses/${businessId}/verification/submit`, { method: 'POST', auth: true });

/**
 * Uploads a verification document (multipart file + docType). The server
 * stores the bytes and returns the document row — never a public URL.
 */
export async function uploadVerificationDocument(
  businessId: string,
  file: File,
  docType: string,
): Promise<VerificationDocument> {
  const s = getSession();
  const headers: Record<string, string> = {};
  if (s) headers.authorization = `Bearer ${s.accessToken}`;

  let res: Response;
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('docType', docType);
    res = await fetch(`${API_BASE}/businesses/${businessId}/verification/documents`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the NearbyOrders API. Is the API server running?');
  }
  const payload = (await res.json().catch(() => null)) as {
    data?: VerificationDocument;
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    if (res.status === 401 && s) clearAuthState();
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? `Document upload failed (${res.status})`,
    );
  }
  const doc = payload?.data;
  if (!doc?.id) throw new ApiError(500, 'UNKNOWN', 'Document upload returned no document');
  return doc;
}

/* ---------------------------- promotions --------------------------- */

/** One active promotion from the platform catalog. priceMinor and durationDays
 * are optional on the server (Int?) and may come back null. */
export type Promotion = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  benefits: string[];
  priceMinor: number | null;
  currency: string;
  durationDays: number | null;
  requirements: string | null;
  displayOrder: number;
};

/** Mirrors the server's promotion-request status enum. */
export type PromotionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** One promotion request placed by an owned business. */
export type PromotionRequest = {
  id: string;
  promotionId: string;
  promotionName: string | null;
  note: string | null;
  status: PromotionRequestStatus;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

/** Active promotions from the platform catalog (display order). */
export const listPromotions = () => request<Promotion[]>('/promotions');

/** One promotion by slug. */
export const getPromotion = (slug: string) => request<Promotion>(`/promotions/${encodeURIComponent(slug)}`);

/**
 * Promotion request history for an owned business. The server returns the
 * owner DTO — { id, status, note, reviewerMessage, createdAt, reviewedAt,
 * promotion: { id, name, slug } } — which the client normalizes to the
 * PromotionRequest shape (promotionId/promotionName/submittedAt/
 * rejectionReason) the screens consume.
 */
export const listPromotionRequests = async (businessId: string): Promise<PromotionRequest[]> => {
  type ServerPromotionRequest = {
    id: string;
    status: PromotionRequestStatus;
    note: string | null;
    reviewerMessage: string | null;
    createdAt: string;
    reviewedAt: string | null;
    promotion: { id: string; name: string; slug: string };
  };
  const rows = await request<ServerPromotionRequest[]>(`/businesses/${businessId}/promotion-requests`, { auth: true });
  return (rows ?? []).map((r) => ({
    id: r.id,
    promotionId: r.promotion.id,
    promotionName: r.promotion.name,
    note: r.note,
    status: r.status,
    submittedAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    rejectionReason: r.reviewerMessage,
  }));
};

/**
 * Requests a promotion for an owned business. The request stays PENDING for
 * the NearbyOrders team to review — they contact the owner directly; there
 * is no checkout or payment step in the app.
 */
export const requestPromotion = (businessId: string, body: { promotionId: string; note?: string }) =>
  request<PromotionRequest>(`/businesses/${businessId}/promotion-requests`, { method: 'POST', body, auth: true });

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

/* --------------------- unified marketplace search (Phase 14) --------------------- */

/** Mirrors the shared search contract — re-exported here for screen imports. */
export type {
  SearchSort,
  SearchTypeFilter,
  SearchPage,
  SearchResult,
  BusinessSearchResult,
  ServiceSearchResult,
  ProductSearchResult,
} from '@nearbyorders/shared';

/**
 * Unified server-side search across businesses, services, and products.
 * Distance is computed by the server from real coordinates when lat/lng are
 * given; the effective sort is echoed back inside the page (`sort`).
 */
export function searchMarketplace(query: {
  q?: string;
  categoryId?: string;
  type?: 'all' | 'business' | 'service' | 'product';
  openNow?: boolean;
  minRating?: number;
  sort?: 'relevance' | 'distance' | 'rating';
  limit?: number;
  cursor?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<SearchPage> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.type && query.type !== 'all') params.set('type', query.type);
  if (query.openNow !== undefined) params.set('openNow', String(query.openNow));
  if (query.minRating !== undefined) params.set('minRating', String(query.minRating));
  if (query.sort && query.sort !== 'relevance') params.set('sort', query.sort);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.lat !== undefined && query.lng !== undefined) {
    params.set('lat', String(query.lat));
    params.set('lng', String(query.lng));
    if (query.radiusKm !== undefined) params.set('radiusKm', String(query.radiusKm));
  }
  return request<SearchPage>(`/search?${params.toString()}`);
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

/**
 * Owner management reads: the owner's own services without the public
 * APPROVED/active filters, so a PENDING business (or inactive items) never
 * 404s with "Business not found" on the management screens.
 */
export const listOwnerServices = (businessId: string) =>
  request<Service[]>(`/owner/businesses/${businessId}/services`, { auth: true });
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

/** Owner management read: the owner's own products, unfiltered (see listOwnerServices). */
export const listOwnerProducts = (businessId: string) =>
  request<Product[]>(`/owner/businesses/${businessId}/products`, { auth: true });
export const createProduct = (
  businessId: string,
  body: { name: string; description?: string; priceMinor: number; imageUrl?: string },
) => request<Product>(`/businesses/${businessId}/products`, { method: 'POST', body, auth: true });
export const updateProduct = (id: string, patch: Partial<Pick<Product, 'name' | 'description' | 'priceMinor' | 'imageUrl' | 'isActive'>>) =>
  request<Product>(`/products/${id}`, { method: 'PATCH', body: patch, auth: true });
export const deleteProduct = (id: string) => request<void>(`/products/${id}`, { method: 'DELETE', auth: true });

export const getHours = (businessId: string) => request<BusinessHour[]>(`/businesses/${businessId}/hours`);

/** Owner management read: the owner's own hours, unfiltered (see listOwnerServices). */
export const getOwnerHours = (businessId: string) =>
  request<BusinessHour[]>(`/owner/businesses/${businessId}/hours`, { auth: true });
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
  /** Phase 17: DELIVERY address snapshot source — one of the caller's own rows. */
  deliveryAddressId?: string;
}) => request<Order>('/orders', { method: 'POST', body: input, auth: true });

/* ---------------------- favorites (Phase 17) ----------------------- */

export const listFavorites = () => request<FavoriteEntry[]>('/me/favorites', { auth: true });

export const getFavoriteState = (businessId: string) =>
  request<{ saved: boolean }>(`/me/favorites/${businessId}`, { auth: true });

/** Idempotent save. */
export const saveFavorite = (businessId: string) =>
  request<{ saved: boolean }>(`/me/favorites/${businessId}`, { method: 'POST', auth: true });

/** Idempotent unsave. */
export const unsaveFavorite = (businessId: string) =>
  request<{ saved: boolean }>(`/me/favorites/${businessId}`, { method: 'DELETE', auth: true });

/* ---------------------- addresses (Phase 17) ----------------------- */

export const listAddresses = () => request<CustomerAddress[]>('/me/addresses', { auth: true });

export const createAddress = (input: {
  label: string;
  recipientName: string;
  phone?: string | null;
  addressText: string;
  coordinates?: { latitude: number; longitude: number };
  isDefault?: boolean;
}) => request<CustomerAddress>('/me/addresses', { method: 'POST', body: input, auth: true });

export const updateAddress = (
  id: string,
  input: Partial<{ label: string; recipientName: string; phone: string | null; addressText: string; coordinates: { latitude: number; longitude: number } | null; isDefault: boolean }>,
) => request<CustomerAddress>(`/me/addresses/${id}`, { method: 'PATCH', body: input, auth: true });

export const deleteAddress = (id: string) =>
  request<{ deleted: boolean }>(`/me/addresses/${id}`, { method: 'DELETE', auth: true });

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

/* ------------- Business operations & analytics (Phase 16) ------------- */

/** Server-authoritative operational snapshot for one owned business. */
export type OwnerOverview = {
  business: { id: string; name: string; status: string; isVerified: boolean; currency: string; imageUrl: string | null };
  today: { orders: number; bookings: number; revenueMinor: number };
  needsAttention: { pendingOrders: number; pendingBookings: number; pendingPayments: number };
  upcomingBookings: { id: string; serviceName: string | null; customerName: string; date: string; startTime: string; status: BookingStatus }[];
  recentOrders: Order[];
  recentBookings: Booking[];
  /** Persisted fields the business is missing — honest gaps, never invented. */
  profileMissing: string[];
};

export type OwnerAnalyticsPeriod = 'today' | 'week' | 'month';

export type OwnerAnalytics = {
  period: OwnerAnalyticsPeriod;
  window: { from: string; to: string };
  orders: { total: number; completed: number; cancelled: number; revenueMinor: number };
  bookings: { total: number; completed: number; cancelled: number; revenueMinor: number };
  catalog: { activeServices: number; activeProducts: number };
};

/** Collected money only — completed transactions at their frozen values. */
export type OwnerEarnings = {
  currency: string;
  collected: { ordersRevenueMinor: number; bookingsRevenueMinor: number; totalMinor: number; completedOrders: number; completedBookings: number };
  inProgress: { orders: number; valueMinor: number };
  awaitingVerification: { count: number; amountMinor: number };
};

export const getOwnerOverview = (businessId: string) =>
  request<OwnerOverview>(`/owner/businesses/${businessId}/overview`, { auth: true });

export const getOwnerAnalytics = (businessId: string, period: OwnerAnalyticsPeriod) =>
  request<OwnerAnalytics>(`/owner/businesses/${businessId}/analytics?period=${period}`, { auth: true });

export const getOwnerEarnings = (businessId: string) =>
  request<OwnerEarnings>(`/owner/businesses/${businessId}/earnings`, { auth: true });
