// Feature: catalog-experience-search, Property 30: search normalization preserves substring superset and enforces monotonic relevance ranking
/**
 * Property-based tests for shared experience search normalization, union matching,
 * and flat-tier relevance ranking.
 *
 * Validates: Requirements 1.20, 1.25, 1.26, 1.27, 1.28
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  MAX_METADATA_FALLBACK_ROWS,
  filterAndRankExperiences,
  normalizeSearchText,
  scoreExperienceSearch,
  tokenizeSearchQuery,
  type SearchableExperience,
} from '../search/experienceSearch.js';

describe('Property 30: Experience Search Normalization, Prefix Matching, Substring Superset Preservation, and Relevance Ordering', () => {
  // Arbitrary for random unicode text, words, and realistic names
  const textArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 60 }),
    fc
      .array(
        fc.constantFrom(
          'Space',
          'Mountain',
          'Magic',
          'Kingdom',
          'Mickey',
          '&',
          'Minnie',
          "Pan's",
          'Flight',
          'Rock',
          "'n'",
          'Roller',
          'Coaster',
          'San',
          'Ángel',
          'Inn',
          'TRON',
          'Lightcycle',
          '/',
          'Run',
          '71',
          'Café',
          'Crêpes',
          '‘Ohana',
          "Satu'li",
        ),
        { minLength: 1, maxLength: 6 },
      )
      .map((words) => words.join(' ')),
  );

  const nonWhitespaceQueryArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => normalizeSearchText(s).length > 0);

  const facetValueArb = fc.record({
    id: fc.uuid(),
    name: textArb.filter((s) => s.trim().length > 0),
  });

  const groupedFacetsArb = fc.dictionary(
    fc.constantFrom('thrill', 'interests', 'cuisine'),
    fc.array(facetValueArb, { minLength: 0, maxLength: 3 }),
  );

  const searchableExperienceArb: fc.Arbitrary<SearchableExperience> = fc.record({
    id: fc.uuid(),
    name: textArb.filter((s) => s.trim().length > 0),
    land: fc.option(textArb, { nil: undefined }),
    worldShowcaseCountry: fc.option(textArb, { nil: undefined }),
    subType: fc.option(textArb, { nil: undefined }),
    groupedFacets: fc.option(groupedFacetsArb, { nil: undefined }),
    interestFacets: fc.option(groupedFacetsArb, { nil: undefined }),
    physicalConsiderations: fc.option(fc.array(textArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
    heightRequirement: fc.option(fc.record({ name: textArb }), { nil: undefined }),
    accessibility: fc.option(fc.array(textArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
  });

  it('Property 1: Normalization is idempotent for any input string', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const first = normalizeSearchText(text);
        const second = normalizeSearchText(first);
        expect(second).toBe(first);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2: Substring Superset Preservation — if normalized query is substring of normalized name, score is >= 60', () => {
    fc.assert(
      fc.property(
        textArb.filter((s) => normalizeSearchText(s).length > 0),
        nonWhitespaceQueryArb,
        (targetName, query) => {
          const normTarget = normalizeSearchText(targetName);
          const normQuery = normalizeSearchText(query);

          if (normTarget.includes(normQuery)) {
            const exp: SearchableExperience = { id: 'test-id', name: targetName };
            const qTokens = tokenizeSearchQuery(query);
            const result = scoreExperienceSearch(exp, normQuery, qTokens);

            expect(result.score).toBeGreaterThanOrEqual(60);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 3: Prefix Token Matching — if all query tokens prefix-match tokens in name, score is >= 40', () => {
    fc.assert(
      fc.property(
        textArb.filter((s) => normalizeSearchText(s).length > 0),
        nonWhitespaceQueryArb,
        (targetName, query) => {
          const normTarget = normalizeSearchText(targetName);
          const normQuery = normalizeSearchText(query);
          const qTokens = tokenizeSearchQuery(query);
          const targetTokens = normTarget.split(' ').filter((t) => t.length > 0);

          const allTokensPrefixMatch =
            qTokens.length > 0 &&
            qTokens.every((qToken) =>
              targetTokens.some((tToken) => tToken.startsWith(qToken)),
            );

          if (allTokensPrefixMatch) {
            const exp: SearchableExperience = { id: 'test-id', name: targetName };
            const result = scoreExperienceSearch(exp, normQuery, qTokens);
            expect(result.score).toBeGreaterThanOrEqual(40);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 4: Array Relevance Monotonicity, Name Precedence, Tie-breaking, and Metadata Cap', () => {
    fc.assert(
      fc.property(
        fc.array(searchableExperienceArb, { minLength: 0, maxLength: 50 }),
        nonWhitespaceQueryArb,
        (experiences, query) => {
          const normQuery = normalizeSearchText(query);
          const qTokens = tokenizeSearchQuery(query);

          const results = filterAndRankExperiences(experiences, query);

          // 1. Every returned element must have matched with score > 0
          let lastScore = 101;
          let metadataCount = 0;

          for (let i = 0; i < results.length; i++) {
            const current = results[i]!;
            const { score } = scoreExperienceSearch(current, normQuery, qTokens);
            expect(score).toBeGreaterThan(0);

            // Scores must be non-increasing
            expect(score).toBeLessThanOrEqual(lastScore);
            lastScore = score;

            if (score === 20) {
              metadataCount++;
            }

            // Tie-breaking within same score: lower(name) ASC, then id ASC
            if (i > 0) {
              const prev = results[i - 1]!;
              const prevScore = scoreExperienceSearch(prev, normQuery, qTokens).score;

              if (score === prevScore) {
                const nameCmp = prev.name.toLowerCase().localeCompare(current.name.toLowerCase());
                if (nameCmp !== 0) {
                  expect(nameCmp).toBeLessThanOrEqual(0);
                } else {
                  expect(prev.id.localeCompare(current.id)).toBeLessThanOrEqual(0);
                }
              }
            }
          }

          // Metadata matches must be capped at MAX_METADATA_FALLBACK_ROWS
          expect(metadataCount).toBeLessThanOrEqual(MAX_METADATA_FALLBACK_ROWS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 5: Metadata Union Matching — facet or metadata token match scores at least 20', () => {
    const validFacetNameArb = fc
      .string({ minLength: 3, maxLength: 20 })
      .filter((s) => /^[a-zA-Z0-9 ]+$/.test(s) && normalizeSearchText(s).length >= 3);

    fc.assert(
      fc.property(validFacetNameArb, (facetName) => {
        const normFacet = normalizeSearchText(facetName);
        const exp: SearchableExperience = {
          id: 'exp-metadata',
          name: 'Completely Different Name Unrelated',
          groupedFacets: { category1: [{ id: 'f-1', name: facetName }] },
        };

        const result = scoreExperienceSearch(
          exp,
          normFacet,
          tokenizeSearchQuery(normFacet),
        );
        expect(result.score).toBeGreaterThanOrEqual(20);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 5b: Compound Land Splitting — "fantasy land" query matches "Fantasyland" land field', () => {
    const landPrefixArb = fc.constantFrom(
      'Fantasy',
      'Tomorrow',
      'Adventure',
      'Frontier',
      'Dino',
    );

    fc.assert(
      fc.property(landPrefixArb, (prefix) => {
        const landName = `${prefix}land`;
        const query = `${prefix.toLowerCase()} land`;
        const exp: SearchableExperience = {
          id: 'exp-compound-land',
          name: 'Unique Ride Attraction',
          land: landName,
        };

        const normQuery = normalizeSearchText(query);
        const result = scoreExperienceSearch(
          exp,
          normQuery,
          tokenizeSearchQuery(normQuery),
        );
        expect(result.score).toBeGreaterThanOrEqual(20);
      }),
      { numRuns: 50 },
    );
  });
});
