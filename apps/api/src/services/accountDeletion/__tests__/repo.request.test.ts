/**
 * Repo tests (pg-mem, real SQL) for the request, grant and restore paths.
 *
 * Feature: account-deletion, Property 4: A reauth grant works once, for one user and one session, within its window
 * Feature: account-deletion, Property 6: Requesting deletion changes only what the request is allowed to change
 * Feature: account-deletion, Property 2: Restoration is possible exactly while now is before the scheduled purge (SQL boundary)
 * Feature: account-deletion, Property 32: restoreInTx joins the caller's transaction (repo half)
 *
 * Validates: Requirements 2.3, 2.7, 2.8, 2.9, 2.12, 3.1, 3.2, 3.3, 3.6, 3.7, 4.1, 4.4, 4.5, 4.7, 17.4, 17.5
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { DISPOSITIONS } from '../dispositions.js';
import { generateGrant } from '../reauthGrant.js';
import { dumpAllTables, type Row } from './helpers.js';
import { BOB, createWorld, makePending, SUBJECT, userRow, type World } from './world.js';

const NOW = new Date('2026-04-01T12:00:00.000Z');
const SCHEDULED = new Date('2026-05-01T12:00:00.000Z');
const PLACEHOLDER = 'deadc0de-aaaa-4bbb-8ccc-ddddeeeeffff';

describe('accountDeletion repo: request, grants, restore (pg-mem)', () => {
  let w: World;

  async function newSession(userId: string): Promise<string> {
    const s = await w.seeder.insertRow('sessions', { user_id: userId });
    return String(s.id);
  }

  async function grantRows(): Promise<Row[]> {
    return (await w.pool.query(`SELECT * FROM account_deletion_reauth_grants ORDER BY session_id`)).rows as Row[];
  }

  async function issue(userId: string, sessionId: string, expiresAt = new Date(NOW.getTime() + 300_000)): Promise<string> {
    const { hash } = generateGrant();
    await w.repo.issueGrant({ userId, sessionId, grantHash: hash, expiresAt, now: NOW });
    return hash;
  }

  function request(userId: string, sessionId: string, grantHash: string, now: Date = NOW) {
    return w.repo.consumeGrantAndRequestDeletion({
      userId,
      sessionId,
      grantHash,
      now,
      scheduledPurgeAt: SCHEDULED,
      placeholderId: PLACEHOLDER,
    });
  }

  beforeEach(async () => {
    w = await createWorld();
  });

  // -------------------------------------------------------------------------------------------
  // Property 4: the grant store
  // -------------------------------------------------------------------------------------------
  describe('grant store (Property 4)', () => {
    it('replace-on-issue: a second issue for the same session leaves one row and only the newer hash works', async () => {
      const session = await newSession(SUBJECT.id);
      const first = await issue(SUBJECT.id, session);
      const second = await issue(SUBJECT.id, session);

      const rows = await grantRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.grant_hash).toBe(second);
      expect(rows[0]!.grant_hash).not.toBe(first);

      expect(await request(SUBJECT.id, session, first)).toEqual({ outcome: 'reauth_required' });
      expect(await grantRows()).toHaveLength(1); // the failed attempt consumed nothing
      expect(await request(SUBJECT.id, session, second)).toMatchObject({ outcome: 'ok' });
    });

    it('a grant works once: consumption deletes the row and a replay is reauth_required', async () => {
      const session = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, session);

      const ok = await request(SUBJECT.id, session, hash);
      expect(ok).toEqual({ outcome: 'ok', email: SUBJECT.email });
      expect(await grantRows()).toHaveLength(0);

      expect(await request(SUBJECT.id, session, hash)).toEqual({ outcome: 'reauth_required' });
    });

    it('is bound to the user: another user presenting the grant gets reauth_required and nothing changes', async () => {
      const session = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, session);

      expect(await request(BOB.id, session, hash)).toEqual({ outcome: 'reauth_required' });
      expect((await userRow(w, BOB.id))!.deletion_state).toBe('active');
      expect(await grantRows()).toHaveLength(1);
    });

    it('is bound to the session: the same user on another session gets reauth_required', async () => {
      const sessionA = await newSession(SUBJECT.id);
      const sessionB = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, sessionA);

      expect(await request(SUBJECT.id, sessionB, hash)).toEqual({ outcome: 'reauth_required' });
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('active');
      expect(await grantRows()).toHaveLength(1);
    });

    it('rejects a wrong hash and an expired grant, and treats expiry as strict (expires_at = now is expired)', async () => {
      const session = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, session, new Date(NOW.getTime() + 1000));

      expect(await request(SUBJECT.id, session, generateGrant().hash)).toEqual({ outcome: 'reauth_required' });
      expect(await request(SUBJECT.id, session, hash, new Date(NOW.getTime() + 1000))).toEqual({ outcome: 'reauth_required' });
      expect(await request(SUBJECT.id, session, hash, new Date(NOW.getTime() + 2000))).toEqual({ outcome: 'reauth_required' });
      // One millisecond before expiry it still works.
      expect(await request(SUBJECT.id, session, hash, new Date(NOW.getTime() + 999))).toMatchObject({ outcome: 'ok' });
    });

    it('a request that fails after the grant check (account not active) leaves the grant unconsumed', async () => {
      const session = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, session);
      await makePending(w, SUBJECT.id);

      expect(await request(SUBJECT.id, session, hash)).toEqual({ outcome: 'not_active' });
      const rows = await grantRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.grant_hash).toBe(hash);
    });

    it('issueGrant prunes every expired row (another session\'s too) in the same transaction and keeps live ones', async () => {
      const staleSession = await newSession(BOB.id);
      const liveSession = await newSession(BOB.id);
      const mySession = await newSession(SUBJECT.id);
      // Rows are inserted directly: issueGrant itself would prune the expired one on the second call.
      await w.pool.query(
        `INSERT INTO account_deletion_reauth_grants (session_id, user_id, grant_hash, expires_at) VALUES ($1, $2, 'h1', $3), ($4, $2, 'h2', $5)`,
        [staleSession, BOB.id, new Date(NOW.getTime() - 1), liveSession, new Date(NOW.getTime() + 60_000)],
      );
      expect(await grantRows()).toHaveLength(2);

      w.resetStatements();
      await issue(SUBJECT.id, mySession);
      // One transaction: BEGIN, prune, insert, COMMIT, in that order.
      const texts = w.statements.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(' '));

      const sessions = (await grantRows()).map((r) => String(r.session_id)).sort();
      expect(sessions).toEqual([liveSession, mySession].sort());
      expect(texts).toEqual(['BEGIN', 'DELETE FROM account_deletion_reauth_grants', 'INSERT INTO account_deletion_reauth_grants', 'COMMIT']);
    });

    it('holds at most one row per session after any sequence of issues', async () => {
      const sessions = [await newSession(SUBJECT.id), await newSession(SUBJECT.id), await newSession(BOB.id)];
      for (let i = 0; i < 9; i++) {
        const s = sessions[i % sessions.length]!;
        await issue(s === sessions[2] ? BOB.id : SUBJECT.id, s);
      }
      const rows = await grantRows();
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.session_id)).size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Property 6: what a request changes
  // -------------------------------------------------------------------------------------------
  describe('request effects (Property 6)', () => {
    const ALLOWED = new Set([
      'users',
      'sessions',
      'password_reset_tokens',
      'push_registrations',
      'account_deletion_reauth_grants',
    ]);

    /** Seeds the subject in every registry table plus two sessions, a used and an unused reset token. */
    async function seedEverything(): Promise<{ sessionId: string }> {
      const { seedEntry } = await import('./world.js');
      for (const entry of DISPOSITIONS) await seedEntry(w, entry);
      const second = await w.seeder.insertRow('sessions', { user_id: SUBJECT.id });
      await w.pool.query(`UPDATE password_reset_tokens SET expires_at = $1, used_at = NULL WHERE user_id = $2`, [
        new Date('2030-01-01T00:00:00Z'),
        SUBJECT.id,
      ]);
      await w.seeder.insertRow('password_reset_tokens', {
        user_id: SUBJECT.id,
        expires_at: new Date('2030-01-01T00:00:00Z'),
        used_at: new Date('2026-03-15T00:00:00Z'),
      });
      return { sessionId: String(second.id) };
    }

    it('changes only the five allowed tables, and in them only what the request promises', async () => {
      const { sessionId } = await seedEverything();
      const hash = await issue(SUBJECT.id, sessionId);
      const before = dumpAllTables(w.db);
      const grantsBefore = before.account_deletion_reauth_grants!.length;
      expect(grantsBefore).toBe(1);

      const result = await request(SUBJECT.id, sessionId, hash);
      expect(result).toEqual({ outcome: 'ok', email: SUBJECT.email });
      const after = dumpAllTables(w.db);

      // Every table other than the five is byte-identical.
      for (const [table, rows] of Object.entries(before)) {
        if (ALLOWED.has(table)) continue;
        expect(JSON.stringify(after[table]), `table ${table} must be unchanged`).toBe(JSON.stringify(rows));
      }
      // The grant was consumed.
      expect(after.account_deletion_reauth_grants).toHaveLength(0);

      // Every session of the subject is revoked at the request time; a bystander's is untouched.
      const subjectSessions = after.sessions!.filter((s) => s.user_id === SUBJECT.id);
      expect(subjectSessions.length).toBeGreaterThanOrEqual(2);
      for (const s of subjectSessions) expect(new Date(s.revoked_at as Date).toISOString()).toBe(NOW.toISOString());

      // Unused reset tokens are expired at the request; the used one keeps its expiry.
      const tokens = after.password_reset_tokens!.filter((t) => t.user_id === SUBJECT.id);
      const unused = tokens.filter((t) => t.used_at === null);
      const used = tokens.filter((t) => t.used_at !== null);
      expect(unused.length).toBeGreaterThan(0);
      for (const t of unused) expect(new Date(t.expires_at as Date).toISOString()).toBe(NOW.toISOString());
      for (const t of used) expect(new Date(t.expires_at as Date).toISOString()).toBe('2030-01-01T00:00:00.000Z');

      // No push registration remains for the subject.
      expect(after.push_registrations!.filter((p) => p.user_id === SUBJECT.id)).toHaveLength(0);

      // The users row changed in exactly the four request columns.
      const b = before.users!.find((u) => u.id === SUBJECT.id)!;
      const a = after.users!.find((u) => u.id === SUBJECT.id)!;
      const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
      expect(changed).toEqual(['deletion_requested_at', 'deletion_state', 'placeholder_id', 'scheduled_purge_at']);
      expect(a.deletion_state).toBe('pending_deletion');
      expect(new Date(a.deletion_requested_at as Date).toISOString()).toBe(NOW.toISOString());
      expect(new Date(a.scheduled_purge_at as Date).toISOString()).toBe(SCHEDULED.toISOString());
      expect(a.placeholder_id).toBe(PLACEHOLDER);
      // Other users' rows are untouched.
      expect(JSON.stringify(after.users!.find((u) => u.id === BOB.id))).toBe(JSON.stringify(before.users!.find((u) => u.id === BOB.id)));
    });

    it('revokes the caller\'s own session too, and keeps an earlier revoked_at', async () => {
      const early = new Date('2026-03-20T00:00:00Z');
      const s1 = await newSession(SUBJECT.id);
      const s2 = await newSession(SUBJECT.id);
      await w.pool.query(`UPDATE sessions SET revoked_at = $1 WHERE id = $2`, [early, s2]);
      const hash = await issue(SUBJECT.id, s1);

      await request(SUBJECT.id, s1, hash);

      const rows = (await w.pool.query(`SELECT id, revoked_at FROM sessions WHERE user_id = $1`, [SUBJECT.id])).rows as Row[];
      expect(new Date(rows.find((r) => r.id === s1)!.revoked_at as Date).toISOString()).toBe(NOW.toISOString());
      expect(new Date(rows.find((r) => r.id === s2)!.revoked_at as Date).toISOString()).toBe(early.toISOString());
    });

    it('a restore returns the account to active and clears the request columns; the other tables stay as the request left them', async () => {
      const { sessionId } = await seedEverything();
      await request(SUBJECT.id, sessionId, await issue(SUBJECT.id, sessionId));
      const afterRequest = dumpAllTables(w.db);

      const restored = await w.repo.restore(SUBJECT.id, new Date(NOW.getTime() + 86_400_000));
      expect(restored).toEqual({ restored: true, email: SUBJECT.email });

      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.deletion_state).toBe('active');
      expect(row.deletion_requested_at).toBeNull();
      expect(row.scheduled_purge_at).toBeNull();
      expect(row.placeholder_id).toBeNull();
      const afterRestore = dumpAllTables(w.db);
      for (const [table, rows] of Object.entries(afterRequest)) {
        if (table === 'users') continue;
        expect(JSON.stringify(afterRestore[table]), `table ${table}`).toBe(JSON.stringify(rows));
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // Races and non-active accounts
  // -------------------------------------------------------------------------------------------
  describe('conditional transition (race)', () => {
    it('a second request on an account that is no longer active returns not_active and changes nothing', async () => {
      const s1 = await newSession(SUBJECT.id);
      const s2 = await newSession(SUBJECT.id);
      const g1 = await issue(SUBJECT.id, s1);
      const g2 = await issue(SUBJECT.id, s2);

      expect(await request(SUBJECT.id, s1, g1)).toMatchObject({ outcome: 'ok' });
      const afterFirst = (await userRow(w, SUBJECT.id))!;

      expect(await request(SUBJECT.id, s2, g2, new Date(NOW.getTime() + 5000))).toEqual({ outcome: 'not_active' });
      const afterSecond = (await userRow(w, SUBJECT.id))!;
      expect(JSON.stringify(afterSecond)).toBe(JSON.stringify(afterFirst));
      expect((await grantRows()).map((r) => r.session_id)).toEqual([s2]); // the losing grant was not consumed
    });

    it.each(['purging', 'tombstone'] as const)('an account in state %s cannot be requested', async (state) => {
      const session = await newSession(SUBJECT.id);
      const hash = await issue(SUBJECT.id, session);
      if (state === 'purging') {
        await makePending(w, SUBJECT.id);
        await w.pool.query(`UPDATE users SET deletion_state = 'purging', purge_claimed_at = $2 WHERE id = $1`, [SUBJECT.id, NOW]);
      } else {
        // The CHECK pins tombstone to the deadc0de- prefix; use a real tombstone row.
        const tomb = 'deadc0de-1234-4234-8234-123412341234';
        await w.pool.query(
          `INSERT INTO users (id, email, password_hash, deletion_state) VALUES ($1, $2, '!', 'tombstone')`,
          [tomb, `${tomb}@deleted.invalid`],
        );
        const tsess = (await w.pool.query(`INSERT INTO sessions (user_id, token_hash, absolute_expires_at) VALUES ($1, 'h', $2) RETURNING id`, [tomb, SCHEDULED])).rows[0] as Row;
        const { hash: h2 } = generateGrant();
        await w.repo.issueGrant({ userId: tomb, sessionId: String(tsess.id), grantHash: h2, expiresAt: SCHEDULED, now: NOW });
        expect(await request(tomb, String(tsess.id), h2)).toEqual({ outcome: 'not_active' });
        return;
      }
      expect(await request(SUBJECT.id, session, hash)).toEqual({ outcome: 'not_active' });
    });
  });

  // -------------------------------------------------------------------------------------------
  // Restore: the strict boundary, restoreInTx, getters
  // -------------------------------------------------------------------------------------------
  describe('restore boundary (Property 2) and restoreInTx', () => {
    const T = SCHEDULED;

    it('restore succeeds one millisecond before scheduled_purge_at and fails at it and after it', async () => {
      await makePending(w, SUBJECT.id, { scheduledPurgeAt: T });
      expect(await w.repo.restore(SUBJECT.id, new Date(T.getTime() + 1))).toEqual({ restored: false, email: null });
      expect(await w.repo.restore(SUBJECT.id, T)).toEqual({ restored: false, email: null });
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('pending_deletion');

      expect(await w.repo.restore(SUBJECT.id, new Date(T.getTime() - 1))).toEqual({ restored: true, email: SUBJECT.email });
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('active');
      // Restoring an active account is a no-op that reports not restored.
      expect(await w.repo.restore(SUBJECT.id, new Date(T.getTime() - 1))).toEqual({ restored: false, email: null });
    });

    async function inTx<R>(fn: (client: import('pg').PoolClient) => Promise<R>, commit: boolean): Promise<R> {
      const client = await w.pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        return out;
      } finally {
        client.release();
      }
    }

    it('restoreInTx reports restored / not_needed / not_restorable by state and boundary', async () => {
      // active -> not_needed
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, NOW), true)).toBe('not_needed');

      // pending inside the grace period -> restored
      await makePending(w, SUBJECT.id, { scheduledPurgeAt: T });
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, new Date(T.getTime() - 1)), true)).toBe('restored');
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('active');

      // pending at or past the date -> not_restorable, unchanged
      await makePending(w, SUBJECT.id, { scheduledPurgeAt: T });
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, T), true)).toBe('not_restorable');
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, new Date(T.getTime() + 1)), true)).toBe('not_restorable');
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('pending_deletion');

      // purging -> not_restorable
      await w.pool.query(`UPDATE users SET deletion_state = 'purging', purge_claimed_at = $2 WHERE id = $1`, [SUBJECT.id, NOW]);
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, new Date(T.getTime() - 1)), true)).toBe('not_restorable');
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('purging');

      // unknown user -> not_restorable
      expect(await inTx((c) => w.repo.restoreInTx(c, randomUUID(), NOW), true)).toBe('not_restorable');
    });

    it('restoreInTx runs on the caller\'s client: rolling the transaction back undoes the restore', async () => {
      await makePending(w, SUBJECT.id, { scheduledPurgeAt: T });
      expect(await inTx((c) => w.repo.restoreInTx(c, SUBJECT.id, new Date(T.getTime() - 1)), false)).toBe('restored');
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.deletion_state).toBe('pending_deletion');
      expect(row.placeholder_id).not.toBeNull();
    });
  });

  describe('getters', () => {
    it('getPasswordHash and getEmail read the row; an unknown id gives null', async () => {
      expect(await w.repo.getPasswordHash(SUBJECT.id)).toBe(`hash-${SUBJECT.displayName}`);
      expect(await w.repo.getEmail(SUBJECT.id)).toBe(SUBJECT.email);
      expect(await w.repo.getPasswordHash(randomUUID())).toBeNull();
      expect(await w.repo.getEmail(randomUUID())).toBeNull();
    });

    it('findActiveUserByEmail returns id, email, passwordHash for an active user (case-insensitive) and null for unknown or non-active users', async () => {
      const found = await w.repo.findActiveUserByEmail(SUBJECT.email.toUpperCase());
      expect(found).toEqual({
        id: SUBJECT.id,
        email: SUBJECT.email,
        passwordHash: `hash-${SUBJECT.displayName}`,
      });

      expect(await w.repo.findActiveUserByEmail('nobody@example.com')).toBeNull();

      await makePending(w, SUBJECT.id);
      expect(await w.repo.findActiveUserByEmail(SUBJECT.email)).toBeNull();
    });
  });

  describe('requestDeletionForUser (web self-service deletion transaction)', () => {
    it('atomically transitions active -> pending_deletion, revokes sessions, expires unused reset tokens, and deletes push registrations', async () => {
      const s1 = await newSession(SUBJECT.id);
      const s2 = await newSession(SUBJECT.id);
      await w.seeder.insertRow('password_reset_tokens', {
        user_id: SUBJECT.id,
        expires_at: new Date('2030-01-01T00:00:00Z'),
        used_at: null,
      });
      await w.seeder.insertRow('push_registrations', { user_id: SUBJECT.id });

      const result = await w.repo.requestDeletionForUser({
        userId: SUBJECT.id,
        now: NOW,
        scheduledPurgeAt: SCHEDULED,
        placeholderId: PLACEHOLDER,
      });
      expect(result).toEqual({ outcome: 'ok', email: SUBJECT.email });

      const u = (await userRow(w, SUBJECT.id))!;
      expect(u.deletion_state).toBe('pending_deletion');
      expect(new Date(u.deletion_requested_at as Date).toISOString()).toBe(NOW.toISOString());
      expect(new Date(u.scheduled_purge_at as Date).toISOString()).toBe(SCHEDULED.toISOString());
      expect(u.placeholder_id).toBe(PLACEHOLDER);

      const sessions = (await w.pool.query(`SELECT id, revoked_at FROM sessions WHERE user_id = $1`, [SUBJECT.id])).rows as Row[];
      expect(sessions.map((s) => s.id).sort()).toEqual([s1, s2].sort());
      for (const s of sessions) {
        expect(new Date(s.revoked_at as Date).toISOString()).toBe(NOW.toISOString());
      }

      const tokens = (await w.pool.query(`SELECT expires_at FROM password_reset_tokens WHERE user_id = $1`, [SUBJECT.id])).rows as Row[];
      expect(tokens).toHaveLength(1);
      expect(new Date(tokens[0]!.expires_at as Date).toISOString()).toBe(NOW.toISOString());

      const pushes = (await w.pool.query(`SELECT 1 FROM push_registrations WHERE user_id = $1`, [SUBJECT.id])).rows;
      expect(pushes).toHaveLength(0);
    });

    it('returns not_active when the account is already pending_deletion', async () => {
      await makePending(w, SUBJECT.id);
      const res = await w.repo.requestDeletionForUser({
        userId: SUBJECT.id,
        now: NOW,
        scheduledPurgeAt: SCHEDULED,
        placeholderId: PLACEHOLDER,
      });
      expect(res).toEqual({ outcome: 'not_active' });
    });
  });
});
