// Viewport zoom regression test.
//
// Root cause (2026-09-22, proven on a physical Xiaomi): the Android WebView
// allowed page-level pinch-to-zoom and double-tap zoom on the entire app,
// making NearbyOrders feel like a website instead of a native-feeling app.
//
// Fix: the viewport meta pins `maximum-scale=1.0` and `user-scalable=no` so
// the WebView never zooms the page. This does NOT affect the Leaflet maps:
// Leaflet implements pinch zoom, pan, and double-tap zoom itself via touch
// event handlers on the map container (see src/maps/leaflet.ts — touchZoom
// stays at its default `true`), independent of the browser page-zoom
// mechanism. No zoomable image/document viewers exist in the app, so nothing
// else loses a gesture.
//
// These tests pin the viewport meta so no future edit can re-enable page
// zoom, while keeping `width=device-width` and `viewport-fit=cover` (the
// edge-to-edge / status-bar-gutter contract).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, '..', 'index.html'), 'utf8');

function viewportContent(): string {
  const m = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
  expect(m, 'index.html must contain a viewport meta tag').toBeTruthy();
  const content = m![0].match(/content=["']([^"']*)["']/i);
  expect(content, 'viewport meta must have a content attribute').toBeTruthy();
  return content![1].toLowerCase().replace(/\s+/g, '');
}

describe('viewport disables page-level WebView zoom', () => {
  it('pins maximum-scale=1.0 to disable pinch zoom', () => {
    expect(viewportContent()).toContain('maximum-scale=1.0');
  });

  it('sets user-scalable=no to disable double-tap zoom', () => {
    expect(viewportContent()).toContain('user-scalable=no');
  });

  it('keeps width=device-width and viewport-fit=cover for the edge-to-edge contract', () => {
    const content = viewportContent();
    expect(content).toContain('width=device-width');
    expect(content).toContain('viewport-fit=cover');
  });
});
