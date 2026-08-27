/**
 * Example-based unit tests for `directionsUrlCandidates`
 * (experience-detail-redesign → tasks.md 12.1 / 12.3).
 *
 * Validates: Requirements 4.7, 4.9
 *
 * `directionsUrlCandidates` is the ordered, duplicate-free list of maps URLs the
 * Experience_Detail_Screen attempts on activation of the Get_Directions_Action
 * or the Static_Map_Preview. The platform-native URL comes first; the universal
 * `https` web maps URL is always the last resort, so a device with no native
 * maps handler still gets a map in the browser rather than an error indication.
 *
 * Property 19 in `directions.prop.test.ts` covers the general ordering /
 * non-emptiness / coordinate-preservation invariants across all platforms. These
 * example tests pin the *concrete* URL shapes per platform — in particular the
 * Android `geo:` primary, which cannot be exercised through the screen tests
 * because `jest-expo` reports `Platform.OS === 'ios'`.
 */

import { directionsUrl, directionsUrlCandidates } from '../directions';

// A real Walt Disney World coordinate (Magic Kingdom) so the assertions read
// against realistic input rather than 0,0.
const LAT = 28.4177;
const LNG = -81.5812;

const WEB_URL = `https://www.google.com/maps/search/?api=1&query=${String(LAT)},${String(LNG)}`;

describe('directionsUrlCandidates (R4.7, R4.9)', () => {
  test('android: attempts the native geo: intent URL first, then the https web maps URL', () => {
    const candidates = directionsUrlCandidates(LAT, LNG, 'android');

    expect(candidates).toEqual([
      `geo:${String(LAT)},${String(LNG)}?q=${String(LAT)},${String(LNG)}`,
      WEB_URL,
    ]);
  });

  test('ios: attempts the Apple Maps URL first, then the https web maps URL', () => {
    const candidates = directionsUrlCandidates(LAT, LNG, 'ios');

    expect(candidates).toEqual([
      `https://maps.apple.com/?ll=${String(LAT)},${String(LNG)}`,
      WEB_URL,
    ]);
  });

  test('web: collapses to a single candidate because the native and fallback URLs coincide', () => {
    const candidates = directionsUrlCandidates(LAT, LNG, 'web');

    expect(candidates).toEqual([WEB_URL]);
  });

  test('defaults to the web platform when none is supplied', () => {
    expect(directionsUrlCandidates(LAT, LNG)).toEqual([WEB_URL]);
  });

  test('the first candidate always equals directionsUrl for the same platform', () => {
    for (const platform of ['ios', 'android', 'web'] as const) {
      expect(directionsUrlCandidates(LAT, LNG, platform)[0]).toBe(
        directionsUrl(LAT, LNG, platform),
      );
    }
  });
});
