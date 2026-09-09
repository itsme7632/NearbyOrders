export type Tab = 'Home' | 'Explore' | 'Orders' | 'Bookings' | 'Profile';

export const navigationTabs: Tab[] = ['Home', 'Explore', 'Orders', 'Bookings', 'Profile'];

export type Route =
  | { name: 'tabs' }
  | { name: 'business'; idOrSlug: string }
  | { name: 'book'; businessId: string; serviceId?: string }
  | { name: 'booking'; bookingId: string }
  | { name: 'owner-dashboard'; justCreated?: boolean; justCreatedName?: string }
  | { name: 'create-business' };

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
  if (clean === 'create-business') return { name: 'create-business' };
  if (clean === 'owner') {
    const created = new URLSearchParams(queryPart ?? '').get('created');
    return created
      ? { name: 'owner-dashboard', justCreated: true, justCreatedName: created }
      : { name: 'owner-dashboard' };
  }
  return { name: 'tabs' };
}
