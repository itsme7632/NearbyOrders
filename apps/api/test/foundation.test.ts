import { describe, expect, it } from 'vitest';
import { allowedTransitions, slugify } from '../src/lib.js';

describe('API foundation rules', () => {
  it('creates stable URL slugs', () => {
    expect(slugify('  Zahid’s Cake & Catering! ')).toBe('zahid-s-cake-catering');
  });

  it('allows only defined booking and order transitions', () => {
    expect(allowedTransitions.booking.PENDING).toContain('CONFIRMED');
    expect(allowedTransitions.booking.COMPLETED).toEqual([]);
    expect(allowedTransitions.order.ACCEPTED).toContain('PREPARING');
    expect(allowedTransitions.order.REJECTED).toEqual([]);
  });
});
