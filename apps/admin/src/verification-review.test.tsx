// @vitest-environment jsdom
/**
 * Regression test for the production incident (2026-09-23): the admin
 * Verification page rendered a blank white screen because the client
 * assumed GET /api/v1/admin/verifications returned `{ data: [...] }`,
 * while the server actually returns `{ data: { items, nextCursor } }`.
 * The detail endpoint likewise returns `{ data: <row> }` (the row already
 * nests `business` and `documents`), not `{ data: { application, ... } }`.
 * With the wrong shape, `apps.map` threw during render and React unmounted
 * the whole page.
 *
 * Unlike admin-sections.test.tsx (which mocks the api module), these tests
 * exercise the REAL client functions: only `fetch` is stubbed, returning the
 * exact envelopes the API serves. If the client drifts from the server
 * contract again, the real VerificationReview component throws here.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VerificationReview } from './sections.js';

/** One queue row, exactly as the server's adminVerification() renders it. */
const serverRow = {
  id: 'v1',
  status: 'SUBMITTED',
  legalName: 'Cafe Aroma LLC',
  publicName: 'Cafe Aroma',
  ownerName: 'Ali Khan',
  phone: '03001234567',
  address: 'Main Blvd',
  city: 'Lahore',
  categoryId: null,
  description: 'Cozy cafe',
  latitude: null,
  longitude: null,
  registrationInfo: null,
  reviewerMessage: null,
  adminNotes: null,
  reviewedByUserId: null,
  submittedAt: '2026-09-20T10:00:00.000Z',
  reviewedAt: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  business: {
    id: 'b1',
    name: 'Cafe Aroma',
    slug: 'cafe-aroma',
    owner: { id: 'u1', email: 'owner@example.com', firstName: 'Ali', lastName: 'Khan' },
  },
  documents: [
    { id: 'd1', docType: 'TRADE_LICENSE', storageKey: 'docs/k1', status: 'PENDING', uploadedAt: '2026-09-20T10:00:00.000Z' },
  ],
};

/** Stubs fetch with the real server envelopes, keyed by request pathname. */
function stubServer(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (!(path in routes)) throw new Error(`unexpected fetch: ${input}`);
      return { ok: true, status: 200, json: async () => routes[path] };
    }),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderReview() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<VerificationReview />);
  });
  return container;
}

const flush = () => act(async () => {});

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verification review (real client, real server envelope)', () => {
  it('renders the queue from the paginated { data: { items } } envelope', async () => {
    stubServer({ '/api/v1/admin/verifications': { data: { items: [serverRow], nextCursor: null } } });
    const c = await renderReview();
    // With the old client this threw "apps.map is not a function" and the
    // page went blank; the fixed client unwraps data.items.
    expect(c.textContent).toContain('Verification applications (1)');
    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('owner@example.com');
    expect(c.textContent).toContain('SUBMITTED');
  });

  it('shows the empty state instead of crashing when the queue is empty', async () => {
    stubServer({ '/api/v1/admin/verifications': { data: { items: [], nextCursor: null } } });
    const c = await renderReview();
    expect(c.textContent).toContain('No applications match these filters.');
  });

  it('opens the detail modal from the { data: <row> } envelope', async () => {
    stubServer({
      '/api/v1/admin/verifications': { data: { items: [serverRow], nextCursor: null } },
      '/api/v1/admin/verifications/v1': { data: serverRow },
      '/api/v1/admin/verifications/v1/approve': { data: { ...serverRow, status: 'APPROVED' } },
    });
    const c = await renderReview();
    const reviewBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Review')!;
    await act(async () => {
      reviewBtn.click();
    });
    await flush();
    // Submitted information comes from the nested row, not a flat envelope.
    expect(c.textContent).toContain('Cozy cafe');
    expect(c.textContent).toContain('Cafe Aroma LLC');
    expect(c.textContent).toContain('03001234567');
    // Documents come from row.documents with server docType values.
    expect(c.textContent).toContain('TRADE LICENSE');
    expect(c.textContent).toContain('PENDING');

    const approveBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Approve verification')!;
    await act(async () => {
      approveBtn.click();
    });
    await flush();
    // The modal closes after a successful decision.
    expect(c.textContent).not.toContain('Submitted information');
  });
});
