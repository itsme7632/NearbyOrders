import type { Business } from '../api.js';
import { MapCanvas } from '../maps/MapCanvas.js';
import { useMapProvider } from '../maps/useMapProvider.js';
import { useEffect } from 'react';

/**
 * Business Detail map context (Phase 12). Shown on the Overview tab only when
 * the business has real configured coordinates — a single marker at the
 * owner-set location. The card deliberately shows no distance or Directions
 * link of its own: the page header already carries both, and duplicating them
 * here would just add noise (and two competing actions).
 */
export function BusinessMapContext(props: { business: Business; placeLabel: string }) {
  const b = props.business;
  const { handle } = useMapProvider();
  const map = handle.provider;

  useEffect(() => {
    if (!map || !handle.ready) return;
    const position = { lat: Number(b.latitude), lng: Number(b.longitude) };
    map.setDraggableMarker(null); // this marker is display-only
    map.setMarkers([{ id: b.id, position, title: b.name }]);
    map.panTo(position, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, handle.ready, b.id, b.latitude, b.longitude]);

  return (
    <section className="card" aria-label="Location">
      <h2>Location</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {b.address}
        {props.placeLabel ? `, ${props.placeLabel}` : ''}
      </p>
      <MapCanvas handle={handle} height={220} ariaLabel={`Map showing ${b.name}`} />
    </section>
  );
}
