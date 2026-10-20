/** Customer tab values. LOCKED navigation: Home · Explore · Orders ·
 * Bookings · Profile. 'Activity', 'Saved' and 'Account' are legacy values
 * from the retired Warm Proximity experiment — still accepted by
 * resolveTab() for persisted tab state, but never rendered in the bottom
 * nav. */
export type Tab = 'Home' | 'Explore' | 'Orders' | 'Bookings' | 'Profile' | 'Activity' | 'Saved' | 'Account';

/** Tab set for Business mode: its own navigation, never the customer one. */
export const businessTabs = ['Overview', 'Orders', 'Bookings', 'Earnings', 'Profile'] as const;
export type BusinessTab = (typeof businessTabs)[number];

/** Dedicated Business Dashboard management screens (each its own route).
 * The subscription area is a real hierarchy: 'subscription' is the summary
 * hub; the five subscription-* routes are dedicated destinations reachable
 * from the hub and from deep links. 'choose-plan' is the legacy alias for
 * the change-plan route. */
export const ownerScreens = ['profile', 'hours', 'delivery', 'riders', 'services', 'products', 'bookings', 'orders', 'payments', 'payment-methods', 'advances', 'reviews', 'subscription', 'subscription-plan', 'subscription-change-plan', 'subscription-payment-methods', 'subscription-make-payment', 'subscription-payment-history', 'choose-plan', 'verification', 'promotions', 'settings', 'location'] as const;
export type OwnerScreenName = (typeof ownerScreens)[number];

/** Customer-mode bottom navigation. LOCKED tab set:
 * Home · Explore · Orders · Bookings · Profile. */
export const navigationTabs: Tab[] = ['Home', 'Explore', 'Orders', 'Bookings', 'Profile'];

/* ------------- Locked navigation (Warm Proximity reversal) ------
   The Warm Proximity experiment (Home · Explore · Activity · Saved ·
   Account) was reversed at the presentation level. The locked customer
   tab set is Home · Explore · Orders · Bookings · Profile. Legacy tab
   values ('Activity', 'Saved', 'Account') are still accepted everywhere a
   Tab is read — use resolveTab() at boundaries — but never render.
   Route parsing and notification/push targets are untouched:
   /saved-businesses, /order/:id, /booking/:id keep working, and the
   Saved/Account destinations remain reachable from the Profile hub. */

/**
 * Normalizes a Tab to the locked set: legacy Warm Proximity values map to
 * their locked home, everything else is identity. Apply at tab-state
 * boundaries (init, setTab wrappers, persisted values).
 */
export function resolveTab(tab: Tab): Tab {
  switch (tab) {
    case 'Activity':
      return 'Orders';
    case 'Saved':
    case 'Account':
      return 'Profile';
    default:
      return tab;
  }
}

export type Route =
  | { name: 'tabs' }
  | { name: 'business'; idOrSlug: string }
  | { name: 'book'; businessId: string; serviceId?: string }
  | { name: 'booking'; bookingId: string }
  | { name: 'cart' }
  | { name: 'order'; orderId: string }
  | { name: 'notifications' }
  | { name: 'notification-preferences' }
  | { name: 'appearance' }
  | { name: 'search'; initialQuery?: string }
  | { name: 'owner-dashboard'; justCreated?: boolean; justCreatedName?: string; justCreatedStatus?: string }
  | { name: 'owner-screen'; screen: OwnerScreenName; businessId: string }
  | { name: 'create-business' }
  | { name: 'edit-profile' }
  | { name: 'change-password' }
  | { name: 'verify-email' }
  | { name: 'forgot-password' }
  | { name: 'reset-code' }
  | { name: 'new-password' }
  | { name: 'saved-businesses' }
  | { name: 'my-reviews' }
  | { name: 'addresses' }
  | { name: 'info'; page: 'help' | 'terms' | 'privacy' | 'about' };

/** Parses `#/business/<idOrSlug>`, `#/book/...`, `#/booking/<id>`, `#/owner`, `#/create-business` style hash routes. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const clean = pathPart;
  if (clean.startsWith('business/')) {
    const idOrSlug = clean.slice('business/'.length);
    if (idOrSlug) return { name: 'business', idOrSlug };
  }
  if (clean.startsWith('book/')) {
    const rest = clean.slice('book/'.length);
    const [businessId, serviceId] = rest.split('/');
    if (businessId) return { name: 'book', businessId, serviceId: serviceId || undefined };
  }
  if (clean.startsWith('booking/')) {
    const bookingId = clean.slice('booking/'.length);
    if (bookingId) return { name: 'booking', bookingId };
  }
  if (clean === 'cart') return { name: 'cart' };
  if (clean === 'notifications') return { name: 'notifications' };
  if (clean === 'notification-preferences') return { name: 'notification-preferences' };
  if (clean === 'appearance') return { name: 'appearance' };
  if (clean === 'search') {
    const params = new URLSearchParams(queryPart ?? '');
    const q = params.get('q');
    return q ? { name: 'search', initialQuery: q } : { name: 'search' };
  }
  if (clean.startsWith('order/')) {
    const orderId = clean.slice('order/'.length);
    if (orderId) return { name: 'order', orderId };
  }
  if (clean === 'create-business') return { name: 'create-business' };
  if (clean === 'edit-profile') return { name: 'edit-profile' };
  if (clean === 'change-password') return { name: 'change-password' };
  if (clean === 'verify-email') return { name: 'verify-email' };
  if (clean === 'forgot-password') return { name: 'forgot-password' };
  if (clean === 'reset-code') return { name: 'reset-code' };
  if (clean === 'new-password') return { name: 'new-password' };
  if (clean === 'saved-businesses') return { name: 'saved-businesses' };
  if (clean === 'my-reviews') return { name: 'my-reviews' };
  if (clean === 'addresses') return { name: 'addresses' };
  if (clean.startsWith('info/')) {
    const page = clean.slice('info/'.length);
    if (page === 'help' || page === 'terms' || page === 'privacy' || page === 'about') return { name: 'info', page };
  }
  if (clean === 'owner') {
    const params = new URLSearchParams(queryPart ?? '');
    const created = params.get('created');
    const status = params.get('status') ?? undefined;
    return created
      ? { name: 'owner-dashboard', justCreated: true, justCreatedName: created, justCreatedStatus: status }
      : { name: 'owner-dashboard' };
  }
  // Business Dashboard sub-screens: /owner/<businessId>/<screen>.
  if (clean.startsWith('owner/')) {
    const [, businessId, screen] = clean.split('/');
    if (businessId && screen && (ownerScreens as readonly string[]).includes(screen)) {
      return { name: 'owner-screen', screen: screen as OwnerScreenName, businessId };
    }
  }
  return { name: 'tabs' };
}

/**
 * True when `hash` is a genuine app route: the canonical root ('' / '#/'),
 * or any hash parseHash resolves to a NAMED route. parseHash falls through
 * to the tabs route for ANY unrecognized value, so a non-empty fragment that
 * is not a named route (an in-page anchor like #app-content, a stray
 * fragment left by the WebView) is NOT a navigation command. The router
 * uses this to refuse stray fragments instead of dumping the user on Home.
 */
export function isRouteHash(hash: string): boolean {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
  if (!clean) return true;
  return parseHash(hash).name !== 'tabs';
}
