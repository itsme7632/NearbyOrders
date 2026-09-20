export type Tab = 'Home' | 'Explore' | 'Orders' | 'Bookings' | 'Profile';

/** Tab set for Business mode: its own navigation, never the customer one. */
export const businessTabs = ['Overview', 'Orders', 'Bookings', 'Earnings', 'Profile'] as const;
export type BusinessTab = (typeof businessTabs)[number];

/** Dedicated Business Dashboard management screens (each its own route). */
export const ownerScreens = ['profile', 'hours', 'delivery', 'services', 'products', 'bookings', 'orders', 'payments', 'payment-methods', 'advances', 'reviews', 'subscription', 'settings', 'location'] as const;
export type OwnerScreenName = (typeof ownerScreens)[number];

/** Customer-mode bottom navigation. */
export const navigationTabs: Tab[] = ['Home', 'Explore', 'Orders', 'Bookings', 'Profile'];

/* ------------- Warm Proximity navigation architecture (Phase 1) ------
   Conceptual customer navigation for the Warm Proximity model:
   Home · Explore · Activity · Saved · Account

   Phase 1 establishes the mapping architecture ONLY. Concrete tabs,
   routes and deep links are UNCHANGED: the Orders/Bookings tabs stay
   rendered, and /saved-businesses, /order/:id, /booking/:id keep working.
   Later phases flip the visible tab set against this mapping without
   touching route parsing or notification/push targets. */

/** Conceptual Warm Proximity customer tabs (the future visible tab set). */
export const customerConceptTabs = ['Home', 'Explore', 'Activity', 'Saved', 'Account'] as const;
export type CustomerConceptTab = (typeof customerConceptTabs)[number];

/** Tabs that the future Activity destination composes client-side. */
export const activityTabs = ['Orders', 'Bookings'] as const satisfies readonly Tab[];

/**
 * Maps each conceptual tab to its Phase-1 concrete destination.
 * Tab values render in the bottom nav; string values are hash routes.
 */
export const conceptTabTarget: Record<CustomerConceptTab, Tab | string> = {
  Home: 'Home',
  Explore: 'Explore',
  Activity: 'Orders',
  Saved: '/saved-businesses',
  Account: 'Profile',
};

/** True for tabs that will live under the future Activity destination. */
export function isActivityTab(tab: Tab): boolean {
  return (activityTabs as readonly string[]).includes(tab);
}

export type Route =
  | { name: 'tabs' }
  | { name: 'business'; idOrSlug: string }
  | { name: 'book'; businessId: string; serviceId?: string }
  | { name: 'booking'; bookingId: string }
  | { name: 'cart' }
  | { name: 'order'; orderId: string }
  | { name: 'notifications' }
  | { name: 'search'; initialQuery?: string }
  | { name: 'owner-dashboard'; justCreated?: boolean; justCreatedName?: string; justCreatedStatus?: string }
  | { name: 'owner-screen'; screen: OwnerScreenName; businessId: string }
  | { name: 'create-business' }
  | { name: 'edit-profile' }
  | { name: 'change-password' }
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
