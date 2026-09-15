import { describe, expect, it } from 'vitest';
import { approveBusiness, authed, createBusiness, ensureCategory, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

/** Creates an APPROVED business with explicit real coordinates. */
const locatedBusiness = async (name: string, latitude: number, longitude: number) => {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const { id: categoryId } = await ensureCategory();
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/businesses',
    headers: authed(owner.token),
    payload: {
      name,
      description: 'Phase 11 location fixture',
      address: '1 Location Street',
      city: 'Lahore',
      latitude,
      longitude,
      categoryIds: [categoryId],
    },
  });
  expect(created.statusCode).toBe(201);
  const { id } = JSON.parse(created.body).data as { id: string };
  await approveBusiness(id);
  return { id, ownerId: owner.userId, ownerToken: owner.token };
};

describe('business location (Phase 11)', () => {
  it('a business can exist without configured coordinates — no city-centre fallback', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: categoryId } = await ensureCategory();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `No Coord Business ${Date.now()}`,
        description: 'Created without coordinates',
        address: '5 Unmapped Avenue',
        city: 'Lahore',
        categoryIds: [categoryId],
      },
    });
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body).data as { id: string; latitude: unknown; longitude: unknown };
    expect(body.latitude).toBeNull();
    expect(body.longitude).toBeNull();

    // The owner-facing location endpoint reports the unconfigured state.
    const location = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${body.id}/location`,
      headers: authed(owner.token),
    });
    expect(location.statusCode).toBe(200);
    expect(JSON.parse(location.body).data).toEqual({ latitude: null, longitude: null, isConfigured: false });
  });

  it('retrieves configured coordinates through the location endpoint', async () => {
    const { id, ownerToken } = await locatedBusiness('Configured Salon', 31.5204, 74.3587);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { latitude: number; longitude: number; isConfigured: boolean };
    expect(data.latitude).toBeCloseTo(31.5204, 5);
    expect(data.longitude).toBeCloseTo(74.3587, 5);
    expect(data.isConfigured).toBe(true);
  });

  it('updates the location with a valid payload and persists it', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, owner.token);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(owner.token),
      payload: { latitude: 31.4187, longitude: 73.0791 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.isConfigured).toBe(true);

    const location = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(owner.token),
    });
    const data = JSON.parse(location.body).data as { latitude: number; longitude: number };
    expect(data.latitude).toBeCloseTo(31.4187, 5);
    expect(data.longitude).toBeCloseTo(73.0791, 5);
  });

  it('clears the location with an explicit null body', async () => {
    const { id, ownerToken } = await locatedBusiness('Clearable Studio', 31.5204, 74.3587);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(ownerToken),
      payload: null,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual({ latitude: null, longitude: null, isConfigured: false });
  });

  it('rejects invalid latitude and longitude values', async () => {
    const { id, ownerToken } = await locatedBusiness('Validation Studio', 31.5204, 74.3587);
    const invalid = [
      { latitude: 91, longitude: 74 },
      { latitude: -91, longitude: 74 },
      { latitude: 31, longitude: 181 },
      { latitude: 31, longitude: -181 },
    ];
    for (const payload of invalid) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/businesses/${id}/location`,
        headers: authed(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects non-numeric coordinate payloads and extra fields', async () => {
    const { id, ownerToken } = await locatedBusiness('Strict Studio', 31.5204, 74.3587);
    const strings = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(ownerToken),
      payload: { latitude: '31.5', longitude: '74.3' },
    });
    expect(strings.statusCode).toBe(400);
    const extra = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(ownerToken),
      payload: { latitude: 31.5, longitude: 74.3, city: 'Karachi' },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('enforces ownership: another owner cannot read or update the location', async () => {
    const { id } = await locatedBusiness('Owned Studio', 31.5204, 74.3587);
    const stranger = await registerAndLogin(app, 'BUSINESS_OWNER');

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(stranger.token),
    });
    expect(read.statusCode).toBe(404);

    const write = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(stranger.token),
      payload: { latitude: 1, longitude: 1 },
    });
    expect(write.statusCode).toBe(404);
  });

  it('rejects customers and unauthenticated callers on location endpoints', async () => {
    const { id } = await locatedBusiness('Auth Studio', 31.5204, 74.3587);
    const customer = await registerAndLogin(app, 'CUSTOMER');

    const customerRead = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(customer.token),
    });
    expect(customerRead.statusCode).toBe(403);

    const customerWrite = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${id}/location`,
      headers: authed(customer.token),
      payload: { latitude: 1, longitude: 1 },
    });
    expect(customerWrite.statusCode).toBe(403);

    const anon = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${id}/location`,
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('nearby discovery (Phase 11)', () => {
  // An isolated mid-ocean anchor: no other business can share these
  // coordinates, so freshly created fixtures are the only rows in the
  // bounding box and every assertion stays deterministic against the shared
  // test database.
  const ANCHOR = { lat: -49.3167, lng: 71.8333 };

  it('returns nearby businesses with server-computed distances, ordered closest first', async () => {
    // 0.01° latitude ≈ 1.11 km; three rings at increasing distance.
    const near = await locatedBusiness(`Near Ring ${Date.now()}`, ANCHOR.lat + 0.01, ANCHOR.lng);
    const mid = await locatedBusiness(`Mid Ring ${Date.now()}`, ANCHOR.lat + 0.03, ANCHOR.lng);
    const far = await locatedBusiness(`Far Ring ${Date.now()}`, ANCHOR.lat + 0.09, ANCHOR.lng);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/nearby?lat=${ANCHOR.lat}&lng=${ANCHOR.lng}&radiusKm=20`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { id: string; distanceKm: number }[];
    const distances = data.filter((b) => [near.id, mid.id, far.id].includes(b.id));

    expect(distances).toHaveLength(3);
    expect(distances.map((b) => b.id)).toEqual([near.id, mid.id, far.id]); // closest first

    const nearRow = distances.find((b) => b.id === near.id)!;
    expect(nearRow.distanceKm).toBeGreaterThan(1.0);
    expect(nearRow.distanceKm).toBeLessThan(1.25); // 0.01° lat ≈ 1.11 km
  });

  it('filters by radius: businesses outside the radius are excluded', async () => {
    const near = await locatedBusiness(`Radius Near ${Date.now()}`, ANCHOR.lat + 0.01, ANCHOR.lng);
    const far = await locatedBusiness(`Radius Far ${Date.now()}`, ANCHOR.lat + 0.09, ANCHOR.lng); // ~10 km

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/nearby?lat=${ANCHOR.lat}&lng=${ANCHOR.lng}&radiusKm=2`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { id: string }[];
    const ids = data.map((b) => b.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
  });

  it('excludes businesses without configured coordinates from nearby results', async () => {
    // The probe is created AT the anchor radius: if it silently carried a
    // fallback (city-centre or any invented) coordinate it would appear in
    // these results — it must not. The bounding box holds only the fixture
    // rows created by this suite, so the result is deterministic.
    const near = await locatedBusiness(`Box Filler ${Date.now()}`, ANCHOR.lat + 0.01, ANCHOR.lng);
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: categoryId } = await ensureCategory();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `Unlocated Probe ${Date.now()}`,
        description: 'No coordinates configured',
        address: '7 Unmapped Avenue',
        city: 'Lahore',
        categoryIds: [categoryId],
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = JSON.parse(created.body).data as { id: string };
    await approveBusiness(id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/nearby?lat=${ANCHOR.lat}&lng=${ANCHOR.lng}&radiusKm=2`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { id: string }[];
    expect(data.map((b) => b.id)).not.toContain(id);
    expect(data.map((b) => b.id)).toContain(near.id); // box holds real rows
  });

  it('rejects invalid nearby query parameters', async () => {
    const cases = [
      'lat=95&lng=74', // latitude out of range
      'lat=31&lng=-200', // longitude out of range
      'lat=abc&lng=74', // non-numeric latitude
      'lat=31', // missing longitude
      'lng=74', // missing latitude
      'lat=31&lng=74&radiusKm=0', // radius must be positive
      'lat=31&lng=74&radiusKm=51', // radius above the 50 km cap
      'lat=31&lng=74&radiusKm=-3', // negative radius
      'lat=31&lng=74&extra=1', // unknown query field
    ];
    for (const query of cases) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/nearby?${query}` });
      expect(res.statusCode, query).toBe(400);
    }
  });

  it('caps the result limit and defaults sensibly', async () => {
    // The box holds several fixtures by this point (radius 50 covers all
    // rings); the cap must still limit the response.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/nearby?lat=${ANCHOR.lat}&lng=${ANCHOR.lng}&radiusKm=50&limit=2`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as unknown[];
    expect(data.length).toBeLessThanOrEqual(2);
    expect(data.length).toBeGreaterThan(0);
  });

  it('existing discovery endpoint (nearLat/nearLng/radiusKm) still returns distances', async () => {
    const near = await locatedBusiness(`Legacy Near ${Date.now()}`, ANCHOR.lat + 0.01, ANCHOR.lng);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses?nearLat=${ANCHOR.lat}&nearLng=${ANCHOR.lng}&radiusKm=2`,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { id: string; distanceKm: number }[];
    const row = data.find((b) => b.id === near.id);
    expect(row).toBeDefined();
    expect(row!.distanceKm).toBeGreaterThan(1.0);
    expect(row!.distanceKm).toBeLessThan(1.25);
  });
});
