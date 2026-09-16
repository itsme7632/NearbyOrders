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
 * `useMapProvider` owns the provider lifecycle for a container ref: mounting,
 * unmounting and re-mounting on container change. Screens receive the ready
 * provider plus per-instance event registries, so handlers can change on every
 * render without re-initializing the underlying map.
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
  const elementRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<MapProvider | null>(null);
  const cancelledRef = useRef(false);

  const idle = useEventRegistry<LatLng>();
  const markerClick = useEventRegistry<string>();
  const mapClick = useEventRegistry<LatLng>();
  const dragMove = useEventRegistry<LatLng>();

  useEffect(() => {
    cancelledRef.current = false;
    let mountedEl: HTMLElement | null = null;
    const tryMount = async () => {
      const el = elementRef.current;
      if (!el || providerRef.current) return;
      const { map } = await createDefaultMapProvider();
      if (cancelledRef.current) return;
      // The element may have been swapped between the await and here.
      if (elementRef.current !== el) return;
      await map.mount(el, { center: { lat: 30.3753, lng: 69.3451 }, zoom: 5 }); // Pakistan overview until the screen pans
      if (cancelledRef.current) {
        map.unmount();
        return;
      }
      mountedEl = el;
      providerRef.current = map;
      map.onMapIdle((c) => idle.emit(c));
      map.onMarkerClick((id) => markerClick.emit(id));
      map.onMapClick((p) => mapClick.emit(p));
      map.onDraggableMarkerMove((p) => dragMove.emit(p));
      setProvider(map);
      setReady(true);
    };
    void tryMount();
    return () => {
      cancelledRef.current = true;
      if (mountedEl && providerRef.current) {
        providerRef.current.unmount();
        providerRef.current = null;
        setProvider(null);
        setReady(false);
      }
    };
    // Idle/marker/map-click/drag registries are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-mounts if the canvas element is replaced (React calls ref with null then node).
  const canvasRef = useMemo(
    () =>
      (el: HTMLDivElement | null) => {
        elementRef.current = el;
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
