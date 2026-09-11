/**
 * Migration test for `0038_pin_showcase_share_kind.sql`.
 *
 * Applies 0001 (base shares table) and 0038 to a fresh pg-mem database and asserts:
 *   - `shares.payload_kind` accepts 'pinShowcase' with NULL experience_id;
 *   - `shares` rejects 'pinShowcase' with non-NULL experience_id;
 *   - existing 'experience' and 'progress' kinds remain valid;
 *   - unknown payload kinds are rejected.
 *
 * Validates: Requirement 24.12
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

async function seedUser(pool: Pool, id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
    [id, email],
  );
}

async function seedExperience(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
     VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', 'att-space-mtn')`,
    [id],
  );
}

describe('migration 0038_pin_showcase_share_kind (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let senderId: string;
  let expId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0038_pin_showcase_share_kind.sql');

    senderId = randomUUID();
    expId = randomUUID();
    await seedUser(pool, senderId, 'sender@example.com');
    await seedExperience(pool, expId);
  });

  it('allows pinShowcase share with NULL experience_id', async () => {
    const payload = JSON.stringify({
      kind: 'pinShowcase',
      ownerId: senderId,
      ownerDisplayName: 'Mickey',
    });

    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, NULL, 'pinShowcase', $2::jsonb)`,
        [senderId, payload],
      ),
    ).resolves.toBeDefined();

    const r = await pool.query(
      `SELECT payload_kind FROM shares WHERE sender_id = $1 AND payload_kind = 'pinShowcase'`,
      [senderId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.['payload_kind']).toBe('pinShowcase');
  });

  it('rejects pinShowcase share with non-NULL experience_id', async () => {
    const payload = JSON.stringify({
      kind: 'pinShowcase',
      ownerId: senderId,
      ownerDisplayName: 'Mickey',
    });

    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, $2, 'pinShowcase', $3::jsonb)`,
        [senderId, expId, payload],
      ),
    ).rejects.toThrow();
  });

  it('preserves existing experience and progress shares behavior', async () => {
    const expPayload = JSON.stringify({ kind: 'experience' });
    const progPayload = JSON.stringify({ kind: 'progress' });

    // experience with non-null experience_id succeeds
    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, $2, 'experience', $3::jsonb)`,
        [senderId, expId, expPayload],
      ),
    ).resolves.toBeDefined();

    // experience with null experience_id fails
    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, NULL, 'experience', $2::jsonb)`,
        [senderId, expPayload],
      ),
    ).rejects.toThrow();

    // progress with null experience_id succeeds
    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, NULL, 'progress', $2::jsonb)`,
        [senderId, progPayload],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects unknown payload_kind', async () => {
    await expect(
      pool.query(
        `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
         VALUES ($1, NULL, 'custom_kind', '{}'::jsonb)`,
        [senderId],
      ),
    ).rejects.toThrow();
  });
});
