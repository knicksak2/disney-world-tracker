#!/usr/bin/env node
import * as fs from 'fs';
import { parseSeedEntries } from '../services/mickeys/domain/seedParse.js';
import { validateAliasLinks, type AliasLink } from '../services/mickeys/domain/aliasGroup.js';
import { getPool, closePool } from '../db/pool.js';

export interface ImportDbClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number }>;
}

export interface RawAliasEntry {
  readonly aliasUpstreamEntityId: string;
  readonly canonicalUpstreamEntityId: string;
}

export interface ImportHiddenMickeysDeps {
  readonly db: ImportDbClient;
  readonly seedFilePath?: string | undefined;
  readonly aliasesFilePath?: string | undefined;
  readonly approve?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly readFile?: ((filePath: string, encoding: 'utf8') => Promise<string>) | undefined;
  readonly log?: ((msg: string) => void) | undefined;
  readonly warn?: ((msg: string) => void) | undefined;
  readonly error?: ((msg: string) => void) | undefined;
}

export interface SeedImportReport {
  readonly totalRead: number;
  readonly validParsed: number;
  readonly duplicatesCollapsed: number;
  readonly invalidEntries: number;
  readonly resolved: number;
  readonly unresolved: number;
  readonly inserted: number;
  readonly skippedConflict: number;
}

export interface AliasImportReport {
  readonly totalRead: number;
  readonly validResolved: number;
  readonly unresolved: number;
  readonly invalid: number;
  readonly inserted: number;
  readonly alreadyLinked: number;
}

export interface ImportHiddenMickeysResult {
  readonly dryRun: boolean;
  readonly statusUsed: 'pending' | 'approved';
  readonly seedReport?: SeedImportReport | undefined;
  readonly aliasReport?: AliasImportReport | undefined;
}

/**
 * Runs the Hidden Mickeys seed and alias importer (Requirements 12.1-12.10, 16.1, 16.2).
 */
