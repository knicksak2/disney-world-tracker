import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo } from '../repo.js';
import {
  DEACTIVATION_SAFETY_THRESHOLD,
  runSync,
  type SyncLogger,
} from '../sync.js';
import { assignInternalId } from '../disney/bridge.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import type { FacilitiesClient } from '../disney/facilitiesClient.js';
import type { DocumentStore } from '../documentStore.js';
import { reconcileCatalog } from '../reconcile.js';

// ---------------------------------------------------------------------------
// pg-mem setup
// ---------------------------------------------------------------------------

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

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
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function freshPgMemRepo() {
  const db = buildPgMemDatabase();
  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0004_disney_sources.sql');
  applyMigration(db, '0006_experience_land.sql');
  applyMigration(db, '0007_experience_resort_area.sql');
  applyMigration(db, '0008_experience_facet_enrichment.sql');
  applyMigration(db, '0009_resort_representing_experiences.sql');
  applyMigration(db, '0010_resort_experience_category.sql');
  applyMigration(db, '0014_experience_world_showcase_country.sql');
  applyMigration(db, '0025_experience_early_entry.sql');
  applyMigration(db, '0026_experience_special_hours.sql');
  applyMigration(db, '0032_experience_category_taxonomy.sql');

  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;
  return { db, pool, repo: createCatalogRepo(pool) };
}

