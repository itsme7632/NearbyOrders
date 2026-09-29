import { useState } from 'react';
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
 * This component MUST NOT implement any fallback, retry, proxy,
 * fetch-and-convert-to-blob, URL rewrite, or referrer-policy change. It is
 * instrumentation only.
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
  /** img.naturalHeight at error time (0 when decode failed). */
  naturalHeight: number;
  /** window.location.origin of the WebView page. */
  origin: string;
  /** navigator.userAgent of the WebView. */
  userAgent: string;
  /** ISO timestamp of the error event. */
  timestamp: string;
};

export function DiagnosticImage(props: {
  src: string | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failure, setFailure] = useState<ImageLoadFailure | null>(null);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setFailure({
      src: props.src ?? '(undefined)',
      currentSrc: img.currentSrc,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });
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
          </dl>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openDirectly}>
            Open image directly
          </button>
        </div>
      ) : null}
    </>
  );
}
