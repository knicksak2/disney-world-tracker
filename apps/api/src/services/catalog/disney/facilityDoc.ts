/**
 * Facility_Document model, Enterprise_Id parsing, and the Facility_Type sets.
 *
 * This module is the single source of truth for two closely related concerns
 * described in design.md → "3. Facility_Document model and Enterprise_Id":
 *
 *   1. The **tolerant** raw shape of one Disney entity document as returned by
 *      the `Disney_Sync_Gateway` `POST /_bulk_get` endpoint (`FacilityDocument`
 *      and its ancestor references). The Disney sources are undocumented and
 *      reverse-engineered, so the projection is deliberately permissive: only
 *      `id` is required at the type level, and every other field is optional so
 *      that a partial-but-recognized document still flows through the pure
 *      transformation cores rather than failing an entire sync (R3.5, R3.6).
 *      Document-level exclusion of tombstones (`softDeleted`) and blank-name
 *      documents (R3.4, R3.7) is a concern of the sync orchestrator's
 *      normalization step, not of this type.
 *
 *   2. The **Facility_Type membership sets** — `EXPERIENCE_ELIGIBLE_TYPES` and
 *      `NON_EXPERIENCE_TYPES` — taken verbatim from the requirements Glossary.
 *      Declaring them here as `ReadonlySet`s gives classification
 *      (`classifyFacility.ts`) and the property-test generators one shared,
 *      authoritative definition, so the "every Experience_Eligible_Type is a
 *      candidate Experience and every Non_Experience_Type is excluded" rule
 *      (R4.1) cannot drift between the code and its tests.
 *
 * Purity note: `parseEnterpriseId` is pure, total, and deterministic — it never
 * throws and returns `null` for any input that is not a well-formed
 * Enterprise_Id, mirroring the null-on-failure discipline used elsewhere in the
 * catalog service (e.g. area resolution).
 *
 * Validates: Requirements 3.5, 3.6, 4.1
 */

import type { FacetValueDTO, GroupedFacetsDTO } from '@dwt/shared';

/**
 * A reference to one ancestor of a Facility_Document, forming the ancestor
 * chain that area resolution (`area.ts`) walks to determine an Experience's
 * owning Area and Area_Type (R4.11–R4.15).
 *
 * Only `id` (the ancestor's Enterprise_Id) is required; `type` and `name` are
 * optional because upstream documents are not guaranteed to carry them.
 */
export interface AncestorRef {
  /** Enterprise_Id of the ancestor (e.g. `80007944;entityType=theme-park`). */
  readonly id: string;
  /** Ancestor Facility_Type, e.g. `theme-park`, `water-park`, `resort`, `resort-area`, `destination`. */
  readonly type?: string;
  /** Ancestor display name. */
  readonly name?: string;
}

/**
 * A tolerant projection of one Disney entity document (attraction,
 * entertainment, restaurant, resort, etc.).
 *
 * Only `id` is required at the type level. `name` and `type` are the logical
 * "required" fields per the Glossary's Facility_Document definition and
 * R3.6, but they are typed as optional here so that parsing a partial or
 * malformed document never fails at the type boundary — the sync
 * orchestrator's normalization step (R3.4, R3.7) is responsible for excluding
 * tombstones and blank-name documents, and downstream pure cores tolerate the
 * absence of any optional field (R3.5).
 */
