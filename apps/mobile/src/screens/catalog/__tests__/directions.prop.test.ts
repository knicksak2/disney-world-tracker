// Feature: experience-detail-redesign — property tests for the pure directions
// core in `directions.ts` (tasks.md → 2.2).
//
// This suite implements the feature's two directions correctness properties
// against the framework-free coordinate-validity gate and maps-URL builder.
// Each property is a single property-based test running `fast-check` at
// `numRuns: 100`, matching the existing `infoTags.prop.test.ts` convention.
//
//   - Property 9  — Coordinate validity gate (hasValidCoordinates).
//       Validates: Requirements 4.2, 4.3
//   - Property 10 — Directions URL encodes coordinates (directionsUrl).
//       Validates: Requirements 4.4

import fc from 'fast-check';

import {
  directionsUrl,
  hasValidCoordinates,
  staticMapUrl,
  type DirectionsPlatform,
} from '../directions';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Oracle — an independent re-statement of the validity rule (R4.2, R4.3),
// deliberately not sharing code with the implementation.
// ---------------------------------------------------------------------------

/** True iff `value` is a finite number within [min, max] inclusive. */
function inFiniteRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

// ---------------------------------------------------------------------------
// Generators — span finite in-range values, finite out-of-range values, the
// exact boundaries, and the non-finite / missing forms (null, undefined, NaN,
// ±Infinity) so both sides of the "if and only if" are genuinely exercised.
// ---------------------------------------------------------------------------

// A coordinate candidate that mixes: in-range finite values, out-of-range
// finite values (beyond ±180 in either direction), the four inclusive
// boundaries, and the non-finite / absent cases.
const coordinateCandidateArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -200, max: 200, noNaN: true }) },
  { weight: 2, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(-90, 90, -180, 180, 0, -90.0001, 90.0001, -180.0001, 180.0001) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
  { weight: 1, arbitrary: fc.constant(Number.POSITIVE_INFINITY) },
  { weight: 1, arbitrary: fc.constant(Number.NEGATIVE_INFINITY) },
) as fc.Arbitrary<number | null | undefined>;

// ---------------------------------------------------------------------------
// Property 9 — Coordinate validity gate
//
// Feature: experience-detail-redesign, Property 9: For any latitude and
// longitude values, `hasValidCoordinates` returns true if and only if both are
// finite numbers with latitude in the range -90 to 90 inclusive and longitude
// in the range -180 to 180 inclusive.
//
// Validates: Requirements 4.2, 4.3
// ---------------------------------------------------------------------------

