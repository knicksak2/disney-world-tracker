/**
 * The Interim_Organizer through the real SQL (pg-mem): the authorization gate, the `FOR UPDATE` role read used by
 * `promote`, and the roster wrapper. A pending organizer leaves the trip usable; restoring them changes nothing.
 *
 * Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { buildMigratedDb, createTestPool, type TestPool } from '../../accountDeletion/__tests__/helpers.js';
import { assertTripMember, assertTripOrganizer } from '../authz.js';
import { resolveEffectiveRole } from '../effectiveRole.js';
import { createTripRepo, type TripRepoDeps } from '../repo.js';

const ORG = randomUUID();
const EARLY = randomUUID(); // earliest-joined member: the interim organizer while ORG is pending
const LATE = randomUUID();
const OUTSIDER = randomUUID();
const TRIP = randomUUID();

interface Ctx {
  readonly t: TestPool;
  readonly pool: DbPool;
}

async function setup(): Promise<Ctx> {
  const db = buildMigratedDb();
  const t = createTestPool(db);
  const { pool } = t;
  for (const [id, email] of [
    [ORG, 'org@example.com'],
    [EARLY, 'early@example.com'],
    [LATE, 'late@example.com'],
    [OUTSIDER, 'outsider@example.com'],
  ] as const) {
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [id, email]);
    await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, email.split('@')[0]]);
  }
  await pool.query(
    `INSERT INTO trips (id, name, start_date, end_date, creator_id) VALUES ($1, 'T', '2026-10-01', '2026-10-05', $2)`,
    [TRIP, ORG],
  );
  const joined = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, n));
  for (const [uid, role, at] of [
    [ORG, 'organizer', joined(0)],
    [EARLY, 'member', joined(1)],
    [LATE, 'member', joined(2)],
  ] as const) {
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
      [TRIP, uid, role, at],
    );
  }
  t.reset();
  return { t, pool };
}

async function setState(pool: DbPool, userId: string, state: 'active' | 'pending_deletion'): Promise<void> {
  if (state === 'active') {
    await pool.query(
      `UPDATE users SET deletion_state = 'active', deletion_requested_at = NULL, scheduled_purge_at = NULL,
              placeholder_id = NULL WHERE id = $1`,
      [userId],
    );
    return;
  }
  await pool.query(
    `UPDATE users SET deletion_state = 'pending_deletion', deletion_requested_at = $2, scheduled_purge_at = $3,
            placeholder_id = $4 WHERE id = $1`,
    [userId, new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T00:00:00Z'), randomUUID()],
  );
}

async function denial(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return (err as AppError).code;
  }
  throw new Error('expected a denial');
}

describe('assertTripMember with a pending organizer (real SQL)', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it('returns the persisted roles while the organizer is active', async () => {
    expect(await assertTripMember(c.pool, ORG, TRIP)).toBe('organizer');
    expect(await assertTripMember(c.pool, EARLY, TRIP)).toBe('member');
    expect(await assertTripMember(c.pool, LATE, TRIP)).toBe('member');
  });

  it('lifts only the earliest-joined active member to organizer while the organizer is pending', async () => {
    await setState(c.pool, ORG, 'pending_deletion');
    expect(await assertTripMember(c.pool, EARLY, TRIP)).toBe('organizer');
    expect(await assertTripMember(c.pool, LATE, TRIP)).toBe('member');
    // The pending organizer still resolves to the persisted role (no session reaches this in practice).
    expect(await assertTripMember(c.pool, ORG, TRIP)).toBe('organizer');
  });

  it('a non-member and an unknown trip are still the same opaque denial', async () => {
    await setState(c.pool, ORG, 'pending_deletion');
    expect(await denial(() => assertTripMember(c.pool, OUTSIDER, TRIP))).toBe('trip_forbidden');
    expect(await denial(() => assertTripMember(c.pool, EARLY, randomUUID()))).toBe('trip_forbidden');
  });

  it('passes an organizer-only gate for the interim organizer and denies the other member', async () => {
    await setState(c.pool, ORG, 'pending_deletion');
    await expect(assertTripOrganizer(c.pool, EARLY, TRIP)).resolves.toBeUndefined();
    expect(await denial(() => assertTripOrganizer(c.pool, LATE, TRIP))).toBe('trip_forbidden');
  });

  it('restoring the organizer returns every role to the persisted one with nothing else changed', async () => {
    await setState(c.pool, ORG, 'pending_deletion');
    await expect(assertTripOrganizer(c.pool, EARLY, TRIP)).resolves.toBeUndefined();
    await setState(c.pool, ORG, 'active');
    expect(await denial(() => assertTripOrganizer(c.pool, EARLY, TRIP))).toBe('trip_forbidden');
    // Nothing was persisted for the interim: the stored roles never changed.
    const rows = await c.pool.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM trip_memberships WHERE trip_id = $1`,
      [TRIP],
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.user_id, r.role]))).toEqual({
      [ORG]: 'organizer',
      [EARLY]: 'member',
      [LATE]: 'member',
    });
  });

  it('a pending earliest member is skipped: the next active member becomes the interim organizer', async () => {
    await setState(c.pool, ORG, 'pending_deletion');
    await setState(c.pool, EARLY, 'pending_deletion');
    expect(await assertTripMember(c.pool, LATE, TRIP)).toBe('organizer');
  });

  it('costs one membership query in the common case and a second only for a member of an organizer-less trip', async () => {
    const membershipQueries = (): number => c.t.statements.filter((s) => /trip_memberships/.test(s.text)).length;

    await assertTripMember(c.pool, EARLY, TRIP); // active organizer present
    expect(membershipQueries()).toBe(1);

    c.t.reset();
    await assertTripMember(c.pool, ORG, TRIP); // organizer caller
    expect(membershipQueries()).toBe(1);

    await setState(c.pool, ORG, 'pending_deletion');
    c.t.reset();
    await assertTripMember(c.pool, LATE, TRIP); // member, no active organizer: roster read
    expect(membershipQueries()).toBe(2);
  });
});

describe('resolveEffectiveRole (roster wrapper)', () => {
  it('reads the roster with each member’s account state and returns null for a non-member', async () => {
    const c = await setup();
    expect(await resolveEffectiveRole(c.pool, TRIP, EARLY)).toBe('member');
    await setState(c.pool, ORG, 'pending_deletion');
    expect(await resolveEffectiveRole(c.pool, TRIP, EARLY)).toBe('organizer');
    expect(await resolveEffectiveRole(c.pool, TRIP, LATE)).toBe('member');
    expect(await resolveEffectiveRole(c.pool, TRIP, OUTSIDER)).toBeNull();
  });
});

describe('promote reads the acting role under FOR UPDATE (lockMemberRole)', () => {
  const repoFor = (pool: DbPool) => createTripRepo(pool, {} as unknown as TripRepoDeps);

  it('promotes a plain member and persists the organizer role', async () => {
    const c = await setup();
    await repoFor(c.pool).promote(TRIP, LATE);
    const row = await c.pool.query<{ role: string }>(
      `SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [TRIP, LATE],
    );
    expect(row.rows[0]?.role).toBe('organizer');
  });

  it('treats the interim organizer as already an organizer and writes nothing', async () => {
    const c = await setup();
    await setState(c.pool, ORG, 'pending_deletion');
    expect(await denial(() => repoFor(c.pool).promote(TRIP, EARLY))).toBe('trip_role_invalid');
    const row = await c.pool.query<{ role: string }>(
      `SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [TRIP, EARLY],
    );
    expect(row.rows[0]?.role).toBe('member');
  });

  it('with the organizer pending, a member other than the interim organizer can still be promoted', async () => {
    const c = await setup();
    await setState(c.pool, ORG, 'pending_deletion');
    await repoFor(c.pool).promote(TRIP, LATE);
    const row = await c.pool.query<{ role: string }>(
      `SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [TRIP, LATE],
    );
    expect(row.rows[0]?.role).toBe('organizer');
  });
});