export interface FacilityDocument {
  /** Enterprise_Id, e.g. `"80010177;entityType=Attraction"`. */
  readonly id: string;
  /**
   * The raw Couchbase Sync Gateway document id, when present. Real documents
   * key their identity under `_id` in a channel-prefixed form
   * (e.g. `"wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant"`)
   * rather than a bare Enterprise_Id. Normalization
   * ({@link normalizeFacilityDocument}) derives the clean {@link id} from this
   * (or from a clean `id`) so downstream cores always see the Enterprise_Id.
   */
  readonly _id?: string;
  /** Couchbase revision token, when present; carried through untouched. */
  readonly _rev?: string;
  /** Display name. Absent or whitespace-only → excluded by normalization (R3.7). */
  readonly name?: string;
  /** Facility_Type, e.g. `attraction`, `entertainment`, `restaurant`, `resort`. */
  readonly type?: string;
  /** Facility_SubType, finer classification signal (e.g. `"Nighttime Spectacular"`). */
  readonly subType?: string;
  /** Long-form description (HTML/markup stripped before persistence, R11.8). */
  readonly description?: string;
  /** Preferred image URL (wins over `listImageUrl`, R7.1). */
  readonly detailImageUrl?: string;
  /** Fallback image URL (used when `detailImageUrl` is absent, R7.2). */
  readonly listImageUrl?: string;
  /** Latitude coordinate (R5.1); paired with `longitude`. */
  readonly latitude?: number;
  /** Longitude coordinate (R5.1); paired with `latitude`. */
  readonly longitude?: number;
  /** Street address. */
  readonly address?: string;
  /** Contact phone number. */
  readonly phone?: string;
  /** Ancestor chain used for area resolution (R4.11–R4.15). */
  readonly ancestors?: readonly AncestorRef[];
  /** Structured facet tags grouped by facet kind (R5.3, R5.4). */
  readonly facets?: {
    /** Accessibility tags, e.g. `"wheelchair-access"` (R5.3). */
    readonly accessibility?: readonly string[];
    /** Dining price-range tags, e.g. `"$"` (R5.4). */
    readonly priceRangeDining?: readonly string[];
    /** Interest tags. */
    readonly interests?: readonly string[];
  };
  /** Restaurant meal periods with type and price tier (R5.5). */
  readonly mealPeriods?: readonly {
    readonly type?: string;
    readonly priceTier?: string;
  }[];
  /**
   * Structured "why visit this" marketing copy, when present (R5). Tolerant and
   * optional: every field may be absent, so the Enrichment_Extractor is
   * responsible for normalizing missing pieces to null/empty.
   */
  readonly whyThis?: {
    readonly title?: string;
    readonly bullets?: readonly string[];
    readonly quotes?: readonly string[];
  };
  /**
   * Grouped_Facets keyed by Facet_Group name, each a list of `{id, name}`
   * Facet_Values (R1). Synthesized by {@link buildGroupedFacets} from the raw
   * `facets` array during {@link adaptFacilityDocument}; present only for groups
   * that carried at least one valid facet.
   */
  readonly groupedFacets?: GroupedFacetsDTO;
  /** Tombstone flag; `true` → excluded by normalization (R3.4). */
  readonly softDeleted?: boolean;
  /** Upstream last-update timestamp. */
  readonly lastUpdate?: string;
  /** Sync Gateway channels the document belongs to. */
  readonly channels?: readonly string[];
}

/**
 * The parsed components of an Enterprise_Id.
 *
 * @see parseEnterpriseId
 */
export interface ParsedEnterpriseId {
  /** The leading numeric identifier, e.g. `"80010177"`. */
  readonly numericId: string;
  /** The `entityType` component, e.g. `"Attraction"`. */
  readonly entityType: string;
}

/**
 * Matches a well-formed Enterprise_Id of the form `{numericId};entityType={Type}`.
 *
 *   - `numericId` is one or more digits (capture group 1).
 *   - `entityType` is one or more non-empty characters after the literal
 *     `;entityType=` separator (capture group 2).
 *
 * Anchored at both ends so that trailing or leading garbage yields no match
 * (and therefore `null` from `parseEnterpriseId`).
 */
const ENTERPRISE_ID_PATTERN = /^(\d+);entityType=(.+)$/;

/**
 * Parse an Enterprise_Id string into its `numericId` and `entityType` parts.
 *
 * The Enterprise_Id format is `{numericId};entityType={Type}` (Glossary),
 * e.g. `"80010177;entityType=Attraction"`.
 *
 * Pure, total, and deterministic: returns the parsed components for a
 * well-formed id, or `null` for any input that is empty, missing the
 * `;entityType=` separator, has a non-numeric id part, or has an empty
 * `entityType`. Never throws.
 *
 * @param id - The Enterprise_Id string to parse.
 * @returns The parsed components, or `null` when `id` is not well-formed.
 */
export function parseEnterpriseId(id: string): ParsedEnterpriseId | null {
  const match = ENTERPRISE_ID_PATTERN.exec(id);
  if (match === null) {
    return null;
  }
  const [, numericId, entityType] = match;
  if (numericId === undefined || entityType === undefined) {
    return null;
  }
  return { numericId, entityType };
}

