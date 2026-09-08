import { describe, expect, it } from 'vitest';
import { navigationTabs } from './navigation.js';

describe('customer navigation', () => {
  it('exposes the required V1 destinations in order', () => {
    expect(navigationTabs).toEqual(['Home', 'Explore', 'Orders', 'Bookings', 'Profile']);
  });
});
