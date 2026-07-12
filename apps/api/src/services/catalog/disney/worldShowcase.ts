/**
 * Pure World_Showcase_Country resolution for a Disney Facility_Document.
 *
 * Disney's Facility feed models every EPCOT World Showcase experience under a
 * single `land` ancestor named `"World Showcase"` (Enterprise_Id
 * `80007865;entityType=land`) — the individual country pavilion (Mexico,
 * Norway, France, …) is *not* carried as any structured field. Confirmed
 * against live data: all 244 World Showcase documents share the same
 * `ancestorLand`, and the ancestor chain goes straight from `destination →
 * land ("World Showcase") → resort-area → theme-park` with no country level.
 *
 * The pavilion is therefore only *derivable*, from two signals the feed does
 * carry:
 *
 *   1. **Name** — many (but not all) documents name their pavilion, e.g.
 *      "Germany Picture Spot", "Rose & Crown Pub Musician" (United Kingdom).
 *   2. **Coordinates** — every document carries a `latitude`/`longitude`, and
 *      the eleven pavilions occupy fixed, non-overlapping arcs around World
 *      Showcase Lagoon, so the nearest pavilion centroid identifies the country.
 *
 * `resolveWorldShowcaseCountry` combines them: an explicit name-keyword match
 * wins (it captures intent — e.g. a cart "…in The American Adventure" whose
 * coordinates sit on the Italy border), otherwise the nearest pavilion centroid
 * by great-circle-approximate distance is used, and `null` is returned only
 * when neither signal is available (the land is not World Showcase, or there is
 * no name match and no usable coordinates).
 *
 * Like the sibling `resolveLand` / `resolveResortArea`, this resolver is:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no clock, no globals.
 *   - **Total**: defined for every `FacilityDocument` and never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs.
 *
 * The centroids below were computed from the live feed (name-identified World
 * Showcase documents, ~141 points); a nearest-centroid self-check mapped
 * 140/141 back to their own pavilion.
 */

import type { FacilityDocument } from './facilityDoc.js';

/** The `land` ancestor name that gates World Showcase country resolution. */
export const WORLD_SHOWCASE_LAND = 'World Showcase';

/**
 * One World Showcase pavilion and the centroid of its facilities, in decimal
 * degrees, computed from the live Disney feed.
 */
