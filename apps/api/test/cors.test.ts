import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

// Mirror the deployed VPS configuration: the Capacitor WebView origin
// (androidScheme 'http' => http://localhost) must be an allowed origin.
process.env.CORS_ORIGIN = 'http://localhost:5173,http://localhost';

const app = await makeApp();

describe('CORS preflight for mutating endpoints', () => {
  it('advertises PATCH/PUT/DELETE so WebView clients can call them cross-origin', async () => {
    // Regression: the preflight used to answer
    // Access-Control-Allow-Methods: GET,HEAD,POST, so every PATCH/PUT/DELETE
    // from the Android WebView (e.g. Save changes on the profile screen) was
    // blocked by the browser and surfaced as NETWORK_ERROR.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/profile',
      headers: {
        origin: 'http://localhost',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    const allowMethods = String(res.headers['access-control-allow-methods'] ?? '');
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowMethods).toContain(method);
    }
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost');
    expect(String(res.headers['access-control-allow-headers'] ?? '')).toContain('authorization');
  });
});
