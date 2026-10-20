/**
 * Tests for the shared recap gate helpers (resolveShareAccess, photoAccessFor) and the
 * structural guard that both recap routes use them (decision D35).
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.14, 15.15, 15.26, 15.30, decisions D25, D33, D35
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import type { RecapPhotoPort, RecapShareAccess, RecapShareGate } from '../ports.js';
import { photoAccessFor, resolveShareAccess } from '../tripRecapAccess.js';

const TRIP_ID = '00000000-0000-4000-8000-0000000000a1';
const SHARER_ID = '00000000-0000-4000-8000-0000000000a2';

function accessWith(flags: { tripAvailable: boolean; includePhotos: boolean }): RecapShareAccess {
  return { tripId: TRIP_ID, sharerId: SHARER_ID, ...flags };
}

const noopPort: RecapPhotoPort = {
  async highlights() {
    return [];
  },
  async isHighlight() {
    return false;
  },
  async albumPage() {
    return { photos: [], nextCursor: null };
  },
  async isAlbumPhoto() {
    return false;
  },
};

describe('photoAccessFor (exhaustive truth table, Requirement 15.15)', () => {
  const rows: Array<{
    tripAvailable: boolean;
    includePhotos: boolean;
    port: boolean;
    expected: 'granted' | 'not_included' | 'unavailable';
  }> = [];
  // Independently written expectation: unavailable wins over not_included; no port is unavailable.
  for (const tripAvailable of [true, false]) {
    for (const includePhotos of [true, false]) {
      for (const port of [true, false]) {
        let expected: 'granted' | 'not_included' | 'unavailable';
        if (!tripAvailable) expected = 'unavailable';
        else if (!includePhotos) expected = 'not_included';
        else if (!port) expected = 'unavailable';
        else expected = 'granted';
        rows.push({ tripAvailable, includePhotos, port, expected });
      }
    }
  }

  it.each(rows)(
    'tripAvailable=$tripAvailable includePhotos=$includePhotos port=$port -> $expected',
    ({ tripAvailable, includePhotos, port, expected }) => {
      expect(photoAccessFor(accessWith({ tripAvailable, includePhotos }), port ? noopPort : undefined)).toBe(
        expected,
      );
    },
  );

  it('covers all 8 combinations', () => {
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.expected))).toEqual(new Set(['granted', 'not_included', 'unavailable']));
  });
});

describe('resolveShareAccess', () => {
  it('throws the collapsed validation_failed AppError when the gate answers null', async () => {
    const gate: RecapShareGate = { resolve: async () => null };
    await expect(resolveShareAccess(gate, 'share-1', 'user-1')).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'validation_failed',
    );
  });

  it('returns the gate access untouched and passes shareId and userId through', async () => {
    const access = accessWith({ tripAvailable: true, includePhotos: true });
    const seen: Array<[string, string]> = [];
    const gate: RecapShareGate = {
      resolve: async (shareId, recipientId) => {
        seen.push([shareId, recipientId]);
        return access;
      },
    };
    await expect(resolveShareAccess(gate, 'share-1', 'user-1')).resolves.toBe(access);
    expect(seen).toEqual([['share-1', 'user-1']]);
  });
});

describe('source guard: both recap routes share one gate implementation', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '..', 'tripRecapRoutes.ts'), 'utf8');

  it('tripRecapRoutes.ts calls resolveShareAccess at least twice and never resolves the gate inline', () => {
    const calls = source.match(/resolveShareAccess\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/recapShareGate\.resolve\(/);
  });

  it('tripRecapRoutes.ts decides the photo access through photoAccessFor in both handlers', () => {
    const calls = source.match(/photoAccessFor\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('tripRecapAccess.ts imports no Trip repo, authz, pool or pg', () => {
    const accessSource = readFileSync(resolve(here, '..', 'tripRecapAccess.ts'), 'utf8');
    expect(accessSource).not.toMatch(/from\s+['"][^'"]*trips\/repo(\.js)?['"]/);
    expect(accessSource).not.toMatch(/from\s+['"][^'"]*trips\/authz(\.js)?['"]/);
    expect(accessSource).not.toMatch(/from\s+['"][^'"]*db\/pool(\.js)?['"]/);
    expect(accessSource).not.toMatch(/from\s+['"]pg['"]/);
  });
});
