/**
 * Structural / smoke checks for the Planned List Completion Sync model
 * constraints.
 *
 * Planned List Completion Sync is a **presentation and derivation layer** on
 * top of the shipped Trips feature: it adds no migration, no table, no column,
 * no stored link between a `Planned_Item` and a `Trip_Log_Entry`, and no new
 * endpoint. The `Planned_Item_Completion_State`, the `Planned_List_Progress`,
 * and the summary planned counts are all derived at read time. These tests
 * pin those model-preservation guarantees to the actual source-of-truth files
 * (the migrations, the shared DTO module, and the Trip routes) with
 * filesystem/string-based structural assertions, so a future change that
 * quietly persists the derived state — a new migration, a completion column on
 * `planned_items`, a `PlannedItemDTO` completion field, a join table, or a new
 * planned-completion route — fails loudly here.
 *
 * Validates: Requirements 2.6, 6.1, 6.2, 6.3, 6.4
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → trips → services → src → apps/api
const apiRoot = resolve(here, '..', '..', '..', '..');
// apps/api → apps → repo root
const repoRoot = resolve(apiRoot, '..', '..');

const migrationsDir = resolve(apiRoot, 'migrations');
const routesPath = resolve(here, '..', 'routes.ts');
const sharedTripsPath = resolve(repoRoot, 'packages', 'shared', 'src', 'trips.ts');
const sharedPlannedCompletionPath = resolve(
  repoRoot,
  'packages',
  'shared',
  'src',
  'plannedCompletion.ts',
);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** All `NNNN_*.sql` migration files, ascending by their numeric prefix. */
function migrationFiles(): { readonly name: string; readonly num: number }[] {
  return readdirSync(migrationsDir)
    .map((name) => {
      const match = /^(\d{4})_.*\.sql$/u.exec(name);
      return match ? { name, num: Number(match[1]) } : null;
    })
    .filter((m): m is { name: string; num: number } => m !== null)
    .sort((a, b) => a.num - b.num);
}

