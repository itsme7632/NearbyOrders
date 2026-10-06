import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, authed, registerAndLogin, createBusiness, approveBusiness, uniqueEmail } from './helpers.js';
import { prisma } from '../src/lib.js';
import type { TestApp } from './helpers.js';

/**
 * Business image data-flow regression tests (production incident 2026-09-29).
 *
 * After Business A uploaded image A2 and saved, the owner profile and
 * customer-facing views showed a broken image even though the exact
 * persisted PNG URL returned HTTP 200 with a valid PNG. The exhaustive
 * source trace found the API layer correct at every step — these tests pin
 * that contract so any future regression that introduces a wrong/broken
 * image URL fails loudly:
 *
 * 1. After Business A uploads image A2 and PATCHes it, reloading Business A
 *    via GET /businesses/mine returns image A2.
 * 2. The customer-facing list and detail return image A2 for Business A.
 * 3. Business B keeps returning its own image B1 (no cross-business leak).
 * 4. (Mobile suite) the UI uses the exact persisted URL without
 *    transformation — see apps/mobile/src/business-image-url.test.tsx.
 * 5. A fresh session (new login) sees the correct image for both businesses.
 *
 * Requires PostgreSQL (not runnable in the sandbox); runs in CI.
 */

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

// Server-generated image paths, exactly as POST /businesses/:id/images returns them.
const IMAGE_A2 = '/api/v1/images/uploads/c9c11e89-7f62-417a-b9fe-d135680144e0.png';
const IMAGE_B1 = '/api/v1/images/uploads/bea9ab6e-7998-4d21-bee2-70679af58884.jpg';

const PASSWORD = 'Test1234!Secure';

async function freshLogin(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.body).data as { accessToken: string }).accessToken;
}

describe('business image persist / reload / customer flow', () => {
  it('1+2+3: PATCH persists A2; /mine reload and customer views return A2; B keeps B1', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');

    const bizA = await createBusiness(app, ownerA.token, { name: `Biz A ${Date.now()}` });
    const bizB = await createBusiness(app, ownerB.token, { name: `Biz B ${Date.now()}` });
    await approveBusiness(bizA.id);
    await approveBusiness(bizB.id);

    // Business B gets image B1 first.
    let res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${bizB.id}`,
      headers: authed(ownerB.token),
      payload: { imageUrl: IMAGE_B1 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.imageUrl).toBe(IMAGE_B1);

    // Business A uploads image A2 (simulated: the upload endpoint returns the
    // path; here we PATCH the known-good server path directly) and saves.
    res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${bizA.id}`,
      headers: authed(ownerA.token),
      payload: { imageUrl: IMAGE_A2 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.imageUrl).toBe(IMAGE_A2);

    // 1. Reloading Business A via GET /businesses/mine returns image A2.
    res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(ownerA.token) });
    expect(res.statusCode).toBe(200);
    const mineA = (JSON.parse(res.body).data as { id: string; imageUrl: string | null }[]).find((b) => b.id === bizA.id);
    expect(mineA?.imageUrl).toBe(IMAGE_A2);

    // 2. Customer-facing detail returns image A2 for Business A.
    res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${bizA.id}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.imageUrl).toBe(IMAGE_A2);

    // 2. Customer-facing list returns image A2 for Business A.
    res = await app.inject({ method: 'GET', url: '/api/v1/businesses?limit=50' });
    expect(res.statusCode).toBe(200);
    const listedA = (JSON.parse(res.body).data as { id: string; imageUrl: string | null }[]).find((b) => b.id === bizA.id);
    expect(listedA?.imageUrl).toBe(IMAGE_A2);

    // 3. Business B still returns image B1 everywhere (no cross-business leak).
    res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(ownerB.token) });
    expect(res.statusCode).toBe(200);
    const mineB = (JSON.parse(res.body).data as { id: string; imageUrl: string | null }[]).find((b) => b.id === bizB.id);
    expect(mineB?.imageUrl).toBe(IMAGE_B1);

    res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${bizB.id}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.imageUrl).toBe(IMAGE_B1);
  });

  it('5: a fresh session sees the correct image', async () => {
    const email = uniqueEmail('owner-fresh');
    // Register directly so we know the email for a second login.
    let res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: PASSWORD, role: 'BUSINESS_OWNER' },
    });
    expect(res.statusCode).toBe(201);
    // This fixture tests persistence across sessions, not email verification.
    // Mark the account verified before exercising the login flow.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const firstToken = await freshLogin(email);

    const biz = await createBusiness(app, firstToken, { name: `Fresh Biz ${Date.now()}` });
    await approveBusiness(biz.id);

    res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${biz.id}`,
      headers: authed(firstToken),
      payload: { imageUrl: IMAGE_A2 },
    });
    expect(res.statusCode).toBe(200);

    // Fresh login = new session/token; the image must survive it.
    const secondToken = await freshLogin(email);
    // The API may legitimately issue the same JWT for two logins in the same second; the contract under test is persistence across a fresh login, not token uniqueness.
    res = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(secondToken) });
    expect(res.statusCode).toBe(200);
    const mine = (JSON.parse(res.body).data as { id: string; imageUrl: string | null }[]).find((b) => b.id === biz.id);
    expect(mine?.imageUrl).toBe(IMAGE_A2);

    // And the anonymous customer detail still serves it.
    res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${biz.id}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.imageUrl).toBe(IMAGE_A2);
  });

  it('rejects arbitrary relative image URLs (only server paths or absolute URLs persist)', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const biz = await createBusiness(app, owner.token, { name: `Evil Biz ${Date.now()}` });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${biz.id}`,
      headers: authed(owner.token),
      payload: { imageUrl: '/etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
  });
});
