/**
 * Property tests for User_Submitted_Location repository (Feature: food-item-logging).
 *
 * Validates:
 *   - Property 8: Location Exact-Match Dedup and Advisory Similarity Suggestion (R6.2, R6.3, R6.4)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { PARKS, type Park } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  createUserSubmittedLocationRepo,
  type UserSubmittedLocationRepo,
} from '../locations.js';

function getTrigrams(str: string): Map<string, number> {
  const padded = `  ${str} `;
  const counts = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const tri = padded.slice(i, i + 3);
    counts.set(tri, (counts.get(tri) ?? 0) + 1);
  }
  return counts;
}

function trigramSimilarity(a: unknown, b: unknown): number {
  if (typeof a !== 'string' || typeof b !== 'string') return 0;
  const triA = getTrigrams(a.toLowerCase());
  const triB = getTrigrams(b.toLowerCase());
  let matches = 0;
  for (const [tri, countA] of triA.entries()) {
    const countB = triB.get(tri) ?? 0;
    matches += Math.min(countA, countB);
  }
  const total =
    Array.from(triA.values()).reduce((sum, c) => sum + c, 0) +
    Array.from(triB.values()).reduce((sum, c) => sum + c, 0);
  return total === 0 ? 0 : (2 * matches) / total;
}

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();
  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  db.public.registerFunction({
    name: 'similarity',
    args: [DataType.text, DataType.text],
    returns: DataType.float,
    implementation: trigramSimilarity,
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const parkArb = fc.constantFrom(...PARKS);
const locationNameArb = fc
  .stringMatching(/^[A-Za-z0-9 ]{3,25}$/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 3);

describe('UserSubmittedLocationRepo Property Tests', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let locRepo: UserSubmittedLocationRepo;
  let userId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');

    locRepo = createUserSubmittedLocationRepo(pool);

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'cartfan@example.com', 'hash')`,
      [userId],
    );
  });

  // Feature: food-item-logging, Property 8: Location Exact-Match Dedup and Advisory Similarity Suggestion
  it('Property 8: Exact case-insensitive match in same park rejects with location_duplicate; advisory suggestions never block creation and are ranked by similarity', async () => {
    await fc.assert(
      fc.asyncProperty(
        locationNameArb,
        parkArb,
        async (baseName, park) => {
          // Fresh unique location name prefix to guarantee clean namespace per iteration
          const prefix = randomUUID().slice(0, 8);
          const name1 = `${baseName} ${prefix}`;

          // 1. Create first location
          const created1 = await locRepo.createLocation(userId, name1, park);
          expect(created1.name).toBe(name1);
          expect(created1.park).toBe(park);

          // 2. Exact-match in same park fails (case variation & extra spaces)
          const duplicates = [
            name1.toUpperCase(),
            name1.toLowerCase(),
            `  ${name1}  `,
          ];

          for (const dup of duplicates) {
            try {
              await locRepo.createLocation(userId, dup, park);
              expect.unreachable('Should have rejected exact-match duplicate');
            } catch (err) {
              expect(err).toBeInstanceOf(AppError);
              const appErr = err as AppError;
              expect(appErr.code).toBe('location_duplicate');
              expect(appErr.details?.['existingId']).toBe(created1.id);
            }
          }

          // 3. Same name in a DIFFERENT park succeeds
          const otherPark: Park = park === 'Magic Kingdom' ? 'EPCOT' : 'Magic Kingdom';
          const otherParkLoc = await locRepo.createLocation(userId, name1, otherPark);
          expect(otherParkLoc.id).not.toBe(created1.id);
          expect(otherParkLoc.park).toBe(otherPark);

          // 4. Create a near-miss location (e.g. slight suffix)
          const name2 = `${name1} Cart`;
          // Advisory suggestions query before creation
          const suggestions = await locRepo.suggestLocations(park, name2);

          // If any candidates returned, assert relative ranking order (sim DESC)
          if (suggestions.length >= 2) {
            for (let i = 0; i < suggestions.length - 1; i++) {
              expect(suggestions[i]!.similarity).toBeGreaterThanOrEqual(
                suggestions[i + 1]!.similarity,
              );
            }
          }

          // 5. Creation succeeds regardless of suggestions returned (never blocked)
          const created2 = await locRepo.createLocation(userId, name2, park);
          expect(created2.id).toBeDefined();
          expect(created2.name).toBe(name2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
