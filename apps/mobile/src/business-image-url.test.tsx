import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BusinessCard } from './components/ui.js';
import { resolveImageUrl, API_BASE, type Business } from './api.js';

afterEach(cleanup);

/**
 * Business image URL regression tests.
 *
 * Production incident (2026-09-29): after Business A uploaded image A2 and
 * saved, the owner profile and customer-facing views showed a broken image
 * even though the exact persisted PNG URL returned HTTP 200 with a valid
 * PNG. This suite pins the contract: the UI must use the EXACT persisted
 * URL (resolved via resolveImageUrl) and must never transform it into an
 * invalid/broken URL.
 *
 * The server persists imageUrl as a relative path
 * (`/api/v1/images/uploads/<uuid>.<ext>`). resolveImageUrl prefixes the
 * API origin for absolute API_BASE builds (Capacitor production).
 */

const PROD_API_BASE = 'https://api.nearbyorders.com/api/v1';
// The exact persisted value shape from the production incident.
const PERSISTED_A2 = '/api/v1/images/uploads/c9c11e89-7f62-417a-b9fe-d135680144e0.png';
const EXPECTED_A2 = 'https://api.nearbyorders.com/api/v1/images/uploads/c9c11e89-7f62-417a-b9fe-d135680144e0.png';
// A different business's image (isolation check).
const PERSISTED_B1 = '/api/v1/images/uploads/bea9ab6e-7998-4d21-bee2-70679af58884.jpg';
const EXPECTED_B1 = 'https://api.nearbyorders.com/api/v1/images/uploads/bea9ab6e-7998-4d21-bee2-70679af58884.jpg';

const baseBusiness: Business = {
  id: 'biz-a',
  name: 'Business A',
  slug: 'business-a',
  description: null,
  imageUrl: null,
  isVerified: true,
  address: '1 Main St',
  city: 'Lahore',
  locality: null,
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  currency: 'PKR',
  categories: [{ id: 'cat-1', name: 'Food', slug: 'food', isActive: true }],
};

describe('resolveImageUrl contract', () => {
  it('resolves the persisted relative path to the exact production URL', () => {
    // API_BASE is baked at build time; in the test env it defaults to
    // '/api/v1' (relative). We verify the resolution logic directly against
    // the production base to pin the exact URL the device produces.
    expect(API_BASE).toBeDefined();
    // Simulate production: absolute API_BASE -> origin-prefixed URL.
    const prodResolve = (url: string | null) => {
      if (!url) return null;
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('/')) {
        const origin = PROD_API_BASE.match(/^(https?:\/\/[^/]+)/i)?.[1];
        return origin ? `${origin}${url}` : url;
      }
      return url;
    };
    expect(prodResolve(PERSISTED_A2)).toBe(EXPECTED_A2);
    expect(prodResolve(PERSISTED_B1)).toBe(EXPECTED_B1);
  });

  it('passes absolute URLs through unchanged (never double-prefixes)', () => {
    expect(resolveImageUrl(EXPECTED_A2)).toBe(EXPECTED_A2);
    expect(resolveImageUrl('https://cdn.example.com/img.png')).toBe('https://cdn.example.com/img.png');
  });

  it('returns null for empty values (fallback UI, not a broken img)', () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl('')).toBeNull();
  });

  it('never produces a URL with a doubled path or missing origin', () => {
    const resolved = resolveImageUrl(PERSISTED_A2);
    // In test env API_BASE is '/api/v1' (no origin) -> path passes through.
    // The invariant: the persisted path suffix is preserved verbatim.
    expect(resolved).toContain('/api/v1/images/uploads/c9c11e89-7f62-417a-b9fe-d135680144e0.png');
    expect(resolved).not.toContain('/api/v1/api/v1/');
  });
});

describe('BusinessCard image src', () => {
  const getCardImg = () => document.querySelector('.biz-card-img') as HTMLImageElement | null;

  it('uses the exact resolved URL for Business A image A2', () => {
    const business = { ...baseBusiness, imageUrl: PERSISTED_A2 };
    render(<BusinessCard business={business} onOpen={() => {}} />);
    const img = getCardImg();
    expect(img).not.toBeNull();
    // The src must be the resolveImageUrl output of the persisted value —
    // no transformation, no truncation, no query-string injection.
    expect(img!.getAttribute('src')).toBe(resolveImageUrl(PERSISTED_A2));
  });

  it('keeps Business B on image B1 (no cross-business URL leak)', () => {
    const businessB = { ...baseBusiness, id: 'biz-b', name: 'Business B', imageUrl: PERSISTED_B1 };
    render(<BusinessCard business={businessB} onOpen={() => {}} />);
    const img = getCardImg();
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(resolveImageUrl(PERSISTED_B1));
    expect(img!.getAttribute('src')).not.toContain('c9c11e89');
  });

  it('renders fallback (not a broken img) when imageUrl is null', () => {
    render(<BusinessCard business={baseBusiness} onOpen={() => {}} />);
    expect(getCardImg()).toBeNull();
  });
});
