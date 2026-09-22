import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000', 'hex');

/** Real multipart body with a `type` text field and one image file part. */
function docMultipart(docType: string, bytes: Buffer = PNG, mimetype = 'image/png', filename = 'doc.png') {
  const boundary = '----vitestverifboundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${docType}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, bytes, tail]), boundary };
}

async function ownerWithBusiness() {
  const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
  const business = await createBusiness(app, owner.token);
  await prisma.business.update({ where: { id: business.id }, data: { status: 'APPROVED' } });
  return { ...owner, businessId: business.id };
}

const putDraft = (businessId: string, token: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/businesses/${businessId}/verification`, headers: authed(token), payload: body });

const uploadDoc = (businessId: string, token: string, docType = 'CNIC_FRONT') => {
  const { body, boundary } = docMultipart(docType);
  return app.inject({
    method: 'POST',
    url: `/api/v1/businesses/${businessId}/verification/documents`,
    headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
    payload: body,
  });
};

/** A complete, submittable application: draft + one document. */
async function completeApplication(token: string, businessId: string) {
  const draft = await putDraft(businessId, token, {
    legalName: 'Test Foods (Pvt) Ltd',
    ownerName: 'Test Owner',
    phone: '03001234567',
    address: '1 Main Road',
    city: 'Lahore',
  });
  expect(draft.statusCode).toBe(200);
  const up = await uploadDoc(businessId, token);
  expect(up.statusCode).toBe(201);
}

describe('owner verification draft', () => {
  it('GET returns null before any draft exists', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/verification`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it('PUT creates a draft; the owner DTO never leaks storage keys', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await putDraft(businessId, token, { legalName: 'Test Foods (Pvt) Ltd', ownerName: 'Ayesha', phone: '03001234567' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe('DRAFT');
    expect(data.legalName).toBe('Test Foods (Pvt) Ltd');
    expect(JSON.stringify(data)).not.toContain('storageKey');
    const get = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/verification`, headers: authed(token) });
    expect(get.json().data.id).toBe(data.id);
  });

  it('the owner cannot self-verify: isVerified is not an owner input', async () => {
    const { token, businessId } = await ownerWithBusiness();
    const res = await putDraft(businessId, token, { legalName: 'X', ownerName: 'Y', phone: '03001234567', isVerified: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).not.toHaveProperty('isVerified');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.isVerified).toBe(false);
    expect(business.verificationStatus).toBe('NOT_SUBMITTED');
  });

  it('verification is isolated per business: a foreign owner sees 404', async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    await putDraft(a.businessId, a.token, { legalName: 'A', ownerName: 'B', phone: '03001234567' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${a.businessId}/verification`, headers: authed(b.token) })).statusCode).toBe(404);
    expect((await putDraft(a.businessId, b.token, { legalName: 'hijack' })).statusCode).toBe(404);
  });

  it('a customer cannot touch the verification endpoints', async () => {
    const { businessId } = await ownerWithBusiness();
    const customer = await registerAndLogin(app);
    expect((await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/verification`, headers: authed(customer.token) })).statusCode).toBe(403);
  });
});

describe('verification documents', () => {
  it('upload requires the application to exist first', async () => {
    const { token, businessId } = await ownerWithBusiness();
    expect((await uploadDoc(businessId, token)).statusCode).toBe(404);
  });

  it('upload validates doc type, file presence and image MIME', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await putDraft(businessId, token, { legalName: 'X', ownerName: 'Y', phone: '03001234567' });
    const noType = await uploadDoc(businessId, token, '');
    expect(noType.statusCode).toBe(400);
    const { body, boundary } = docMultipart('CNIC_FRONT', Buffer.from('not an image'), 'application/pdf', 'doc.pdf');
    const badMime = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/verification/documents`,
      headers: { ...authed(token), 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      payload: body,
    });
    expect(badMime.statusCode).toBe(400);
  });

  it('upload succeeds and the document shows on the draft without its storage key', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await putDraft(businessId, token, { legalName: 'X', ownerName: 'Y', phone: '03001234567' });
    const res = await uploadDoc(businessId, token, 'TRADE_LICENSE');
    expect(res.statusCode).toBe(201);
    const doc = res.json().data;
    expect(doc.docType).toBe('TRADE_LICENSE');
    expect(doc.status).toBe('PENDING');
    const get = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/verification`, headers: authed(token) });
    expect(get.json().data.documents).toHaveLength(1);
    expect(JSON.stringify(get.json().data)).not.toContain('storageKey');
  });

  it('document bytes are readable only by the owning business or an admin', async () => {
    const owner = await ownerWithBusiness();
    const foreign = await ownerWithBusiness();
    const admin = await registerAdminAndLogin(app);
    await completeApplication(owner.token, owner.businessId);
    const row = await prisma.verificationDocument.findFirstOrThrow({ where: { application: { businessId: owner.businessId } } });
    const url = `/api/v1/verification/documents/${row.storageKey}`;
    const asOwner = await app.inject({ method: 'GET', url, headers: authed(owner.token) });
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.headers['content-type']).toContain('image/png');
    expect((await app.inject({ method: 'GET', url, headers: authed(foreign.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url, headers: authed(admin.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
});

describe('submit for review', () => {
  it('submit lists every missing field with INCOMPLETE_APPLICATION', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await putDraft(businessId, token, { legalName: 'Only Name Set' });
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/verification/submit`, headers: authed(token) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INCOMPLETE_APPLICATION');
    expect(res.json().error.message).toContain('ownerName');
    expect(res.json().error.message).toContain('phone');
    expect(res.json().error.message).toContain('documents');
  });

  it('submit succeeds with the full draft and flips the business to PENDING', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await completeApplication(token, businessId);
    const res = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/verification/submit`, headers: authed(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('SUBMITTED');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.verificationStatus).toBe('PENDING');
  });

  it('a submitted application is locked for editing and resubmission', async () => {
    const { token, businessId } = await ownerWithBusiness();
    await completeApplication(token, businessId);
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/verification/submit`, headers: authed(token) });
    expect((await putDraft(businessId, token, { legalName: 'changed' })).statusCode).toBe(409);
    expect((await uploadDoc(businessId, token)).statusCode).toBe(409);
    const resubmit = await app.inject({ method: 'POST', url: `/api/v1/businesses/${businessId}/verification/submit`, headers: authed(token) });
    expect(resubmit.statusCode).toBe(409);
    expect(resubmit.json().error.code).toBe('NOT_EDITABLE');
  });
});

