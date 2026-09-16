import { useEffect, useState } from 'react';
import {
  getBusinessLocation,
  updateBusinessLocation,
  getMyBusinesses,
  type BusinessLocation,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Field, Loading } from '../components/ui.js';
import { PinIcon } from '../components/icons.js';
import { useMapProvider } from '../maps/useMapProvider.js';
import { MapCanvas } from '../maps/MapCanvas.js';
import type { GeocodeResult, LatLng } from '../maps/provider.js';

/**
 * Business location management (Phase 12). The owner places a draggable pin
 * on a real map (or searches for their address), sees exactly what customers
 * will see, and saves through the dedicated, ownership-checked endpoints.
 * Nothing is invented: an unset location shows as "not configured", and
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

export function OwnerLocation(props: { businessId: string }) {
  const location = useAsyncData<BusinessLocation>(() => getBusinessLocation(props.businessId), [props.businessId]);
  const businesses = useAsyncData(() => getMyBusinesses(), []);

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Address search state (Phase 12): results, busy flag, and the label of the
  // chosen place so the owner can confirm what they picked.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  // True once the owner edits fields/pin/search this session; the initial
  // camera only auto-pans while the form is untouched.
  const [dirty, setDirty] = useState(false);

  const { handle: mapHandle } = useMapProvider();
  const map = mapHandle.provider;
  const mapReady = mapHandle.ready;

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

  // Draggable pin → coordinate fields.
  useEffect(() => {
    if (!map || !mapReady) return;
    return mapHandle.onDraggableMarkerMove((p: LatLng) => {
      setLat(p.lat.toFixed(6));
      setLng(p.lng.toFixed(6));
      setDirty(true);
      setPickedLabel(null);
      setSaved(null);
      setError(null);
    });
  }, [map, mapReady, mapHandle]);

  const runAddressSearch = async () => {
    setSearchError(null);
    setSearching(true);
    try {
      const results = await mapHandle.geocoding.geocode(searchQuery);
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
    setLat(r.position.lat.toFixed(6));
    setLng(r.position.lng.toFixed(6));
    setDirty(true);
    setPickedLabel(r.label);
    setSearchResults([]);
    setSearchQuery('');
    setSaved(null);
    setError(null);
    map?.setDraggableMarker(r.position);
    map?.panTo(r.position, 16);
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
      setPickedLabel(null);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the location.');
    } finally {
      setClearing(false);
    }
  };

  const hasPin = lat.trim() !== '' && lng.trim() !== '';

  return (
    <section className="card">
      <h2>{configured ? 'Location settings' : 'Set your location'}</h2>
      {configured ? (
        <p className="location-configured-note" role="status">
          <PinIcon size={16} /> Your location is set — nearby customers see your real distance.
        </p>
      ) : (
        <p className="hint">
          Drop a pin on the map or search for your address so customers can see how far you are and find you with
          directions. Until then, customers still find you through search and category browsing — NearbyOrders never
          guesses your location.
        </p>
      )}
      {business ? (
        <p className="hint">
          Address on your profile: {business.address}, {[business.locality, business.city].filter(Boolean).join(', ')}
        </p>
      ) : null}
      {saved ? (
        <p className="save-ok" role="status">
          {saved}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}

      {/* Map picker: the pin is the source of truth for the fields. */}
      <div style={{ marginTop: 10 }}>
        <MapCanvas handle={mapHandle} height={280} ariaLabel="Map pin picker for your business location" />
        <p className="hint" style={{ marginTop: 6 }}>
          Drag the pin to your exact entrance. {hasPin ? 'Your pin is placed — review it below.' : 'Search or tap Save after placing.'}
        </p>
      </div>

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
      {pickedLabel ? (
        <p className="hint" role="status" style={{ marginTop: 6 }}>
          Pinned: {pickedLabel}
        </p>
      ) : null}

      <Field label="Latitude" hint={`Decimal degrees, ${LAT_MIN} to ${LAT_MAX}`}>
        <input
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

      <div className="btn-row">
        <Button onClick={save} disabled={saving || clearing}>
          {saving ? 'Saving…' : 'Save location'}
        </Button>
        {configured ? (
          <Button variant="ghost" onClick={clear} disabled={saving || clearing}>
            {clearing ? 'Clearing…' : 'Clear location'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
