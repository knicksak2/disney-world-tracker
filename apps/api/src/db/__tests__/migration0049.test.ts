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
  // strip PL/pgSQL DO block if pg-mem does not support DO $$
  sql = sql.replace(/DO \$\$[\s\S]*?\$\$ LANGUAGE plpgsql;/gi, '');
  sql = sql.replace(/DO \$\$[\s\S]*?\$\$;/gi, '');
  db.public.none(sql);
}

describe('migration 0049_resort_metadata.sql', () => {
  let db: IMemoryDb;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    // Setup minimal resorts table matching 0004
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  });

  it('adds metadata columns to resorts and seeds Coronado Springs with multiple pools', () => {
    const coronadoId = randomUUID();
    db.public.none(`
      INSERT INTO resorts (id, upstream_entity_id, name, description, active)
      VALUES ('${coronadoId}', '80007823;entityType=resort', 'Disney''s Coronado Springs Resort', 'Celebrate Spanish and Mexican cultures', TRUE);
    `);

    applyMigration(db, '0049_resort_metadata.sql');

    const result = db.public.many(`
      SELECT id, name, tier, feature_pool, transportation_modes, recreation, transit_times, architectural_lore
      FROM resorts
      WHERE name LIKE '%Coronado Springs%'
    `);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.tier).toBe('Moderate');
    expect(row.feature_pool).toBe('The Dig Site & Lost City of Cibola Pool');
    expect(row.transportation_modes).toEqual(['Bus']);
    expect(row.recreation).toBeDefined();
    // Verifies both feature pool and neighborhood quiet pools are listed in recreation
    const pools = row.recreation.filter((r: any) => r.icon === '🏊');
    expect(pools.length).toBeGreaterThanOrEqual(2);
    expect(row.transit_times).toBeDefined();
    expect(row.architectural_lore).toBeDefined();
  });

  it('comprehensively seeds all WDW resort tiers and properties, including multiple pools across resorts', () => {
    const resortsToSeed = [
      { name: "Disney's Coronado Springs Resort", expectedTier: 'Moderate' },
      { name: "Disney's Grand Floridian Resort & Spa", expectedTier: 'Deluxe' },
      { name: "Disney's Polynesian Village Resort", expectedTier: 'Deluxe' },
      { name: "Disney's Contemporary Resort", expectedTier: 'Deluxe' },
      { name: "Disney's Animal Kingdom Lodge", expectedTier: 'Deluxe' },
      { name: "Disney's Wilderness Lodge", expectedTier: 'Deluxe' },
      { name: "Disney's Yacht Club Resort", expectedTier: 'Deluxe' },
      { name: "Disney's Beach Club Resort", expectedTier: 'Deluxe' },
      { name: "Disney's BoardWalk Inn", expectedTier: 'Deluxe' },
      { name: "Disney's Riviera Resort", expectedTier: 'Deluxe Villa' },
      { name: "Disney's Saratoga Springs Resort & Spa", expectedTier: 'Deluxe Villa' },
      { name: "Disney's Old Key West Resort", expectedTier: 'Deluxe Villa' },
      { name: "Disney's Caribbean Beach Resort", expectedTier: 'Moderate' },
      { name: "Disney's Port Orleans Resort - French Quarter", expectedTier: 'Moderate' },
      { name: "Disney's Port Orleans Resort - Riverside", expectedTier: 'Moderate' },
      { name: "Disney's Pop Century Resort", expectedTier: 'Value' },
      { name: "Disney's Art of Animation Resort", expectedTier: 'Value' },
      { name: "Disney's All-Star Movies Resort", expectedTier: 'Value' },
      { name: "Disney's All-Star Music Resort", expectedTier: 'Value' },
      { name: "Disney's All-Star Sports Resort", expectedTier: 'Value' },
      { name: "Disney's Fort Wilderness Resort & Campground", expectedTier: 'Campground' },
    ];

    for (const [index, r] of resortsToSeed.entries()) {
      db.public.none(`
        INSERT INTO resorts (id, upstream_entity_id, name, description, active)
        VALUES ('${randomUUID()}', 'entity-${index};entityType=resort', '${r.name.replace(/'/g, "''")}', 'Description', TRUE);
      `);
    }

    applyMigration(db, '0049_resort_metadata.sql');

    const rows = db.public.many(`
      SELECT name, tier, feature_pool, transportation_modes, recreation, transit_times, architectural_lore
      FROM resorts
    `);

    expect(rows).toHaveLength(resortsToSeed.length);

    for (const seeded of resortsToSeed) {
      const found = rows.find((row) => row.name === seeded.name);
      expect(found).toBeDefined();
      expect(found.tier).toBe(seeded.expectedTier);
      expect(found.feature_pool).toBeTruthy();
      expect(found.transportation_modes.length).toBeGreaterThan(0);
      expect(found.recreation.length).toBeGreaterThan(0);
      expect(found.transit_times).toBeDefined();
      expect(found.architectural_lore).toBeDefined();
    }

    // Specific assertions on Riviera Resort
    const riviera = rows.find((r) => r.name === "Disney's Riviera Resort");
    expect(riviera).toBeDefined();
    expect(riviera.tier).toBe('Deluxe Villa');
    expect(riviera.feature_pool).toBe('Riviera Pool');
    expect(riviera.transportation_modes).toEqual(['Skyliner', 'Bus']);
    const rivieraPools = riviera.recreation.filter((r: any) => r.icon === '🏊');
    expect(rivieraPools).toHaveLength(2); // Riviera Pool + Beau Soleil Pool

    // Specific assertions on Wilderness Lodge: validates both Copper Creek and Boulder Ridge Cove pools
    const wilderness = rows.find((r) => r.name === "Disney's Wilderness Lodge");
    expect(wilderness).toBeDefined();
    expect(wilderness.tier).toBe('Deluxe');
    expect(wilderness.feature_pool).toBe('Copper Creek Springs Pool');
    expect(wilderness.transportation_modes).toEqual(['Boat', 'Bus']);
    const wildernessPools = wilderness.recreation.filter((r: any) => r.icon === '🏊');
    expect(wildernessPools).toHaveLength(2);
    expect(wildernessPools[0].title).toBe('Copper Creek Springs Pool');
    expect(wildernessPools[0].badge).toBe('Feature Pool');
    expect(wildernessPools[1].title).toBe('Boulder Ridge Cove Pool');
    expect(wildernessPools[1].badge).toBe('Quiet Pool');

    // Specific assertions on Yacht & Beach Club
    const yacht = rows.find((r) => r.name === "Disney's Yacht Club Resort");
    expect(yacht).toBeDefined();
    expect(yacht.tier).toBe('Deluxe');
    expect(yacht.feature_pool).toBe('Stormalong Bay');
    const yachtPools = yacht.recreation.filter((r: any) => r.icon === '🏊');
    expect(yachtPools).toHaveLength(2); // Stormalong Bay + Admiral Pool

    // Specific assertions on Fort Wilderness Campground
    const fortWilderness = rows.find((r) => r.name === "Disney's Fort Wilderness Resort & Campground");
    expect(fortWilderness.tier).toBe('Campground');
    expect(fortWilderness.feature_pool).toBe("Meadow Swimmin' Pool");
    const fortPools = fortWilderness.recreation.filter((r: any) => r.icon === '🏊');
    expect(fortPools).toHaveLength(2); // Meadow Swimmin' Pool + Wilderness Swimmin' Pool
  });
});
