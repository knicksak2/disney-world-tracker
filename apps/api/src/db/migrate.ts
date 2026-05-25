#!/usr/bin/env node
/**
 * Hand-rolled SQL migration runner.
 *
 * Discovers `*.sql` files in `apps/api/migrations/`, applies them in
 * lexicographic order, and records each successfully-applied file in a
 * `schema_migrations` bookkeeping table so re-runs are idempotent.
 *
 * Each migration runs inside a single transaction. If a migration fails,
 * the transaction is rolled back and the runner exits non-zero with the
 * offending file name in the error message. Already-applied migrations
 * are skipped.
 *
 * Usage:
 *   npm run migrate            # apply all pending migrations
 *
 * Migration filenames must match `NNNN_<name>.sql` (e.g. `0001_init.sql`)
 * so that lexicographic sort matches intended order.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { closePool, getPool } from "./pool.js";

const FILE_NAME_PATTERN = /^\d{4,}_[a-z0-9_-]+\.sql$/i;

/** Resolve the migrations directory relative to this source file. */
function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db/migrate.ts -> ../../migrations (relative to apps/api)
  return resolve(here, "..", "..", "migrations");
}

interface MigrationFile {
  readonly name: string;
  readonly absolutePath: string;
  readonly sql: string;
  readonly checksum: string;
}

async function loadMigrationFiles(dir: string): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const sqlFiles = entries
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const name of sqlFiles) {
    if (!FILE_NAME_PATTERN.test(name)) {
      throw new Error(
        `Migration file name "${name}" does not match required pattern NNNN_<name>.sql`,
      );
    }
  }

  const files: MigrationFile[] = [];
  for (const name of sqlFiles) {
    const absolutePath = join(dir, name);
    const sql = await readFile(absolutePath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    files.push({ name, absolutePath, sql, checksum });
  }
  return files;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

interface AppliedMigrationRow {
  readonly name: string;
  readonly checksum: string;
}

async function loadAppliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<AppliedMigrationRow>(
    "SELECT name, checksum FROM schema_migrations",
  );
  const applied = new Map<string, string>();
  for (const row of result.rows) {
    applied.set(row.name, row.checksum);
  }
  return applied;
}

async function applyMigration(client: PoolClient, file: MigrationFile): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(file.sql);
    await client.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
      [file.name, file.checksum],
    );
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors so the original cause surfaces.
    }
    throw err;
  }
}

export interface MigrateResult {
  readonly applied: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

/**
 * Apply all pending migrations from the migrations directory.
 * Returns the names of applied and skipped (already-applied) migrations.
 */
export async function migrate(): Promise<MigrateResult> {
  const migrationsDir = resolveMigrationsDir();
  const files = await loadMigrationFiles(migrationsDir);

  if (files.length === 0) {
    return { applied: [], skipped: [] };
  }

  const pool = getPool();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const alreadyApplied = await loadAppliedMigrations(client);

    for (const file of files) {
      const previousChecksum = alreadyApplied.get(file.name);
      if (previousChecksum !== undefined) {
        if (previousChecksum !== file.checksum) {
          throw new Error(
            `Checksum mismatch for already-applied migration "${file.name}": ` +
              `previously ${previousChecksum}, now ${file.checksum}. ` +
              "Migrations must not be modified after they are applied.",
          );
        }
        skipped.push(file.name);
        continue;
      }

      await applyMigration(client, file);
      applied.push(file.name);
    }
  } finally {
    client.release();
  }

  return { applied, skipped };
}

async function main(): Promise<void> {
  try {
    const result = await migrate();
    if (result.applied.length === 0) {
      console.log(
        `[migrate] no pending migrations (${result.skipped.length} already applied)`,
      );
    } else {
      for (const name of result.applied) {
        console.log(`[migrate] applied ${name}`);
      }
      console.log(
        `[migrate] done: ${result.applied.length} applied, ${result.skipped.length} skipped`,
      );
    }
  } finally {
    await closePool();
  }
}

// Run as a CLI when invoked directly. The check tolerates Windows path quirks
// in `process.argv[1]` by comparing resolved paths.
const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return resolve(arg) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  });
}
