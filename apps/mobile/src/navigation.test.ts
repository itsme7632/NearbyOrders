import { describe, expect, it } from 'vitest';
import { businessTabs, isRouteHash, navigationTabs, ownerScreens, parseHash, resolveTab } from './navigation.js';

describe('customer navigation', () => {
  it('exposes the locked tab set in order', () => {
    expect(navigationTabs).toEqual(['Home', 'Explore', 'Orders', 'Bookings', 'Profile']);
  });
});

describe('hash routing', () => {
  it('defaults to tabs for empty and unknown hashes', () => {
    expect(parseHash('')).toEqual({ name: 'tabs' });
    expect(parseHash('#')).toEqual({ name: 'tabs' });
    expect(parseHash('#/nonsense')).toEqual({ name: 'tabs' });
  });

  it('parses business routes by id or slug', () => {
    expect(parseHash('#/business/abc-123')).toEqual({ name: 'business', idOrSlug: 'abc-123' });
    expect(parseHash('#/business/demo-gulberg-grill?x=1')).toEqual({ name: 'business', idOrSlug: 'demo-gulberg-grill' });
    expect(parseHash('#/business/')).toEqual({ name: 'tabs' });
  });

  it('parses the owner dashboard route', () => {
    expect(parseHash('#/owner')).toEqual({ name: 'owner-dashboard' });
  });

  it('carries post-creation status for the onboarding banner', () => {
    expect(parseHash('#/owner?created=Butt%20Spices&status=APPROVED')).toEqual({
      name: 'owner-dashboard',
      justCreated: true,
      justCreatedName: 'Butt Spices',
      justCreatedStatus: 'APPROVED',
    });
    expect(parseHash('#/owner?created=Butt%20Spices')).toEqual({
      name: 'owner-dashboard',
      justCreated: true,
      justCreatedName: 'Butt Spices',
      justCreatedStatus: undefined,
    });
  });

  it('parses booking flow routes with optional service preselection', () => {
    expect(parseHash('#/book/biz-1')).toEqual({ name: 'book', businessId: 'biz-1', serviceId: undefined });
    expect(parseHash('#/book/biz-1/svc-9')).toEqual({ name: 'book', businessId: 'biz-1', serviceId: 'svc-9' });
    expect(parseHash('#/book/biz-1/svc-9?x=1')).toEqual({ name: 'book', businessId: 'biz-1', serviceId: 'svc-9' });
  });

  it('parses single booking detail routes', () => {
    expect(parseHash('#/booking/bk-42')).toEqual({ name: 'booking', bookingId: 'bk-42' });
    expect(parseHash('#/booking/')).toEqual({ name: 'tabs' });
  });
});

describe('business navigation', () => {
  it('has its own tab set, distinct from the customer set', () => {
    expect(businessTabs).toEqual(['Overview', 'Orders', 'Bookings', 'Earnings', 'Profile']);
    // Business-only destinations never appear in customer navigation.
    expect(navigationTabs).not.toContain('Overview');
    expect(navigationTabs).not.toContain('Earnings');
    // And customer-only destinations never appear in business navigation.
    expect(businessTabs).not.toContain('Home');
    expect(businessTabs).not.toContain('Explore');
  });
});

describe('dedicated owner management screens', () => {
  it('parses /owner/<businessId>/<screen> for every management screen', () => {
    for (const screen of ownerScreens) {
      expect(parseHash(`#/owner/biz-1/${screen}`)).toEqual({ name: 'owner-screen', screen, businessId: 'biz-1' });
    }
  });

  it('falls back to tabs for unknown screens or missing business id', () => {
    expect(parseHash('#/owner/biz-1/nope')).toEqual({ name: 'tabs' });
    expect(parseHash('#/owner//profile')).toEqual({ name: 'tabs' });
    expect(parseHash('#/owner/biz-1')).toEqual({ name: 'tabs' });
  });

  it('registers the riders management screen (rider discoverability)', () => {
    // Regression: the OwnerRiders screen existed but its route was rejected
    // by the parser, so rider management was unreachable.
    expect(ownerScreens).toContain('riders');
    expect(parseHash('#/owner/biz-1/riders')).toEqual({ name: 'owner-screen', screen: 'riders', businessId: 'biz-1' });
  });

  it('requires the exact dedicated route format (never a payments hub)', () => {
    expect(parseHash('#/owner/biz-1/payments')).toEqual({ name: 'owner-screen', screen: 'payments', businessId: 'biz-1' });
    expect(parseHash('#/owner/payments-hub')).toEqual({ name: 'tabs' });
  });
});

