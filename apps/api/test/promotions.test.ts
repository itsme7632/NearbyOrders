import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

let promoCounter = 0;
const promoBody = (name: string) => {
  const unique = `${name} ${Date.now()}-${++promoCounter}`;
  return {
    name: unique,
    description: `${unique} — featured placement for one month`,
    benefits: ['Homepage feature', 'Push mention'],
    priceMinor: 49900,
    currency: 'PKR',
    durationDays: 30,
    requirements: 'Active subscription required',
    isActive: true,
    displayOrder: 10,
  };
};

async function ownerWithBusiness() {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, owner.token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
  return { ...owner, businessId: business.id };
}

describe('admin promotion CRUD', () => {
  it('admin creates a promotion; slug is derived from the name', async () => {
    const admin = await registerAdminAndLogin(app);
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Ramadan Spotlight') });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.slug.startsWith('ramadan-spotlight')).toBe(true);
    expect(data.benefits).toEqual(['Homepage feature', 'Push mention']);
    expect(data.priceMinor).toBe(49900);
  });

  it('duplicate slug is rejected with PROMOTION_SLUG_IN_USE', async () => {
    const admin = await registerAdminAndLogin(app);
    const body = promoBody('Eid Banner');
    const first = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: body });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: body });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('PROMOTION_SLUG_IN_USE');
  });

  it('admin patches and deactivates; PATCH on unknown id is 404', async () => {
    const admin = await registerAdminAndLogin(app);
    const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Patch Me') })).json().data;
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/promotions/${created.id}`,
      headers: authed(admin.token),
      payload: { priceMinor: 99900, isActive: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.priceMinor).toBe(99900);
    expect(patched.json().data.isActive).toBe(false);
    const missing = await app.inject({ method: 'PATCH', url: '/api/v1/admin/promotions/00000000-0000-4000-8000-000000000000', headers: authed(admin.token), payload: { priceMinor: 1 } });
    expect(missing.statusCode).toBe(404);
  });

  it('deleting a promotion with requests is blocked; a clean one deletes', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Delete Guard') })).json().data;
    const req = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: created.id },
    });
    expect(req.statusCode).toBe(201);
    const blocked = await app.inject({ method: 'DELETE', url: `/api/v1/admin/promotions/${created.id}`, headers: authed(admin.token) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('IN_USE');
    const clean = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Delete Clean') })).json().data;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/promotions/${clean.id}`, headers: authed(admin.token) })).statusCode).toBe(204);
  });

  it('non-admins cannot manage promotions', async () => {
    const owner = await ownerWithBusiness();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/promotions', headers: authed(owner.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(owner.token), payload: promoBody('X') })).statusCode).toBe(403);
  });
});

describe('public promotion catalog', () => {
  it('lists active promotions in display order and hides inactive ones', async () => {
    const admin = await registerAdminAndLogin(app);
    const a = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: { ...promoBody('Public A'), displayOrder: 2 } })).json().data;
    const b = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: { ...promoBody('Public B'), displayOrder: 1 } })).json().data;
    const hidden = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: { ...promoBody('Public Hidden'), isActive: false, displayOrder: 0 } })).json().data;
    const res = await app.inject({ method: 'GET', url: '/api/v1/promotions' });
    expect(res.statusCode).toBe(200);
    const slugs: string[] = res.json().data.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(a.slug);
    expect(slugs).toContain(b.slug);
    expect(slugs).not.toContain(hidden.slug);
    expect(slugs.indexOf(b.slug)).toBeLessThan(slugs.indexOf(a.slug));
  });

  it('detail is public for active promotions and 404 for inactive/unknown', async () => {
    const admin = await registerAdminAndLogin(app);
    const active = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Detail Live') })).json().data;
    const inactive = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: { ...promoBody('Detail Off'), isActive: false } })).json().data;
    expect((await app.inject({ method: 'GET', url: `/api/v1/promotions/${active.slug}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/promotions/${inactive.slug}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/promotions/no-such-promo' })).statusCode).toBe(404);
  });
});

describe('owner promotion requests (no checkout flow)', () => {
  it('owner requests a promotion; duplicate pending requests are rejected', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Request Flow') })).json().data;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: promo.id, note: 'Please feature us for Eid' },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.status).toBe('PENDING');
    expect(data.note).toBe('Please feature us for Eid');
    expect(data.promotion.slug).toBe(promo.slug);
    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: promo.id },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('REQUEST_ALREADY_PENDING');
    // The owner can list their own requests.
    const list = await app.inject({ method: 'GET', url: `/api/v1/businesses/${owner.businessId}/promotion-requests`, headers: authed(owner.token) });
    expect(list.json().data).toHaveLength(1);
  });

  it('requests for inactive or unknown promotions are 404; foreign owners see 404', async () => {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const foreign = await ownerWithBusiness();
    const inactive = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: { ...promoBody('Off Air'), isActive: false } })).json().data;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: inactive.id },
    });
    expect(res.statusCode).toBe(404);
    const cross = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(foreign.token),
      payload: { promotionId: inactive.id },
    });
    expect(cross.statusCode).toBe(404);
  });
});

describe('admin promotion request review', () => {
  async function pendingRequest() {
    const admin = await registerAdminAndLogin(app);
    const owner = await ownerWithBusiness();
    const promo = (await app.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: authed(admin.token), payload: promoBody('Review Queue') })).json().data;
    const created = (await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/promotion-requests`,
      headers: authed(owner.token),
      payload: { promotionId: promo.id },
    })).json().data;
    return { admin, owner, request: created as { id: string } };
  }

  it('admin sees the queue with business identity and approves with a reviewer message', async () => {
    const { admin, request } = await pendingRequest();
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/promotion-requests', headers: authed(admin.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((r: { id: string }) => r.id)).toContain(request.id);
    const one = await app.inject({ method: 'GET', url: `/api/v1/admin/promotion-requests/${request.id}`, headers: authed(admin.token) });
    expect(one.json().data.business.owner.email).toBeTruthy();
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/approve`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Scheduled for next week' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('APPROVED');
    expect(approved.json().data.reviewerMessage).toBe('Scheduled for next week');
  });

  it('admin rejects with a reason; a rejected request cannot be re-reviewed', async () => {
    const { admin, request } = await pendingRequest();
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/reject`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Slots are full this month' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('REJECTED');
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotion-requests/${request.id}/approve`,
      headers: authed(admin.token),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });
});
