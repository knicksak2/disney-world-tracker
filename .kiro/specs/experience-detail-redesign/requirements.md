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
- **Directions_Url_Candidates**: The ordered, duplicate-free list of maps URLs the Get_Directions_Action and
  Static_Map_Preview attempt when activated, built by a pure, framework-free function from the Experience's
  Latitude and Longitude and the running platform. The first entry is the platform-native maps URL; the last
  entry is the universal `https` web maps URL, which any device with a browser can open.
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
7. WHEN the user activates the Get_Directions_Action or the Static_Map_Preview, THE Experience_Detail_Screen
   SHALL attempt the Directions_Url_Candidates in order and stop at the first candidate that opens
   successfully.
8. THE Experience_Detail_Screen SHALL attempt to open each Directions_Url_Candidate unconditionally, and
   SHALL NOT make the attempt conditional on an operating-system reachability probe of the maps URL, because
   on Android 11 and later such a probe reports every non-`http(s)` scheme as unopenable unless the scheme is
   declared in the native manifest — a false negative that suppresses an open that would otherwise succeed.
9. IF every Directions_Url_Candidate fails to open, THEN THE Experience_Detail_Screen SHALL render the error
   indication and preserve the current screen state.

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
   in the Today_In_Park_Lens below the Dining_Reservation_Card and above the Location_Group (preserving Requirement 8.7).
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
## Amendment: Two-Lens Navigation

The single continuous scroll produced by Requirements 1–10 still stacks the live/actionable content
(wait status, forecast, Lightning Lane, dining reservation, showtimes) directly above the
personal/reference content (visit history, ratings, notes, backstory, accessibility) in one column.
User feedback on the shipped result was that the page is "one long scrollable page" that does not
surface the single most time-sensitive fact — the current wait, reservation, or showtime — without
scrolling past several other sections first, and that the personal-visit controls occupy full-height
space on every visit even when the user has nothing new to log.

This amendment splits the Experience_Detail_Screen into two switchable views ("Lenses") reached by a
persistent Lens_Switcher, promotes the most time-sensitive content into a Live_Status_Strip visible
regardless of which Lens is active, and consolidates the personal-visit controls into a single
collapsible Park_Passport_Card. It reuses the existing data-fetching, mutation, and query-invalidation
behavior established by Requirements 6 and 8; it does not change any DTO, endpoint, or persisted
field except where a Requirement below explicitly says so (Requirement 15, which surfaces an existing,
previously unrendered DTO field, and Requirement 16, which fixes a client-side date-selection defect
in already-shipped code).

### Additional Glossary

- **Lens**: One of the two mutually exclusive views the Experience_Detail_Screen renders below the
  Live_Status_Strip: the Today_In_Park_Lens or the My_Passport_And_Lore_Lens. Exactly one Lens is
  active at a time.
- **Lens_Switcher**: The two-segment control, rendered directly beneath the Quick_Specs_Row, that
  switches the active Lens.
- **Today_In_Park_Lens**: The Lens containing the Live_Wait_Cockpit (or the category's equivalent
  live section — Dining_Reservation_Card or Showtimes_Card), the Virtual_Queue_Banner and
  Single_Rider_Strip when applicable, and the Location_Group with the Static_Map_Preview and
  Get_Directions_Action.
- **My_Passport_And_Lore_Lens**: The Lens containing the Park_Passport_Card, the
  Restaurant_Dish_Log_Card (Restaurant only), the About_Section, the "Imagineer's Insider Notes"
  section (the renamed Why_This_Section), the Community_Rating_Section, and the remaining Tag_Groups
  (Good to know / Accessibility / Good for).
- **Live_Status_Strip**: The compact status region rendered immediately below the header/hero region,
  visible on both Lenses without scrolling, showing the category-appropriate live headline value (wait
  minutes, reservation availability, or next showtime countdown) and its status.
- **Quick_Specs_Row**: The row of at-a-glance stat chips (duration, height requirement, climate,
  category-specific feature) rendered above the Lens_Switcher.
- **Live_Wait_Cockpit**: The rendered-only-for-Ride/Character_Meet live section combining the
  standby-wait instrument, the Lightning_Lane_Ticket, the Wait_Context_Selector, the forecast chart,
  and the Best_Time_Verdict. Supersedes the plain Live_Operational_Section layout for these categories;
  the underlying live data source and gating (`liveSectionFor()`) are unchanged.
