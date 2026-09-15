import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

const businessPayload = (overrides: Record<string, unknown> = {}) => ({
  name: `Onboarded Business ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  description: 'Created through self-service onboarding',
  address: '12 Main Boulevard, Gulberg',
  city: 'Lahore',
  categoryIds: [] as string[],
  ...overrides,
});

const categoryId = async (): Promise<string> => {
  const categories = await app.inject({ method: 'GET', url: '/api/v1/categories' });
  const list = JSON.parse(categories.body).data as { id: string; isActive: boolean }[];
  return list[0]!.id;
};

describe('self-service business onboarding (Phase 3C.5)', () => {
  it('business owner creates a business owned by the authenticated user', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await categoryId();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      // No coordinates: the onboarding form does not capture them.
      payload: businessPayload({ categoryIds: [cat] }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body).data as { id: string; status: string; latitude: string };

    // Ownership comes from the token, never the client payload.
    const row = await prisma.business.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.ownerId).toBe(owner.userId);
    // New businesses follow the existing approval workflow (PENDING).
    expect(body.status).toBe('PENDING');
    // No invented coordinates: location stays unconfigured until the owner
    // sets a real one (Phase 11 removed the city-centre fallback).
    expect(body.latitude).toBeNull();
    expect(body.longitude).toBeNull();
  });

  it('ignores a client-supplied ownerId', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const stranger = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await categoryId();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: businessPayload({ categoryIds: [cat], ownerId: stranger.userId }),
    });
    expect(res.statusCode).toBe(201);
    const row = await prisma.business.findUniqueOrThrow({ where: { id: JSON.parse(res.body).data.id } });
    expect(row.ownerId).toBe(owner.userId);
    expect(row.ownerId).not.toBe(stranger.userId);
  });

  it('customer cannot create a business; unauthenticated requests are rejected', async () => {
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const cat = await categoryId();
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(customer.token),
      payload: businessPayload({ categoryIds: [cat] }),
    });
    expect(forbidden.statusCode).toBe(403);

    const unauthed = await app.inject({ method: 'POST', url: '/api/v1/businesses', payload: businessPayload() });
    expect(unauthed.statusCode).toBe(401);
  });

  it('invalid business data is rejected (missing fields, bad phone, unknown category)', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await categoryId();
    const base = { headers: authed(owner.token), method: 'POST' as const, url: '/api/v1/businesses' };

    const noName = await app.inject({ ...base, payload: businessPayload({ name: undefined }) });
    expect(noName.statusCode).toBe(400);
    const shortAddress = await app.inject({ ...base, payload: businessPayload({ address: 'x' }) });
    expect(shortAddress.statusCode).toBe(400);
    const badPhone = await app.inject({ ...base, payload: businessPayload({ phone: 'not-a-phone' }) });
    expect(badPhone.statusCode).toBe(400);
    const unknownCategory = await app.inject({
      ...base,
      payload: businessPayload({ categoryIds: ['00000000-0000-4000-8000-000000000000'] }),
    });
    expect(unknownCategory.statusCode).toBe(400);
    // Pakistani numbers in +92 format remain valid.
    const okPhone = await app.inject({ ...base, payload: businessPayload({ phone: '+92 300 1234567', categoryIds: [cat] }) });
    expect(okPhone.statusCode).toBe(201);
  });

  it('owner lists their businesses; another owner cannot modify them', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const other = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);

    const mine = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(owner.token) });
    expect(mine.statusCode).toBe(200);
    expect(JSON.parse(mine.body).data.some((b: { id: string }) => b.id === id)).toBe(true);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(other.token),
      payload: { name: 'Hijacked Name' },
    });
    expect(patch.statusCode).toBe(404);

    const patchMine = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${id}`,
      headers: authed(owner.token),
      payload: { description: 'Updated by owner' },
    });
    expect(patchMine.statusCode).toBe(200);
  });

  it('invalid service duration is rejected for an owned business', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/services`,
      headers: authed(owner.token),
      payload: { name: 'Zero-minute service', priceMinor: 100000, durationMinutes: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('new businesses stay out of discovery until approved, then appear', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const cat = await categoryId();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: businessPayload({ categoryIds: [cat], name: 'Discovery Probe Salon' }),
    });
    const { id, slug } = JSON.parse(created.body).data as { id: string; slug: string };

    // PENDING businesses are not publicly visible.
    const before = await app.inject({ method: 'GET', url: `/api/v1/businesses/${slug}` });
    expect(before.statusCode).toBe(404);

    await approveBusiness(id);
    const after = await app.inject({ method: 'GET', url: `/api/v1/businesses/${slug}` });
    expect(after.statusCode).toBe(200);
    expect(JSON.parse(after.body).data.name).toBe('Discovery Probe Salon');

    const search = await app.inject({ method: 'GET', url: '/api/v1/businesses?q=Discovery%20Probe' });
    expect(JSON.parse(search.body).data.some((b: { id: string }) => b.id === id)).toBe(true);
  });
});
