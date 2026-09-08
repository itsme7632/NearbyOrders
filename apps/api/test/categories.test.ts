import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAdminAndLogin, registerAndLogin } from './helpers.js';

const app = await makeApp();

describe('categories', () => {
  it('lists active categories publicly', async () => {
    await prisma.category.create({ data: { name: `List Cat ${Date.now()}`, slug: `list-cat-${Date.now()}` } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body).data as { id: string }[];
    expect(list.length).toBeGreaterThan(0);
  });

  it('admin creates a category', async () => {
    const { token } = await registerAdminAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers: authed(token),
      payload: { name: `Admin Cat ${Date.now()}` },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.slug).toBeTruthy();
  });

  it('unauthorized users cannot create categories', async () => {
    const { token } = await registerAndLogin(app, 'CUSTOMER');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers: authed(token),
      payload: { name: `Evil Cat ${Date.now()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('anonymous users cannot create categories', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/categories', payload: { name: 'Nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('admin can deactivate and re-activate a category', async () => {
    const { token } = await registerAdminAndLogin(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers: authed(token),
      payload: { name: `Toggle Cat ${Date.now()}` },
    });
    const id = JSON.parse(created.body).data.id as string;

    const off = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/categories/${id}`,
      headers: authed(token),
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect(JSON.parse(off.body).data.isActive).toBe(false);

    const on = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/categories/${id}`,
      headers: authed(token),
      payload: { isActive: true },
    });
    expect(JSON.parse(on.body).data.isActive).toBe(true);
  });

  it('inactive categories disappear from the public list', async () => {
    const { token } = await registerAdminAndLogin(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers: authed(token),
      payload: { name: `Hide Cat ${Date.now()}` },
    });
    const id = JSON.parse(created.body).data.id as string;
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/categories/${id}`, headers: authed(token), payload: { isActive: false } });
    const list = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(JSON.parse(list.body).data.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });
});

describe('business creation and visibility', () => {
  it('owner creates a business and customers see it once approved', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id } = await createBusiness(app, owner.token, { name: `Visible Biz ${Date.now()}` });

    const before = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(before.statusCode).toBe(404);

    await approveBusiness(id);

    const after = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(after.statusCode).toBe(200);
    expect(JSON.parse(after.body).data.isVerified).toBe(true);

    const all = await app.inject({ method: 'GET', url: '/api/v1/businesses?limit=100' });
    expect(JSON.parse(all.body).data.map((b: { id: string }) => b.id)).toContain(id);
  });

  it("owner cannot modify another owner's business", async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerA.token, { name: `Biz A ${Date.now()}` });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(ownerB.token),
      payload: { description: 'hijacked' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('owner updates their own business profile', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token, { name: `Editable Biz ${Date.now()}` });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { description: 'Updated description', phone: '+92 300 1234567', email: 'biz@test.local' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.description).toBe('Updated description');
    expect(JSON.parse(res.body).data.email).toBe('biz@test.local');
  });

  it('rejected or suspended businesses are not publicly visible', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token, { name: `Hidden Biz ${Date.now()}` });

    await prisma.business.update({ where: { id }, data: { status: 'REJECTED' } });
    const rejected = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(rejected.statusCode).toBe(404);

    await prisma.business.update({ where: { id }, data: { status: 'SUSPENDED' } });
    const suspended = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(suspended.statusCode).toBe(404);
  });
});
