/**
 * Leaflet + OpenStreetMap implementation of the Phase 12 provider interface.
 * Free tile source, no API key, no vendor lock-in. Only this file knows Leaflet.
 */
import 'leaflet/dist/leaflet.css';
import { DEFAULT_MAP_THEME, MapProviderError, type GeocodeResult, type LatLng, type MapMarkerData, type MapProvider, type MapTheme } from './provider.js';

/* Minimal structural types for the Leaflet surface we use — keeps the vendor
   dependency confined to this module without importing types at runtime. */
type LMap = {
  setView(center: [number, number], zoom?: number): unknown;
  getCenter(): { lat: number; lng: number };
  on(event: string, handler: (e: { latlng?: { lat: number; lng: number } }) => void): unknown;
  remove(): void;
  removeLayer(layer: unknown): unknown;
  panTo(center: [number, number], opts?: { animate?: boolean }): unknown;
};
type LMarker = {
  addTo(map: LMap): LMarker;
  on(event: string, handler: (e: unknown) => void): LMarker;
  setLatLng(pos: { lat: number; lng: number }): LMarker;
  getLatLng(): { lat: number; lng: number };
  setIcon(icon: unknown): LMarker;
  remove(): void;
};
type L = {
  map(el: HTMLElement, opts: Record<string, unknown>): LMap;
  marker(pos: [number, number], opts?: Record<string, unknown>): LMarker;
  divIcon(opts: Record<string, unknown>): unknown;
  tileLayer(url: string, opts: Record<string, unknown>): { addTo(map: LMap): unknown };
};

let leafletPromise: Promise<L> | null = null;
const loadLeaflet = async (): Promise<L> => {
  if (!leafletPromise) {
    leafletPromise = (async () => {
      const mod = (await import('leaflet')) as unknown as { default?: L } & L;
      // Leaflet's CSS arrives via the static `import 'leaflet/dist/leaflet.css'`
      // above, so the bundler includes it with this chunk — no runtime <link>
      // injection (which resolved against import.meta.url and 404'd in builds).
      return mod.default ?? (mod as unknown as L);
    })();
  }
  return leafletPromise;
};

