# Requirements Document

## Introduction

The catalog is sourced from Disney's facilities channel by `disney-facilities-catalog-source`, which admits every `Experience_Eligible_Type` as a browsable Experience (R4.1 of that spec). A live audit of the production catalog on 2026-08-24 (1,504 rows, 1,172 active) showed that rule admits a large volume of material that is not an *experience a guest does and logs*: 136 resort pool/hot-tub/water-play rows ("Alligator Bayou Pool 2", "Admiral Pool Spa"), 47 in-park audio-description clips typed `audio-tour` ("240 Shoe Size", "Windows"), 40 individual animal placards typed `Attraction` ("African Hogs - Disney Animals"), 39 resort playgrounds and arcades, 21 purely informational pages ("Guide for Families - EPCOT", "Weather Updates and Policies for Mickey's Not So Scary Halloween Party", "Park Hopper Hours"), 12 paid cabana/umbrella rental SKUs, 11 resort fitness centers, and assorted singletons (pet boarding, golf-cart rental, cake ordering).

The same audit showed a second, independent problem: Disney types an entire pavilion as `attraction`, so the classifier's `attraction → Ride` rule mislabels ~52 rows that are not rides. Disney's own facet data separates them cleanly — of 180 active `Ride` rows only 84 carry a `thrillFactor` facet or a ride-flavored `parkInterests` tag, and the remainder are theater shows (The Hall of Presidents, Mickey's PhilharMagic), self-paced walkthroughs (Maharajah Jungle Trek, SeaBase Aquarium), museum galleries (Stave Church Gallery), post-ride play labs (ImageWorks, Project Tomorrow), and app-based scavenger hunts (A Pirate's Adventure, Wilderness Explorers).

Fixing the second problem naively would break the day planner. `optimizer.ts` decides whether an item has a queue purely from its category (`Ride`/`Character_Meet` only); everything else is modeled at zero wait. But 114 distinct `Ride` rows have accumulated `wait_samples` (102,397 samples) against only 84 rows carrying a ride facet — so at least 30 of the mislabeled rows post real standby waits today. Re-labeling them without changing the gate would silently budget a 30-minute line at zero and produce optimistic plans. This feature therefore also moves the queue-wait decision from *what category is this* to *does the live snapshot carry a posted standby wait*, which is the question the sampler already asks via `isStandbyBasketEntry`.

Scope is the catalog taxonomy and the consumers that read `Experience_Category`. This feature does not change any Disney source, endpoint, credential, id derivation, or area-resolution rule.

## Glossary

- **Exclusion_Rule**: One of the machine-checkable predicates in Requirement 1 that identifies a Facility_Document as structurally not a guest-loggable experience.
- **Excluded_Facility**: A Facility_Document matched by any Exclusion_Rule. It is withheld from the upstream Experience set, which causes existing rows to be soft-deleted by the reconciliation already specified in `disney-facilities-catalog-source` R11.
- **Category_Override**: A curated `Enterprise_Id → Experience_Category` entry that overrides the Facility_Type-derived classification for one specific facility. The override list is hand-maintained and never inferred at runtime.
- **Walkthrough**: A new Experience_Category for a self-paced walk-through attraction with no ride vehicle and no performance schedule — animal trails, aquariums, exhibit halls, museum galleries, and walkable landmarks.
- **PlayArea**: A new Experience_Category for an unstructured interactive play space — post-ride labs, splash zones, and in-park kids' play zones.
- **Game**: A new Experience_Category for a park-wide, untimed interactive game or scavenger hunt, including the ones played through the Play Disney Parks app.
- **Standby_Bearing**: A property of a `WaitSnapshot` for an item: TRUE when the snapshot carries a usable predicted standby (or single-rider, where requested) wait value; FALSE when it does not.
- **Queue_Modeled_Item**: A planned item the optimizer charges a queue wait for. Determined by Standby_Bearing rather than by Experience_Category.
- **Structural_Category**: An Experience_Category that never carries live operational data by construction: `Tour`, `Recreation`, `Spa`, `Event`, `Other`, `Resort`.

## Requirements

### Requirement 1: Exclusion of Non-Experience Facilities

**User Story:** As a user, I want the catalog to contain things I actually do and log, so that browsing, searching, and my completion stats are not diluted by resort plumbing, audio-clip snippets, and informational pages.

#### Acceptance Criteria

