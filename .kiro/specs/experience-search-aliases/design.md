# Design Document: Experience Search Nicknames, Acronyms, and Fuzzy Matching

## Overview

Disney parkgoers frequently search for attractions and dining locations using colloquial acronyms (e.g. `RotR`, `SDD`, `7DMT`, `ToT`, `FoP`, `GotG`), common nicknames (`People Mover`, `Dole Whip`, `Mine Train`, `Tea Cups`), or make minor 1-character typographical errors on mobile devices while walking in the parks (e.g. `Spaceship Eart`, `Pirats`).

This design extends the pure experience search engine in `@dwt/shared` (`packages/shared/src/search/experienceSearch.ts`) with:
1. A curated, high-signal catalog of Disney World attraction and dining acronyms, nicknames, and community search phrases.
2. Distinct alias matching tiers in `scoreExperienceSearch` (Tier 85 for exact alias match, Tier 70 for prefix or phrase alias match).
3. A bounded fuzzy typo-tolerance tier (Tier 35) applying Damerau-Levenshtein edit distance $\le 1$ for query tokens of length $\ge 4$.
4. Complete preservation of existing search invariants: Substring Superset Preservation ($\ge 60$), Prefix Token Invariant ($\ge 40$), and deterministic tie-breaking.

Both the Fastify backend (`CatalogRepo.listActiveExperiences`) and mobile client in-memory filters (`DestinationScreen`, `ParkDestinationScreen`, `ResortPicker`) consume `@dwt/shared` directly, ensuring symmetrical behavior without database migrations or wire DTO changes.

---

## Architecture

```
User Query ("RotR" / "SDD" / "7DMT" / "Spaceship Eart")
   │
   ▼
normalizeSearchText(query) & tokenizeSearchQuery(query)
   │
   ▼
scoreExperienceSearch(exp, normalizedQuery, queryTokens)
   ├── Tier 100: Exact Name Match
   ├── Tier  85: Exact Alias / Acronym Match (CURATED_EXPERIENCE_ALIASES)
   ├── Tier  80: Name Starts With Query
   ├── Tier  70: Alias Prefix / Phrase Match
   ├── Tier  60: Contiguous Phrase in Name (Ensures Substring Superset)
   ├── Tier  40: All Query Tokens Prefix-Matched in Name
   ├── Tier  35: Bounded Fuzzy Typo Match (1-edit distance for len >= 4)
   ├── Tier  20: Metadata Fallback Match (Land, Country, SubType, Facets)
   └── Tier   0: No Match
   │
   ▼
filterAndRankExperiences(experiences, query)
   ├── Direct Matches (Score >= 35): Sorted by score DESC, lower(name) ASC, id ASC
   ├── Metadata Matches (Score == 20): Sliced to MAX_METADATA_FALLBACK_ROWS (25)
   └── Return [...directMatches, ...cappedMetadataMatches]
```

---

## Components and Interfaces

### 1. Curated Alias Dictionary (`packages/shared/src/search/experienceAliases.ts`)

A dedicated catalog of Disney World attraction and dining aliases:

```typescript
export interface SearchAliasEntry {
  readonly targetSubstrings: readonly string[];
  readonly aliases: readonly string[];
}

export interface AliasMatchResult {
  readonly isMatch: boolean;
  readonly isExact: boolean;
}

export function checkExperienceAliasMatch(
  normalizedName: string,
  normalizedQuery: string,
): AliasMatchResult;
```

### 2. Bounded Damerau-Levenshtein Edit Distance (`packages/shared/src/search/fuzzyDistance.ts`)

Pure distance calculations supporting insertions, deletions, substitutions, and single adjacent transpositions:

```typescript
export function damerauLevenshteinDistance(
  a: string,
  b: string,
  maxDistance?: number,
): number;

export function isFuzzyTokenMatch(
  queryToken: string,
  nameToken: string,
): boolean;
```

- When `queryToken.length < FUZZY_MIN_TOKEN_LENGTH` (4), returns `false`.
- When `queryToken.length >= 4`, returns `true` if `nameToken.startsWith(queryToken)` or `damerauLevenshteinDistance(queryToken, nameToken) <= 1` or edit distance to prefix slice is $\le 1$.

---

## Data Models

The search engine operates on pure in-memory models defined in `@dwt/shared`:

### SearchableExperience
```typescript
export interface SearchableExperience {
  readonly id: string;
  readonly name: string;
  readonly land?: string | null | undefined;
  readonly worldShowcaseCountry?: string | null | undefined;
  readonly subType?: string | null | undefined;
  readonly groupedFacets?: GroupedFacetsDTO | null | undefined;
  readonly interestFacets?: GroupedFacetsDTO | null | undefined;
  readonly physicalConsiderations?: readonly (FacetValueDTO | string)[] | null | undefined;
  readonly heightRequirement?: HeightRequirementDTO | { readonly name: string } | null | undefined;
  readonly accessibility?: readonly string[] | null | undefined;
}
```