// ---------------------------------------------------------------------------
// In-memory fakes for runSync
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(
      key: string,
      value: string,
      _pxFlag: string,
      _ttlMs: number,
      nxFlag: string,
    ): Promise<'OK' | null> {
      if (nxFlag === 'NX' && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    },
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      token: string,
    ): Promise<number> {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

function createFakeDocumentStore(docs: FacilityDocument[]): DocumentStore {
  let checkpoint: string | null = null;
  const store = new Map<string, FacilityDocument>(
    docs.map((d) => [d.id, d]),
  );

  return {
    async getCheckpoint() {
      return checkpoint;
    },
    async setCheckpoint(seq: string): Promise<void> {
      checkpoint = seq;
    },
    async upsertDocuments(list) {
      for (const d of list) {
        store.set(d.enterpriseId, d.body);
      }
    },
    async markDeleted(ids, seq) {
      for (const id of ids) {
        store.delete(id);
      }
      checkpoint = seq;
    },
    async applyDelta(delta) {
      checkpoint = delta.lastSeq;
      for (const u of delta.upserts) {
        store.set(u.enterpriseId, u.body as FacilityDocument);
      }
      for (const d of delta.deletes) {
        store.delete(d);
      }
    },
    async getActiveDocuments(): Promise<readonly FacilityDocument[]> {
      return [...store.values()];
    },
  };
}

function createFakeClient(): FacilitiesClient {
  return {
    async listChannelDocumentIds() {
      return { changes: [], lastSeq: 'seq-1' };
    },
    async bulkGetDocuments() {
      return [];
    },
    async getMenus() {
      return [];
    },
  };
}

describe('Catalog_Sync Exclusion & Reconciliation Integration (Tasks 2.1, 2.2, 2.3)', () => {
  it('Task 2.2: withholds rule-matching documents, admits overridden documents, and logs audit counts + threshold warnings', async () => {
    const { repo } = freshPgMemRepo();
    const redis: any = createFakeRedis();

    // Create a set of test documents:
    // 1. Normal active attraction -> Admitted
    // 2. Audio-tour -> Excluded by audio_tour
    // 3. Pool -> Excluded by amenity_sub_type
    // 4. Animal placard -> Excluded by animal_placard
    // 5. Uwanja Camp (293719;entityType=Recreation) -> Matches amenity_sub_type but has Category_Override -> Admitted as PlayArea
    const docs: FacilityDocument[] = [
      {
        id: '80010192;entityType=Attraction',
        type: 'attraction',
        name: 'Space Mountain',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Magic Kingdom' }],
      },
      {
        id: '19477000;entityType=audio-tour',
        type: 'audio-tour',
        name: '240 Shoe Size',
      },
      {
        id: '18552101;entityType=Recreation',
        type: 'recreation',
        subType: 'Quiet Pool',
        name: 'Alligator Bayou Pool 2',
      },
      {
        id: '18447001;entityType=Attraction',
        type: 'attraction',
        name: 'African Hogs - Disney Animals',
      },
      {
        id: '293719;entityType=Recreation',
        type: 'recreation',
        subType: 'Water Play Area',
        name: 'Uwanja Camp',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Animal Kingdom' }],
      },
    ];

    const documentStore = createFakeDocumentStore(docs);
    const client = createFakeClient();

    const infoLogs: unknown[] = [];
    const warnLogs: unknown[] = [];
    const errorLogs: unknown[] = [];

    const logger: SyncLogger = {
      info: (obj) => infoLogs.push(obj),
      warn: (obj) => warnLogs.push(obj),
      error: (obj) => errorLogs.push(obj),
    };

    const result = await runSync({
      redis,
      repo,
      documentStore,
      client,
      logger,
      trigger: 'manual',
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // 2 admitted experiences: Space Mountain (Ride) and Uwanja Camp (PlayArea)
      expect(result.upserts).toBe(2);
    }

    // Verify persisted catalog rows in repo
    const activeExperiences = await repo.listActiveExperiences();
    const names = activeExperiences.map((e) => e.name);
    expect(names).toContain('Space Mountain');
    expect(names).toContain('Uwanja Camp');
    expect(names).not.toContain('240 Shoe Size');
    expect(names).not.toContain('Alligator Bayou Pool 2');
    expect(names).not.toContain('African Hogs - Disney Animals');

    const uwanja = activeExperiences.find((e) => e.name === 'Uwanja Camp');
    expect(uwanja?.category).toBe('PlayArea');

    // Verify audit logs
    const exclusionLog = infoLogs.find(
      (log) => typeof log === 'object' && log !== null && 'exclusionCounts' in log,
    ) as { exclusionCounts: Record<string, number>; totalExcluded: number } | undefined;

    expect(exclusionLog).toBeDefined();
    expect(exclusionLog?.totalExcluded).toBe(3);
    expect(exclusionLog?.exclusionCounts.audio_tour).toBe(1);
    expect(exclusionLog?.exclusionCounts.amenity_sub_type).toBe(1);
    expect(exclusionLog?.exclusionCounts.animal_placard).toBe(1);

    const overrideLog = infoLogs.find(
      (log) => typeof log === 'object' && log !== null && 'appliedOverridesCount' in log,
    ) as { appliedOverridesCount: number } | undefined;
    expect(overrideLog).toBeDefined();
    expect(overrideLog?.appliedOverridesCount).toBe(1); // Uwanja Camp
  });

  it('Task 2.2: logs error-level warning when NEWLY DEACTIVATED rows exceed DEACTIVATION_SAFETY_THRESHOLD (R7.3) and completes', async () => {
    const { db, repo } = freshPgMemRepo();
    const redis: any = createFakeRedis();

    // Seed one more active row than the threshold allows, each backed by an
    // audio-tour document so this run withholds every one of them and the
    // reconciliation soft-deletes all the cached rows.
    const seedCount = DEACTIVATION_SAFETY_THRESHOLD + 1;
    const docs: FacilityDocument[] = [];
    const inserts: string[] = [];
    for (let i = 0; i < seedCount; i++) {
      const enterpriseId = `audio-${i};entityType=audio-tour`;
      const internalId = assignInternalId(enterpriseId, new Map());
      docs.push({ id: enterpriseId, type: 'audio-tour', name: `Audio Clip ${i}` });
      inserts.push(
        `INSERT INTO experiences (id, upstream_entity_id, name, category, park, active)
         VALUES ('${internalId}', '${enterpriseId}', 'Audio Clip ${i}', 'Tour', 'EPCOT', true);`,
      );
    }
    db.public.none(inserts.join('\n'));

    const documentStore = createFakeDocumentStore(docs);
    const client = createFakeClient();

    const errorLogs: unknown[] = [];
    const logger: SyncLogger = {
      error: (obj) => errorLogs.push(obj),
      info: () => {},
      warn: () => {},
    };

    const result = await runSync({
      redis,
      repo,
      documentStore,
      client,
      logger,
      trigger: 'manual',
    });

    expect(result.status).toBe('success');
    const thresholdLog = errorLogs.find(
      (l) => typeof l === 'object' && l !== null && 'threshold' in l,
    ) as
      | { deactivatedCount: number; totalExcluded: number; threshold: number; topRule: string }
      | undefined;

    expect(thresholdLog).toBeDefined();
    expect(thresholdLog?.deactivatedCount).toBe(seedCount);
    expect(thresholdLog?.threshold).toBe(DEACTIVATION_SAFETY_THRESHOLD);
    expect(thresholdLog?.topRule).toBe('audio_tour');
  });

  it('Task 2.2: does NOT warn when many documents are excluded but no cached rows are newly deactivated (R7.3)', async () => {
    // Regression guard for the threshold semantics: this run excludes 505
    // documents — comfortably past the old document-count threshold of 500 —
    // but deactivates zero rows because none of them were ever cached. A
    // document-count threshold fires here spuriously; a soft-delete-count
    // threshold correctly stays silent.
    const { repo } = freshPgMemRepo();
    const redis: any = createFakeRedis();

    const docs: FacilityDocument[] = [];
    for (let i = 0; i < 505; i++) {
      docs.push({
        id: `audio-${i};entityType=audio-tour`,
        type: 'audio-tour',
        name: `Audio Clip ${i}`,
      });
    }

    const documentStore = createFakeDocumentStore(docs);
    const client = createFakeClient();

    const errorLogs: unknown[] = [];
    const infoLogs: unknown[] = [];
    const logger: SyncLogger = {
      error: (obj) => errorLogs.push(obj),
      info: (obj) => infoLogs.push(obj),
      warn: () => {},
    };

    const result = await runSync({
      redis,
      repo,
      documentStore,
      client,
      logger,
      trigger: 'manual',
    });

    expect(result.status).toBe('success');

    // The per-rule audit still reports all 505 excluded documents (R7.1) ...
    const exclusionLog = infoLogs.find(
      (log) => typeof log === 'object' && log !== null && 'totalExcluded' in log,
    ) as { totalExcluded: number } | undefined;
    expect(exclusionLog?.totalExcluded).toBe(505);

    // ... but no threshold warning fires, because nothing was deactivated.
    const thresholdLog = errorLogs.find(
      (l) => typeof l === 'object' && l !== null && 'threshold' in l,
    );
    expect(thresholdLog).toBeUndefined();
  });

  it('Task 2.3: soft-deletes excluded row preserving Internal_Id and referencing completions row, then reactivates same id (R1.11, R1.12)', async () => {
    const { db, repo } = freshPgMemRepo();

    const enterpriseId = '80010192;entityType=Attraction';
    const experienceId = assignInternalId(enterpriseId, new Map());
    const userId = randomUUID();

    // 1. Create initial user and active experience in db
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'user@example.com', 'hash');

      INSERT INTO experiences (id, upstream_entity_id, name, category, park, active)
      VALUES ('${experienceId}', '${enterpriseId}', 'Space Mountain', 'Ride', 'Magic Kingdom', true);

      INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
      VALUES ('${userId}', '${experienceId}', '2026-08-24', 'America/New_York');
    `);

    // Verify completion exists
    const initialCompletions = db.public.many(
      `SELECT * FROM completions WHERE experience_id = '${experienceId}'`,
    );
    expect(initialCompletions).toHaveLength(1);

    // 2. Reconcile with the experience ABSENT from upstream (simulating exclusion)
    const snapshot1 = {
      experiences: await repo.getCacheSnapshot(),
      resorts: await repo.getResortSnapshot(),
    };
    const diff1 = reconcileCatalog(snapshot1, { experiences: [], resorts: [] });
    await repo.applyReconciliation(diff1);

    // Verify row is soft-deleted (active = false), id is preserved, completions row still intact
    const rowAfterExclusion = db.public.one(
      `SELECT id, active FROM experiences WHERE id = '${experienceId}'`,
    );
    expect(rowAfterExclusion.active).toBe(false);
    expect(rowAfterExclusion.id).toBe(experienceId);

    const completionsAfterExclusion = db.public.many(
      `SELECT * FROM completions WHERE experience_id = '${experienceId}'`,
    );
    expect(completionsAfterExclusion).toHaveLength(1);

    // 3. Re-admit the experience upstream
    const snapshot2 = {
      experiences: await repo.getCacheSnapshot(),
      resorts: await repo.getResortSnapshot(),
    };
    const diff2 = reconcileCatalog(snapshot2, {
      experiences: [
        {
          id: experienceId,
          upstreamEntityId: enterpriseId,
          name: 'Space Mountain',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'High-speed coaster',
          imageUrl: null,
          areaType: 'ThemePark',
          land: 'Tomorrowland',
          resortArea: null,
          worldShowcaseCountry: null,
          resortId: null,
          representsResortId: null,
          latitude: null,
          longitude: null,
          accessibility: [],
          priceTier: null,
          mealPeriods: [],
          groupedFacets: {},
          heightRequirement: null,
          whyThis: null,
          subType: null,
        },
      ],
      resorts: [],
    });
    await repo.applyReconciliation(diff2);

    // Verify row is reactivated under the EXACT same Internal_Id (R1.12)
    const rowAfterReactivation = db.public.one(
      `SELECT id, active FROM experiences WHERE id = '${experienceId}'`,
    );
    expect(rowAfterReactivation.active).toBe(true);
    expect(rowAfterReactivation.id).toBe(experienceId);

    const totalExperiences = db.public.many(
      `SELECT id FROM experiences WHERE upstream_entity_id = '${enterpriseId}'`,
    );
    expect(totalExperiences).toHaveLength(1);
  });

  it('Task 11.1, 11.4: excludes duplicate_clone documents and logs warning for detected duplicate groups', async () => {
    const { db, repo } = freshPgMemRepo();
    const redis: any = createFakeRedis();

    // 1. Curated clone: Drawn to Life Recreation row (19632587;entityType=Recreation) -> Excluded under duplicate_clone
    // 2. Retained sibling: Drawn to Life Entertainment (19382527;entityType=Entertainment) -> Admitted as Show
    // 3. Known namesake pair: Hilton resort and restaurant -> Admitted, but suppressed from duplicate warnings (R8.9)
    // 4. Un-curated duplicate pair: Two attractions sharing a normalized name -> Admitted, and reported in warn log (R8.7)
    const docs: FacilityDocument[] = [
      {
        id: '19632587;entityType=Recreation',
        type: 'recreation',
        name: 'Drawn to Life',
      },
      {
        id: '19382527;entityType=Entertainment',
        type: 'entertainment',
        name: 'Drawn to Life',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Disney Springs' }],
      },
      {
        id: '80069785;entityType=resort',
        type: 'resort',
        name: 'Hilton Orlando Lake Buena Vista',
      },
      {
        id: '412312319;entityType=restaurant',
        type: 'restaurant',
        name: 'Hilton Orlando Lake Buena Vista',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Disney Springs' }],
      },
      {
        id: '99990001;entityType=Attraction',
        type: 'attraction',
        name: 'Uncurated Clone (Standard)',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Magic Kingdom' }],
      },
      {
        id: '99990002;entityType=Attraction',
        type: 'attraction',
        name: 'Uncurated Clone Standard',
        ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Magic Kingdom' }],
      },
    ];

    const documentStore = createFakeDocumentStore(docs);
    const client = createFakeClient();

    const infoLogs: unknown[] = [];
    const warnLogs: unknown[] = [];

    const logger: SyncLogger = {
      info: (obj) => infoLogs.push(obj),
      warn: (obj) => warnLogs.push(obj),
      error: () => {},
    };

    const result = await runSync({
      redis,
      repo,
      documentStore,
      client,
      logger,
      trigger: 'manual',
    });

    expect(result.status).toBe('success');

    // Verify exclusion counts
    const exclusionLog = infoLogs.find(
      (log) => typeof log === 'object' && log !== null && 'exclusionCounts' in log,
    ) as { exclusionCounts: Record<string, number>; totalExcluded: number } | undefined;

    expect(exclusionLog).toBeDefined();
    expect(exclusionLog?.exclusionCounts.duplicate_clone).toBe(1);

    // Verify active experiences in catalog
    const rows = db.public.many('SELECT upstream_entity_id, active FROM experiences') as { upstream_entity_id: string; active: boolean }[];
    const activeUpstreamIds = rows.filter((r) => r.active).map((r) => r.upstream_entity_id);
    expect(activeUpstreamIds).toContain('19382527;entityType=Entertainment'); // Drawn to Life Show
    expect(activeUpstreamIds).not.toContain('19632587;entityType=Recreation'); // Drawn to Life Recreation dropped

    const active = await repo.listActiveExperiences();
    const drawnToLife = active.find((e) => e.name === 'Drawn to Life');
    expect(drawnToLife).toBeDefined();
    expect(drawnToLife?.category).toBe('Show');

    // Verify duplicate group warning log
    const duplicateWarns = warnLogs.filter(
      (log) =>
        typeof log === 'object' &&
        log !== null &&
        'normalizedName' in log &&
        'members' in log,
    ) as { normalizedName: string; members: { enterpriseId: string }[] }[];

    expect(duplicateWarns).toHaveLength(1);
    expect(duplicateWarns[0]?.normalizedName).toBe('uncurated clone standard');
    expect(duplicateWarns[0]?.members.map((m) => m.enterpriseId)).toEqual([
      '99990001;entityType=Attraction',
      '99990002;entityType=Attraction',
    ]);

    // Ensure Hilton namesake pair did NOT produce a warning
    const hiltonWarn = duplicateWarns.find((w) =>
      w.normalizedName.includes('hilton'),
    );
    expect(hiltonWarn).toBeUndefined();
  });
});
