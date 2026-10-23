/**
 * The disposition registry: every `table.column` that references `users(id)` by foreign key and
 * what the purge does with it (account-deletion design, "Data inventory" and "The disposition
 * registry"; Requirements 12.1, 12.2, 12.3, 12.8, 12.9, 9.10).
 *
 * Pure data plus pure SQL builders: no I/O. `dispositions.test.ts` parses every migration and
 * fails when this list and the schema disagree, so a new migration that adds a reference to
 * `users(id)` cannot ship without a decision recorded here.
 *
 * Stage numbers are the five purge stages: 1 photos, 2 trips, 3 anonymize, 4 personal data,
 * 5 finalize. Only `trips.creator_id` runs in stage 2 (via `resolveTrip`, not the registry loop).
 */

export type Disposition =
  | 'delete'
  | 'anonymize'
  | 'anonymize_then_delete'
  | 'nullify'
  | 'trip'
  | 'session';

export interface DispositionEntry {
  readonly table: string;
  /** One entry per `table.column` with a FOREIGN KEY to `users(id)`. Soft references live in `SOFT_REFERENCES`. */
  readonly column: string;
  readonly disposition: Disposition;
  /**
   * The stage that acts on the row first. `anonymize_then_delete` entries are listed at 3 (their
   * anonymize half); stage 4 then deletes whatever private rows remain.
   */
  readonly stage: 2 | 3 | 4;
  /**
   * MANDATORY and never empty. The row's key once `column = userId` is fixed: together with
   * `column` it must contain a PRIMARY KEY or UNIQUE key of the table, so one key tuple is one row.
   */
  readonly chunkColumns: readonly string[];
  /** `ON DELETE` behaviour today, as the migrations declare it. */
  readonly today: 'cascade' | 'set_null' | 'no_action';
  /** Whether the column is nullable today. */
  readonly nullable: boolean;
  /** `anonymize_then_delete` only: predicate over the entry's own table selecting rows a surviving row depends on. */
  readonly retainWhere?: string;
  /** `anonymize_then_delete` only: columns set to NULL on the retained rows (private free text). */
  readonly blank?: readonly string[];
  readonly note?: string;
}

// Compact constructors keep the 70 rows readable; each call is one `table.column`.
const e = (
  table: string,
  column: string,
  disposition: Disposition,
  stage: 2 | 3 | 4,
  chunkColumns: readonly string[],
  today: DispositionEntry['today'] = 'cascade',
  nullable = false,
  extra: Pick<DispositionEntry, 'retainWhere' | 'blank' | 'note'> = {},
): DispositionEntry => ({
  table,
  column,
  disposition,
  stage,
  chunkColumns,
  today,
  nullable,
  ...extra,
});

