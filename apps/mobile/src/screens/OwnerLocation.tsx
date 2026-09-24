import { useEffect, useRef, useState } from 'react';
import {
  getBusinessLocation,
  updateBusinessLocation,
  getMyBusinesses,
  type BusinessLocation,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { PinIcon } from '../components/icons.js';
import { requestCustomerLocation, type LocationOutcome } from '../location.js';
import { useMapProvider } from '../maps/useMapProvider.js';
import { MapCanvas } from '../maps/MapCanvas.js';
import type { GeocodeResult, LatLng } from '../maps/provider.js';

/**
 * Business location management: map first, then search / use-my-location,
 * then pin confirmation, then save — the Business Owner reference flow.
 *
 * The map renders for real (Leaflet + OpenStreetMap tiles, draggable pin);
 * nothing is faked. An unset location shows as "not configured", and
 * clearing removes the business from distance-based nearby results.
 */

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

/** Validates a typed coordinate; returns the number or a user-facing message. */
const parseCoordinate = (raw: string, min: number, max: number, name: string): { value: number } | { error: string } => {
  const trimmed = raw.trim();
  if (trimmed === '') return { error: `Enter ${name} (or clear the location below).` };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: `${name} must be a number, e.g. 31.5204.` };
  if (value < min || value > max) return { error: `${name} must be between ${min} and ${max}.` };
  return { value };
};

/** Owner-appropriate copy for a failed "use my location" attempt. */
const locationFailureHint = (outcome: LocationOutcome): string | null => {
  switch (outcome.status) {
    case 'granted':
      return null;
    case 'denied':
      return 'Location permission was denied. You can still place the pin manually.';
    case 'permanently-denied':
      return 'Location is turned off for NearbyOrders. Enable it in your device settings to use your current location, or place the pin manually.';
    case 'unavailable':
      return 'Your current location is not available right now. Place the pin manually.';
    case 'error':
      return outcome.message;
  }
};

