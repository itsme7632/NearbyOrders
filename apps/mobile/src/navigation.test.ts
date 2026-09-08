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
});
