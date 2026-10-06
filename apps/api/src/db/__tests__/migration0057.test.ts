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

describe('migration 0057_resort_activities_enrichment.sql', () => {
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
    `);
  });

  it('enriches Coronado Springs with Colors of Coronado, Spanish Mosaic Art, and Sangria University', () => {
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

    applyMigration(db, '0057_resort_activities_enrichment.sql');

    const result = db.public.many(`
      SELECT name, recreation
      FROM resorts
      WHERE name LIKE '%Coronado Springs%'
    `);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.recreation).toBeDefined();

    const titles = row.recreation.map((r: any) => r.title);
    expect(titles).toContain('Colors of Coronado Painting Experience');
    expect(titles).toContain('Spanish Mosaic Art Experience');
    expect(titles).toContain('Sangria University');
    expect(titles).toContain('The Dig Site & Lost City of Cibola Pool');

    const artsAndCrafts = row.recreation.filter((r: any) => r.badge === 'Arts & Crafts');
    expect(artsAndCrafts).toHaveLength(2);

    const classes = row.recreation.filter((r: any) => r.badge === 'Class');
    expect(classes).toHaveLength(1);
    expect(classes[0].title).toBe('Sangria University');
  });

  it('enriches Riviera Resort with Painting on the Riviera', () => {
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

    applyMigration(db, '0057_resort_activities_enrichment.sql');

    const result = db.public.many(`
      SELECT name, recreation
      FROM resorts
      WHERE name LIKE '%Riviera%'
    `);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.recreation).toBeDefined();

    const titles = row.recreation.map((r: any) => r.title);
    expect(titles).toContain('Painting on the Riviera');
    expect(titles).toContain("Riviera Pool & S'il Vous Play");

    const painting = row.recreation.find((r: any) => r.title === 'Painting on the Riviera');
    expect(painting).toBeDefined();
    expect(painting.badge).toBe('Arts & Crafts');
    expect(painting.icon).toBe('🎨');
  });
});