describe('locked navigation (Warm Proximity reversal)', () => {
  it('resolves retired Warm Proximity tab values to the locked set', () => {
    expect(resolveTab('Activity')).toBe('Orders');
    expect(resolveTab('Saved')).toBe('Profile');
    expect(resolveTab('Account')).toBe('Profile');
    expect(resolveTab('Home')).toBe('Home');
    expect(resolveTab('Explore')).toBe('Explore');
    expect(resolveTab('Orders')).toBe('Orders');
    expect(resolveTab('Bookings')).toBe('Bookings');
    expect(resolveTab('Profile')).toBe('Profile');
  });

  it('renders Orders, Bookings and Profile as their own tabs', () => {
    // Orders and Bookings are never merged into an Activity composition.
    expect(navigationTabs).toEqual(['Home', 'Explore', 'Orders', 'Bookings', 'Profile']);
    expect(navigationTabs).not.toContain('Activity');
    expect(navigationTabs).not.toContain('Saved');
    expect(navigationTabs).not.toContain('Account');
    // Saved is still a working hash route; deep links unchanged.
    expect(parseHash('#/saved-businesses')).toEqual({ name: 'saved-businesses' });
    expect(parseHash('#/order/ord-1')).toEqual({ name: 'order', orderId: 'ord-1' });
    expect(parseHash('#/booking/bkg-1')).toEqual({ name: 'booking', bookingId: 'bkg-1' });
    // Phase 3D: notification preferences deep link.
    expect(parseHash('#/notification-preferences')).toEqual({ name: 'notification-preferences' });
  });

  it('keeps the floating-action hierarchy disjoint by route (Phase 3J)', () => {
    // CartPill mounts only for route.name === 'tabs'; Business Detail (with
    // its own sticky CTA bar) renders under route.name === 'business'. The
    // two floating actions therefore can never overlap on screen.
    expect(parseHash('#/')).toEqual({ name: 'tabs' });
    expect(parseHash('#/business/gulberg-grill')).toEqual({ name: 'business', idOrSlug: 'gulberg-grill' });
    expect(parseHash('#/business/gulberg-grill').name).not.toBe('tabs');
  });
});

describe('email-auth routes', () => {
  it('parses the four new auth routes', () => {
    expect(parseHash('#/verify-email')).toEqual({ name: 'verify-email' });
    expect(parseHash('#/forgot-password')).toEqual({ name: 'forgot-password' });
    expect(parseHash('#/reset-code')).toEqual({ name: 'reset-code' });
    expect(parseHash('#/new-password')).toEqual({ name: 'new-password' });
  });

  it('does not confuse auth routes with tab or owner routes', () => {
    expect(parseHash('#/verify-email').name).not.toBe('tabs');
    expect(parseHash('#/forgot-password').name).not.toBe('tabs');
  });

  it('isRouteHash accepts real routes and the canonical root only', () => {
    expect(isRouteHash('')).toBe(true);
    expect(isRouteHash('#')).toBe(true);
    expect(isRouteHash('#/')).toBe(true);
    expect(isRouteHash('#/business/butt-spices')).toBe(true);
    expect(isRouteHash('#/book/biz-1/svc-1')).toBe(true);
    expect(isRouteHash('#/cart')).toBe(true);
    expect(isRouteHash('#/search?q=pizza')).toBe(true);
    // Stray fragments are NOT routes: the router must ignore them.
    expect(isRouteHash('#app-content')).toBe(false);
    expect(isRouteHash('#biz-products')).toBe(false);
    expect(isRouteHash('#/no-such-screen')).toBe(false);
  });
});
