import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, registerAndLogin, type TestApp } from './helpers.js';
import { makeApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

/**
 * Phase 3H: the public business detail endpoint must expose the authoritative
 * delivery capability (deliveryEnabled / codEnabled / deliveryFeeMinor) so the
 * customer app can render it verbatim. The fee is only meaningful when
 * delivery is enabled — null otherwise.
 */
describe('public business detail delivery capability (Phase 3H)', () => {
  it('exposes delivery settings when the owner enables delivery', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    await approveBusiness(id);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/businesses/${id}/delivery-settings`,
      headers: authed(owner.token),
      payload: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 15000 },
    });
    expect(put.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(detail.statusCode).toBe(200);
    const data = JSON.parse(detail.body).data;
    expect(data.deliveryEnabled).toBe(true);
    expect(data.codEnabled).toBe(true);
    expect(data.deliveryFeeMinor).toBe(15000);
  });

  it('reports pickup-only with a null fee when delivery is disabled', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    await approveBusiness(id);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${id}` });
    expect(detail.statusCode).toBe(200);
    const data = JSON.parse(detail.body).data;
    expect(data.deliveryEnabled).toBe(false);
    expect(data.deliveryFeeMinor).toBeNull();
  });
});
