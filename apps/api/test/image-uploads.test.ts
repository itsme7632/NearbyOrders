import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeApp, registerAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';
import { IMAGE_KEY_PATTERN } from '../src/imageStorage.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

/** Minimal real magic bytes per type (the server validates the MIME label). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000', 'hex');
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');

/** Builds a real multipart body with one image part (the upload wire format). */
const multipartBody = (bytes: Buffer, mimetype = 'image/png', filename = 'photo.png') => {
  const boundary = '----vitestimageboundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, bytes, tail]), boundary };
};

const uploadImage = (businessId: string, token: string, bytes: Buffer, mimetype = 'image/png', filename = 'photo.png') => {
  const { body, boundary } = multipartBody(bytes, mimetype, filename);
  return app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/images`,
    headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
    payload: body,
  });
};

/** The directory the API persists images to (explicit UPLOADS_DIR or the dev default). */
const uploadsDir = () => process.env.UPLOADS_DIR ?? path.join(process.cwd(), '.uploads');

describe('business/product image upload (P1)', () => {
  it('1. valid JPEG succeeds and returns a stored image URL', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, JPEG, 'image/jpeg', 'photo.jpg');
    expect(res.statusCode).toBe(201);
    const imageUrl = (JSON.parse(res.body).data.imageUrl as string);
    expect(imageUrl).toMatch(/^\/api\/v1\/images\/uploads\/[0-9a-f-]{36}\.jpg$/);
  });

  it('2. valid PNG succeeds', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, PNG, 'image/png', 'photo.png');
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.imageUrl as string).toMatch(/^\/api\/v1\/images\/uploads\/[0-9a-f-]{36}\.png$/);
  });

  it('3. valid WebP succeeds', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, WEBP, 'image/webp', 'photo.webp');
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.imageUrl as string).toMatch(/^\/api\/v1\/images\/uploads\/[0-9a-f-]{36}\.webp$/);
  });

  it('4. unsupported MIME types are rejected', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    for (const [bytes, mimetype, filename] of [
      [Buffer.from('not an image'), 'application/pdf', 'doc.pdf'],
      [Buffer.from('GIF89a'), 'image/gif', 'anim.gif'],
      [Buffer.from('<svg/>'), 'image/svg+xml', 'vector.svg'],
    ] as const) {
      const res = await uploadImage(id, token, bytes, mimetype, filename);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('5. files larger than 5 MB are rejected', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 'huge.png');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('5b. a second file part is rejected (exactly one image per upload)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const boundary = '----vitestimageboundary2';
    const part = (filename: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
    const body = Buffer.from(
      part('a.png') + PNG.toString('binary') + '\r\n' + part('b.png') + PNG.toString('binary') + '\r\n' + `--${boundary}--\r\n`,
      'binary',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/images`,
      headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('5c. empty files are rejected', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, Buffer.alloc(0), 'image/png', 'empty.png');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('6. unauthenticated upload is rejected', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const { body, boundary } = multipartBody(PNG);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${id}/images`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('7. a customer attempting upload is rejected', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id } = await createBusiness(app, owner.token);
    const res = await uploadImage(id, customer.token, PNG);
    expect(res.statusCode).toBe(403);
  });

  it('8. an owner cannot upload to another owner\u2019s business', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, ownerA.token);
    const res = await uploadImage(id, ownerB.token, PNG);
    expect(res.statusCode).toBe(404);
  });

  it('9. storage keys are opaque and server-generated (never the client filename)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const first = JSON.parse((await uploadImage(id, token, PNG, 'image/png', '../../evil.png')).body).data.imageUrl as string;
    const second = JSON.parse((await uploadImage(id, token, PNG, 'image/png', '../../evil.png')).body).data.imageUrl as string;
    expect(first).not.toContain('evil');
    expect(first).not.toContain('..');
    expect(second).not.toContain('evil');
    // Same bytes, same client filename → distinct keys (UUID v4 each time).
    expect(first).not.toBe(second);
    expect(first.replace('/api/v1/images/', '')).toMatch(IMAGE_KEY_PATTERN);
  });

  it('10. path traversal cannot occur on read or write', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    // Evil client filename is neutralized at write time (see test 9).
    const res = await uploadImage(id, token, PNG, 'image/png', '..%2F..%2Fsecrets.png');
    expect(res.statusCode).toBe(201);
    // Traversal-shaped reads never reach disk.
    for (const evil of [
      '/api/v1/images/..%2F..%2Fetc%2Fpasswd',
      '/api/v1/images/uploads/%2E%2E/%2E%2E/secrets.txt',
      '/api/v1/images/receipts/some-key.png',
      '/api/v1/images/uploads/not-a-uuid.png',
      // UUID-shaped but not v4 (nil UUID): the strict key pattern rejects it.
      '/api/v1/images/uploads/00000000-0000-0000-0000-000000000000.png',
    ]) {
      const get = await app.inject({ method: 'GET', url: evil });
      expect(get.statusCode).toBe(404);
    }
  });

  it('11. image bytes persist on disk under the configured UPLOADS_DIR (volume-mountable)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const res = await uploadImage(id, token, PNG);
    expect(res.statusCode).toBe(201);
    const imageUrl = JSON.parse(res.body).data.imageUrl as string;
    const key = imageUrl.replace('/api/v1/images/', '');
    const onDisk = path.join(uploadsDir(), key);
    // Persistence is a filesystem property: the bytes live under the explicit
    // UPLOADS_DIR (mounted as a persistent volume in production), not in
    // memory and not inside the build directory.
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).equals(PNG)).toBe(true);
    // Served back with the right content type, immutable caching, and the
    // exact byte length.
    const get = await app.inject({ method: 'GET', url: imageUrl });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['cache-control']).toContain('immutable');
    expect(get.headers['content-length']).toBe(String(PNG.length));
  });
});

describe('business image wiring (P1)', () => {
  it('12. imageUrl is saved on the business and served to viewers', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, JPEG, 'image/jpeg')).body).data.imageUrl as string;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBe(imageUrl);
    // Owner read-back shows the saved image (reload persistence).
    const mine = await app.inject({ method: 'GET', url: '/api/v1/businesses/mine', headers: authed(token) });
    expect(mine.json().data[0].imageUrl).toBe(imageUrl);
  });

  it('13. replacing the business image works', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const first = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    await app.inject({ method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl: first } });
    const second = JSON.parse((await uploadImage(id, token, WEBP, 'image/webp')).body).data.imageUrl as string;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl: second },
    });
    expect(patch.json().data.imageUrl).toBe(second);
    expect(patch.json().data.imageUrl).not.toBe(first);
  });

  it('14. removing the business image works', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    await app.inject({ method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl } });
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl: null },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBeNull();
  });

  it('15. saving other profile fields without an image key never destroys the image', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    await app.inject({ method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { imageUrl } });
    // A save with no new image omits the imageUrl key entirely (the mobile
    // save flow only sends the key when uploading or explicitly removing).
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/businesses/${id}`, headers: authed(token), payload: { name: 'Renamed Business' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBe(imageUrl);
  });
});

