/**
 * Registry shape, the migration-parsing completeness test (Property 11), the chunked-statement
 * builder, and the cascade audit (Property 28).
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.8, 12.9, 8.4, 9.10, 17.2, 17.7
 */

import { describe, expect, it } from 'vitest';

import {
  CASCADE_AUDIT_EXEMPT,
  DISPOSITIONS,
  SOFT_REFERENCES,
  buildChunkedStatement,
  columnsBy,
  type ChunkOp,
  type DispositionEntry,
} from '../dispositions.js';
import { coversUniqueKey, parseMigrations, type MigrationSchema } from './migrationSchema.js';

/** `users.id` references today (69) plus `account_deletion_reauth_grants.user_id` (this change). */
const EXPECTED_USER_FK_COUNT = 70;
const key = (e: { table: string; column: string }): string => `${e.table}.${e.column}`;

const schema: MigrationSchema = parseMigrations();

const MULTI_KEY_ENTRIES = [
  'trip_food_lists.added_by',
  'trip_experience_lists.added_by',
  'trip_booking_window_done.marked_by',
  'food_list_shares.shared_by_user_id',
  'experience_list_shares.shared_by_user_id',
  'trip_reactions.member_id',
];

const ctx = { userId: 'user-1', tombstoneId: 'deadc0de-1111-4222-8333-444455556666', chunkRows: 500 };

/** The chunk op an entry's disposition is executed with (anonymize_then_delete has two). */
const opsFor = (e: DispositionEntry): ChunkOp[] => {
  switch (e.disposition) {
    case 'delete':
    case 'session':
      return ['delete'];
    case 'nullify':
      return ['nullify'];
    case 'anonymize':
      return ['anonymize'];
    case 'anonymize_then_delete':
      return ['anonymize_retained', 'delete'];
    case 'trip':
      return [];
  }
};

describe('disposition registry shape', () => {
  it('has one entry per table.column, with no duplicates', () => {
    const keys = DISPOSITIONS.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every entry a disposition, a stage consistent with it, and non-empty chunkColumns', () => {
    for (const e of DISPOSITIONS) {
      expect(['delete', 'anonymize', 'anonymize_then_delete', 'nullify', 'trip', 'session']).toContain(e.disposition);
      expect(e.chunkColumns.length, key(e)).toBeGreaterThan(0);
      if (e.disposition === 'trip') expect(e.stage).toBe(2);
      else if (e.disposition === 'anonymize' || e.disposition === 'anonymize_then_delete') expect(e.stage).toBe(3);
      else expect(e.stage).toBe(4);
    }
  });

  it('has exactly one trip entry, trips.creator_id', () => {
    expect(columnsBy('trip').map(key)).toEqual(['trips.creator_id']);
  });

  it('requires retainWhere and blank on anonymize_then_delete entries and forbids them elsewhere', () => {
    for (const e of DISPOSITIONS) {
      if (e.disposition === 'anonymize_then_delete') {
        expect(e.retainWhere, key(e)).toBeTruthy();
        expect(e.blank?.length ?? 0, key(e)).toBeGreaterThan(0);
      } else {
        expect(e.retainWhere, key(e)).toBeUndefined();
        expect(e.blank, key(e)).toBeUndefined();
      }
    }
    expect(columnsBy('anonymize_then_delete').map(key)).toEqual(['experience_logs.user_id']);
  });

  it('only nullifies columns that are nullable', () => {
    for (const e of columnsBy('nullify')) expect(e.nullable, key(e)).toBe(true);
  });

  it('columnsBy accepts one disposition or several, in registry order', () => {
    const one = columnsBy('session');
    expect(one.map(key)).toEqual(['sessions.user_id']);
    const both = columnsBy(['trip', 'session']);
    expect(both.map(key)).toEqual(DISPOSITIONS.filter((e) => e.disposition === 'trip' || e.disposition === 'session').map(key));
    expect(columnsBy([]).length).toBe(0);
  });

  it('sends the two NO ACTION columns to nullify (they block DELETE FROM users today)', () => {
    const blockers = DISPOSITIONS.filter((e) => e.today === 'no_action');
    expect(blockers.map(key).sort()).toEqual([
      'food_items.created_by_user_id',
      'user_submitted_locations.created_by_user_id',
    ]);
    for (const e of blockers) expect(e.disposition).toBe('nullify');
  });

  it('keeps money rows (expenses, shares, settlements, guests) as anonymize, never delete', () => {
    for (const table of ['expenses', 'expense_shares', 'expense_tier_counts', 'expense_item_assignees', 'expense_refunds', 'settlements', 'trip_guests']) {
      const rows = DISPOSITIONS.filter((e) => e.table === table);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const r of rows) expect(r.disposition, key(r)).toBe('anonymize');
    }
  });

  it('SOFT_REFERENCES is non-empty, fully described, and names no foreign-key column', () => {
    expect(SOFT_REFERENCES.length).toBeGreaterThan(0);
    const fkKeys = new Set(schema.userForeignKeys.map(key));
    for (const s of SOFT_REFERENCES) {
      expect(s.where && s.holds && s.fate).toBeTruthy();
      const first = /^(\w+\.\w+)/.exec(s.where)?.[1];
      if (first) expect(fkKeys.has(first), s.where).toBe(false);
    }
    expect(SOFT_REFERENCES.some((s) => s.where.startsWith('users.placeholder_id'))).toBe(true);
  });
});

