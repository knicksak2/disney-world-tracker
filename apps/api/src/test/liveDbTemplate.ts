import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;

export const BASE_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

const TEMPLATE_LOCK_KEY = 'dwt_test_template_lock_v1';
const TEMPLATE_PREFIX = 'dwt_test_tmpl_';

export function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function probeDatabase(url: string = BASE_DATABASE_URL): Promise<boolean> {
  const probe = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {
      /* ignore */
    });
  }
}

function getMigrationFiles(): { name: string; sql: string }[] {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({
    name,
    sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
  }));
}

function hashMigrations(files: ReadonlyArray<{ name: string; sql: string }>): string {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.name);
    h.update('\0');
    h.update(f.sql);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

async function ensureMigratedTemplate(
  adminPool: pg.Pool,
  baseUrl: string,
): Promise<string> {
  const files = getMigrationFiles();
  const templateName = `${TEMPLATE_PREFIX}${hashMigrations(files)}`;

  const lockClient = await adminPool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', [TEMPLATE_LOCK_KEY]);
    try {
      const existing = await lockClient.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE datname LIKE $1',
        [`${TEMPLATE_PREFIX}%`],
      );

      if (existing.rows.some((r) => r.datname === templateName)) {
        return templateName;
      }

      // Drop stale templates from older migration sets.
      for (const row of existing.rows) {
        await lockClient.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
      }

      await lockClient.query(`CREATE DATABASE "${templateName}"`);

      const tmplPool = new Pool({
        connectionString: withDatabaseName(baseUrl, templateName),
        max: 1,
      });
      try {
        const tmplClient = await tmplPool.connect();
        try {
          for (const f of files) {
            await tmplClient.query(f.sql);
          }
        } finally {
          tmplClient.release();
        }
      } finally {
        // Must close all connections before CREATE DATABASE ... TEMPLATE can clone it.
        await tmplPool.end();
      }

      return templateName;
    } finally {
      await lockClient
        .query('SELECT pg_advisory_unlock(hashtext($1))', [TEMPLATE_LOCK_KEY])
        .catch(() => {
          /* ignore */
        });
    }
  } finally {
    lockClient.release();
  }
}

export interface LiveTestDb {
  readonly pool: pg.Pool;
  readonly dbName: string;
  readonly adminPool: pg.Pool;
  cleanup(): Promise<void>;
}

/**
 * Create a fresh throwaway Postgres database cloned from a migration-hashed
 * template database. Significantly faster than re-running all migrations in
 * every live-DB test file.
 */
export async function createLiveTestDb(
  prefix: string,
  options?: { maxConnections?: number; baseUrl?: string },
): Promise<LiveTestDb> {
  const baseUrl = options?.baseUrl ?? BASE_DATABASE_URL;
  const adminPool = new Pool({ connectionString: baseUrl, max: 1 });
  const templateName = await ensureMigratedTemplate(adminPool, baseUrl);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
  const dbName = `${safePrefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // Postgres locks the template briefly when cloning concurrently; retry on 55006.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await adminPool.query(`CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`);
      break;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === '55006' && attempt < 9) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      await adminPool.end().catch(() => {});
      throw err;
    }
  }

  const pool = new Pool({
    connectionString: withDatabaseName(baseUrl, dbName),
    max: options?.maxConnections ?? 4,
  });

  return {
    pool,
    dbName,
    adminPool,
    async cleanup() {
      await pool.end().catch(() => {});
      await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await adminPool.end().catch(() => {});
    },
  };
}
