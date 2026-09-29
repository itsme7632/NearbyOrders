import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { approveBusiness, authed, createBusiness, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** Fixture: owner with approved business, customer, and a delivery-enabled setup. */
const riderFixture = async () => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const customer = await registerAndLogin(app, 'CUSTOMER');
  const otherOwner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id: businessId } = await createBusiness(app, owner.token);
  const { id: otherBusinessId } = await createBusiness(app, otherOwner.token);
  await approveBusiness(businessId);
  await approveBusiness(otherBusinessId);
  return { owner, customer, otherOwner, businessId, otherBusinessId };
};

const createRider = (token: string, businessId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/owner/businesses/${businessId}/riders`,
    headers: authed(token),
    payload,
  });

const listRiders = (token: string, businessId: string) =>
  app.inject({
    method: 'GET',
    url: `/api/v1/owner/businesses/${businessId}/riders`,
    headers: authed(token),
  });

describe('rider CRUD', () => {
  it('owner can create, list, update, and deactivate a rider', async () => {
    const { owner, businessId } = await riderFixture();

    const created = await createRider(owner.token, businessId, {
      name: 'Ali Raza',
      phone: '+92 300 1234567',
      note: 'Evening shift',
    });
    expect(created.statusCode).toBe(201);
    const rider = JSON.parse(created.body).data as { id: string; name: string; phone: string; isActive: boolean; note: string };
    expect(rider.name).toBe('Ali Raza');
    expect(rider.phone).toBe('+92 300 1234567');
    expect(rider.isActive).toBe(true);
    expect(rider.note).toBe('Evening shift');

    const listed = await listRiders(owner.token, businessId);
    expect(listed.statusCode).toBe(200);
    const riders = JSON.parse(listed.body).data as { id: string }[];
    expect(riders.some((x) => x.id === rider.id)).toBe(true);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/businesses/${businessId}/riders/${rider.id}`,
      headers: authed(owner.token),
      payload: { isActive: false, note: 'On leave' },
    });
    expect(updated.statusCode).toBe(200);
    expect((JSON.parse(updated.body).data as { isActive: boolean }).isActive).toBe(false);
  });

  it('rejects rider creation without name or phone', async () => {
    const { owner, businessId } = await riderFixture();
    const noName = await createRider(owner.token, businessId, { phone: '+92 300 1234567' });
    expect(noName.statusCode).toBe(400);
    const noPhone = await createRider(owner.token, businessId, { name: 'Ali' });
    expect(noPhone.statusCode).toBe(400);
  });

  it('owner cannot list another business\u2019s riders', async () => {
    const { owner, otherOwner, businessId } = await riderFixture();
    await createRider(owner.token, businessId, { name: 'Ali', phone: '+92 300 1234567' });
    // otherOwner tries to list owner's riders → ownedBusiness throws 404
    const res = await listRiders(otherOwner.token, businessId);
    expect(res.statusCode).toBe(404);
  });

  it('customer cannot access rider endpoints', async () => {
    const { customer, businessId } = await riderFixture();
    const res = await listRiders(customer.token, businessId);
    // roles('BUSINESS_OWNER') rejects non-owners
    expect([401, 403]).toContain(res.statusCode);
  });

  it('updating a rider of another business returns 404', async () => {
    const { owner, otherOwner, businessId, otherBusinessId } = await riderFixture();
    const created = await createRider(owner.token, businessId, { name: 'Ali', phone: '+92 300 1234567' });
    const riderId = (JSON.parse(created.body).data as { id: string }).id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/businesses/${otherBusinessId}/riders/${riderId}`,
      headers: authed(otherOwner.token),
      payload: { name: 'Hacked' },
    });
    expect(res.statusCode).toBe(404);
    // Original unchanged
    const check = await prisma.rider.findUniqueOrThrow({ where: { id: riderId } });
    expect(check.name).toBe('Ali');
  });
});
