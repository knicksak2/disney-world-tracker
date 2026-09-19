// Feature: navigation-redesign, Property 1: Park_Live_Snapshot projection includes only tracked Experiences and is total
/**
 * Property 1: Park_Live_Snapshot projection includes only tracked Experiences and is total.
 *
 * For any ThemeParksLiveResponse (including one with unmapped/garbage entries, missing queue,
 * or a missing waitTime) and any upstreamIdToExperienceId map, projectParkLive never throws,
 * includes exactly the entries whose id is a key in the map (mapped to that Experience's internal id),
 * and excludes every entry whose id is absent from the map — including the park entity's own live entry,
 * which never appears as a map key.
 *
 * Validates: Requirements 9.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { projectParkLive } from '../parkLiveProject.js';
import type { ThemeParksLiveResponse } from '../themeParksLiveClient.js';

describe('projectParkLive property tests', () => {
  it('Property 1: Park_Live_Snapshot projection includes only tracked Experiences and is total', () => {
    // Arbitrary for upstream id (GUIDs/strings)
    const upstreamIdArb = fc.stringMatching(/^[a-z0-9-]{1,16}$/);
    const expIdArb = fc.uuid();

    // Arbitrary for upstreamIdToExperienceId map
    const mapArb = fc.dictionary(upstreamIdArb, expIdArb).map((dict) => new Map(Object.entries(dict)));

    // Arbitrary for messy liveData entry
    const entryArb = fc.record({
      id: fc.oneof(upstreamIdArb, fc.string(), fc.constant(undefined)),
      name: fc.oneof(fc.string(), fc.constant(undefined)),
      status: fc.oneof(fc.string(), fc.constant(undefined)),
      queue: fc.oneof(
        fc.record({
          STANDBY: fc.record({
            waitTime: fc.oneof(
              fc.integer({ min: -100, max: 2000 }),
              fc.constant(null),
              fc.constant(undefined),
              fc.double({ noNaN: false }),
            ),
          }),
        }),
        fc.constant(undefined),
        fc.constant({}),
      ),
    }, { requiredKeys: [] });

    // Arbitrary for response (including garbage/null)
    const responseArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.record({
        id: fc.oneof(fc.string(), fc.constant(undefined)),
        name: fc.oneof(fc.string(), fc.constant(undefined)),
        entityType: fc.oneof(fc.string(), fc.constant(undefined)),
        timezone: fc.oneof(fc.string(), fc.constant(undefined)),
        liveData: fc.array(entryArb, { maxLength: 20 }),
      }),
      fc.constant(null),
      fc.constant(undefined),
    );

    fc.assert(
      fc.property(responseArb, mapArb, (response, map) => {
        let result;
        expect(() => {
          result = projectParkLive(response as unknown as ThemeParksLiveResponse, map);
        }).not.toThrow();

        const resp = response as { liveData?: Array<{ id?: unknown; [key: string]: unknown }> } | null | undefined;
        if (!resp || !Array.isArray(resp.liveData)) {
          expect(result).toEqual([]);
          return;
        }

        // Check count: exactly matches count of valid entries in response that are in map
        const validMappedEntries = resp.liveData.filter(
          (e): e is { id: string; [key: string]: unknown } =>
            Boolean(e && typeof e.id === 'string' && map.has(e.id)),
        );
        expect(result!.length).toBe(validMappedEntries.length);

        // Every entry in result must map to the corresponding ExperienceId
        for (let i = 0; i < result!.length; i++) {
          const projected = result![i]!;
          const source = validMappedEntries[i]!;

          expect(projected.experienceId).toBe(map.get(source.id!));
          expect(typeof projected.name).toBe('string');
          expect(typeof projected.status).toBe('string');

          if (projected.waitMinutes !== null) {
            expect(typeof projected.waitMinutes).toBe('number');
            expect(Number.isInteger(projected.waitMinutes)).toBe(true);
            expect(projected.waitMinutes).toBeGreaterThanOrEqual(0);
            expect(projected.waitMinutes).toBeLessThanOrEqual(1440);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('projects coarse lightningLane state when present in upstream queue', () => {
    const upstreamId = 'tp-seven-dwarfs';
    const experienceId = '11111111-2222-3333-4444-555555555555';
    const map = new Map([[upstreamId, experienceId]]);

    const response = {
      id: 'park-mk',
      name: 'Magic Kingdom',
      liveData: [
        {
          id: upstreamId,
          name: 'Seven Dwarfs Mine Train',
          status: 'OPERATING',
          queue: {
            STANDBY: { waitTime: 65 },
            PAID_RETURN_TIME: {
              state: 'AVAILABLE',
              returnStart: '2026-09-17T17:40:00.000Z',
              returnEnd: '2026-09-17T18:40:00.000Z',
              price: {
                amount: 14,
                currency: 'USD',
              },
            },
          },
        },
      ],
    } as unknown as ThemeParksLiveResponse;

    const result = projectParkLive(response, map);
    expect(result.length).toBe(1);
    expect(result[0]!.experienceId).toBe(experienceId);
    expect(result[0]!.waitMinutes).toBe(65);
    expect(result[0]!.lightningLane).toEqual({
      state: 'AVAILABLE',
      returnStart: '2026-09-17T17:40:00.000Z',
      returnEnd: '2026-09-17T18:40:00.000Z',
      price: {
        amount: 14,
        currency: 'USD',
      },
    });
  });
});
