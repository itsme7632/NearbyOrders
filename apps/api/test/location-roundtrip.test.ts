import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, ensureCategory, makeApp, registerAndLogin, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

/**
 * Phase 12.1 coordinate round-trip: the owner's saved coordinates must reach
 * the customer-facing business profile unchanged — no rounding, no city-centre
 * fallback, no client-side recomputation. The backend value is authoritative.
 */
describe('location round trip (owner save → customer view)', () => {
  it('returns the exact saved coordinates through the public business endpoint', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);

    // Deliberately unround coordinates (beyond typical display precision).
    const SAVED = { latitude: 31.520412, longitude: 74.358723 };
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(owner.token),
      payload: SAVED,
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body).data).toMatchObject({ ...SAVED, isConfigured: true });

    await approveBusiness(id);

    // What a customer's Business Profile receives:
    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(detail.statusCode).toBe(200);
    const data = JSON.parse(detail.body).data as { latitude: number; longitude: number };
    expect(data.latitude).toBe(SAVED.latitude);
    expect(data.longitude).toBe(SAVED.longitude);

    // The stored row itself (what every discovery query reads) keeps the
    // exact value — Decimal, compared numerically.
    const row = await prisma.business.findUniqueOrThrow({ where: { id }, select: { latitude: true, longitude: true } });
    expect(Number(row.latitude)).toBe(SAVED.latitude);
    expect(Number(row.longitude)).toBe(SAVED.longitude);

    // Clearing removes the coordinates everywhere — nothing lingers.
    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(owner.token),
      payload: null,
    });
    expect(cleared.statusCode).toBe(200);
    const afterClear = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    const clearedData = JSON.parse(afterClear.body).data as { latitude: unknown; longitude: unknown };
    expect(clearedData.latitude).toBeNull();
    expect(clearedData.longitude).toBeNull();
  });

  it('locations are per business: two owned businesses never share coordinates', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: categoryId } = await ensureCategory();
    const create = async (name: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/businesses',
        headers: authed(owner.token),
        payload: {
          name,
          description: 'multi-business location fixture',
          address: '1 Location Street',
          city: 'Lahore',
          categoryIds: [categoryId],
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = JSON.parse(res.body).data as { id: string };
      return id;
    };
    const a = await create(`Multi A ${Date.now()}`);
    const b = await create(`Multi B ${Date.now()}`);

    await app.inject({ method: 'PUT', url: `/api/v1/businesses/${a}/location`, headers: authed(owner.token), payload: { latitude: 31.1, longitude: 74.1 } });
    await app.inject({ method: 'PUT', url: `/api/v1/businesses/${b}/location`, headers: authed(owner.token), payload: { latitude: 33.6, longitude: 73.0 } });

    const ra = await app.inject({ method: 'GET', url: `/api/v1/businesses/${a}/location`, headers: authed(owner.token) });
    const rb = await app.inject({ method: 'GET', url: `/api/v1/businesses/${b}/location`, headers: authed(owner.token) });
    expect(JSON.parse(ra.body).data.latitude).toBe(31.1);
    expect(JSON.parse(rb.body).data.latitude).toBe(33.6);
  });
});
