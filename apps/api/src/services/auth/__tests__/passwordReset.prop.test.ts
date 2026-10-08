/**
 * Property tests for Password Reset domain and repository operations.
 *
 * Validates: Requirements 1.2, 1.6, 2.1, 2.2, 2.3, 2.4, 2.6
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createPasswordResetRepo, type PasswordResetRepo } from '../passwordResetRepo.js';

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
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

function sha256(val: string): string {
  return createHash('sha256').update(val).digest('hex');
}

describe('Password Reset Property Tests', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PasswordResetRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0059_password_reset_tokens.sql');

    repo = createPasswordResetRepo(pool);
  });

  // Feature: password-reset, Property 2: Expiry & Single-Use Enforcement
  it('Property 2: Expiry & Single-Use Enforcement — token cannot be read when expired or completed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z0-9]{5,10}$/),
        fc.stringMatching(/^\d{6}$/),
        fc.boolean(),
        async (name, code, isExpired) => {
          const userId = randomUUID();
          const email = `${name}_${randomUUID().slice(0, 8)}@example.com`;

          await pool.query(
            `INSERT INTO users (id, email, password_hash)
             VALUES ($1, $2, 'initial_hash')`,
            [userId, email],
          );

          const codeHash = sha256(code);
          const tokenHash = sha256(randomBytes(16).toString('hex'));

          const expiresAt = isExpired
            ? new Date(Date.now() - 60_000)
            : new Date(Date.now() + 15 * 60_000);

          const resetId = await repo.createResetRecord(userId, codeHash, tokenHash, expiresAt);

          const found = await repo.findActiveByEmail(email);

          if (isExpired) {
            expect(found).toBeNull();
          } else {
            expect(found).not.toBeNull();
            expect(found?.id).toBe(resetId);
            expect(found?.codeHash).toBe(codeHash);

            // Once reset is completed, it must no longer be active
            await repo.completeReset(resetId, userId, 'new_argon_hash');
            const postReset = await repo.findActiveByEmail(email);
            expect(postReset).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: password-reset, Property 3: Maximum 5 Failed Verification Attempts
  it('Property 3: Maximum 5 Failed Verification Attempts — attempts increment correctly and invalidation locks token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (failedAttempts) => {
          const userId = randomUUID();
          const email = `test_${randomUUID()}@example.com`;

          await pool.query(
            `INSERT INTO users (id, email, password_hash)
             VALUES ($1, $2, 'initial_hash')`,
            [userId, email],
          );

          const codeHash = sha256('654321');
          const tokenHash = sha256(randomBytes(16).toString('hex'));
          const expiresAt = new Date(Date.now() + 15 * 60_000);

          const resetId = await repo.createResetRecord(userId, codeHash, tokenHash, expiresAt);

          let currentAttempts = 0;
          for (let i = 0; i < failedAttempts; i++) {
            currentAttempts = await repo.incrementAttempts(resetId);
          }
          expect(currentAttempts).toBe(failedAttempts);

          if (failedAttempts >= 5) {
            await repo.invalidateRecord(resetId);
            const active = await repo.findActiveByEmail(email);
            expect(active).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: password-reset, Property 4: Complete Session Revocation Upon Reset
  it('Property 4: Complete Session Revocation — revokes all active sessions for the resetting user while preserving others', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        async (user1SessionsCount, user2SessionsCount) => {
          const user1Id = randomUUID();
          const user2Id = randomUUID();
          const email1 = `u1_${randomUUID()}@example.com`;
          const email2 = `u2_${randomUUID()}@example.com`;

          await pool.query(
            `INSERT INTO users (id, email, password_hash)
             VALUES ($1, $2, 'hash1'), ($3, $4, 'hash2')`,
            [user1Id, email1, user2Id, email2],
          );

          for (let i = 0; i < user1SessionsCount; i++) {
            await pool.query(
              `INSERT INTO sessions (user_id, token_hash, absolute_expires_at)
               VALUES ($1, $2, now() + interval '24 hours')`,
              [user1Id, sha256(`s1_${i}_${randomUUID()}`)],
            );
          }

          for (let i = 0; i < user2SessionsCount; i++) {
            await pool.query(
              `INSERT INTO sessions (user_id, token_hash, absolute_expires_at)
               VALUES ($1, $2, now() + interval '24 hours')`,
              [user2Id, sha256(`s2_${i}_${randomUUID()}`)],
            );
          }

          const resetId = await repo.createResetRecord(
            user1Id,
            sha256('111111'),
            sha256(randomUUID()),
            new Date(Date.now() + 15 * 60_000),
          );

          await repo.completeReset(resetId, user1Id, 'new_pw_hash');

          const activeU1 = await pool.query<{ count: number }>(
            `SELECT count(*)::int as count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
            [user1Id],
          );
          expect(activeU1.rows[0]?.count).toBe(0);

          const activeU2 = await pool.query<{ count: number }>(
            `SELECT count(*)::int as count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
            [user2Id],
          );
          expect(activeU2.rows[0]?.count).toBe(user2SessionsCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
