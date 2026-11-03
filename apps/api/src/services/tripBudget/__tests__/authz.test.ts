/**
 * Authorization tests for Trip Budget (Requirement 18.2, 18.3, round 5 H1, Property 41).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/AppError.js';
import { requireBudgetAction } from '../authz.js';
import { setupTestDb } from './testDb.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRIP_BUDGET_DIR = resolve(HERE, '..');

function walkNonTestTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walkNonTestTs(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Trip Budget authz (requireBudgetAction)', () => {
  it('allows an organizer all budget actions', async () => {
    const { pool } = setupTestDb();
    const organizerId = '11111111-1111-4111-8111-111111111111';
    const tripId = '22222222-2222-4222-8222-222222222222';

    await pool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state)
       VALUES ($1, 'org@example.com', 'h', 'active')`,
      [organizerId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, 'Test Trip', '', '2026-10-01', '2026-10-05')`,
      [tripId, organizerId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer')`,
      [tripId, organizerId],
    );

    const r1 = await requireBudgetAction(pool, organizerId, tripId, 'view_budget');
    expect(r1).toBe('organizer');

    const r2 = await requireBudgetAction(pool, organizerId, tripId, 'edit_budget');
    expect(r2).toBe('organizer');

    const r3 = await requireBudgetAction(pool, organizerId, tripId, 'edit_budget_travelers');
    expect(r3).toBe('organizer');

    const r4 = await requireBudgetAction(pool, organizerId, tripId, 'edit_budget_settings');
    expect(r4).toBe('organizer');
  });

  it('promotes member to interim organizer when only organizer is pending_deletion (round 5 H1)', async () => {
    const { pool } = setupTestDb();
    const deletedOrgId = '11111111-1111-4111-8111-111111111111';
    const memberId = '22222222-2222-4222-8222-222222222222';
    const tripId = '33333333-3333-4333-8333-333333333333';

    await pool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state, deletion_requested_at, scheduled_purge_at, placeholder_id)
       VALUES ($1, 'org@example.com', 'h', 'pending_deletion', now(), now() + interval '30 days', gen_random_uuid()),
              ($2, 'mem@example.com', 'h', 'active', null, null, null)`,
      [deletedOrgId, memberId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, 'Test Trip', '', '2026-10-01', '2026-10-05')`,
      [tripId, deletedOrgId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role, joined_at)
       VALUES ($1, $2, 'organizer', now() - interval '2 days'),
              ($1, $3, 'member', now() - interval '1 day')`,
      [tripId, deletedOrgId, memberId],
    );

    // Interim organizer: member gets acting role 'organizer' and is allowed edit_budget_settings
    const role = await requireBudgetAction(pool, memberId, tripId, 'edit_budget_settings');
    expect(role).toBe('organizer');
  });

  it('denies edit_budget_settings to member once an active organizer exists', async () => {
    const { pool } = setupTestDb();
    const activeOrgId = '11111111-1111-4111-8111-111111111111';
    const memberId = '22222222-2222-4222-8222-222222222222';
    const tripId = '33333333-3333-4333-8333-333333333333';

    await pool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state)
       VALUES ($1, 'org@example.com', 'h', 'active'),
              ($2, 'mem@example.com', 'h', 'active')`,
      [activeOrgId, memberId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, 'Test Trip', '', '2026-10-01', '2026-10-05')`,
      [tripId, activeOrgId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role, joined_at)
       VALUES ($1, $2, 'organizer', now() - interval '2 days'),
              ($1, $3, 'member', now() - interval '1 day')`,
      [tripId, activeOrgId, memberId],
    );

    // Member can view_budget and edit_budget
    const role = await requireBudgetAction(pool, memberId, tripId, 'view_budget');
    expect(role).toBe('member');

    // But member is forbidden from edit_budget_settings
    await expect(
      requireBudgetAction(pool, memberId, tripId, 'edit_budget_settings'),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'trip_forbidden',
      }),
    );
  });

  it('throws trip_forbidden identically for non-member and unknown trip id', async () => {
    const { pool } = setupTestDb();
    const orgId = '11111111-1111-4111-8111-111111111111';
    const outsiderId = '22222222-2222-4222-8222-222222222222';
    const tripId = '33333333-3333-4333-8333-333333333333';
    const unknownTripId = '44444444-4444-4444-8444-444444444444';

    await pool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state)
       VALUES ($1, 'org@example.com', 'h', 'active'),
              ($2, 'out@example.com', 'h', 'active')`,
      [orgId, outsiderId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, 'Test Trip', '', '2026-10-01', '2026-10-05')`,
      [tripId, orgId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer')`,
      [tripId, orgId],
    );

    // Non-member on existing trip
    let outsiderErr: AppError | null = null;
    try {
      await requireBudgetAction(pool, outsiderId, tripId, 'view_budget');
    } catch (err) {
      outsiderErr = err as AppError;
    }
    expect(outsiderErr).toBeInstanceOf(AppError);
    expect(outsiderErr?.code).toBe('trip_forbidden');

    // Organizer on unknown trip
    let unknownTripErr: AppError | null = null;
    try {
      await requireBudgetAction(pool, orgId, unknownTripId, 'view_budget');
    } catch (err) {
      unknownTripErr = err as AppError;
    }
    expect(unknownTripErr).toBeInstanceOf(AppError);
    expect(unknownTripErr?.code).toBe('trip_forbidden');
  });

  // Feature: trip-budget, Property 41: No direct import of effectiveRole in tripBudget
  it('parses every non-test .ts file in tripBudget and asserts no import of effectiveRole.js', () => {
    const files = walkNonTestTs(TRIP_BUDGET_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violatingFiles: string[] = [];
    for (const filePath of files) {
      const code = readFileSync(filePath, 'utf8');
      const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);

      ts.forEachChild(sf, (node) => {
        if (ts.isImportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (ts.isStringLiteral(specifier)) {
            if (specifier.text.endsWith('/effectiveRole.js') || specifier.text === './effectiveRole.js' || specifier.text.includes('effectiveRole')) {
              violatingFiles.push(`${filePath} -> ${specifier.text}`);
            }
          }
        }
      });
    }

    expect(violatingFiles).toEqual([]);
  });
});
