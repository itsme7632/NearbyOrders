import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.js';
import { PinIcon } from './icons.js';
import { useMapProvider } from '../maps/useMapProvider.js';
import { MapCanvas } from '../maps/MapCanvas.js';
import type { GeocodeResult, LatLng } from '../maps/provider.js';

/**
 * PinDropPicker (Phase 3C): a small, self-contained map pin picker used by
 * the customer address form (and reusable anywhere a location needs a pin).
 *
 * The pin is the source of truth: dragging it, tapping the map, or picking
 * an address-search result all report validated coordinates through
 * onChange. Coordinates are always optional — a null value means "no pin"
 * and is never invented. The initial camera centers an existing pin when one
 * is set; otherwise it shows an honest country overview.
 */

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

export type PinCoords = { latitude: number; longitude: number } | null;

const isValid = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= LAT_MIN &&
  lat <= LAT_MAX &&
  lng >= LNG_MIN &&
  lng <= LNG_MAX;

export function PinDropPicker(props: { value: PinCoords; onChange: (v: PinCoords) => void }) {
  const { handle } = useMapProvider();
  const map = handle.provider;
  const mapReady = handle.ready;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);

  const { value, onChange } = props;

  // The parent passes an inline onChange (new identity every render). Keep
  // the latest in a ref so the map subscription effect below doesn't tear
  // down and re-subscribe on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // The pin mirrors the value; invalid/empty input removes the pin instead
  // of guessing a position.
  useEffect(() => {
    if (!map || !mapReady) return;
    if (value && isValid(value.latitude, value.longitude)) {
      map.setDraggableMarker({ lat: value.latitude, lng: value.longitude });
    } else {
      map.setDraggableMarker(null);
    }
  }, [map, mapReady, value]);

  // Initial camera: existing pin, else an honest country overview.
  useEffect(() => {
    if (!map || !mapReady) return;
    if (value && isValid(value.latitude, value.longitude)) {
      map.panTo({ lat: value.latitude, lng: value.longitude }, 15);
    } else {
      map.panTo({ lat: 30.3753, lng: 69.3451 }, 5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapReady]);

  // Drag and tap-to-place both report the pin position.
  useEffect(() => {
    if (!map || !mapReady) return;
    const report = (p: LatLng) => {
      onChangeRef.current({ latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lng.toFixed(6)) });
      setPickedLabel(null);
    };
    const offDrag = handle.onDraggableMarkerMove(report);
    const offTap = handle.onMapClick(report);
    return () => {
      offDrag();
      offTap();
    };
  }, [map, mapReady, handle]);

  const runAddressSearch = async () => {
    setSearchError(null);
    setSearching(true);
    try {
      const results = await handle.geocoding.geocode(searchQuery);
      if (!results.length) {
        setSearchResults([]);
        setSearchError('No places matched that search. Try adding the city.');
      } else {
        setSearchResults(results);
      }
    } catch (e) {
      setSearchResults([]);
      setSearchError(e instanceof Error ? e.message : 'Address search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r: GeocodeResult) => {
    onChange({ latitude: Number(r.position.lat.toFixed(6)), longitude: Number(r.position.lng.toFixed(6)) });
    setPickedLabel(r.label);
    setSearchResults([]);
    setSearchQuery('');
    map?.panTo(r.position, 16);
  };

  return (
    <div className="pin-picker">
      <MapCanvas handle={handle} height={240} ariaLabel="Map to place a pin for this address" />
      <p className="hint" style={{ marginTop: 6 }}>
        {value
          ? 'Pin placed. Drag it or tap the map to adjust. Couriers use it to find you.'
          : 'Tap the map to drop a pin at your entrance, or search below. The pin is optional.'}
      </p>

      <form
        role="search"
        aria-label="Address search for the pin"
        onSubmit={(e) => {
          e.preventDefault();
          void runAddressSearch();
        }}
        style={{ display: 'flex', gap: 8, marginTop: 6 }}
      >
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search your street or area…"
          aria-label="Search address to place the pin"
          style={{ flex: 1 }}
        />
        <Button type="submit" sm disabled={searching || searchQuery.trim() === ''}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {searchError ? (
        <p className="addr-error" role="alert" style={{ marginTop: 6 }}>
          {searchError}
        </p>
      ) : null}
      {searchResults.length ? (
        <ul className="geocode-results" aria-label="Address results" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {searchResults.map((r) => (
            <li key={`${r.position.lat},${r.position.lng}`}>
              <button type="button" className="btn btn-ghost sm" style={{ textAlign: 'left', width: '100%' }} onClick={() => pickResult(r)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pickedLabel ? (
        <p className="hint" role="status" style={{ marginTop: 6 }}>
          <PinIcon size={14} /> Pinned: {pickedLabel}
        </p>
      ) : null}
      {value ? (
        <div style={{ marginTop: 8 }}>
          <Button
            type="button"
            variant="ghost"
            sm
            onClick={() => {
              onChange(null);
              setPickedLabel(null);
            }}
          >
            Remove pin
          </Button>
        </div>
      ) : null}
    </div>
  );
}
