import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { saveReceipt } from '../src/receiptStorage.js';

/**
 * Featured Businesses (Phase 19):
 * - Public GET /api/v1/featured-businesses: server-authoritative placement
 *   from ACTIVE paid promotion requests and active editorial features.
 * - Admin editorial-feature CRUD + unified GET /api/v1/admin/featured.
 * - Critical invariants: no endpoint activates a paid promotion without an
 *   approved payment; editorial features never claim a payment.
 */
let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

let counter = 0;
const unique = (name: string) => `${name} ${Date.now()}-${++counter}`;

async function makePromotion(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/promotions',
    headers: authed(adminToken),
    payload: {
      name: unique('Featured Promo'),
      description: 'Test promotion',
      benefits: ['Featured placement'],
      priceMinor: 49900,
      currency: 'PKR',
      durationDays: 7,
      isActive: true,
      displayOrder: 1,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { id: string };
}

async function makeMethod() {
  return prisma.paymentMethod.create({
    data: {
      name: `Featured Method ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'EASYPAISA',
      accountTitle: 'NearbyOrders Test',
      accountNumber: '03000000000',
      isActive: true,
    },
  });
}

async function ownerWithBusiness() {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, owner.token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
  return { ...owner, businessId: business.id };
}

const applyFor = (owner: { token: string; businessId: string }, promotionId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
    headers: authed(owner.token),
    payload: { promotionId },
  });

const createFeature = (adminToken: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/admin/editorial-features', headers: authed(adminToken), payload: body });

const featureBody = (businessId: string, overrides: Record<string, unknown> = {}) => ({
  businessId,
  placementType: 'staff_pick',
  label: 'Staff pick',
  endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

const publicFeatured = () => app.inject({ method: 'GET', url: '/api/v1/featured-businesses' });

/**
 * Full paid lifecycle: apply -> admin approves application -> owner submits
 * payment (with a real stored receipt) -> admin approves payment -> ACTIVE.
 * Returns the request id. Paid placements require this entire chain.
 */
async function activatePaidPromotion(adminToken: string, owner: { token: string; businessId: string }, overrides: Record<string, unknown> = {}) {
  const promo = await makePromotion(adminToken, { priceMinor: 49900, durationDays: 30, ...overrides });
  const request = (await applyFor(owner, promo.id)).json().data as { id: string };
  await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(adminToken), payload: {} });
  const method = await makeMethod();
  const receiptKey = await saveReceipt(Buffer.from(`fake-receipt-bytes-${randomUUID()}`), 'image/jpeg');
  const payment = (
    await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests/${request.id}/payment-requests`,
      headers: authed(owner.token),
      payload: { paymentMethodId: method.id, transactionReference: `TX-FEAT-${Date.now()}-${randomUUID().slice(0, 8)}`, receiptStorageKey: receiptKey },
    })
  ).json().data as { id: string };
  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/promotion-payment-requests/${payment.id}/approve`,
    headers: authed(adminToken),
    payload: {},
  });
  expect(approved.statusCode).toBe(200);
  return request.id;
}

describe('public GET /api/v1/featured-businesses: paid placements', () => {
  it('ACTIVE paid promotion appears with full placement info; a free ACTIVE promotion is not a paid placement', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const freeOwner = await ownerWithBusiness();
    await activatePaidPromotion(admin.token, owner);
    // Free promotion: application approval activates it directly, with no payment.
    const freePromo = await makePromotion(admin.token, { priceMinor: 0, durationDays: 30 });
    const freeRequest = (await applyFor(freeOwner, freePromo.id)).json().data as { id: string };
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${freeRequest.id}/approve`, headers: authed(admin.token), payload: {} });

    const res = await publicFeatured();
    expect(res.statusCode).toBe(200);
    const items = res.json().data as {
      source: string; placementId: string; business: { id: string; name: string; slug: string; categoryNames: string[] };
      placementType: string; placementLabel: string; promotionName: string | null; benefits: string[];
      startsAt: string; endsAt: string;
    }[];
    const mine = items.find((i) => i.business.id === owner.businessId);
    expect(mine).toBeDefined();
    expect(mine!.source).toBe('paid');
    expect(mine!.placementLabel).toBe('Featured');
    expect(mine!.placementType).toBe('promotion');
    expect(mine!.promotionName).toBeTruthy();
    expect(mine!.benefits).toEqual(['Featured placement']);
    expect(mine!.business.name).toBeTruthy();
    expect(mine!.business.slug).toBeTruthy();
    expect(Array.isArray(mine!.business.categoryNames)).toBe(true);
    expect(new Date(mine!.endsAt).getTime()).toBeGreaterThan(Date.now());
    // The free ACTIVE promotion has no approved payment: never a paid placement.
    expect(items.some((i) => i.business.id === freeOwner.businessId)).toBe(false);
  });

  it('expired paid promotion drops out; unrelated and unapproved businesses stay absent', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const other = await ownerWithBusiness();
    const requestId = await activatePaidPromotion(admin.token, owner, { durationDays: 7 });

    let items = (await publicFeatured()).json().data as { business: { id: string } }[];
    expect(items.some((i) => i.business.id === owner.businessId)).toBe(true);

    // Simulate expiry: the request ended an hour ago.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.promotionRequest.update({ where: { id: requestId }, data: { expiresAt: past } });

    items = (await publicFeatured()).json().data as { business: { id: string } }[];
    expect(items.some((i) => i.business.id === owner.businessId)).toBe(false);
    // A business with no placement never appears.
    expect(items.some((i) => i.business.id === other.businessId)).toBe(false);
  });

  it('a suspended business never appears even with an active paid promotion', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    await activatePaidPromotion(admin.token, owner);

    await prisma.business.update({ where: { id: owner.businessId }, data: { status: 'SUSPENDED' } });
    const items = (await publicFeatured()).json().data as { business: { id: string } }[];
    expect(items.some((i) => i.business.id === owner.businessId)).toBe(false);
  });
});