1. THE Catalog_Sync SHALL withhold from the upstream Experience set every Facility_Document matched by any Exclusion_Rule in criteria 2–9, notwithstanding that Facility_Document's membership in `Experience_Eligible_Type` (`disney-facilities-catalog-source` R4.1).
2. WHEN a Facility_Document has Facility_Type `audio-tour`, THE Catalog_Sync SHALL treat it as an Excluded_Facility.
3. WHEN a Facility_Document has a Facility_SubType in the closed set {`Quiet Pool`, `Pool`, `Feature Pool`, `Kiddie Pool`, `Spa / Hot Tub`, `Water Play Area`, `Playground`, `Playgrounds`, `Arcade`, `Arcades`, `Fitness Center`, `Health Club & Spa`}, THE Catalog_Sync SHALL treat it as an Excluded_Facility.
4. WHEN a Facility_Document `name` ends with the literal suffix ` - Disney Animals`, THE Catalog_Sync SHALL treat it as an Excluded_Facility.
5. WHEN a Facility_Document `name` matches a rental-inventory pattern (a name ending in `Umbrellas`, or containing `Beachcomber Shacks`, `Polar Patios`, or `Poolside Patios`), THE Catalog_Sync SHALL treat it as an Excluded_Facility.
6. WHEN a Facility_Document `name` contains `Community Hall`, THE Catalog_Sync SHALL treat it as an Excluded_Facility.
7. WHEN a Facility_Document `name` matches an informational-page pattern (defined concretely in the design's Configuration & Constants), THE Catalog_Sync SHALL treat it as an Excluded_Facility.
8. WHEN a Facility_Document `name` exactly equals a member of the curated Excluded_Name_List (defined in the design's Configuration & Constants), THE Catalog_Sync SHALL treat it as an Excluded_Facility.
9. WHEN a Facility_Document `name` contains `Best Friends Pet Hotel` or `Signature Portrait Session`, THE Catalog_Sync SHALL treat it as an Excluded_Facility.
10. WHERE a Facility_Document has a Category_Override (Requirement 2), THE Catalog_Sync SHALL admit it as an Experience even when an Exclusion_Rule would otherwise match it, so that a curated keep always outranks a rule-based drop.
11. THE Catalog_Sync SHALL NOT delete any `experiences` row as a consequence of exclusion; an Excluded_Facility that has a persisted row SHALL be soft-deleted (`active = false`) by the existing reconciliation, preserving the row, its Internal_Id, and every Completion, Rating, Note, and planned item that references it.
12. WHEN a previously Excluded_Facility ceases to match every Exclusion_Rule, THE Catalog_Sync SHALL reactivate the existing row under the same Internal_Id rather than create a new one.
13. THE Exclusion_Rules SHALL be evaluated against the upstream Facility_Document fields only, and SHALL NOT depend on any user-generated data, so that the excluded set is a pure function of the upstream snapshot.

### Requirement 2: Curated Re-Categorization and Three New Categories

**User Story:** As a user, I want a walkthrough, a play area, and an app game to be labeled as what they are instead of all appearing as rides, so that browsing and filtering tell me the truth about how I'd spend the time.

#### Acceptance Criteria

1. THE Experience_Category set SHALL be extended with the members `Walkthrough`, `PlayArea`, and `Game`, and the existing members SHALL be retained unchanged.
2. THE Catalog_Cache SHALL accept `Walkthrough`, `PlayArea`, and `Game` as valid `experiences.category` values.
3. WHEN the Catalog_Sync classifies a Facility_Document whose Enterprise_Id appears in the Category_Override list, THE Catalog_Sync SHALL assign the overridden Experience_Category instead of the Facility_Type-derived category.
4. WHERE a Facility_Document's Enterprise_Id does not appear in the Category_Override list, THE Catalog_Sync SHALL classify it exactly as `disney-facilities-catalog-source` R4.2–R4.10 already specify.
5. THE Category_Override list SHALL be keyed on the numeric portion of the Enterprise_Id together with its `entityType`, so that an override survives a facility rename.
6. THE Category_Override list SHALL be a curated, hand-maintained constant, and THE Catalog_Sync SHALL NOT infer a re-categorization from facets, names, or any other heuristic at runtime.
7. WHEN an Enterprise_Id in the Category_Override list matches no Facility_Document in an otherwise successful sync, THE Catalog_Sync SHALL record a warning identifying the unmatched Enterprise_Id and SHALL complete the run successfully.
8. THE Category_Override list SHALL map the theater and cinema attractions enumerated in the design to `Show`, the self-paced walk-through attractions and museum galleries to `Walkthrough`, the play labs and splash zones to `PlayArea`, and the park-wide interactive games to `Game`.
9. WHERE an Experience is classified `Walkthrough`, `PlayArea`, or `Game`, THE App SHALL present it with a distinct category label and a distinct category visual, and SHALL NOT rely on colour alone to distinguish it.

### Requirement 3: Queue Wait Determined by Posted Standby, Not by Category

**User Story:** As a trip planner, I want the optimizer to budget a queue only where a queue actually exists, so that re-labeling a wait-posting attraction does not silently turn a 30-minute line into zero.

#### Acceptance Criteria

1. THE optimizer SHALL determine whether to charge a queue wait for an item from that item's Standby_Bearing, and SHALL NOT determine it from the item's Experience_Category. This supersedes the category-based gate in `day-planning-optimization` R3.14 while leaving that criterion's duration-precedence rules in force.
2. WHERE an item's `WaitSnapshot` is Standby_Bearing, THE optimizer SHALL model that item's queue wait from the snapshot exactly as it models a ride today, including the rope-drop ramp, single-rider substitution, virtual-queue handling, and Lightning Lane substitution.
3. WHERE an item's `WaitSnapshot` is not Standby_Bearing, THE optimizer SHALL model that item's queue wait as `0` and SHALL incur cost solely from duration and travel.
4. THE optimizer SHALL continue to model queue wait as `0` for every break item (`item_type = 'break'`) regardless of Standby_Bearing.
5. WHERE an item's Experience_Category is `Show` or `Parade` and its snapshot carries showtimes, THE optimizer SHALL continue to follow the showtime-slotting path of `day-planning-optimization` R3.16 in preference to the standby path.
6. WHERE an item's Experience_Category is `Show` or `Parade` and its snapshot carries no showtimes but is Standby_Bearing, THE optimizer SHALL model it on the standby path rather than emitting `showtimes_unavailable` with a zero wait.
7. WHERE an item has no `WaitSnapshot` at all and its Experience_Category is `Ride` or `Character_Meet`, THE optimizer SHALL apply the existing missing-snapshot default wait, preserving today's behavior for rides.
8. WHERE an item has no `WaitSnapshot` at all and its Experience_Category is not `Ride` or `Character_Meet`, THE optimizer SHALL model its queue wait as `0`.
9. THE change in criteria 1–8 SHALL NOT alter the park crowd index or the wait-sampling basket, both of which are gated on the live feed's posted STANDBY queue independently of Experience_Category.

### Requirement 4: Duration Defaults for the New Categories

**User Story:** As a trip planner, I want a walkthrough, a play area, and a game to occupy a realistic amount of my day, so that the plan does not assume every one of them takes fifteen minutes.

#### Acceptance Criteria

1. WHERE an item's Experience_Category is `Walkthrough` and neither a user duration override nor a catalog duration is present, THE optimizer SHALL model its duration as the Walkthrough default defined in the design's Configuration & Constants.
2. WHERE an item's Experience_Category is `PlayArea` and neither a user duration override nor a catalog duration is present, THE optimizer SHALL model its duration as the PlayArea default defined in the design's Configuration & Constants.
3. WHERE an item's Experience_Category is `Game` and neither a user duration override nor a catalog duration is present, THE optimizer SHALL model its duration as the Game default defined in the design's Configuration & Constants.
4. THE duration precedence of `day-planning-optimization` R3.14 SHALL be preserved: a user override outranks a catalog duration, which outranks the category default.
5. THE optimizer SHALL NOT fall through to `DEFAULT_RIDE_DUR` for any of `Walkthrough`, `PlayArea`, or `Game`.

### Requirement 5: Live Detail Gating for the New Categories

**User Story:** As a user, I want an experience's detail view to show live information only when live information exists for it, so that a walkthrough does not display an empty wait-time panel.

#### Acceptance Criteria

1. WHEN a User opens the detail view of an Experience whose Experience_Category is `Walkthrough`, `PlayArea`, or `Game` and the Live_Detail carries a standby wait, THE App SHALL present the wait time and operating status section as the live operational section.
2. WHEN a User opens the detail view of an Experience whose Experience_Category is `Walkthrough`, `PlayArea`, or `Game` and the Live_Detail carries no standby wait, THE App SHALL display no live operational section.
3. WHEN a User opens the detail view of an Experience whose Experience_Category is `Show` or `Parade` and the Live_Detail carries no showtimes but does carry a standby wait, THE App SHALL present the wait time and operating status section instead of an empty showtime section.
4. THE App SHALL continue to display at most one live operational section for any Experience.
5. THE App SHALL continue to display no live operational section for every Structural_Category.

### Requirement 6: Consumer Surfaces Remain Complete

**User Story:** As a user, I want the newly categorized experiences to stay reachable and countable everywhere they were before, so that re-labeling does not make a walkthrough disappear from the app.

#### Acceptance Criteria

1. WHEN the App presents the trip Experience picker's attractions tab, THE App SHALL include `Walkthrough`, `PlayArea`, and `Game` alongside `Ride`, so that a re-categorized attraction remains reachable where a user looks for it.
2. WHEN the App groups the catalog by Experience_Category, THE App SHALL place `Walkthrough`, `PlayArea`, and `Game` in the canonical category order and SHALL omit any category with zero Experiences.
3. WHEN the App presents category filter options, THE App SHALL offer `Walkthrough`, `PlayArea`, and `Game` as selectable values.
4. WHEN the API validates a leaderboard entry's category against the Experience_Category set, THE API SHALL accept `Walkthrough`, `PlayArea`, and `Game`.
5. WHEN the App computes per-category completion coverage, THE App SHALL report `Walkthrough`, `PlayArea`, and `Game` as their own coverage rows.
6. THE App SHALL provide a category placeholder image for each of `Walkthrough`, `PlayArea`, and `Game`, satisfying the placeholder rule of `disney-facilities-catalog-source` R7.5.

### Requirement 7: Auditability of the Cleanup

**User Story:** As a maintainer, I want each sync to report what it excluded and overrode, so that a rule that starts matching too much is visible instead of silently shrinking the catalog.

#### Acceptance Criteria

1. WHEN a Catalog_Sync run completes, THE Catalog_Sync SHALL record the count of Excluded_Facilities for that run, broken down by which Exclusion_Rule matched.
2. WHEN a Catalog_Sync run completes, THE Catalog_Sync SHALL record the count of applied Category_Overrides and the count of Category_Override entries that matched no Facility_Document.
3. IF a single Catalog_Sync run would newly soft-delete more Experience rows than the Deactivation_Safety_Threshold defined in the design's Configuration & Constants, THEN THE Catalog_Sync SHALL record an error-level warning identifying that deactivation count, the count of excluded documents, and the top matching rule, and SHALL still complete the run. The threshold SHALL be measured against the count of rows this run newly soft-deleted, NOT against the count of excluded upstream documents: the document count includes documents whose rows were already inactive from an earlier run, so it runs well ahead of the real effect (the first production run excluded 462 documents while deactivating exactly 326 rows) and would therefore both fire spuriously as upstream grows and fail to detect a genuine over-match.
4. THE recorded exclusion and override counts SHALL be emitted through the existing sync logging path, and SHALL NOT require a new table or endpoint.

## Assumptions

- **The audited counts are a sanity check, not a contract.** The audit on 2026-08-24 found 326 rows matching the Exclusion_Rules (leaving 846 active) and 52 Category_Overrides. Upstream data changes continuously, so tests assert the *rules and overrides*, never a total row count.
- **Soft deletion is the removal mechanism.** `disney-facilities-catalog-source` R11 already soft-deletes any cached Experience absent from the upstream set, and `catalog/repo.ts` never issues a `DELETE`. Withholding a document from the upstream set is therefore sufficient to remove it from every read surface, and no data migration is needed for the drops. This also makes every exclusion reversible with its history intact.
- **Which theater attractions post a standby wait versus a showtime is unverified.** The Requirement 2 mapping moves all 18 theater and cinema rows to `Show`; Requirement 3 and Requirement 5 are what make that safe regardless of which live shape each one returns. The `Show`-with-standby fallback paths (R3.6, R5.3) exist precisely because that split has not been confirmed against the live feed.
- **Uwanja Camp is a curated keep.** It is an in-park Animal Kingdom play area that upstream areas to a resort area and types with a `Water Play Area` sub-type, so Exclusion_Rule R1.3 would drop it. R1.10 keeps it via its Category_Override. Its incorrect Area is an upstream data problem and is out of scope here.
- **Pruning aggregate intelligence rows for deactivated experiences is out of scope.** `ride_shapes`, `experience_signals`, `experience_season_hour`, and `experience_weather_sensitivity` rows for a deactivated Experience stop being updated (sampling reads `active = true`) but are not removed. That is bounded dead weight, not a correctness problem, and is left for a separate change.
- **The non-Disney "Good Neighbor" hotels stay.** The 23 third-party hotels carried as resort-representing Experiences are in the WDW facilities channel and remain in scope for `resort-tracking-and-stats`; this feature does not touch them.

### Requirement 8: Deduplication of Clone and Same-Facility Rows

**User Story:** As a user, I want one catalog entry per real thing, classified consistently every sync, so that a hard-ticket party is always an Event rather than flipping to Recreation depending on which upstream document happened to appear that day.

Disney publishes several real-world experiences as two or more Facility_Documents: a specific typed document (`Event`, `Attraction`, `Entertainment`, `Dinner-Show`, `Spa`) plus a generic `Recreation` "things to do" landing document, and in a few cases two documents sharing one numeric facility id under different `entityType`s. Both land as separate `experiences` rows with different Internal_Ids and different categories.

The observed failure is not merely a wrong label. Nothing pins which sibling survives a given run, so a pair can flip whenever upstream document availability changes, and because the siblings carry different Internal_Ids, a Completion or Rating logged against one is stranded when the other wins. "Mickey's Not-So-Scary Halloween Party" surfaced this: it was active only as `Recreation` (`19637044`) while its `Event` sibling (`90004990`) sat inactive. Investigation showed that particular sibling is upstream-tombstoned (`softDeleted: true`, no `name`, no `type`) rather than transiently missing, so it is resolved by a Category_Override on the surviving `Recreation` row rather than by deduplication — which is itself the reason criterion 10 below requires a retained sibling to be verified usable before a pair is curated.

#### Acceptance Criteria

1. THE `ExclusionRule` set SHALL be extended with the member `duplicate_clone`, and THE Catalog_Sync SHALL treat a Facility_Document whose Enterprise_Id appears in the curated Duplicate_Clone_List as an Excluded_Facility under that rule.
2. THE Duplicate_Clone_List SHALL be a curated, hand-maintained constant of Enterprise_Ids, each recorded in the design together with the Enterprise_Id of the sibling row it defers to and the reason for that choice.
3. THE Catalog_Sync SHALL NOT infer a duplicate relationship at runtime from names, facets, or numeric-id collisions; deduplication SHALL be driven solely by the curated list, consistent with the Category_Override rule of R2.6.
4. THE exclusion of a Duplicate_Clone SHALL be unconditional — it SHALL NOT depend on the retained sibling being present in the same run — so the surviving Internal_Id for a given real-world experience is identical on every run regardless of feed contents.
5. WHERE a Duplicate_Clone's retained sibling is absent from a run's upstream set, THE Catalog_Sync SHALL leave neither row active, accepting a temporarily absent catalog entry in exchange for a stable Internal_Id.
6. THE precedence rule of R1.10 SHALL apply unchanged: WHERE a Facility_Document has a Category_Override, it SHALL be admitted even when it appears in the Duplicate_Clone_List.
7. WHEN a Catalog_Sync run completes, THE Catalog_Sync SHALL detect every group of two or more active Experiences whose names are equal after case-insensitive, punctuation-insensitive normalization, and SHALL record a warning listing each such group with its members' Enterprise_Ids and categories.
8. THE duplicate detection of criterion 7 SHALL be diagnostic only and SHALL NOT withhold, exclude, or modify any Experience, so that a newly appearing clone becomes visible without silently changing the catalog.
9. THE duplicate detection SHALL exclude from its report any group that the maintainer has recorded as intentionally co-existing in the design's Known_Distinct_Namesakes list, so the warning stays actionable rather than reporting the same known pairs every run.
10. THE Duplicate_Clone_List SHALL only contain an entry whose retained sibling has a usable upstream document — one that does not carry `softDeleted: true` and does carry a non-empty `name`. WHERE the only specifically-typed sibling of a generic `Recreation` document is upstream-tombstoned, THE Catalog_Sync SHALL retain the `Recreation` document and correct its classification through a Category_Override (R2.3) instead of excluding it, so the experience keeps a stable Internal_Id, the correct Experience_Category, and its place in the catalog.
11. No Enterprise_Id SHALL appear in both the Duplicate_Clone_List and the Category_Override list. Because R1.10 makes an override silently outrank an exclusion, an id present in both is a contradiction in the curated data rather than a case to be resolved by precedence, and SHALL be surfaced as a failing test rather than tolerated at runtime.
