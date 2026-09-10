import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { authed, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const STRONG = 'Str0ngPassphrase!42';

describe('PATCH /auth/profile', () => {
  it("updates the signed-in user's own first name, last name and phone", async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: authed(token),
      payload: { firstName: 'Ayesha', lastName: 'Khan', phone: '+92 300 1234567' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data as { firstName: string; lastName: string; phone: string };
    expect(body).toMatchObject({ firstName: 'Ayesha', lastName: 'Khan', phone: '+92 300 1234567' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.firstName).toBe('Ayesha');
    expect(row.phone).toBe('+92 300 1234567');
  });

  it('clears optional fields when sent null and rejects invalid phone', async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: authed(token),
      payload: { firstName: 'Temp', phone: '+92 311 0000000' },
    });
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: authed(token),
      payload: { firstName: null, phone: null },
    });
    expect(cleared.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.firstName).toBeNull();
    expect(row.phone).toBeNull();

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: authed(token),
      payload: { phone: 'not-a-phone' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requires authentication and rejects empty payloads', async () => {
    const anon = await app.inject({ method: 'PATCH', url: '/api/v1/auth/profile', payload: { firstName: 'X' } });
    expect(anon.statusCode).toBe(401);

    const { token } = await registerAndLogin(app, 'CUSTOMER');
    const empty = await app.inject({ method: 'PATCH', url: '/api/v1/auth/profile', headers: authed(token), payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('never changes the email address', async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
    // Even a hostile payload carrying an email field cannot change it
    // (Zod strips unknown keys).
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: authed(token),
      payload: { firstName: 'Keep', email: 'attacker@evil.test' },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.email).toBe(before);
  });
});

describe('PATCH /auth/password', () => {
  it('changes the password after re-proving the current one and revokes refresh tokens', async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    const sessionRow = await prisma.refreshToken.create({
      data: { userId, tokenHash: `hash-${userId}-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      headers: authed(token),
      payload: { currentPassword: STRONG, newPassword: 'Another$trongPass99' },
    });
    expect(res.statusCode).toBe(204);

    const revoked = await prisma.refreshToken.findUniqueOrThrow({ where: { id: sessionRow.id } });
    expect(revoked.revokedAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const correctLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'Another$trongPass99' },
    });
    expect(correctLogin.statusCode).toBe(200);
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: STRONG },
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it('rejects a wrong current password without touching the stored hash', async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      headers: authed(token),
      payload: { currentPassword: 'WrongPassword!123', newPassword: 'Another$trongPass99' },
    });
    expect(res.statusCode).toBe(400);
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
    expect(after).toBe(before);
  });

  it('enforces the password strength bar and authentication', async () => {
    const { token } = await registerAndLogin(app, 'CUSTOMER');
    const weak = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      headers: authed(token),
      payload: { currentPassword: STRONG, newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      payload: { currentPassword: STRONG, newPassword: 'Another$trongPass99' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('writes a PASSWORD_CHANGED audit entry without recording any password material', async () => {
    const { token, userId } = await registerAndLogin(app, 'CUSTOMER');
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/password',
      headers: authed(token),
      payload: { currentPassword: STRONG, newPassword: 'Another$trongPass99' },
    });
    const entry = await prisma.auditLog.findFirst({ where: { actorId: userId, action: 'PASSWORD_CHANGED' } });
    expect(entry).not.toBeNull();
    expect(JSON.stringify(entry?.metadata ?? {})).not.toContain(STRONG);
  });
});