describe('public GET /api/v1/featured-businesses: editorial placements', () => {
  it('active editorial feature appears with its label; expired feature drops out', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const created = await createFeature(admin.token, featureBody(owner.businessId));
    expect(created.statusCode).toBe(201);
    const feature = created.json().data as { id: string };

    let items = (await publicFeatured()).json().data as {
      source: string; business: { id: string }; placementLabel: string; placementType: string;
      promotionName: string | null; benefits: string[];
    }[];
    const mine = items.find((i) => i.business.id === owner.businessId);
    expect(mine).toBeDefined();
    expect(mine!.source).toBe('editorial');
    expect(mine!.placementLabel).toBe('Staff pick');
    expect(mine!.placementType).toBe('staff_pick');
    expect(mine!.promotionName).toBeNull();
    expect(mine!.benefits).toEqual([]);

    // End the feature: it disappears from the public placement.
    const ended = await app.inject({ method: 'POST', url: `/api/v1/admin/editorial-features/${feature.id}/end`, headers: authed(admin.token) });
    expect(ended.statusCode).toBe(200);
    items = (await publicFeatured()).json().data as { business: { id: string } }[];
    expect(items.some((i) => i.business.id === owner.businessId)).toBe(false);
  });

  it('list is deterministic across repeated reads', async () => {
    const admin = await registerAdminAndLogin(app);
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    await createFeature(admin.token, featureBody(a.businessId, { label: 'Picks A' }));
    await createFeature(admin.token, featureBody(b.businessId, { label: 'Picks B' }));
    const first = JSON.stringify((await publicFeatured()).json().data);
    const second = JSON.stringify((await publicFeatured()).json().data);
    expect(first).toBe(second);
  });
});

describe('admin editorial features: CRUD', () => {
  it('create defaults the label from the placement type; duplicate overlapping windows are rejected', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();

    const created = await createFeature(admin.token, featureBody(owner.businessId, { label: undefined, placementType: 'editors_choice' }));
    expect(created.statusCode).toBe(201);
    const data = created.json().data as { label: string; state: string; business: { id: string }; createdBy: { id: string } };
    expect(data.label).toBe('Editors Choice');
    expect(data.state).toBe('active');
    expect(data.business.id).toBe(owner.businessId);
    expect(data.createdBy.id).toBe(admin.userId);

    // Overlapping window with the same placement type is rejected.
    const clash = await createFeature(admin.token, featureBody(owner.businessId, { placementType: 'editors_choice' }));
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('FEATURE_OVERLAPS');

    // A different placement type for the same window is fine.
    const other = await createFeature(admin.token, featureBody(owner.businessId, { placementType: 'staff_pick' }));
    expect(other.statusCode).toBe(201);
  });

  it('creating a feature for an unknown business is 404; endAt must be after startAt', async () => {
    const admin = await registerAdminAndLogin(app);
    const missing = await createFeature(admin.token, featureBody(randomUUID()));
    expect(missing.statusCode).toBe(404);

    const owner = await ownerWithBusiness();
    const bad = await createFeature(
      admin.token,
      featureBody(owner.businessId, { startAt: new Date(Date.now() + 60_000).toISOString(), endAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    expect(bad.statusCode).toBe(400);
  });

  it('update extends the end date and edits the label; delete removes the feature', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const feature = (await createFeature(admin.token, featureBody(owner.businessId))).json().data as { id: string };

    const newEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/editorial-features/${feature.id}`,
      headers: authed(admin.token),
      payload: { label: 'Our favourites', endAt: newEnd },
    });
    expect(updated.statusCode).toBe(200);
    const updatedData = updated.json().data as { label: string; endsAt: string };
    expect(updatedData.label).toBe('Our favourites');
    expect(updatedData.endsAt).toBe(newEnd);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/admin/editorial-features/${feature.id}`, headers: authed(admin.token) });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({ method: 'DELETE', url: `/api/v1/admin/editorial-features/${feature.id}`, headers: authed(admin.token) });
    expect(gone.statusCode).toBe(404);
  });

  it('update is extend-only: shortening the end date is rejected', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const feature = (await createFeature(admin.token, featureBody(owner.businessId))).json().data as { id: string; endsAt: string };
    const currentEnd = new Date(feature.endsAt).getTime();

    // Shortening to a still-future date is rejected.
    const shorter = new Date(currentEnd - 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/editorial-features/${feature.id}`,
      headers: authed(admin.token),
      payload: { endAt: shorter },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('END_DATE_NOT_EXTENDED');

    // Same end date is not an extension either.
    const same = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/editorial-features/${feature.id}`,
      headers: authed(admin.token),
      payload: { endAt: feature.endsAt },
    });
    expect(same.statusCode).toBe(400);

    // The stored end date is unchanged.
    const row = await prisma.editorialFeature.findUniqueOrThrow({ where: { id: feature.id } });
    expect(row.endAt.getTime()).toBe(currentEnd);
  });

  it('end-early twice is rejected; editorial endpoints are admin-only', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const feature = (await createFeature(admin.token, featureBody(owner.businessId))).json().data as { id: string };

    const end = await app.inject({ method: 'POST', url: `/api/v1/admin/editorial-features/${feature.id}/end`, headers: authed(admin.token) });
    expect(end.statusCode).toBe(200);
    expect((end.json().data as { state: string }).state).toBe('expired');
    const again = await app.inject({ method: 'POST', url: `/api/v1/admin/editorial-features/${feature.id}/end`, headers: authed(admin.token) });
    expect(again.statusCode).toBe(409);

    expect((await createFeature(owner.token, featureBody(owner.businessId))).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/featured', headers: authed(owner.token) })).statusCode).toBe(403);
  });
});

