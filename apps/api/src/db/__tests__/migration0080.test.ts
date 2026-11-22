/**
 * Migration test for `0080_expand_avatar_presets.sql`.
 *
 * Applies 0001 and 0013, seeds profiles with retired ('ear-balloon',
 * 'ice-cream-bar'), preserved ('castle'), and NULL avatar presets, then applies
 * 0080 and asserts:
 *   - 'ear-balloon' migrates to 'pretzel' and 'ice-cream-bar' migrates to 'pineapple-whip';
 *   - preserved ('castle') and NULL rows remain unchanged;
 *   - every id in AVATAR_PRESET_IDS (plus NULL) is accepted by profiles_avatar_preset_chk;
 *   - retired ids ('ear-balloon', 'ice-cream-bar') and unknown ids are rejected;
 *   - re-applying 0080 is idempotent.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AVATAR_PRESET_IDS } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
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
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  return db;
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0080_expand_avatar_presets (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let earUserId: string;
  let iceUserId: string;
  let castleUserId: string;
  let nullUserId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');

    earUserId = randomUUID();
    iceUserId = randomUUID();
    castleUserId = randomUUID();
    nullUserId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'ear@example.com', 'h1'),
              ($2, 'ice@example.com', 'h2'),
              ($3, 'castle@example.com', 'h3'),
              ($4, 'none@example.com', 'h4')`,
      [earUserId, iceUserId, castleUserId, nullUserId],
    );

    await pool.query(
      `INSERT INTO profiles (user_id, display_name, avatar_preset)
       VALUES ($1, 'Ear User', 'ear-balloon'),
              ($2, 'Ice User', 'ice-cream-bar'),
              ($3, 'Castle User', 'castle'),
              ($4, 'Null User', NULL)`,
      [earUserId, iceUserId, castleUserId, nullUserId],
    );
  });

  it('migrates retired trademarked presets and preserves existing safe/null rows', async () => {
    applyMigration(db, '0080_expand_avatar_presets.sql');

    const res = await pool.query(`SELECT user_id, avatar_preset FROM profiles`);
    expect(res.rows).toHaveLength(4);
    const byId = new Map(res.rows.map((r) => [String(r.user_id), r.avatar_preset]));

    expect(byId.get(earUserId)).toBe('pretzel');
    expect(byId.get(iceUserId)).toBe('pineapple-whip');
    expect(byId.get(castleUserId)).toBe('castle');
    expect(byId.get(nullUserId)).toBeNull();
  });

  it('accepts every id in AVATAR_PRESET_IDS plus NULL and rejects retired/unknown ids', async () => {
    applyMigration(db, '0080_expand_avatar_presets.sql');

    for (const preset of AVATAR_PRESET_IDS) {
      const updated = await pool.query(
        `UPDATE profiles SET avatar_preset = $1 WHERE user_id = $2 RETURNING avatar_preset`,
        [preset, castleUserId],
      );
      expect(updated.rows[0]?.avatar_preset).toBe(preset);
    }

    const cleared = await pool.query(
      `UPDATE profiles SET avatar_preset = NULL WHERE user_id = $1 RETURNING avatar_preset`,
      [castleUserId],
    );
    expect(cleared.rows[0]?.avatar_preset).toBeNull();

    for (const badPreset of ['ear-balloon', 'ice-cream-bar', 'not-a-preset']) {
      await expect(
        pool.query(`UPDATE profiles SET avatar_preset = $1 WHERE user_id = $2`, [
          badPreset,
          castleUserId,
        ]),
      ).rejects.toThrow();
    }
  });

  it('is idempotent when applied twice', () => {
    applyMigration(db, '0080_expand_avatar_presets.sql');
    expect(() => applyMigration(db, '0080_expand_avatar_presets.sql')).not.toThrow();
  });
});