/**
 * Matches an Enterprise_Id token — `{numericId};entityType={Type}` — anywhere
 * in a string. The real Sync Gateway keys documents (and `_changes` results)
 * by a channel-prefixed Couchbase id such as
 * `"wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant"`, in
 * which the Enterprise_Id is the trailing token. `Type` is one or more
 * alphanumeric/underscore/hyphen characters (covers `Attraction`, `restaurant`,
 * `theme-park`, `resort-area`, `water-park`, `dinner-show`, …). Global so the
 * *last* token can be taken, which is the document's own id even when ancestor
 * ids or other tokens precede it.
 */
const ENTERPRISE_ID_TOKEN = /(\d+;entityType=[A-Za-z0-9_-]+)/g;

/**
 * Derive the clean Enterprise_Id from a raw id string, tolerating both forms:
 *
 *   - a bare Enterprise_Id (`"80010177;entityType=Attraction"`) is returned
 *     unchanged (the pattern matches the whole string), so the function is
 *     idempotent; and
 *   - a channel-prefixed Couchbase `_id`
 *     (`"wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant"`)
 *     yields its trailing Enterprise_Id token (`"412260665;entityType=restaurant"`).
 *
 * Pure, total, and deterministic: returns `null` for any input carrying no
 * Enterprise_Id token. When several tokens are present (e.g. an id that also
 * embeds an ancestor token) the LAST one — the document's own id — is returned.
 */
export function deriveEnterpriseId(rawId: string): string | null {
  const matches = rawId.match(ENTERPRISE_ID_TOKEN);
  if (matches === null || matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1] ?? null;
}

/**
 * Normalize a raw parsed Sync Gateway document into a {@link FacilityDocument}
 * whose `id` is the clean Enterprise_Id where derivable.
 *
 * Resolution order for `id`:
 *   1. the Enterprise_Id token derived from a clean top-level `id`, else
 *   2. the Enterprise_Id token derived from the Couchbase `_id`
 *      (channel-prefixed), else
 *   3. the raw `id` string as-is, else
 *   4. the raw `_id` string as-is.
 *
 * This keeps the parser tolerant: a document that carries an Enterprise_Id
 * token (real Sync Gateway data keys it under `_id`) is normalized to the clean
 * Enterprise_Id every downstream core expects, while a document with some other
 * non-empty id (e.g. a test fixture id) is preserved verbatim rather than
 * dropped. Only a document with no usable id string at all returns `null` — it
 * cannot be keyed and is dropped by the caller (mirroring the per-part
 * resilience of the bulk_get parser, R3.3). The rest of the raw body (including
 * `_id`/`_rev`) is preserved so nothing downstream is lost.
 */
export function normalizeFacilityDocument(
  raw: Record<string, unknown>,
): FacilityDocument | null {
  const rawId =
    typeof raw['id'] === 'string' && raw['id'].length > 0 ? raw['id'] : null;
  const rawUnderscoreId =
    typeof raw['_id'] === 'string' && raw['_id'].length > 0 ? raw['_id'] : null;

  const id =
    (rawId !== null ? deriveEnterpriseId(rawId) : null) ??
    (rawUnderscoreId !== null ? deriveEnterpriseId(rawUnderscoreId) : null) ??
    rawId ??
    rawUnderscoreId;

  if (id === null) {
    return null;
  }

  // Ancestor ids drive area / park / resort resolution and are expected in the
  // clean Enterprise_Id form. Real Sync Gateway ancestor references are keyed
  // the same channel-prefixed way as the document id, so normalize each to its
  // Enterprise_Id token when derivable (idempotent for already-clean ids;
  // preserves any non-Enterprise_Id id verbatim).
  const rawAncestors = raw['ancestors'];
  if (Array.isArray(rawAncestors)) {
    const ancestors = rawAncestors.map((entry) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string'
      ) {
        const ancestorRaw = entry as Record<string, unknown>;
        const ancestorId = ancestorRaw['id'] as string;
        return { ...ancestorRaw, id: deriveEnterpriseId(ancestorId) ?? ancestorId };
      }
      return entry;
    });
    return { ...(raw as Record<string, unknown>), id, ancestors } as FacilityDocument;
  }

  return { ...(raw as Record<string, unknown>), id } as FacilityDocument;
}

