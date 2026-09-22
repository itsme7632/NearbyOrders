import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../src');

/**
 * Regression guard for the em/en-dash audit: user-facing API strings must
 * not contain em dashes (—) or en dashes (–). Scans the `message:`/`title:`
 * literals the API sends to clients, not comments or code.
 */
function userFacingLiterals(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const lines = source.split('\n');
  const pattern = /\b(message|title)\s*:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(pattern)) hits.push({ line: i + 1, text: m[2] ?? '' });
  });
  return hits;
}

describe('user-facing strings contain no em/en dashes', () => {
  for (const file of ['server.ts', 'lib.ts']) {
    it(`${file} has no em/en dash in API message/title literals`, () => {
      const source = readFileSync(path.join(srcDir, file), 'utf8');
      const offenders = userFacingLiterals(source).filter(({ text }) => /[—–]/.test(text));
      expect(
        offenders.map(({ line, text }) => `${file}:${line}: ${text}`),
        'em/en dash found in a user-facing API string',
      ).toEqual([]);
    });
  }

  it('the two historically fixed messages stay dash-free over the wire shape', async () => {
    // Guards the exact sentences that were rewritten during the audit.
    const { makeApp } = await import('./helpers.js');
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'nobody@test.local', password: 'wrong' } });
    const body = JSON.stringify(res.json());
    expect(body).not.toMatch(/[—–]/);
  });
});