describe('admin featured list + critical invariants', () => {
  it('unified list shows active paid promotions with payment info and editorial features with no payment', async () => {
    const admin = await registerAdminAndLogin(app);
    const paidOwner = await ownerWithBusiness();
    const editorialOwner = await ownerWithBusiness();
    // Paid promotion through the full lifecycle: ACTIVE with an approved payment.
    await activatePaidPromotion(admin.token, paidOwner);
    await createFeature(admin.token, featureBody(editorialOwner.businessId));

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/featured?state=active', headers: authed(admin.token) });
    expect(res.statusCode).toBe(200);
    const items = res.json().data as {
      id: string; source: 'paid' | 'editorial'; state: string; business: { id: string };
      placementType: string; label: string; promotion: { name: string } | null;
      payment: { status: string; amountMinor: number } | null;
    }[];
    const paid = items.find((i) => i.business.id === paidOwner.businessId);
    expect(paid).toBeDefined();
    expect(paid!.source).toBe('paid');
    expect(paid!.state).toBe('active');
    expect(paid!.promotion!.name).toBeTruthy();
    expect(paid!.payment).not.toBeNull();
    expect(paid!.payment!.status).toBe('APPROVED');
    expect(paid!.payment!.amountMinor).toBe(49900);

    const ed = items.find((i) => i.business.id === editorialOwner.businessId);
    expect(ed).toBeDefined();
    expect(ed!.source).toBe('editorial');
    expect(ed!.state).toBe('active');
    expect(ed!.promotion).toBeNull();
    // Editorial features never claim a payment.
    expect(ed!.payment).toBeNull();
  });

  it('no endpoint activates a paid promotion without an approved payment: editorial features cannot touch requests', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token, { priceMinor: 49900, durationDays: 7 });
    // Paid application approved: request is APPROVED, awaiting payment.
    const request = (await applyFor(owner, promo.id)).json().data as { id: string };
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    // Creating an editorial feature for the same business must not activate the request.
    const created = await createFeature(admin.token, featureBody(owner.businessId));
    expect(created.statusCode).toBe(201);
    const row = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.activatedAt).toBeNull();

    // Smuggling a promotionRequestId into the editorial body is rejected outright.
    const smuggled = await createFeature(admin.token, { ...featureBody(owner.businessId, { placementType: 'staff_pick_2' }), promotionRequestId: request.id });
    expect(smuggled.statusCode).toBe(400);

    // After ending the feature the request is still APPROVED, never ACTIVE.
    const featureId = (created.json().data as { id: string }).id;
    await app.inject({ method: 'POST', url: `/api/v1/admin/editorial-features/${featureId}/end`, headers: authed(admin.token) });
    const row2 = await prisma.promotionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row2.status).toBe('APPROVED');
  });

  it('paid request pending payment does not appear in the public featured list', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = await makePromotion(admin.token, { priceMinor: 49900, durationDays: 7 });
    const request = (await applyFor(owner, promo.id)).json().data as { id: string };
    await app.inject({ method: 'POST', url: `/api/v1/admin/promotion-requests/${request.id}/approve`, headers: authed(admin.token), payload: {} });

    const items = (await publicFeatured()).json().data as { business: { id: string }; source: string }[];
    expect(items.some((i) => i.business.id === owner.businessId)).toBe(false);
  });
});