- **Wait_Context_Selector**: The three-way control ("Now" / "Trip" / "Typical") that selects which
  date the Live_Wait_Cockpit's forecast, Typical/Worst stats, and Reliability figure describe.
- **Trip_Context_Date**: The specific calendar date the Wait_Context_Selector's "Trip" option requests
  when the viewer has a relevant trip, resolved per Requirement 16.
- **Virtual_Queue_Banner**: The banner shown in the Today_In_Park_Lens when the Experience's live
  detail carries boarding-group data, surfacing the current boarding-group state.
- **Single_Rider_Strip**: The existing single-rider surfacing (Requirement pre-dating this amendment;
  see `RideLiveSection.tsx` / `WaitInsightsSection.tsx`), repositioned within the Live_Wait_Cockpit but
  not otherwise changed by this amendment.
- **Park_Passport_Card**: The collapsible card in the My_Passport_And_Lore_Lens presenting the
  viewer's visit count, computed average rating, most recent shared note, and expandable visit
  history, superseding the plain Your_Visit_Card layout (Requirement 6) with a richer presentation
  over the same underlying data and mutations.
- **Passport_Average_Rating**: The arithmetic mean of the numeric rating on every visit log that
  carries one, rounded to one decimal place for display, recomputed whenever a visit log's rating is
  added, edited, or removed.
- **Restaurant_Dish_Log_Card**: The Restaurant-only card in the My_Passport_And_Lore_Lens listing the
  viewer's logged food items for that Experience, superseding the plain food-item-logging button row
  (Task 7.3 of this spec) with a list-plus-summary presentation over the same underlying data.
- **Floating_Action_Dock**: The persistent, category- and Lens-aware two-button control fixed to the
  bottom of the Experience_Detail_Screen across both Lenses.
- **Dining_Reservation_Card**: The Restaurant-category equivalent of the Live_Wait_Cockpit in the
  Today_In_Park_Lens, showing reservation availability and the existing Reservation_Action.
- **Showtimes_Card**: The Show/Character_Meet-category equivalent of the Live_Wait_Cockpit in the
  Today_In_Park_Lens, showing today's showtimes and a countdown to the next one.

### Requirement 11: Two-Lens navigation shell

**User Story:** As a mobile user viewing an Experience, I want the live/actionable content and the
personal/reference content separated into two switchable views, so that I am not forced to scroll
past one to reach the other.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL render exactly one Lens at a time: the Today_In_Park_Lens or the
   My_Passport_And_Lore_Lens.
2. THE Experience_Detail_Screen SHALL default to the Today_In_Park_Lens on first render for every
   Experience category.
3. THE Experience_Detail_Screen SHALL render the Lens_Switcher directly beneath the Quick_Specs_Row,
   above both Lenses' content, on every render regardless of which Lens is active.
4. WHEN the user activates the inactive segment of the Lens_Switcher, THE Experience_Detail_Screen
   SHALL switch the active Lens and scroll the newly active Lens's content into view from its top.
5. THE Experience_Detail_Screen SHALL preserve the header/hero region, the Quick_Specs_Row, the
   Lens_Switcher, the Live_Status_Strip, and the Floating_Action_Dock unchanged in position and content
   across a Lens switch; only the content below the Lens_Switcher and above the Floating_Action_Dock
   SHALL change.
6. THE Lens_Switcher SHALL provide a non-empty accessibility label for each segment identifying it as a
   tab and indicating its selected state to assistive technology.
7. WHILE a Lens's data-fetching queries are loading, THE Experience_Detail_Screen SHALL render that
   Lens's existing per-section loading indicators without blocking the other Lens's ability to become
   active.

### Requirement 12: Live_Status_Strip promoted above the Lens content

**User Story:** As a mobile user, I want the single most time-sensitive fact about an Experience
visible the instant the screen opens, so that I do not have to switch Lenses or scroll to find it.

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL omit the redundant Live_Status_Strip from between the header/hero
   region and the Quick_Specs_Row, matching `mockup.html` where live standby wait and Lightning Lane
   availability are surfaced directly inside the Live_Wait_Cockpit below the Lens_Switcher.
