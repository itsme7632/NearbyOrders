// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as api from './api.js';
import { AdminApp } from './main.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const session = {
  accessToken: 'token-1',
  user: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // getSession returns a fresh object per call in production (JSON.parse);
  // mirror that so the test reproduces the real identity behavior.
  vi.spyOn(api, 'getSession').mockImplementation(() => JSON.parse(JSON.stringify(session)));
  vi.spyOn(api, 'getDashboard').mockResolvedValue({
    users: 1, customers: 1, businessOwners: 0, businesses: 0, activeBusinesses: 0,
    pendingBusinesses: 0, suspendedBusinesses: 0, pendingOrders: 0, pendingBookings: 0,
    pendingSubscriptionPayments: 0, hiddenReviews: 0,
  } as any);
  vi.spyOn(api, 'listVerifications').mockResolvedValue([]);
  vi.spyOn(api, 'listPromotionRequests').mockResolvedValue([]);
  vi.spyOn(api, 'listPromotionPaymentRequests').mockResolvedValue({ items: [] } as any);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AdminApp session sync (rate-limit regression)', () => {
  it('does not refetch queue badges on a timer while the session is unchanged', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminApp />);
    });
    // Let the initial badge fetch settle.
    await act(async () => {
      await Promise.resolve();
    });
    const settled = {
      dashboard: vi.mocked(api.getDashboard).mock.calls.length,
      verifications: vi.mocked(api.listVerifications).mock.calls.length,
      promotionRequests: vi.mocked(api.listPromotionRequests).mock.calls.length,
      promotionPaymentRequests: vi.mocked(api.listPromotionPaymentRequests).mock.calls.length,
    };
    expect(settled.dashboard).toBeGreaterThan(0);

    // Simulate 30 seconds of an idle admin tab open in the background.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    // The badge queries must not have refetched: 5 requests every 1.5s
    // (200 req/min) is what was exhausting the per-IP rate-limit bucket.
    expect(vi.mocked(api.getDashboard).mock.calls.length).toBe(settled.dashboard);
    expect(vi.mocked(api.listVerifications).mock.calls.length).toBe(settled.verifications);
    expect(vi.mocked(api.listPromotionRequests).mock.calls.length).toBe(settled.promotionRequests);
    expect(vi.mocked(api.listPromotionPaymentRequests).mock.calls.length).toBe(settled.promotionPaymentRequests);
  });

  it('still reacts to a 401 logout without polling', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminApp />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Dashboard content is visible while signed in.
    expect(container!.textContent).toContain('Command center');

    // A 401 inside the API client clears the session; the app must return
    // to the login screen via the session subscription (no timer involved).
    await act(async () => {
      api.setSession(null);
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('Control Center');
  });

  it('does not refetch queue badges when session object identity changes but content is identical', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminApp />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const settled = {
      dashboard: vi.mocked(api.getDashboard).mock.calls.length,
      verifications: vi.mocked(api.listVerifications).mock.calls.length,
      promotionRequests: vi.mocked(api.listPromotionRequests).mock.calls.length,
      promotionPaymentRequests: vi.mocked(api.listPromotionPaymentRequests).mock.calls.length,
    };
    expect(settled.dashboard).toBeGreaterThan(0);

    // Simulate a new-but-equivalent session object flowing through (e.g.,
    // JSON.parse creating a fresh object with identical content). The badge
    // effect must NOT refetch — this is the 429 pattern.
    await act(async () => {
      api.setSession(JSON.parse(JSON.stringify(session)));
      await Promise.resolve();
    });

    expect(vi.mocked(api.getDashboard).mock.calls.length).toBe(settled.dashboard);
    expect(vi.mocked(api.listVerifications).mock.calls.length).toBe(settled.verifications);
    expect(vi.mocked(api.listPromotionRequests).mock.calls.length).toBe(settled.promotionRequests);
    expect(vi.mocked(api.listPromotionPaymentRequests).mock.calls.length).toBe(settled.promotionPaymentRequests);
  });

  it('idle tab: unrelated state updates, rerenders, and session re-notifications never refire the five endpoints', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminApp />);
    });
    // Let every initial-mount fetch settle (rail badges + dashboard screen).
    await act(async () => {
      await Promise.resolve();
    });
    const settled = {
      dashboard: vi.mocked(api.getDashboard).mock.calls.length,
      verifications: vi.mocked(api.listVerifications).mock.calls.length,
      promotionRequests: vi.mocked(api.listPromotionRequests).mock.calls.length,
      promotionPaymentRequests: vi.mocked(api.listPromotionPaymentRequests).mock.calls.length,
    };
    expect(settled.dashboard).toBeGreaterThan(0);

    // 1. Two full minutes of idle time.
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });

    // 2. Equivalent session objects re-notified through the subscription
    // (fresh JSON.parse identity, identical content) — as production
    // onSessionChange listeners can deliver.
    await act(async () => {
      api.setSession(JSON.parse(JSON.stringify(session)));
      api.setSession(JSON.parse(JSON.stringify(session)));
      await Promise.resolve();
    });

    // 3. Unrelated shell state update: toggle the mobile nav open and shut.
    // This re-renders the entire AdminApp shell (and the Dashboard with a
    // fresh inline onTriage prop) without touching the session.
    const menuButton = container!.querySelector('.nb-menu-btn') as HTMLButtonElement;
    expect(menuButton).toBeTruthy();
    await act(async () => {
      menuButton.click();
      await Promise.resolve();
    });
    await act(async () => {
      menuButton.click();
      await Promise.resolve();
    });

    // 4. A parent-level rerender of the whole app element.
    await act(async () => {
      root!.render(<AdminApp />);
      await Promise.resolve();
    });

    // After initial load, an idle tab must NEVER refire the five
    // queue-badge/dashboard endpoints for any of the above triggers.
    expect(vi.mocked(api.getDashboard).mock.calls.length).toBe(settled.dashboard);
    expect(vi.mocked(api.listVerifications).mock.calls.length).toBe(settled.verifications);
    expect(vi.mocked(api.listPromotionRequests).mock.calls.length).toBe(settled.promotionRequests);
    expect(vi.mocked(api.listPromotionPaymentRequests).mock.calls.length).toBe(settled.promotionPaymentRequests);
  });

  it('documents the two initial-mount fetch sources: rail badges and dashboard screen', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminApp />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // On a fresh login the five endpoints are fetched TWICE, not once:
    // once by useQueueBadges (rail badges in main.tsx) and once by the
    // Dashboard screen itself (useAsync + useExtraQueues in
    // screen-dashboard.tsx). Both are legitimate initial-mount fetches —
    // this test pins the count so a third source (or a refire) is caught.
    expect(vi.mocked(api.getDashboard).mock.calls.length).toBe(2);
    // listVerifications is called with SUBMITTED and UNDER_REVIEW by each
    // source: 2 calls per source = 4 total.
    expect(vi.mocked(api.listVerifications).mock.calls.length).toBe(4);
    expect(vi.mocked(api.listPromotionRequests).mock.calls.length).toBe(2);
    expect(vi.mocked(api.listPromotionPaymentRequests).mock.calls.length).toBe(2);
  });
});
