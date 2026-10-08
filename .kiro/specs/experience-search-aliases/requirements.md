# Requirements Document

## Introduction

Disney parkgoers frequently search for attractions and dining locations using colloquial acronyms (e.g. `RotR` for *Star Wars: Rise of the Resistance*, `SDD` for *Slinky Dog Dash*, `7DMT` for *Seven Dwarfs Mine Train*, `ToT` for *Tower of Terror*, `FoP` for *Flight of Passage*), common nicknames (e.g. `People Mover` for *Tomorrowland Transit Authority PeopleMover*, `Mine Train`, `Tea Cups`, `Dole Whip`), or enter slight typographical errors on mobile devices while walking in the parks (e.g. `Spaceship Eart`, `Pirats`).

Today, experience search in `@dwt/shared` (`packages/shared/src/search/experienceSearch.ts`) supports exact names, prefixes, contiguous phrases, token prefixes, and metadata fallbacks. However, searching an acronym like `RotR` or a split compound like `People Mover` yields zero matches because neither substring nor token prefix matches the official upstream Disney facility name.

This feature extends the pure experience search engine in `@dwt/shared` with:
1. A curated, high-signal catalog of Disney World attraction and dining acronyms, nicknames, and aliases.
2. An alias matching tier in `scoreExperienceSearch` that ranks exact and prefix alias matches ahead of or alongside high-confidence name matches.
3. A bounded fuzzy / typo-tolerance tier (1-edit distance for query tokens with length $\ge 4$) that ranks above loose metadata fallbacks but below exact token matches.
4. Complete preservation of existing search invariants (Substring Superset Preservation, Relevance Monotonicity, and Metadata Capping).

## Glossary

- **Searchable_Experience**: An entity with an `id`, `name`, and optional metadata fields (`land`, `worldShowcaseCountry`, `subType`, `groupedFacets`, etc.) evaluated by the search engine.
- **Experience_Alias**: A curated alternate query phrase, acronym, or nickname associated with one or more catalog Experiences (e.g. `rotr` for *Star Wars: Rise of the Resistance*).
- **Alias_Tier**: The relevance scoring tier assigned to alias matches (Tier 85 for exact alias match, Tier 70 for prefix/phrase alias match).
- **Fuzzy_Tier**: The relevance scoring tier (Tier 35) assigned when every query token matches a name token with at most 1 character insertion, deletion, substitution, or transposition for tokens of length $\ge 4$.

---

## Requirements

### Requirement 1: Curated Acronym and Nickname Alias Dictionary

**User Story:** As a Disney parkgoer, I want to search using common acronyms and nicknames (such as `RotR`, `SDD`, `7DMT`, `ToT`, `FoP`, `GotG`, `People Mover`, `Dole Whip`), so that I can quickly find attractions without typing their full formal Disney names.

#### Acceptance Criteria

1. THE Search_Engine SHALL maintain a curated alias dictionary mapping normalized acronyms, nicknames, and colloquial terms to their target Experience names or canonical identifiers.
2. THE Search_Engine SHALL include major theme park headliners and popular dining locations across Magic Kingdom, EPCOT, Disney's Hollywood Studios, Disney's Animal Kingdom, and Disney Resorts in the alias dictionary.
3. WHEN a user searches an exact alias from the dictionary (e.g. `rotr`, `sdd`, `7dmt`, `fop`, `tot`, `gotg`, `people mover`, `dole whip`), THE Search_Engine SHALL match the associated target Experience(s) with an Alias Score of 85.
4. WHEN a user searches a prefix or multi-token phrase of a known alias (e.g. `rot` for `rotr`, `people` for `people mover`), THE Search_Engine SHALL match the associated target Experience(s) with an Alias Partial Score of 70 unless the name itself produces a higher-scoring match.
5. WHERE multiple Experiences share an alias (such as `dole whip` pointing to *Aloha Isle*, *Pineapple Lanai*, *Sunshine Tree Terrace*, and *Swirls on the Water*), THE Search_Engine SHALL return all matching target Experiences with the same alias tier score, sorted deterministically by `lower(name)` ascending then `id` ascending.

---

### Requirement 2: Bounded Fuzzy Typo Tolerance

**User Story:** As a mobile user walking through the park, I want minor typos (like typing `Spaceship Eart` instead of `Spaceship Earth`) to still find the attraction, so that I don't get zero results due to an accidental slip.

#### Acceptance Criteria

1. THE Search_Engine SHALL evaluate Damerau-Levenshtein edit distance between query tokens and normalized Experience name tokens.
2. WHERE a query token has length $\ge 4$, THE Search_Engine SHALL treat a name token with an edit distance $\le 1$ as a fuzzy token match.
3. WHERE a query token has length $< 4$, THE Search_Engine SHALL require an exact prefix match without allowing edit distance $> 0$.
4. WHEN every query token in a multi-token query matches a name token either via exact token prefix OR via 1-edit fuzzy distance (with at least one token requiring fuzzy matching), THE Search_Engine SHALL assign a Fuzzy Score of 35.
5. IF any query token cannot be matched via prefix or 1-edit distance, THEN THE Search_Engine SHALL NOT award the Fuzzy Score.

---

### Requirement 3: Flat-Tier Ranking and Invariant Preservation

**User Story:** As a system maintainer, I want the search results to remain strictly ordered by relevance, so that exact name matches always beat nicknames, and nicknames always beat loose metadata or fuzzy matches.

#### Acceptance Criteria

1. THE Search_Engine SHALL rank results by non-increasing score according to the following strict hierarchy:
   - Exact Name Match (100)
   - Exact Alias Match (85)
   - Name Starts With Query (80)
   - Alias Phrase / Prefix Match (70)
   - Contiguous Phrase in Name (60)
   - All Query Tokens Prefix-Matched in Name (40)
   - Fuzzy Name Match (35)
   - Metadata Fallback Match (20)
2. THE Search_Engine SHALL preserve the Substring Superset Invariant: every Experience whose normalized name contains the normalized query as a contiguous substring SHALL score at least 60.
3. THE Search_Engine SHALL preserve the Prefix-Token Invariant: every Experience whose name tokens are prefix-matched by all query tokens SHALL score at least 40.
4. THE Search_Engine SHALL preserve the Metadata Cap & Sort rule: metadata-only matches (score 20) SHALL be sorted by `lower(name)` ascending then `id` ascending and capped at `MAX_METADATA_FALLBACK_ROWS` (25).
5. WHERE multiple search results share an equal score, THE Search_Engine SHALL order rows strictly by `lower(name)` ascending then `id` ascending.
