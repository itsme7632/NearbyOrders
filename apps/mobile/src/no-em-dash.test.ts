// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Built from char codes so this file's own source never contains the
// characters it scans for.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DASHES = EM_DASH + EN_DASH;
const hasDash = (s: string): boolean => s.includes(EM_DASH) || s.includes(EN_DASH);

type Chunk = { kind: 'string' | 'code'; value: string };

/**
 * Crude tokenizer: splits source into string-literal chunks and everything
 * else, skipping line/block comments (comments are never user-facing, so
 * they are not scanned). Handles escaped quotes inside literals.
 *
 * A single or double quote only opens a literal when the previous character
 * is not a word character: this keeps apostrophes inside JSX text
 * ("don't", "people's") from desynchronising the scan. Backticks always
 * open a template literal (the codebase uses no tagged templates).
 */
function tokenize(src: string): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  let codeBuf = '';
  const flushCode = () => {
    if (codeBuf) {
      out.push({ kind: 'code', value: codeBuf });
      codeBuf = '';
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      i = j === -1 ? src.length : j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      i = j === -1 ? src.length : j + 2;
      continue;
    }
    const prev = i === 0 ? '' : src[i - 1];
    const opensLiteral =
      c === '`' || ((c === "'" || c === '"') && !/[\w$]/.test(prev));
    if (opensLiteral) {
      flushCode();
      const q = c;
      let j = i + 1;
      let v = '';
      while (j < src.length && src[j] !== q) {
        if (src[j] === '\\') {
          v += src[j] + (src[j + 1] ?? '');
          j += 2;
        } else {
          v += src[j];
          j += 1;
        }
      }
      i = j + 1;
      out.push({ kind: 'string', value: v });
      continue;
    }
    codeBuf += c;
    i += 1;
  }
  flushCode();
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Technical/typographic uses that are NOT prose and stay untouched:
 * - a lone missing-value glyph (the conventional empty cell),
 * - numeric ranges (1-100 style, incl. percentages),
 * - clock-time ranges (9:00 AM - 5:00 PM style),
 * - a dash joining two JSX/template interpolations (`{a} - {b}`), which is
 *   how time ranges render between formatted values.
 */
function isTechnical(text: string): boolean {
  const t = text.trim();
  if (t === EM_DASH || t === EN_DASH) return true;
  const digitRange = new RegExp('\\d\\s*[' + DASHES + ']\\s*\\d');
  if (digitRange.test(text)) return true;
  if (/\d:\d/.test(text) && hasDash(text)) return true;
  const acrossInterpolation = new RegExp('[$\\]\\}]\\s*[' + DASHES + ']|[' + DASHES + ']\\s*[$\\[{]');
  if (acrossInterpolation.test(text)) return true;
  return false;
}

/**
 * JSX text nodes. Code chunks are joined before tags are stripped because
 * string extraction can split a tag across chunk boundaries
 * (`<p className=` + `"hint"` + ` style=...>`).
 */
function jsxTextSegments(codeChunks: string[]): string[] {
  return codeChunks
    .join('')
    .split(/<[^>]*>/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe('no em dashes or en dashes in user-facing strings', () => {
  it('scans every string literal and JSX text node in apps/mobile/src', () => {
    const root = new URL('.', import.meta.url).pathname;
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, 'utf8');
      const short = file.slice(root.length);
      const chunks = tokenize(src);
      for (const chunk of chunks) {
        if (chunk.kind === 'string') {
          if (hasDash(chunk.value) && !isTechnical(chunk.value)) {
            offenders.push(`${short}: string literal ${JSON.stringify(chunk.value.slice(0, 80))}`);
          }
        }
      }
      if (file.endsWith('.tsx')) {
        for (const seg of jsxTextSegments(chunks.filter((c) => c.kind === 'code').map((c) => c.value))) {
          if (hasDash(seg) && !isTechnical(seg)) {
            offenders.push(`${short}: JSX text ${JSON.stringify(seg.slice(0, 80))}`);
          }
        }
      } else {
        const code = chunks
          .filter((c) => c.kind === 'code')
          .map((c) => c.value)
          .join('');
        if (hasDash(code) && !isTechnical(code)) {
          // Plain .ts code outside strings/comments cannot legally contain
          // these characters — flag it so a tokenizer gap gets noticed.
          offenders.push(`${short}: code text ${JSON.stringify(code.slice(0, 80))}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('documents the technical-range allowlist with examples', () => {
    // These shapes must keep passing: they are typographic, not prose.
    expect(isTechnical(EM_DASH)).toBe(true);
    expect(isTechnical('1' + EN_DASH + '100%')).toBe(true);
    expect(isTechnical('9:00 AM ' + EN_DASH + ' 5:00 PM')).toBe(true);
    expect(isTechnical('{start} ' + EN_DASH + ' {end}')).toBe(true);
    // Prose dashes must NOT be allowlisted.
    expect(isTechnical('All caught up ' + EM_DASH + ' nothing to do')).toBe(false);
    expect(isTechnical('Pay by hand ' + EM_DASH + ' verified')).toBe(false);
  });
});
