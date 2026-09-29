import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * TEMPORARY diagnostic tests for the Android WebView image-loading
 * investigation. These verify the DiagnosticImage instrumentation:
 * - With VITE_IMAGE_DEBUG unset (normal builds), it renders a plain <img>
 *   with no diagnostic behavior.
 * - With VITE_IMAGE_DEBUG=true (diagnostic APK), an <img> onError captures
 *   the failure details and renders the visible diagnostic panel.
 * - The diagnostic fetch also asks Chromium's createImageBitmap() to decode
 *   the exact response Blob, without changing the production image path.
 */

const TEST_SRC = 'https://api.nearbyorders.com/api/v1/images/uploads/7d114494-bab7-4872-acb3-ceed88ca33de.png';

afterEach(cleanup);

describe('DiagnosticImage (flag disabled)', () => {
  it('renders a plain img with the exact src and no diagnostic panel', async () => {
    const { DiagnosticImage } = await import('./DiagnosticImage.js');
    const { container } = render(<DiagnosticImage src={TEST_SRC} alt="Test" className="test-img" />);
    const img = container.querySelector('img.test-img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(TEST_SRC);
    expect(screen.queryByTestId('image-debug-panel')).toBeNull();
  });
});

describe('DiagnosticImage (flag enabled)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Blob(['valid image bytes'], { type: 'image/png' }), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '17',
        },
      }),
    ));
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:diagnostic-test'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      close: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('captures onError details, fetches the exact URL, and renders decode diagnostics', async () => {
    vi.resetModules();
    vi.doMock('../imageDebug.js', () => ({ IMAGE_DEBUG: true }));
    const { DiagnosticImage } = await import('./DiagnosticImage.js');

    const { container } = render(<DiagnosticImage src={TEST_SRC} alt="Test" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();

    Object.defineProperty(img, 'currentSrc', { value: TEST_SRC, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });
    fireEvent.error(img);

    const panel = await screen.findByTestId('image-debug-panel');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('IMAGE LOAD FAILED');
    expect(screen.getByTestId('image-debug-src').textContent).toBe(TEST_SRC);
    expect(screen.getByTestId('image-debug-currentsrc').textContent).toBe(TEST_SRC);
    expect(panel.textContent).toContain('naturalWidth');
    expect(panel.textContent).toContain('userAgent');
    expect(panel.textContent).toContain('origin');
    expect(panel.textContent).toContain('fetchStatus');
    expect(panel.textContent).toContain('fetchContentType');
    expect(panel.textContent).toContain('fetchBodyBytes');
    expect(panel.textContent).toContain('bitmapStatus');
    expect(panel.textContent).toContain('bitmapWidth');
    expect(panel.textContent).toContain('bitmapHeight');

    expect(fetch).toHaveBeenCalledWith(TEST_SRC, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(panel.textContent).toContain('DECODE_OK');
    expect(screen.getByTestId('image-debug-blob-test')).not.toBeNull();
    expect(screen.getByTestId('image-debug-blob-status').textContent).toContain('READY');

    const openBtn = screen.getByRole('button', { name: /open image directly/i });
    expect(openBtn).not.toBeNull();
  });

  it('reports decoder failure without changing the image path', async () => {
    vi.resetModules();
    vi.doMock('../imageDebug.js', () => ({ IMAGE_DEBUG: true }));
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decoder rejected image')));
    const { DiagnosticImage } = await import('./DiagnosticImage.js');

    const { container } = render(<DiagnosticImage src={TEST_SRC} alt="Test" />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);

    const panel = await screen.findByTestId('image-debug-panel');
    expect(panel.textContent).toContain('DECODE_FAILED: decoder rejected image');
    expect(panel.textContent).toContain('fetchStatus');
    expect(img.getAttribute('src')).toBe(TEST_SRC);
  });

  it('does not render the panel before an error occurs', async () => {
    vi.resetModules();
    vi.doMock('../imageDebug.js', () => ({ IMAGE_DEBUG: true }));
    const { DiagnosticImage } = await import('./DiagnosticImage.js');

    render(<DiagnosticImage src={TEST_SRC} alt="Test" />);
    expect(screen.queryByTestId('image-debug-panel')).toBeNull();
  });
});
