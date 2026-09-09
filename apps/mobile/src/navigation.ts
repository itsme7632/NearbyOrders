export type Tab = 'Home' | 'Explore' | 'Orders' | 'Bookings' | 'Profile';

export const navigationTabs: Tab[] = ['Home', 'Explore', 'Orders', 'Bookings', 'Profile'];

export type Route =
  | { name: 'tabs' }
  | { name: 'business'; idOrSlug: string }
  | { name: 'book'; businessId: string; serviceId?: string }
  | { name: 'booking'; bookingId: string }
  | { name: 'owner-dashboard'; businessId?: string };

/** Parses `#/business/<idOrSlug>`, `#/book/...`, `#/booking/<id>` and `#/owner` style hash routes. */
export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
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
  if (clean === 'owner') return { name: 'owner-dashboard' };
  return { name: 'tabs' };
}
