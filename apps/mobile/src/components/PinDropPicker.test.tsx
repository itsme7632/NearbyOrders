// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PinDropPicker } from './PinDropPicker.js';

afterEach(cleanup);

const panTo = vi.fn();
const setDraggableMarker = vi.fn();
const geocode = vi.fn();
vi.mock('../maps/useMapProvider.js', () => ({
  useMapProvider: () => ({
    handle: {
      provider: { panTo, setDraggableMarker },
      geocoding: { geocode },
      ready: true,
      canvasRef: () => {},
      onMapIdle: () => () => {},
      onMarkerClick: () => () => {},
      onMapClick: () => () => {},
      onDraggableMarkerMove: () => () => {},
    },
  }),
}));
vi.mock('../maps/MapCanvas.js', () => ({ MapCanvas: () => <div data-testid="map-canvas" /> }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PinDropPicker', () => {
  it('shows the pin as optional when no value is set', () => {
    const onChange = vi.fn();
    render(<PinDropPicker value={null} onChange={onChange} />);
    expect(screen.getByTestId('map-canvas')).toBeTruthy();
    expect(screen.getByText(/the pin is optional/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove pin/i })).toBeNull();
  });

  it('places a draggable marker for an existing pin and offers removal', () => {
    const onChange = vi.fn();
    render(<PinDropPicker value={{ latitude: 31.5, longitude: 74.3 }} onChange={onChange} />);
    expect(setDraggableMarker).toHaveBeenCalledWith({ lat: 31.5, lng: 74.3 });
    expect(screen.getByText(/drag it or tap the map/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /remove pin/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('address search results move the pin and pan the map', async () => {
    const onChange = vi.fn();
    geocode.mockResolvedValue([
      { label: 'Main Boulevard, Lahore', position: { lat: 31.52, lng: 74.35 } },
    ]);
    render(<PinDropPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/search address to place the pin/i), {
      target: { value: 'Main Boulevard' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByText('Main Boulevard, Lahore')).toBeTruthy();

    fireEvent.click(screen.getByText('Main Boulevard, Lahore'));
    expect(onChange).toHaveBeenCalledWith({ latitude: 31.52, longitude: 74.35 });
    expect(panTo).toHaveBeenCalledWith({ lat: 31.52, lng: 74.35 }, 16);
    expect(screen.getByText(/pinned: main boulevard, lahore/i)).toBeTruthy();
  });

  it('shows an honest error when the address search finds nothing', async () => {
    geocode.mockResolvedValue([]);
    render(<PinDropPicker value={null} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/search address to place the pin/i), {
      target: { value: 'zzz nowhere' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByText(/no places matched/i)).toBeTruthy();
  });
});