describe('Property 9: hasValidCoordinates gates on finite, in-range latitude and longitude', () => {
  it('returns true iff latitude ∈ [-90, 90] and longitude ∈ [-180, 180], both finite', () => {
    fc.assert(
      fc.property(coordinateCandidateArb, coordinateCandidateArb, (latitude, longitude) => {
        const expected =
          inFiniteRange(latitude, -90, 90) && inFiniteRange(longitude, -180, 180);

        // Total — never throws for null/undefined/non-finite inputs — and its
        // boolean result exactly matches the independent oracle.
        expect(hasValidCoordinates(latitude, longitude)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10 — Directions URL encodes coordinates
//
// Feature: experience-detail-redesign, Property 10: For any valid latitude and
// longitude, the string produced by `directionsUrl` encodes the exact latitude
// and longitude values that were passed in.
//
// Validates: Requirements 4.4
// ---------------------------------------------------------------------------

// Valid latitude / longitude values (finite, in range) so Property 10 exercises
// only the "valid coordinates" domain the directions action is rendered for.
const validLatitudeArb = fc.double({ min: -90, max: 90, noNaN: true });
const validLongitudeArb = fc.double({ min: -180, max: 180, noNaN: true });
const platformArb: fc.Arbitrary<DirectionsPlatform | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom<DirectionsPlatform>('ios', 'android', 'web'),
);

describe('Property 10: directionsUrl encodes the exact coordinates passed in', () => {
  it('embeds the exact stringified latitude and longitude for every platform', () => {
    fc.assert(
      fc.property(
        validLatitudeArb,
        validLongitudeArb,
        platformArb,
        (latitude, longitude, platform) => {
          const url =
            platform === undefined
              ? directionsUrl(latitude, longitude)
              : directionsUrl(latitude, longitude, platform);

          // The exact values passed in, as the implementation stringifies them.
          const lat = String(latitude);
          const lng = String(longitude);

          // The precise "<lat>,<lng>" pairing must appear verbatim in the URL,
          // guaranteeing the exact coordinates are encoded rather than rounded
          // or reordered.
          expect(url).toContain(`${lat},${lng}`);

          // Both individual values are present too (defensive against a format
          // that might only embed a combined token).
          expect(url).toContain(lat);
          expect(url).toContain(lng);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17 — Static map URL encodes the coordinates as the center of the bbox
//
// Feature: experience-detail-redesign, Property 17: For any valid finite
// latitude and longitude, the string produced by `staticMapUrl` is the keyless
// ArcGIS export endpoint carrying a `bbox=` parameter of four comma-separated
// numeric values, and the bbox is CENTERED on the exact coordinate — the
// midpoint of (xmin, xmax) equals the longitude and the midpoint of (ymin, ymax)
// equals the latitude.
//
// Validates: Requirements 10.3, 10.10
// ---------------------------------------------------------------------------

describe('Property 17: staticMapUrl encodes the coordinates as the center of the bbox', () => {
  it('targets the ArcGIS export endpoint and centers the bbox on the exact coordinate', () => {
    fc.assert(
      fc.property(validLatitudeArb, validLongitudeArb, (latitude, longitude) => {
        const url = staticMapUrl(latitude, longitude);

        // The URL is the keyless ArcGIS basemap export endpoint.
        expect(url).toContain(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?',
        );

        // Extract the `bbox=` parameter: four comma-separated numeric values in
        // EPSG:4326 order (xmin, ymin, xmax, ymax).
        const match = /[?&]bbox=([^&]+)/.exec(url);
        expect(match).not.toBeNull();

        const parts = ((match as RegExpExecArray)[1] ?? '').split(',');
        expect(parts).toHaveLength(4);

        const xmin = Number(parts[0]);
        const ymin = Number(parts[1]);
        const xmax = Number(parts[2]);
        const ymax = Number(parts[3]);
        for (const value of [xmin, ymin, xmax, ymax]) {
          expect(Number.isFinite(value)).toBe(true);
        }

        // The bbox is centered on the exact coordinate: its midpoints recover
        // the longitude (x) and latitude (y) within a robust floating tolerance.
        const centerLng = (xmin + xmax) / 2;
        const centerLat = (ymin + ymax) / 2;

        const closeTo = (actual: number, expected: number): boolean => {
          const diff = Math.abs(actual - expected);
          return diff <= 1e-9 || diff <= 1e-6 * Math.abs(expected);
        };

        expect(closeTo(centerLng, longitude)).toBe(true);
        expect(closeTo(centerLat, latitude)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18 — Static map URL is total and deterministic for valid inputs
//
// Feature: experience-detail-redesign, Property 18: For any valid finite
// latitude in the range -90 to 90 inclusive and longitude in the range -180 to
// 180 inclusive, `staticMapUrl` returns a defined string and never throws, and
// invoking it twice with equal inputs yields equal URLs.
//
// Validates: Requirements 10.9, 10.10
// ---------------------------------------------------------------------------

describe('Property 18: staticMapUrl is total and deterministic for valid inputs', () => {
  it('returns a defined non-empty string, never throws, and is deterministic for equal inputs', () => {
    fc.assert(
      fc.property(validLatitudeArb, validLongitudeArb, (latitude, longitude) => {
        // Total — never throws — and returns a defined, non-empty string.
        const url = staticMapUrl(latitude, longitude);
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);

        // Deterministic — two invocations with equal inputs yield equal URLs.
        const again = staticMapUrl(latitude, longitude);
        expect(again).toBe(url);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