2. WHERE standalone or external surfaces consume `LiveStatusStrip`, THE component SHALL display the
   current standby wait in minutes (or the existing closed/down indication when not Operating) and the
   Lightning Lane availability state for Ride and Character_Meet.
3. WHERE standalone or external surfaces consume `LiveStatusStrip` for Restaurant, IT SHALL display the
   current reservation availability state and, where available, the next available reservation time.
4. WHERE standalone or external surfaces consume `LiveStatusStrip` for Show or where `liveSectionFor()`
   resolves to showtimes, IT SHALL display a countdown in minutes to the next showtime together with that
   showtime's clock time.
5. WHERE the Experience category has no Live_Operational_Section per `liveSectionFor()`, THE component
   SHALL omit its output.
6. IF the live retrieval fails, THEN THE Live_Status_Strip SHALL render the existing live-unavailable
   indication in place of the headline value, preserving Requirement 8.4's behavior.
7. THE Live_Status_Strip SHALL derive its displayed values from the same live data source and
   `liveSectionFor()` gating already used by the Live_Operational_Section (Requirement 8.3).

### Requirement 13: Live_Wait_Cockpit with Now / Trip / Typical context

**User Story:** As a mobile user planning when to ride, I want to see the forecast for right now, for
my upcoming trip day, or for the typical pattern, so that I can decide when to go without leaving the
screen.

#### Acceptance Criteria

1. WHERE the Experience category is Ride or Character_Meet, THE Today_In_Park_Lens SHALL render the
   Live_Wait_Cockpit in place of the plain Live_Operational_Section layout.
2. THE Live_Wait_Cockpit SHALL render the Wait_Context_Selector with a "Now" segment and a "Typical"
   segment always present, and a "Trip" segment present only when a Trip_Context_Date is resolvable per
   Requirement 16.
3. THE Live_Wait_Cockpit SHALL default the Wait_Context_Selector to "Now".
4. WHEN the user activates the "Now" segment, THE Live_Wait_Cockpit SHALL display the current live
   standby wait and the current-hour forecast chart.
5. WHEN the user activates the "Typical" segment, THE Live_Wait_Cockpit SHALL display the
   `WaitInsightsDTO` historical-pattern forecast obtained without a `date` query parameter.
6. WHEN the user activates the "Trip" segment, THE Live_Wait_Cockpit SHALL display the
   `WaitInsightsDTO` forecast obtained using the Trip_Context_Date as the `date` query parameter.
7. THE Live_Wait_Cockpit SHALL render the Typical/Worst stat pair and the Reliability percentage
   sourced from the currently selected Wait_Context_Selector segment's `WaitInsightsDTO` response.
8. THE Live_Wait_Cockpit SHALL preserve the existing Lightning_Lane availability/return-window display
   and the existing Best_Time_Verdict text, sourced unchanged from their existing DTOs.
9. WHERE the Experience's live detail carries boarding-group data, THE Live_Wait_Cockpit SHALL render
   the Virtual_Queue_Banner per Requirement 15; where it does not, THE Live_Wait_Cockpit SHALL omit the
   Virtual_Queue_Banner.
10. THE Live_Wait_Cockpit SHALL preserve the existing Single_Rider_Strip content and gating unchanged,
    repositioning it within the Cockpit's layout only.

### Requirement 14: Category-specific Today_In_Park_Lens content

**User Story:** As a mobile user viewing a Restaurant or a Show, I want the live section to show
reservation or showtime information relevant to that category, so that I am not shown a standby-wait
instrument that does not apply.

#### Acceptance Criteria

1. WHERE the Experience category is Restaurant, THE Today_In_Park_Lens SHALL render the
   Dining_Reservation_Card in place of the Live_Wait_Cockpit, preserving the existing
   Reservation_Action (diningUrl gating and open/error behavior) unchanged.
2. WHERE the Experience category is Show or Character_Meet and `liveSectionFor()` resolves to
   showtimes, THE Today_In_Park_Lens SHALL render the Showtimes_Card in place of the Live_Wait_Cockpit,
   listing today's showtimes and indicating the next upcoming one.
3. WHERE the Experience category has no Live_Operational_Section per `liveSectionFor()`, THE
   Today_In_Park_Lens SHALL omit both the Live_Wait_Cockpit and the category-specific cards for that
   Experience.