describe('Property 11: the disposition registry is complete and consistent with the schema', () => {
  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('parses the expected number of user foreign keys (a silent parser regression fails here)', () => {
    expect(schema.userForeignKeys.length).toBe(EXPECTED_USER_FK_COUNT);
    expect(DISPOSITIONS.length).toBe(EXPECTED_USER_FK_COUNT);
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('registry table.column set equals the set parsed from REFERENCES users(id), in both directions', () => {
    const parsed = new Set(schema.userForeignKeys.map(key));
    const registry = new Set(DISPOSITIONS.map(key));
    const missing = [...parsed].filter((k) => !registry.has(k));
    const invented = [...registry].filter((k) => !parsed.has(k));
    expect(missing, `columns referencing users(id) with no registry entry: ${missing.join(', ')}`).toEqual([]);
    expect(invented, `registry entries for columns that do not reference users(id): ${invented.join(', ')}`).toEqual([]);
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it("each entry's today and nullable match the parsed ON DELETE behaviour and column nullability", () => {
    const parsed = new Map(schema.userForeignKeys.map((f) => [key(f), f]));
    for (const e of DISPOSITIONS) {
      const fk = parsed.get(key(e))!;
      expect(e.today, key(e)).toBe(fk.onDelete);
      expect(e.nullable, key(e)).toBe(fk.nullable);
    }
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('every chunk column exists on its table, and chunk columns + the user column contain a whole primary or unique key', () => {
    for (const e of DISPOSITIONS) {
      const table = schema.tables.get(e.table);
      expect(table, `table ${e.table} not found in migrations`).toBeDefined();
      for (const c of e.chunkColumns) {
        expect(table!.columns.has(c), `${key(e)}: chunk column ${c} does not exist on ${e.table}`).toBe(true);
      }
      expect(
        coversUniqueKey(table!, [...e.chunkColumns, e.column]),
        `${key(e)}: chunkColumns [${e.chunkColumns}] + ${e.column} contain no primary/unique key of ${e.table} ` +
          `(pk=[${table!.primaryKey}], unique=${JSON.stringify(table!.uniques)})`,
      ).toBe(true);
    }
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it("defaults to ['id'] only for tables that declare id as their primary key", () => {
    for (const e of DISPOSITIONS) {
      if (e.chunkColumns.length === 1 && e.chunkColumns[0] === 'id') {
        expect(schema.tables.get(e.table)!.primaryKey, key(e)).toEqual(['id']);
      }
    }
    // The 25 tables the design names as having no surrogate id: each of them has its own explicit chunk key.
    const noId = [
      'profiles', 'completions', 'ratings', 'notes', 'friendships', 'share_recipients', 'share_reactions',
      'notification_preferences', 'trip_memberships', 'trip_reactions', 'food_list_shares', 'food_list_likes',
      'food_list_saves', 'trip_food_lists', 'experience_list_shares', 'experience_list_likes',
      'experience_list_saves', 'trip_experience_lists', 'experience_favorites', 'trip_booking_window_done',
      'trip_booking_reminder_mutes', 'photo_upload_bans', 'photo_upload_strikes', 'photo_upload_counters',
      'account_deletion_reauth_grants',
    ];
    expect(noId.length).toBe(25);
    for (const table of noId) {
      const rows = DISPOSITIONS.filter((e) => e.table === table);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const r of rows) expect(r.chunkColumns, key(r)).not.toEqual(['id']);
    }
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('exactly six entries have two or more chunk columns, and they alone use the per_key path', () => {
    const multi = DISPOSITIONS.filter((e) => e.chunkColumns.length >= 2).map(key).sort();
    expect(multi).toEqual([...MULTI_KEY_ENTRIES].sort());

    for (const e of DISPOSITIONS) {
      for (const op of opsFor(e)) {
        const stmt = buildChunkedStatement(e, op, ctx);
        expect(stmt.kind, `${key(e)} ${op}`).toBe(MULTI_KEY_ENTRIES.includes(key(e)) ? 'per_key' : 'single');
      }
    }
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('every built statement carries a LIMIT and uses no row-value IN', () => {
    for (const e of DISPOSITIONS) {
      for (const op of opsFor(e)) {
        const stmt = buildChunkedStatement(e, op, ctx);
        const texts = stmt.kind === 'single' ? [stmt.sql] : [stmt.selectSql];
        for (const sql of texts) {
          expect(sql, `${key(e)} ${op}`).toMatch(/\bLIMIT \$2\b/);
          expect(sql, `${key(e)} ${op}`).not.toMatch(/\(\s*\w+\s*,\s*\w+[^)]*\)\s+IN\b/i);
        }
        if (stmt.kind === 'per_key') expect(stmt.perKeySql).not.toMatch(/\bIN\b/);
      }
    }
  });

  // Feature: account-deletion, Property 11: The disposition registry is complete and consistent with the schema
  it('catches a missing registry entry: parsing a user reference that has no entry reports it', () => {
    const withoutOne = DISPOSITIONS.filter((e) => key(e) !== 'expenses.payer_id');
    const registry = new Set(withoutOne.map(key));
    const missing = schema.userForeignKeys.map(key).filter((k) => !registry.has(k));
    expect(missing).toEqual(['expenses.payer_id']);
  });
});

describe('buildChunkedStatement', () => {
  const entry = (table: string, column: string): DispositionEntry =>
    DISPOSITIONS.find((e) => e.table === table && e.column === column)!;

  it('builds a bounded single-key DELETE', () => {
    const stmt = buildChunkedStatement(entry('completions', 'user_id'), 'delete', ctx);
    expect(stmt).toEqual({
      kind: 'single',
      sql:
        'DELETE FROM completions WHERE user_id = $1 AND experience_id IN ' +
        '(SELECT experience_id FROM completions WHERE user_id = $1 ORDER BY experience_id LIMIT $2)',
      params: ['user-1', 500],
    });
  });

  it('builds a single-key nullify and anonymize with the right parameters', () => {
    const nul = buildChunkedStatement(entry('photos', 'owner_id'), 'nullify', ctx);
    expect(nul).toMatchObject({ kind: 'single', params: ['user-1', 500] });
    expect((nul as { sql: string }).sql).toMatch(/^UPDATE photos SET owner_id = NULL WHERE owner_id = \$1 AND id IN \(SELECT id FROM photos/);

    const anon = buildChunkedStatement(entry('expenses', 'payer_id'), 'anonymize', ctx);
    expect(anon).toMatchObject({ kind: 'single', params: ['user-1', 500, ctx.tombstoneId] });
    expect((anon as { sql: string }).sql).toMatch(/^UPDATE expenses SET payer_id = \$3 WHERE payer_id = \$1 AND id IN/);
  });

  it('builds the experience_logs retain statement exactly as designed, blanking note', () => {
    const stmt = buildChunkedStatement(entry('experience_logs', 'user_id'), 'anonymize_retained', ctx);
    if (stmt.kind !== 'single') throw new Error('expected a single-key statement');
    expect(stmt.sql).toBe(
      'UPDATE experience_logs SET user_id = $3, note = NULL WHERE user_id = $1 ' +
        'AND (id IN (SELECT log_id FROM trip_log_entries)) AND id IN ' +
        '(SELECT id FROM experience_logs WHERE user_id = $1 AND (id IN (SELECT log_id FROM trip_log_entries)) ORDER BY id LIMIT $2)',
    );
    expect(stmt.params).toEqual(['user-1', 500, ctx.tombstoneId]);
    // The stage-4 half is a plain bounded delete with no retain predicate.
    const del = buildChunkedStatement(entry('experience_logs', 'user_id'), 'delete', ctx);
    if (del.kind !== 'single') throw new Error('expected a single-key statement');
    expect(del.sql).not.toContain('trip_log_entries');
  });

  it('builds the per_key select and one single-row statement with the documented parameter order', () => {
    const del = buildChunkedStatement(entry('trip_reactions', 'member_id'), 'delete', ctx);
    expect(del).toEqual({
      kind: 'per_key',
      selectSql:
        'SELECT target_type, target_id, reaction FROM trip_reactions WHERE member_id = $1 ' +
        'ORDER BY target_type, target_id, reaction LIMIT $2',
      selectParams: ['user-1', 500],
      perKeySql:
        'DELETE FROM trip_reactions WHERE member_id = $1 AND target_type = $2 AND target_id = $3 AND reaction = $4',
      keyColumns: ['target_type', 'target_id', 'reaction'],
    });

    const anon = buildChunkedStatement(entry('trip_food_lists', 'added_by'), 'anonymize', ctx);
    expect(anon).toMatchObject({
      kind: 'per_key',
      perKeySql: 'UPDATE trip_food_lists SET added_by = $2 WHERE added_by = $1 AND trip_id = $3 AND food_list_id = $4',
    });
  });

  it('rejects an op that does not fit the disposition, and a trip entry altogether', () => {
    expect(() => buildChunkedStatement(entry('completions', 'user_id'), 'anonymize', ctx)).toThrow(/not valid/);
    expect(() => buildChunkedStatement(entry('expenses', 'payer_id'), 'delete', ctx)).toThrow(/not valid/);
    expect(() => buildChunkedStatement(entry('trips', 'creator_id'), 'delete', ctx)).toThrow(/not valid/);
  });

  it('needs a tombstone id to anonymize, and a positive integer chunk size', () => {
    expect(() =>
      buildChunkedStatement(entry('expenses', 'payer_id'), 'anonymize', { userId: 'u', chunkRows: 500 }),
    ).toThrow(/tombstoneId/);
    for (const chunkRows of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildChunkedStatement(entry('completions', 'user_id'), 'delete', { ...ctx, chunkRows })).toThrow(RangeError);
    }
  });

  it('refuses an entry whose identifiers are not plain SQL names', () => {
    const evil: DispositionEntry = { ...entry('completions', 'user_id'), table: 'completions; DROP TABLE users' };
    expect(() => buildChunkedStatement(evil, 'delete', ctx)).toThrow(/unsafe SQL identifier/);
    const evilCol: DispositionEntry = { ...entry('completions', 'user_id'), chunkColumns: ['experience_id" OR "1"="1'] };
    expect(() => buildChunkedStatement(evilCol, 'delete', ctx)).toThrow(/unsafe SQL identifier/);
  });

  it('never puts the user id or tombstone id in the SQL text (they are always parameters)', () => {
    for (const e of DISPOSITIONS) {
      for (const op of opsFor(e)) {
        const stmt = buildChunkedStatement(e, op, ctx);
        const text = stmt.kind === 'single' ? stmt.sql : `${stmt.selectSql} ${stmt.perKeySql}`;
        expect(text).not.toContain(ctx.userId);
        expect(text).not.toContain(ctx.tombstoneId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property 28: the cascade audit
// ---------------------------------------------------------------------------

interface Pair {
  readonly from: string;
  readonly to: string;
}

/**
 * Walks every `ON DELETE CASCADE` edge reachable from the table of a `delete`, `session` or
 * `anonymize_then_delete` entry and returns the edges that land on an `anonymize`, `nullify` or `trip`
 * target without being (a) exempt or (b) covered because the parent table is an `anonymize_then_delete`
 * entry (its dependent rows are re-pointed first).
 */
function auditCascades(
  exempt: readonly Pair[],
  s: MigrationSchema = schema,
  registry: readonly DispositionEntry[] = DISPOSITIONS,
): Pair[] {
  const by = (...kinds: DispositionEntry['disposition'][]): DispositionEntry[] =>
    registry.filter((e) => kinds.includes(e.disposition));
  const targets = new Set(by('anonymize', 'nullify', 'trip').map((e) => e.table));
  const covered = new Set(by('anonymize_then_delete').map((e) => e.table));
  const exemptKeys = new Set(exempt.map((p) => `${p.from}->${p.to}`));

  const childrenOf = new Map<string, string[]>();
  for (const edge of s.cascadeEdges) {
    childrenOf.set(edge.parent, [...(childrenOf.get(edge.parent) ?? []), edge.child]);
  }

  const starts = new Set(by('delete', 'session', 'anonymize_then_delete').map((e) => e.table));
  const violations = new Map<string, Pair>();
  const seenEdges = new Set<string>();
  for (const start of starts) {
    const queue = [start];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const child of childrenOf.get(parent) ?? []) {
        const edgeKey = `${parent}->${child}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        if (covered.has(parent)) continue; // (b): the survivors were re-pointed before the delete
        if (targets.has(child) && !exemptKeys.has(edgeKey)) violations.set(edgeKey, { from: parent, to: child });
        queue.push(child);
      }
    }
  }
  return [...violations.values()].sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
}

describe('Property 28: no delete statement destroys a row a survivor depends on', () => {
  const FOUR = [
    { from: 'experience_lists', to: 'experience_lists_items' },
    { from: 'experience_lists', to: 'trip_experience_lists' },
    { from: 'food_lists', to: 'food_lists_items' },
    { from: 'food_lists', to: 'trip_food_lists' },
  ];

  // Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
  it('is green with the four shipped exemptions', () => {
    expect(auditCascades(CASCADE_AUDIT_EXEMPT)).toEqual([]);
  });

  // Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
  it('with an empty exemption list it reports exactly the four list pairs (both needed and sufficient)', () => {
    expect(auditCascades([])).toEqual(FOUR);
  });

  // Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
  it('ships exactly four exemptions, each with a reason, naming tables that exist and a cascade the parser finds', () => {
    expect(CASCADE_AUDIT_EXEMPT.length).toBe(4);
    expect([...CASCADE_AUDIT_EXEMPT].map(({ from, to }) => ({ from, to })).sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`))).toEqual(FOUR);
    for (const x of CASCADE_AUDIT_EXEMPT) {
      expect(x.reason.trim().length, `${x.from}->${x.to}`).toBeGreaterThan(0);
      expect(schema.tables.has(x.from), `table ${x.from}`).toBe(true);
      expect(schema.tables.has(x.to), `table ${x.to}`).toBe(true);
      expect(
        schema.cascadeEdges.some((c) => c.parent === x.from && c.child === x.to),
        `no ON DELETE CASCADE from ${x.from} to ${x.to} in the migrations (stale exemption)`,
      ).toBe(true);
    }
  });

  // Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
  it('covers the experience_logs -> trip_log_entries hazard through anonymize_then_delete, not an exemption', () => {
    expect(schema.cascadeEdges.some((c) => c.parent === 'experience_logs' && c.child === 'trip_log_entries')).toBe(true);
    expect(columnsBy('anonymize_then_delete').map((e) => e.table)).toContain('experience_logs');
    expect(CASCADE_AUDIT_EXEMPT.some((x) => x.from === 'experience_logs')).toBe(false);
    // Remove the cover (make experience_logs a plain delete) and the audit reports the hazard.
    const withoutCover = DISPOSITIONS.map((e) =>
      e.table === 'experience_logs'
        ? { table: e.table, column: e.column, stage: 4 as const, chunkColumns: e.chunkColumns, today: e.today, nullable: e.nullable, disposition: 'delete' as const }
        : e,
    );
    expect(auditCascades(CASCADE_AUDIT_EXEMPT, schema, withoutCover)).toEqual([
      { from: 'experience_logs', to: 'trip_log_entries' },
    ]);
  });

  // Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
  it('a future cascade into a retained table is caught: an extra cascade edge fails the audit', () => {
    const before = schema.cascadeEdges.length;
    // Simulate a new migration: sessions would cascade into `expenses` (an anonymize target).
    const extended: MigrationSchema = {
      ...schema,
      cascadeEdges: [...schema.cascadeEdges, { parent: 'sessions', child: 'expenses', column: 'session_id' }],
    };
    expect(extended.cascadeEdges.length).toBe(before + 1);
    // The audit follows cascades transitively, so the new edge and what hangs below expenses are all reported.
    const violations = auditCascades(CASCADE_AUDIT_EXEMPT, extended);
    expect(violations).toContainEqual({ from: 'sessions', to: 'expenses' });
    expect(violations).toContainEqual({ from: 'expenses', to: 'expense_shares' });
    expect(auditCascades(CASCADE_AUDIT_EXEMPT)).toEqual([]);
  });
});
