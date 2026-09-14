/**
 * Property tests for FestivalTagRepo.
 *
 * Validates: Requirements 2.3, 2.4, 3.5, 3.6 (Property 26)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import { FESTIVAL_SLUGS, type FestivalSlug } from '@dwt/shared';
import type { DbPool } from '../../../../db/pool.js';
import { createFestivalTagRepo } from '../repo.js';

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
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

const EXP_IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

const YEARS = [2025, 2026];

interface UpsertOperation {
  readonly entries: readonly {
    readonly experienceId: string;
    readonly year: number;
    readonly slug: FestivalSlug;
  }[];
  readonly force: boolean;
}

const opArbitrary: fc.Arbitrary<UpsertOperation> = fc.record({
  entries: fc
    .array(
      fc.record({
        experienceId: fc.constantFrom(...EXP_IDS),
        year: fc.constantFrom(...YEARS),
        slug: fc.constantFrom(...FESTIVAL_SLUGS),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  force: fc.boolean(),
});

describe('FestivalTagRepo property tests', () => {
  // Feature: festival-booth-tagging, Property 26: Tag Uniqueness Per Year
  it('Property 26: Tag Uniqueness Per Year across arbitrary upsert sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArbitrary, { minLength: 1, maxLength: 8 }),
        async (ops) => {
          const db = buildPgMemDatabase();
          const { Pool: PgMemPool } = db.adapters.createPg();
          const pool = new PgMemPool() as unknown as DbPool;

          applyMigration(db, '0001_init.sql');
          applyMigration(db, '0008_experience_facet_enrichment.sql');
          applyMigration(db, '0039_experience_festival_tags.sql');

          for (const id of EXP_IDS) {
            await pool.query(
              `INSERT INTO experiences (id, name, category, park, active, grouped_facets, upstream_entity_id)
               VALUES ($1, $2, 'Restaurant', 'EPCOT', TRUE, '{}', $3)`,
              [id, `Experience ${id}`, `entity-${id}`],
            );
          }

          const repo = createFestivalTagRepo(pool);

          // In-memory model tracking expected state
          const expectedModel = new Map<string, { slug: FestivalSlug }>();

          for (const op of ops) {
            const written = await repo.upsertTags(op.entries, { force: op.force });

            // Trace each unique entry in op.entries (deduped by (experienceId, year))
            const dedupedEntries = new Map<string, { experienceId: string; year: number; slug: FestivalSlug }>();
            for (const entry of op.entries) {
              dedupedEntries.set(`${entry.experienceId}:${entry.year}`, entry);
            }

            const expectedWritten: string[] = [];
            for (const [key, entry] of dedupedEntries.entries()) {
              const current = expectedModel.get(key);
              if (!current) {
                // New tag inserted
                expectedModel.set(key, { slug: entry.slug });
                expectedWritten.push(entry.experienceId);
              } else if (current.slug === entry.slug) {
                // Same slug: updated / no-op, written
                expectedWritten.push(entry.experienceId);
              } else if (op.force) {
                // Conflicting slug with force: true -> updated
                expectedModel.set(key, { slug: entry.slug });
                expectedWritten.push(entry.experienceId);
              }
              // Else: conflicting slug with force: false -> excluded, not written
            }

            expect(written.sort()).toEqual(expectedWritten.sort());
          }

          // Assert database state matches model
          const dbRows = await pool.query<{
            experience_id: string;
            festival_year: number;
            festival_slug: string;
          }>(
            `SELECT experience_id, festival_year, festival_slug FROM experience_festival_tags`,
          );

          // 1. Invariant: At most one row per (experience_id, festival_year)
          const seenKeys = new Set<string>();
          for (const row of dbRows.rows) {
            const key = `${row.experience_id}:${row.festival_year}`;
            expect(seenKeys.has(key)).toBe(false);
            seenKeys.add(key);
          }

          // 2. Invariant: Exact count matches expected model
          expect(dbRows.rows.length).toBe(expectedModel.size);

          // 3. Invariant: Slug matches expected model for every key
          for (const row of dbRows.rows) {
            const key = `${row.experience_id}:${row.festival_year}`;
            expect(row.festival_slug).toBe(expectedModel.get(key)?.slug);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
