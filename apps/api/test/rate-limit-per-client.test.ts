import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

/**
 * Regression test for the mobile Home 429 incident (2026-09-28).
 *
 * Production sits behind host nginx -> container nginx -> api, and the
 * nginx chain sets X-Forwarded-For to the real client IP. The app must
 * trust the proxy so @fastify/rate-limit keys buckets per client IP.
 * Without trustProxy every request shares one 100/min bucket (req.ip is
 * the proxy IP), so a few parallel Home-screen requests from different
 * users exhaust it and everyone gets 429s.
 */
describe('rate limiting is per client IP behind the proxy chain', () => {
  it('exhausting one client bucket does not throttle a different client', async () => {
    const clientA = { 'x-forwarded-for': '203.0.113.7, 127.0.0.1' };
    const clientB = { 'x-forwarded-for': '198.51.100.9, 127.0.0.1' };

    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/categories', headers: clientA });
      expect(res.statusCode).toBe(200);
    }
    const throttled = await app.inject({ method: 'GET', url: '/api/v1/categories', headers: clientA });
    expect(throttled.statusCode).toBe(429);
    // The 429 body must be self-describing: the generic INTERNAL_ERROR body
    // ("An unexpected error occurred") once made throttled requests
    // indistinguishable from server crashes in the admin/mobile clients,
    // which display error.message verbatim.
    const body = throttled.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('RATE_LIMITED');
    expect(body.error?.message).toBe('Too many requests. Please wait a moment and try again.');

    // A different client IP must still have its own full bucket.
    const other = await app.inject({ method: 'GET', url: '/api/v1/categories', headers: clientB });
    expect(other.statusCode).toBe(200);
  }, 60000);
});