4. THE Today_In_Park_Lens SHALL render the Location_Group with the Static_Map_Preview and
   Get_Directions_Action (Requirements 4 and 10) below the live/category-specific card, for every
   category, regardless of which live section (if any) is rendered above it.
5. WHERE the Experience category is Restaurant and menus are present, THE Today_In_Park_Lens SHALL
   render the Menu_Summary_Card below the Dining_Reservation_Card and above the Location_Group.

### Requirement 15: Virtual Queue / boarding-group display

**User Story:** As a mobile user riding an Experience that uses a virtual queue, I want to see the
current boarding-group state, so that I know whether and when I can board without checking a separate
app.

#### Acceptance Criteria

1. WHERE the Experience's live detail response includes a `boardingGroup` value with `state` present,
   THE Today_In_Park_Lens SHALL render the Virtual_Queue_Banner displaying that `state`.
2. WHERE the `boardingGroup` value includes both `currentGroupStart` and `currentGroupEnd`, THE
   Virtual_Queue_Banner SHALL display the current boarding-group range using those two values.
3. IF the Experience's live detail response omits `boardingGroup` or omits `state` within it, THEN THE
   Experience_Detail_Screen SHALL omit the Virtual_Queue_Banner.
4. THE Virtual_Queue_Banner SHALL provide a non-empty accessibility label describing the boarding-group
   state for the Experience.
5. THE Virtual_Queue_Banner SHALL consume the existing `liveDetail.boardingGroup` field without
   requiring any new DTO field, migration, or endpoint.

### Requirement 16: Correct Trip_Context_Date resolution

**User Story:** As a mobile user with a multi-day trip planned, I want the "Trip" wait forecast to
reflect the day I am actually asking about, so that the forecast is not silently wrong for every day of
my trip except the first.

#### Acceptance Criteria

1. IF the Experience has a planned item already scheduled for the viewer on an active or upcoming
   trip, THEN THE Trip_Context_Date SHALL equal that planned item's `planned_date`.
2. IF the Experience has no planned item scheduled for the viewer but the viewer has an active trip
   whose date range includes today's date (per `wdwClock`), THEN THE Trip_Context_Date SHALL equal
   today's date.
3. IF the Experience has no planned item scheduled for the viewer and the viewer's active or nearest
   upcoming trip's date range does not include today's date, THEN THE Trip_Context_Date SHALL equal
   that trip's start date.
4. IF the viewer has no active or upcoming trip, THEN THE Trip_Context_Date SHALL be unresolvable and
   THE Live_Wait_Cockpit SHALL omit the "Trip" segment of the Wait_Context_Selector per Requirement
   13.2.
5. THE Trip_Context_Date resolution in Acceptance Criteria 1–4 SHALL take precedence in that order,
   evaluating Acceptance Criterion 1 before falling back to Acceptance Criterion 2, and Acceptance
   Criterion 2 before falling back to Acceptance Criterion 3.
6. THIS Requirement corrects the pre-existing client behavior in `WaitInsightsSection.tsx`, which
   resolves the "Trip" context to the active trip's `startDate` unconditionally; that behavior SHALL
   be replaced by Acceptance Criteria 1–4, not preserved as an additional fallback.

### Requirement 17: Park_Passport_Card

**User Story:** As a mobile user reviewing my own visit history, I want a single richer card showing my
visit count, average rating, and history, so that I get more context than a plain completion checkbox
without hunting through separate controls.

#### Acceptance Criteria

1. THE My_Passport_And_Lore_Lens SHALL render the Park_Passport_Card in place of the plain
   Your_Visit_Card layout (Requirement 6), reusing the same completion, rating, and note data and
   mutations.
2. THE Park_Passport_Card SHALL display the total number of visit logs for the Experience and the
   Passport_Average_Rating, when at least one visit log carries a rating.
3. IF no visit log for the Experience carries a rating, THEN THE Park_Passport_Card SHALL omit the
   Passport_Average_Rating and render the existing empty-rating state.
4. THE Park_Passport_Card SHALL render the visit history as an expandable list where each entry shows
   that visit's date, that visit's individual rating (when present), and that visit's individual note
   (when present).