describe('product image wiring (P1)', () => {
  const createProduct = (businessId: string, token: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/products`, headers: authed(token), payload: body });

  it('16. create product with an image', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    const res = await createProduct(id, token, { name: 'Test Biryani', priceMinor: 45000, imageUrl });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.imageUrl).toBe(imageUrl);
  });

  it('17. update product image', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const first = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    const created = await createProduct(id, token, { name: 'Test Biryani', priceMinor: 45000, imageUrl: first });
    const productId = created.json().data.id as string;
    const second = JSON.parse((await uploadImage(id, token, JPEG, 'image/jpeg')).body).data.imageUrl as string;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/products/${productId}`, headers: authed(token), payload: { imageUrl: second },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBe(second);
  });

  it('18. remove product image', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    const created = await createProduct(id, token, { name: 'Test Biryani', priceMinor: 45000, imageUrl });
    const productId = created.json().data.id as string;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/products/${productId}`, headers: authed(token), payload: { imageUrl: null },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBeNull();
  });

  it('19. failed replacement preserves the previous product image (key omitted)', async () => {
    const { token } = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id } = await createBusiness(app, token);
    const imageUrl = JSON.parse((await uploadImage(id, token, PNG)).body).data.imageUrl as string;
    const created = await createProduct(id, token, { name: 'Test Biryani', priceMinor: 45000, imageUrl });
    const productId = created.json().data.id as string;
    // The mobile save flow uploads FIRST and aborts the PATCH when the upload
    // fails — so a failed replacement never reaches the server and the stored
    // image is untouched. A PATCH without the key must also keep the value.
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/products/${productId}`, headers: authed(token), payload: { name: 'Renamed Biryani' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageUrl).toBe(imageUrl);
  });
});

describe('verification document upload contract (P1)', () => {
  /** Real multipart body with a `type` text field and one image file part. */
  const docMultipart = (type: string | null, bytes: Buffer = PNG, mimetype = 'image/png', filename = 'doc.png', fieldName = 'type') => {
    const boundary = '----vitestverifp1boundary';
    const typePart = type === null ? '' : `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${type}\r\n`;
    const head = Buffer.from(
      typePart +
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { body: Buffer.concat([head, bytes, tail]), boundary };
  };

  const uploadDoc = (businessId: string, token: string, type: string | null, fieldName = 'type') => {
    const { body, boundary } = docMultipart(type, PNG, 'image/png', 'doc.png', fieldName);
    return app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/verification/documents`,
      headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
  };

  async function ownerWithApplication() {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const business = await createBusiness(app, owner.token);
    await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
    const draft = await app.inject({
      method: 'PUT', url: `/api/v1/businesses/${business.id}/verification`, headers: authed(owner.token),
      payload: { legalName: 'Test Foods (Pvt) Ltd', ownerName: 'Test Owner', phone: '03001234567' },
    });
    expect(draft.statusCode).toBe(200);
    return { ...owner, businessId: business.id };
  }

  it('20. valid document upload succeeds via the `type` field (the fixed contract)', async () => {
    const { token, businessId } = await ownerWithApplication();
    const res = await uploadDoc(businessId, token, 'IDENTITY');
    expect(res.statusCode).toBe(201);
  });

  it('21. the document type is correctly passed through to the stored row', async () => {
    const { token, businessId } = await ownerWithApplication();
    const res = await uploadDoc(businessId, token, 'TRADE_LICENSE');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.docType).toBe('TRADE_LICENSE');
    // The legacy client field name `docType` is NOT accepted — the contract is
    // strict and consistent, not lenient about extra fields.
    const legacy = await uploadDoc(businessId, token, 'IDENTITY', 'docType');
    expect(legacy.statusCode).toBe(400);
  });

  it('22. invalid or missing document types are rejected', async () => {
    const { token, businessId } = await ownerWithApplication();
    expect((await uploadDoc(businessId, token, null)).statusCode).toBe(400);
    expect((await uploadDoc(businessId, token, '')).statusCode).toBe(400);
    expect((await uploadDoc(businessId, token, 'X')).statusCode).toBe(400);
    expect((await uploadDoc(businessId, token, 'A'.repeat(41))).statusCode).toBe(400);
  });
});
