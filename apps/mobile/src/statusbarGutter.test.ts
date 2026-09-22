// Status-bar scroll-clipping regression test.
//
// Root cause (2026-09-22, proven on a Xiaomi device screenshot): the app
// scrolls the DOCUMENT inside an edge-to-edge WebView with a transparent
// Android status bar. The --sat top padding on `main` only offsets content
// at rest — it is not a clipping boundary. When the user scrolled the
// "List my business" page, in-flow content (the "‹ Back" link, headers,
// cards) slid underneath the status bar and rendered behind the system
// icons.
//
// Fix: a fixed, opaque `.statusbar-gutter` rendered once at the app root
// covers exactly the status-bar region (0..--sat) with the app background,
// turning the inset into a real protected/non-content clipping boundary.
// Sticky chrome (.tab-strip, .explore-top) sticks below it at
// top: var(--sat) instead of top: 0.
//
// These tests parse styles.css and main.tsx and pin the mechanism so no
// future change can reintroduce scroll-underlap: the gutter must stay
// fixed, exactly --sat tall, opaque, non-interactive, layered between
// sticky chrome and overlays, and no sticky rule may anchor at top: 0.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const rawCss = readFileSync(join(dir, 'styles.css'), 'utf8');
// Strip /* ... */ comments so prose can't produce false matches.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const mainTsx = readFileSync(join(dir, 'main.tsx'), 'utf8');

/** Declaration block for a flat `.class { ... }` rule. */
function classBlock(selector: string): string | null {
  const re = new RegExp(`(?:^|[\\r\\n])\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'g');
  const m = re.exec(css);
  return m ? m[1] : null;
}

/** Last value of a declaration property inside a block, if present. */
function decl(block: string, prop: string): string | null {
  const matches = [...block.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+);`, 'g'))];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

/** All flat `position: sticky` declaration blocks with their selectors. */
function stickyBlocks(): { selector: string; block: string }[] {
  const out: { selector: string; block: string }[] = [];
  const re = /(?:^|[\r\n])\s*([^{]+?)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    if (/(?:^|;)\s*position\s*:\s*sticky\s*;/.test(m[2])) out.push({ selector: m[1].trim(), block: m[2] });
  }
  return out;
}

describe('status-bar scroll clipping (Xiaomi scroll-underlap regression)', () => {
  it('defines the .statusbar-gutter clipping boundary', () => {
    expect(classBlock('.statusbar-gutter')).not.toBeNull();
  });

  it('the gutter is fixed to the viewport and spans the full width', () => {
    const block = classBlock('.statusbar-gutter')!;
    expect(decl(block, 'position')).toBe('fixed');
    expect(decl(block, 'top')).toBe('0');
    expect(decl(block, 'left')).toBe('0');
    expect(decl(block, 'right')).toBe('0');
  });

  it('the gutter is exactly the system inset tall, never a hardcoded pixel value', () => {
    const block = classBlock('.statusbar-gutter')!;
    const height = decl(block, 'height');
    expect(height).toBe('var(--sat)');
    // A hardcoded height (e.g. `height: 30px`) would break on devices with a
    // different status-bar height and is explicitly forbidden.
    expect(height).not.toMatch(/\d+px/);
  });

  it('the gutter is opaque and non-interactive', () => {
    const block = classBlock('.statusbar-gutter')!;
    const background = decl(block, 'background');
    expect(background).not.toBeNull();
    expect(background).not.toMatch(/transparent/);
    expect(decl(block, 'pointer-events')).toBe('none');
  });

  it('the gutter layers above sticky chrome but below overlays', () => {
    const block = classBlock('.statusbar-gutter')!;
    const z = Number(decl(block, 'z-index'));
    expect(Number.isFinite(z)).toBe(true);
    // Sticky in-flow chrome (.tab-strip/.explore-top) sits at z-index 5 and
    // must slide UNDER the gutter; sheet backdrop (60), toasts (80) and the
    // skip link (200) must still paint over it.
    expect(z).toBeGreaterThan(5);
    expect(z).toBeLessThan(60);
  });

  it('no sticky rule anchors at top: 0 (would slide under the gutter)', () => {
    const stickies = stickyBlocks();
    expect(stickies.length).toBeGreaterThan(0);
    for (const { selector, block } of stickies) {
      const top = decl(block, 'top');
      expect(
        top,
        `sticky "${selector}" must clear the protected status-bar region (top: var(--sat)), not top: 0`,
      ).not.toBe('0');
    }
  });

  it('sticky chrome sticks below the protected region', () => {
    for (const selector of ['.tab-strip', '.explore-top']) {
      const block = classBlock(selector);
      expect(block, `${selector} rule must exist`).not.toBeNull();
      expect(decl(block!, 'top')).toBe('var(--sat)');
    }
  });

  it('main.tsx renders the gutter once at the app root', () => {
    const matches = mainTsx.match(/<div className="statusbar-gutter"/g) ?? [];
    // Exactly one render — a second copy would be dead weight and a missing
    // one would drop the clipping boundary entirely.
    expect(matches.length).toBe(1);
  });
});