export const DISPOSITIONS: readonly DispositionEntry[] = [
  // -- identity, sessions, credentials ------------------------------------------------------
  e('profiles', 'user_id', 'delete', 4, ['user_id'], 'cascade', false, {
    note: 'Name and avatar. The tombstone gets its own profile row.',
  }),
  e('sessions', 'user_id', 'session', 4, ['id'], 'cascade', false, {
    note: 'revoked_at is set at request time; the rows go with the user.',
  }),
  e('password_reset_tokens', 'user_id', 'delete', 4, ['id']),
  e('account_deletion_reauth_grants', 'user_id', 'delete', 4, ['session_id'], 'cascade', false, {
    note: 'Consumed on use; also cascades from sessions. One grant per session.',
  }),

  // -- per-user tracking ----------------------------------------------------------------------
  e('completions', 'user_id', 'delete', 4, ['experience_id']),
  e('ratings', 'user_id', 'delete', 4, ['experience_id'], 'cascade', false, {
    note: 'Experience ids are queued for aggregate recompute before the delete.',
  }),
  e('notes', 'user_id', 'delete', 4, ['experience_id']),
  e('experience_logs', 'user_id', 'anonymize_then_delete', 3, ['id'], 'cascade', false, {
    retainWhere: 'id IN (SELECT log_id FROM trip_log_entries)',
    blank: ['note'],
    note:
      'Cascade hazard: trip_log_entries.log_id cascades from experience_logs, so a bare delete would ' +
      'delete the trip log entry other members rely on. Stage 3 re-points only the rows a trip log ' +
      'entry depends on and blanks note; stage 4 deletes the rest.',
  }),
  e('food_item_logs', 'user_id', 'delete', 4, ['id']),
  e('experience_favorites', 'user_id', 'delete', 4, ['experience_id']),
  e('user_pins', 'user_id', 'delete', 4, ['id']),
  e('pin_showcase_placements', 'user_id', 'delete', 4, ['id']),

  // -- notifications ----------------------------------------------------------------------------
  e('push_registrations', 'user_id', 'delete', 4, ['id'], 'cascade', false, {
    note: 'Also deleted in the request transaction so no token stays active.',
  }),
  e('notification_preferences', 'user_id', 'delete', 4, ['user_id']),
  e('push_delivery_log', 'user_id', 'delete', 4, ['id']),

  // -- friends and blocks -----------------------------------------------------------------------
  e('friend_requests', 'sender_id', 'delete', 4, ['id']),
  e('friend_requests', 'recipient_id', 'delete', 4, ['id']),
  e('friendships', 'user_lo_id', 'delete', 4, ['user_hi_id']),
  e('friendships', 'user_hi_id', 'delete', 4, ['user_lo_id']),
  e('user_blocks', 'blocker_id', 'delete', 4, ['id']),
  e('user_blocks', 'blocked_id', 'delete', 4, ['id']),

  // -- photos -------------------------------------------------------------------------------------
  e('photos', 'owner_id', 'nullify', 4, ['id'], 'set_null', true, {
    note:
      'Stage 1 soft-deletes the photos (they must still be found by owner); stage 4 then nulls owner_id ' +
      'in chunks so the final delete of the users row fires no unbounded ON DELETE SET NULL.',
  }),
  e('photo_upload_bans', 'user_id', 'delete', 4, ['user_id']),
  e('photo_upload_strikes', 'user_id', 'delete', 4, ['user_id']),
  e('photo_upload_counters', 'user_id', 'delete', 4, ['day']),
  e('photo_reports', 'reporter_id', 'anonymize', 3, ['id'], 'cascade', false, {
    note: 'UNIQUE(photo_id, reporter_id) cannot collide: the tombstone is per account. Must not change any photo state or open-report count.',
  }),

  // -- sharing ------------------------------------------------------------------------------------
  e('shares', 'sender_id', 'anonymize', 3, ['id'], 'cascade', false, {
    note: 'Recipients keep the share; payload_snapshot is scrubbed too (SOFT_REFERENCES).',
  }),
  e('share_recipients', 'recipient_id', 'delete', 4, ['share_id']),
  e('share_reactions', 'recipient_id', 'delete', 4, ['share_id']),

  // -- food lists ---------------------------------------------------------------------------------
  e('food_lists', 'owner_id', 'delete', 4, ['id'], 'cascade', false, {
    note: 'A3: the purged user\'s own list takes its items, shares, likes, saves and trip attachments with it.',
  }),
  e('food_lists_items', 'added_by_user_id', 'nullify', 4, ['id'], 'set_null', true),
  e('food_list_shares', 'shared_with_user_id', 'delete', 4, ['food_list_id']),
  e('food_list_shares', 'shared_by_user_id', 'delete', 4, ['food_list_id', 'shared_with_user_id']),
  e('food_list_likes', 'user_id', 'delete', 4, ['food_list_id']),
  e('food_list_saves', 'saved_by_user_id', 'delete', 4, ['food_list_id']),
  e('food_items', 'created_by_user_id', 'nullify', 4, ['id'], 'no_action', true, {
    note: 'Blocks deleting the users row today (no ON DELETE action): nulled by the purge first.',
  }),
  e('user_submitted_locations', 'created_by_user_id', 'nullify', 4, ['id'], 'no_action', true, {
    note: 'Blocks deleting the users row today (no ON DELETE action): nulled by the purge first.',
  }),

  // -- experience lists -----------------------------------------------------------------------------
  e('experience_lists', 'owner_id', 'delete', 4, ['id'], 'cascade', false, {
    note: 'A3: the purged user\'s own list takes its items, shares, likes, saves and trip attachments with it.',
  }),
  e('experience_lists_items', 'added_by_user_id', 'nullify', 4, ['id'], 'set_null', true),
  e('experience_list_shares', 'shared_with_user_id', 'delete', 4, ['experience_list_id']),
  e('experience_list_shares', 'shared_by_user_id', 'delete', 4, ['experience_list_id', 'shared_with_user_id']),
  e('experience_list_likes', 'user_id', 'delete', 4, ['experience_list_id']),
  e('experience_list_saves', 'saved_by_user_id', 'delete', 4, ['experience_list_id']),

  // -- trips --------------------------------------------------------------------------------------
  e('trips', 'creator_id', 'trip', 2, ['id'], 'cascade', false, {
    note: 'Executed by resolveTrip (transfer or delete), not by the registry loop. A bare delete would delete the trip for everyone.',
  }),
  e('trip_memberships', 'user_id', 'delete', 4, ['trip_id'], 'cascade', false, {
    note: 'resolveTrip already removes the membership of every trip it visits; this statement is the safety net.',
  }),
  e('trip_invites', 'inviter_id', 'delete', 4, ['id']),
  e('trip_invites', 'invitee_id', 'delete', 4, ['id'], 'cascade', false, {
    note: 'Invites addressed to the user on trips they are not a member of are only reachable here.',
  }),
  e('rode_with_tags', 'tagged_member_id', 'delete', 4, ['id']),
  e('trip_reactions', 'member_id', 'delete', 4, ['target_type', 'target_id', 'reaction']),
  e('trip_booking_reminder_mutes', 'user_id', 'delete', 4, ['trip_id']),
  e('planned_items', 'added_by', 'anonymize', 3, ['id']),
  e('trip_log_entries', 'member_id', 'anonymize', 3, ['id'], 'cascade', false, {
    note: 'Trip history other members see.',
  }),
  e('trip_feed_items', 'actor_id', 'anonymize', 3, ['id']),
  e('trip_comments', 'author_id', 'anonymize', 3, ['id'], 'cascade', false, { note: 'Body kept (A2).' }),
  e('trip_food_lists', 'added_by', 'anonymize', 3, ['trip_id', 'food_list_id']),
  e('trip_experience_lists', 'added_by', 'anonymize', 3, ['trip_id', 'experience_list_id']),
  e('trip_booking_window_done', 'marked_by', 'anonymize', 3, ['trip_id', 'window_kind', 'drop_on']),
  e('trip_packing_items', 'added_by', 'anonymize', 3, ['id']),
  e('trip_packing_items', 'assignee_id', 'nullify', 4, ['id'], 'set_null', true),
  e('trip_packing_items', 'packed_by', 'nullify', 4, ['id'], 'set_null', true),

  // -- trip expenses (balances must be preserved: anonymize, never delete) ---------------------------
  e('trip_guests', 'sponsor_member_id', 'anonymize', 3, ['id']),
  e('expenses', 'payer_id', 'anonymize', 3, ['id']),
  e('expenses', 'created_by', 'anonymize', 3, ['id']),
  e('expense_shares', 'member_id', 'anonymize', 3, ['id'], 'cascade', true, {
    note: 'Rows with guest_id set have member_id NULL and are untouched.',
  }),
  e('expense_tier_counts', 'member_id', 'anonymize', 3, ['id'], 'cascade', true),
  e('expense_item_assignees', 'member_id', 'anonymize', 3, ['id'], 'cascade', true),
  e('expense_refunds', 'created_by', 'anonymize', 3, ['id']),
  e('settlements', 'payer_id', 'anonymize', 3, ['id']),
  e('settlements', 'recipient_id', 'anonymize', 3, ['id']),
  e('settlements', 'created_by', 'anonymize', 3, ['id']),
];

