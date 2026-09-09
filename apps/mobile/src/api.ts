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
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed (${res.status})`);
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
  description: string | null;
  imageUrl: string | null;
  isVerified: boolean;
  address: string;
  city: string;
  locality: string | null;
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

/* --------------------------- categories ---------------------------- */

export const listCategories = () => request<Category[]>('/categories');

export const listAdminCategories = () => request<(Category & { _count: { businesses: number } })[]>('/admin/categories', { auth: true });

export const createCategory = (name: string) => request<Category>('/admin/categories', { method: 'POST', body: { name }, auth: true });

export const updateCategory = (id: string, patch: { name?: string; isActive?: boolean }) =>
  request<Category>(`/admin/categories/${id}`, { method: 'PATCH', body: patch, auth: true });

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

export const updateBusiness = (
  id: string,
  patch: Partial<{ name: string; description: string; phone: string; email: string; address: string; city: string; locality: string; imageUrl: string; categoryIds: string[] }>,
) => request<Business>(`/businesses/${id}`, { method: 'PATCH', body: patch, auth: true });

/* ------------------- services / products / hours ------------------- */

export const listServices = (businessId: string) => request<Service[]>(`/businesses/${businessId}/services`);
export const createService = (
  businessId: string,
  body: { name: string; description?: string; priceMinor: number; durationMinutes?: number },
) => request<Service>(`/businesses/${businessId}/services`, { method: 'POST', body, auth: true });
export const updateService = (id: string, patch: Partial<Pick<Service, 'name' | 'description' | 'priceMinor' | 'durationMinutes' | 'isActive'>>) =>
  request<Service>(`/services/${id}`, { method: 'PATCH', body: patch, auth: true });
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
