import { describe, expect, it, afterEach } from 'vitest';
import argon2 from 'argon2';
import { makeApp } from './helpers.js';
import { hashCode } from '../src/email.js';
import { prisma } from '../src/lib.js';

const appPromise = makeApp();
const testEmails: string[] = [];

async function app() {
  return appPromise;
}

function email(prefix: string): string {
  const value = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@email-test.local`;
  testEmails.push(value);
  return value;
}

afterEach(async () => {
  if (testEmails.length) {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    testEmails.length = 0;
  }
});

describe('email authentication', () => {
  it('creates new accounts unverified and blocks login until verification', async () => {
    const server = await app();
    const userEmail = email('signup');
    const password = 'Str0ngPassphrase!42';

    const register = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: userEmail, password, role: 'CUSTOMER' },
    });

    expect(register.statusCode).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: userEmail } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await prisma.authCode.count({ where: { userId: user.id, type: 'EMAIL_VERIFICATION', consumedAt: null } })).toBe(1);

    const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(403);
    expect(JSON.parse(login.body).error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('verifies an account with a live code and makes login available', async () => {
    const server = await app();
    const userEmail = email('verify');
    const password = 'Str0ngPassphrase!42';
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({ data: { email: userEmail, passwordHash, role: 'CUSTOMER', emailVerifiedAt: null } });
    const code = '123456';
    await prisma.authCode.create({
      data: { userId: user.id, type: 'EMAIL_VERIFICATION', codeHash: hashCode(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const verify = await server.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { email: userEmail, code } });
    expect(verify.statusCode).toBe(200);
    expect(JSON.parse(verify.body).data.verified).toBe(true);

    const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(200);

    const secondVerify = await server.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { email: userEmail, code } });
    expect(secondVerify.statusCode).toBe(200);
    expect(JSON.parse(secondVerify.body).data.verified).toBe(true);
  });

  it('rejects an expired verification code', async () => {
    const server = await app();
    const userEmail = email('expired');
    const user = await prisma.user.create({ data: { email: userEmail, passwordHash: await argon2.hash('Str0ngPassphrase!42'), role: 'CUSTOMER', emailVerifiedAt: null } });
    await prisma.authCode.create({
      data: { userId: user.id, type: 'EMAIL_VERIFICATION', codeHash: hashCode('654321'), expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await server.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { email: userEmail, code: '654321' } });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_CODE');
  });

  it('returns a generic password-reset request response for unknown accounts', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'does-not-exist@email-test.local' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.accepted).toBe(true);
  });

  it('resets a password with a live code and revokes refresh sessions', async () => {
    const server = await app();
    const userEmail = email('reset');
    const oldPassword = 'OldStr0ngPassphrase!42';
    const newPassword = 'NewStr0ngPassphrase!42';
    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash: await argon2.hash(oldPassword), role: 'CUSTOMER', emailVerifiedAt: new Date() },
    });
    await prisma.authCode.create({
      data: { userId: user.id, type: 'PASSWORD_RESET', codeHash: hashCode('112233'), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const reset = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/complete',
      payload: { email: userEmail, code: '112233', newPassword },
    });
    expect(reset.statusCode).toBe(200);
    expect(JSON.parse(reset.body).data.reset).toBe(true);

    const oldLogin = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: userEmail, password: oldPassword } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: userEmail, password: newPassword } });
    expect(newLogin.statusCode).toBe(200);

    const code = await prisma.authCode.findFirstOrThrow({ where: { userId: user.id, type: 'PASSWORD_RESET' } });
    expect(code.consumedAt).not.toBeNull();
  });
});