/**
 * References that are NOT foreign keys to `users(id)`, so no cascade would find them. Deliberately
 * not part of the set `dispositions.test.ts` compares with the parsed `REFERENCES users` clauses.
 */
export const SOFT_REFERENCES: readonly { readonly where: string; readonly holds: string; readonly fate: string }[] = [
  {
    where: 'users.placeholder_id',
    holds: 'The alias id of this person (no foreign key, by design)',
    fate: 'Destroyed with the users row at finalize (R6.6); becomes the tombstone id at purge',
  },
  {
    where: "shares.payload_snapshot (payload_kind = 'pinShowcase')",
    holds: "ownerId (the sender's user id) and ownerDisplayName",
    fate: "Scrubbed in stage 3 by scrubSharePayload: ownerId becomes the tombstone id, ownerDisplayName 'Deleted user'",
  },
  {
    where: "shares.payload_snapshot (payload_kind = 'tripSummary')",
    holds: "sharerDisplayName, the sender's real display name",
    fate: "Scrubbed in stage 3: sharerDisplayName becomes 'Deleted user'; also substituted at read time while pending (R5.11)",
  },
  {
    where: "shares.payload_snapshot (payload_kind = 'progress')",
    holds: 'Percentages and a facet label',
    fate: 'No id or name. Kept.',
  },
  {
    where: "shares.payload_snapshot (payload_kind = 'experience')",
    holds: 'Optional note text the sender wrote',
    fate: 'Kept (A2). No id or name is embedded.',
  },
  {
    where: 'trip_feed_items.metadata',
    holds: 'experienceId, logEntryId, photoIds, caption',
    fate: 'No user id or name; caption kept (A2). Inspected by the residual test.',
  },
  {
    where: 'trip_reactions.target_id and trip_comments.target_id',
    holds: 'Feed item or log entry ids',
    fate: 'Not user references.',
  },
  {
    where: 'photos.target_id, photos.scope_id, photos.feed_item_id',
    holds: 'Trip, food-log and feed item ids',
    fate: 'Not user references.',
  },
  {
    where: 'Redis locked:{userId} and the failure counter keys',
    holds: 'The user id as a key',
    fate: 'Deleted through LockoutService.clearOnSuccess(userId) at finalize, best-effort (R12.5)',
  },
  {
    where: 'Redis rate-limit keys',
    holds: 'A hash of the bearer token',
    fate: 'Expire on their own; not deleted.',
  },
  {
    where: 'highest-rated:v1 cache',
    holds: 'Anonymous aggregates',
    fate: 'Expires on its 5 minute TTL after the recompute.',
  },
  {
    where: 'Object storage (R2)',
    holds: 'Keys derived from the photo id, never the user id',
    fate: 'Nothing keyed by user id exists to delete. The sweep removes the objects.',
  },
  {
    where: 'Logs',
    holds: 'The account hash from accountLogId only',
    fate: 'Never email, name, id, password, grant or phrase.',
  },
];

