import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactEventHandler } from 'react';

type RemoteImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | undefined;
};

/**
 * Image loader for remote API images.
 *
 * Android WebView in the production Capacitor shell can fail to render a
 * perfectly valid cross-origin HTTP image through the direct <img src> path,
 * even though fetch() and Chromium's image decoder can consume the same bytes.
 *
 * Keep the normal direct URL as the first path. If that path errors, fetch the
 * exact URL, create a temporary object URL for the response Blob, and switch
 * the same <img> to that local object URL.
 *
 * To avoid making a failed direct <img> request followed by a second full
 * request feel unnecessarily slow, a small delayed fallback fetch is started
 * for images that have not loaded after 250ms. If the direct image succeeds,
 * that fallback request is aborted. This keeps fast direct loads fast while
 * removing most of the sequential delay on the Android WebView failure path.
 */
export function RemoteImage({ src, onError, ...props }: RemoteImageProps) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [usingBlobFallback, setUsingBlobFallback] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

  const startFallbackFetch = async () => {
    if (!src || fallbackAttemptedRef.current) return;
    fallbackAttemptedRef.current = true;

    const controller = new AbortController();
    fetchControllerRef.current = controller;

    try {
      const response = await fetch(src, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Image fetch failed with HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (controller.signal.aborted || loadedRef.current) return;

      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setUsingBlobFallback(true);
      setDisplaySrc(objectUrl);
    } catch {
      // Keep the original broken-image behavior if the fallback cannot load.
    } finally {
      if (fetchControllerRef.current === controller) fetchControllerRef.current = null;
    }
  };

  useEffect(() => {
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
    if (objectUrlRef.current) {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    fallbackAttemptedRef.current = false;
    loadedRef.current = false;
    setUsingBlobFallback(false);
    setDisplaySrc(src);

    // Give the normal browser image path a short head start. On the Android
    // WebView failure path, this overlaps the fallback request with the
    // browser's failed image request instead of waiting for the failure first.
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) void startFallbackFetch();
    }, 250);

    return () => {
      window.clearTimeout(timer);
      fetchControllerRef.current?.abort();
      fetchControllerRef.current = null;
      if (objectUrlRef.current) {
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [src]);

  const handleLoad: React.ReactEventHandler<HTMLImageElement> = () => {
    loadedRef.current = true;
    fetchControllerRef.current?.abort();
    fetchControllerRef.current = null;
  };

  const handleError: ReactEventHandler<HTMLImageElement> = async (event) => {
    onError?.(event);
    await startFallbackFetch();
  };

  return (
    <img
      {...props}
      src={displaySrc}
      onLoad={handleLoad}
      onError={handleError}
      data-image-blob-fallback={usingBlobFallback ? 'true' : undefined}
    />
  );
}