export function OwnerLocation(props: { businessId: string }) {
  const location = useAsyncData<BusinessLocation>(() => getBusinessLocation(props.businessId), [props.businessId]);
  const businesses = useAsyncData(() => getMyBusinesses(), []);

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Address search state: results, busy flag, and the label of the chosen
  // place so the owner can confirm what they picked.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Human-readable label for the current pin: the picked search result, or a
  // best-effort reverse-geocoded address. Never blocks saving.
  const [pinLabel, setPinLabel] = useState<string | null>(null);
  // True once the owner edits fields/pin/search this session; the initial
  // camera only auto-pans while the form is untouched.
  const [dirty, setDirty] = useState(false);

  const { handle: mapHandle } = useMapProvider();
  const map = mapHandle.provider;
  const mapReady = mapHandle.ready;
  const latRef = useRef<HTMLInputElement | null>(null);

  // Hydrate the inputs once per loaded business; further edits stay local.
  useEffect(() => {
    if (location.data && hydratedFor !== props.businessId) {
      setLat(location.data.latitude === null ? '' : String(location.data.latitude));
      setLng(location.data.longitude === null ? '' : String(location.data.longitude));
      setHydratedFor(props.businessId);
    }
  }, [location.data, props.businessId, hydratedFor]);

  // The pin always mirrors the coordinate fields — one source of truth.
  // Invalid/partial input removes the pin instead of guessing a position.
  useEffect(() => {
    if (!map || !mapReady) return;
    const la = Number(lat);
    const ln = Number(lng);
    const valid =
      lat.trim() !== '' &&
      lng.trim() !== '' &&
      Number.isFinite(la) &&
      Number.isFinite(ln) &&
      la >= LAT_MIN &&
      la <= LAT_MAX &&
      ln >= LNG_MIN &&
      ln <= LNG_MAX;
    map.setDraggableMarker(valid ? { lat: la, lng: ln } : null);
  }, [map, mapReady, lat, lng]);

  // Initial camera: the saved location when configured, else an honest
  // country overview (never a fabricated "your area").
  useEffect(() => {
    if (!map || !mapReady) return;
    if (location.data?.isConfigured && location.data.latitude !== null && location.data.longitude !== null) {
      map.panTo({ lat: Number(location.data.latitude), lng: Number(location.data.longitude) }, 15);
    } else if (!dirty) {
      map.panTo({ lat: 30.3753, lng: 69.3451 }, 5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapReady, location.data]);

  // Best-effort reverse-geocoded label for a pin position. Never blocks.
  const describePin = async (p: LatLng) => {
    try {
      const hit = await mapHandle.geocoding.reverseGeocode(p);
      if (hit) setPinLabel(hit.label);
    } catch {
      /* label stays as-is; the coordinates are what get saved */
    }
  };

  // Draggable pin → coordinate fields.
  useEffect(() => {
    if (!map || !mapReady) return;
    return mapHandle.onDraggableMarkerMove((p: LatLng) => {
      setLat(p.lat.toFixed(6));
      setLng(p.lng.toFixed(6));
      setDirty(true);
      setSaved(null);
      setError(null);
      void describePin(p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapReady, mapHandle]);

  // Tap the map → place (or move) the pin there.
  useEffect(() => {
    if (!map || !mapReady) return;
    return mapHandle.onMapClick((p: LatLng) => {
      setLat(p.lat.toFixed(6));
      setLng(p.lng.toFixed(6));
      setDirty(true);
      setPinLabel(null);
      setSaved(null);
      setError(null);
      map.setDraggableMarker(p);
      void describePin(p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapReady, mapHandle]);

  const runAddressSearch = async () => {
    setSearchError(null);
    setSearching(true);
    try {
      const results = await mapHandle.geocoding.geocode(searchQuery);
      if (!results.length) {
        setSearchResults([]);
        setSearchError('No places matched that search. Try adding the city, e.g. "Main Bazaar, Sheikhupura".');
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

  const placePin = (position: LatLng, label: string | null) => {
    setLat(position.lat.toFixed(6));
    setLng(position.lng.toFixed(6));
    setDirty(true);
    setPinLabel(label);
    setSaved(null);
    setError(null);
    map?.setDraggableMarker(position);
    map?.panTo(position, 16);
  };

  const pickResult = (r: GeocodeResult) => {
    placePin(r.position, r.label);
    setSearchResults([]);
    setSearchQuery('');
  };

  const useMyLocation = async () => {
    if (locating) return;
    setLocating(true);
    setError(null);
    try {
      const outcome = await requestCustomerLocation(8000);
      if (outcome.status === 'granted') {
        placePin(outcome.coords, null);
        void describePin(outcome.coords);
      } else {
        setError(locationFailureHint(outcome));
      }
    } finally {
      setLocating(false);
    }
  };

  if (location.loading) return <Loading label="Loading location…" />;
  if (location.error) return <ErrorState message={location.error} onRetry={location.reload} />;
  // Keep the form hidden until hydration has actually filled the inputs, so a
  // value typed before the load completes can never be clobbered by it.
  if (location.data && hydratedFor !== props.businessId) return <Loading label="Loading location…" />;
  const configured = location.data?.isConfigured ?? false;
  const business = businesses.data?.find((b) => b.id === props.businessId);

  const save = async () => {
    if (saving) return;
    const parsedLat = parseCoordinate(lat, LAT_MIN, LAT_MAX, 'latitude');
    if ('error' in parsedLat) {
      setError(parsedLat.error);
      return;
    }
    const parsedLng = parseCoordinate(lng, LNG_MIN, LNG_MAX, 'longitude');
    if ('error' in parsedLng) {
      setError(parsedLng.error);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const next = await updateBusinessLocation(props.businessId, { latitude: parsedLat.value, longitude: parsedLng.value });
      setSaved('Location saved. Customers near you will see accurate distances.');
      setLat(next.latitude === null ? '' : String(next.latitude));
      setLng(next.longitude === null ? '' : String(next.longitude));
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the location.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (clearing) return;
    setClearing(true);
    setError(null);
    setSaved(null);
    try {
      await updateBusinessLocation(props.businessId, { latitude: null, longitude: null });
      setSaved('Location cleared. Your business is hidden from nearby distance results until a location is set.');
      setLat('');
      setLng('');
      setDirty(false);
      setPinLabel(null);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the location.');
    } finally {
      setClearing(false);
    }
  };

  const hasPin = lat.trim() !== '' && lng.trim() !== '';

  return (
    <div aria-label="Business location">
      {configured ? (
        <p className="location-configured-note" role="status">
          <PinIcon size={16} /> Your location is set. Nearby customers see your real distance.
        </p>
      ) : (
        <p className="hint">
          Set your exact business location so customers can find you easily on NearbyOrders. Search your address, use
          your current location, or drag the pin to your entrance.
        </p>
      )}
      {saved ? (
        <p className="save-ok" role="status">
          {saved}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {/* Map first: the pin is the source of truth for the fields below. */}
      <div className="loc-map-wrap" style={{ marginTop: 10 }}>
        <MapCanvas handle={mapHandle} height={300} ariaLabel="Map pin picker for your business location" />
        <button type="button" className="loc-use-btn" onClick={useMyLocation} disabled={locating}>
          <PinIcon size={14} /> {locating ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Drag the pin to your exact entrance. {hasPin ? 'Your pin is placed. Review it below.' : 'Then save your location.'}
      </p>

      {/* Address search (OpenStreetMap/Nominatim via the provider abstraction). */}
      <form
        role="search"
        aria-label="Address search"
        onSubmit={(e) => {
          e.preventDefault();
          void runAddressSearch();
        }}
        style={{ marginTop: 10, display: 'flex', gap: 8 }}
      >
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search your address…"
          aria-label="Search address"
          style={{ flex: 1 }}
        />
        <Button type="submit" sm disabled={searching || searchQuery.trim() === ''}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {searchError ? <ErrorState message={searchError} /> : null}
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

      {/* Pinned location confirmation, mirroring the reference flow. */}
      {hasPin ? (
        <section className="loc-pinned-card" aria-label="Pinned location" style={{ marginTop: 12 }}>
          <div className="loc-pinned-head">
            <span className="loc-pinned-title">
              <PinIcon size={16} /> Pinned location
            </span>
            <button type="button" className="loc-pinned-edit" onClick={() => latRef.current?.focus()}>
              Edit
            </button>
          </div>
          {pinLabel ? <p className="loc-pinned-label">{pinLabel}</p> : null}
          {business ? (
            <p className="hint" style={{ margin: '4px 0 0' }}>
              Profile address: {business.address}, {[business.locality, business.city].filter(Boolean).join(', ')}
            </p>
          ) : null}
          <div className="loc-coords">
            <span>
              <span className="loc-coords-label">Latitude</span>
              <span className="loc-coords-value">{Number(lat).toFixed(4)}</span>
            </span>
            <span>
              <span className="loc-coords-label">Longitude</span>
              <span className="loc-coords-value">{Number(lng).toFixed(4)}</span>
            </span>
          </div>
        </section>
      ) : business ? (
        <p className="hint" style={{ marginTop: 10 }}>
          Address on your profile: {business.address}, {[business.locality, business.city].filter(Boolean).join(', ')}
        </p>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Field label="Latitude" hint={`Decimal degrees, ${LAT_MIN} to ${LAT_MAX}`}>
          <input
            ref={latRef}
            inputMode="decimal"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              setDirty(true);
            }}
            placeholder="e.g. 31.5204"
            aria-label="Latitude"
          />
        </Field>
        <Field label="Longitude" hint={`Decimal degrees, ${LNG_MIN} to ${LNG_MAX}`}>
          <input
            inputMode="decimal"
            value={lng}
            onChange={(e) => {
              setLng(e.target.value);
              setDirty(true);
            }}
            placeholder="e.g. 74.3587"
            aria-label="Longitude"
          />
        </Field>
      </div>

      <div style={{ marginTop: 4 }}>
        {/* The button stays enabled so tapping it with incomplete input shows
            the honest validation guidance ("Enter longitude…") instead of a
            dead control with no explanation. */}
        <Button full onClick={save} disabled={saving || clearing}>
          {saving ? 'Saving…' : 'Save location'}
        </Button>
        {configured ? (
          <div className="btn-row" style={{ marginTop: 8 }}>
            <Button variant="ghost" sm onClick={clear} disabled={saving || clearing}>
              {clearing ? 'Clearing…' : 'Clear location'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
