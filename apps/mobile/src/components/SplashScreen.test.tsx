import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';

describe('SplashScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders the final Embrace construction during the 900ms splash window', () => {
    render(<SplashScreen />);

    expect(screen.getByRole('presentation')).toBeInTheDocument();
    expect(document.querySelector('.app-splash-ring')).toBeTruthy();
    expect(document.querySelector('.app-splash-n--left')).toBeTruthy();
    expect(document.querySelector('.app-splash-n--right')).toBeTruthy();
    expect(document.querySelector('.app-splash-n--diagonal')).toBeTruthy();
  });

  it('removes the splash after exactly 900ms', () => {
    render(<SplashScreen />);

    act(() => {
      vi.advanceTimersByTime(899);
    });
    expect(screen.getByRole('presentation')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('presentation')).toBeNull();
  });
});
