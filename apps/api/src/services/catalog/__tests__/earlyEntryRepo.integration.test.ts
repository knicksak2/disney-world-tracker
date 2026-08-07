/**
 * Integration test (pg-mem) for the real SQL that persists per-ride Early Entry
 * participation (disney-facilities-catalog-source R5.8). Exercises
 * `updateEarlyEntryParticipation` against a real experiences table and reads the
 * rows back — a mock would not cover the keyed UPDATE.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo } from '../repo.js';

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
  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
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
  db.public.none(sql);
}

describe('updateEarlyEntryParticipation (integration, pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0025_experience_early_entry.sql');
    applyMigration(db, '0026_experience_special_hours.sql');
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
  });

  function seed(upstreamId: string, name: string): void {
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ('${randomUUID()}', '${upstreamId}', '${name}', 'Magic Kingdom', 'Ride')`,
    );
  }

  it('sets all three flags by upstream_entity_id and leaves unlisted rows unchanged', async () => {
    seed('80010190;entityType=Attraction', 'Space Mountain');
    seed('80010110;entityType=Attraction', 'Big Thunder');
    seed('99999999;entityType=Attraction', 'Never Captured');

    const repo = createCatalogRepo(pool);
    await repo.updateSpecialHoursParticipation([
      { upstreamEntityId: '80010190;entityType=Attraction', earlyEntry: true, extendedEvening: false, ticketedEvent: false },
      { upstreamEntityId: '80010110;entityType=Attraction', earlyEntry: false, extendedEvening: true, ticketedEvent: true },
      // An id not in our catalog is silently ignored.
      { upstreamEntityId: '00000000;entityType=Attraction', earlyEntry: true, extendedEvening: true, ticketedEvent: true },
    ]);

    const rows = db.public.many(
      `SELECT name,
              operates_during_early_entry AS ee,
              operates_during_extended_evening AS ext,
              operates_during_ticketed_event AS tick
         FROM experiences ORDER BY name`,
    ) as Array<{ name: string; ee: boolean | null; ext: boolean | null; tick: boolean | null }>;
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Space Mountain')).toMatchObject({ ee: true, ext: false, tick: false });
    expect(byName.get('Big Thunder')).toMatchObject({ ee: false, ext: true, tick: true });
    // Never listed → remains NULL (unknown) on every flag.
    expect(byName.get('Never Captured')).toMatchObject({ ee: null, ext: null, tick: null });
  });

  it('is a no-op for an empty list', async () => {
    seed('80010190;entityType=Attraction', 'Space Mountain');
    const repo = createCatalogRepo(pool);
    await expect(repo.updateSpecialHoursParticipation([])).resolves.toBeUndefined();
    const rows = db.public.many(`SELECT operates_during_early_entry AS ee FROM experiences`) as Array<{ ee: boolean | null }>;
    expect(rows[0]!.ee).toBeNull();
  });
});
