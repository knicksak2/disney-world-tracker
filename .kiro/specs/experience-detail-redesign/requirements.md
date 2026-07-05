# Requirements Document

## Introduction

The mobile Experience Detail screen (`apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`)
currently stacks roughly twelve blocks in a single flat column: a gradient header, hero image,
Park/category badges, a Share button, one undifferentiated wrapping row of info tags, a long About
description, a "Why visit" section, the live Wait & Status section, and four separate personal/community
cards (Your Completion, Your Rating, Your Note, Community Rating). The single info-tag row is built by
`buildInfoTags()` in `apps/mobile/src/screens/catalog/infoTags.ts`, which flattens ten tag kinds into one
anonymous row. This produces visual noise (raw coordinates, slug-like labels such as `no-service-animals`),
duplicate values, a long About block that pushes everything down, and personal actions buried at the bottom.

This feature is a client-side presentation and layout reorganization of that screen and its supporting
`infoTags.ts` module. It regroups info tags into labeled sub-groups, relabels raw slugs into human-friendly
text, removes duplicates, drops raw coordinates in favor of a "Get directions" action, collapses the About
text with a "Read more" toggle, consolidates the three personal-action cards into one "Your visit" card, and
reorders the screen to promote personal and live information. All existing data-fetching, mutation, gating,
threshold, and accessibility behaviors are preserved.

### In Scope

- Regrouping the flat info-tag row into labeled sub-groups (Location, Good to know, Accessibility, Good for).
- Relabeling raw slug tag values into human-friendly text.
- De-duplicating repeated tag values.
- Dropping raw coordinates as a displayed tag; using stored latitude/longitude to power a "Get directions" action.
- Collapsing the About description with a "Read more" / "Read less" toggle.
- Reordering the screen sections.
- Consolidating Your Completion, Your Rating, and Your Note into a single "Your visit" card.
- Rendering a static, non-interactive map preview image in the Location area, sourced from a keyless
  static-map image service (the ArcGIS basemap export endpoint), centered on the Experience's stored
  coordinates with a marker overlay, that opens the operating system maps application when tapped and
  degrades gracefully when the image fails to load.

### Out of Scope

- An interactive map requiring a native map library (`react-native-maps` / `expo-maps`); none is installed.
  The Static_Map_Preview is a non-interactive `<Image>` only; a pannable, zoomable, or otherwise interactive
  native map remains out of scope.
- A static-map image service that requires an API key, access token, or other secret.
- Fixing upstream description source-data text issues (e.g., missing spaces like "film.Set Sail").
- Backend or API changes. This is a mobile-client presentation change consuming existing DTO fields.

## Glossary

- **Experience_Detail_Screen**: The React Native screen at
  `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx` that displays a single Experience.
- **Info_Tag**: A compact, labeled indicator surfacing one persisted enrichment value, produced by
  `buildInfoTags()` in `apps/mobile/src/screens/catalog/infoTags.ts`.
- **Tag_Group**: A labeled sub-group of Info_Tags. The four groups are Location, Good to know,
  Accessibility, and Good for.
- **Location_Group**: The Tag_Group containing park, land, resort, and resort-area tags.
- **Good_To_Know_Group**: The Tag_Group containing height requirement, indoor/outdoor, and ride-intensity tags.
- **Accessibility_Group**: The Tag_Group containing service-animal and ambulatory accessibility tags with
  friendly labels.
- **Good_For_Group**: The Tag_Group containing age and interest facet tags.
- **About_Section**: The section rendering the Experience `description` text.
- **Read_More_Toggle**: The control that expands or collapses the About_Section text.
- **Your_Visit_Card**: The single consolidated card combining completion, rating, and note controls.
- **Get_Directions_Action**: A control that opens the operating system maps application at the Experience's
  stored latitude/longitude.
- **Static_Map_Preview**: A static, non-interactive map image rendered in the Location area as an `<Image>`,
  centered on the Experience's stored Latitude and Longitude with a marker overlaid at the image center
  (which coincides with the coordinate), that opens the operating system maps application when activated.
