/**
 * Structural negative test for Friend Food Ratings: no background work,
 * no persistence, and no write operations (Task 7.3).
 *
 * Validates: Requirements 19.1, 19.2, 19.3, Property 15
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function getServiceSourceFiles(serviceDir: string): string[] {
  const entries = readdirSync(serviceDir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === '__tests__') continue;
    const fullPath = join(serviceDir, entry);
    if (statSync(fullPath).isFile() && entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('friendFoodRatings.noBackgroundWork — Property 15', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serviceDir = resolve(here, '..');
  const serviceFiles = getServiceSourceFiles(serviceDir);

  // Feature: friend-food-ratings, Property 15: Reads are bounded, read-only and issue a fixed number of queries
  it('Property 15: no background worker, queue, timer, or notification imports/calls', () => {
    expect(serviceFiles.length).toBeGreaterThan(0);

    const forbiddenImports = [
      /\bfrom\s+['"]bullmq['"]/i,
      /\bfrom\s+['"]ioredis['"]/i,
      /\bfrom\s+['"]redis['"]/i,
      /\bfrom\s+['"]node-cron['"]/i,
      /\bpushNotification\b/i,
      /\bexpo-server-sdk\b/i,
      /\bweb-push\b/i,
    ];

    const forbiddenCalls = [
      /\bsetInterval\s*\(/,
      /\bsetTimeout\s*\(/,
      /\bschedule\s*\(/,
    ];

    for (const filePath of serviceFiles) {
      const source = readFileSync(filePath, 'utf8');

      for (const pattern of forbiddenImports) {
        expect(source).not.toMatch(pattern);
      }

      for (const pattern of forbiddenCalls) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  // Feature: friend-food-ratings, Property 15: Reads are bounded, read-only and issue a fixed number of queries
  it('Property 15: service is strictly read-only with no write/DDL SQL keywords in any template literal', () => {
    for (const filePath of serviceFiles) {
      const source = readFileSync(filePath, 'utf8');
      const templateLiterals = source.match(/`([^`]+)`/gs) ?? [];

      for (const sql of templateLiterals) {
        expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
        expect(sql).not.toMatch(/\bUPDATE\s+[a-z_]/i);
        expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
        expect(sql).not.toMatch(/\bCREATE\s+(TABLE|INDEX|VIEW)\b/i);
        expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
      }
    }
  });

  // Feature: friend-food-ratings, Property 15: Reads are bounded, read-only and issue a fixed number of queries
  it('Property 15: composeServices.ts supplies only repo, pool, and sessionMiddleware (no queue or Redis client)', () => {
    const srcDir = resolve(serviceDir, '..', '..');
    const composePath = resolve(srcDir, 'composeServices.ts');
    const composeSource = readFileSync(composePath, 'utf8');

    // Extract friendFoodRatings service block
    const match = composeSource.match(/friendFoodRatings:\s*\{([^}]+)\}/s);
    expect(match).not.toBeNull();
    const block = match![1]!;

    // Check that keys present in the block are only repo, pool, requireSession
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));

    for (const line of lines) {
      expect(line).toMatch(/^(repo|pool|requireSession)(:|,|\s*$)/);
    }

    expect(block).not.toContain('queue');
    expect(block).not.toContain('redis');
    expect(block).not.toContain('cron');
  });
});
