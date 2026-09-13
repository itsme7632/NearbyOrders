// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { App } from './main.js';
import * as api from './api.js';
import type { Category, Business } from './api.js';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.spyOn(api, 'listCategories').mockResolvedValue([
    { id: 'c1', name: 'Food & Restaurants', slug: 'food-restaurants', isActive: true },
  ] as Category[]);
  vi.spyOn(api, 'listBusinesses').mockResolvedValue([] as Business[]);
  vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
  vi.spyOn(api, 'listNotifications').mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, 'listMyBookings').mockResolvedValue([]);
  vi.spyOn(api, 'listOrders').mockResolvedValue([]);
  vi.spyOn(api, 'getMyBusinesses').mockResolvedValue([]);
});

const customerSession: api.Session = {
  accessToken: 'tok',
  user: { id: 'u1', email: 'ayesha@example.com', role: 'CUSTOMER' },
};

describe('header notification bell', () => {
  it('renders a real bell button with accessible label and navigates to notifications', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
    const { container } = render(<App />);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(bell.className).toBe('bell-btn');
    // A real bell glyph: the svg path is the bell body (AlertIcon has none).
    expect(bell.querySelector('svg path')?.getAttribute('d')).toContain('M18 10a6 6 0 1 0-12 0');
    expect(container.textContent).not.toContain('99+');

    fireEvent.click(bell);
    // The redesigned screen shows both the heading and the empty state.
    await screen.findAllByText(/Mark all read|No notifications|notifications/i);
    expect(window.location.hash).toContain('/notifications');
  });

  it('shows the unread badge when count > 0 and hides it at zero', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
    vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 3 });
    const { container, unmount } = render(<App />);
    const badge = await screen.findByText('3');
    expect(badge.className).toBe('bell-badge');
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
    unmount();
    cleanup();

    vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 0 });
    render(<App />);
    await screen.findByRole('button', { name: 'Notifications' });
    expect(container.querySelector('.bell-badge')).toBeNull();
  });

  it('caps the badge at 99+', async () => {
    vi.spyOn(api, 'getSession').mockReturnValue(customerSession);
    vi.spyOn(api, 'getUnreadCount').mockResolvedValue({ count: 140 });
    render(<App />);
    expect(await screen.findByText('99+')).toBeTruthy();
  });
});