- **Static_Map_Url**: The image URL for the Static_Map_Preview, built from the Experience's Latitude and
  Longitude by a pure, framework-free function using a keyless static-map image service (the ArcGIS basemap
  export endpoint) that requires no API key or secret. The requested map area is a bounding box centered on
  the exact coordinate.
- **Live_Operational_Section**: The at-most-one live section (Wait & Status, showtimes, or dining) selected by
  Experience category via `liveSectionFor()`.
- **Community_Rating_Section**: The section rendering the aggregate community rating subject to the server's
  count threshold.
- **Menu_Summary_Card**: The card rendered only for a Restaurant Experience summarizing available menus.
- **Latitude**: The `latitude` field on the Experience detail DTO.
- **Longitude**: The `longitude` field on the Experience detail DTO.

## Requirements

### Requirement 1: Group Info Tags into labeled sub-groups

**User Story:** As a mobile user viewing an Experience, I want the info tags organized into labeled
sub-groups, so that I can scan related details quickly instead of reading one undifferentiated row.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL render Info_Tags grouped into up to four Tag_Groups — Location_Group,
   Good_To_Know_Group, Accessibility_Group, and Good_For_Group — assigning each rendered Info_Tag to exactly
   one of these Tag_Groups.
2. THE Location_Group SHALL contain the park, land, resort, and resort-area tags for the Experience, rendered
   in that fixed order, omitting any of those tags whose enrichment value is absent or empty while preserving
   the relative order of those present.
3. THE Good_To_Know_Group SHALL contain the height-requirement, indoor/outdoor, and ride-intensity tags for
   the Experience, rendered in that fixed order, omitting any of those tags whose enrichment value is absent
   or empty while preserving the relative order of those present.
4. THE Accessibility_Group SHALL contain the service-animal tag followed by the ambulatory accessibility tag
   for the Experience, omitting either tag whose enrichment value is absent or empty while preserving the
   relative order of those present.
5. THE Good_For_Group SHALL contain the age facet tags followed by the interest facet tags for the
   Experience, omitting any facet whose enrichment value is absent or empty while preserving the relative
   order of those present.
6. IF a Tag_Group has no Info_Tag with a present, non-empty enrichment value, THEN THE Experience_Detail_Screen
   SHALL omit that Tag_Group, including its group label, on the current render.
7. WHERE a Tag_Group is rendered, THE Experience_Detail_Screen SHALL display a group label of "Location" for
   the Location_Group, "Good to know" for the Good_To_Know_Group, "Accessibility" for the Accessibility_Group,
   and "Good for" for the Good_For_Group.
8. THE Experience_Detail_Screen SHALL render each Tag_Group in the fixed order Location_Group,
   Good_To_Know_Group, Accessibility_Group, Good_For_Group, omitting absent groups while preserving the
   relative order of those present.

### Requirement 2: Human-friendly tag labels

**User Story:** As a mobile user, I want tag values shown in readable language, so that I understand what each
tag means without seeing raw slugs.

#### Acceptance Criteria

1. IF an accessibility tag value exactly matches (case-sensitive, whitespace-trimmed) a raw slug defined in
   the human-friendly label mapping, THEN THE Experience_Detail_Screen SHALL display the mapped human-friendly
   label in place of that raw slug value.
2. WHEN the accessibility value is the raw slug `no-service-animals`, THE Experience_Detail_Screen SHALL
   display the label "Service animals not permitted".
3. IF a tag value has no matching human-friendly mapping, THEN THE Experience_Detail_Screen SHALL display the
   tag value with every hyphen (`-`) and underscore (`_`) separator replaced by a single space, consecutive
   separators collapsed to a single space, and no leading or trailing whitespace.
4. WHERE a tag has a non-empty accessibility label, THE Experience_Detail_Screen SHALL expose that
   accessibility label as the tag's accessibility label to assistive technologies.
5. IF a tag has no generated accessibility label, THEN THE Experience_Detail_Screen SHALL render the tag
   using its display label as the tag's accessible text.

### Requirement 3: De-duplicate tag values

**User Story:** As a mobile user, I want each distinct tag value shown only once, so that the screen is not
cluttered with repeated values.