describe('admin verification review', () => {
  async function submittedApplication() {
    const owner = await ownerWithBusiness();
    await completeApplication(owner.token, owner.businessId);
    await app.inject({ method: 'POST', url: `/api/v1/businesses/${owner.businessId}/verification/submit`, headers: authed(owner.token) });
    const application = await prisma.verificationApplication.findUniqueOrThrow({ where: { businessId: owner.businessId } });
    const admin = await registerAdminAndLogin(app);
    return { owner, application, admin };
  }

  it('admin lists and reads the queue with business context', async () => {
    const { application, admin } = await submittedApplication();
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/verifications', headers: authed(admin.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items.map((a: { id: string }) => a.id)).toContain(application.id);
    const one = await app.inject({ method: 'GET', url: `/api/v1/admin/verifications/${application.id}`, headers: authed(admin.token) });
    expect(one.statusCode).toBe(200);
    expect(one.json().data.business.slug).toBeTruthy();
    expect(one.json().data.documents).toHaveLength(1);
  });

  it('approve marks VERIFIED, sets the badge, and unlocks the trial', async () => {
    const { owner, application, admin } = await submittedApplication();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/verifications/${application.id}/approve`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Looks good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('APPROVED');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } });
    expect(business.isVerified).toBe(true);
    expect(business.verificationStatus).toBe('VERIFIED');
    expect(business.verifiedAt).not.toBeNull();
    // Verification is the eligibility gate: NOT_ELIGIBLE becomes ELIGIBLE.
    expect(business.trialStatus).toBe('ELIGIBLE');
    const docs = await prisma.verificationDocument.findMany({ where: { applicationId: application.id } });
    expect(docs.every((d) => d.status === 'ACCEPTED')).toBe(true);
    // The now-eligible business can start its trial through the normal route.
    const trial = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${owner.businessId}/subscription/trial/apply`,
      headers: authed(owner.token),
      payload: { planSlug: 'nearbyorders-business' },
    });
    expect(trial.statusCode).toBe(201);
  });

  it('approve is idempotent-safe: double approve is rejected', async () => {
    const { application, admin } = await submittedApplication();
    await app.inject({ method: 'POST', url: `/api/v1/admin/verifications/${application.id}/approve`, headers: authed(admin.token), payload: {} });
    const again = await app.inject({ method: 'POST', url: `/api/v1/admin/verifications/${application.id}/approve`, headers: authed(admin.token), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NOT_SUBMITTED');
  });

  it('reject requires a reviewer message and clears the badge path', async () => {
    const { owner, application, admin } = await submittedApplication();
    const missing = await app.inject({ method: 'POST', url: `/api/v1/admin/verifications/${application.id}/reject`, headers: authed(admin.token), payload: {} });
    expect(missing.statusCode).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/verifications/${application.id}/reject`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Document is unreadable' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('REJECTED');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } });
    expect(business.isVerified).toBe(false);
    expect(business.verificationStatus).toBe('REJECTED');
    expect(business.trialStatus).toBe('NOT_ELIGIBLE');
  });

  it('request-changes returns the draft to editable state', async () => {
    const { owner, application, admin } = await submittedApplication();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/verifications/${application.id}/request-changes`,
      headers: authed(admin.token),
      payload: { reviewerMessage: 'Please add a clearer photo of the license' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CHANGES_REQUESTED');
    // The owner can edit again (draft resets to DRAFT on save). The business
    // stays PENDING — the application is still in the review pipeline.
    const edit = await putDraft(owner.businessId, owner.token, { legalName: 'Corrected Legal Name' });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().data.status).toBe('DRAFT');
    const business = await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } });
    expect(business.verificationStatus).toBe('PENDING');
  });

  it('non-admins cannot reach the admin review endpoints', async () => {
    const { owner, application } = await submittedApplication();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/verifications', headers: authed(owner.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/verifications/${application.id}/approve`, headers: authed(owner.token), payload: {} })).statusCode).toBe(403);
  });
});
