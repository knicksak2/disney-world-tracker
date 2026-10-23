/**
 * A seeded pg-mem "world" for the account-deletion repo tests: one person under test (SUBJECT) and three
 * bystanders, on a database with every migration applied. `seedEntry` inserts, for any registry entry, a row
 * that names the subject (and a control row that names a bystander), using the migrations' own column
 * definitions through the generic seeder, so every fixture mirrors the real schema.
 */
import { randomUUID } from 'node:crypto';

import type { IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import type { DispositionEntry } from '../dispositions.js';
import { createAccountDeletionRepo } from '../repo.js';
import type { AccountDeletionRepo, ClaimedAccount } from '../ports.js';
import {
  buildMigratedDb,
  createSeeder,
  createTestPool,
  migrationSchema,
  type RecordedStatement,
  type Row,
  type Seeder,
} from './helpers.js';

export interface Person {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
}

/** Ids are fixed so the canonical friendship order (`user_lo_id < user_hi_id`) is known. */
export const SUBJECT: Person = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'purge.subject@example.com',
  displayName: 'Purge Subject Pat',
  avatarPreset: 'wishing-star',
};
export const BOB: Person = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'bob.bystander@example.com',
  displayName: 'Bob Bystander',
  avatarPreset: 'teacup',
};
export const CAROL: Person = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  email: 'carol.bystander@example.com',
  displayName: 'Carol Bystander',
  avatarPreset: null,
};
export const DAVE: Person = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dave.bystander@example.com',
  displayName: 'Dave Bystander',
  avatarPreset: null,
};
export const PLACEHOLDER_ID = 'deadc0de-5555-4555-8555-555555555555';

export const CHUNK_ROWS = 50;

let base: { db: IMemoryDb; backup: { restore(): void } } | null = null;

export interface World {
  readonly db: IMemoryDb;
  readonly pool: DbPool;
  readonly statements: RecordedStatement[];
  readonly resetStatements: () => void;
  readonly seeder: Seeder;
  readonly repo: AccountDeletionRepo;
}

/** A fresh migrated database with the four people inserted. */
export async function createWorld(chunkRows: number = CHUNK_ROWS): Promise<World> {
  if (base === null) {
    const db = buildMigratedDb();
    base = { db, backup: db.backup() };
  } else {
    base.backup.restore();
  }
  const db = base.db;
  const { pool, statements, reset } = createTestPool(db);
  const seeder = createSeeder(pool, {
    fallbackUserId: BOB.id,
    tableDefaults: {
      food_items: async (s) => ({ experience_id: (await s.insertRow('experiences')).id }),
      trip_log_entries: async (s) => ({
        log_id: (await s.insertRow('experience_logs', { user_id: BOB.id })).id,
        member_id: BOB.id,
      }),
    },
  });
  for (const p of [SUBJECT, BOB, CAROL, DAVE]) {
    await seeder.insertRow('users', { id: p.id, email: p.email, password_hash: `hash-${p.displayName}` });
    await seeder.insertRow('profiles', {
      user_id: p.id,
      display_name: p.displayName,
      ...(p.avatarPreset ? { avatar_preset: p.avatarPreset } : {}),
    });
  }
  return { db, pool, statements, resetStatements: reset, seeder, repo: createAccountDeletionRepo(pool, { chunkRows }) };
}

/** Moves a user to `pending_deletion` directly (the request path itself is tested in repo.request.test.ts). */
export async function makePending(
  w: World,
  userId: string,
  opts: { requestedAt?: Date; scheduledPurgeAt?: Date; placeholderId?: string } = {},
): Promise<{ requestedAt: Date; scheduledPurgeAt: Date; placeholderId: string }> {
  const requestedAt = opts.requestedAt ?? new Date('2026-04-01T12:00:00.000Z');
  const scheduledPurgeAt = opts.scheduledPurgeAt ?? new Date('2026-05-01T12:00:00.000Z');
  const placeholderId = opts.placeholderId ?? `deadc0de-${userId.slice(9)}`;
  await w.pool.query(
    `UPDATE users SET deletion_state = 'pending_deletion', deletion_requested_at = $2, scheduled_purge_at = $3,
            placeholder_id = $4 WHERE id = $1`,
    [userId, requestedAt, scheduledPurgeAt, placeholderId],
  );
  return { requestedAt, scheduledPurgeAt, placeholderId };
}

/** Pending + claimed in the way the runner does it: through `claimDue` after the schedule has arrived. */
export async function claimSubject(
  w: World,
  userId: string = SUBJECT.id,
  now: Date = new Date('2026-05-02T09:00:00.000Z'),
): Promise<ClaimedAccount> {
  await makePending(w, userId);
  const claimed = await w.repo.claimDue(now, 10);
  const mine = claimed.find((c) => c.id === userId);
  if (!mine) throw new Error('claimSubject: the account was not claimed');
  return mine;
}

export async function userRow(w: World, id: string): Promise<Row | undefined> {
  const res = await w.pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return res.rows[0] as Row | undefined;
}

export async function rowsOf(w: World, table: string): Promise<Row[]> {
  return w.db.public.getTable(table).find() as Row[];
}

/** Primary-key tuple of a row as a comparable string. */
export function pkOf(table: string, row: Row): string {
  const pk = migrationSchema().tables.get(table)!.primaryKey;
  return JSON.stringify(pk.map((c) => row[c]));
}

export async function findByPk(w: World, table: string, row: Row): Promise<Row | undefined> {
  const key = pkOf(table, row);
  return (await rowsOf(w, table)).find((r) => pkOf(table, r) === key);
}

