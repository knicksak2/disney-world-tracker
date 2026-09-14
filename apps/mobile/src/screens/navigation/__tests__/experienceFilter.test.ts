/**
 * Unit tests for experienceFilter search and reset behaviors (R14.10, R14.11).
 */

import type { CompletionEntryDTO } from '@dwt/shared';
import {
  applyExperienceFilter,
  clearFilter,
  DEFAULT_FILTER,
  hasActiveFilter,
} from '../experienceFilter';

function makeEntry(overrides: Partial<CompletionEntryDTO> = {}): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: null,
    sharedNote: null,
    ...overrides,
  };
}

const ENTRIES: readonly CompletionEntryDTO[] = [
  makeEntry({
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    sharedNote: 'Loved the retro queue music!',
  }),
  makeEntry({
    experienceName: 'Spaceship Earth',
    park: 'EPCOT',
    category: 'Ride',
    sharedNote: 'Smell of Rome burning is unforgettable',
  }),
  makeEntry({
    experienceName: 'Festival of the Lion King',
    park: 'Animal Kingdom',
    category: 'Show',
    sharedNote: null,
  }),
  makeEntry({
    experienceName: 'Cinderella Royal Table',
    park: 'Magic Kingdom',
    category: 'Restaurant',
    sharedNote: 'Great dinner inside the castle',
  }),
  makeEntry({
    experienceName: 'Mickey and Friends Greeting',
    park: 'EPCOT',
    category: 'Character_Meet',
    sharedNote: 'Mickey gave huge hugs',
  }),
];

describe('experienceFilter — search narrowing (R14.10)', () => {
  test('matches by experience name case-insensitively', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: 'mountain',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.experienceName).toBe('Space Mountain');
  });

  test('matches by park name case-insensitively', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: 'epcot',
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.experienceName)).toEqual([
      'Spaceship Earth',
      'Mickey and Friends Greeting',
    ]);
  });

  test('matches by category label case-insensitively', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: 'character meet',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.experienceName).toBe('Mickey and Friends Greeting');
  });

  test('matches by sharedNote content case-insensitively', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: 'rome burning',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.experienceName).toBe('Spaceship Earth');
  });

  test('combines park filter and search query correctly', () => {
    // Both Space Mountain and Cinderella Royal Table are Magic Kingdom,
    // but searching 'mountain' keeps only Space Mountain
    const result = applyExperienceFilter(ENTRIES, {
      park: 'Magic Kingdom',
      category: 'All',
      search: 'mountain',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.experienceName).toBe('Space Mountain');
  });

  test('returns empty array when search query matches nothing', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: 'Darth Vader Star Wars Galaxy',
    });
    expect(result).toHaveLength(0);
  });

  test('trims whitespace-only queries and treats them as empty query', () => {
    const result = applyExperienceFilter(ENTRIES, {
      ...DEFAULT_FILTER,
      search: '   \t  ',
    });
    expect(result).toHaveLength(ENTRIES.length);
  });
});

describe('experienceFilter — hasActiveFilter & clearFilter (R14.11)', () => {
  test('hasActiveFilter reports false on DEFAULT_FILTER', () => {
    expect(hasActiveFilter(DEFAULT_FILTER)).toBe(false);
  });

  test('hasActiveFilter reports true when park is non-All', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTER, park: 'Magic Kingdom' })).toBe(true);
  });

  test('hasActiveFilter reports true when category is non-All', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTER, category: 'Ride' })).toBe(true);
  });

  test('hasActiveFilter reports true when search query is non-empty', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTER, search: 'pirates' })).toBe(true);
  });

  test('hasActiveFilter reports false when search query is whitespace only', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTER, search: '   ' })).toBe(false);
  });

  test('clearFilter returns DEFAULT_FILTER', () => {
    expect(clearFilter()).toEqual(DEFAULT_FILTER);
  });
});
