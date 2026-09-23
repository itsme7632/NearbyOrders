// Owner-form horizontal-overflow regression test.
//
// Root cause (2026-09-23, proven with a real Chromium layout pass at a
// 360px phone viewport): the Business Verification page rendered
// shifted/cropped on a Xiaomi device (NearbyOrders wordmark, Back link,
// and "Business Verification" title partially cut off). The actual
// overflowing element was `input.image-input-hidden` — the visually-hidden
// file input inside ImageUploader. Its own rule sets width: 1px, but owner
// forms render the uploader inside a `.field` label, and
// `.field input { width: 100%; ... }` has HIGHER specificity (0,1,1 vs
// 0,1,0), so the "1px" input became an absolutely-positioned 100%-wide
// box. With no positioned ancestor its containing block is the viewport,
// and its static position sits ~31px in from the left edge — pushing
// document.scrollWidth to 391px on a 360px viewport. The WebView then pans
// the whole page sideways (e.g. when the keyboard opens), cropping the
// left-side chrome.
//
// Fix: a higher-specificity `.field input.image-input-hidden` rule keeps
// the input a true 1px box. These tests parse styles.css and pin the
// mechanism, plus the companion bottom-nav clearance fix (the v6 `main`
// padding override had dropped the systematic bottom safe-area inset, so
// the floating business nav covered the last form controls on devices
// with a gesture bar).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'styles.css');
const rawCss = readFileSync(cssPath, 'utf8');
// Strip /* ... */ comments so prose can't produce false matches.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declaration block for a flat rule with the exact selector. */
function ruleBlock(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\r\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const m = re.exec(css);
  return m ? m[1] : null;
}

/** Last value of a declaration property inside a block, if present. */
function decl(block: string, prop: string): string | null {
  const matches = [...block.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+);`, 'g'))];
  return matches.length > 0 ? matches[matches.length - 1][1].trim() : null;
}

/** Offset of the first flat rule with the exact selector in the file. */
function ruleOffset(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\r\\n])\\s*${escaped}\\s*\\{`).exec(css);
  return m ? (m.index ?? -1) : -1;
}

/** All flat `main { ... }` declaration blocks (also matches inside @media). */
function mainBlocks(): string[] {
  const blocks: string[] = [];
  const re = /(?:^|[\r\n])\s*main\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) blocks.push(m[1]);
  return blocks;
}

/** Bottom component of a `padding` shorthand (last space-separated value at paren depth 0). */
function paddingBottom(shorthand: string): string {
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of shorthand) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts[parts.length - 1] ?? '';
}

describe('owner form horizontal overflow (Xiaomi shifted-page regression)', () => {
  it('defines the visually-hidden file input base rule', () => {
    expect(ruleBlock('.image-input-hidden')).not.toBeNull();
  });

  it('.field input still stretches plain inputs full width (the conflicting rule)', () => {
    const block = ruleBlock('.field input, .field textarea');
    expect(block).not.toBeNull();
    expect(decl(block!, 'width')).toBe('100%');
  });

  it('pins the higher-specificity guard that keeps the hidden input a 1px box', () => {
    const block = ruleBlock('.field input.image-input-hidden');
    expect(block).not.toBeNull();
    // The guard must neutralize every box property .field input sets, or
    // the absolutely-positioned input still escapes the viewport.
    expect(decl(block!, 'width')).toBe('1px');
    expect(decl(block!, 'height')).toBe('1px');
    expect(decl(block!, 'min-height')).toBe('0');
    expect(decl(block!, 'padding')).toBe('0');
    expect(decl(block!, 'border')).toBe('0');
  });

  it('the guard wins over .field input regardless of source order', () => {
    // (0,2,1) beats (0,1,1) on specificity alone; the order assertion pins
    // the intent that this rule is the deliberate override, not an accident.
    const guardAt = ruleOffset('.field input.image-input-hidden');
    const baseAt = ruleOffset('.field input, .field textarea');
    expect(guardAt).toBeGreaterThan(-1);
    expect(baseAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(baseAt);
  });

  it('does not paper over the overflow with overflow-x:hidden on the page', () => {
    // The fix must constrain the actual element, never clip the page.
    for (const selector of ['.owner-verification', 'main']) {
      const block = ruleBlock(selector);
      if (block === null) continue;
      expect(decl(block, 'overflow-x')).not.toBe('hidden');
      expect(decl(block, 'overflow')).not.toBe('hidden');
    }
  });
});

describe('owner form bottom-nav clearance (safe-area bottom inset regression)', () => {
  it('every main padding shorthand preserves the bottom safe-area inset', () => {
    const blocks = mainBlocks().filter((b) => decl(b, 'padding') !== null);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      const bottom = paddingBottom(decl(block, 'padding')!);
      // A flat bottom value (e.g. `88px`) is the exact defect that let the
      // floating business nav (8px + inset + ~62px tall) cover the final
      // form controls on devices with a gesture bar.
      expect(bottom).toContain('--safe-area-inset-bottom');
    }
  });

  it('the winning main rule keeps the v6 content density (no arbitrary huge padding)', () => {
    const blocks = mainBlocks().filter((b) => decl(b, 'padding') !== null);
    const last = decl(blocks[blocks.length - 1], 'padding')!;
    const bottom = paddingBottom(last);
    expect(bottom).toContain('88px');
  });
});
