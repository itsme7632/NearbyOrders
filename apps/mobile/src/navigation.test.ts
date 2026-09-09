import { describe, expect, it } from 'vitest';
import { navigationTabs, parseHash } from './navigation.js';

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
