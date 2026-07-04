/**
 * Facet value model (shared).
 *
 * The reusable shapes for the Disney-sourced facet enrichment mined from each
 * Facility_Document during Catalog_Sync. A Facet_Value is the `{id, name}`
 * pair; the machine `id` is retained for future filtering/targeting and the
 * `name` is the human-readable display label. These types are declared once
 * here and reused by the API cores because they appear on the shared
 * `ExperienceDTO` and are validated by its Zod schema (R9.1).
 *
 * Validates: Requirements 9.1
 */

export interface FacetValueDTO {
  /** Machine identifier retained for future filtering/targeting. */
  readonly id: string;
  /** Human-readable display label. */
  readonly name: string;
}

/**
 * Grouped_Facets: the persisted display-and-targeting-ready structure keyed by
 * Facet_Group name, each value a list of Facet_Values (R1, R7.1). Only the
 * Persisted_Facet_Groups appear as keys; a group with no facets is absent.
 */
export type GroupedFacetsDTO = Readonly<Record<string, readonly FacetValueDTO[]>>;

/** Height_Requirement: the height facet value plus derived numeric minimums (R2). */
export interface HeightRequirementDTO {
  readonly id: string;
  readonly name: string;
  /** Derived minimum height in inches, or null when the id encodes none (R2.2, R2.4). */
  readonly minInches: number | null;
  /** Derived minimum height in centimeters, or null when the id encodes none (R2.3, R2.4). */
  readonly minCentimeters: number | null;
}

/** Why_This: structured curated marketing copy (R5). */
export interface WhyThisDTO {
  readonly title: string | null;
  readonly bullets: readonly string[];
  readonly quotes: readonly string[];
}
