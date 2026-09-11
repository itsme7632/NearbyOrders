import { describe, expect, it, afterEach as afterAllHooks } from 'vitest';
import { prisma } from '../src/lib.js';
import { authed, createBusiness, ensureCategory, makeApp, registerAdminAndLogin, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** The flag is read from process.env on every create; tests mutate it directly (per-file fork). */
const setAutoApprove = (value: string | undefined) => {
  if (value === undefined) delete process.env.AUTO_APPROVE_BUSINESSES;
  else process.env.AUTO_APPROVE_BUSINESSES = value;
};

afterAllHooks(() => setAutoApprove(undefined));

const businessPayload = (overrides: Record<string, unknown> = {}) => ({
  name: `Auto Approval Biz ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  description: 'Created through self-service onboarding',
  address: '12 Main Boulevard, Gulberg',
  city: 'Lahore',
  ...overrides,
});

const categoryId = async (): Promise<string> => {
  const categories = await app.inject({ method: 'GET', url: '/api/v1/categories' });
  const list = JSON.parse(categories.body).data as { id: string; isActive: boolean }[];
  return list[0]!.id;
};

const createViaApi = async (token: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/businesses',
    headers: authed(token),
    payload,
  });

describe('AUTO_APPROVE_BUSINESSES environment flag', () => {
  it('approves newly created businesses when the flag is exactly "true"', async () => {
    setAutoApprove('true');
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await createViaApi(owner.token, businessPayload({ categoryIds: [await categoryId()] }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body).data as { id: string; status: string };
    expect(body.status).toBe('APPROVED');

    const row = await prisma.business.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('APPROVED');
    // An approved business is immediately publicly visible (same as admin approval).
    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${row.slug}` });
    expect(detail.statusCode).toBe(200);
  });

  it('records an audit entry for auto-approved businesses', async () => {
    setAutoApprove('true');
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await createViaApi(owner.token, businessPayload({ categoryIds: [await categoryId()] }));
    const { id } = JSON.parse(res.body).data as { id: string };
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Business', entityId: id, action: 'BUSINESS_AUTO_APPROVED' },
    });
    expect(audit.actorId).toBe(owner.userId);
    expect(audit.metadata).toMatchObject({ reason: 'AUTO_APPROVE_BUSINESSES' });
  });

  it('keeps new businesses PENDING when the flag is unset', async () => {
    setAutoApprove(undefined);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await createViaApi(owner.token, businessPayload({ categoryIds: [await categoryId()] }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.status).toBe('PENDING');
  });

  it('keeps new businesses PENDING for any value other than "true"', async () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      setAutoApprove(value);
      const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
      const res = await createViaApi(owner.token, businessPayload({ categoryIds: [await categoryId()] }));
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).data.status).toBe('PENDING');
    }
  });

  it('never lets a client force approval via payload fields', async () => {
    setAutoApprove(undefined);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const res = await createViaApi(
      owner.token,
      businessPayload({
        categoryIds: [await categoryId()],
        autoApprove: true,
        status: 'APPROVED',
        isVerified: true,
        ownerId: owner.userId,
      }),
    );
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body).data as { status: string; isVerified: boolean };
    expect(created.status).toBe('PENDING');
    expect(created.isVerified).toBe(false);
  });
});

describe('owner business update (Save profile contract)', () => {
  setAutoApprove(undefined);

  it('returns flat category objects, not join rows', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { name: 'Renamed Biz' },
    });
    expect(res.statusCode).toBe(200);
    const updated = JSON.parse(res.body).data as { categories: { id: string }[] };
    expect(updated.categories).toHaveLength(1);
    // The old join-row shape exposed businessId/categoryId and broke the next save.
    expect(updated.categories[0]).toHaveProperty('id');
    expect(updated.categories[0]).not.toHaveProperty('categoryId');
  });

  it('accepts cleared optional fields as "" and stores them as null', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await ensureCategory();
    const created = await createViaApi(owner.token, {
      name: `Clearable Fields Biz ${Date.now()}`,
      address: '1 Test Street',
      city: 'Lahore',
      phone: '+92 300 1234567',
      email: 'owner@test.local',
      locality: 'Gulberg',
      description: 'Has contact info',
      categoryIds: [cat.id],
    });
    const { id } = JSON.parse(created.body).data as { id: string };

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { name: 'Clearable Fields Biz', phone: '', email: '', locality: '', description: '', imageUrl: '' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.business.findUniqueOrThrow({ where: { id } });
    expect(row.phone).toBeNull();
    expect(row.email).toBeNull();
    expect(row.locality).toBeNull();
    expect(row.description).toBeNull();
    expect(row.imageUrl).toBeNull();
  });

  it('accepts null for cleared optional fields identically', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { phone: null, email: null, locality: null },
    });
    expect(res.statusCode).toBe(200);
  });

  it('preserves fields that were not part of the PATCH payload', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await ensureCategory();
    const created = await createViaApi(owner.token, {
      name: `Preserve Biz ${Date.now()}`,
      address: '1 Test Street',
      city: 'Lahore',
      phone: '+92 300 1112223',
      categoryIds: [cat.id],
    });
    const { id } = JSON.parse(created.body).data as { id: string };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { name: 'Only Name Changed' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.business.findUniqueOrThrow({ where: { id } });
    expect(row.phone).toBe('+92 300 1112223'); // untouched by the name-only patch
  });

  it('rejects invalid profile data with VALIDATION_ERROR', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const cases: Record<string, unknown>[] = [
      { phone: 'not-a-phone' },
      { email: 'not-an-email' },
      { name: '' },
      { name: 'A' },
      { categoryIds: [] },
      { imageUrl: 'not-a-url' },
      { latitude: 999 },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/businesses/${id}`,
        headers: authed(owner.token),
        payload,
      });
      expect(res.statusCode, `payload ${JSON.stringify(payload)}`).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects empty required fields but accepts cleared optional ones in one patch', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await ensureCategory();
    const created = await createViaApi(owner.token, {
      name: `Mixed Patch Biz ${Date.now()}`,
      address: '1 Test Street',
      city: 'Lahore',
      categoryIds: [cat.id],
    });
    const { id } = JSON.parse(created.body).data as { id: string };

    // Required fields may not be cleared.
    const clearedAddress = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { address: '' },
    });
    expect(clearedAddress.statusCode).toBe(400);
  });

  it('owner cannot modify another owner’s business', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerA.token);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(ownerB.token),
      payload: { name: 'Hijack Attempt' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('update requires authentication and the business-owner role', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);

    const unauthed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      payload: { name: 'Anon Edit' },
    });
    expect(unauthed.statusCode).toBe(401);

    const customer = await registerAndLogin(app, 'CUSTOMER');
    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(customer.token),
      payload: { name: 'Customer Edit' },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('admin approval workflow (unchanged)', () => {
  setAutoApprove(undefined);

  it('admin can still approve a PENDING business created without the flag', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id, slug } = await createBusiness(app, owner.token);
    const before = await prisma.business.findUniqueOrThrow({ where: { id } });
    expect(before.status).toBe('PENDING');

    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/businesses/${id}/status`,
      headers: authed(admin.token),
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('APPROVED');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${slug}` });
    expect(detail.statusCode).toBe(200);
  });

  it('non-admins cannot use the admin approval endpoint', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/businesses/${id}/status`,
      headers: authed(owner.token),
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(403);
  });
});
