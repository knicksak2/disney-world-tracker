# Implementation Plan: Experience Search Nicknames, Acronyms, and Fuzzy Matching

## Overview

Extends the pure experience search engine in `@dwt/shared` (`packages/shared/src/search/experienceSearch.ts`) with a curated dictionary of Disney World acronyms, nicknames, and colloquial terms, plus bounded 1-edit typo tolerance for search tokens of length $\ge 4$. Both backend API search (`CatalogRepo.listActiveExperiences`) and mobile client in-memory filters (`DestinationScreen`, `ParkDestinationScreen`, `ResortPicker`) consume `@dwt/shared` directly, ensuring symmetrical, immediate availability with zero schema or wire protocol changes.

## Tasks

- [x] 1. Core Alias Dictionary and Fuzzy Distance Utilities (`packages/shared`)
  - [x] 1.1 Create `packages/shared/src/search/experienceAliases.ts` with curated Disney World attraction & dining acronyms and nicknames index
    - Define `CURATED_EXPERIENCE_ALIASES` with 60+ entries across Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom, and Resorts
    - Implement `checkExperienceAliasMatch` for exact and partial alias resolution
    - _Requirements: 1.1, 1.2, 1.5_
  - [x] 1.2 Implement `packages/shared/src/search/fuzzyDistance.ts` with bounded Damerau-Levenshtein distance ($\le 1$ edit distance, query token length $\ge 4$)
    - Implement `damerauLevenshteinDistance` supporting insertions, deletions, substitutions, and single adjacent transpositions with early exit
    - Implement `isFuzzyTokenMatch` gating on token length $\ge 4$ and edit distance $\le 1$
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 1.3 Checkpoint — run `npm run verify:shared`
    - Run `@dwt/shared` typecheck and tests
    - _Requirements: 1.1, 2.1_

- [x] 2. Search Engine Integration (`packages/shared`)
  - [x] 2.1 Update `packages/shared/src/search/experienceSearch.ts` to integrate alias matching (Tiers 85 & 70) and fuzzy typo matching (Tier 35) into `scoreExperienceSearch` and `filterAndRankExperiences`
    - Extend `SearchMatchTier` union with `'alias_exact' | 'alias_phrase' | 'fuzzy'`
    - Integrate alias check and fuzzy token checks in `scoreExperienceSearch`
    - Update direct match score threshold in `filterAndRankExperiences` from 40 to 35
    - _Requirements: 1.3, 1.4, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 2.2 Export aliases and utilities in `packages/shared/src/search/index.ts` and `packages/shared/src/index.ts`
    - Export `CURATED_EXPERIENCE_ALIASES`, `checkExperienceAliasMatch`, `damerauLevenshteinDistance`, `isFuzzyTokenMatch` and associated types
    - _Requirements: 1.1_
  - [x] 2.3 Checkpoint — run `npm run verify:shared`
    - Run `@dwt/shared` typecheck and tests
    - _Requirements: 1.1, 3.1_

- [x] 3. Comprehensive Unit & Property Testing (`packages/shared`)
  - [x] 3.1 Add unit tests in `packages/shared/src/__tests__/experienceAliases.test.ts` verifying all popular acronyms (`rotr`, `sdd`, `7dmt`, `tot`, `fop`, `gotg`, `people mover`, `dole whip`) and typo queries (`spaceshp eart`, `pirats`)
    - Test acronym exact matches, nickname matches, multi-venue alias matches, alias prefix matches, fuzzy typo matches, and ranking priority
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.4, 2.5_
  - [x] 3.2 Update property tests in `packages/shared/src/__tests__/experienceSearch.prop.test.ts` verifying Property 1 (Alias), Property 2 (Fuzzy), and Property 3 (Monotonicity & Invariants)
    - Add fast-check Property 1 (Exact and Prefix Alias Matching), Property 2 (Bounded Fuzzy Typo Matching), and Property 2b (Short query token rejection)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 3.3 Checkpoint — run `npm run verify:shared`
    - Run `@dwt/shared` typecheck and tests
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Full Verification Gate Across Monorepo
  - [x] 4.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`) and ensure 100% green
    - Execute root `npm run verify` and paste literal tail
    - _Requirements: All_

## Notes

- All changes reside cleanly within `packages/shared`. Because both `apps/api` (catalog search endpoint) and `apps/mobile` (client-side filters) consume `@dwt/shared`, both environments instantly gain nickname, acronym, and fuzzy search without requiring API protocol alterations.
- All existing search invariants (Substring Superset $\ge 60$, Prefix Token $\ge 40$, Metadata Cap of 25) are strictly maintained.
- Property tests use `fast-check` with $\ge 100$ runs tagged with `Feature: experience-search-aliases, Property N`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["3.1", "3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["4.1"] }
  ]
}
```
