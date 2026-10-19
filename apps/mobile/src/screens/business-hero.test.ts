import { describe, expect, it } from 'vitest';
import { heroFitForDimensions } from './BusinessDetail.js';

describe('heroFitForDimensions', () => {
  it('covers landscape photos', () => {
    expect(heroFitForDimensions(1600, 900)).toBe('cover');
    expect(heroFitForDimensions(1200, 800)).toBe('cover');
  });

  it('contains square logos so they are never cropped', () => {
    expect(heroFitForDimensions(500, 500)).toBe('contain');
  });

  it('contains portrait sources (usually logos)', () => {
    expect(heroFitForDimensions(600, 900)).toBe('contain');
    expect(heroFitForDimensions(1080, 1920)).toBe('contain');
  });

  it('covers mildly landscape images near the threshold', () => {
    expect(heroFitForDimensions(1250, 1000)).toBe('cover');
  });

  it('falls back to cover when dimensions are unknown', () => {
    expect(heroFitForDimensions(0, 0)).toBe('cover');
    expect(heroFitForDimensions(-1, 100)).toBe('cover');
  });
});