5. WHEN the user edits or removes the rating on an individual visit history entry, THE
   Park_Passport_Card SHALL recompute and re-render the Passport_Average_Rating to reflect the change,
   and SHALL trigger the existing `['experience-rating', experienceId]` and
   `['experience-aggregate', experienceId]` invalidations (Requirement 6.3) for the entry that changed.
6. WHEN the user deletes an individual visit history entry, THE Park_Passport_Card SHALL remove that
   entry from the displayed history, recompute the Passport_Average_Rating and the displayed visit
   count, and preserve the remaining entries' relative order.
7. IF the Experience has zero visit logs, THEN THE Park_Passport_Card SHALL render an empty state
   inviting the user to log a visit, matching Requirement 6.7's empty-state behavior.
8. THE Park_Passport_Card SHALL preserve every accessibility label, loading/error/empty independence,
   and mutation-invalidation behavior specified in Requirement 6 for the underlying completion, rating,
   and note controls; this amendment changes only their visual presentation and grouping.
9. THE Park_Passport_Card SHALL present the title 'Park Passport & Journal', the Embossed Golden Seal
   Medallion with visit count and average score, the personal tip quote bubble with 'Edit Tip' affordance,
   and the 'Log another visit' button at the bottom of the card, matching `mockup.html` (lines 1466-1547).
10. THE Park_Passport_Card SHALL omit the redundant legacy `CompletionControls`, `RatingControl`, and
    `NoteControl` form controls from the normal success state, while preserving query error messages when
    any of the queries are in an error state per Acceptance Criterion 8.
11. WHEN the user has not recorded a personal tip or visit note for the Experience, THE Park_Passport_Card
    SHALL render a clean empty tip state with an 'Add Tip' affordance, and SHALL NOT display placeholder tip
    text. WHEN a personal tip or visit note exists, THE Park_Passport_Card SHALL render the user's tip text
    with an 'Edit Tip' affordance.

### Requirement 18: Restaurant_Dish_Log_Card

**User Story:** As a mobile user who has logged dishes at a Restaurant, I want to see my logged dishes
in the Passport Lens, so that my food history for this restaurant is visible alongside my visit
history.

#### Acceptance Criteria

1. WHERE the Experience category is Restaurant, THE My_Passport_And_Lore_Lens SHALL render the
   Restaurant_Dish_Log_Card, reusing the existing food-item-logging data and the "Log a food item" /
   "My logged items" / "Add to a list" affordances (this spec's Task 7.3) without introducing a new DTO
   or endpoint.
2. THE Restaurant_Dish_Log_Card SHALL display the count of the viewer's logged food items for the
   Restaurant and, for each logged item, its name, its individual rating (when present), and its
   individual note (when present).
3. IF the viewer has zero logged food items for the Restaurant, THEN THE Restaurant_Dish_Log_Card SHALL
   render an empty state inviting the user to log a dish.
4. WHERE the Experience category is not Restaurant, THE My_Passport_And_Lore_Lens SHALL omit the
   Restaurant_Dish_Log_Card.

### Requirement 19: Floating_Action_Dock

**User Story:** As a mobile user, I want the primary actions for an Experience available without
scrolling, so that logging a visit, adding to my plan, or reserving a table does not require finding
the right section first.

**Amendment (superseded in part by `experience-lists` Requirement 17):** for every category where
this requirement's secondary action is "Add to Trip" (19.2, 19.3, and 20.5's Resort case), that
action is relabeled "Add to Trip or List" and now presents a two-option choice (Add to Trip / Add
to a List) instead of invoking the trip-add handler directly. The acceptance criteria below are
left unchanged as the historical record of this spec's own scope; `experience-lists` Requirement
17 is the authoritative source for the current merged behavior. The Restaurant case (19.4) is
unaffected.

**Second amendment (superseded further by `experience-lists` Requirement 18):** wherever this
requirement's "Add to Trip" action (19.2, 19.3, 19.4's Quick Service branch, 20.5) resolves "the
viewer's active or upcoming trip" as a single, silently-chosen trip, it instead always presents a
trip picker first (even when the viewer has exactly one eligible trip) and adds to whichever trip
the viewer selects there. `experience-lists` Requirement 18 is the authoritative source for the
current trip-selection behavior; this requirement's phrase "the viewer's active or upcoming
trip's planned items" should be read as "the viewer-selected trip's planned items."

