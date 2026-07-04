# Requirements Document

## Introduction

Catalog Experiences are enriched during `Catalog_Sync` from the Disney
`Facility_Document`s the sync already fetches from the `Sync_Gateway`. Several
high-value Disney-sourced fields are present in those documents today but are
discarded: the raw `facets` array is collapsed down to only `accessibility`,
`priceRangeDining`, and `interests`, and the `whyThis` and `subType` fields are
never read.

This feature mines those already-synced fields — ride height requirements,
physical/health advisories, interest/targeting facet groups, the structured
`whyThis` marketing copy, and the finer `Facility_SubType` — and carries them
through the existing full-stack enrichment path: facet normalization → database
persistence → `Catalog_Repo` projection → `Experience_DTO` (and its Zod schema)
→ the catalog detail route → the mobile `Experience_Detail_Screen`. No new
external data source is introduced. `Catalog_Sync` remains the sole writer, each
new field is present only when persisted (mirroring how coordinates,
accessibility, and price tier behave today), and every field is stored in a
shape that supports both display now and future targeting/filtering. Scope is
limited to Experiences (attractions, shows, and other Experience-eligible
types); Resorts are out of scope. The live (ThemeParks.wiki) path and the menu
source are unchanged.

## Glossary

- **Catalog_Sync**: The scheduled process that fetches `Facility_Document`s,
  normalizes and reconciles them, and is the sole writer of catalog rows.
- **Sync_Gateway**: The Disney Couchbase Sync Gateway `POST /_bulk_get`
  endpoint that supplies `Facility_Document`s.
- **Facility_Document**: One tolerant projection of a Disney entity document
  (attraction, entertainment, restaurant, etc.) as modeled in
  `apps/api/src/services/catalog/disney/facilityDoc.ts`.
- **Facet**: One raw entry in a `Facility_Document`'s `facets` array, of the
  form `{ facetId, group, id, name }`.
- **Facet_Group**: The `group` value of a `Facet` (e.g. `height`,
  `physicalConsiderations`, `interests`, `thrillFactor`, `age`, `parkInterests`,
  `disneyFavorites`).
- **Facet_Value**: A `{ id, name }` pair derived from a `Facet`, where `id` is
  the machine identifier retained for future filtering/targeting and `name` is
  the human-readable display label.
- **Persisted_Facet_Groups**: The set of `Facet_Group`s this feature captures:
  `height`, `physicalConsiderations`, `interests`, `thrillFactor`, `age`,
  `parkInterests`, and `disneyFavorites`.
- **Grouped_Facets**: The stored, display-and-targeting-ready structure keyed by
  `Facet_Group` name, each value a list of `Facet_Value`s.
- **Facet_Normalization**: The step in `adaptFacilityDocument` (`buildFacets`)
  that converts the raw `facets` array into grouped facet data.
- **Enrichment_Extractor**: The pure core (`enrich.ts`, `extractEnrichment`)
  that projects a `Facility_Document` into the enrichment persisted on an
  Experience.
- **Height_Requirement**: The ride height restriction sourced from the `height`
  `Facet_Group`, carrying the `Facet_Value` plus derived numeric minimums.
- **Physical_Considerations**: Health/physical advisories sourced from the
  `physicalConsiderations` `Facet_Group` (e.g. "Expectant Mothers Advisory").
- **Interest_Facets**: The targeting-oriented `Facet_Group`s (`interests`,
  `thrillFactor`, `age`, `parkInterests`, `disneyFavorites`) surfaced for
  display and future targeting/filtering.
- **Why_This**: The structured `Facility_Document` field
  `{ title: string, bullets: string[], quotes: string[] }` carrying curated
  marketing copy.
- **Facility_SubType**: The optional finer classification (`subType`) on a
  `Facility_Document`, frequently absent for rides.
- **Catalog_Repo**: The repository (`repo.ts`) that persists and projects
  Experience rows.
- **Experience_DTO**: The shared `ExperienceDTO` type and its Zod schema in
  `packages/shared`.
- **Catalog_Detail_Route**: The `GET /catalog/:experienceId` handler returning
  an `ExperienceDetailResponse`.
- **Experience_Detail_Screen**: The mobile screen (`ExperienceDetailScreen.tsx`)
  that renders one Experience.
