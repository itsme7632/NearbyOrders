import { useEffect, useState } from 'react';
import type { Business } from '../api.js';
import { MapCanvas } from '../maps/MapCanvas.js';
import { useMapProvider, type MapHandle } from '../maps/useMapProvider.js';
import type { LatLng } from '../maps/provider.js';
import { hasCoordinates, formatDistanceKm } from '../location.js';
import { RatingChip } from '../components/ui.js';
import { ExploreIcon } from '../components/icons.js';

/**
 * Explore map view (Phase 12). Renders the discovery result set as business
 * markers over OpenStreetMap. The result set always comes from the server —
 * the map never computes distance or membership; it renders what Explore
 * fetched. Businesses without configured coordinates get no marker (never a
 * fabricated point).
 *
 * "Search this area" appears once the map has been panned/zoomed away from the
 * center the current results were fetched around; it re-queries the nearby API
 * at the visible map center.
 */
export function ExploreMapView(props: {
  handle: MapHandle;
  results: Business[];
  /** Center the current result set was fetched around (customer location or last search). */
  searchCenter: LatLng | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenBusiness: (id: string) => void;
  onSearchArea: (center: LatLng) => void;
}) {
  const { provider, ready } = props.handle;
  const [moved, setMoved] = useState(false);

  // Push markers into the provider whenever the result set or selection changes.
  useEffect(() => {
    if (!provider || !ready) return;
    provider.setMarkers(
      props.results
        .filter((b) => hasCoordinates(b))
        .map((b) => ({ id: b.id, position: { lat: Number(b.latitude), lng: Number(b.longitude) }, title: b.name })),
      props.selectedId,
    );
  }, [provider, ready, props.results, props.selectedId]);

  // Subscribe to idle + marker taps once the provider exists.
  useEffect(() => {
    if (!provider || !ready) return;
    const offIdle = props.handle.onMapIdle((center) => {
      const sc = props.searchCenter;
      // "Moved enough" = more than ~1 km from the search center.
      const movedFar =
        !sc ||
        Math.abs(center.lat - sc.lat) > 0.01 ||
        Math.abs(center.lng - sc.lng) > 0.011;
      setMoved(movedFar);
    });
    const offMarker = props.handle.onMarkerClick((id) => props.onSelect(id));
    const offClick = props.handle.onMapClick(() => props.onSelect(null));
    return () => {
      offIdle();
      offMarker();
      offClick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, ready]);

  // Pan to the selected business's marker (list → map focus).
  useEffect(() => {
    if (!provider || !ready || !props.selectedId) return;
    const b = props.results.find((x) => x.id === props.selectedId);
    if (b && hasCoordinates(b)) provider.panTo({ lat: Number(b.latitude), lng: Number(b.longitude) });
  }, [provider, ready, props.selectedId, props.results]);

  const selected = props.results.find((b) => b.id === props.selectedId) ?? null;
  const selectable = props.results.filter((b) => hasCoordinates(b));

  return (
    <div className="explore-map-wrap" style={{ position: 'relative' }}>
      <MapCanvas handle={props.handle} height={420} ariaLabel="Map of nearby businesses" />

      {moved ? (
        <button
          type="button"
          className="btn btn-primary map-search-area"
          onClick={() => {
            const center = provider?.getCenter();
            if (center) props.onSearchArea(center);
          }}
        >
          Search this area
        </button>
      ) : null}

      {selected ? (
        <BusinessMapPreview
          business={selected}
          onClose={() => props.onSelect(null)}
          onOpen={() => props.onOpenBusiness(selected.id)}
        />
      ) : null}

      {!ready ? (
        <div className="map-loading" role="status" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 16 }}>
          <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ExploreIcon size={18} /> Loading map…
          </p>
        </div>
      ) : selectable.length === 0 && props.results.length > 0 ? (
        <div
          className="map-empty-note"
          style={{ position: 'absolute', left: 12, right: 12, bottom: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 14px' }}
        >
          <p className="hint" style={{ margin: 0 }}>
            Businesses in this list haven&apos;t set map locations yet. Browse the list view instead.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Compact bottom-sheet-style preview for a selected marker. */
function BusinessMapPreview(props: { business: Business; onClose: () => void; onOpen: () => void }) {
  const b = props.business;
  const distance = b.distanceKm !== undefined && b.distanceKm !== null ? formatDistanceKm(b.distanceKm) : null;
  return (
    <div
      className="map-preview-card"
      role="dialog"
      aria-label={`${b.name} preview`}
    >
      <span className="map-preview-initial" aria-hidden>
        {b.name[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="map-preview-main">
        <span className="map-preview-name">{b.name}</span>
        <span className="map-preview-meta">
          <RatingChip average={b.averageRating} count={b.reviewCount ?? undefined} />
          {b.categories[0] ? <span className="pop-card-cat">{b.categories[0].name}</span> : null}
          {distance ? <span className="biz-distance">{distance}</span> : null}
        </span>
      </span>
      <span className="map-preview-actions">
        <button type="button" className="btn btn-primary sm" onClick={props.onOpen}>
          View
        </button>
        <button type="button" className="btn btn-ghost sm" onClick={props.onClose}>
          Close
        </button>
      </span>
    </div>
  );
}