#### Acceptance Criteria

1. THE Experience_Detail_Screen SHALL render the Floating_Action_Dock fixed to the bottom of the
   screen, visible on both Lenses, for every Experience category.
2. WHERE the Experience category is Ride, Character_Meet, or Show and the active Lens is the
   Today_In_Park_Lens, THE Floating_Action_Dock SHALL present a primary action that logs a visit and a
   secondary action labeled "Add to Trip" that adds the Experience to the viewer's active or upcoming trip's planned items.
3. WHERE the Experience category is Ride, Character_Meet, or Show and the active Lens is the
   My_Passport_And_Lore_Lens, THE Floating_Action_Dock SHALL present a primary action that logs a visit
   and a secondary action labeled "Add to Trip" that adds the Experience to the viewer's active or upcoming trip's planned items (matching the Today_In_Park_Lens,
   superseding the lens-specific rating secondary action).
4. WHERE the Experience category is Restaurant, THE Floating_Action_Dock SHALL present a primary
   action that opens the Restaurant_Dish_Log_Card's "Log a food item" flow and a secondary action that
   invokes the existing Reservation_Action, on both Lenses.
5. WHEN the user activates a Floating_Action_Dock action, THE Experience_Detail_Screen SHALL invoke the
   same existing handler and query-invalidation behavior already specified for that action by
   Requirements 6, 8, or this spec's Task 7.3, whichever governs that action; the Floating_Action_Dock
   introduces no new mutation behavior of its own.
6. THE Floating_Action_Dock SHALL provide a non-empty accessibility label for each of its two actions
   reflecting their current category- and Lens-dependent label.