- **Info_Tag**: A compact labelled indicator on the `Experience_Detail_Screen`,
  built by `buildInfoTags`.
- **Experience**: A catalog item of an Experience-eligible type; the unit this
  feature enriches.

## Requirements

### Requirement 1: Retain the captured facet groups during normalization

**User Story:** As a catalog maintainer, I want the additional Disney facet
groups retained during normalization, so that fields already present in synced
documents are no longer discarded.

#### Acceptance Criteria

1. WHEN Facet_Normalization processes a Facility_Document whose `facets` array contains a Facet whose `group` is one of the Persisted_Facet_Groups, THE Facet_Normalization SHALL retain that Facet as a Facet_Value under its Facet_Group in the Grouped_Facets structure.
2. WHEN Facet_Normalization retains a Facet_Value, THE Facet_Normalization SHALL preserve both the machine `id` and the human-readable `name` of the Facet.
3. WHEN a Facility_Document contains multiple Facets in the same Facet_Group, THE Facet_Normalization SHALL retain each Facet_Value in the order the Facets appear in the `facets` array.
4. WHERE a Facility_Document contains a Facet whose `group` is not one of the Persisted_Facet_Groups and is not an existing captured group, THE Facet_Normalization SHALL exclude that Facet from the Grouped_Facets structure.
5. IF a Facet entry is missing its `group`, `id`, or `name`, THEN THE Facet_Normalization SHALL exclude that entry from the Grouped_Facets structure.
6. THE Facet_Normalization SHALL continue to produce the existing `accessibility`, `priceRangeDining`, and `interests` outputs relied on by the current Enrichment_Extractor.

### Requirement 2: Extract the ride height requirement

**User Story:** As a guest, I want to see a ride's height requirement, so that I
know whether my party can ride, and so the catalog can filter by height later.

#### Acceptance Criteria

1. WHEN a Facility_Document carries at least one `height` Facet, THE Enrichment_Extractor SHALL produce a Height_Requirement carrying the `id` and `name` of the first `height` Facet_Value.
2. WHEN the Enrichment_Extractor produces a Height_Requirement whose `id` encodes a minimum height in inches, THE Enrichment_Extractor SHALL derive a numeric minimum height in inches.
3. WHEN the Enrichment_Extractor produces a Height_Requirement whose `id` encodes a minimum height in centimeters, THE Enrichment_Extractor SHALL derive a numeric minimum height in centimeters.
4. IF a Height_Requirement `id` encodes no parseable numeric minimum, THEN THE Enrichment_Extractor SHALL set the numeric minimum height in inches to null and the numeric minimum height in centimeters to null while retaining the `id` and `name`.
5. IF a Facility_Document carries no `height` Facet, THEN THE Enrichment_Extractor SHALL set the Height_Requirement to null.

### Requirement 3: Extract physical and health advisories

**User Story:** As a guest, I want to see physical and health advisories for a
ride, so that I can decide whether it is appropriate for me.

#### Acceptance Criteria

1. WHEN a Facility_Document carries at least one `physicalConsiderations` Facet, THE Enrichment_Extractor SHALL produce a Physical_Considerations list containing one Facet_Value per `physicalConsiderations` Facet, in the order the Facets appear.
2. WHEN the Enrichment_Extractor produces a Physical_Considerations Facet_Value, THE Enrichment_Extractor SHALL preserve both the `id` and the `name` of the Facet.
3. IF a Facility_Document carries no `physicalConsiderations` Facet, THEN THE Enrichment_Extractor SHALL produce an empty Physical_Considerations list.

### Requirement 4: Extract interest and targeting facet groups

**User Story:** As a product owner, I want interest and targeting facet groups
captured on each Experience, so that they can be displayed now and used for
targeting/filtering later.

#### Acceptance Criteria

