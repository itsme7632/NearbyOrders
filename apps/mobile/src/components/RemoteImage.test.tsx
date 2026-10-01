import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import { RemoteImage } from './RemoteImage.js';

const SRC = 'https://api.nearbyorders.com/api/v1/images/uploads/test.png';

afterEach(cleanup);

describe('RemoteImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Blob(['valid image bytes'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:remote-image-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the direct URL until the image errors, then loads the fetched Blob through an object URL', async () => {
    render(<RemoteImage src={SRC} alt="Business logo" />);

    const img = screen.getByAltText('Business logo') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(SRC);

    fireEvent.error(img);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(SRC, expect.objectContaining({
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }));
      expect(img.getAttribute('src')).toBe('blob:remote-image-test');
      expect(img.getAttribute('data-image-blob-fallback')).toBe('true');
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not retry the Blob fallback when that fallback image errors', async () => {
    render(<RemoteImage src={SRC} alt="Business logo" />);

    const img = screen.getByAltText('Business logo') as HTMLImageElement;
    fireEvent.error(img);

    await waitFor(() => expect(img.getAttribute('src')).toBe('blob:remote-image-test'));

    fireEvent.error(img);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL when the component unmounts', async () => {
    const { unmount } = render(<RemoteImage src={SRC} alt="Business logo" />);

    const img = screen.getByAltText('Business logo') as HTMLImageElement;
    fireEvent.error(img);

    await waitFor(() => expect(img.getAttribute('src')).toBe('blob:remote-image-test'));

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:remote-image-test');
  });
});
