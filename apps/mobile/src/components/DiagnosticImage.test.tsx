import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * TEMPORARY diagnostic tests for the Android WebView image-loading
 * investigation. These verify the DiagnosticImage instrumentation:
 * - With VITE_IMAGE_DEBUG unset (normal builds), it renders a plain <img>
 *   with no diagnostic behavior.
 * - With VITE_IMAGE_DEBUG=true (diagnostic APK), an <img> onError captures
 *   the failure details and renders the visible diagnostic panel.
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
    // No diagnostic panel in normal builds.
    expect(screen.queryByTestId('image-debug-panel')).toBeNull();
  });
});

describe('DiagnosticImage (flag enabled)', () => {
  it('captures onError details and renders the diagnostic panel', async () => {
    vi.resetModules();
    vi.doMock('../imageDebug.js', () => ({ IMAGE_DEBUG: true }));
    const { DiagnosticImage } = await import('./DiagnosticImage.js');

    const { container } = render(<DiagnosticImage src={TEST_SRC} alt="Test" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();

    // Simulate the WebView failing to load the image.
    Object.defineProperty(img, 'currentSrc', { value: TEST_SRC, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });
    fireEvent.error(img);

    // The diagnostic panel appears with the captured details.
    const panel = screen.getByTestId('image-debug-panel');
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

    // The "Open image directly" button is present.
    const openBtn = screen.getByRole('button', { name: /open image directly/i });
    expect(openBtn).not.toBeNull();

    vi.resetModules();
  });

  it('does not render the panel before an error occurs', async () => {
    vi.resetModules();
    vi.doMock('../imageDebug.js', () => ({ IMAGE_DEBUG: true }));
    const { DiagnosticImage } = await import('./DiagnosticImage.js');

    render(<DiagnosticImage src={TEST_SRC} alt="Test" />);
    expect(screen.queryByTestId('image-debug-panel')).toBeNull();

    vi.resetModules();
  });
});
