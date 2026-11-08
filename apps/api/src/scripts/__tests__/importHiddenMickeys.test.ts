// Feature: hidden-mickeys, Property 15: Seed import is idempotent
// Feature: hidden-mickeys, Property 21: Experience groups

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runImportHiddenMickeys, type ImportDbClient } from '../importHiddenMickeys.js';
import { DefaultMickeyRepo } from '../../services/mickeys/repo.js';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function buildPgMemDatabase(): IMemoryDb {
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
    name: 'btrim',
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
  pub.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (val: unknown): string => {
      if (val === null || val === undefined) return 'null';
      let parsed = val;
      if (typeof val === 'string') {
        try {
          parsed = JSON.parse(val);
        } catch {
          return 'string';
        }
      }
      if (parsed === null) return 'null';
      if (Array.isArray(parsed)) return 'array';
      if (typeof parsed === 'object') return 'object';
      return 'null';
    },
  });

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/u.test(f))
    .sort();

  for (const file of migrationFiles) {
    if (/^00(70|71)_backfill/u.test(file)) continue;
    const fullPath = resolve(MIGRATIONS_DIR, file);
    let sql = readFileSync(fullPath, 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    sql = sql.replace(
      /CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress\(mickey_id\) WHERE found_at IS NOT NULL;/g,
      'CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id);',
    );
    sql = sql.replace(
      'seed_key      TEXT,',
      'seed_key      TEXT UNIQUE,',
    );
    db.public.none(sql);
  }

  return db;
}