export async function runImportHiddenMickeys(
  deps: ImportHiddenMickeysDeps,
): Promise<ImportHiddenMickeysResult> {
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;
  const error = deps.error ?? console.error;
  const readFile = deps.readFile ?? fs.promises.readFile;
  const dryRun = Boolean(deps.dryRun);
  const statusUsed = deps.approve ? 'approved' : 'pending';

  let aliasReport: AliasImportReport | undefined;
  let seedReport: SeedImportReport | undefined;

  // 1. Process aliases if aliasesFilePath is provided
  if (deps.aliasesFilePath) {
    log(`Reading aliases file: ${deps.aliasesFilePath}`);
    const aliasContent = await readFile(deps.aliasesFilePath, 'utf8');
    let rawAliases: unknown;
    try {
      rawAliases = JSON.parse(aliasContent);
    } catch (err: any) {
      error(`Failed to parse JSON from aliases file ${deps.aliasesFilePath}: ${err.message}`);
      throw err;
    }

    if (!Array.isArray(rawAliases)) {
      throw new Error(`Aliases file must contain a JSON array: ${deps.aliasesFilePath}`);
    }

    let unresolvedCount = 0;
    const resolvedCandidates: AliasLink[] = [];
    const seenAliasUpstreams = new Set<string>();

    for (let i = 0; i < rawAliases.length; i++) {
      const entry = rawAliases[i] as Partial<RawAliasEntry>;
      if (
        !entry ||
        typeof entry.aliasUpstreamEntityId !== 'string' ||
        !entry.aliasUpstreamEntityId.trim() ||
        typeof entry.canonicalUpstreamEntityId !== 'string' ||
        !entry.canonicalUpstreamEntityId.trim()
      ) {
        warn(`[WARN] Skipping malformed alias entry at index ${i}: ${JSON.stringify(entry)}`);
        unresolvedCount++;
        continue;
      }

      const aliasUpstream = entry.aliasUpstreamEntityId.trim();
      const canonicalUpstream = entry.canonicalUpstreamEntityId.trim();

      // Dedupe candidates by alias upstream first within file
      if (seenAliasUpstreams.has(aliasUpstream)) {
        warn(`[WARN] Duplicate alias entry for ${aliasUpstream} in file; skipping duplicate.`);
        continue;
      }
      seenAliasUpstreams.add(aliasUpstream);

      // Resolve alias upstream
      const aliasRes = await deps.db.query(
        `SELECT id FROM experiences WHERE upstream_entity_id = $1`,
        [aliasUpstream],
      );
      if (aliasRes.rows.length !== 1) {
        warn(
          `[WARN] Alias experience unresolved (${aliasRes.rows.length} matches) for upstream_entity_id: ${aliasUpstream}`,
        );
        unresolvedCount++;
        continue;
      }

      // Resolve canonical upstream
      const canonRes = await deps.db.query(
        `SELECT id FROM experiences WHERE upstream_entity_id = $1`,
        [canonicalUpstream],
      );
      if (canonRes.rows.length !== 1) {
        warn(
          `[WARN] Canonical experience unresolved (${canonRes.rows.length} matches) for upstream_entity_id: ${canonicalUpstream}`,
        );
        unresolvedCount++;
        continue;
      }

      resolvedCandidates.push({
        aliasId: aliasRes.rows[0].id,
        canonicalId: canonRes.rows[0].id,
      });
    }

    // Load existing stored alias links
    const existingRes = await deps.db.query(
      `SELECT alias_experience_id AS "aliasId", canonical_experience_id AS "canonicalId" FROM mickey_experience_aliases`,
    );
    const existingLinks: AliasLink[] = existingRes.rows.map((r: any) => ({
      aliasId: r.aliasId,
      canonicalId: r.canonicalId,
    }));

    const validation = validateAliasLinks(resolvedCandidates, existingLinks);
    let alreadyLinkedAliases = 0;
    let invalidCount = 0;

    for (const rej of validation.rejected) {
      if (rej.reason === 'already_linked') {
        alreadyLinkedAliases++;
        log(`[INFO] Alias already linked: alias=${rej.link.aliasId}, canonical=${rej.link.canonicalId}`);
      } else {
        invalidCount++;
        warn(
          `[WARN] Invalid alias link rejected (${rej.reason}): alias=${rej.link.aliasId}, canonical=${rej.link.canonicalId}`,
        );
      }
    }

    let insertedAliases = 0;

    if (!dryRun) {
      for (const link of validation.accepted) {
        const insertRes = await deps.db.query(
          `INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
           VALUES ($1, $2)
           ON CONFLICT (alias_experience_id) DO NOTHING
           RETURNING alias_experience_id`,
          [link.aliasId, link.canonicalId],
        );
        if ((insertRes.rowCount ?? insertRes.rows.length) > 0) {
          insertedAliases++;
        } else {
          alreadyLinkedAliases++;
        }
      }
    } else {
      log(`[DRY-RUN] Would attempt to insert ${validation.accepted.length} accepted alias links.`);
    }

    aliasReport = {
      totalRead: rawAliases.length,
      validResolved: resolvedCandidates.length,
      unresolved: unresolvedCount,
      invalid: invalidCount,
      inserted: insertedAliases,
      alreadyLinked: alreadyLinkedAliases,
    };

    log(
      `Alias import pass complete: ${aliasReport.inserted} inserted, ${aliasReport.alreadyLinked} already linked, ` +
        `${aliasReport.invalid} invalid, ${aliasReport.unresolved} unresolved (Total read: ${aliasReport.totalRead})`,
    );
  }

  // 2. Process seed entries if seedFilePath is provided
  if (deps.seedFilePath) {
    log(`Reading seed file: ${deps.seedFilePath}`);
    const seedContent = await readFile(deps.seedFilePath, 'utf8');
    let rawSeed: unknown;
    try {
      rawSeed = JSON.parse(seedContent);
    } catch (err: any) {
      error(`Failed to parse JSON from seed file ${deps.seedFilePath}: ${err.message}`);
      throw err;
    }

    const parseResult = parseSeedEntries(rawSeed);
    for (const inv of parseResult.invalid) {
      warn(
        `[WARN] Invalid seed entry at index ${inv.index} (${inv.seedKey ?? 'no key'}): ${inv.reason}`,
      );
    }
    for (const dup of parseResult.duplicates) {
      warn(`[WARN] Duplicate seedKey collapsed to first occurrence: ${dup.seedKey}`);
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let insertedCount = 0;
    let skippedConflictCount = 0;

    // Fetch existing seed keys to identify conflicts reliably
    const existingSeedsRes = await deps.db.query(
      `SELECT seed_key FROM hidden_mickeys WHERE seed_key IS NOT NULL`,
    );
    const existingSeedKeys = new Set<string>(existingSeedsRes.rows.map((r: any) => r.seed_key));

    for (const entry of parseResult.valid) {
      if (existingSeedKeys.has(entry.seedKey)) {
        skippedConflictCount++;
        continue;
      }

      let experienceId: string | null = null;

      if (entry.upstreamEntityId) {
        const res = await deps.db.query(
          `SELECT id FROM experiences WHERE upstream_entity_id = $1`,
          [entry.upstreamEntityId],
        );
        if (res.rows.length === 1) {
          experienceId = res.rows[0].id;
        } else {
          warn(
            `[WARN] Experience unresolved by upstream_entity_id '${entry.upstreamEntityId}' (${res.rows.length} matches) for seedKey '${entry.seedKey}'`,
          );
        }
      } else if (entry.experienceName) {
        const res = await deps.db.query(
          `SELECT id FROM experiences WHERE name = $1 AND ((park IS NULL AND $2 IS NULL) OR park = $2)`,
          [entry.experienceName, entry.park],
        );
        if (res.rows.length === 1) {
          experienceId = res.rows[0].id;
        } else {
          warn(
            `[WARN] Experience unresolved by name '${entry.experienceName}' + park '${entry.park}' (${res.rows.length} matches) for seedKey '${entry.seedKey}'`,
          );
        }
      }

      if (!experienceId) {
        unresolvedCount++;
        continue;
      }

      resolvedCount++;

      if (!dryRun) {
        // `ON CONFLICT DO NOTHING` has no conflict target on purpose. seed_key is protected by a PARTIAL unique
        // index (`WHERE seed_key IS NOT NULL`), and real Postgres rejects `ON CONFLICT (seed_key)` against a
        // partial index (42P10) unless the predicate is repeated, while pg-mem cannot parse the repeated predicate.
        // A targetless clause skips on any unique violation and works on both. Existing keys are already skipped
        // above, so this is only the backstop for a concurrent run.
        const insertRes = await deps.db.query(
          `INSERT INTO hidden_mickeys (
             id, experience_id, zone, difficulty, clue_1, clue_2, reveal,
             status, official, source, seed_key
           ) VALUES (
             gen_random_uuid(), $1, $2, $3, $4, $5, $6,
             $7, TRUE, 'seed', $8
           )
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            experienceId,
            entry.zone,
            entry.difficulty,
            entry.clue1,
            entry.clue2,
            entry.reveal,
            statusUsed,
            entry.seedKey,
          ],
        );

        if ((insertRes.rowCount ?? insertRes.rows.length) > 0) {
          insertedCount++;
          existingSeedKeys.add(entry.seedKey);
        } else {
          skippedConflictCount++;
        }
      }
    }

    seedReport = {
      totalRead: Array.isArray(rawSeed) ? rawSeed.length : 0,
      validParsed: parseResult.valid.length,
      duplicatesCollapsed: parseResult.duplicates.length,
      invalidEntries: parseResult.invalid.length,
      resolved: resolvedCount,
      unresolved: unresolvedCount,
      inserted: insertedCount,
      skippedConflict: skippedConflictCount,
    };

    log(
      `Seed import pass complete (${statusUsed}): ${seedReport.inserted} inserted, ${seedReport.skippedConflict} skipped (already exists), ` +
        `${seedReport.unresolved} unresolved, ${seedReport.invalidEntries} invalid, ${seedReport.duplicatesCollapsed} duplicate keys collapsed ` +
        `(Total read: ${seedReport.totalRead}; resolved to an Experience: ${seedReport.resolved}${dryRun ? ' - these would be inserted' : ''})`,
    );
  }

  if (dryRun) {
    log(`[DRY-RUN] Finished without modifying database.`);
  }

  return {
    dryRun,
    statusUsed,
    seedReport,
    aliasReport,
  };
}

// CLI entrypoint
if (
  process.argv[1] &&
  (process.argv[1].endsWith('importHiddenMickeys.ts') || process.argv[1].endsWith('importHiddenMickeys.js'))
) {
  const args = process.argv.slice(2);
  let seedFilePath: string | undefined;
  let aliasesFilePath: string | undefined;
  let approve = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--seed' && i + 1 < args.length) {
      seedFilePath = args[++i];
    } else if (arg === '--aliases' && i + 1 < args.length) {
      aliasesFilePath = args[++i];
    } else if (arg === '--approve') {
      approve = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('--') && !seedFilePath) {
      seedFilePath = arg;
    }
  }

  if (!seedFilePath && !aliasesFilePath) {
    console.error(
      'Usage: npx ts-node src/scripts/importHiddenMickeys.ts [--seed <file.json>] [--aliases <aliases.json>] [--approve] [--dry-run]',
    );
    process.exit(1);
  }

  const pool = getPool();
  runImportHiddenMickeys({
    db: pool,
    seedFilePath,
    aliasesFilePath,
    approve,
    dryRun,
  })
    .catch((err) => {
      console.error('Import failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await closePool();
    });
}
