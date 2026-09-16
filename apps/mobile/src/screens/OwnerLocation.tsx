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

/**
 * Business location management (Phase 11). The owner sets the business's real
 * coordinates (and reviews address/locality/city, which stay on the profile
 * form they already manage). Nothing is invented: an unset location shows as
 * "not configured", and clearing removes the business from distance-based
 * nearby results. Save/clear hit the dedicated, ownership-checked endpoints.
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

  // Hydrate the inputs once per loaded business; further edits stay local.
  useEffect(() => {
    if (location.data && hydratedFor !== props.businessId) {
      setLat(location.data.latitude === null ? '' : String(location.data.latitude));
      setLng(location.data.longitude === null ? '' : String(location.data.longitude));
      setHydratedFor(props.businessId);
    }
  }, [location.data, props.businessId, hydratedFor]);

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
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the location.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="card">
      <h2>{configured ? 'Location settings' : 'Set your location'}</h2>
      {configured ? (
        <p className="location-configured-note" role="status">
          <PinIcon size={16} /> Your location is set — nearby customers see your real distance.
        </p>
      ) : (
        <p className="hint">
          Add your exact coordinates so customers can see how far you are and find you with directions. You can get these
          from any free map app by long-pressing your business's spot. Until then, customers still find you through
          search and category browsing — NearbyOrders never guesses your location.
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

      <Field label="Latitude" hint={`Decimal degrees, ${LAT_MIN} to ${LAT_MAX}`}>
        <input
          inputMode="decimal"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="e.g. 31.5204"
          aria-label="Latitude"
        />
      </Field>
      <Field label="Longitude" hint={`Decimal degrees, ${LNG_MIN} to ${LNG_MAX}`}>
        <input
          inputMode="decimal"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
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
