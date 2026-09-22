// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { useMapProvider } from './useMapProvider.js';

afterEach(cleanup);

const mountSpy = vi.fn(async (_el: HTMLElement) => {});
const unmountSpy = vi.fn();

vi.mock('./provider.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./provider.js')>();
  return {
    ...orig,
    createDefaultMapProvider: vi.fn(async () => ({
      map: {
        mount: mountSpy,
        unmount: unmountSpy,
        setView: vi.fn(),
        setMarkers: vi.fn(),
        setDraggableMarker: vi.fn(),
        onMapIdle: () => () => {},
        onMarkerClick: () => () => {},
        onMapClick: () => () => {},
        onDraggableMarkerMove: () => () => {},
      },
      geocoding: { geocode: vi.fn(), reverseGeocode: vi.fn() },
    })),
  };
});

/**
 * Mimics OwnerLocation's real shape: the canvas renders only after an async
 * load (a loader shows first). The regression this guards: a one-shot mount
 * effect keyed on component mount runs while the canvas does not exist yet
 * and the map never mounts — a blank map on Android.
 */
function DelayedCanvas() {
  const { handle } = useMapProvider();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(t);
  }, []);
  return show ? (
    <div ref={handle.canvasRef} data-testid="canvas" />
  ) : (
    <div data-testid="loading">Loading…</div>
  );
}

describe('useMapProvider canvas lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts the map once the canvas appears after an async load', async () => {
    render(<DelayedCanvas />);
    expect(await screen.findByTestId('loading')).toBeTruthy();
    // No canvas yet — nothing may mount.
    expect(mountSpy).not.toHaveBeenCalled();

    const canvas = await screen.findByTestId('canvas');
    await waitFor(() => expect(mountSpy).toHaveBeenCalledTimes(1));
    expect(mountSpy.mock.calls[0][0]).toBe(canvas);
  });

  it('unmounts the map when the component unmounts', async () => {
    const { unmount } = render(<DelayedCanvas />);
    await screen.findByTestId('canvas');
    await waitFor(() => expect(mountSpy).toHaveBeenCalledTimes(1));
    unmount();
    expect(unmountSpy).toHaveBeenCalledTimes(1);
  });
});
