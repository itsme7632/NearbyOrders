// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('../location.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../location.js')>();
  return { ...actual, checkLocationPermissionState: vi.fn() };
});

import {
  LocationPermissionExplainer,
  wasLocationExplainerShown,
  markLocationExplainerShown,
  useLocationExplainer,
} from './LocationPermissionExplainer.js';
import {
  PushPermissionExplainer,
  wasPushExplainerShown,
  markPushExplainerShown,
} from './PushPermissionExplainer.js';
import { checkLocationPermissionState } from '../location.js';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/* ---------------- push explainer persistence ---------------- */

describe('push explainer persistence', () => {
  it('is hidden until marked shown', () => {
    expect(wasPushExplainerShown()).toBe(false);
    markPushExplainerShown();
    expect(wasPushExplainerShown()).toBe(true);
  });

  it('Enable marks shown and dismisses', async () => {
    const onEnable = vi.fn().mockResolvedValue(true);
    const onDismiss = vi.fn();
    render(<PushPermissionExplainer onEnable={onEnable} onDismiss={onDismiss} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
    });
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(wasPushExplainerShown()).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Not now marks shown without enabling', () => {
    const onEnable = vi.fn();
    const onDismiss = vi.fn();
    render(<PushPermissionExplainer onEnable={onEnable} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onEnable).not.toHaveBeenCalled();
    expect(wasPushExplainerShown()).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

/* ---------------- location explainer ---------------- */

describe('location explainer persistence', () => {
  it('is hidden until marked shown', () => {
    expect(wasLocationExplainerShown()).toBe(false);
    markLocationExplainerShown();
    expect(wasLocationExplainerShown()).toBe(true);
  });

  it('Allow marks shown and proceeds', () => {
    const onAllow = vi.fn();
    const onDismiss = vi.fn();
    render(<LocationPermissionExplainer onAllow={onAllow} onDismiss={onDismiss} />);
    expect(screen.getByText('Find businesses near you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow location' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(wasLocationExplainerShown()).toBe(true);
  });

  it('Not now marks shown without proceeding', () => {
    const onAllow = vi.fn();
    const onDismiss = vi.fn();
    render(<LocationPermissionExplainer onAllow={onAllow} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAllow).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(wasLocationExplainerShown()).toBe(true);
  });
});

describe('useLocationExplainer gate', () => {
  function Harness(props: { onProceed: () => void }) {
    const { requestWithExplainer, explainer } = useLocationExplainer();
    return (
      <>
        <button type="button" onClick={() => requestWithExplainer(props.onProceed)}>
          nearby
        </button>
        {explainer}
      </>
    );
  }

  it('proceeds directly when permission is already granted', async () => {
    vi.mocked(checkLocationPermissionState).mockResolvedValue('granted');
    const onProceed = vi.fn();
    render(<Harness onProceed={onProceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'nearby' }));
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Find businesses near you')).toBeNull();
  });

  it('shows the explainer once when permission is promptable and never asked', async () => {
    vi.mocked(checkLocationPermissionState).mockResolvedValue('prompt');
    const onProceed = vi.fn();
    render(<Harness onProceed={onProceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'nearby' }));
    });
    expect(screen.getByText('Find businesses near you')).toBeTruthy();
    expect(onProceed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow location' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('never shows the explainer twice', async () => {
    vi.mocked(checkLocationPermissionState).mockResolvedValue('prompt');
    markLocationExplainerShown();
    const onProceed = vi.fn();
    render(<Harness onProceed={onProceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'nearby' }));
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Find businesses near you')).toBeNull();
  });

  it('proceeds directly when permission was denied (no nagging)', async () => {
    vi.mocked(checkLocationPermissionState).mockResolvedValue('denied');
    const onProceed = vi.fn();
    render(<Harness onProceed={onProceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'nearby' }));
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Find businesses near you')).toBeNull();
  });
});
