/**
 * Directions core for the Experience_Detail_Screen's Get_Directions_Action.
 *
 * This module is framework-free (no React, no react-navigation, and no
 * `Linking` call) so the coordinate-validity gate and maps-URL construction are
 * unit- and property-testable without rendering, mirroring the existing
 * `infoTags.ts` / `gating.ts` pure-core pattern. Only the actual
 * `Linking.openURL(directionsUrl(...))` side-effect and its error handling live
 * in the screen.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 10.3, 10.4, 10.9, 10.10
 */

/** The maps-URL target platforms `directionsUrl` can build for. */
export type DirectionsPlatform = 'ios' | 'android' | 'web';

/**
 * True iff both latitude and longitude are finite numbers with latitude in the
 * range -90 to 90 inclusive and longitude in the range -180 to 180 inclusive
 * (R4.2, R4.3). Total — never throws for null/undefined/non-finite inputs.
 */
export function hasValidCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Build the platform-appropriate maps URL for the given coordinates (R4.4),
 * encoding the exact latitude and longitude values passed in.
 *
 *   - `ios`    → `https://maps.apple.com/?ll=<lat>,<lng>`
 *   - `android`→ `geo:<lat>,<lng>?q=<lat>,<lng>`
 *   - `web`    → `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`
 *
 * `platform` defaults to `'web'` — a deterministic cross-platform web maps URL
 * that any device can open in a browser — so the function is deterministic and
 * testable; the screen passes the actual OS platform.
 */
export function directionsUrl(
  latitude: number,
  longitude: number,
  platform: DirectionsPlatform = 'web',
): string {
  const lat = String(latitude);
  const lng = String(longitude);

  switch (platform) {
    case 'ios':
      return `https://maps.apple.com/?ll=${lat},${lng}`;
    case 'android':
      return `geo:${lat},${lng}?q=${lat},${lng}`;
    case 'web':
    default:
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
}

/**
 * The ordered, duplicate-free Directions_Url_Candidates the screen attempts on
 * activation (R4.7, R4.9).
 *
 *   - Element 0 is the platform-native maps URL — `directionsUrl(lat, lng,
 *     platform)`. On Android that is the `geo:` intent URL, which launches the
 *     installed maps app.
 *   - The last element is always the universal `https` web maps URL —
 *     `directionsUrl(lat, lng, 'web')` — which any device with a browser can
 *     open. It is the fallback for a device with no native maps handler (a bare
 *     Android emulator without Google Maps, for instance).
 *
 * When `platform` is already `'web'` the two coincide and a single-element list
 * is returned, so the list is never empty and never contains duplicates. Every
 * element encodes the exact latitude and longitude passed in.
 *
 * Deliberately framework-free: the screen resolves `Platform.OS` and passes it
 * in, and the screen — not this module — performs the `Linking.openURL` calls.
 * Note that the screen must NOT gate those calls on `Linking.canOpenURL`: from
 * Android 11 (API 30) package-visibility filtering makes `canOpenURL` resolve
 * `false` for any non-`http(s)` scheme that is not declared in a native
 * `<queries>` manifest element, while `openURL` for the same URL succeeds
 * (launching an implicit intent is not subject to that filtering). See R4.8.
 */
export function directionsUrlCandidates(
  latitude: number,
  longitude: number,
  platform: DirectionsPlatform = 'web',
): readonly string[] {
  const primary = directionsUrl(latitude, longitude, platform);
  const web = directionsUrl(latitude, longitude, 'web');
  return primary === web ? [primary] : [primary, web];
}

/**
 * Build a keyless static map image URL centered on the given coordinates
 * (R10.3, R10.4). Pure, framework-free, total, and deterministic for valid
 * finite inputs (R10.9, R10.10).
 *
 * The URL targets the keyless ArcGIS basemap export endpoint at
 * `https://server.arcgisonline.com/ArcGIS/rest/services/<service>/MapServer/export`
 * (default `service` = `World_Imagery`, satellite imagery that shows
 * recognizable building/park detail), which needs no API key, access token, or
 * secret. The requested map area is a bounding box (`bbox`) CENTERED on the
 * exact coordinate:
 *
 *   - `halfLat = spanDegrees / 2` (default span `0.001`, a tight building-level
 *     ~110 m view so the pin's location is recognizable), `halfLng = halfLat *
 *     (width / height)` — the bbox aspect ratio is matched to the image aspect
 *     ratio to avoid gross distortion, so `xmin = longitude - halfLng`, `xmax = longitude + halfLng`,
 *     `ymin = latitude - halfLat`, `ymax = latitude + halfLat`.
 *   - `bbox=<xmin>,<ymin>,<xmax>,<ymax>` — in EPSG:4326 (`lngMin,latMin,lngMax,latMax`),
 *   - `bboxSR=4326`      — the spatial reference of the bbox,
 *   - `size=<w>,<h>`     — image dimensions (default `600,300`),
 *   - `format=png`, `f=image` — request a PNG image.
 *
 * Because the coordinate sits at the exact center of the bbox, a marker overlaid
 * at the image center lands precisely on the Experience location (R10.3). No I/O
 * and no clamping are performed; every number is stringified via `String(...)`.
 * For any finite latitude in [-90, 90] and longitude in [-180, 180] the function
 * returns a defined string, never throws, and yields an equal URL for equal
 * inputs (R10.9, R10.10).
 */
export function staticMapUrl(
  latitude: number,
  longitude: number,
  options?: {
    /** Image width in pixels; defaults to 600. */
    width?: number;
    /** Image height in pixels; defaults to 300. */
    height?: number;
    /** Latitudinal span of the bbox in degrees; defaults to 0.001 (~110 m, building level). */
    spanDegrees?: number;
    /**
     * ArcGIS basemap MapServer service name; defaults to `'World_Imagery'`
     * (satellite imagery), which shows recognizable building/park detail. Any
     * keyless ArcGIS basemap service works (e.g. `'World_Topo_Map'`,
     * `'World_Street_Map'`).
     */
    service?: string;
  },
): string {
  const width = options?.width ?? 600;
  const height = options?.height ?? 300;
  const spanDegrees = options?.spanDegrees ?? 0.001;
  const service = options?.service ?? 'World_Imagery';

  // Center the bbox on the coordinate, matching the bbox aspect ratio to the
  // image aspect ratio so the rendered map is not grossly distorted.
  const halfLat = spanDegrees / 2;
  const halfLng = halfLat * (width / height);

  const xmin = longitude - halfLng;
  const xmax = longitude + halfLng;
  const ymin = latitude - halfLat;
  const ymax = latitude + halfLat;

  const bbox = `${String(xmin)},${String(ymin)},${String(xmax)},${String(ymax)}`;

  const query = [
    `bbox=${bbox}`,
    `bboxSR=4326`,
    `size=${String(width)},${String(height)}`,
    `format=png`,
    `f=image`,
  ].join('&');

  return `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/export?${query}`;
}
