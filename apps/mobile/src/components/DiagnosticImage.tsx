import { useEffect, useState } from 'react';
import { IMAGE_DEBUG } from '../imageDebug.js';

/**
 * TEMPORARY diagnostic wrapper for business images (Android WebView
 * image-loading investigation).
 *
 * When VITE_IMAGE_DEBUG is not set (all normal builds), this renders a plain
 * <img> with NO onError handler — behavior is byte-identical to the previous
 * code. The diagnostic is purely additive and only active in the diagnostic
 * APK build.
 *
 * When VITE_IMAGE_DEBUG=true, an onError handler captures the exact failure
 * details and a visible panel is rendered directly under the failed image,
 * including an "Open image directly" button that opens the failing URL in
 * the system browser (outside the WebView) for comparison.
 *
 * This component MUST NOT change the normal image path or implement a
 * production fallback. In diagnostic mode only, after the direct <img>
 * fails, it also runs a Blob -> object URL -> <img> experiment so we can
 * distinguish a WebView direct-network image failure from an <img> rendering
 * failure. It is instrumentation only.
 */

export type ImageLoadFailure = {
  /** The src attribute as passed to the <img>. */
  src: string;
  /** The img.currentSrc at error time (resolved URL the browser attempted). */
  currentSrc: string;
  /** img.complete at error time. */
  complete: boolean;
  /** img.naturalWidth at error time (0 when decode failed). */
  naturalWidth: number;
  /** img.naturalHeight at error time. */
  naturalHeight: number;
  /** window.location.origin of the WebView page. */
  origin: string;
  /** navigator.userAgent of the WebView. */
  userAgent: string;
  /** ISO timestamp of the error event. */
  timestamp: string;
  /** Result of a one-shot CORS fetch of the same URL after the img failed. */
  fetchStatus: string;
  fetchType: string;
  fetchContentType: string;
  fetchContentLength: string;
  fetchBodyBytes: string;
  /** Result of asking Chromium's image decoder to decode the fetched Blob. */
  bitmapStatus: string;
  bitmapWidth: string;
  bitmapHeight: string;
};

export function DiagnosticImage(props: {
  src: string | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failure, setFailure] = useState<ImageLoadFailure | null>(null);
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [blobImageStatus, setBlobImageStatus] = useState('NOT_STARTED');

  useEffect(() => {
    return () => {
      if (blobSrc && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(blobSrc);
    };
  }, [blobSrc]);

  const handleError = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const baseFailure = {
      src: props.src ?? '(undefined)',
      currentSrc: img.currentSrc,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };

    if (!props.src) {
      setFailure({
        ...baseFailure,
        fetchStatus: 'SKIPPED',
        fetchType: '-',
        fetchContentType: '-',
        fetchContentLength: '-',
        fetchBodyBytes: '-',
        bitmapStatus: 'SKIPPED',
        bitmapWidth: '-',
        bitmapHeight: '-',
      });
      return;
    }

    try {
      const response = await fetch(props.src, { method: 'GET', mode: 'cors', cache: 'no-store' });
      const body = await response.blob();

      if (typeof URL.createObjectURL === 'function') {
        const objectUrl = URL.createObjectURL(body);
        setBlobSrc(objectUrl);
        setBlobImageStatus('READY - waiting for <img>');
      } else {
        setBlobImageStatus('UNSUPPORTED: URL.createObjectURL');
      }

      let bitmapStatus = 'UNTESTED';
      let bitmapWidth = '-';
      let bitmapHeight = '-';

      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(body);
          bitmapStatus = 'DECODE_OK';
          bitmapWidth = String(bitmap.width);
          bitmapHeight = String(bitmap.height);
          bitmap.close();
        } catch (error) {
          bitmapStatus = error instanceof Error
            ? `DECODE_FAILED: ${error.message}`
            : `DECODE_FAILED: ${String(error)}`;
        }
      } else {
        bitmapStatus = 'UNSUPPORTED';
      }

      setFailure({
        ...baseFailure,
        fetchStatus: String(response.status),
        fetchType: response.type,
        fetchContentType: response.headers.get('content-type') ?? '(none)',
        fetchContentLength: response.headers.get('content-length') ?? '(none)',
        fetchBodyBytes: String(body.size),
        bitmapStatus,
        bitmapWidth,
        bitmapHeight,
      });
    } catch (error) {
      setFailure({
        ...baseFailure,
        fetchStatus: 'FETCH_FAILED',
        fetchType: '-',
        fetchContentType: '-',
        fetchContentLength: '-',
        fetchBodyBytes: error instanceof Error ? error.message : String(error),
        bitmapStatus: 'NOT_REACHED',
        bitmapWidth: '-',
        bitmapHeight: '-',
      });
    }
  };

  const openDirectly = () => {
    if (props.src) {
      // Opens in the system browser (outside the Capacitor WebView) so the
      // same URL can be compared: works in Chrome vs fails in WebView.
      window.open(props.src, '_blank', 'noopener');
    }
  };

  return (
    <>
      <img
        src={props.src}
        alt={props.alt}
        className={props.className}
        loading={props.loading}
        onError={IMAGE_DEBUG ? handleError : undefined}
      />
      {IMAGE_DEBUG && failure ? (
        <div className="image-debug-panel" role="alert" data-testid="image-debug-panel">
          <strong className="image-debug-title">IMAGE LOAD FAILED</strong>
          <dl className="image-debug-list">
            <dt>src</dt>
            <dd data-testid="image-debug-src">{failure.src}</dd>
            <dt>currentSrc</dt>
            <dd data-testid="image-debug-currentsrc">{failure.currentSrc}</dd>
            <dt>complete</dt>
            <dd>{String(failure.complete)}</dd>
            <dt>naturalWidth</dt>
            <dd>{failure.naturalWidth}</dd>
            <dt>naturalHeight</dt>
            <dd>{failure.naturalHeight}</dd>
            <dt>origin</dt>
            <dd>{failure.origin}</dd>
            <dt>userAgent</dt>
            <dd className="image-debug-wrap">{failure.userAgent}</dd>
            <dt>timestamp</dt>
            <dd>{failure.timestamp}</dd>
            <dt>fetchStatus</dt>
            <dd>{failure.fetchStatus}</dd>
            <dt>fetchType</dt>
            <dd>{failure.fetchType}</dd>
            <dt>fetchContentType</dt>
            <dd>{failure.fetchContentType}</dd>
            <dt>fetchContentLength</dt>
            <dd>{failure.fetchContentLength}</dd>
            <dt>fetchBodyBytes</dt>
            <dd className="image-debug-wrap">{failure.fetchBodyBytes}</dd>
            <dt>bitmapStatus</dt>
            <dd className="image-debug-wrap">{failure.bitmapStatus}</dd>
            <dt>bitmapWidth</dt>
            <dd>{failure.bitmapWidth}</dd>
            <dt>bitmapHeight</dt>
            <dd>{failure.bitmapHeight}</dd>
          </dl>
          {blobSrc ? (
            <div className="image-debug-blob-test" data-testid="image-debug-blob-test">
              <strong>BLOB → OBJECT URL → &lt;IMG&gt;</strong>
              <div data-testid="image-debug-blob-status">{blobImageStatus}</div>
              <img
                src={blobSrc}
                alt="Blob diagnostic"
                className={props.className}
                onLoad={() => setBlobImageStatus('LOADED')}
                onError={() => setBlobImageStatus('FAILED')}
              />
            </div>
          ) : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={openDirectly}>
            Open image directly
          </button>
        </div>
      ) : null}
    </>
  );
}