### SearchMatchTier and SearchScoredResult
```typescript
export type SearchMatchTier =
  | 'exact'
  | 'alias_exact'
  | 'prefix'
  | 'alias_phrase'
  | 'phrase'
  | 'tokens'
  | 'fuzzy'
  | 'metadata'
  | 'none';

export interface SearchScoredResult {
  readonly score: number;
  readonly tier: SearchMatchTier;
}
```

---

## Correctness Properties

### Property 1: Exact and Prefix Alias Matching
*For any* Experience with a registered alias in `CURATED_EXPERIENCE_ALIASES` and query matching that alias:
1. When `normalizeSearchText(query)` equals the normalized alias, `scoreExperienceSearch` MUST return a score of 85 and tier `'alias_exact'`.
2. When the normalized query is a prefix of an alias (length $\ge 3$) or matches an alias phrase, the score MUST be at least 70.
3. If the experience name itself produces an exact match (score 100), the higher score MUST take precedence.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Bounded Fuzzy Typo Matching
*For any* Experience name and query where all query tokens have length $\ge 4$:
1. If every query token has an edit distance $\le 1$ to a token in the Experience name (with at least one fuzzy edit), `scoreExperienceSearch` MUST return score 35 and tier `'fuzzy'`.
2. For query tokens with length $< 4$, edit distance $> 0$ MUST NOT match as fuzzy.
3. Fuzzy matches MUST strictly rank below token prefix matches (score 40) and strictly above metadata matches (score 20).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 3: Monotonic Hierarchy and Invariant Preservation
*For any* array of SearchableExperiences and non-empty query:
1. All returned results from `filterAndRankExperiences` MUST have scores $> 0$ and non-increasing scores ($s_i \ge s_{i+1}$).
2. Every Experience matching `name.includes(normalizedQuery)` MUST have score $\ge 60$ (Superset Invariant).
3. Every Experience matching token prefixes in name MUST have score $\ge 40$ (Prefix-Token Invariant).
4. Metadata matches (score 20) MUST be capped at `MAX_METADATA_FALLBACK_ROWS` (25) and appear after all direct name, alias, and fuzzy matches (scores $\ge 35$).
5. Ties MUST be ordered by `lower(name)` ASC then `id` ASC.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Configuration & Constants

- `MAX_METADATA_FALLBACK_ROWS = 25`: Maximum metadata fallback rows returned.
- `FUZZY_MIN_TOKEN_LENGTH = 4`: Minimum length of a query token for fuzzy typo matching.
- `MAX_FUZZY_EDIT_DISTANCE = 1`: Maximum allowable Damerau-Levenshtein edit distance for typo tolerance.

---

## External Interfaces

No external third-party network APIs or database migrations are required. The feature is implemented as a pure, dependency-free domain module within `packages/shared/src/search/` and exposed via `@dwt/shared`.

---

## Error Handling

All search functions are pure, synchronous, and safe against abnormal inputs:
- Null, undefined, empty strings, and whitespace queries gracefully return empty arrays or input arrays unmodified without throwing.
- Special punctuation, non-ASCII Unicode diacritics, and symbols are normalized via `normalizeSearchText` and do not cause uncaught exceptions or regex backtracking errors.

---

## Testing Strategy

1. **Unit Tests** (`packages/shared/src/__tests__/experienceAliases.test.ts`):
   - Acronym exact queries: `rotr`, `sdd`, `7dmt`, `tot`, `fop`, `gotg`, `mfsr`, `mmrr`, `btmrr`, `cbj`, `cop`, `iasw`, `potc`, `tta`.
   - Nicknames: `people mover`, `dole whip`, `mine train`, `tea cups`, `cosmic rewind`, `tower of terror`.
   - Fuzzy typos: `spaceshp eart`, `pirats`, `mine tran`, `flight of pasage`.
   - Short token exclusion: 3-letter words like `tot` do not match `top` as fuzzy.
2. **Property Tests** (`packages/shared/src/__tests__/experienceSearch.prop.test.ts`):
   - Property 1: Exact and Prefix Alias Matching ($\ge 100$ runs with fast-check).
   - Property 2: Bounded Fuzzy Typo Matching ($\ge 100$ runs with fast-check).
   - Property 2b: Short query tokens (< 4) do not match fuzzily with edits ($\ge 100$ runs).
   - Property 3 / Property 30: Array Relevance Monotonicity, Name Precedence, Tie-breaking, and Metadata Cap ($\ge 100$ runs).