export interface PavilionCentroid {
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * The eleven World Showcase pavilion centroids (decimal degrees), derived from
 * the name-identified facility coordinates in the live feed. Ordered clockwise
 * from the World Showcase Plaza (Mexico → Canada) for readability; order does
 * not affect resolution.
 */
export const PAVILION_CENTROIDS: readonly PavilionCentroid[] = [
  { country: 'Mexico', lat: 28.371439, lon: -81.547463 },
  { country: 'Norway', lat: 28.370714, lon: -81.546792 },
  { country: 'China', lat: 28.369937, lon: -81.546454 },
  { country: 'Germany', lat: 28.368217, lon: -81.547027 },
  { country: 'Italy', lat: 28.36764, lon: -81.548198 },
  { country: 'The American Adventure', lat: 28.367611, lon: -81.549401 },
  { country: 'Japan', lat: 28.367702, lon: -81.550546 },
  { country: 'Morocco', lat: 28.368295, lon: -81.551813 },
  { country: 'France', lat: 28.368799, lon: -81.552986 },
  { country: 'United Kingdom', lat: 28.36961, lon: -81.551903 },
  { country: 'Canada', lat: 28.37152, lon: -81.551453 },
];

/**
 * Country-name keyword patterns, ordered most-specific first so a multi-word or
 * landmark name resolves before a generic token. Each pattern matches the
 * document name to capture explicit pavilion intent even when coordinates sit
 * near a pavilion border.
 */
const COUNTRY_KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ['United Kingdom', /\b(united kingdom|u\.?k\.?|england|british|rose & crown|yorkshire county|tea caddy|sportsman'?s shoppe|toy soldier|crown & crest)\b/i],
  ['Canada', /\b(canada|canadian|le cellier|northwest mercantile|trading post)\b/i],
  ['France', /\b(france|french|ratatouille|remy|chefs de france|monsieur paul|crêpes|creperie|les halles|plume et palette|impressions de france|international gateway)\b/i],
  ['Morocco', /\b(morocco|moroccan|marrakesh|tangierine|spice road|souk|medina)\b/i],
  ['Japan', /\b(japan|japanese|teppan|tokyo dining|katsura|kabuki|mitsukoshi)\b/i],
  ['The American Adventure', /\b(american adventure|america gardens|liberty inn|regal eagle|fife & drum|voices of liberty)\b/i],
  ['Italy', /\b(italy|italian|tutto|via napoli|enoteca|gelati|il bel cristallo|la bottega)\b/i],
  ['Germany', /\b(germany|german|biergarten|sommerfest|teddybar|karamell|weinkeller|volkskunst|glaskunst)\b/i],
  ['China', /\b(china|chinese|nine dragons|lotus blossom|joy of tea|reflections of china|village traders)\b/i],
  ['Norway', /\b(norway|norwegian|frozen ever after|akershus|kringla|stave church|sommerhus|fjord)\b/i],
  ['Mexico', /\b(mexico|mexican|gran fiesta|san angel|la hacienda|choza|cava del tequila|plaza de los amigos)\b/i],
];

/** The maximum persisted country length, consistent with `land` (R1.7 sibling). */
const MAX_COUNTRY_LENGTH = 200;

/** Squared equirectangular distance, scaling longitude by cos(latitude). */
function squaredDistance(
  lat: number,
  lon: number,
  centroid: PavilionCentroid,
): number {
  const latRad = (lat * Math.PI) / 180;
  const dLat = lat - centroid.lat;
  const dLon = (lon - centroid.lon) * Math.cos(latRad);
  return dLat * dLat + dLon * dLon;
}

/** Match the document name to a pavilion via {@link COUNTRY_KEYWORDS}. */
function matchByName(name: string | undefined): string | null {
  if (name === undefined) {
    return null;
  }
  for (const [country, pattern] of COUNTRY_KEYWORDS) {
    if (pattern.test(name)) {
      return country;
    }
  }
  return null;
}

/** Nearest pavilion centroid to the given coordinates, or `null` when absent. */
function matchByCoordinates(
  latitude: number | undefined,
  longitude: number | undefined,
): string | null {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const centroid of PAVILION_CENTROIDS) {
    const distance = squaredDistance(latitude, longitude, centroid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = centroid.country;
    }
  }
  return best;
}

/**
 * Resolve an EPCOT World Showcase Experience's country pavilion.
 *
 * Gating: returns `null` unless `land` is exactly `"World Showcase"` — the
 * only `land` value under which a pavilion is meaningful. For a World Showcase
 * Experience, an explicit name-keyword match wins; otherwise the nearest
 * pavilion centroid by coordinates is used; otherwise `null`.
 *
 * @param doc  - The (adapted) Facility_Document, for `name` and coordinates.
 * @param land - The already-resolved Land (see `resolveLand`).
 * @returns The resolved World Showcase country, or `null`.
 */
export function resolveWorldShowcaseCountry(
  doc: FacilityDocument,
  land: string | null,
): string | null {
  // Gate on the resolved Land: World Showcase is the only land where a country
  // pavilion exists. This also implicitly restricts to EPCOT theme-park docs.
  if (land === null || land.trim() !== WORLD_SHOWCASE_LAND) {
    return null;
  }

  const byName = matchByName(doc.name);
  const resolved = byName ?? matchByCoordinates(doc.latitude, doc.longitude);
  return resolved === null ? null : resolved.slice(0, MAX_COUNTRY_LENGTH);
}
