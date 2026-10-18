/**
 * Source-level structural test: Food activity stats contains no notes or wildcards.
 *
 * Validates: Requirements 5.1, 5.2, Property 1
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

function extractInterfaceDeclaration(source: string, interfaceName: string): string {
  const regex = new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{([^}]+)\\}`, 's');
  const match = source.match(regex);
  if (!match || !match[1]) {
    throw new Error(`Could not find interface declaration for ${interfaceName}`);
  }
  return match[1];
}

describe('stats foodActivity - no-note guard (Property 1)', () => {
  // Feature: friend-food-ratings, Property 1: Notes and private fields never appear in any friend-facing payload
  it('Property 1: no SQL statement referencing food_item_logs in stats/repo.ts contains note or wildcards', () => {
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

  it('Property 1: FoodActivityStatistics and FoodPersonalRecords declarations in shared/src/dto/Stats.ts contain no note fields', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const statsDtoPath = resolve(here, '..', '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'dto', 'Stats.ts');
    const source = readFileSync(statsDtoPath, 'utf8');

    const foodActivityBlock = extractInterfaceDeclaration(source, 'FoodActivityStatistics');
    expect(foodActivityBlock).not.toMatch(/\bnote/i);

    const foodPersonalRecordsBlock = extractInterfaceDeclaration(source, 'FoodPersonalRecords');
    expect(foodPersonalRecordsBlock).not.toMatch(/\bnote/i);
  });
});
