import { describe, expect, it } from 'vitest';
import { businessTabs, navigationTabs, ownerScreens, parseHash, customerConceptTabs, conceptTabTarget, isActivityTab } from './navigation.js';

describe('customer navigation', () => {
  it('exposes the required V1 destinations in order', () => {
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

  it('requires the exact dedicated route format (never a payments hub)', () => {
    expect(parseHash('#/owner/biz-1/payments')).toEqual({ name: 'owner-screen', screen: 'payments', businessId: 'biz-1' });
    expect(parseHash('#/owner/payments-hub')).toEqual({ name: 'tabs' });
  });
});

describe('Warm Proximity navigation architecture (Phase 1)', () => {
  it('maps every conceptual tab to a concrete Phase-1 destination', () => {
    expect(customerConceptTabs).toEqual(['Home', 'Explore', 'Activity', 'Saved', 'Account']);
    expect(conceptTabTarget).toEqual({
      Home: 'Home',
      Explore: 'Explore',
      Activity: 'Orders',
      Saved: '/saved-businesses',
      Account: 'Profile',
    });
  });

  it('keeps the concrete tab set and deep links unchanged', () => {
    // Activity is a future composition; Orders/Bookings tabs still render.
    expect(navigationTabs).toEqual(['Home', 'Explore', 'Orders', 'Bookings', 'Profile']);
    expect(isActivityTab('Orders')).toBe(true);
    expect(isActivityTab('Bookings')).toBe(true);
    expect(isActivityTab('Home')).toBe(false);
    // Saved stays a working hash route even before it becomes a tab.
    expect(parseHash('#/saved-businesses')).toEqual({ name: 'saved-businesses' });
    expect(parseHash('#/order/ord-1')).toEqual({ name: 'order', orderId: 'ord-1' });
    expect(parseHash('#/booking/bkg-1')).toEqual({ name: 'booking', bookingId: 'bkg-1' });
  });
});