const MARKER_PIN = (color: string, selected: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">${
    selected ? '<circle cx="15" cy="15" r="12" fill="none" stroke="' + color + '" stroke-width="2.5"/>' : ''
  }<path d="M15 39C15 39 28 22.5 28 14A13 13 0 1 0 2 14C2 22.5 15 39 15 39Z" fill="${color}"/><circle cx="15" cy="14" r="4.5" fill="#fff"/></svg>`;

/** Small colored pin marker built from a divIcon (no image assets needed). */
const makeIcon = (L: L, theme: MapTheme, selected: boolean, kind: 'business' | 'own') =>
  L.divIcon({
    className: 'no-marker-styles',
    html: `<div class="no-marker-styles" style="transform:${selected ? 'scale(1.18)' : 'scale(1)'};transition:transform 120ms ease;">${MARKER_PIN(
      kind === 'own' ? theme.markerOwn : selected ? theme.markerSelected : theme.marker,
      selected,
    )}</div>`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
  });

const isFiniteLatLng = (p: LatLng) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export const createLeafletProvider = (): { map: MapProvider; geocoding: ReturnType<typeof createNominatimGeocoding> } => {
  let map: LMap | null = null;
  let container: HTMLElement | null = null;
  let theme: MapTheme = DEFAULT_MAP_THEME;
  let idleCb: ((c: LatLng) => void) | null = null;
  let markerClickCb: ((id: string) => void) | null = null;
  let mapClickCb: ((p: LatLng) => void) | null = null;
  let dragEndCb: ((p: LatLng) => void) | null = null;
  const markers = new Map<string, LMarker>();
  let pin: LMarker | null = null;

  const provider: MapProvider = {
    async mount(el, opts) {
      const L = await loadLeaflet();
      if (map && container === el) return; // re-mount on the same element: no-op
      if (map) provider.unmount();
      container = el;
      theme = opts.theme ?? DEFAULT_MAP_THEME;
      map = L.map(el, { center: [opts.center.lat, opts.center.lng], zoom: opts.zoom, zoomControl: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      map.on('moveend', () => {
        const c = map!.getCenter();
        idleCb?.({ lat: c.lat, lng: c.lng });
      });
      map.on('click', (e) => {
        if (e.latlng) mapClickCb?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    },

    unmount() {
      map?.remove();
      map = null;
      container = null;
      markers.clear();
      pin = null;
    },

    setMarkers(list, selected) {
      // Marker diffing is async (icons need the loaded vendor); the loaded
      // module is cached after first mount, so this settles immediately.
      void (async () => {
        const l = await loadLeaflet();
        if (!map) return;
        const keep = new Set(list.map((m) => m.id));
        for (const [id, marker] of markers) {
          if (!keep.has(id)) {
            map.removeLayer(marker);
            markers.delete(id);
          }
        }
        for (const m of list) {
          if (!isFiniteLatLng(m.position)) continue; // never render fabricated points
          const existing = markers.get(m.id);
          if (existing) {
            existing.setLatLng(m.position);
          } else {
            const marker = l.marker([m.position.lat, m.position.lng], {
              icon: makeIcon(l, theme, false, 'business'),
              title: m.title,
            });
            marker.on('click', () => markerClickCb?.(m.id));
            marker.addTo(map);
            markers.set(m.id, marker);
          }
        }
        provider.selectMarker(selected ?? null);
      })();
    },

    selectMarker(id) {
      void (async () => {
        const l = await loadLeaflet();
        for (const [mid, marker] of markers) {
          marker.setIcon(makeIcon(l, theme, mid === id, 'business'));
        }
      })();
    },

    panTo(position, zoom) {
      if (!map || !isFiniteLatLng(position)) return;
      if (zoom !== undefined) map.setView([position.lat, position.lng], zoom);
      else map.panTo([position.lat, position.lng], { animate: true });
    },

    getCenter() {
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },

    onMapIdle(cb) {
      idleCb = cb;
    },
    onMarkerClick(cb) {
      markerClickCb = cb;
    },
    onMapClick(cb) {
      mapClickCb = cb;
    },

    setDraggableMarker(position) {
      void (async () => {
        const l = await loadLeaflet();
        if (!map) return;
        if (!position) {
          if (pin) {
            map.removeLayer(pin);
            pin = null;
          }
          return;
        }
        if (!isFiniteLatLng(position)) return;
        if (pin) {
          pin.setLatLng(position);
        } else {
          pin = l.marker([position.lat, position.lng], { draggable: true, icon: makeIcon(l, theme, false, 'own') });
          pin.on('dragend', () => {
            const p = pin!.getLatLng();
            dragEndCb?.({ lat: p.lat, lng: p.lng });
          });
          pin.addTo(map);
        }
      })();
    },
    getDraggableMarker() {
      return pin ? pin.getLatLng() : null;
    },
    onDraggableMarkerMove(cb) {
      dragEndCb = cb;
    },
  };

  return { map: provider, geocoding: createNominatimGeocoding() };
};

/**
 * Geocoding via OpenStreetMap's Nominatim (free, keyless). Usage policy
 * expects low volumes with a valid referer; fine for owner address search on
 * submit. Results are biased to Pakistan (`countrycodes=pk`) — NearbyOrders
 * operates in Pakistan (PKR pricing, en-PK locale). A vendor provider can
 * replace it behind the same interface.
 */
export const createNominatimGeocoding = (): {
  geocode(q: string): Promise<GeocodeResult[]>;
  reverseGeocode(p: LatLng): Promise<GeocodeResult | null>;
} => ({
  async geocode(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    let res: Response;
    try {
      res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=pk&q=${encodeURIComponent(trimmed)}`, {
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new MapProviderError('Could not search for that address. Check your connection and try again.');
    }
    if (!res.ok) throw new MapProviderError('Address search is unavailable right now. Please try again.');
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return rows
      .map((r) => ({ position: { lat: Number(r.lat), lng: Number(r.lon) }, label: r.display_name }))
      .filter((r) => isFiniteLatLng(r.position));
  },
  async reverseGeocode(position) {
    if (!isFiniteLatLng(position)) return null;
    let res: Response;
    try {
      res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${position.lat}&lon=${position.lng}`, {
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null; // reverse lookup is best-effort labeling; never blocks saving a pin
    }
    if (!res.ok) return null;
    const row = (await res.json()) as { display_name?: string } | null;
    return row?.display_name ? { position, label: row.display_name } : null;
  },
});
