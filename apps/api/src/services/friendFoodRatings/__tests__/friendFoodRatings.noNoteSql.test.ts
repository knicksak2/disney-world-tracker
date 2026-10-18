/**
 * Source-level structural test guarding against note leakage in SQL statements.
 *
 * Asserts that no SQL template in friendFoodRatings/repo.ts referencing
 * `food_item_logs` contains the identifier `note` or any wildcard (`fil.*`,
 * `food_item_logs.*`, `SELECT *`, `RETURNING *`) that could leak notes.
 *
 * Validates: Requirements 5.1, 5.2
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function extractFoodLogStatements(source: string): string[] {
  // Extract all backtick template literal strings from the source file
  const templateLiterals = source.match(/`([^`]+)`/gs) ?? [];
  return templateLiterals
    .map((s) => s.slice(1, -1))
    .filter((sql) => /\bfood_item_logs\b/i.test(sql));
}

describe('friendFoodRatings repo - no-note SQL guard', () => {
  // Feature: friend-food-ratings, Property 1: Notes and private fields never appear in any friend-facing payload
  it('Property 1: no SQL statement referencing food_item_logs contains note or wildcards', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoPath = resolve(here, '..', 'repo.ts');
    const source = readFileSync(repoPath, 'utf8');

    const statements = extractFoodLogStatements(source);
    expect(statements.length).toBeGreaterThan(0);

    for (const sql of statements) {
      // 1. Must not contain the identifier `note` (case-insensitive word boundary)
      expect(sql).not.toMatch(/\bnote\b/i);

      // 2. Must not match fil.*
      expect(sql).not.toMatch(/fil\.\*/);

      // 3. Must not match food_item_logs.*
      expect(sql).not.toMatch(/food_item_logs\.\*/);

      // 4. Must not match bare SELECT *
      expect(sql).not.toMatch(/\bSELECT\s+\*/i);

      // 5. Must not match bare RETURNING *
      expect(sql).not.toMatch(/\bRETURNING\s+\*/i);
    }
  });
});
