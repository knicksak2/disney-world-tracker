/**
 * Tests for FoodLogTarget adapter using pg-mem.
 *
 * Implements: Task 8.1
 * Validates: Requirements 10.1, 10.2, 19.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { errorCodeToHttpStatus } from '@dwt/shared';
import { AppError } from '../../../../errors/AppError.js';
import type { DbPool } from '../../../../db/pool.js';
import { createPhotosRepo } from '../../repo.js';
import { FoodLogTarget } from '../foodLogTarget.js';

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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
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
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

describe('FoodLogTarget', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let target: FoodLogTarget;
  let ownerId: string;
  let otherUserId: string;
  let foodItemId: string;
  let foodLogId: string;
  let expId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    ownerId = randomUUID();
    otherUserId = randomUUID();
    foodItemId = randomUUID();
    foodLogId = randomUUID();
    expId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${ownerId}', 'owner@example.com', 'h1'),
             ('${otherUserId}', 'other@example.com', 'h2');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${expId}', 'exp-up-1', 'Cinderella Castle', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItemId}', 'Royal Feast', '${expId}');

      INSERT INTO food_item_logs (id, user_id, food_item_id, visited_on, user_tz, note, rating)
      VALUES ('${foodLogId}', '${ownerId}', '${foodItemId}', '2026-10-18', 'America/New_York', 'Delicious!', 9);
    `);

    const photosRepo = createPhotosRepo(pool);
    target = new FoodLogTarget({
      pool,
      photosRepo,
      maxPerFoodLog: 4,
      foodEnabled: true,
    });
  });

  it('owner passes authorizeUpload and receives scopeId (food_item_id)', async () => {
    const res = await target.authorizeUpload(ownerId, foodLogId);
    expect(res.scopeId).toBe(foodItemId);
  });

  it('non-owner gets food_log_not_found', async () => {
    try {
      await target.authorizeUpload(otherUserId, foodLogId);
      expect.fail('should have thrown food_log_not_found');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('food_log_not_found');
      expect(errorCodeToHttpStatus[(err as AppError).code]).toBe(404);
    }
  });

  it('missing log gets food_log_not_found', async () => {
    const missingLogId = randomUUID();
    try {
      await target.authorizeUpload(ownerId, missingLogId);
      expect.fail('should have thrown food_log_not_found');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('food_log_not_found');
      expect(errorCodeToHttpStatus[(err as AppError).code]).toBe(404);
    }
  });

  it('SQL touches only id, user_id, and food_item_id from food_item_logs', async () => {
    let capturedQuery = '';
    const spyPool = {
      query: async (text: string, params?: any[]) => {
        capturedQuery = text;
        return pool.query(text, params);
      },
    } as unknown as DbPool;

    const inspectedTarget = new FoodLogTarget({ pool: spyPool });
    await inspectedTarget.authorizeUpload(ownerId, foodLogId);

    expect(capturedQuery).toContain('id');
    expect(capturedQuery).toContain('user_id');
    expect(capturedQuery).toContain('food_item_id');
    // Ensure no sensitive or unnecessary columns are selected
    expect(capturedQuery).not.toContain('note');
    expect(capturedQuery).not.toContain('rating');
    expect(capturedQuery).not.toContain('visited_on');
    expect(capturedQuery).not.toContain('user_tz');
    expect(capturedQuery).not.toContain('*');
  });

  it('canViewScope is always true and canDeleteOthers is false', async () => {
    expect(await target.canViewScope(randomUUID(), foodItemId)).toBe(true);
    expect(await target.canDeleteOthers(randomUUID(), foodItemId)).toBe(false);
  });
});
