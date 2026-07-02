/**
 * Unit tests for the migration completeness predicate (R14.5).
 *
 * The predicate is the conjunction of two facts: the Bridge_Map has been built
 * (≥1 `catalog_id_bridge` entry) AND at least one Disney-sourced Catalog_Sync
 * has succeeded and persisted (`last_successful_sync_at` is non-null). These
 * tests cover the full truth table plus the two single-fact helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  hasSuccessfulDisneySync,
  isBridgeMapBuilt,
  isMigrationComplete,
  type MigrationStateReader,
} from '../migrationComplete.js';

/** Build a fake reader from a bridge size and an optional sync timestamp. */
function reader(
  bridgeSize: number,
  lastSuccessfulSyncAt: Date | null,
): MigrationStateReader {
  const bridge = new Map<string, string>();
  for (let i = 0; i < bridgeSize; i += 1) {
    bridge.set(`ent-${i}`, `internal-${i}`);
  }
  return {
    getBridgeMap: async () => bridge,
    getCacheAge: async () => ({ lastSuccessfulSyncAt }),
  };
}

describe('isBridgeMapBuilt', () => {
  it('is false when the bridge has no entries', async () => {
    expect(await isBridgeMapBuilt(reader(0, null))).toBe(false);
  });

  it('is true when the bridge has at least one entry', async () => {
    expect(await isBridgeMapBuilt(reader(1, null))).toBe(true);
  });
});

describe('hasSuccessfulDisneySync', () => {
  it('is false when no successful sync has been recorded', async () => {
    expect(await hasSuccessfulDisneySync(reader(5, null))).toBe(false);
  });

  it('is true when a successful sync timestamp exists', async () => {
    expect(
      await hasSuccessfulDisneySync(reader(0, new Date('2024-01-01T00:00:00Z'))),
    ).toBe(true);
  });
});

describe('isMigrationComplete (R14.5)', () => {
  const now = new Date('2024-06-01T12:00:00Z');

  it('is false before anything has run (no bridge, no sync)', async () => {
    expect(await isMigrationComplete(reader(0, null))).toBe(false);
  });

  it('is false with a bridge but no successful Disney sync yet', async () => {
    // Bridge built, but the first Disney-only sync has not succeeded/persisted.
    expect(await isMigrationComplete(reader(3, null))).toBe(false);
  });

  it('is false with a successful sync but no bridge built', async () => {
    // A sync succeeded but the one-time bridge build never ran — not complete.
    expect(await isMigrationComplete(reader(0, now))).toBe(false);
  });

  it('is true only once the bridge is built AND a Disney sync has persisted', async () => {
    expect(await isMigrationComplete(reader(1, now))).toBe(true);
  });
});
