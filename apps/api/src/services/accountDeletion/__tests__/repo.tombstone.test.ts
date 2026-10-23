/**
 * Repo tests (pg-mem, real SQL) for `ensureTombstone`.
 *
 * Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
 *
 * pg-mem is lenient about parameter typing, so the statement shape that Postgres needs (one type per
 * parameter, explicit casts, no `||` in SQL) is pinned here by text through the recording pool, and the
 * statement is on the operator's real-Postgres smoke list (design.md, Testing Strategy).
 *
 * Validates: Requirements 6.2, 6.3, 12.8, 9.4, 17.4
 */
import { DELETED_USER_DISPLAY_NAME, isDeletedUserId } from '@dwt/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ClaimedAccount } from '../ports.js';
import type { Row } from './helpers.js';
import { BOB, claimSubject, createWorld, makePending, SUBJECT, userRow, type World } from './world.js';

describe('accountDeletion repo: ensureTombstone (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;

  beforeEach(async () => {
    w = await createWorld();
    c = await claimSubject(w);
  });

  const texts = (): string[] => w.statements.map((s) => s.text.trim().replace(/\s+/g, ' '));

  it('sends a users insert with exactly two parameters ($1::uuid, $2::text), each used once, and no || in the statement', async () => {
    w.resetStatements();
    await w.repo.ensureTombstone(c);

    const users = w.statements.find((s) => /^INSERT INTO users/i.test(s.text.trim()))!;
    expect(users.params).toHaveLength(2);
    expect(users.params[0]).toBe(c.placeholderId);
    expect(users.params[1]).toBe(`${c.placeholderId}@deleted.invalid`);
    expect(users.text).not.toContain('||');
    expect(users.text.match(/\$1\b/g)).toHaveLength(1);
    expect(users.text.match(/\$2\b/g)).toHaveLength(1);
    expect(users.text).toContain('$1::uuid');
    expect(users.text).toContain('$2::text');
    expect(users.text).toMatch(/ON CONFLICT \(id\) DO NOTHING/);

    const profiles = w.statements.find((s) => /^INSERT INTO profiles/i.test(s.text.trim()))!;
    expect(profiles.params).toEqual([c.placeholderId]);
    expect(profiles.text).toContain('$1::uuid');
    expect(profiles.text).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
    expect(profiles.text).not.toContain('||');

    // Both inserts commit together.
    expect(texts()[0]).toBe('BEGIN');
    expect(texts()[texts().length - 1]).toBe('COMMIT');
  });

  it('creates the tombstone: id = the placeholder, state tombstone, an unmatchable password hash, a .invalid address, a "Deleted user" profile', async () => {
    const id = await w.repo.ensureTombstone(c);
    expect(id).toBe(c.placeholderId);
    expect(isDeletedUserId(id)).toBe(true);

    const u = (await userRow(w, id))!;
    expect(u.deletion_state).toBe('tombstone');
    expect(u.email).toBe(`${c.placeholderId}@deleted.invalid`);
    expect(u.password_hash).toBe('!'); // not an Argon2 hash: nothing verifies against it
    expect(new Date(u.created_at as Date).toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(u.placeholder_id).toBeNull();

    const p = (await w.pool.query(`SELECT * FROM profiles WHERE user_id = $1`, [id])).rows[0] as Row;
    expect(p.display_name).toBe(DELETED_USER_DISPLAY_NAME);
    expect(p.avatar_preset).toBeNull();

    // The visibility view treats it as not visible, under the same name.
    const view = (await w.pool.query(`SELECT * FROM profile_identity WHERE user_id = $1`, [id])).rows[0] as Row;
    expect(view.is_visible).toBe(false);
    expect(view.display_name).toBe(DELETED_USER_DISPLAY_NAME);
  });

  it('a second run is a no-op: same rows, no error, same id', async () => {
    const first = await w.repo.ensureTombstone(c);
    const usersBefore = JSON.stringify((await w.pool.query(`SELECT * FROM users ORDER BY id`)).rows);
    const profilesBefore = JSON.stringify((await w.pool.query(`SELECT * FROM profiles ORDER BY user_id`)).rows);

    expect(await w.repo.ensureTombstone(c)).toBe(first);

    expect(JSON.stringify((await w.pool.query(`SELECT * FROM users ORDER BY id`)).rows)).toBe(usersBefore);
    expect(JSON.stringify((await w.pool.query(`SELECT * FROM profiles ORDER BY user_id`)).rows)).toBe(profilesBefore);
  });

  it('repairs a half-made tombstone (users row present, profile missing) on the next run', async () => {
    await w.pool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state, created_at)
       VALUES ($1::uuid, $2::text, '!', 'tombstone', '1970-01-01T00:00:00Z'::timestamptz)`,
      [c.placeholderId, `${c.placeholderId}@deleted.invalid`],
    );
    await w.repo.ensureTombstone(c);
    const p = (await w.pool.query(`SELECT display_name FROM profiles WHERE user_id = $1`, [c.placeholderId])).rows as Row[];
    expect(p).toEqual([{ display_name: DELETED_USER_DISPLAY_NAME }]);
  });

  it('is injective: two purged accounts get two distinct tombstones, so unique keys over (x, column) cannot collide', async () => {
    await makePending(w, BOB.id);
    const claimed = await w.repo.claimDue(new Date('2026-05-02T09:00:00.000Z'), 10);
    const bob = claimed.find((x) => x.id === BOB.id)!;

    const a = await w.repo.ensureTombstone(c);
    const b = await w.repo.ensureTombstone(bob);

    expect(a).not.toBe(b);
    expect(a).not.toBe(SUBJECT.id);
    expect(b).not.toBe(BOB.id);
    const tombstones = (await w.pool.query(`SELECT id FROM users WHERE deletion_state = 'tombstone'`)).rows as Row[];
    expect(tombstones.map((t) => String(t.id)).sort()).toEqual([a, b].sort());
  });

  it('the tombstone id is derived from nothing about the person: the original id and email appear in neither row', async () => {
    const id = await w.repo.ensureTombstone(c);
    const rows = JSON.stringify([
      (await w.pool.query(`SELECT * FROM users WHERE id = $1`, [id])).rows,
      (await w.pool.query(`SELECT * FROM profiles WHERE user_id = $1`, [id])).rows,
    ]);
    expect(rows).not.toContain(SUBJECT.id);
    expect(rows).not.toContain(SUBJECT.email);
    expect(rows).not.toContain(SUBJECT.displayName);
  });
});
