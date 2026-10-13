// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  getDashboard: vi.fn(),
  listAuditLog: vi.fn(),
  listUsers: vi.fn(),
  suspendUser: vi.fn(),
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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const dashboard = {
  users: 120,
  customers: 100,
  businessOwners: 20,
  businesses: 30,
  activeBusinesses: 25,
  pendingBusinesses: 3,
  suspendedBusinesses: 1,
  bookings: 50,
  pendingBookings: 2,
  orders: 80,
  pendingOrders: 4,
  pendingSubscriptionPayments: 2,
  reviews: 60,
  hiddenReviews: 1,
  pushDevices: { total: 90, active: 70, android: 60, ios: 5, web: 5 },
};

const session = {
  accessToken: 'test-token',
  user: { id: 'a1', email: 'admin@example.com', role: 'ADMIN', firstName: 'A', lastName: 'Dmin' },
};

async function signIn() {
  const api = await import('./api.js');
  api.setSession(session as never);
}

describe('admin control center shell', () => {
  it('renders grouped navigation with every section represented', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.listAuditLog).mockResolvedValue([]);
    await signIn();
    const { AdminApp } = await import('./main.js');
    const c = await renderInto(<AdminApp />);
    await flush();

    for (const group of ['Overview', 'Marketplace', 'Operations', 'Billing', 'Growth', 'System']) {
      expect(c.textContent).toContain(group);
    }
    for (const label of [
      'Dashboard', 'Users', 'Businesses', 'Verification', 'Orders', 'Bookings',
      'Reviews', 'Categories', 'Subscriptions', 'Plans', 'Payment review',
      'Payment methods', 'Promotions', 'Audit log',
    ]) {
      expect(c.querySelector('.nb-nav')!.textContent).toContain(label);
    }
  });

  it('navigates between sections when nav items are clicked', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.listAuditLog).mockResolvedValue([]);
    vi.mocked(api.listUsers).mockResolvedValue([]);
    await signIn();
    const { AdminApp } = await import('./main.js');
    const c = await renderInto(<AdminApp />);
    await flush();

    const ordersBtn = Array.from(c.querySelectorAll('.nb-nav-item')).find((b) =>
      b.textContent?.includes('Orders'),
    )!;
    await act(async () => {
      ordersBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(c.textContent).toContain('Orders');
  });

  it('toggles the mobile navigation drawer', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.listAuditLog).mockResolvedValue([]);
    await signIn();
    const { AdminApp } = await import('./main.js');
    const c = await renderInto(<AdminApp />);
    await flush();

    const shell = c.querySelector('.nb-shell')!;
    expect(shell.classList.contains('nb-nav-open')).toBe(false);
    const menuBtn = c.querySelector('.nb-menu-btn')!;
    await act(async () => {
      menuBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(shell.classList.contains('nb-nav-open')).toBe(true);
  });
});

describe('admin dashboard (redesign)', () => {
  it('renders the needs-attention queue and triages pending businesses', async () => {
    const api = await import('./api.js');
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.listAuditLog).mockResolvedValue([]);
    const { Dashboard } = await import('./screen-dashboard.js');
    const onTriage = vi.fn();
    const c = await renderInto(<Dashboard onTriage={onTriage} />);
    await flush();

    expect(c.textContent).toContain('Needs attention');
    expect(c.textContent).toContain('Pending businesses');
    const row = Array.from(c.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Pending businesses'),
    )!;
    await act(async () => {
      row.click();
    });
    expect(onTriage).toHaveBeenCalledWith('businesses', 'PENDING');
  });
});

describe('admin users (redesign)', () => {
  it('renders the user list and searches through the API', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listUsers).mockResolvedValue([
      {
        id: 'u1', email: 'sam@example.com', firstName: 'Sam', lastName: 'Raza',
        role: 'CUSTOMER', isSuspended: false, createdAt: '2026-09-01T10:00:00.000Z',
        counts: { businesses: 0, orders: 3, bookings: 1, reviews: 2 },
      } as never,
    ]);
    const { Users } = await import('./screen-marketplace.js');
    const c = await renderInto(<Users />);
    await flush();

    expect(c.textContent).toContain('sam@example.com');
    expect(vi.mocked(api.listUsers)).toHaveBeenCalledWith('');
    const search = c.querySelector('input[aria-label="Search users"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeSetter.call(search, 'sam');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(vi.mocked(api.listUsers)).toHaveBeenCalledWith('sam');
  });
});

describe('admin audit log (redesign)', () => {
  it('renders a searchable activity timeline', async () => {
    const api = await import('./api.js');
    vi.mocked(api.listAuditLog).mockResolvedValue([
      {
        id: 'e1', action: 'BUSINESS_APPROVED', entityType: 'Business', entityId: 'b1',
        metadata: { by: 'admin' }, createdAt: '2026-09-20T10:00:00.000Z',
        actor: { id: 'a1', email: 'admin@example.com', role: 'ADMIN' },
      },
    ]);
    const { AuditLog } = await import('./screen-system.js');
    const c = await renderInto(<AuditLog />);
    await flush();

    expect(c.textContent).toContain('Recent admin activity');
    expect(c.textContent).toContain('Business Approved');
    expect(c.textContent).toContain('admin@example.com');
  });
});
