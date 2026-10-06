import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/DO \$\$[\s\S]*?\$\$ LANGUAGE plpgsql;/gi, '');
  sql = sql.replace(/DO \$\$[\s\S]*?\$\$;/gi, '');
  db.public.none(sql);
}

describe('migration 0058_resort_recreation_experiences.sql', () => {
  let db: IMemoryDb;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    db.public.none(`
      CREATE TABLE resorts (
        id UUID PRIMARY KEY,
        upstream_entity_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        address TEXT,
        phone TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        tier TEXT,
        feature_pool TEXT,
        transportation_modes TEXT[],
        recreation JSONB,
        transit_times JSONB,
        architectural_lore JSONB
      );

      CREATE TABLE experiences (
        id UUID PRIMARY KEY,
        upstream_entity_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        park TEXT,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        area_type TEXT NOT NULL,
        resort_id UUID REFERENCES resorts(id),
        price_tier TEXT,
        sub_type TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  });

  it('inserts recreation experiences and attaches IDs to resort recreation JSONB', () => {
    const coronadoId = randomUUID();
    db.public.none(`
      INSERT INTO resorts (id, upstream_entity_id, name, description, active, recreation)
      VALUES (
        '${coronadoId}',
        '80007823;entityType=resort',
        'Disney''s Coronado Springs Resort',
        'Celebrate Spanish and Mexican cultures',
        TRUE,
        '[]'::jsonb
      );
    `);

    const rivieraId = randomUUID();
    db.public.none(`
      INSERT INTO resorts (id, upstream_entity_id, name, description, active, recreation)
      VALUES (
        '${rivieraId}',
        '80007824;entityType=resort',
        'Disney''s Riviera Resort',
        'Celebrate European Riviera elegance',
        TRUE,
        '[]'::jsonb
      );
    `);

    applyMigration(db, '0058_resort_recreation_experiences.sql');

    // 1. Verify experiences inserted
    const expRows = db.public.many(`
      SELECT id, name, category, area_type, resort_id, price_tier, sub_type
      FROM experiences
      ORDER BY name
    `);

    expect(expRows).toHaveLength(4);

    const coronadoPaint = expRows.find((e: any) => e.name === 'Colors of Coronado Painting Experience');
    expect(coronadoPaint).toBeDefined();
    expect(coronadoPaint.category).toBe('Recreation');
    expect(coronadoPaint.area_type).toBe('Resort');
    expect(coronadoPaint.resort_id).toBe(coronadoId);
    expect(coronadoPaint.id).toBe('b1010001-c001-4000-8000-000000000001');
    expect(coronadoPaint.price_tier).toBe('$$$');
    expect(coronadoPaint.sub_type).toBe('Arts & Crafts');

    const spanishMosaic = expRows.find((e: any) => e.name === 'Spanish Mosaic Art Experience');
    expect(spanishMosaic).toBeDefined();
    expect(spanishMosaic.id).toBe('b1010001-c001-4000-8000-000000000002');
    expect(spanishMosaic.resort_id).toBe(coronadoId);

    const sangria = expRows.find((e: any) => e.name === 'Sangria University');
    expect(sangria).toBeDefined();
    expect(sangria.id).toBe('b1010001-c001-4000-8000-000000000003');
    expect(sangria.resort_id).toBe(coronadoId);

    const rivieraPaint = expRows.find((e: any) => e.name === 'Painting on the Riviera');
    expect(rivieraPaint).toBeDefined();
    expect(rivieraPaint.id).toBe('b1010001-c001-4000-8000-000000000004');
    expect(rivieraPaint.resort_id).toBe(rivieraId);

    // 2. Verify resorts.recreation JSONB carries IDs for signature experiences
    const coronadoRow = db.public.one(`
      SELECT recreation FROM resorts WHERE id = '${coronadoId}'
    `);
    const cPaintRec = coronadoRow.recreation.find((r: any) => r.title === 'Colors of Coronado Painting Experience');
    expect(cPaintRec).toBeDefined();
    expect(cPaintRec.id).toBe('b1010001-c001-4000-8000-000000000001');

    const rivieraRow = db.public.one(`
      SELECT recreation FROM resorts WHERE id = '${rivieraId}'
    `);
    const rPaintRec = rivieraRow.recreation.find((r: any) => r.title === 'Painting on the Riviera');
    expect(rPaintRec).toBeDefined();
    expect(rPaintRec.id).toBe('b1010001-c001-4000-8000-000000000004');
  });
});
