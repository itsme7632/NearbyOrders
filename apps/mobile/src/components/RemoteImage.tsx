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
 * the same <img> to that local object URL. Object URLs are revoked when the
 * image changes or unmounts.
 */
export function RemoteImage({ src, onError, ...props }: RemoteImageProps) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [usingBlobFallback, setUsingBlobFallback] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const fetchControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    fallbackAttemptedRef.current = false;
    setUsingBlobFallback(false);
    setDisplaySrc(src);
  }, [src]);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      fetchControllerRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleError: ReactEventHandler<HTMLImageElement> = async (event) => {
    onError?.(event);

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
      if (controller.signal.aborted) return;
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

  return (
    <img
      {...props}
      src={displaySrc}
      onError={handleError}
      data-image-blob-fallback={usingBlobFallback ? 'true' : undefined}
    />
  );
}
