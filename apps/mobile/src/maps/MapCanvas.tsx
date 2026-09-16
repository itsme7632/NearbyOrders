import type { MapHandle } from './useMapProvider.js';

/**
 * Map canvas: owns the DOM element the provider mounts into. Screens place
 * this inside their layout; the provider is reached through the MapHandle.
 * The canvas itself is dumb — all behavior lives in the screen.
 */
export function MapCanvas(props: { handle: MapHandle; height?: number; ariaLabel?: string }) {
  const { handle, height = 320, ariaLabel } = props;

  return (
    <div
      data-map-canvas
      ref={handle.canvasRef}
      role="application"
      aria-label={ariaLabel ?? 'Map'}
      style={{ height, width: '100%', position: 'relative', overflow: 'hidden', borderRadius: 16, background: 'var(--border)' }}
    />
  );
}