1. WHEN a Facility_Document carries Facets in the `interests`, `thrillFactor`, `age`, `parkInterests`, or `disneyFavorites` Facet_Groups, THE Enrichment_Extractor SHALL produce Interest_Facets containing, for each such Facet_Group, a list of its Facet_Values in the order the Facets appear.
2. WHEN the Enrichment_Extractor produces an Interest_Facets Facet_Value, THE Enrichment_Extractor SHALL preserve both the `id` and the `name` of the Facet.
3. IF a Facility_Document carries no Facet for a given Interest_Facets Facet_Group, THEN THE Enrichment_Extractor SHALL omit that Facet_Group from the Interest_Facets structure.
4. IF a Facility_Document carries no Facet in any Interest_Facets Facet_Group, THEN THE Enrichment_Extractor SHALL produce an empty Interest_Facets structure.

### Requirement 5: Extract the structured whyThis copy

**User Story:** As a guest, I want to read a short "why visit this" summary on an
Experience, so that I understand what makes it appealing.

#### Acceptance Criteria

1. WHEN a Facility_Document carries a Why_This object, THE Enrichment_Extractor SHALL produce a Why_This value carrying its `title`, its `bullets` list, and its `quotes` list.
2. WHEN the Enrichment_Extractor produces a Why_This value, THE Enrichment_Extractor SHALL preserve the order of entries within the `bullets` list and within the `quotes` list.
3. IF a Why_This object omits `title`, THEN THE Enrichment_Extractor SHALL set the Why_This `title` to null.
4. IF a Why_This object omits `bullets` or omits `quotes`, THEN THE Enrichment_Extractor SHALL set the corresponding list to an empty list.
5. IF a Facility_Document carries no Why_This object, THEN THE Enrichment_Extractor SHALL set the Why_This value to null.

### Requirement 6: Extract the optional Facility_SubType

**User Story:** As a catalog maintainer, I want the finer subType captured when
present, so that Experiences carry a more precise classification when Disney
provides one.

#### Acceptance Criteria

1. WHEN a Facility_Document carries a non-empty `subType`, THE Enrichment_Extractor SHALL produce a Facility_SubType value equal to that `subType`.
2. IF a Facility_Document omits `subType` or carries a whitespace-only `subType`, THEN THE Enrichment_Extractor SHALL set the Facility_SubType value to null.

### Requirement 7: Persist the new enrichment fields

**User Story:** As a catalog maintainer, I want the new enrichment fields
persisted, so that they survive across syncs and are retrievable on read.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL persist the Grouped_Facets for the Persisted_Facet_Groups on each Experience as a structure keyed by Facet_Group name, each value a list of Facet_Values carrying `id` and `name`.
2. THE Catalog_Sync SHALL persist the Height_Requirement on each Experience, including its `id`, `name`, numeric minimum inches, and numeric minimum centimeters.
3. THE Catalog_Sync SHALL persist the Why_This value on each Experience, including its `title`, `bullets`, and `quotes`.
4. THE Catalog_Sync SHALL persist the Facility_SubType on each Experience when present.
5. WHERE a new enrichment field is absent for an Experience, THE Catalog_Sync SHALL persist a null or empty value for that field so that no partial or fabricated value is stored.
6. THE Catalog_Sync SHALL persist the new enrichment fields without altering any existing persisted column or any Experience identifier.

### Requirement 8: Project the new enrichment fields on read

**User Story:** As an API consumer, I want the new enrichment fields returned
with an Experience, so that clients can display and filter on them.

#### Acceptance Criteria

1. WHEN the Catalog_Repo reads an Experience that has a persisted Height_Requirement, THE Catalog_Repo SHALL include the Height_Requirement (its `id`, `name`, numeric minimum inches, and numeric minimum centimeters) in the projected Experience.
2. WHEN the Catalog_Repo reads an Experience that has persisted Grouped_Facets, THE Catalog_Repo SHALL include the Grouped_Facets, Physical_Considerations, and Interest_Facets in the projected Experience.
3. WHEN the Catalog_Repo reads an Experience that has a persisted Why_This value, THE Catalog_Repo SHALL include the Why_This value in the projected Experience.
4. WHEN the Catalog_Repo reads an Experience that has a persisted Facility_SubType, THE Catalog_Repo SHALL include the Facility_SubType in the projected Experience.
5. WHERE a new enrichment field was not persisted for an Experience, THE Catalog_Repo SHALL omit that field or project it as null, mirroring how coordinates, accessibility, and price tier are projected today.

### Requirement 9: Expose the new fields on the Experience_DTO and its schema

