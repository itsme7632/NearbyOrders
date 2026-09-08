export type Tab = 'Home' | 'Explore' | 'Orders' | 'Bookings' | 'Profile';

export const navigationTabs: Tab[] = ['Home', 'Explore', 'Orders', 'Bookings', 'Profile'];

export type Route =
  | { name: 'tabs' }
  | { name: 'business'; idOrSlug: string }
  | { name: 'owner-dashboard'; businessId?: string };

/** Parses `#/business/<idOrSlug>` and `#/owner` style hash routes. */
export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
  if (clean.startsWith('business/')) {
    const idOrSlug = clean.slice('business/'.length);
    if (idOrSlug) return { name: 'business', idOrSlug };
  }
  if (clean === 'owner') return { name: 'owner-dashboard' };
  return { name: 'tabs' };
}
