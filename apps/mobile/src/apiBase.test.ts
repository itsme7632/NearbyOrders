import { describe, expect, it } from 'vitest';
import { API_BASE } from './api';

describe('API_BASE', () => {
  it('defaults to the same-origin relative path when VITE_API_BASE_URL is unset', () => {
    expect(API_BASE).toBe('/api/v1');
  });
});
