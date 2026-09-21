// Root-inset cascade regression test.
//
// Root cause (2026-09-22, proven on a Xiaomi device screenshot): the
// systematic top inset lived on the base `main` rule as
// `padding: calc(16px + var(--sat)) ...`, but a LATER rule with equal
// specificity — the v6 "tighter page rhythm" layer,
// `main { padding: 12px clamp(14px, 4vw, 20px) 88px; }` — won the cascade
// and silently replaced the top inset with a flat 12px. The Android status
// bar then covered the app header on every screen, even though the
// --sat token, statusBar.ts measurement, and viewport-fit=cover were all
// correct.
//
// This test parses styles.css and asserts that EVERY `main` padding rule in
// the file preserves var(--sat) in its top component, so no future layer
// can reintroduce the overlap by overriding the padding.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'styles.css');
const rawCss = readFileSync(cssPath, 'utf8');
// Strip /* ... */ comments so prose mentioning `main { ... }` can't match.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** All flat `main { ... }` declaration blocks (also matches inside @media). */
function mainBlocks(): string[] {
  const blocks: string[] = [];
  const re = /(?:^|[\r\n])\s*main\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) blocks.push(m[1]);
  return blocks;
}

/** Value of the last `padding` shorthand declaration in a block, if any. */
function paddingShorthand(block: string): string | null {
  const matches = [...block.matchAll(/(?:^|;)\s*padding\s*:\s*([^;]+);/g)];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

/** Value of the last `padding-top` longhand declaration in a block, if any. */
function paddingTop(block: string): string | null {
  const matches = [...block.matchAll(/(?:^|;)\s*padding-top\s*:\s*([^;]+);/g)];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

describe('root inset cascade (Android status-bar overlap regression)', () => {
  it('finds the main padding rules under test', () => {
    const blocks = mainBlocks().filter((b) => paddingShorthand(b) !== null);
    // Base shell rule + v6 tighter-rhythm override + wide-viewport override.
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it('every main padding shorthand preserves var(--sat) for the top inset', () => {
    for (const block of mainBlocks()) {
      const shorthand = paddingShorthand(block);
      if (shorthand === null) continue;
      // The shorthand resets padding-top, so its top component must carry
      // the systematic inset token. A flat first value (e.g. `12px`) is the
      // exact defect that let the status bar cover the header.
      expect(
        shorthand,
        `main padding shorthand must preserve the top inset: "${shorthand}"`,
      ).toContain('var(--sat)');
    }
  });

  it('any main padding-top longhand preserves var(--sat)', () => {
    for (const block of mainBlocks()) {
      const top = paddingTop(block);
      if (top === null) continue;
      expect(top, `main padding-top must preserve the top inset: "${top}"`).toContain('var(--sat)');
    }
  });

  it(':root still defines the --sat token from the native measurement', () => {
    expect(css).toMatch(/--sat\s*:/);
    expect(css).toMatch(/--sat\s*:[^;]*var\(--native-statusbar-height/);
  });
});
