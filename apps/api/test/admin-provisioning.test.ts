import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, makeApp, registerAndLogin, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { createAdminAccount } from '../scripts/create-admin.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

/** Mirrors the registration helper's passphrase so logins reuse one strong value. */
const STRONG = 'Str0ngPassphrase!42';
const uniqueAdminEmail = () => `create-admin-${Date.now()}-${Math.floor(Math.random() * 1e9)}@test.local`;

describe('secure admin provisioning (createAdminAccount)', () => {
  it('creates an ADMIN whose login reaches the dashboard; plaintext is never stored', async () => {
    const email = uniqueAdminEmail();
    const result = await createAdminAccount(email, STRONG);
    expect(result.created).toBe(true);
    expect(result.role).toBe('ADMIN');

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.role).toBe('ADMIN');
    // Only the Argon2id hash is stored — never the plaintext.
    expect(row.passwordHash).not.toContain(STRONG);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);

    // The provisioned credentials log in through the normal endpoint…
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: STRONG } });
    expect(login.statusCode).toBe(200);
    const token = JSON.parse(login.body).data.accessToken as string;

    // …and the resulting session reaches the admin dashboard.
    const dashboard = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: authed(token) });
    expect(dashboard.statusCode).toBe(200);

    // Provisioning is attributable, and the audit trail holds no secret material.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId: row.id, action: 'ADMIN_CREATED' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(STRONG);
  });

  it('refuses to touch an existing account: role and password stay untouched', async () => {
    const existing = await registerAndLogin(app, 'CUSTOMER');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });

    const result = await createAdminAccount(before.email, 'AnotherPassphrase!9');
    expect(result.created).toBe(false);
    expect(result.existingRole).toBe('CUSTOMER');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    expect(after.role).toBe(before.role);
    expect(after.passwordHash).toBe(before.passwordHash);

    // The refusal is audit-logged against the existing user.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ADMIN_INVITE_EXISTS', entityId: existing.userId } });
    expect(audit.entityType).toBe('User');
  });

  it('enforces the same password policy as registration and creates nothing on failure', async () => {
    const email = uniqueAdminEmail();
    await expect(createAdminAccount(email, 'short')).rejects.toThrow(/Validation failed/);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('normalizes the email like registration does (trim + lowercase)', async () => {
    const mixed = `Mixed-Case-${Date.now()}@Test.Local`;
    const result = await createAdminAccount(`  ${mixed}  `, STRONG);
    expect(result.created).toBe(true);
    expect(result.email).toBe(mixed.toLowerCase());
    expect(await prisma.user.findUnique({ where: { email: mixed.toLowerCase() } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { email: mixed } })).toBeNull();
  });
});

describe('admin authorization boundaries (unchanged by provisioning)', () => {
  it('public registration still rejects role ADMIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: uniqueAdminEmail(), password: STRONG, role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.details.fieldErrors.role[0]).toContain('ADMIN');
  });

  it('customers and business owners still cannot reach admin endpoints', async () => {
    for (const role of ['CUSTOMER', 'BUSINESS_OWNER'] as const) {
      const u = await registerAndLogin(app, role);
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: authed(u.token) });
      expect([401, 403]).toContain(res.statusCode);
    }
  });
});