#### Acceptance Criteria

1. WHEN two or more Info_Tags within the same Tag_Group resolve to the same display label — compared as
   case-sensitive string identity after applying the human-friendly relabeling and trimming leading and
   trailing whitespace — THE Experience_Detail_Screen SHALL render that display label at most once in that
   Tag_Group.
2. WHEN de-duplicating Info_Tags within a Tag_Group, THE Experience_Detail_Screen SHALL retain the first
   occurrence in persisted order along with its accessibility label and drop subsequent matching occurrences.
3. THE Experience_Detail_Screen SHALL apply de-duplication independently per Tag_Group, so that a display
   label appearing in more than one Tag_Group is retained once in each Tag_Group in which it occurs.

### Requirement 4: Drop raw coordinates and provide directions

**User Story:** As a mobile user, I want a "Get directions" action instead of raw coordinates, so that I can
navigate to the Experience without reading noisy numbers.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL NOT display raw Latitude and Longitude values as an Info_Tag.
2. WHERE the Experience has a Latitude within the range -90 to 90 inclusive and a Longitude within the range
   -180 to 180 inclusive, THE Experience_Detail_Screen SHALL render the Get_Directions_Action within the
   Location_Group area.
3. IF the Experience is missing a Latitude within -90 to 90 inclusive or a Longitude within -180 to 180
   inclusive, THEN THE Experience_Detail_Screen SHALL omit the Get_Directions_Action.
4. WHEN the user activates the Get_Directions_Action, THE Experience_Detail_Screen SHALL open the operating
   system maps application at the Experience's stored Latitude and Longitude.
5. IF the operating system maps application cannot be opened when the user activates the Get_Directions_Action,
   THEN THE Experience_Detail_Screen SHALL render an error indication and preserve the current screen state.
6. THE Get_Directions_Action SHALL provide a non-empty accessibility label describing the directions action
   for the Experience.

### Requirement 5: Collapse the About description

**User Story:** As a mobile user, I want the About text collapsed by default with a way to expand it, so that
a long description does not push the rest of the screen down.

#### Acceptance Criteria

1. WHILE the About_Section is collapsed, THE Experience_Detail_Screen SHALL display at most 4 lines of the
   description text, where 4 lines is the collapsed line limit.
2. WHERE the description text exceeds the collapsed line limit, THE Experience_Detail_Screen SHALL render the
   Read_More_Toggle.
3. IF the description text does not exceed the collapsed line limit, THEN THE Experience_Detail_Screen SHALL
   omit the Read_More_Toggle.
4. WHILE the About_Section is collapsed, THE Read_More_Toggle SHALL display a "Read more" affordance.
5. WHEN the user activates the Read_More_Toggle while the About_Section is collapsed, THE
   Experience_Detail_Screen SHALL display the full description text.
6. WHILE the About_Section is expanded, THE Read_More_Toggle SHALL display a "Read less" affordance.
7. WHEN the user activates the Read_More_Toggle while the About_Section is expanded, THE
   Experience_Detail_Screen SHALL collapse the description text to at most the collapsed line limit.
8. IF the Experience description text is absent, empty, or contains only whitespace, THEN THE
   Experience_Detail_Screen SHALL display the existing "No description available." empty state and omit the
   Read_More_Toggle.
9. WHEN the About_Section first renders with description text exceeding the collapsed line limit, THE
   Experience_Detail_Screen SHALL render the About_Section in the collapsed state.
10. WHERE the Read_More_Toggle is rendered, THE Experience_Detail_Screen SHALL provide a non-empty
    accessibility label for the Read_More_Toggle reflecting its current expand or collapse action.

### Requirement 6: Consolidate personal actions into a single "Your visit" card

**User Story:** As a mobile user, I want my completion, rating, and note in one place, so that I can manage my
personal visit details without hunting through three separate cards.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL render the completion control, the rating control, and the note control
   within a single Your_Visit_Card in the fixed vertical order completion control, then rating control, then
   note control.
