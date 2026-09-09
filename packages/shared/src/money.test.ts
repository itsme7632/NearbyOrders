import { describe, expect, it } from 'vitest';
import { formatMoney, MINOR_UNITS_PER_MAJOR } from './money.js';

describe('formatMoney (integer minor units)', () => {
  it('divides minor units by 100 for display', () => {
    // 65000 paisa = Rs 650 — the scale used by the seed and API tests.
    expect(formatMoney(65000)).toContain('650');
    expect(formatMoney(45000)).toContain('450');
    expect(formatMoney(45050)).toContain('450.5');
    expect(formatMoney(120000)).toContain('1,200');
  });

  it('never shows fractional paisa or floating artifacts', () => {
    expect(formatMoney(1)).toContain('0.01');
    expect(formatMoney(0)).toContain('0');
  });

  it('exposes the minor-unit conversion constant', () => {
    expect(MINOR_UNITS_PER_MAJOR).toBe(100);
  });
});
