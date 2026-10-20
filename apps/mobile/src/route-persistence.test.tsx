// @vitest-environment jsdom
/**
 * Route persistence regressions (device report 2026-10-20: actions on
 * Business Detail that leave the app — Call, Directions, Share — returned
 * the user to Home). Root cause: the route lived only in the URL hash; when
 * Android destroys/recreates the WebView activity while the app is
 * backgrounded behind the dialer/maps/share sheet, Capacitor reloads the
 * start URL with an empty hash and the router fell back to the tab root.
 *
 * The router now persists in-progress business/book routes in
 * sessionStorage and restores them on a cold boot with an empty hash.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { restorableRoute, useRoute } from './hooks.js';

function RouteProbe() {
  const [route] = useRoute();
  return <div data-testid="route">{route.name}</div>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(cleanup);

describe('restorableRoute', () => {
  it('treats business and book routes as restorable', () => {
    expect(restorableRoute('#/business/butt-spices')).toBe('#/business/butt-spices');
    expect(restorableRoute('#/book/biz-1/svc-2')).toBe('#/book/biz-1/svc-2');
  });

  it('never restores the tab root or unrelated flows', () => {
    expect(restorableRoute('#/')).toBeNull();
    expect(restorableRoute('')).toBeNull();
    expect(restorableRoute('#/cart')).toBeNull();
    expect(restorableRoute('#/owner')).toBeNull();
    expect(restorableRoute('#/search')).toBeNull();
  });
});

describe('useRoute boot restore', () => {
  it('restores a persisted business route when the app cold-boots with an empty hash', () => {
    window.sessionStorage.setItem('no_last_route', '#/business/butt-spices');
    const { getByTestId } = render(<RouteProbe />);
    expect(getByTestId('route')).toHaveTextContent('business');
    expect(window.location.hash).toBe('#/business/butt-spices');
  });

  it('stays on the tab root when nothing was persisted', () => {
    const { getByTestId } = render(<RouteProbe />);
    expect(getByTestId('route')).toHaveTextContent('tabs');
  });

  it('an explicit current route wins over the persisted one', () => {
    window.sessionStorage.setItem('no_last_route', '#/business/butt-spices');
    window.history.replaceState(null, '', '#/cart');
    const { getByTestId } = render(<RouteProbe />);
    expect(getByTestId('route')).toHaveTextContent('cart');
  });
});
