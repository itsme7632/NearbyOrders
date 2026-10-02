// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ForegroundPushBanner, enqueueForegroundPush } from './ForegroundPushBanner.js';
import { PushPermissionCard } from './PushPermissionCard.js';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ForegroundPushBanner', () => {
  it('shows the queued push with title and body', () => {
    render(<ForegroundPushBanner onOpen={() => undefined} />);
    act(() => {
      enqueueForegroundPush({ title: 'Order accepted', body: 'Your order is being prepared.', deepLink: '/order/1' });
    });
    expect(screen.getByText('Order accepted')).toBeTruthy();
    expect(screen.getByText('Your order is being prepared.')).toBeTruthy();
  });

  it('tapping the banner opens the deep link and dismisses it', () => {
    const onOpen = vi.fn();
    render(<ForegroundPushBanner onOpen={onOpen} />);
    act(() => {
      enqueueForegroundPush({ title: 'Order ready', body: 'Ready for pickup.', deepLink: '/order/2' });
    });
    fireEvent.click(screen.getByRole('button', { name: /Open: Order ready/ }));
    expect(onOpen).toHaveBeenCalledWith('/order/2');
    expect(screen.queryByText('Order ready')).toBeNull();
  });

  it('the dismiss button hides the banner without navigating', () => {
    const onOpen = vi.fn();
    render(<ForegroundPushBanner onOpen={onOpen} />);
    act(() => {
      enqueueForegroundPush({ title: 'Ping', body: 'Pong.', deepLink: '/order/3' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText('Ping')).toBeNull();
  });

  it('auto-dismisses after a few seconds so it never blocks the workflow', () => {
    render(<ForegroundPushBanner onOpen={() => undefined} />);
    act(() => {
      enqueueForegroundPush({ title: 'Ephemeral', body: 'Gone soon.' });
    });
    expect(screen.getByText('Ephemeral')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.queryByText('Ephemeral')).toBeNull();
  });

  it('queues extras and shows them one at a time', () => {
    render(<ForegroundPushBanner onOpen={() => undefined} />);
    act(() => {
      enqueueForegroundPush({ title: 'First', body: 'one' });
      enqueueForegroundPush({ title: 'Second', body: 'two' });
    });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByText('Second')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('de-dupes rapid repeats of the same alert', () => {
    render(<ForegroundPushBanner onOpen={() => undefined} />);
    act(() => {
      enqueueForegroundPush({ title: 'Dup', body: 'same' });
      enqueueForegroundPush({ title: 'Dup', body: 'same' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    // Only one copy was ever queued: dismissing reveals nothing.
    expect(screen.queryByText('Dup')).toBeNull();
  });
});

describe('PushPermissionCard', () => {
  it('explains the value and offers enable / not-now when permission is prompt', () => {
    const onEnable = vi.fn().mockResolvedValue(true);
    render(<PushPermissionCard permission="prompt" onEnable={onEnable} />);
    expect(screen.getByText('Get instant order updates')).toBeTruthy();
    expect(screen.getByText(/the moment your order is accepted/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('hides entirely once granted (nothing left to explain)', () => {
    render(<PushPermissionCard permission="granted" onEnable={vi.fn()} />);
    expect(screen.queryByText('Get instant order updates')).toBeNull();
  });

  it('hides on the web build where push is unavailable', () => {
    render(<PushPermissionCard permission="unavailable" onEnable={vi.fn()} />);
    expect(screen.queryByText('Get instant order updates')).toBeNull();
  });

  it('"Not now" dismisses and stays dismissed (no harassment)', () => {
    const { unmount } = render(<PushPermissionCard permission="prompt" onEnable={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Get instant order updates')).toBeNull();
    expect(window.localStorage.getItem('no_push_permission_dismissed')).toBe('1');
    unmount();
    // A later visit still respects the dismissal.
    render(<PushPermissionCard permission="prompt" onEnable={vi.fn()} />);
    expect(screen.queryByText('Get instant order updates')).toBeNull();
  });

  it('a denied permission shows the graceful settings guidance, not another prompt', () => {
    render(<PushPermissionCard permission="denied" onEnable={vi.fn()} />);
    expect(screen.queryByText(/turned off/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).toBeNull();
  });

  it('a failed enable (user denied at the OS prompt) degrades to the guidance', async () => {
    vi.useRealTimers();
    render(<PushPermissionCard permission="prompt" onEnable={vi.fn().mockResolvedValue(false)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    await screen.findByText(/turned off/i);
    vi.useFakeTimers();
  });
});