/**
 * The Facility_Type of a Disney `resort` document.
 *
 * A `resort` is never a catalog Experience; it is produced as a first-class
 * Resort record instead (Requirement 6). It is therefore excluded from both
 * membership sets below and handled by the sync orchestrator's Resort split.
 * Declared here so the resort split shares this single definition and does
 * not confuse `resort` with the structural `resort-area` type (R6.2).
 */
export const RESORT_TYPE = 'resort';

/**
 * Every Facility_Type that becomes a candidate catalog Experience (Glossary,
 * R4.1). Declared as the single source of truth so classification and its
 * property generators agree on the eligible type space.
 */
export const EXPERIENCE_ELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  'attraction',
  'entertainment',
  'restaurant',
  'dinner-show',
  'recreation',
  'recreation-activity',
  'tour',
  'audio-tour',
  'spa',
  'event',
  'dining-event',
]);

/**
 * Every Facility_Type that is structural or non-experiential and is never a
 * catalog Experience (Glossary, R4.1). `resort` is intentionally NOT a member
 * of this set: although it is likewise never an Experience, it is handled as a
 * Resort record (Requirement 6) via {@link RESORT_TYPE} rather than simply
 * excluded.
 */
export const NON_EXPERIENCE_TYPES: ReadonlySet<string> = new Set([
  'guest-service',
  'merchandise-facility',
  'transportation',
  'photopass',
  'bus-stop',
  'land',
  'entertainment-venue',
  'resort-area',
  'destination',
  'theme-park',
  'water-park',
  'avatar',
]);

// ---------------------------------------------------------------------------
// Real Sync Gateway shape adapter
// ---------------------------------------------------------------------------
//
// The pure transformation cores (`classifyFacility`, `resolveArea`,
// `extractEnrichment`, `selectImageUrl`) were written against the tolerant
// FacilityDocument shape above. The real Disney Sync Gateway documents differ
// from that shape in several ways discovered against live data:
//
//   - `type` is PascalCase / mixed-case (`"Attraction"`, `"Entertainment"`,
//     `"Recreation"`, `"Dinner-Show"`) rather than the lowercase tokens the
//     eligibility set and classifier compare against.
//   - There is no `ancestors` array; the hierarchy lives in top-level
//     `ancestorThemePark` / `ancestorWaterPark` / `ancestorEntertainmentVenue`
//     / `ancestorResort` / `ancestorResortArea` / `ancestorLand` name fields
//     (each with an `*Id` companion carrying the Enterprise_Id).
//   - `facets` is an array of `{ id, name, group }` grouped by `group`
//     (`priceRangeDining`, `mobilityDisabilities`, …) rather than an object.
//   - `latitude` / `longitude` are strings (`"28.35"`), not numbers.
//   - `mealPeriods` entries carry `mealType` / `price` rather than
//     `type` / `priceTier`.
//
// `adaptFacilityDocument` maps a raw stored document into the shape the cores
// expect, so classification, area resolution, and enrichment work against real
// data without rewriting (or re-testing) those cores. It is pure, total, and
// deterministic. Applied at reconcile time, so it works over already-stored
// documents without re-fetching from Disney.

/** A non-empty trimmed string, or `undefined`. */
function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A finite number parsed from a number or numeric string, else `undefined`. */
function readNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** The ancestor name/id field pairs and the Facility_Type each maps to. */
const ANCESTOR_FIELD_MAP: ReadonlyArray<{
  readonly nameKey: string;
  readonly idKey: string;
  readonly type: string;
}> = [
  { nameKey: 'ancestorThemePark', idKey: 'ancestorThemeParkId', type: 'theme-park' },
  { nameKey: 'ancestorWaterPark', idKey: 'ancestorWaterParkId', type: 'water-park' },
  {
    nameKey: 'ancestorEntertainmentVenue',
    idKey: 'ancestorEntertainmentVenueId',
    type: 'entertainment-venue',
  },
  { nameKey: 'ancestorResort', idKey: 'ancestorResortId', type: 'resort' },
  { nameKey: 'ancestorResortArea', idKey: 'ancestorResortAreaId', type: 'resort-area' },
  { nameKey: 'ancestorLand', idKey: 'ancestorLandId', type: 'land' },
];