**User Story:** As a client developer, I want the new fields on the shared
Experience_DTO and validated by its schema, so that I can consume them with type
safety.

#### Acceptance Criteria

1. THE Experience_DTO SHALL declare optional fields for the Height_Requirement, the Grouped_Facets, the Physical_Considerations, the Interest_Facets, the Why_This value, and the Facility_SubType.
2. WHEN a client validates an Experience_DTO that carries the new enrichment fields with valid values, THE Experience_DTO schema SHALL accept the payload.
3. WHEN a client validates an Experience_DTO that omits the new enrichment fields, THE Experience_DTO schema SHALL accept the payload.
4. IF an Experience_DTO payload carries a new enrichment field whose value violates its declared shape, THEN THE Experience_DTO schema SHALL reject the payload.

### Requirement 10: Return the new fields on the detail route

**User Story:** As a mobile client, I want the new fields on the detail
response, so that the Experience_Detail_Screen can render them.

#### Acceptance Criteria

1. WHEN the Catalog_Detail_Route serves an Experience that has persisted new enrichment fields, THE Catalog_Detail_Route SHALL include the Height_Requirement, Grouped_Facets, Physical_Considerations, Interest_Facets, Why_This value, and Facility_SubType in the detail response.
2. WHERE a new enrichment field was not persisted for the requested Experience, THE Catalog_Detail_Route SHALL omit that field from the detail response.
3. THE Catalog_Detail_Route SHALL return the new enrichment fields without changing the existing detail-response fields or the `GET /catalog/:experienceId/live` behavior.

### Requirement 11: Surface the new fields on the Experience_Detail_Screen

**User Story:** As a guest, I want the height requirement, advisories, interest
tags, and a short summary on the Experience detail screen, so that I can learn
about the Experience at a glance.

#### Acceptance Criteria

1. WHEN the Experience_Detail_Screen renders an Experience that carries a Height_Requirement, THE Experience_Detail_Screen SHALL display the Height_Requirement `name`.
2. WHEN the Experience_Detail_Screen renders an Experience that carries Physical_Considerations, THE Experience_Detail_Screen SHALL display each Physical_Considerations `name`.
3. WHEN the Experience_Detail_Screen renders an Experience that carries Interest_Facets, THE Experience_Detail_Screen SHALL display each Interest_Facet `name`.
4. WHEN the Experience_Detail_Screen renders an Experience whose Why_This value carries one or more bullets, THE Experience_Detail_Screen SHALL display the bullets as flavor text.
5. WHERE a new enrichment field is absent or empty for the rendered Experience, THE Experience_Detail_Screen SHALL omit its corresponding display element.
6. WHEN the Experience_Detail_Screen displays a new enrichment field, THE Experience_Detail_Screen SHALL provide a screen-reader accessible label for that element.

### Requirement 12: Reconcile the new fields following the existing enrichment pattern

**User Story:** As a catalog maintainer, I want the new fields reconciled the
same way as existing enrichment, so that behavior is predictable and
`Catalog_Sync` stays the sole writer.

#### Acceptance Criteria

1. WHEN Catalog_Sync upserts an Experience, THE Catalog_Sync SHALL write the new enrichment fields from the current Facility_Document.
2. THE Catalog_Sync SHALL treat the new enrichment fields as carried-through values that are not on their own a drift signal, so that a change limited to a new enrichment field does not by itself trigger an upsert, consistent with the existing coordinates, accessibility, and price-tier handling.
3. WHILE an Experience is soft-deleted, THE Catalog_Repo SHALL preserve the last-persisted new enrichment fields on that Experience.
4. THE Catalog_Sync SHALL remain the sole writer of the new enrichment fields.

### Requirement 13: Constrain scope to Experiences and preserve unaffected paths

**User Story:** As a maintainer, I want this feature scoped narrowly, so that
Resorts, the live path, and the menu source are unaffected.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL apply the new enrichment fields only to Experiences of an Experience-eligible type.
2. THE Catalog_Sync SHALL leave the Resort persistence path unchanged.
3. THE Catalog_Detail_Route SHALL leave the ThemeParks.wiki live path unchanged.
4. THE Catalog_Sync SHALL leave the menu source and menu persistence unchanged.
