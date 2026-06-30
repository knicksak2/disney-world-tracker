/**
 * Live_Service upstream-id resolution repository.
 *
 * Task 6.3 of the experience-live-details plan. This repo is the single
 * point of contact between the Live_Service orchestrator (`service.ts`) and
 * the one piece of relational state the live path touches: the
 * `experiences.upstream_entity_id` column (per `migrations/0001_init.sql`):
 *
 *   experiences (
 *     id                  UUID  PRIMARY KEY,
 *     upstream_entity_id  TEXT  NOT NULL UNIQUE,
 *     ...
 *   )
 *
 * The `Catalog_Service` owns and maintains this one-to-one mapping; the
 * `Live_Service` only ever READS it to resolve the upstream entity id for a
 * requested Experience (R1.1) and NEVER writes to the table. Keeping the
 * resolution behind this narrow, read-only interface means the live path
 * shares exactly one piece of state with the catalog path and cannot mutate
 * catalog data.
 *
 * Public surface:
 *
 *   - `resolveUpstreamEntityId(experienceId)` — a single
 *     `SELECT upstream_entity_id FROM experiences WHERE id = $1`. Returns the
 *     mapped upstream id when the row exists, or `null` when it is absent.
 *     A `null` result drives R1.9 in the orchestrator: the retrieval is
 *     treated as failed and the ThemeParks_Live_Endpoint is NOT requested.
 *
 * Validates: Requirements 1.1, 1.9.
 */

import type { QueryResultRow } from 'pg';

import type { DbPool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Repository surface returned by {@link createLiveRepo}. The orchestrator
 * depends on this interface (rather than a concrete pool) so tests can swap a
 * fake implementation that returns a fixed id or `null` without a database.
 */
export interface LiveRepo {
  /**
   * Resolve the upstream entity id for an internal Experience id, or `null`
   * when no mapping exists. Reads only; never writes.
   */
  resolveUpstreamEntityId(experienceId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Internal row shape
// ---------------------------------------------------------------------------

/**
 * Row shape of the single projected column. `upstream_entity_id` is
 * `TEXT NOT NULL` in the schema, so when a row exists the value is always a
 * non-null string; absence is signalled by the row itself being missing.
 */
interface UpstreamIdRow extends QueryResultRow {
  upstream_entity_id: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link LiveRepo} bound to the supplied pool. Constructor injection
 * (rather than reaching for `getPool()` at module top-level) keeps the repo
 * testable and mirrors `services/aggregate/repo.ts::createAggregateRepo`.
 */
export function createLiveRepo(pool: DbPool): LiveRepo {
  return {
    resolveUpstreamEntityId: (experienceId) =>
      resolveUpstreamEntityId(pool, experienceId),
  };
}

// ---------------------------------------------------------------------------
// resolveUpstreamEntityId
// ---------------------------------------------------------------------------

/**
 * Read the upstream entity id mapped to an internal Experience id. Returns
 * `null` when no `experiences` row exists for the id, which the orchestrator
 * treats as an unresolved mapping (R1.9). This is a pure read: it issues a
 * single parameterized SELECT and performs no writes.
 */
async function resolveUpstreamEntityId(
  pool: DbPool,
  experienceId: string,
): Promise<string | null> {
  const result = await pool.query<UpstreamIdRow>(
    `SELECT upstream_entity_id
       FROM experiences
      WHERE id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? row.upstream_entity_id : null;
}
