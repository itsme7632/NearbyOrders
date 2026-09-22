import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Em/en dash audit: no user-facing string in the admin panel may contain
 * — (U+2014) or – (U+2013). The scanner inspects string literals and JSX
 * text nodes only, so dashes used by code (comments, operators, CSS) are
 * never flagged.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const DASH = /[—–]/;
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
}

function auditFile(name: string): string[] {
  const src = readFileSync(join(srcDir, name), 'utf8');
  const problems: string[] = [];

  // 1. String literals: extract first, then scrub them from the code copy so
  //    comment stripping cannot misread `//` inside a URL or similar.
  const literals: string[] = [];
  const scrubbed = src.replace(LITERAL, (m) => {
    literals.push(m);
    return '""';
  });
  for (const lit of literals) {
    if (DASH.test(lit)) problems.push(`string literal ${lit.slice(0, 60)}`);
  }

  // 2. JSX text nodes: visible copy between tags, after comments are gone.
  const noComments = stripComments(scrubbed);
  for (const m of noComments.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1].trim();
    if (text && DASH.test(text)) problems.push(`JSX text "${text.slice(0, 60)}"`);
  }
  return problems.map((p) => `${name}: ${p}`);
}

describe('admin copy: em/en dash audit', () => {
  it('finds no em or en dashes in user-facing strings', () => {
    const files = readdirSync(srcDir).filter((f) => /\.(tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap(auditFile);
    expect(problems).toEqual([]);
  });

  it('does not flag code punctuation that merely looks similar', () => {
    // Sanity: the scanner itself tolerates hyphen-minus and the minus
    // operator, which are always allowed.
    expect(DASH.test('price - discount')).toBe(false);
    expect(DASH.test('a-b')).toBe(false);
  });
});
