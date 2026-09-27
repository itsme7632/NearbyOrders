// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Sheet as SheetType } from './components/primitives.js';

/**
 * Regression tests for central Android system-back handling
 * (src/androidBack.ts).
 *
 * The bug: the app never intercepted the Android system back button —
 * no backButton listener, no native override, @capacitor/app not
 * installed — so every back press finished the Activity and dropped the
 * user on the Android home screen, even with in-app history or an open
 * sheet. These tests pin the fixed behavior:
 *
 *  - previous-route navigation whenever history exists
 *  - root-with-no-history is the ONLY case that backgrounds the app
 *  - overlays (sheets, dialog previews) dismiss before navigating
 *  - customer, owner, checkout and booking flows all route centrally
 *  - repeated back presses walk the stack down in order
 */

let currentPlatform = 'android';

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    minimizeApp: vi.fn(async () => {}),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => currentPlatform },
}));

type AndroidBackModule = typeof import('./androidBack.js');
type MockApp = {
  addListener: ReturnType<typeof vi.fn>;
  minimizeApp: ReturnType<typeof vi.fn>;
};

async function freshModule(): Promise<{ mod: AndroidBackModule; app: MockApp }> {
  vi.resetModules();
  const mod = (await import('./androidBack.js')) as AndroidBackModule;
  const mocked = (await import('@capacitor/app')) as unknown as { App: MockApp };
  return { mod, app: mocked.App };
}

function backHandler(app: MockApp): ((event: { canGoBack: boolean }) => void) | undefined {
  const call = app.addListener.mock.calls.find((c) => c[0] === 'backButton');
  return call?.[1];
}

describe('resolveBackAction (pure decision)', () => {
  let mod: AndroidBackModule;
  beforeEach(async () => {
    ({ mod } = await freshModule());
  });

  it('dismisses an overlay before anything else, even with history', () => {
    expect(mod.resolveBackAction({ overlayOpen: true, canGoBack: true, hash: '#/business/abc' })).toEqual({
      type: 'dismiss-overlay',
    });
  });

  it('navigates to the previous route whenever history exists', () => {
    for (const hash of ['#/', '#/business/abc', '#/cart', '#/book/b1/s2', '#/owner', '#/owner/b1/products']) {
      expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: true, hash })).toEqual({ type: 'history-back' });
    }
  });

  it('lands on the tab root for customer deep routes with no history', () => {
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/business/abc' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/order/123' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/edit-profile' })).toEqual({
      type: 'go-home',
    });
  });

  it('lands on the tab root for business-owner nested screens with no history', () => {
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/owner' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/owner/b1/products' })).toEqual({
      type: 'go-home',
    });
    expect(
      mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/owner/b1/subscription-plan' }),
    ).toEqual({ type: 'go-home' });
  });

  it('lands on the tab root for checkout and booking flows with no history', () => {
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/cart' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/book/b1' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/book/b1/s2' })).toEqual({
      type: 'go-home',
    });
    expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash: '#/booking/xyz' })).toEqual({
      type: 'go-home',
    });
  });

  it('exits only at the genuine root with no history', () => {
    for (const hash of ['#/', '#', '']) {
      expect(mod.resolveBackAction({ overlayOpen: false, canGoBack: false, hash })).toEqual({ type: 'exit' });
    }
  });
});

describe('isRootHash', () => {
  let mod: AndroidBackModule;
  beforeEach(async () => {
    ({ mod } = await freshModule());
  });

  it('treats the tab shell as root in both modes', () => {
    expect(mod.isRootHash('#/')).toBe(true);
    expect(mod.isRootHash('#')).toBe(true);
    expect(mod.isRootHash('')).toBe(true);
  });

  it('does not treat nested routes as root', () => {
    expect(mod.isRootHash('#/business/abc')).toBe(false);
    expect(mod.isRootHash('#/owner')).toBe(false);
    expect(mod.isRootHash('#/cart')).toBe(false);
  });
});