describe('importHiddenMickeys script', () => {
  let memDb: IMemoryDb;
  let dbClient: ImportDbClient;

  const mkAttractionId = '11111111-1111-4111-8111-111111111111';
  const epcotAttractionId = '22222222-2222-4222-8222-222222222222';
  const resortAttractionId = '33333333-3333-4333-8333-333333333333';
  const aliasAttractionId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    memDb = buildPgMemDatabase();
    const adapter = memDb.adapters.createPg();
    const pgPool = new adapter.Pool();
    dbClient = {
      query: (sql: string, params?: any[]) => pgPool.query(sql, params),
    };

    // Seed test experiences
    memDb.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
      VALUES
        ('${mkAttractionId}', 'upstream-mk-1', 'Space Mountain', 'Magic Kingdom', 'Ride', TRUE),
        ('${epcotAttractionId}', 'upstream-epcot-1', 'Living with the Land', 'EPCOT', 'Ride', TRUE),
        ('${resortAttractionId}', 'upstream-resort-1', 'Contemporary Resort Lobby', NULL, 'Ride', TRUE),
        ('${aliasAttractionId}', 'upstream-epcot-alias', 'Glimmering Greenhouses', 'EPCOT', 'Ride', TRUE);
    `);
  });

  it('Property 15: importing twice equals importing once, an existing seedKey is untouched', async () => {
    const sampleSeed = [
      {
        seedKey: 'test-mk-1',
        upstreamEntityId: 'upstream-mk-1',
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        zone: 'queue',
        difficulty: 'easy',
        clue1: 'A hidden shape near the star tunnel entrance.',
        clue2: 'Look closely at the control panel graphics on the left wall.',
        reveal: 'Three circular instrument dials form a classic Mickey silhouette.',
      },
    ];

    const readFile = vi.fn().mockResolvedValue(JSON.stringify(sampleSeed));

    // First import
    const res1 = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile,
    });
    expect(res1.seedReport?.inserted).toBe(1);
    expect(res1.seedReport?.skippedConflict).toBe(0);

    const rows1 = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-mk-1'`)).rows;
    expect(rows1).toHaveLength(1);
    expect(rows1[0].official).toBe(true);
    expect(rows1[0].source).toBe('seed');
    expect(rows1[0].status).toBe('pending');
    const originalCreatedAt = rows1[0].created_at;

    // Second import (idempotence)
    const res2 = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile,
    });
    expect(res2.seedReport?.inserted).toBe(0);
    expect(res2.seedReport?.skippedConflict).toBe(1);

    const rows2 = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-mk-1'`)).rows;
    expect(rows2).toHaveLength(1);
    expect(rows2[0].id).toBe(rows1[0].id);
    expect(rows2[0].created_at).toEqual(originalCreatedAt);
  });

  it('Property 15: ambiguous and missing experiences insert nothing and are reported as unresolved', async () => {
    // Add a duplicate named experience in Magic Kingdom to make name resolution ambiguous
    memDb.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
      VALUES ('55555555-5555-4555-8555-555555555555', 'upstream-mk-dup', 'Space Mountain', 'Magic Kingdom', 'Ride', TRUE);
    `);

    const sampleSeed = [
      {
        seedKey: 'test-missing',
        upstreamEntityId: 'non-existent-upstream',
        zone: 'queue',
        difficulty: 'easy',
        clue1: 'A clue for missing experience.',
        clue2: 'Another clue for missing experience.',
        reveal: 'A reveal for missing experience.',
      },
      {
        seedKey: 'test-ambiguous',
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        zone: 'queue',
        difficulty: 'easy',
        clue1: 'A clue for ambiguous experience.',
        clue2: 'Another clue for ambiguous experience.',
        reveal: 'A reveal for ambiguous experience.',
      },
    ];

    const res = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify(sampleSeed),
    });

    expect(res.seedReport?.resolved).toBe(0);
    expect(res.seedReport?.unresolved).toBe(2);
    expect(res.seedReport?.inserted).toBe(0);

    const countRes = await dbClient.query(`SELECT COUNT(*) AS c FROM hidden_mickeys`);
    expect(Number(countRes.rows[0].c)).toBe(0);
  });

  it('Property 15: resort entry with null park resolves to resort experience, theme-park entry never matches null park', async () => {
    const sampleSeed = [
      {
        seedKey: 'test-resort-null-park',
        experienceName: 'Contemporary Resort Lobby',
        park: null,
        zone: 'interior',
        difficulty: 'medium',
        clue1: 'Look at the grand Mary Blair mural near the monorail concourse.',
        clue2: 'Search the geometric pattern tiles on the fifth floor wall.',
        reveal: 'Three circular tiles are set together forming Mickey ears.',
      },
      {
        seedKey: 'test-resort-mismatched-park',
        experienceName: 'Contemporary Resort Lobby',
        park: 'Magic Kingdom', // Mismatched park: Contemporary Resort Lobby has park = NULL
        zone: 'interior',
        difficulty: 'medium',
        clue1: 'Look at the grand Mary Blair mural near the monorail concourse.',
        clue2: 'Search the geometric pattern tiles on the fifth floor wall.',
        reveal: 'Three circular tiles are set together forming Mickey ears.',
      },
    ];

    const res = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify(sampleSeed),
    });

    expect(res.seedReport?.resolved).toBe(1);
    expect(res.seedReport?.unresolved).toBe(1);
    expect(res.seedReport?.inserted).toBe(1);

    const inserted = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-resort-null-park'`)).rows;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].experience_id).toBe(resortAttractionId);
  });

  it('Property 15: default status is pending, --approve sets approved, --dry-run writes nothing', async () => {
    const sampleSeed = [
      {
        seedKey: 'test-pending-1',
        upstreamEntityId: 'upstream-mk-1',
        zone: 'queue',
        difficulty: 'easy',
        clue1: 'Clue 1 text for pending test.',
        clue2: 'Clue 2 text for pending test.',
        reveal: 'Reveal text for pending test.',
      },
      {
        seedKey: 'test-approve-1',
        upstreamEntityId: 'upstream-epcot-1',
        zone: 'on_ride',
        difficulty: 'hard',
        clue1: 'Clue 1 text for approve test.',
        clue2: 'Clue 2 text for approve test.',
        reveal: 'Reveal text for approve test.',
      },
    ];

    // Dry-run first
    const dryRes = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify(sampleSeed),
      dryRun: true,
    });
    expect(dryRes.dryRun).toBe(true);
    const afterDry = await dbClient.query(`SELECT COUNT(*) AS c FROM hidden_mickeys`);
    expect(Number(afterDry.rows[0].c)).toBe(0);

    // Default import (pending)
    const pendingRes = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify([sampleSeed[0]]),
    });
    expect(pendingRes.statusUsed).toBe('pending');
    expect(pendingRes.seedReport?.inserted).toBe(1);
    const row1 = (await dbClient.query(`SELECT status FROM hidden_mickeys WHERE seed_key = 'test-pending-1'`)).rows[0];
    expect(row1.status).toBe('pending');

    // Approved import (--approve)
    const approveRes = await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify([sampleSeed[1]]),
      approve: true,
    });
    expect(approveRes.statusUsed).toBe('approved');
    expect(approveRes.seedReport?.inserted).toBe(1);
    const row2 = (await dbClient.query(`SELECT status FROM hidden_mickeys WHERE seed_key = 'test-approve-1'`)).rows[0];
    expect(row2.status).toBe('approved');
  });

  it('Property 15 & Requirement 12.10: photoUrl is ignored, imports identically, and makes no network request', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => {
      throw new Error('fetch must not be called during import');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const withPhoto = {
      seedKey: 'test-with-photo',
      upstreamEntityId: 'upstream-mk-1',
      zone: 'queue',
      difficulty: 'easy',
      clue1: 'Clue 1 text with photoUrl attached.',
      clue2: 'Clue 2 text with photoUrl attached.',
      reveal: 'Reveal text with photoUrl attached.',
      photoUrl: 'https://example.com/photos/hidden-mickey-123.jpg',
    };

    const withoutPhoto = {
      ...withPhoto,
      seedKey: 'test-without-photo',
    };
    delete (withoutPhoto as any).photoUrl;

    await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify([withPhoto, withoutPhoto]),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const rowWith = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-with-photo'`)).rows[0];
    const rowWithout = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-without-photo'`)).rows[0];

    // Assert rows are identical except for id and seed_key
    expect(rowWith.experience_id).toBe(rowWithout.experience_id);
    expect(rowWith.zone).toBe(rowWithout.zone);
    expect(rowWith.difficulty).toBe(rowWithout.difficulty);
    expect(rowWith.clue1).toBe(rowWithout.clue1);
    expect(rowWith.clue2).toBe(rowWithout.clue2);
    expect(rowWith.reveal).toBe(rowWithout.reveal);
    expect(rowWith.status).toBe(rowWithout.status);
    expect(rowWith.official).toBe(rowWithout.official);
    expect(rowWith.source).toBe(rowWithout.source);
  });

  it('Property 21 & Requirement 12.8: alias import rules, idempotence, dry-run, and validation rejection', async () => {
    const validAliasEntry = {
      aliasUpstreamEntityId: 'upstream-epcot-alias',
      canonicalUpstreamEntityId: 'upstream-epcot-1',
    };

    const invalidAliasEntries = [
      // Self link
      {
        aliasUpstreamEntityId: 'upstream-epcot-alias',
        canonicalUpstreamEntityId: 'upstream-epcot-alias',
      },
      // Unresolved
      {
        aliasUpstreamEntityId: 'unknown-alias',
        canonicalUpstreamEntityId: 'upstream-epcot-1',
      },
    ];

    // Dry run writes nothing
    const dryRes = await runImportHiddenMickeys({
      db: dbClient,
      aliasesFilePath: 'aliases.json',
      readFile: async () => JSON.stringify([validAliasEntry]),
      dryRun: true,
    });
    expect(dryRes.dryRun).toBe(true);
    const dryCheck = await dbClient.query(`SELECT COUNT(*) AS c FROM mickey_experience_aliases`);
    expect(Number(dryCheck.rows[0].c)).toBe(0);

    // Import valid alias
    const importRes1 = await runImportHiddenMickeys({
      db: dbClient,
      aliasesFilePath: 'aliases.json',
      readFile: async () => JSON.stringify([validAliasEntry]),
    });
    expect(importRes1.aliasReport?.inserted).toBe(1);
    expect(importRes1.aliasReport?.alreadyLinked).toBe(0);

    // Re-importing is idempotent and never repoints an existing link
    const importRes2 = await runImportHiddenMickeys({
      db: dbClient,
      aliasesFilePath: 'aliases.json',
      readFile: async () => JSON.stringify([validAliasEntry]),
    });
    expect(importRes2.aliasReport?.inserted).toBe(0);
    expect(importRes2.aliasReport?.alreadyLinked).toBe(1);

    // Self link and unresolved id
    const invalidAliasRes = await runImportHiddenMickeys({
      db: dbClient,
      aliasesFilePath: 'aliases.json',
      readFile: async () => JSON.stringify(invalidAliasEntries),
    });
    expect(invalidAliasRes.aliasReport?.invalid).toBe(1);
    expect(invalidAliasRes.aliasReport?.unresolved).toBe(1);
    expect(invalidAliasRes.aliasReport?.inserted).toBe(0);

    // Chain rejection: trying to make alias a canonical or canonical an alias
    const chainEntries = [
      {
        // aliasUpstreamEntityId ('upstream-mk-1') -> canonical ('upstream-epcot-alias' which is already an alias)
        aliasUpstreamEntityId: 'upstream-mk-1',
        canonicalUpstreamEntityId: 'upstream-epcot-alias',
      },
      {
        // alias ('upstream-epcot-1' which is already canonical) -> canonical ('upstream-mk-1')
        aliasUpstreamEntityId: 'upstream-epcot-1',
        canonicalUpstreamEntityId: 'upstream-mk-1',
      },
    ];

    const chainRes = await runImportHiddenMickeys({
      db: dbClient,
      aliasesFilePath: 'aliases.json',
      readFile: async () => JSON.stringify(chainEntries),
    });
    expect(chainRes.aliasReport?.invalid).toBe(2);
    expect(chainRes.aliasReport?.inserted).toBe(0);
  });

  it('Property 21 & Requirement 12.9: seed entry on alias experience is stored on that alias and appears in group list', async () => {
    // 1. Link alias to canonical
    await dbClient.query(
      `INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
       VALUES ($1, $2)`,
      [aliasAttractionId, epcotAttractionId],
    );

    // 2. Seed an entry resolving directly to the alias Experience
    const seedEntryOnAlias = {
      seedKey: 'test-alias-seed',
      upstreamEntityId: 'upstream-epcot-alias',
      zone: 'on_ride',
      difficulty: 'medium',
      clue1: 'Holiday lights in the greenhouse form ears.',
      clue2: 'Look to the right side of the boat as you enter greenhouse 2.',
      reveal: 'Three circular glowing globes form a hidden holiday Mickey.',
    };

    await runImportHiddenMickeys({
      db: dbClient,
      seedFilePath: 'sample.json',
      readFile: async () => JSON.stringify([seedEntryOnAlias]),
      approve: true,
    });

    const storedRow = (await dbClient.query(`SELECT * FROM hidden_mickeys WHERE seed_key = 'test-alias-seed'`)).rows[0];
    // Requirement 12.9: Stored on the alias experience, not redirected
    expect(storedRow.experience_id).toBe(aliasAttractionId);

    // Requirement 16.2 & Property 21: Querying either canonical or alias through repo returns the entry
    const repo = new DefaultMickeyRepo(dbClient as any);
    const listForCanonical = await repo.findApprovedMickeys({
      experienceId: epcotAttractionId,
      limit: 10,
    });
    expect(listForCanonical.items.map((i) => i.id)).toContain(storedRow.id);

    const listForAlias = await repo.findApprovedMickeys({
      experienceId: aliasAttractionId,
      limit: 10,
    });
    expect(listForAlias.items.map((i) => i.id)).toContain(storedRow.id);
  });
});
