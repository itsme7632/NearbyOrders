// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AdminDashboard } from './api.js';

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
  getDashboard: vi.fn(),
}));

const dashboard = (patch: Partial<AdminDashboard> = {}): AdminDashboard => ({
  users: 10,
  customers: 8,
  businessOwners: 2,
  businesses: 5,
  activeBusinesses: 4,
  pendingBusinesses: 3,
  suspendedBusinesses: 1,
  bookings: 6,
  pendingBookings: 2,
  orders: 20,
  pendingOrders: 4,
  pendingSubscriptionPayments: 2,
  reviews: 15,
  hiddenReviews: 1,
  pushDevices: { total: 9, active: 7, android: 8, ios: 1, web: 0 },
  ...patch,
});

async function renderDashboard(onTriage: (section: string, status?: string) => void) {
  const api = await import('./api.js');
  vi.mocked(api.getDashboard).mockResolvedValue(dashboard());
  const { Dashboard } = await import('./main.js');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Dashboard onTriage={onTriage} />);
  });
  return container;
}

function triageButton(label: string): HTMLButtonElement {
  const btn = container!.querySelector<HTMLButtonElement>(`button.stat-triage[aria-label^="${label}"]`);
  if (!btn) throw new Error(`triage button not found: ${label}`);
  return btn;
}

describe('admin dashboard triage (Phase 3G)', () => {
  it('attention cards open their queue pre-filtered', async () => {
    const onTriage = vi.fn();
    await renderDashboard(onTriage);

    await act(async () => {
      triageButton('Pending businesses').click();
    });
    expect(onTriage).toHaveBeenCalledWith('businesses', 'PENDING');

    await act(async () => {
      triageButton('Pending orders').click();
    });
    expect(onTriage).toHaveBeenCalledWith('orders', 'PENDING');

    await act(async () => {
      triageButton('Payment requests').click();
    });
    expect(onTriage).toHaveBeenCalledWith('payments', 'PENDING');

    await act(async () => {
      triageButton('Hidden reviews').click();
    });
    expect(onTriage).toHaveBeenCalledWith('reviews', 'hidden');
  });

  it('non-attention cards stay informational, not clickable', async () => {
    await renderDashboard(vi.fn());
    const usersBtn = container!.querySelector('button[aria-label^="Users"]');
    expect(usersBtn).toBeNull();
    // The informational card still renders its value.
    expect(container!.textContent).toContain('Users');
  });
});
