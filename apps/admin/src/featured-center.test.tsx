// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FeaturedItem } from './api.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  listPromotions: vi.fn(),
  listPromotionRequests: vi.fn(),
  listPromotionPaymentRequests: vi.fn(),
  listFeatured: vi.fn(),
  listBusinesses: vi.fn(),
  createEditorialFeature: vi.fn(),
  updateEditorialFeature: vi.fn(),
  endEditorialFeature: vi.fn(),
  deleteEditorialFeature: vi.fn(),
}));

async function renderInto(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

const flush = () => act(async () => {});

const setNative = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const clickText = async (c: HTMLDivElement, text: string) => {
  const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  await act(async () => {
    btn.click();
  });
  await flush();
};

const paidItem: FeaturedItem = {
  id: 'rq1',
  source: 'paid',
  state: 'active',
  business: { id: 'b1', name: 'Cafe Aroma', slug: 'cafe-aroma' },
  placementType: 'promotion',
  label: 'Featured',
  promotion: { id: 'pr1', name: 'Ramadan Spotlight', slug: 'ramadan-spotlight' },
  payment: { id: 'pay1', status: 'APPROVED', amountMinor: 499900, currency: 'PKR' },
  startsAt: '2026-09-22T10:00:00.000Z',
  endsAt: '2026-10-22T10:00:00.000Z',
};

const editorialItem: FeaturedItem = {
  id: 'ef1',
  source: 'editorial',
  state: 'active',
  business: { id: 'b2', name: 'Lahore Biryani House', slug: 'lahore-biryani-house' },
  placementType: 'homepage_hero',
  label: 'Homepage hero',
  promotion: null,
  payment: null,
  startsAt: '2026-09-20T10:00:00.000Z',
  endsAt: '2026-10-20T10:00:00.000Z',
};

async function openFeaturedTab(items: FeaturedItem[] = [paidItem, editorialItem]) {
  const api = await import('./api.js');
  vi.mocked(api.listPromotions).mockResolvedValue([]);
  vi.mocked(api.listPromotionRequests).mockResolvedValue([]);
  vi.mocked(api.listFeatured).mockResolvedValue(items);
  const { PromotionCenter } = await import('./promotion-center.js');
  const c = await renderInto(<PromotionCenter />);
  await clickText(c, 'Featured');
  return c;
}

const rowFor = (c: HTMLDivElement, businessName: string) => {
  const rows = Array.from(c.querySelectorAll('tbody tr'));
  const row = rows.find((r) => r.textContent?.includes(businessName));
  if (!row) throw new Error(`row for "${businessName}" not found`);
  return row as HTMLTableRowElement;
};

describe('featured tab: paid vs editorial labeling', () => {
  it('labels paid and editorial items distinctly', async () => {
    const c = await openFeaturedTab();
    expect(c.textContent).toContain('Paid promotion');
    expect(c.textContent).toContain('Editorial pick');
    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('Lahore Biryani House');
  });

  it('gives paid rows no editorial actions and states the activation rule', async () => {
    const c = await openFeaturedTab();
    const paidRow = rowFor(c, 'Cafe Aroma');
    const rowButtons = Array.from(paidRow.querySelectorAll('button')).map((b) => b.textContent);
    expect(rowButtons).toEqual(['View']);

    // No activation surface anywhere on the tab.
    const allButtons = Array.from(c.querySelectorAll('button')).map((b) => b.textContent);
    expect(allButtons).not.toContain('Activate promotion');
    expect(allButtons).not.toContain('Approve payment');

    await act(async () => {
      (paidRow.querySelector('button') as HTMLButtonElement).click();
    });
    await flush();
    const drawer = c.querySelector('.drawer');
    expect(drawer!.textContent).toContain('Paid promotion');
    expect(drawer!.textContent).toContain('cannot be started, extended, or ended from this screen');
  });

  it('shows editorial rows with Extend, End early, and Remove actions', async () => {
    const c = await openFeaturedTab();
    const editorialRow = rowFor(c, 'Lahore Biryani House');
    const rowButtons = Array.from(editorialRow.querySelectorAll('button')).map((b) => b.textContent);
    expect(rowButtons).toEqual(['View', 'Extend', 'End early', 'Remove']);
  });
});

describe('featured tab: editorial lifecycle actions', () => {
  it('ends an editorial feature early after confirmation', async () => {
    const api = await import('./api.js');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = await openFeaturedTab();

    const editorialRow = rowFor(c, 'Lahore Biryani House');
    const endBtn = Array.from(editorialRow.querySelectorAll('button')).find((b) => b.textContent === 'End early')!;
    await act(async () => {
      endBtn.click();
    });
    await flush();

    expect(window.confirm).toHaveBeenCalled();
    expect(vi.mocked(api.endEditorialFeature)).toHaveBeenCalledWith('ef1');
    expect(vi.mocked(api.listFeatured).mock.calls.length).toBeGreaterThan(1);
  });

  it('removes an editorial feature after confirmation', async () => {
    const api = await import('./api.js');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = await openFeaturedTab();

    const editorialRow = rowFor(c, 'Lahore Biryani House');
    const removeBtn = Array.from(editorialRow.querySelectorAll('button')).find((b) => b.textContent === 'Remove')!;
    await act(async () => {
      removeBtn.click();
    });
    await flush();

    expect(vi.mocked(api.deleteEditorialFeature)).toHaveBeenCalledWith('ef1');
    expect(vi.mocked(api.listFeatured).mock.calls.length).toBeGreaterThan(1);
  });

  it('extends the end date only with a later date', async () => {
    const api = await import('./api.js');
    const c = await openFeaturedTab();

    const editorialRow = rowFor(c, 'Lahore Biryani House');
    const extendBtn = Array.from(editorialRow.querySelectorAll('button')).find((b) => b.textContent === 'Extend')!;
    await act(async () => {
      extendBtn.click();
    });
    await flush();

    expect(c.textContent).toContain('Extend feature: Homepage hero');
    const dateInput = c.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await act(async () => {
      setNative(dateInput, '2026-11-15T12:00');
    });
    await flush();
    await clickText(c, 'Extend feature');

    expect(vi.mocked(api.updateEditorialFeature)).toHaveBeenCalledWith('ef1', {
      endAt: new Date('2026-11-15T12:00').toISOString(),
    });
    expect(vi.mocked(api.listFeatured).mock.calls.length).toBeGreaterThan(1);
  });

  it('refuses an extension date that is not later than the current end', async () => {
    const api = await import('./api.js');
    const c = await openFeaturedTab();

    const editorialRow = rowFor(c, 'Lahore Biryani House');
    const extendBtn = Array.from(editorialRow.querySelectorAll('button')).find((b) => b.textContent === 'Extend')!;
    await act(async () => {
      extendBtn.click();
    });
    await flush();

    const dateInput = c.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await act(async () => {
      setNative(dateInput, '2026-09-01T12:00');
    });
    await flush();
    await clickText(c, 'Extend feature');

    expect(c.textContent).toContain('must be later than the current end date');
    expect(vi.mocked(api.updateEditorialFeature)).not.toHaveBeenCalled();
  });
});

describe('featured tab: new editorial feature', () => {
  it('creates a free editorial feature without any promotion or payment fields', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listBusinesses).mockResolvedValue([
      { id: 'b2', name: 'Lahore Biryani House', slug: 'lahore-biryani-house' },
    ] as never);
    const c = await openFeaturedTab();
    await clickText(c, 'New editorial feature');

    // Business search and select.
    const searchInput = c.querySelector('input[aria-label="Search businesses"]') as HTMLInputElement;
    await act(async () => {
      setNative(searchInput, 'Lahore');
    });
    await flush();
    await clickText(c, 'Search');
    expect(vi.mocked(api.listBusinesses)).toHaveBeenCalledWith({ q: 'Lahore' });
    await clickText(c, 'Select');

    // Placement type and end date.
    const placementInput = c.querySelector('input[placeholder="homepage_hero"]') as HTMLInputElement;
    await act(async () => {
      setNative(placementInput, 'homepage_hero');
    });
    await flush();
    const dateInputs = Array.from(c.querySelectorAll('input[type="datetime-local"]')) as HTMLInputElement[];
    await act(async () => {
      setNative(dateInputs[1], '2026-10-31T12:00');
    });
    await flush();
    await clickText(c, 'Create editorial feature');

    expect(vi.mocked(api.createEditorialFeature)).toHaveBeenCalledWith({
      businessId: 'b2',
      placementType: 'homepage_hero',
      label: undefined,
      startAt: undefined,
      endAt: new Date('2026-10-31T12:00').toISOString(),
    });
    const body = vi.mocked(api.createEditorialFeature).mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('promotionId');
    expect(body).not.toHaveProperty('paymentId');
    expect(body).not.toHaveProperty('amountMinor');
  });
});