describe('initAndroidBackNavigation', () => {
  beforeEach(() => {
    currentPlatform = 'android';
    window.location.hash = '#/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    currentPlatform = 'android';
    window.location.hash = '#/';
  });

  it('registers exactly one backButton listener on Android (idempotent)', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    mod.initAndroidBackNavigation();
    const registrations = app.addListener.mock.calls.filter((c) => c[0] === 'backButton');
    expect(registrations).toHaveLength(1);
  });

  it('does nothing on web (no listener, platform guard)', async () => {
    currentPlatform = 'web';
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    expect(app.addListener).not.toHaveBeenCalled();
  });

  it('dismisses an open overlay instead of navigating', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const dismiss = vi.fn();
    const unregister = mod.registerOverlayBackHandler(dismiss);
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    backHandler(app)!({ canGoBack: true });

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
    expect(app.minimizeApp).not.toHaveBeenCalled();
    unregister();
  });

  it('dismisses the topmost overlay first when several are registered', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const calls: string[] = [];
    const unregisterFirst = mod.registerOverlayBackHandler(() => calls.push('first'));
    const unregisterSecond = mod.registerOverlayBackHandler(() => calls.push('second'));

    backHandler(app)!({ canGoBack: true });
    expect(calls).toEqual(['second']);

    backHandler(app)!({ canGoBack: true });
    expect(calls).toEqual(['second', 'first']);
    unregisterFirst();
    unregisterSecond();
  });

  it('navigates history when entries exist and no overlay is open', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.location.hash = '#/business/abc';

    backHandler(app)!({ canGoBack: true });

    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('lands on the tab root for a customer deep link with no history', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    window.location.hash = '#/business/abc';

    backHandler(app)!({ canGoBack: false });

    expect(window.location.hash).toBe('#/');
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('lands on the tab root for a business-owner nested screen with no history', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    window.location.hash = '#/owner/b1/subscription-plan';

    backHandler(app)!({ canGoBack: false });

    expect(window.location.hash).toBe('#/');
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('lands on the tab root for checkout with no history', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    window.location.hash = '#/cart';

    backHandler(app)!({ canGoBack: false });

    expect(window.location.hash).toBe('#/');
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('backgrounds the app only at the genuine root with no history', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.location.hash = '#/';

    backHandler(app)!({ canGoBack: false });

    expect(historyBack).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
  });

  it('walks repeated back presses down in order: overlay, history, root exit', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const dismiss = vi.fn();
    mod.registerOverlayBackHandler(dismiss);
    const press = backHandler(app)!;

    // 1st press: overlay dismisses, nothing navigates.
    press({ canGoBack: true });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
    expect(app.minimizeApp).not.toHaveBeenCalled();

    // 2nd press: history exists, goes back.
    window.location.hash = '#/book/b1/s2';
    press({ canGoBack: true });
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(app.minimizeApp).not.toHaveBeenCalled();

    // 3rd press: at the root with no history — the ONLY exit case.
    window.location.hash = '#/';
    press({ canGoBack: false });
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
  });

  it('falls through to history once an overlay unregisters', async () => {
    const { mod, app } = await freshModule();
    mod.initAndroidBackNavigation();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const dismiss = vi.fn();
    const unregister = mod.registerOverlayBackHandler(dismiss);
    unregister();

    backHandler(app)!({ canGoBack: true });

    expect(dismiss).not.toHaveBeenCalled();
    expect(historyBack).toHaveBeenCalledTimes(1);
  });
});

describe('Sheet system-back wiring', () => {
  // The Sheet binds to whichever androidBack module instance it imports, so
  // it must be (re-)imported after each module reset — a top-level static
  // import would pin it to a stale overlay stack.
  let SheetComp: typeof SheetType;
  let mod: AndroidBackModule;
  let app: MockApp;

  beforeEach(async () => {
    currentPlatform = 'android';
    window.location.hash = '#/';
    vi.resetModules();
    mod = (await import('./androidBack.js')) as AndroidBackModule;
    app = ((await import('@capacitor/app')) as unknown as { App: MockApp }).App;
    SheetComp = ((await import('./components/primitives.js')) as typeof import('./components/primitives.js')).Sheet;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    currentPlatform = 'android';
    window.location.hash = '#/';
  });

  it('closes an open sheet on system back instead of navigating', async () => {
    mod.initAndroidBackNavigation();
    const onClose = vi.fn();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(
      <SheetComp open onClose={onClose} title="Filters">
        body
      </SheetComp>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    backHandler(app)!({ canGoBack: true });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it('does not intercept back when the sheet is closed', async () => {
    mod.initAndroidBackNavigation();
    const onClose = vi.fn();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(
      <SheetComp open={false} onClose={onClose} title="Filters">
        body
      </SheetComp>,
    );

    backHandler(app)!({ canGoBack: true });

    expect(onClose).not.toHaveBeenCalled();
    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  it('leaves persistent sheets to history navigation (they own their flow)', async () => {
    mod.initAndroidBackNavigation();
    const onClose = vi.fn();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(
      <SheetComp open persistent onClose={onClose} title="Payment">
        body
      </SheetComp>,
    );

    backHandler(app)!({ canGoBack: true });

    expect(onClose).not.toHaveBeenCalled();
    expect(historyBack).toHaveBeenCalledTimes(1);
  });
});
