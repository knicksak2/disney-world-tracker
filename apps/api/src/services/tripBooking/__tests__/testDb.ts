import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';

export function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });

  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

export function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const RESORTS_STUB = `
  CREATE TABLE IF NOT EXISTS resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

export function stripForUpdate(text: string): string {
  return text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
}

export function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+(?:::[\w\[\]]+)?\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)(?:::[\w\[\]]+)?\)/gi, (match, num: string) => {
    const arr = params[Number(num) - 1];
    if (!Array.isArray(arr)) {
      return match;
    }
    if (arr.length === 0) {
      return '= NULL';
    }
    const placeholders = arr.map((value) => {
      newParams.push(value);
      return `$${newParams.length}`;
    });
    return `IN (${placeholders.join(', ')})`;
  });
  return [newText, newParams];
}

export function adaptSql(text: string, params?: ReadonlyArray<unknown>): [string, ReadonlyArray<unknown> | undefined] {
  return adaptAnyArrayParams(stripForUpdate(text), params);
}

export function setupTestDb(): { db: IMemoryDb; pool: Pool; recordedQueries: string[] } {
  const db = buildPgMemDatabase();
  applyMigration(db, '0001_init.sql');
  db.public.none(RESORTS_STUB);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0016_trip_resorts.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0031_planned_item_reservations.sql');
  applyMigration(db, '0056_admin_panel.sql');
  applyMigration(db, '0061_trip_booking_timeline.sql');

  const rawPool = db.adapters.createPg().Pool;
  const poolInstance = new rawPool();

  const recordedQueries: string[] = [];

  const wrappedPool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      recordedQueries.push(text);
      const [t, p] = adaptSql(text, params);
      return poolInstance.query(t, p);
    },
    async connect() {
      const client = await poolInstance.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          recordedQueries.push(text);
          const [t, p] = adaptSql(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as Pool;

  return { db, pool: wrappedPool, recordedQueries };
}