/** Extract the body of a `CREATE TABLE <name> ( ... );` block from SQL. */
function tableBody(sql: string, table: string): string | null {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\)\\s*;`,
    'iu',
  );
  const match = re.exec(sql);
  return match?.[1] ?? null;
}

/** Extract the body of an `export interface <name> { ... }` block from TS. */
function interfaceBody(ts: string, name: string): string | null {
  const re = new RegExp(
    `export\\s+interface\\s+${name}\\s*(?:extends[^\\{]+)?\\{([\\s\\S]*?)\\n\\}`,
    'u',
  );
  const match = re.exec(ts);
  return match?.[1] ?? null;
}

/** All route path literals registered on the Fastify instance in `routes.ts`. */
function registeredRoutePaths(ts: string): string[] {
  const re = /app\.(?:get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*'([^']+)'/gu;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(ts)) !== null) {
    if (match[1] !== undefined) {
      paths.push(match[1]);
    }
  }
  return paths;
}

// A completion-ish column/field name this feature must never introduce.
const COMPLETION_TOKEN = /(complet|is_done|\bdone\b|completion_state)/iu;

// ---------------------------------------------------------------------------
// Constraint 1: no new migration / table / column / join table (R6.1, R6.2)
// ---------------------------------------------------------------------------

describe('Planned List Completion Sync — migration / schema is unchanged', () => {
  it('introduces no planned-completion migration; any migration beyond 0015 is unrelated', () => {
    const migrations = migrationFiles();
    expect(migrations.length).toBeGreaterThan(0);

    // 0015_trips.sql is the Trips feature's own migration and must exist.
    expect(migrations.some((m) => m.name === '0015_trips.sql')).toBe(true);

    // The Planned List Completion Sync feature is derived-only: it adds no
    // migration of its own. Later migrations (0016+) may exist for OTHER
    // features, but none may concern planned-list completion — the invariant
    // this guard really protects. (The per-file token scan below is the
    // exhaustive check; this asserts the same for any post-0015 migration.)
    for (const m of migrations.filter((mm) => mm.num > 15)) {
      const sql = read(resolve(migrationsDir, m.name));
      // Strip the pre-existing `completion_logged` Trip_Feed_Item type literal
      // before the completion-token scan: it is a Trips feed-item type (present
      // since 0015) that later migrations legitimately reference when they touch
      // the trip_feed_items type constraint, and it has nothing to do with
      // planned-list completion — the concept this guard actually protects.
      const scanned = sql.replace(/completion_logged/giu, '');
      // NOTE: a later migration may legitimately touch `planned_items` for
      // reasons unrelated to completion — the day-planning-optimization feature
      // adds scheduling columns (planned_date, is_fixed, priority, item_type,
      // …) in `0019_planned_item_scheduling.sql`. What this guard actually
      // protects is that no migration persists a *completion* state or a stored
      // Planned_Item↔Trip_Log_Entry link, so the invariant is enforced by the
      // completion-token scan (below) plus the join-table check further down —
      // not by banning every mention of `planned_items`.
      expect(scanned).not.toMatch(COMPLETION_TOKEN);
    }
  });

  it('has no migration referencing planned-completion-sync or a stored completion link', () => {
    for (const { name } of migrationFiles()) {
      const sql = read(resolve(migrationsDir, name));
      // No migration mentions this feature or a persisted planned-completion concept.
      expect(sql).not.toMatch(/planned[_-]?completion/iu);
      expect(sql).not.toMatch(/completion[_-]?sync/iu);
    }
  });

  it('keeps the planned_items table at its original five columns with no completion/state/link column', () => {
    const sql = read(resolve(migrationsDir, '0015_trips.sql'));
    const body = tableBody(sql, 'planned_items');
    expect(body).not.toBeNull();

    // The column names declared on planned_items (excludes CONSTRAINT lines).
    const columns = (body as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^CONSTRAINT\b/iu.test(line))
      .map((line) => /^([a-z_]+)\b/iu.exec(line)?.[1])
      .filter((c): c is string => Boolean(c));

    expect(columns.sort()).toEqual(
      ['added_by', 'created_at', 'experience_id', 'id', 'trip_id'].sort(),
    );

    // No completion / state column, and no stored link to a log entry.
    for (const column of columns) {
      expect(column).not.toMatch(COMPLETION_TOKEN);
      expect(column).not.toMatch(/log_entry/iu);
    }
  });

  it('has no join table linking planned_items and trip_log_entries', () => {
    for (const { name } of migrationFiles()) {
      const sql = read(resolve(migrationsDir, name));
      const createTableRe = /CREATE\s+TABLE\s+([a-z_]+)\s*\(([\s\S]*?)\n\)\s*;/giu;
      let match: RegExpExecArray | null;
      while ((match = createTableRe.exec(sql)) !== null) {
        const body = match[2] ?? '';
        const referencesPlanned = /\bplanned_items\b/iu.test(body);
        const referencesLog = /\btrip_log_entries\b/iu.test(body);
        // No single table body references BOTH — that would be a stored link
        // between a Planned_Item and a Trip_Log_Entry (R6.1, R6.2).
        expect(referencesPlanned && referencesLog).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Constraint 2: PlannedItemDTO carries no completion field (R2.6, R6.3)
// ---------------------------------------------------------------------------

describe('Planned List Completion Sync — derived state lives off the persisted DTO', () => {
  it('PlannedItemDTO exposes only its original fields and no completion field', () => {
    const ts = read(sharedTripsPath);
    const body = interfaceBody(ts, 'PlannedItemDTO');
    expect(body).not.toBeNull();

    const fields = (body as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly '))
      .map((line) => /readonly\s+([A-Za-z0-9_]+)\s*[?:]/u.exec(line)?.[1])
      .filter((f): f is string => Boolean(f));

    expect(fields.sort()).toEqual(
      [
        'addedByDisplayName',
        'customTitle',
        'durationMinutes',
        'experienceId',
        'experienceName',
        'id',
        'isFixed',
        'isLightningLane',
        'itemType',
        'mealPeriod',
        'optimizedAt',
        'park',
        'plannedDate',
        'plannedTime',
        'predictedWaitMinutes',
        'priority',
        'scheduledShowtime',
        'servedMealPeriods',
        'travelFromPrev',
        'useSingleRider',
        'windowEndMinutes',
        'windowStartMinutes',
      ].sort(),
    );

    for (const field of fields) {
      expect(field).not.toMatch(COMPLETION_TOKEN);
    }
  });

  it('the derived completionState lives only on the in-memory PlannedItemView, not on any persisted DTO', () => {
    // The wire/persisted DTO module must not carry the derived completion state.
    const tripsTs = read(sharedTripsPath);
    expect(tripsTs).not.toMatch(/completionState/u);

    // The derived state is defined on PlannedItemView in the pure derivation module.
    const derivationTs = read(sharedPlannedCompletionPath);
    const viewBody = interfaceBody(derivationTs, 'PlannedItemView');
    expect(viewBody).not.toBeNull();
    expect(viewBody as string).toMatch(/completionState/u);
  });
});

// ---------------------------------------------------------------------------
// Constraint 3: planned counts ride the existing summary route (R6.4)
// ---------------------------------------------------------------------------

describe('Planned List Completion Sync — planned counts add no route', () => {
  const routePaths = registeredRoutePaths(read(routesPath));

  it('reuses the four existing Trip endpoints', () => {
    expect(routePaths).toContain('/trips/:id/summary');
    expect(routePaths).toContain('/trips/:id/planned-items');
    expect(routePaths).toContain('/trips/:id/feed');
    expect(routePaths).toContain('/trips/:id/log-entries');
  });

  it('registers exactly one summary route', () => {
    const summaryRoutes = routePaths.filter((p) => p === '/trips/:id/summary');
    expect(summaryRoutes).toHaveLength(1);
  });

  it('adds no planned-completion / planned-counts route', () => {
    for (const path of routePaths) {
      expect(path).not.toMatch(/planned[_-]?completion/iu);
      expect(path).not.toMatch(/completion[_-]?sync/iu);
      expect(path).not.toMatch(/planned[_-]?counts?/iu);
      expect(path).not.toMatch(/summary\/planned/iu);
    }
  });
});
