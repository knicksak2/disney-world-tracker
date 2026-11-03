/**
 * pg-mem tests for CatalogRepo.getMenuFetchState and upsertMenus shape version persistence.
 *
 * Validates: Requirements 10.7
 */

import { randomUUID } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import type { MenuDTO } from '@dwt/shared';
import { createCatalogRepo } from '../repo.js';

function buildCatalogDb() {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();

  return { db, pool };
}

describe('CatalogRepo menu shape version (R10.7)', () => {
  it('reads back shape_version = 2 after upsertMenus', async () => {
    const { pool } = buildCatalogDb();

    // Create minimal experiences and experience_menus tables matching schema
    await pool.query(`
      CREATE TABLE experiences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        upstream_entity_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'dining',
        park TEXT NOT NULL DEFAULT 'magic-kingdom',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE experience_menus (
        experience_id UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
        menus JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        shape_version SMALLINT NOT NULL DEFAULT 1
      );
    `);

    const expId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name) VALUES ($1, $2, $3)`,
      [expId, '90001212;entityType=restaurant', 'Be Our Guest Restaurant'],
    );

    const repo = createCatalogRepo(pool as any);

    // Initial state before menus are cached: cached is null
    const initial = await repo.getMenuFetchState(expId);
    expect(initial).not.toBeNull();
    expect(initial?.cached).toBeNull();
    expect(initial?.upstreamEntityId).toBe('90001212;entityType=restaurant');

    // Insert legacy row with shape_version = 1
    const legacyMenus: MenuDTO[] = [{ menuType: 'Lunch', groups: [] }];
    await pool.query(
      `INSERT INTO experience_menus (experience_id, menus, fetched_at, shape_version)
       VALUES ($1, $2::jsonb, now(), 1)`,
      [expId, JSON.stringify(legacyMenus)],
    );

    // Read back: shapeVersion = 1
    const legacyState = await repo.getMenuFetchState(expId);
    expect(legacyState?.cached?.shapeVersion).toBe(1);
    expect(legacyState?.shapeVersion).toBe(1);

    // Now upsert new menus via repo.upsertMenus (must write shape_version = 2)
    const newMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        serviceStyle: 'Table Service',
        groups: [],
      },
    ];
    const now = new Date('2026-10-25T14:00:00.000Z');
    await repo.upsertMenus(expId, newMenus, now);

    // Read back via repo.getMenuFetchState: shapeVersion is 2
    const updatedState = await repo.getMenuFetchState(expId);
    expect(updatedState?.cached?.shapeVersion).toBe(2);
    expect(updatedState?.shapeVersion).toBe(2);
    expect(updatedState?.cached?.menus[0]?.serviceStyle).toBe('Table Service');

    // Assert raw row in DB has shape_version = 2
    const rawRes = await pool.query(
      `SELECT shape_version FROM experience_menus WHERE experience_id = $1`,
      [expId],
    );
    expect(rawRes.rows[0]?.shape_version).toBe(2);
  });
});