// ---------------------------------------------------------------------------------------------
// Per-entry fixtures
// ---------------------------------------------------------------------------------------------

export interface EntryFixture {
  /** The row naming the person under test, as inserted. */
  readonly subject: Row;
  /** A row of the same shape naming a bystander (null when the table cannot hold one). */
  readonly control: Row | null;
}

type Special = (w: World, id: string, entry: DispositionEntry) => Promise<Row | null>;

const SPECIAL: Readonly<Record<string, Special>> = {
  // Existing profile row of the person (every person has exactly one).
  'profiles.user_id': async (w, id) => (await w.pool.query(`SELECT * FROM profiles WHERE user_id = $1`, [id])).rows[0] as Row,
  // lo-entry pairs with CAROL (highest id), hi-entry with DAVE (lowest id): canonical order, no duplicates.
  'friendships.user_lo_id': async (w, id) =>
    CAROL.id > id ? w.seeder.insertRow('friendships', { user_lo_id: id, user_hi_id: CAROL.id }) : null,
  'friendships.user_hi_id': async (w, id) =>
    DAVE.id < id ? w.seeder.insertRow('friendships', { user_lo_id: DAVE.id, user_hi_id: id }) : null,
  'friend_requests.sender_id': (w, id) => w.seeder.insertRow('friend_requests', { sender_id: id, recipient_id: id === CAROL.id ? BOB.id : CAROL.id }),
  'friend_requests.recipient_id': (w, id) => w.seeder.insertRow('friend_requests', { recipient_id: id, sender_id: id === DAVE.id ? BOB.id : DAVE.id }),
  'user_blocks.blocker_id': (w, id) => w.seeder.insertRow('user_blocks', { blocker_id: id, blocked_id: id === CAROL.id ? BOB.id : CAROL.id }),
  'user_blocks.blocked_id': (w, id) => w.seeder.insertRow('user_blocks', { blocked_id: id, blocker_id: id === DAVE.id ? BOB.id : DAVE.id }),
  'shares.sender_id': (w, id) =>
    w.seeder.insertRow('shares', {
      sender_id: id,
      payload_kind: 'pinShowcase',
      payload_snapshot: {
        kind: 'pinShowcase',
        ownerId: id,
        ownerDisplayName: id === SUBJECT.id ? SUBJECT.displayName : BOB.displayName,
      },
    }),
  'share_recipients.recipient_id': async (w, id) =>
    w.seeder.insertRow('share_recipients', { recipient_id: id, share_id: (await shareFrom(w, DAVE.id)).id }),
  'share_reactions.recipient_id': async (w, id) =>
    w.seeder.insertRow('share_reactions', { recipient_id: id, share_id: (await shareFrom(w, DAVE.id)).id }),
  'trip_packing_items.packed_by': (w, id) => w.seeder.insertRow('trip_packing_items', { packed_by: id, packed: true, packed_at: new Date('2026-03-02T00:00:00Z') }),
  'settlements.created_by': (w, id) => w.seeder.insertRow('settlements', { created_by: id, payer_id: BOB.id, recipient_id: CAROL.id }),
  'settlements.payer_id': (w, id) => w.seeder.insertRow('settlements', { payer_id: id, recipient_id: id === CAROL.id ? BOB.id : CAROL.id }),
  'settlements.recipient_id': (w, id) => w.seeder.insertRow('settlements', { recipient_id: id, payer_id: id === CAROL.id ? BOB.id : CAROL.id }),
  'trip_log_entries.member_id': async (w, id) =>
    w.seeder.insertRow('trip_log_entries', {
      member_id: id,
      log_id: (await w.seeder.insertRow('experience_logs', { user_id: id })).id,
    }),
  'rode_with_tags.tagged_member_id': async (w, id) =>
    w.seeder.insertRow('rode_with_tags', { tagged_member_id: id, log_entry_id: (await w.seeder.insertRow('trip_log_entries', {})).id }),
  'experience_logs.user_id': async (w, id) => {
    // A private row (deleted at stage 4) AND a retained one: a trip log entry depends on it.
    await w.seeder.insertRow('experience_logs', { user_id: id });
    const retained = await w.seeder.insertRow('experience_logs', { user_id: id });
    await w.seeder.insertRow('trip_log_entries', { member_id: id, log_id: retained.id });
    return retained;
  },
  'photos.owner_id': (w, id) => w.seeder.insertRow('photos', { owner_id: id, status: 'approved', harm_verdict: 'pass', vision_verdict: 'pass', full_etag: 'f', thumb_etag: 't' }),
};

async function shareFrom(w: World, senderId: string): Promise<Row> {
  return w.seeder.insertRow('shares', {
    sender_id: senderId,
    payload_kind: 'progress',
    payload_snapshot: { kind: 'progress', overallPercent: 10, perParkPercent: {}, perCategoryPercent: {} },
  });
}

async function seedFor(w: World, entry: DispositionEntry, id: string): Promise<Row | null> {
  const key = `${entry.table}.${entry.column}`;
  const special = SPECIAL[key];
  if (special) return special(w, id, entry);
  return w.seeder.insertRow(entry.table, { [entry.column]: id });
}

export async function seedEntry(w: World, entry: DispositionEntry): Promise<EntryFixture> {
  const subject = await seedFor(w, entry, SUBJECT.id);
  if (subject === null) throw new Error(`seedEntry: could not seed ${entry.table}.${entry.column}`);
  const control = await seedFor(w, entry, BOB.id);
  return { subject, control };
}

/** A random identifier-free token for fixtures that must not look like a person. */
export function token(): string {
  return randomUUID().slice(0, 8);
}
