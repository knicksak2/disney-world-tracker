/**
 * Guard: the seed INSERT must not use `ON CONFLICT (seed_key)` as its target.
 *
 * `hidden_mickeys_seed_key_uidx` is a PARTIAL unique index (`WHERE seed_key IS NOT NULL`, migration 0072).
 * Real Postgres refuses `ON CONFLICT (seed_key)` against a partial index unless the predicate is repeated
 * (error 42P10, "no unique or exclusion constraint matching the ON CONFLICT specification"), and pg-mem
 * cannot parse the repeated predicate. The importer's pg-mem tests therefore cannot tell whether the SQL
 * works on real Postgres, so this test reads the sources and pins the targetless form that works on both.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// Strip `//` comment lines so an explanation that quotes the bad clause cannot trip the guard.
const importer = readFileSync(resolve(here, '..', 'importHiddenMickeys.ts'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
const migration = readFileSync(
  resolve(here, '..', '..', '..', 'migrations', '0072_hidden_mickeys.sql'),
  'utf8',
);

describe('importHiddenMickeys seed INSERT vs the partial seed_key index', () => {
  it('the migration defines seed_key uniqueness as a partial index', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS hidden_mickeys_seed_key_uidx ON hidden_mickeys\(seed_key\) WHERE seed_key IS NOT NULL/,
    );
  });

  it('the seed INSERT does not name seed_key as its ON CONFLICT target', () => {
    // `ON CONFLICT (seed_key) DO NOTHING` fails on real Postgres (42P10) against the partial index, and
    // pg-mem cannot parse the predicate form, so the targetless clause is the form that works in both.
    expect(importer).not.toMatch(/ON CONFLICT \(seed_key\)/);
    expect(importer).toMatch(/INSERT INTO hidden_mickeys[\s\S]*?ON CONFLICT DO NOTHING\s+RETURNING id/);
  });
});