2. THE Your_Visit_Card SHALL preserve the completion mark and unmark behavior and its query invalidations for
   `['experience-completion', experienceId]` and `['me-stats']`.
3. THE Your_Visit_Card SHALL preserve the rating set, replace, and remove behavior and its query
   invalidations for `['experience-rating', experienceId]` and `['experience-aggregate', experienceId]`.
4. THE Your_Visit_Card SHALL preserve the note add, edit, and delete behavior and its query invalidation for
   `['experience-note', experienceId]`.
5. WHILE the completion, rating, or note query is loading and not in an error state, THE Your_Visit_Card SHALL
   render the corresponding loading indicator for that control, independently of the loading, error, and empty
   state of the other two controls.
6. IF the completion, rating, or note query is in an error state, THEN THE Your_Visit_Card SHALL render the
   corresponding error text for that control, taking precedence over the loading indicator for that control.
7. WHEN a completion, rating, or note query has no stored value, THE Your_Visit_Card SHALL render the
   corresponding empty state affordance for that control.
8. WHERE a control within the Your_Visit_Card is rendered, THE Experience_Detail_Screen SHALL preserve the
   existing accessibility labels for that control.
9. WHILE a completion, rating, or note mutation for a control is in progress, THE Your_Visit_Card SHALL
   disable activation of that control, independently of the state of the other two controls.
10. IF a completion, rating, or note mutation fails, THEN THE Your_Visit_Card SHALL render an error indication
    for that control and retain that control's last stored value.

### Requirement 7: Reorder the screen sections

**User Story:** As a mobile user, I want personal and live information promoted toward the top, so that the
most relevant details appear before long descriptive content and detail groups.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL render sections top-to-bottom within a single vertical scroll in the
   order: the header and hero region, Location_Group with the Get_Directions_Action, Your_Visit_Card,
   Live_Operational_Section, About_Section, "Why visit" section, Community_Rating_Section, then the remaining
   Tag_Groups Good_To_Know_Group, Accessibility_Group, and Good_For_Group.
2. THE Experience_Detail_Screen SHALL render the Your_Visit_Card at a vertical position above the About_Section.
3. THE Experience_Detail_Screen SHALL render the Live_Operational_Section at a vertical position above the
   About_Section.
4. WHERE the Experience is a Restaurant, THE Experience_Detail_Screen SHALL render the Menu_Summary_Card
   between the Live_Operational_Section and the About_Section.
5. WHERE a section in the ordered sequence would render no content, THE Experience_Detail_Screen SHALL omit
   that section while preserving the top-to-bottom relative order of the remaining sections.

### Requirement 8: Preserve existing screen behaviors

**User Story:** As a mobile user, I want all existing detail-screen functionality to keep working after the
redesign, so that no capability is lost during the layout change.

#### Acceptance Criteria

1. WHILE the Experience detail, the viewer's rating, or the viewer's note is loading, THE
   Experience_Detail_Screen SHALL render the Share entry point in a disabled state that does not respond to
   activation.
2. WHEN the user activates the enabled Share entry point, THE Experience_Detail_Screen SHALL navigate to the
   Share composer with the loaded detail, rating, and note.
3. THE Experience_Detail_Screen SHALL render at most one Live_Operational_Section, selected solely by the
   Experience category through `liveSectionFor()`.
4. IF the live retrieval fails, THEN THE Experience_Detail_Screen SHALL render the live-unavailable indicator
   while keeping all static detail fields visible.
5. IF the community aggregate value is null, THEN THE Community_Rating_Section SHALL render "Not enough
   ratings yet".
6. IF the community aggregate value is non-null, THEN THE Community_Rating_Section SHALL render the mean
   rounded to one decimal place together with the rating count.
7. WHERE the Experience is a Restaurant, THE Experience_Detail_Screen SHALL render the Menu_Summary_Card.
8. WHILE the Experience detail query is loading and not in an error state, THE Experience_Detail_Screen SHALL
   render the existing loading indicator.
9. IF the Experience detail query fails, THEN THE Experience_Detail_Screen SHALL render the existing error
   empty state together with the live-unavailable indicator.
