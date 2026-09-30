// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NearbyOrdersMark } from './components/icons.js';

describe('NearbyOrdersMark', () => {
  it('renders the frozen N+O geometry as vector paths', () => {
    const { container } = render(<NearbyOrdersMark size={30} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 120 120');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);
    // 2 stroked N sub-paths, O ring, 4 weld slivers.
    expect(paths).toHaveLength(7);
    expect(paths[0].getAttribute('d')).toBe('M29 90 L29 30 L52.17 52.42');
    expect(paths[1].getAttribute('d')).toBe('M67.83 67.58 L91 90 L91 30');
    expect(paths[2].getAttribute('d')).toBe(
      'M50 60 A10 10 0 1 1 70 60 A10 10 0 1 1 50 60 Z',
    );
    // Light tone: slate N, ember O/tie.
    expect(paths[0].getAttribute('stroke')).toBe('#16222E');
    expect(paths[0].getAttribute('stroke-width')).toBe('14');
    expect(paths[0].getAttribute('fill')).toBe('none');
    expect(paths[1].getAttribute('stroke')).toBe('#16222E');
    expect(paths[2].getAttribute('stroke')).toBe('#E23A2E');
    expect(paths[2].getAttribute('stroke-width')).toBe('6');
    for (const p of paths.slice(3)) {
      expect(p.getAttribute('fill')).toBe('#E23A2E');
    }
  });

  it('dark tone swaps the N to porcelain without touching geometry', () => {
    const { container } = render(<NearbyOrdersMark size={30} tone="dark" />);
    const paths = Array.from(container.querySelector('svg')?.querySelectorAll('path') ?? []);
    expect(paths[0].getAttribute('stroke')).toBe('#F2F5F7');
    expect(paths[1].getAttribute('stroke')).toBe('#F2F5F7');
    expect(paths[2].getAttribute('stroke')).toBe('#E23A2E');
    expect(paths[0].getAttribute('d')).toBe('M29 90 L29 30 L52.17 52.42');
  });

  it('is exposed to assistive tech as the NearbyOrders brand', () => {
    const { container } = render(<NearbyOrdersMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('NearbyOrders');
  });
});
