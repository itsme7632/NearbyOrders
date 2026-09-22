import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useRoute } from './hooks.js';

afterEach(cleanup);

/**
 * Back-navigation contract: with in-app history behind the current screen,
 * back() walks it (never exits, never jumps). On a cold-launched deep link
 * with no history entries behind it, back() must land on the home route
 * instead of closing the app.
 */
describe('useRoute back()', () => {
  it('walks history when entries exist', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useRoute());
      // jsdom starts with history.length 1; simulate an in-app navigation.
      Object.defineProperty(window.history, 'length', { value: 3, configurable: true });
      act(() => {
        result.current[2]();
      });
      expect(backSpy).toHaveBeenCalledTimes(1);
    } finally {
      backSpy.mockRestore();
    }
  });

  it('falls back to the home route when there is no in-app history (cold deep link)', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    try {
      Object.defineProperty(window.history, 'length', { value: 1, configurable: true });
      window.location.hash = '#/booking/bk-9';
      const { result } = renderHook(() => useRoute());
      act(() => {
        result.current[2]();
      });
      // Never asks the platform to go back (which would exit the app)…
      expect(backSpy).not.toHaveBeenCalled();
      // …and lands on the home route instead.
      expect(window.location.hash).toBe('#/');
    } finally {
      backSpy.mockRestore();
      window.location.hash = '#/';
    }
  });
});
