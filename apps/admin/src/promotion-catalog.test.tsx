// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AdminPromotion } from './api.js';

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
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
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

const promo = (patch: Partial<AdminPromotion> = {}): AdminPromotion => ({
  id: 'pr1',
  slug: 'ramadan-spotlight',
  name: 'Ramadan Spotlight',
  description: 'Homepage banner for 7 days.',
  benefits: ['Homepage banner', 'Social mention'],
  priceMinor: 499900,
  currency: 'PKR',
  durationDays: 30,
  requirements: null,
  isActive: true,
  displayOrder: 0,
  requestCount: 2,
  ...patch,
});

async function renderCatalog(promos: AdminPromotion[] = [promo()]) {
  const api = await import('./api.js');
  vi.mocked(api.listPromotions).mockResolvedValue(promos);
  const { PromotionCatalog } = await import('./sections.js');
  return renderInto(<PromotionCatalog />);
}

describe('promotion catalog CRUD (regression)', () => {
  it('renders the catalog with price, duration, status, and request counts', async () => {
    const c = await renderCatalog();
    expect(c.textContent).toContain('Ramadan Spotlight');
    expect(c.textContent).toContain('30 days');
    expect(c.textContent).toContain('Active');
  });

  it('creates a promotion from the dialog', async () => {
    const api = await import('./api.js');
    const created = promo({ id: 'pr2', slug: 'eid-banner', name: 'Eid Banner' });
    vi.mocked(api.createPromotion).mockResolvedValue(created);
    const c = await renderCatalog();
    await clickText(c, 'New promotion');

    const nameInput = c.querySelector('input[placeholder="Ramadan Spotlight"]') as HTMLInputElement;
    const priceInput = c.querySelector('input[placeholder="4999"]') as HTMLInputElement;
    await act(async () => {
      setNative(nameInput, 'Eid Banner');
      setNative(priceInput, '2999');
    });
    await flush();
    await clickText(c, 'Create promotion');

    expect(vi.mocked(api.createPromotion)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Eid Banner', priceMinor: 299900 }),
    );
    expect(vi.mocked(api.listPromotions).mock.calls.length).toBeGreaterThan(1);
  });

  it('edits a promotion and saves the changes', async () => {
    const api = await import('./api.js');
    vi.mocked(api.updatePromotion).mockResolvedValue(promo({ name: 'Ramadan Spotlight Plus' }));
    const c = await renderCatalog();
    await clickText(c, 'Edit');

    expect(c.textContent).toContain('Edit promotion: Ramadan Spotlight');
    await clickText(c, 'Save changes');

    expect(vi.mocked(api.updatePromotion)).toHaveBeenCalledWith('pr1', expect.objectContaining({ name: 'Ramadan Spotlight' }));
  });

  it('deactivates and reactivates a promotion', async () => {
    const api = await import('./api.js');
    const c = await renderCatalog();
    await clickText(c, 'Deactivate');
    expect(vi.mocked(api.updatePromotion)).toHaveBeenCalledWith('pr1', { isActive: false });

    const d = await renderCatalog([promo({ isActive: false })]);
    await clickText(d, 'Activate');
    expect(vi.mocked(api.updatePromotion)).toHaveBeenCalledWith('pr1', { isActive: true });
  });

  it('deletes a promotion after confirmation', async () => {
    const api = await import('./api.js');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = await renderCatalog();
    await clickText(c, 'Delete');

    expect(window.confirm).toHaveBeenCalled();
    expect(vi.mocked(api.deletePromotion)).toHaveBeenCalledWith('pr1');
  });

  it('does not delete when the confirmation is dismissed', async () => {
    const api = await import('./api.js');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const c = await renderCatalog();
    await clickText(c, 'Delete');

    expect(vi.mocked(api.deletePromotion)).not.toHaveBeenCalled();
  });

  it('shows a guidance error when a referenced promotion cannot be deleted', async () => {
    const api = await import('./api.js');
    const { ApiError } = await import('./api.js');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.deletePromotion).mockRejectedValue(new ApiError(409, 'PROMOTION_IN_USE', 'Promotion requests reference it'));
    const c = await renderCatalog();
    await clickText(c, 'Delete');

    expect(c.textContent).toContain('Cannot delete "Ramadan Spotlight"');
    expect(c.textContent).toContain('Deactivate it instead');
  });
});
