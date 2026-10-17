/**
 * Vocabulary parity test for Trip Booking Timeline.
 *
 * Asserts that the CHECK constraint sets in `0061_trip_booking_timeline.sql`
 * match the shared constant arrays in `@dwt/shared` exactly (same members, no extras).
 *
 * Validates: Requirements 14.9, 15.2
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LIGHTNING_LANE_TIMINGS,
  PACKING_CATEGORIES,
  REMINDER_LEADS,
  STAY_TYPES,
  WINDOW_KINDS,
} from '../enums.js';

function getMigrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = resolve(here, '..', '..', '..', '..', 'apps', 'api', 'migrations', '0061_trip_booking_timeline.sql');
  return readFileSync(sqlPath, 'utf8');
}

function extractInValues(sql: string, constraintName: string): Set<string> {
  // Regex to match CONSTRAINT <name> CHECK (... IN ('val1', 'val2', ...))
  const regex = new RegExp(`CONSTRAINT\\s+${constraintName}[^;]*?IN\\s*\\(([^)]+)\\)`, 's');
  const match = sql.match(regex);
  if (!match || !match[1]) {
    throw new Error(`Could not find constraint ${constraintName} with IN (...) in migration SQL`);
  }
  const rawValues = match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
  return new Set(rawValues);
}

describe('tripBooking vocabulary parity with migration 0061', () => {
  const sql = getMigrationSql();

  it('chk_trip_booking_settings_stay_type matches STAY_TYPES exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_booking_settings_stay_type');
    const sharedSet = new Set<string>(STAY_TYPES);
    expect(sqlSet).toEqual(sharedSet);
  });

  it('chk_trip_booking_settings_ll_timing matches LIGHTNING_LANE_TIMINGS exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_booking_settings_ll_timing');
    const sharedSet = new Set<string>(LIGHTNING_LANE_TIMINGS);
    expect(sqlSet).toEqual(sharedSet);
  });

  it('chk_trip_booking_window_done_kind matches WINDOW_KINDS exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_booking_window_done_kind');
    const sharedSet = new Set<string>(WINDOW_KINDS);
    expect(sqlSet).toEqual(sharedSet);
  });

  it('chk_trip_booking_reminder_log_kind matches WINDOW_KINDS exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_booking_reminder_log_kind');
    const sharedSet = new Set<string>(WINDOW_KINDS);
    expect(sqlSet).toEqual(sharedSet);
  });

  it('chk_trip_booking_reminder_log_lead matches REMINDER_LEADS exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_booking_reminder_log_lead');
    const sharedSet = new Set<string>(REMINDER_LEADS);
    expect(sqlSet).toEqual(sharedSet);
  });

  it('chk_trip_packing_items_category matches PACKING_CATEGORIES exactly', () => {
    const sqlSet = extractInValues(sql, 'chk_trip_packing_items_category');
    const sharedSet = new Set<string>(PACKING_CATEGORIES);
    expect(sqlSet).toEqual(sharedSet);
  });
});