/** Synthesize the `ancestors` chain `resolveArea` walks from the flat fields. */
function buildAncestors(raw: Record<string, unknown>): AncestorRef[] {
  const ancestors: AncestorRef[] = [];
  for (const { nameKey, idKey, type } of ANCESTOR_FIELD_MAP) {
    const name = readNonEmptyString(raw[nameKey]);
    if (name === undefined) {
      continue;
    }
    const rawId = readNonEmptyString(raw[idKey]);
    const id = rawId !== undefined ? (deriveEnterpriseId(rawId) ?? rawId) : name;
    ancestors.push({ id, type, name });
  }
  return ancestors;
}

/** Facet `group` values that map to each grouped facet list the cores read. */
const ACCESSIBILITY_GROUPS: ReadonlySet<string> = new Set([
  'mobilityDisabilities',
  'accessibility',
  'hearingDisabilities',
  'visualDisabilities',
  'serviceAnimals',
]);

/**
 * The Facet_Groups this feature captures into Grouped_Facets (Glossary, R1).
 * Declared here as the single source of truth so the normalizer, the
 * Enrichment_Extractor views, and their property generators cannot drift.
 */
export const PERSISTED_FACET_GROUPS: ReadonlySet<string> = new Set([
  'height',
  'physicalConsiderations',
  'interests',
  'thrillFactor',
  'age',
  'parkInterests',
  'disneyFavorites',
  'diningInterests',
  'cuisine',
  'dining',
  'quickService',
  'tableService',
]);

/**
 * The interest/targeting subset of the Persisted_Facet_Groups surfaced as
 * Interest_Facets (R4) — every Persisted_Facet_Group except `height` and
 * `physicalConsiderations`.
 */
export const INTEREST_FACET_GROUPS: readonly string[] = [
  'interests',
  'thrillFactor',
  'age',
  'parkInterests',
  'disneyFavorites',
  'diningInterests',
  'cuisine',
  'dining',
  'quickService',
  'tableService',
];

/**
 * Build the Grouped_Facets structure from a raw `facets` array (R1).
 *
 * Walks the array once, keeping each entry whose `group` is one of the
 * {@link PERSISTED_FACET_GROUPS} as a `{id, name}` Facet_Value under its group,
 * in appearance order (R1.1, R1.2, R1.3). Entries whose `group` is not a
 * Persisted_Facet_Group are excluded (R1.4), and entries missing `group`, `id`,
 * or `name` — or carrying a non-string value for any of them — are skipped
 * (R1.5).
 *
 * Pure, total, and deterministic; returns an empty structure when nothing
 * qualifies. Only groups that carried at least one valid facet appear as keys.
 */
function buildGroupedFacets(rawFacets: readonly unknown[]): GroupedFacetsDTO {
  const grouped: Record<string, FacetValueDTO[]> = {};
  for (const entry of rawFacets) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { group, id, name } = entry as Record<string, unknown>;
    // R1.5: skip entries missing group, id, or name (or with non-string values).
    if (
      typeof group !== 'string' ||
      typeof id !== 'string' ||
      typeof name !== 'string'
    ) {
      continue;
    }
    // R1.1 / R1.4: only the Persisted_Facet_Groups are captured.
    if (!PERSISTED_FACET_GROUPS.has(group)) {
      continue;
    }
    // R1.2: preserve both id and name. R1.3: preserve appearance order.
    (grouped[group] ??= []).push({ id, name });
  }
  return grouped;
}

/** Convert the real facets array into the grouped object the cores expect. */
function buildFacets(raw: Record<string, unknown>): FacilityDocument['facets'] {
  const rawFacets = raw['facets'];
  if (!Array.isArray(rawFacets)) {
    // Already an object (test fixtures) — pass through unchanged.
    return typeof rawFacets === 'object' && rawFacets !== null
      ? (rawFacets as FacilityDocument['facets'])
      : undefined;
  }
  const accessibility: string[] = [];
  const priceRangeDining: string[] = [];
  const interests: string[] = [];
  for (const entry of rawFacets) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const group = (entry as { group?: unknown }).group;
    const id = (entry as { id?: unknown }).id;
    if (typeof group !== 'string' || typeof id !== 'string') {
      continue;
    }
    if (ACCESSIBILITY_GROUPS.has(group)) {
      accessibility.push(id);
    } else if (group === 'priceRangeDining') {
      priceRangeDining.push(id);
    } else if (group === 'interests') {
      interests.push(id);
    }
  }
  const facets: {
    accessibility?: readonly string[];
    priceRangeDining?: readonly string[];
    interests?: readonly string[];
  } = {};
  if (accessibility.length > 0) facets.accessibility = accessibility;
  if (priceRangeDining.length > 0) facets.priceRangeDining = priceRangeDining;
  if (interests.length > 0) facets.interests = interests;
  return Object.keys(facets).length > 0 ? facets : undefined;
}

