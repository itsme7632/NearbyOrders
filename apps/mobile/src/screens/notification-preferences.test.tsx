// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../api.js';
import { ToastProvider } from '../components/primitives.js';
import { NotificationPreferencesScreen } from './NotificationPreferences.js';

afterEach(cleanup);

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

const allOn = (): api.NotificationPreferences => ({
  bookings: true,
  orders: true,
  payments: true,
  reviews: true,
  businessActivity: true,
  account: true,
});

const renderPrefs = () =>
  render(
    <ToastProvider>
      <NotificationPreferencesScreen onBack={() => {}} />
    </ToastProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getNotificationPreferences).mockResolvedValue(allOn());
});

describe('NotificationPreferencesScreen', () => {
  it('renders one toggle per category, all on by default', async () => {
    renderPrefs();
    for (const name of ['Orders', 'Bookings', 'Payments', 'Reviews', 'Business activity', 'Account']) {
      const toggle = await screen.findByRole('switch', { name: new RegExp(`^${name} push notifications$`, 'i') });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('says plainly that the toggles control push only', async () => {
    renderPrefs();
    await screen.findByRole('switch', { name: /orders push notifications/i });
    expect(screen.getByText(/push alerts only/i)).toBeTruthy();
    expect(screen.getByText(/still appears in notifications/i)).toBeTruthy();
  });

  it('toggling a category saves immediately and optimistically', async () => {
    vi.mocked(api.updateNotificationPreferences).mockImplementation(async (p) => p);
    renderPrefs();
    const toggle = await screen.findByRole('switch', { name: /orders push notifications/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await waitFor(() =>
      expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ ...allOn(), orders: false }),
    );
  });

  it('reverts the toggle and shows an error when saving fails', async () => {
    vi.mocked(api.updateNotificationPreferences).mockRejectedValue(new Error('offline'));
    renderPrefs();
    const toggle = await screen.findByRole('switch', { name: /orders push notifications/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText(/could not update “orders”/i)).toBeTruthy();
  });
});
