import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, uniqueEmail, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

const PASSWORD = 'Str0ngPassphrase!42';

async function registerOwner() {
  const email = uniqueEmail('refresh-owner');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: PASSWORD, role: 'BUSINESS_OWNER' },
  });
  expect(reg.statusCode).toBe(201);
  // These fixtures exercise refresh-token behavior, not email verification.
  // Mark the test account verified so the new production auth gate does not
  // change the contract of this pre-existing test suite.
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return { email };
}

async function login(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data as { accessToken: string; refreshToken: string; user: { id: string; role: string } };
}

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

describe('persistent login (opaque refresh tokens)', () => {
  it('login issues access + refresh tokens and stores only a hash', async () => {
    const { email } = await registerOwner();
    const data = await login(email, PASSWORD);
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.refreshToken.length).toBeGreaterThanOrEqual(32);
    expect(data.accessToken).not.toBe(data.refreshToken);
    // Only a hash is stored — the raw token must not appear anywhere in the DB.
    const rows = await prisma.refreshToken.findMany({ where: { userId: data.user.id }, select: { tokenHash: true } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row.tokenHash).not.toContain(data.refreshToken);
  });

  it('refresh rotates: returns new tokens and the old refresh token dies', async () => {
    const { email } = await registerOwner();
    const first = await login(email, PASSWORD);
    const res = await refresh(first.refreshToken);
    expect(res.statusCode).toBe(200);
    const second = res.json().data as { accessToken: string; refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // The rotated-out token is rejected (replay of a stolen token fails).
    const replay = await refresh(first.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('INVALID_REFRESH');
    // The new token still works.
    expect((await refresh(second.refreshToken)).statusCode).toBe(200);
  });

  it('refresh rejects garbage tokens and malformed bodies', async () => {
    const bad = await refresh('not-a-real-token');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_REFRESH');
    const empty = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('refresh rejects an expired token', async () => {
    const { email } = await registerOwner();
    const data = await login(email, PASSWORD);
    await prisma.refreshToken.updateMany({
      where: { userId: data.user.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await refresh(data.refreshToken);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH');
  });

  it('refresh rejects the token of a suspended user', async () => {
    const { email } = await registerOwner();
    const data = await login(email, PASSWORD);
    await prisma.user.update({ where: { id: data.user.id }, data: { isSuspended: true } });
    const res = await refresh(data.refreshToken);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH');
    await prisma.user.update({ where: { id: data.user.id }, data: { isSuspended: false } });
  });

  it('logout with a token revokes just that session; logout without revokes all', async () => {
    const { email } = await registerOwner();
    const first = await login(email, PASSWORD);
    const second = await login(email, PASSWORD);
    // Single-session logout.
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authed(first.accessToken),
      payload: { refreshToken: first.refreshToken },
    });
    expect(out.statusCode).toBe(204);
    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    expect((await refresh(second.refreshToken)).statusCode).toBe(200);
    // Sign out everywhere.
    const third = await login(email, PASSWORD);
    const everywhere = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authed(third.accessToken) });
    expect(everywhere.statusCode).toBe(204);
    expect((await refresh(second.refreshToken)).statusCode).toBe(401);
    expect((await refresh(third.refreshToken)).statusCode).toBe(401);
  });

  it('logout requires authentication', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout' })).statusCode).toBe(401);
  });

  it('password change revokes outstanding refresh tokens', async () => {
    const { email } = await registerOwner();
    const data = await login(email, PASSWORD);
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      headers: authed(data.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: 'NewStr0ngPassphrase!43' },
    });
    expect(changed.statusCode).toBe(204);
    expect((await refresh(data.refreshToken)).statusCode).toBe(401);
    // The new password still works.
    const relogin = await login(email, 'NewStr0ngPassphrase!43');
    expect((await refresh(relogin.refreshToken)).statusCode).toBe(200);
  });
});