/** Map the real `mealPeriods` (`mealType`/`price`) to the cores' `type`/`priceTier`. */
function buildMealPeriods(
  raw: Record<string, unknown>,
): FacilityDocument['mealPeriods'] {
  const rawPeriods = raw['mealPeriods'];
  if (!Array.isArray(rawPeriods)) {
    return undefined;
  }
  const periods: { type?: string; priceTier?: string }[] = [];
  for (const entry of rawPeriods) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    // Real documents label the meal period under `mealType` and carry `price`;
    // the fixture shape uses `type`/`priceTier`. In raw Disney documents, the
    // document-level entity type `"MealPeriod"` sometimes appears as `type`.
    // We must ignore `"MealPeriod"` / `"meal_period"` as a meal type name (D1).
    const rawMealType = readNonEmptyString(rec['mealType']);
    const rawType = readNonEmptyString(rec['type']);
    const candidateType = rawMealType ?? rawType;
    const type =
      candidateType &&
      candidateType.toLowerCase() !== 'mealperiod' &&
      candidateType.toLowerCase() !== 'meal period' &&
      candidateType.toLowerCase() !== 'meal_period'
        ? candidateType
        : undefined;
    const priceTier =
      readNonEmptyString(rec['price']) ?? readNonEmptyString(rec['priceTier']);
    if (type !== undefined) {
      periods.push(priceTier !== undefined ? { type, priceTier } : { type });
    }
  }
  return periods.length > 0 ? periods : undefined;
}

/**
 * Adapt a raw stored Disney document into the {@link FacilityDocument} shape the
 * pure transformation cores expect: lowercase `type`, a synthesized `ancestors`
 * chain from the flat `ancestor*` fields, numeric coordinates coerced from
 * strings, a grouped `facets` object, and normalized `mealPeriods`. All other
 * fields (including `id`, `name`, `description`, `detailImageUrl`,
 * `listImageUrl`) are carried through untouched.
 *
 * Pure, total, and deterministic. Idempotent for documents already in the
 * expected shape (a lowercase `type`, an `ancestors` array, an object `facets`,
 * and numeric coordinates all pass through unchanged), so it is safe to apply
 * to fixtures as well as real data.
 */
export function adaptFacilityDocument(
  raw: Record<string, unknown>,
): FacilityDocument {
  const adapted: Record<string, unknown> = { ...raw };

  const type = readNonEmptyString(raw['type']);
  if (type !== undefined) {
    adapted['type'] = type.toLowerCase();
  }

  const latitude = readNumeric(raw['latitude']);
  const longitude = readNumeric(raw['longitude']);
  if (latitude !== undefined) {
    adapted['latitude'] = latitude;
  } else {
    delete adapted['latitude'];
  }
  if (longitude !== undefined) {
    adapted['longitude'] = longitude;
  } else {
    delete adapted['longitude'];
  }

  // Preserve an existing `ancestors` array (fixtures); otherwise synthesize one
  // from the flat ancestor fields (real data).
  if (!Array.isArray(raw['ancestors'])) {
    const ancestors = buildAncestors(raw);
    if (ancestors.length > 0) {
      adapted['ancestors'] = ancestors;
    }
  }

  const facets = buildFacets(raw);
  if (facets !== undefined) {
    adapted['facets'] = facets;
  } else {
    delete adapted['facets'];
  }

  // Grouped_Facets are mined only from the real array-shaped `facets` (R1);
  // object-shaped fixture facets carry no raw array to mine, so groupedFacets
  // is left absent for them. `whyThis` and `subType` are carried through
  // untouched by the `{ ...raw }` spread above.
  if (Array.isArray(raw['facets'])) {
    adapted['groupedFacets'] = buildGroupedFacets(raw['facets']);
  }

  const mealPeriods = buildMealPeriods(raw);
  if (mealPeriods !== undefined) {
    adapted['mealPeriods'] = mealPeriods;
  } else {
    delete adapted['mealPeriods'];
  }

  return adapted as unknown as FacilityDocument;
}