describe('active placements tab', () => {
  it('lists live paid placements with placement, started, ends, and status columns', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotions).mockResolvedValue([]);
    vi.mocked(api.listPromotionRequests).mockResolvedValue([]);
    vi.mocked(api.listFeatured).mockResolvedValue([paidItem, editorialItem]);
    const { PromotionCenter } = await import('./promotion-center.js');
    const c = await renderInto(<PromotionCenter />);
    await clickText(c, 'Active');

    expect(vi.mocked(api.listFeatured)).toHaveBeenCalledWith('active');
    for (const h of ['Business', 'Promotion', 'Placement', 'Started', 'Ends', 'Status']) {
      expect(c.querySelectorAll('th')).toSatisfy((ths) => Array.from(ths as unknown as Element[]).some((th) => th.textContent === h));
    }
    // Only paid placements appear; editorial items stay on the Featured tab.
    expect(c.textContent).toContain('Cafe Aroma');
    expect(c.textContent).toContain('Ramadan Spotlight');
    expect(c.textContent).not.toContain('Lahore Biryani House');
  });

  it('shows an empty state when no paid promotions are live', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listPromotions).mockResolvedValue([]);
    vi.mocked(api.listPromotionRequests).mockResolvedValue([]);
    vi.mocked(api.listFeatured).mockResolvedValue([editorialItem]);
    const { PromotionCenter } = await import('./promotion-center.js');
    const c = await renderInto(<PromotionCenter />);
    await clickText(c, 'Active');

    expect(c.textContent).toContain('No paid promotions are live right now.');
  });
});
