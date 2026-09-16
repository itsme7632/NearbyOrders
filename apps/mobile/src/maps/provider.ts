/**
 * Phase 12 map provider abstraction.
 *
 * NearbyOrders must not couple to one map vendor: the app talks to a small
 * provider interface, and concrete vendors (Leaflet/OpenStreetMap today,
 * Google Maps later if ever needed) implement it. Concepts are separated:
 *
 *   - map rendering + markers        (MapProvider)
 *   - geocoding / address search     (geocode)
 *   - reverse geocoding              (reverseGeocode)
 *
 * A provider module exports `createDefaultMapProvider()`. The default
 * implementation (Leaflet + OpenStreetMap tiles) needs no API key; a Google
 * provider can slot in behind the same interface without touching screens.
 */

export type LatLng = { lat: number; lng: number };

export type MapMarkerData = {
  id: string;
  position: LatLng;
  title: string;
};

export type MapTheme = {
  /** Marker color for regular businesses (brand terracotta). */
  marker: string;
  /** Marker color for the selected business. */
  markerSelected: string;
  /** Marker color for the owner's own business pin. */
  markerOwn: string;
};

export const DEFAULT_MAP_THEME: MapTheme = {
  marker: '#c2410c',
  markerSelected: '#0f766e',
  markerOwn: '#9a3412',
};

export type GeocodeResult = {
  position: LatLng;
  /** Display label for the result (formatted address / place name). */
  label: string;
};

/** What screens need from a rendered map. Nothing vendor-specific leaks. */
export interface MapProvider {
  /** Attaches the map to a container element. */
  mount(container: HTMLElement, options: { center: LatLng; zoom: number; theme?: MapTheme }): Promise<void>;
  unmount(): void;

  /** Replaces all business markers. Ids are stable across updates. */
  setMarkers(markers: MapMarkerData[], selectedId?: string | null): void;
  /** Highlights one marker (and deselects the rest). */
  selectMarker(id: string | null): void;
  /** Smoothly centers the map on a position. */
  panTo(position: LatLng, zoom?: number): void;
  /** Reads the current map center (for "search this area"). */
  getCenter(): LatLng | null;
  /** Invoked after pan/zoom settles (idle), with the new center. */
  onMapIdle(callback: (center: LatLng) => void): void;
  /** Invoked when the user taps a business marker. */
  onMarkerClick(callback: (id: string) => void): void;
  /** Invoked when the user taps/drag-drrops the map surface (not a marker). */
  onMapClick(callback: (position: LatLng) => void): void;

  /** Moves a single draggable marker (owner pin). */
  setDraggableMarker(position: LatLng | null): void;
  /** Reads the current owner pin position, if any. */
  getDraggableMarker(): LatLng | null;
  /** Invoked when the owner pin is dragged to a new position. */
  onDraggableMarkerMove(callback: (position: LatLng) => void): void;
}

/** Geocoding slice: address search and reverse lookup. */
export interface GeocodingProvider {
  geocode(query: string): Promise<GeocodeResult[]>;
  reverseGeocode(position: LatLng): Promise<GeocodeResult | null>;
}

/** Vendor-neutral error so screens can show honest messages. */
export class MapProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapProviderError';
  }
}

/**
 * The active provider factory. Kept behind a dynamic-import seam so tests can
 * mock map vendors wholesale and the vendor bundle stays out of screens.
 */
export type MapProviderFactory = () => Promise<{ map: MapProvider; geocoding: GeocodingProvider }>;

export const createDefaultMapProvider: MapProviderFactory = async () => {
  const mod = (await import('./leaflet.js')) as {
    createLeafletProvider: () => { map: MapProvider; geocoding: GeocodingProvider };
  };
  return mod.createLeafletProvider();
};
