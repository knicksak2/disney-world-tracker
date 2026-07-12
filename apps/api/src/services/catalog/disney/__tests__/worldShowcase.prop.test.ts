// Property tests for resolveWorldShowcaseCountry (disney/worldShowcase.ts)
/**
 * Property-based tests for `resolveWorldShowcaseCountry`.
 *
 * The resolver is a pure, total, deterministic core. Given a
 * Facility_Document and its already-resolved Land, it returns the EPCOT World
 * Showcase country pavilion — an explicit name-keyword match if present, else
 * the nearest of the eleven pavilion centroids by coordinates — or `null` when
 * the Land is not "World Showcase" or no signal is available.
 *
 * Properties:
 *   - Property 1: Land gating — null for any Land other than "World Showcase".
 *   - Property 2: Name precedence — an explicit country keyword in the name
 *     wins over the coordinates, even when the coordinates sit on another
 *     pavilion's centroid.
 *   - Property 3: Nearest centroid — with no name signal, a document placed at
 *     (or very near) a pavilion centroid resolves to that pavilion.
 *   - Property 4: Totality — never throws and returns either null or one of the
 *     eleven known pavilion names, for arbitrary coordinates/names.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the repo convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  resolveWorldShowcaseCountry,
  PAVILION_CENTROIDS,
  WORLD_SHOWCASE_LAND,
} from '../worldShowcase.js';
import type { FacilityDocument } from '../facilityDoc.js';

const NUM_RUNS = 100;

const COUNTRIES = PAVILION_CENTROIDS.map((c) => c.country);
const COUNTRY_SET = new Set<string>(COUNTRIES);

/** Build a Facility_Document with a name and optional coordinates. */
function docWith(
  name: string,
  latitude?: number,
  longitude?: number,
): FacilityDocument {
  const doc: {
    id: string;
    name: string;
    latitude?: number;
    longitude?: number;
  } = { id: '80010177;entityType=Attraction', name };
  if (latitude !== undefined) doc.latitude = latitude;
  if (longitude !== undefined) doc.longitude = longitude;
  return doc;
}

/** A Land value that is NOT "World Showcase" (so resolution is gated off). */
const nonWorldShowcaseLandArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant<string | null>(null),
  fc.constantFrom(
    'Fantasyland',
    'Tomorrowland',
    'World Celebration',
    'World Nature',
    'World Discovery',
    'Future World',
    'world showcase', // different casing must NOT match (exact-equality gate)
    ' World Showcase', // untrimmed-but-different is fine; resolver trims, so this DOES match — exclude below
  ).filter((s) => s.trim() !== WORLD_SHOWCASE_LAND),
);

describe('resolveWorldShowcaseCountry — Property 1: Land gating', () => {
  it('returns null for any Land other than "World Showcase"', () => {
    fc.assert(
      fc.property(
        nonWorldShowcaseLandArb,
        fc.string(),
        fc.double({ min: 28.3, max: 28.4, noNaN: true }),
        fc.double({ min: -81.6, max: -81.5, noNaN: true }),
        (land, name, lat, lon) => {
          expect(resolveWorldShowcaseCountry(docWith(name, lat, lon), land)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveWorldShowcaseCountry — Property 2: name precedence', () => {
  it('an explicit country keyword in the name wins over the coordinates', () => {
    // Pair a name that names one pavilion with coordinates that sit exactly on
    // a DIFFERENT pavilion's centroid; the name must win.
    const namedCountryArb = fc.constantFrom(
      ['Mexico Pavilion', 'Mexico'],
      ['Norway Restrooms', 'Norway'],
      ['Germany Picture Spot', 'Germany'],
      ['Rose & Crown Pub Musician', 'United Kingdom'],
      ['Chefs de France', 'France'],
      ['Tangierine Cafe', 'Morocco'],
      ['Tokyo Dining', 'Japan'],
      ['Regal Eagle', 'The American Adventure'],
      ['Via Napoli', 'Italy'],
      ['Nine Dragons', 'China'],
      ['Le Cellier', 'Canada'],
    ) as fc.Arbitrary<readonly [string, string]>;

    fc.assert(
      fc.property(
        namedCountryArb,
        fc.integer({ min: 0, max: PAVILION_CENTROIDS.length - 1 }),
        ([name, expected], centroidIdx) => {
          const c = PAVILION_CENTROIDS[centroidIdx]!;
          const result = resolveWorldShowcaseCountry(
            docWith(name, c.lat, c.lon),
            WORLD_SHOWCASE_LAND,
          );
          expect(result).toBe(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveWorldShowcaseCountry — Property 3: nearest centroid', () => {
  it('a document at a pavilion centroid (no name signal) resolves to that pavilion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: PAVILION_CENTROIDS.length - 1 }),
        // A tiny jitter smaller than the inter-pavilion spacing keeps the point
        // nearest to its own centroid.
        fc.double({ min: -0.0002, max: 0.0002, noNaN: true }),
        fc.double({ min: -0.0002, max: 0.0002, noNaN: true }),
        (idx, dLat, dLon) => {
          const c = PAVILION_CENTROIDS[idx]!;
          // A name with no country keyword so coordinates are the only signal.
          const result = resolveWorldShowcaseCountry(
            docWith('Luminous The Symphony of Us', c.lat + dLat, c.lon + dLon),
            WORLD_SHOWCASE_LAND,
          );
          expect(result).toBe(c.country);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null for World Showcase with no name keyword and no coordinates', () => {
    expect(
      resolveWorldShowcaseCountry(docWith('Kidcot Fun Stop'), WORLD_SHOWCASE_LAND),
    ).toBeNull();
  });
});

describe('resolveWorldShowcaseCountry — Property 4: totality', () => {
  it('never throws and returns null or a known pavilion for arbitrary input', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.oneof(
          fc.constant<number | undefined>(undefined),
          fc.double({ noNaN: true }),
        ),
        fc.oneof(
          fc.constant<number | undefined>(undefined),
          fc.double({ noNaN: true }),
        ),
        (name, lat, lon) => {
          const result = resolveWorldShowcaseCountry(
            docWith(name, lat, lon),
            WORLD_SHOWCASE_LAND,
          );
          expect(result === null || COUNTRY_SET.has(result)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