/**
 * Cascade pairs the audit (Property 28) accepts although they reach an `anonymize`, `nullify` or
 * `trip` target. `from` and `to` are table names that exist in the migrations; `reason` is non-empty.
 * Exactly these four ship.
 */
export const CASCADE_AUDIT_EXEMPT: readonly {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}[] = [
  { from: 'food_lists', to: 'trip_food_lists', reason: "A3: the purged user's own list takes its attachments and items with it" },
  { from: 'food_lists', to: 'food_lists_items', reason: "A3: the purged user's own list takes its attachments and items with it" },
  { from: 'experience_lists', to: 'trip_experience_lists', reason: "A3: the purged user's own list takes its attachments and items with it" },
  { from: 'experience_lists', to: 'experience_lists_items', reason: "A3: the purged user's own list takes its attachments and items with it" },
];

/** All registry entries whose disposition is in `d`, in registry order. */
export function columnsBy(d: Disposition | readonly Disposition[]): readonly DispositionEntry[] {
  const wanted: readonly Disposition[] = typeof d === 'string' ? [d] : d;
  return DISPOSITIONS.filter((entry) => wanted.includes(entry.disposition));
}

// ---------------------------------------------------------------------------
// Chunked statements
// ---------------------------------------------------------------------------

export type ChunkOp = 'delete' | 'nullify' | 'anonymize' | 'anonymize_retained';

export type ChunkedStatement =
  | {
      /** `chunkColumns.length === 1`: ONE statement per chunk, repeated until it affects zero rows. */
      readonly kind: 'single';
      readonly sql: string;
      readonly params: readonly unknown[];
    }
  | {
      /**
       * `chunkColumns.length >= 2`: a bounded SELECT of key tuples, then one single-row statement per
       * tuple. `perKeySql` takes `[userId, (tombstoneId when the op anonymizes), ...one value per key column]`.
       */
      readonly kind: 'per_key';
      readonly selectSql: string;
      readonly selectParams: readonly unknown[];
      readonly perKeySql: string;
      readonly keyColumns: readonly string[];
    };

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`buildChunkedStatement: unsafe SQL identifier ${JSON.stringify(name)}`);
  return name;
}

const OPS_BY_DISPOSITION: Record<Disposition, readonly ChunkOp[]> = {
  delete: ['delete'],
  session: ['delete'],
  nullify: ['nullify'],
  anonymize: ['anonymize'],
  anonymize_then_delete: ['anonymize_retained', 'delete'],
  trip: [],
};

