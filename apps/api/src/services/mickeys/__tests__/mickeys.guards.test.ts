/**
 * Source guards test for Hidden Mickeys service (Task 5.1).
 *
 * Asserts provider names and secrets live strictly inside adapters/.
 * Modeled on photos.guards.test.ts.
 *
 * Validates: Requirements 6.3, 6.4
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MICKEYS_DIR = resolve(__dirname, '..');

function collectFiles(dir: string, filter: (path: string) => boolean): string[] {
  const results: string[] = [];
  function walk(current: string) {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (filter(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

describe('Hidden Mickeys Source Guards (Task 5.1)', () => {
  it('provider URLs and provider names live strictly inside adapters/', () => {
    // Scan all .ts files under services/mickeys EXCLUDING adapters/ and __tests__/
    const files = collectFiles(
      MICKEYS_DIR,
      (p) =>
        p.endsWith('.ts') &&
        !p.includes('__tests__') &&
        !p.includes(`${join('mickeys', 'adapters')}`),
    );

    const forbiddenPatterns = [
      /api\.openai\.com/i,
      /\bopenai\b/i,
      /Bearer\s+sk-/i,
    ];

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`${file} matches forbidden pattern ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