10. IF the Why_This value is absent, THEN THE Experience_Detail_Screen SHALL omit the "Why visit" section.
11. IF every Why_This bullet duplicates the description text, THEN THE Experience_Detail_Screen SHALL omit the
    "Why visit" section.

### Requirement 9: Preserve the pure Info Tag core contract

**User Story:** As a developer, I want the `infoTags.ts` core to remain framework-free and testable, so that
the grouping, relabeling, and de-duplication logic is unit- and property-testable without rendering.

#### Acceptance Criteria

1. THE infoTags module SHALL contain no import of React and no import of react-navigation.
2. THE infoTags module SHALL assign every emitted Info_Tag to exactly one of the four Tag_Groups
   (Location_Group, Good_To_Know_Group, Accessibility_Group, Good_For_Group), with no emitted tag assigned to
   zero Tag_Groups and no emitted tag assigned to more than one Tag_Group.
3. THE infoTags module SHALL emit a tag only when its underlying enrichment value is present and non-empty,
   where a string value is present and non-empty when it is non-null, non-undefined, and contains at least one
   non-whitespace character, and a coordinate value is present when it is a finite number; emitted string
   labels SHALL be trimmed of leading and trailing whitespace.
4. THE infoTags module SHALL preserve the existing `priceTierListTag` and `resortAreaLabel` exports, producing
   output equal to their pre-redesign output for the same inputs.
5. THE infoTags module SHALL produce grouped output as a total function that returns a defined value and never
   throws for any Experience input, including inputs with null fields, undefined fields, and empty collections.
6. WHEN the infoTags grouped function is invoked twice with equal input, THE infoTags module SHALL produce
   output with the same Tag_Groups, tag order, tag values, and labels on both invocations.

### Requirement 10: Static map preview

**User Story:** As a mobile user viewing an Experience with a known location, I want to see a small map
picture of where it is, so that I can recognize its position at a glance and tap it to get directions.

#### Acceptance Criteria

1. WHERE the Experience has a Latitude within the range -90 to 90 inclusive and a Longitude within the range
   -180 to 180 inclusive, both finite, THE Experience_Detail_Screen SHALL render the Static_Map_Preview within
   the Location_Group area.
2. IF the Experience is missing a finite Latitude within -90 to 90 inclusive or a finite Longitude within -180
   to 180 inclusive, THEN THE Experience_Detail_Screen SHALL omit the Static_Map_Preview.
3. WHERE the Static_Map_Preview is rendered, THE Experience_Detail_Screen SHALL display a static map image
   centered on the Experience's stored Latitude and Longitude with a marker at that Latitude and Longitude.
4. THE Static_Map_Preview SHALL source the static map image from a keyless static-map image service (the
   ArcGIS basemap export endpoint) that requires no API key, access token, or other secret.
5. WHEN the user activates the Static_Map_Preview, THE Experience_Detail_Screen SHALL open the operating system
   maps application at the Experience's stored Latitude and Longitude, matching the behavior of the
   Get_Directions_Action.
6. IF the operating system maps application cannot be opened when the user activates the Static_Map_Preview,
   THEN THE Experience_Detail_Screen SHALL render an error indication and preserve the current screen state.
7. IF the Static_Map_Preview image fails to load, THEN THE Experience_Detail_Screen SHALL omit the
   Static_Map_Preview image while continuing to render the remaining Location_Group content, including the
   Get_Directions_Action.
8. WHERE the Static_Map_Preview is rendered, THE Experience_Detail_Screen SHALL provide a non-empty
   accessibility label describing the map preview for the Experience.
9. THE Static_Map_Url builder SHALL be a pure, framework-free function that imports no React and no
   react-navigation, returns a defined value for any finite Latitude within -90 to 90 inclusive and any finite
   Longitude within -180 to 180 inclusive, and never throws for such inputs.
10. WHEN the Static_Map_Url builder is invoked with a given Latitude and Longitude, THE Static_Map_Url builder
    SHALL encode a bounding box whose center equals those exact Latitude and Longitude values into the returned
    Static_Map_Url, producing an equal Static_Map_Url on repeated invocations with equal inputs.