/**
 * Pure. Builds the bounded statement(s) for one registry entry. Every emitted `sql` / `selectSql`
 * carries a `LIMIT`; no row-value `IN` is used anywhere, and every identifier comes from the
 * registry (validated here), never from request input.
 *
 * Parameters of a `single` statement: `$1` user id, `$2` chunk rows, `$3` tombstone id (anonymize ops only).
 */
export function buildChunkedStatement(
  entry: DispositionEntry,
  op: ChunkOp,
  ctx: { userId: string; tombstoneId?: string; chunkRows: number },
): ChunkedStatement {
  if (!OPS_BY_DISPOSITION[entry.disposition].includes(op)) {
    throw new Error(
      `buildChunkedStatement: op '${op}' is not valid for ${entry.table}.${entry.column} (disposition '${entry.disposition}')`,
    );
  }
  if (!Number.isInteger(ctx.chunkRows) || ctx.chunkRows < 1) {
    throw new RangeError(`buildChunkedStatement: chunkRows must be a positive integer, got ${String(ctx.chunkRows)}`);
  }
  const anonymizes = op === 'anonymize' || op === 'anonymize_retained';
  if (anonymizes && !ctx.tombstoneId) {
    throw new Error(`buildChunkedStatement: op '${op}' needs a tombstoneId`);
  }
  if (op === 'anonymize_retained' && !entry.retainWhere) {
    throw new Error(`buildChunkedStatement: ${entry.table}.${entry.column} has no retainWhere`);
  }

  const table = ident(entry.table);
  const column = ident(entry.column);
  const keys = entry.chunkColumns.map(ident);
  if (keys.length === 0) throw new Error(`buildChunkedStatement: ${table}.${column} has no chunkColumns`);
  const retain = op === 'anonymize_retained' ? ` AND (${entry.retainWhere})` : '';

  if (keys.length === 1) {
    const k = keys[0]!;
    const sub = `SELECT ${k} FROM ${table} WHERE ${column} = $1${retain} ORDER BY ${k} LIMIT $2`;
    const where = `WHERE ${column} = $1${retain} AND ${k} IN (${sub})`;
    switch (op) {
      case 'delete':
        return { kind: 'single', sql: `DELETE FROM ${table} ${where}`, params: [ctx.userId, ctx.chunkRows] };
      case 'nullify':
        return {
          kind: 'single',
          sql: `UPDATE ${table} SET ${column} = NULL ${where}`,
          params: [ctx.userId, ctx.chunkRows],
        };
      case 'anonymize':
        return {
          kind: 'single',
          sql: `UPDATE ${table} SET ${column} = $3 ${where}`,
          params: [ctx.userId, ctx.chunkRows, ctx.tombstoneId],
        };
      case 'anonymize_retained': {
        const blanks = (entry.blank ?? []).map((b) => `, ${ident(b)} = NULL`).join('');
        return {
          kind: 'single',
          sql: `UPDATE ${table} SET ${column} = $3${blanks} ${where}`,
          params: [ctx.userId, ctx.chunkRows, ctx.tombstoneId],
        };
      }
    }
  }

  // per_key: select the key tuples, then one single-row statement per tuple.
  const keyList = keys.join(', ');
  const selectSql = `SELECT ${keyList} FROM ${table} WHERE ${column} = $1${retain} ORDER BY ${keyList} LIMIT $2`;
  const firstKeyParam = anonymizes ? 3 : 2;
  const keyWhere = keys.map((k, i) => `${k} = $${firstKeyParam + i}`).join(' AND ');
  const base = `WHERE ${column} = $1 AND ${keyWhere}`;
  let perKeySql: string;
  switch (op) {
    case 'delete':
      perKeySql = `DELETE FROM ${table} ${base}`;
      break;
    case 'nullify':
      perKeySql = `UPDATE ${table} SET ${column} = NULL ${base}`;
      break;
    case 'anonymize':
      perKeySql = `UPDATE ${table} SET ${column} = $2 ${base}`;
      break;
    case 'anonymize_retained': {
      const blanks = (entry.blank ?? []).map((b) => `, ${ident(b)} = NULL`).join('');
      perKeySql = `UPDATE ${table} SET ${column} = $2${blanks} ${base}${retain}`;
      break;
    }
  }
  return {
    kind: 'per_key',
    selectSql,
    selectParams: [ctx.userId, ctx.chunkRows],
    perKeySql,
    keyColumns: keys,
  };
}
