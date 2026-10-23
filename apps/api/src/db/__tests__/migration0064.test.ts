/**
 * Migration test for `0064_account_deletion.sql`.
 *
 * Applies every migration `0001..0064` to pg-mem, then asserts the new users
 * columns and defaults, each CHECK (valid and invalid row), both indexes, the
 * three new tables, and the three visibility views.
 *
 * Validates: Requirements 3.1, 5.1, 12.3, 17.4
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DELETED_USER_DISPLAY_NAME } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0064_account_deletion.sql';

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
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  return db;
}

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Applies one migration file to pg-mem. `skipViews` drops the `CREATE OR REPLACE VIEW`
 * statements: pg-mem cannot replace an existing view ("Method not implemented") and has no
 * DROP VIEW, so the reapply test runs the rest of the file and asserts the view statements'
 * idempotent form from the file text instead.
 */
function applyMigration(db: IMemoryDb, name: string, opts: { skipViews?: boolean } = {}): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  if (opts.skipViews) sql = sql.replace(/CREATE OR REPLACE VIEW[^;]+;/gms, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

const TOMBSTONE_ID = 'deadc0de-1111-4222-8333-444455556666';
const PLACEHOLDER_ID = 'deadc0de-aaaa-4bbb-8ccc-ddddeeeeffff';

describe('migration 0064_account_deletion (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let legacyUserId: string;

  /** Inserts a user and returns its id; `extra` is a raw column/value list. */
  async function insertUser(
    id: string,
    cols: Record<string, unknown> = {},
  ): Promise<void> {
    const names = ['id', 'email', 'password_hash', ...Object.keys(cols)];
    const values = [id, `${id}@example.com`, 'hash', ...Object.values(cols)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(
      `INSERT INTO users (${names.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  }

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of migrationNames().filter((n) => n < MIGRATION_FILE)) {
      applyMigration(db, name);
    }
    // A row that exists BEFORE the migration: it must come out 'active'.
    legacyUserId = randomUUID();
    await insertUser(legacyUserId);
    applyMigration(db, MIGRATION_FILE);
  });

  it('0064 is the highest migration and the SQL file is wrapped in BEGIN/COMMIT', () => {
    const names = migrationNames();
    expect(names[names.length - 1]).toBe(MIGRATION_FILE);
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(/^\s*BEGIN;/m);
    expect(raw).toMatch(/^\s*COMMIT;/m);
  });

  it('reapplying the migration is a no-op (idempotent) and keeps existing data', async () => {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    // The three views are created with the idempotent form (pg-mem cannot replay them, see applyMigration).
    for (const view of ['profile_identity', 'active_friendships', 'active_trip_memberships']) {
      expect(raw).toContain(`CREATE OR REPLACE VIEW ${view} AS`);
    }
    expect(() => applyMigration(db, MIGRATION_FILE, { skipViews: true })).not.toThrow();
    const { rows } = await pool.query(`SELECT email, password_hash FROM users WHERE id = $1`, [
      legacyUserId,
    ]);
    expect(rows[0]).toMatchObject({ email: `${legacyUserId}@example.com`, password_hash: 'hash' });
  });

  it('a row that existed before the migration survives it, and the column declares NOT NULL DEFAULT active', async () => {
    // pg-mem does not backfill a NOT NULL DEFAULT column onto rows that already exist (it reads
    // them back as NULL); Postgres does. So the pre-existing-row default cannot be observed here:
    // we assert the row is intact and that the DDL carries the declaration Postgres backfills from.
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [legacyUserId]);
    expect(rows).toHaveLength(1);
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(
      /ADD COLUMN IF NOT EXISTS deletion_state\s+TEXT\s+NOT NULL DEFAULT 'active'/,
    );
  });

  it('a new row defaults to active with zeroed purge counters and a null schedule', async () => {
    const newId = randomUUID();
    await insertUser(newId);
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [newId]);
    const row = rows[0]!;
    expect(row.deletion_state).toBe('active');
    expect(row.deletion_requested_at).toBeNull();
    expect(row.scheduled_purge_at).toBeNull();
    expect(row.placeholder_id).toBeNull();
    expect(row.purge_claimed_at).toBeNull();
    expect(row.purge_stage).toBe(0);
    expect(row.purge_trips_transferred).toBe(0);
    expect(row.purge_trips_deleted).toBe(0);
    expect(row.purge_photos_deleted).toBe(0);
    expect(row.purge_attempts).toBe(0);
    expect(row.purge_last_attempt_at).toBeNull();
    expect(row.purge_warnings).toBe(0);
  });

  describe('users CHECK constraints', () => {
    const pending = (placeholder: string): Record<string, unknown> => ({
      deletion_state: 'pending_deletion',
      deletion_requested_at: new Date('2026-01-01T00:00:00Z'),
      scheduled_purge_at: new Date('2026-01-31T00:00:00Z'),
      placeholder_id: placeholder,
    });

    it('users_deletion_state_chk: the four states are accepted, anything else is rejected', async () => {
      await insertUser(randomUUID(), { deletion_state: 'active' });
      await insertUser(randomUUID(), pending(randomUUID()));
      await insertUser(randomUUID(), { ...pending(randomUUID()), deletion_state: 'purging' });
      await insertUser(TOMBSTONE_ID, { deletion_state: 'tombstone' });
      await expect(insertUser(randomUUID(), { deletion_state: 'deleted' })).rejects.toThrow();
    });

    it('users_deletion_schedule_chk: pending/purging need schedule, request time and placeholder', async () => {
      await expect(
        insertUser(randomUUID(), { deletion_state: 'pending_deletion' }),
      ).rejects.toThrow();
      await expect(
        insertUser(randomUUID(), {
          deletion_state: 'pending_deletion',
          deletion_requested_at: new Date(),
          placeholder_id: randomUUID(),
        }),
      ).rejects.toThrow();
      await expect(
        insertUser(randomUUID(), {
          deletion_state: 'purging',
          deletion_requested_at: new Date(),
          scheduled_purge_at: new Date(),
        }),
      ).rejects.toThrow();
      await insertUser(randomUUID(), pending(randomUUID()));
    });

    it('users_purge_stage_chk: 0..4 accepted, 5 and -1 rejected', async () => {
      for (const stage of [0, 4]) {
        await insertUser(randomUUID(), { purge_stage: stage });
      }
      await expect(insertUser(randomUUID(), { purge_stage: 5 })).rejects.toThrow();
      await expect(insertUser(randomUUID(), { purge_stage: -1 })).rejects.toThrow();
    });

    it('users_purge_counters_chk: every counter must be non-negative', async () => {
      await insertUser(randomUUID(), { purge_attempts: 7, purge_warnings: 2 });
      for (const col of [
        'purge_attempts',
        'purge_warnings',
        'purge_trips_transferred',
        'purge_trips_deleted',
        'purge_photos_deleted',
      ]) {
        await expect(insertUser(randomUUID(), { [col]: -1 }), col).rejects.toThrow();
      }
    });

    it('users_tombstone_prefix_chk: tombstone state and the deadc0de- prefix are equivalent', async () => {
      // tombstone + prefix: valid
      await insertUser(TOMBSTONE_ID, { deletion_state: 'tombstone' });
      // tombstone without prefix: invalid
      await expect(
        insertUser(randomUUID(), { deletion_state: 'tombstone' }),
      ).rejects.toThrow();
      // prefix without tombstone state: invalid
      await expect(
        insertUser('deadc0de-9999-4999-8999-999999999999', { deletion_state: 'active' }),
      ).rejects.toThrow();
    });
  });

  describe('indexes', () => {
    it('users_placeholder_id_uidx: a placeholder id is unique, NULLs are not constrained', async () => {
      const base = {
        deletion_state: 'pending_deletion',
        deletion_requested_at: new Date(),
        scheduled_purge_at: new Date(),
      };
      await insertUser(randomUUID(), { ...base, placeholder_id: PLACEHOLDER_ID });
      await expect(
        insertUser(randomUUID(), { ...base, placeholder_id: PLACEHOLDER_ID }),
      ).rejects.toThrow();
      // Two rows with NULL placeholder_id (the legacy row plus a new one) coexist.
      await insertUser(randomUUID());
    });

    it('both indexes exist on users with their columns and predicates', () => {
      const indices = db.public.getTable('users').listIndices();
      const names = indices.map((i) => i.name);
      expect(names).toContain('users_placeholder_id_uidx');
      expect(names).toContain('users_deletion_due_idx');

      const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
      expect(raw).toMatch(/users_deletion_due_idx\s+ON users \(purge_attempts, scheduled_purge_at\)/);
      expect(raw).toMatch(/WHERE deletion_state IN \('pending_deletion','purging'\)/);
      expect(raw).toMatch(/UNIQUE INDEX IF NOT EXISTS users_placeholder_id_uidx/);
    });
  });

  describe('reauth grants', () => {
    it('keeps one grant per session (primary key) and cascades with the session', async () => {
      const userId = randomUUID();
      const sessionId = randomUUID();
      await insertUser(userId);
      await pool.query(
        `INSERT INTO sessions (id, user_id, token_hash, absolute_expires_at)
         VALUES ($1, $2, 'th-1', now() + interval '1 day')`,
        [sessionId, userId],
      );
      const grant = `INSERT INTO account_deletion_reauth_grants (session_id, user_id, grant_hash, expires_at)
                     VALUES ($1, $2, 'h', now() + interval '5 minutes')`;
      await pool.query(grant, [sessionId, userId]);
      await expect(pool.query(grant, [sessionId, userId])).rejects.toThrow();

      await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM account_deletion_reauth_grants`);
      expect(rows[0]!.n).toBe(0);
    });

    it('requires the session and the user to exist', async () => {
      await expect(
        pool.query(
          `INSERT INTO account_deletion_reauth_grants (session_id, user_id, grant_hash, expires_at)
           VALUES ($1, $2, 'h', now())`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  describe('recompute queue and ledger', () => {
    it('the recompute queue holds one row per experience and cascades with it', async () => {
      const expId = randomUUID();
      await pool.query(
        `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
         VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', 'att-space-mtn')`,
        [expId],
      );
      await pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [
        expId,
      ]);
      await expect(
        pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [expId]),
      ).rejects.toThrow();
      await pool.query(`DELETE FROM experiences WHERE id = $1`, [expId]);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM account_deletion_recompute_queue`);
      expect(rows[0]!.n).toBe(0);
    });

    it('the ledger defaults to completed, has no identifying column, and checks outcome and counters', async () => {
      await pool.query(`INSERT INTO account_deletion_ledger (requested_at) VALUES (now())`);
      const { rows } = await pool.query(`SELECT * FROM account_deletion_ledger`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe('completed');
      expect(Object.keys(rows[0]!).sort()).toEqual(
        [
          'id',
          'outcome',
          'photos_deleted',
          'purged_at',
          'requested_at',
          'trips_deleted',
          'trips_transferred',
        ].sort(),
      );

      await pool.query(
        `INSERT INTO account_deletion_ledger (requested_at, outcome) VALUES (now(), 'completed_with_warnings')`,
      );
      await expect(
        pool.query(`INSERT INTO account_deletion_ledger (requested_at, outcome) VALUES (now(), 'weird')`),
      ).rejects.toThrow();
      await expect(
        pool.query(`INSERT INTO account_deletion_ledger (requested_at, trips_deleted) VALUES (now(), -1)`),
      ).rejects.toThrow();
    });
  });

  describe('visibility views', () => {
    const activeId = randomUUID();
    const otherActiveId = randomUUID();
    const pendingId = randomUUID();
    const pendingPlaceholder = 'deadc0de-0000-4000-8000-000000000001';

    async function seedPeople(): Promise<void> {
      const when = {
        deletion_requested_at: new Date('2026-01-01T00:00:00Z'),
        scheduled_purge_at: new Date('2026-01-31T00:00:00Z'),
      };
      await insertUser(activeId);
      await insertUser(otherActiveId);
      await insertUser(pendingId, {
        deletion_state: 'pending_deletion',
        placeholder_id: pendingPlaceholder,
        ...when,
      });
      await insertUser(TOMBSTONE_ID, { deletion_state: 'tombstone' });
      for (const [id, name, avatar] of [
        [activeId, 'Alice', 'castle'],
        [otherActiveId, 'Bob', null],
        [pendingId, 'Carol', 'castle'],
        [TOMBSTONE_ID, 'Deleted user', null],
      ] as const) {
        await pool.query(
          `INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES ($1, $2, $3)`,
          [id, name, avatar],
        );
      }
    }

    it('profile_identity shows an active user as themself and a pending user as the alias', async () => {
      await seedPeople();
      const { rows } = await pool.query(
        `SELECT user_id, public_id, display_name, avatar_preset, is_visible FROM profile_identity`,
      );
      const byUser = new Map(rows.map((r) => [r.user_id as string, r]));

      expect(byUser.get(activeId)).toMatchObject({
        public_id: activeId,
        display_name: 'Alice',
        avatar_preset: 'castle',
        is_visible: true,
      });
      expect(byUser.get(pendingId)).toMatchObject({
        public_id: pendingPlaceholder,
        display_name: DELETED_USER_DISPLAY_NAME,
        avatar_preset: null,
        is_visible: false,
      });
    });

    it('profile_identity maps a tombstone to its own id with the placeholder name', async () => {
      await seedPeople();
      const { rows } = await pool.query(
        `SELECT public_id, display_name, avatar_preset, is_visible FROM profile_identity WHERE user_id = $1`,
        [TOMBSTONE_ID],
      );
      expect(rows[0]).toMatchObject({
        public_id: TOMBSTONE_ID,
        display_name: DELETED_USER_DISPLAY_NAME,
        avatar_preset: null,
        is_visible: false,
      });
    });

    it("profile_identity's display-name literal equals DELETED_USER_DISPLAY_NAME", () => {
      const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
      const view = /CREATE OR REPLACE VIEW profile_identity AS([\s\S]*?);\s*\n\s*\nCREATE OR REPLACE VIEW/.exec(
        raw,
      );
      expect(view).not.toBeNull();
      const literals = [...view![1]!.matchAll(/ELSE '([^']+)' END\s+AS display_name/g)].map(
        (m) => m[1],
      );
      expect(literals).toEqual([DELETED_USER_DISPLAY_NAME]);
    });

    it('active_friendships hides a friendship once either side is not active', async () => {
      await seedPeople();
      const [lo1, hi1] = [activeId, otherActiveId].sort();
      const [lo2, hi2] = [activeId, pendingId].sort();
      const [lo3, hi3] = [otherActiveId, TOMBSTONE_ID].sort();
      for (const [lo, hi] of [
        [lo1, hi1],
        [lo2, hi2],
        [lo3, hi3],
      ]) {
        await pool.query(`INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`, [lo, hi]);
      }
      const { rows } = await pool.query(`SELECT user_lo_id, user_hi_id FROM active_friendships`);
      expect(rows).toHaveLength(1);
      expect([rows[0]!.user_lo_id, rows[0]!.user_hi_id]).toEqual([lo1, hi1]);
    });

    it('active_trip_memberships hides the memberships of a non-active user', async () => {
      await seedPeople();
      const tripId = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, name, start_date, end_date, creator_id)
         VALUES ($1, 'Trip', '2026-10-20', '2026-10-25', $2)`,
        [tripId, activeId],
      );
      for (const [userId, role] of [
        [activeId, 'organizer'],
        [pendingId, 'member'],
      ]) {
        await pool.query(
          `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, $3)`,
          [tripId, userId, role],
        );
      }
      const { rows } = await pool.query(
        `SELECT user_id, role FROM active_trip_memberships WHERE trip_id = $1`,
        [tripId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: activeId, role: 'organizer' });
    });

    it('a pending user becomes visible again when restored to active', async () => {
      await seedPeople();
      await pool.query(
        `UPDATE users SET deletion_state = 'active', deletion_requested_at = NULL,
                scheduled_purge_at = NULL, placeholder_id = NULL WHERE id = $1`,
        [pendingId],
      );
      const { rows } = await pool.query(
        `SELECT public_id, display_name, is_visible FROM profile_identity WHERE user_id = $1`,
        [pendingId],
      );
      expect(rows[0]).toMatchObject({ public_id: pendingId, display_name: 'Carol', is_visible: true });
    });
  });
});