7. THE Floating_Action_Dock SHALL remain visible while its underlying screen content scrolls, and SHALL
   not obscure the final rendered section of either Lens (the content area SHALL reserve bottom padding
   at least equal to the Floating_Action_Dock's rendered height).

### Requirement 20: Resort_Experience_Detail_And_Guide

**User Story:** As a mobile user viewing a Disney Resort hotel, I want to see a dedicated Resort Guide with hotel specs, highlights, dining directory, recreation, property map, and transportation rather than ride wait times and park specs, so that the screen functions as a comprehensive resort concierge.

#### Acceptance Criteria

1. WHERE the Experience category is Resort, THE Quick_Specs_Row SHALL render the Resort Tier, Primary Transportation Mode, and Signature Feature Pool sourced from the matched Resort metadata, and SHALL NOT fall back to Moderate Resort, Bus Transit, or a generic Feature Pool when the resort is Deluxe, Value, or Deluxe Villa with specific transit modes and named pools. The Quick_Specs_Row SHALL NOT render a separate Geographic Area chip, since the Geographic Area is already conveyed by the Experience_Detail_Screen header subtitle (Requirement 20.7) and the hero photo's location pill badge; repeating it a third time in the Quick_Specs_Row crowded the row and starved the remaining three chips of space.
2. WHERE the Experience category is Resort, THE Lens_Switcher SHALL display 'Resort Guide' for the primary lens and 'Stay Passport & Lore' for the secondary lens.
3. WHERE the Experience category is Resort, THE Experience_Detail_Screen SHALL suppress the live queue query and the Live_Unavailable_Indicator.
4. WHERE the Experience category is Resort and the active lens is Resort Guide, THE screen SHALL render:
   - A Resort_Highlights_Card detailing property features and tier, dynamically reflecting the authentic theme, landmarks, and feature pool description of the specific resort being viewed, and SHALL NOT default to Coronado Springs highlights or Mayan pyramid descriptions.
   - An On_Property_Dining_Directory with header '🍽️ Dining & Lounges at the Resort (<count>)' and a 'Tap to inspect' prompt, listing dining experiences belonging to this specific resort with venue subtitles, served meal periods (e.g. Breakfast, Lunch, Dinner, Late Night) formatted on their own dedicated line between the subtitle and tag row in canonical chronological order, service-style tags and green price tiers in the tag row (e.g. `[Quick Service] $`), and an action pill button ('Reserve' for table service, 'Menu ›' for quick service and lounges) where each card and action navigates directly to the restaurant's ExperienceDetail or opens reservations, and SHALL NOT display Coronado Springs restaurants on other resorts.
   - A Recreation_And_Amenities_Card detailing feature pools, wellness/fitness facilities, trails, and campfire/movie activities.
   - A Property_Map_And_Transit_Card displaying the resort map preview, verified street address of the specific resort, direct travel times to all four theme parks and Disney Springs, destination-specific transit mode indicators (Boat ⛴️, Monorail 🚝, Skyliner 🚡, Bus 🚌) for each individual destination rather than applying a single blanket mode badge across all destinations, and card subtitle and header badges that accurately convey all available complimentary transit modes at that resort (e.g., 'Boat & Bus').
5. WHERE the Experience category is Resort, THE Floating_Action_Dock SHALL present a primary action labeled 'Log Stay' and a secondary action labeled 'Add to Trip'.
6. WHERE the Experience category is Resort and the active lens is Stay Passport & Lore, THE Field Guide section SHALL display the title 'The Resort History & Architecture' and render architectural and Imagineering backstory notes from `whyThis`.
7. THE Experience_Detail_Screen header SHALL display a subtitle beneath the Experience name: for a non-Resort Experience, the owning Park; for a Resort Experience, the Resort's Geographic Area (`resortArea`) when present, falling back to the Park when `resortArea` is absent, and omitting the subtitle entirely only when neither value is present (never rendering a blank subtitle line).
8. THE hero photo's location pin badge SHALL display the same Geographic Area precedence as the header subtitle (Requirement 20.7): for a non-Resort Experience, the Land when present else the Park; for a Resort Experience, the Resort's Geographic Area (`resortArea`) when present else the Park, and SHALL render only the pin glyph with no dangling location text when neither value is present.

### Requirement 21: Resort_Area_And_Quick_Service_Experience_Refinements

**User Story:** As a mobile user viewing activities, tours, or dining venues at a resort or in the parks, I want the screen to accurately reflect resort geography and dining service models, so that locations outside the parks do not default to Magic Kingdom and counter-service venues do not show broken wait time errors or reservation buttons.

#### Acceptance Criteria

1. WHERE an Experience has `areaType === 'Resort'` (or has a non-null `resortId` or `resortArea`), THE Location_Group_Section SHALL resolve its landmark navigation using the resort name, resort area, and verified street address, and SHALL NOT fall back to Magic Kingdom's Central Plaza.
2. WHERE an Experience category is Restaurant, Tour, Recreation, Spa, or Event, THE Experience_Detail_Screen SHALL suppress the live queue query and the Live_Unavailable_Indicator error card.
3. WHERE an Experience category is Restaurant and its service style is Quick Service (resolved via `subType` or `groupedFacets`), THE Floating_Action_Dock SHALL present a primary action labeled 'Log a Dish' and a secondary action labeled 'Add to Trip', rather than 'Reserve Table'.
4. WHERE an Experience category is Restaurant and its service style is Quick Service, THE Dining_Reservation_Card SHALL present the title 'Quick Service & Dishes' rather than 'Reservations & Dishes'.
5. WHERE an Experience has `areaType === 'Resort'`, THE Lens_Switcher SHALL label the operational lens 'Today at Resort' (or 'Today') rather than 'Today in Park'.

### Requirement 22: Resorts_Destination_Screen_Sub_Grouping

**User Story:** As a mobile user browsing the Resorts destination screen, I want experiences that belong to broader resort areas to be grouped under clear sub-destinations rather than an 'Other' catch-all, so that premier entertainment, sports, and recreation areas are easily discoverable.

#### Acceptance Criteria

1. THE Resorts Destination grouping logic (`groupByResort` / `buildResortRows`) SHALL NOT label any rendered section or anchor 'Other'.
2. WHERE active Experiences belong to `resortArea === 'EPCOT Resort Area'` with no specific resort id (such as Disney's BoardWalk entertainment venues), THE Resorts Destination screen SHALL group them under a dedicated section titled "Disney's BoardWalk & Promenade".
3. WHERE active Experiences belong to `resortArea === 'Wide World of Sports Resort Area'`, THE Resorts Destination screen SHALL group them under a dedicated section titled "ESPN Wide World of Sports Complex".
4. WHERE remaining active Experiences have no specific resort match, THE Resorts Destination screen SHALL group them under a dedicated section titled "Property-Wide Recreation & Sports".
