import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultMapProvider,
  type GeocodingProvider,
  type LatLng,
  type MapProvider,
} from './provider.js';

/**
 * React binding for the map provider abstraction (Phase 12).
 *
 * `useMapProvider` owns the provider lifecycle for a container element:
 * mounting when the canvas element appears, unmounting when it goes away or
 * the component unmounts. Screens receive the ready provider plus
 * per-instance event registries, so handlers can change on every render
 * without re-initializing the underlying map.
 *
 * The mount is keyed on the canvas element itself (not component mount):
 * screens that render their map only after an async load (e.g. the business
 * Location screen, which shows a loader first) would otherwise never get a
 * mounted map — the one-shot mount effect would run while the canvas does
 * not exist yet. Keying on the element fixes that whole class of blank maps.
 */

export type MapHandle = {
  provider: MapProvider | null;
  geocoding: GeocodingProvider;
  /** Set by the canvas when the vendor map finished mounting. */
  ready: boolean;
  /** Attach this ref to the canvas element the map mounts into. */
  canvasRef: React.RefCallback<HTMLDivElement>;
  /** Register an idle callback; returns an unsubscribe function. */
  onMapIdle(cb: (center: LatLng) => void): () => void;
  onMarkerClick(cb: (id: string) => void): () => void;
  onMapClick(cb: (position: LatLng) => void): () => void;
  onDraggableMarkerMove(cb: (position: LatLng) => void): () => void;
};

/** Generic per-instance event registry: latest callback wins, no re-subscribes. */
const useEventRegistry = <T,>() => {
  const ref = useRef<Set<(value: T) => void>>(new Set());
  const subscribe = useMemo(
    () => (cb: (value: T) => void) => {
      ref.current.add(cb);
      return () => {
        ref.current.delete(cb);
      };
    },
    [],
  );
  const emit = useMemo(
    () => (value: T) => {
      ref.current.forEach((cb) => cb(value));
    },
    [],
  );
  return { subscribe, emit };
};

export const useMapProvider = (): { handle: MapHandle } => {
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [ready, setReady] = useState(false);
  // The canvas element, as state: mounting is keyed on the element existing,
  // so a canvas that renders after an async load still gets a mounted map.
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  const idle = useEventRegistry<LatLng>();
  const markerClick = useEventRegistry<string>();
  const mapClick = useEventRegistry<LatLng>();
  const dragMove = useEventRegistry<LatLng>();

  useEffect(() => {
    if (!element) return;
    let cancelled = false;
    let map: MapProvider | null = null;
    const tryMount = async () => {
      const created = await createDefaultMapProvider();
      if (cancelled) return;
      await created.map.mount(element, { center: { lat: 30.3753, lng: 69.3451 }, zoom: 5 }); // Pakistan overview until the screen pans
      if (cancelled) {
        created.map.unmount();
        return;
      }
      map = created.map;
      map.onMapIdle((c) => idle.emit(c));
      map.onMarkerClick((id) => markerClick.emit(id));
      map.onMapClick((p) => mapClick.emit(p));
      map.onDraggableMarkerMove((p) => dragMove.emit(p));
      setProvider(map);
      setReady(true);
    };
    void tryMount();
    return () => {
      cancelled = true;
      map?.unmount();
      map = null;
      setProvider(null);
      setReady(false);
    };
    // Idle/marker/map-click/drag registries are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element]);

  // Ref callback feeds the element into state; React calls it with null on
  // detach, which cleanly unmounts the map via the effect above.
  const canvasRef = useMemo(
    () => (el: HTMLDivElement | null) => {
      setElement(el);
    },
    [],
  );

  const handle: MapHandle = useMemo(
    () => ({
      provider,
      geocoding: createDefaultGeocodingRef(),
      ready,
      canvasRef,
      onMapIdle: idle.subscribe,
      onMarkerClick: markerClick.subscribe,
      onMapClick: mapClick.subscribe,
      onDraggableMarkerMove: dragMove.subscribe,
    }),
    [provider, ready, canvasRef, idle.subscribe, markerClick.subscribe, mapClick.subscribe, dragMove.subscribe],
  );

  return { handle };
};

/**
 * Geocoding is stateless, so the handle exposes the default implementation
 * directly. (A future vendor provider ships its geocoder through the same
 * factory; screens never construct one themselves.)
 */
const createDefaultGeocodingRef = (): GeocodingProvider => {
  const impl = async (): Promise<GeocodingProvider> => {
    const mod = (await import('./leaflet.js')) as {
      createNominatimGeocoding: () => GeocodingProvider;
    };
    return mod.createNominatimGeocoding();
  };
  return {
    async geocode(q) {
      return (await impl()).geocode(q);
    },
    async reverseGeocode(p) {
      return (await impl()).reverseGeocode(p);
    },
  };
};
