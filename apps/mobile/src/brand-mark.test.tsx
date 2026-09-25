// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MeridianMark } from './components/icons.js';

describe('MeridianMark', () => {
  it('renders the locked N geometry as vector paths', () => {
    const { container } = render(<MeridianMark size={30} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1000 1000');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);
    expect(paths).toHaveLength(3);
    // Left stem, ember diagonal, right stem — draw order preserved.
    expect(paths[0].getAttribute('d')).toBe('M220,80 h69.7 v620.5 h-69.7 Z');
    expect(paths[1].getAttribute('d')).toBe('M220,80 L385.3,80 L711.6,623.8 L612.6,920.1 Z');
    expect(paths[2].getAttribute('d')).toBe('M701.1,80 L779.9,80 L779.9,550.6 L701.1,613.3 Z');
    // Light tone: slate stems, ember diagonal.
    expect(paths[0].getAttribute('fill')).toBe('#16222E');
    expect(paths[1].getAttribute('fill')).toBe('#E23A2E');
    expect(paths[2].getAttribute('fill')).toBe('#16222E');
  });

  it('dark tone swaps stems to porcelain without touching geometry', () => {
    const { container } = render(<MeridianMark size={30} tone="dark" />);
    const paths = Array.from(container.querySelector('svg')?.querySelectorAll('path') ?? []);
    expect(paths[0].getAttribute('fill')).toBe('#F2F5F7');
    expect(paths[1].getAttribute('fill')).toBe('#E23A2E');
    expect(paths[2].getAttribute('fill')).toBe('#F2F5F7');
    expect(paths[1].getAttribute('d')).toBe('M220,80 L385.3,80 L711.6,623.8 L612.6,920.1 Z');
  });

  it('is exposed to assistive tech as the NearbyOrders brand', () => {
    const { container } = render(<MeridianMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('NearbyOrders');
  });
});
