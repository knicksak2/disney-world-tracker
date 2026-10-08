import { describe, it, expect } from 'vitest';
import {
  scoreExperienceSearch,
  filterAndRankExperiences,
  normalizeSearchText,
  tokenizeSearchQuery,
  type SearchableExperience,
} from '../search/experienceSearch.js';
import {
  damerauLevenshteinDistance,
  isFuzzyTokenMatch,
} from '../search/fuzzyDistance.js';

const EXP_ROTR: SearchableExperience = {
  id: 'rotr-id',
  name: 'Star Wars: Rise of the Resistance',
  land: "Star Wars: Galaxy's Edge",
};

const EXP_SDD: SearchableExperience = {
  id: 'sdd-id',
  name: 'Slinky Dog Dash',
  land: 'Toy Story Land',
};

const EXP_7DMT: SearchableExperience = {
  id: '7dmt-id',
  name: 'Seven Dwarfs Mine Train',
  land: 'Fantasyland',
};

const EXP_TOT: SearchableExperience = {
  id: 'tot-id',
  name: 'The Twilight Zone Tower of Terror™',
  land: 'Sunset Boulevard',
};

const EXP_FOP: SearchableExperience = {
  id: 'fop-id',
  name: 'Avatar Flight of Passage',
  land: 'Pandora - The World of Avatar',
};

const EXP_GOTG: SearchableExperience = {
  id: 'gotg-id',
  name: 'Guardians of the Galaxy: Cosmic Rewind',
  land: 'World Discovery',
};

const EXP_PEOPLE_MOVER: SearchableExperience = {
  id: 'tta-id',
  name: 'Tomorrowland Transit Authority PeopleMover',
  land: 'Tomorrowland',
};

const EXP_SPACESHIP_EARTH: SearchableExperience = {
  id: 'se-id',
  name: 'Spaceship Earth',
  land: 'World Celebration',
};

const EXP_PIRATES: SearchableExperience = {
  id: 'potc-id',
  name: 'Pirates of the Caribbean',
  land: 'Adventureland',
};

const EXP_MAD_TEA_PARTY: SearchableExperience = {
  id: 'tea-id',
  name: 'Mad Tea Party',
  land: 'Fantasyland',
};

const EXP_ALOHA_ISLE: SearchableExperience = {
  id: 'aloha-id',
  name: 'Aloha Isle',
  land: 'Adventureland',
};

const EXP_PINEAPPLE_LANAI: SearchableExperience = {
  id: 'lanai-id',
  name: 'Pineapple Lanai',
  land: "Disney's Polynesian Village Resort",
};

const EXP_SUNSHINE_TREE: SearchableExperience = {
  id: 'sunshine-id',
  name: 'Sunshine Tree Terrace',
  land: 'Adventureland',
};

describe('Fuzzy Distance Utilities', () => {
  it('computes exact Damerau-Levenshtein edit distance with transpositions', () => {
    expect(damerauLevenshteinDistance('earth', 'earth')).toBe(0);
    // Single deletion
    expect(damerauLevenshteinDistance('earth', 'eart')).toBe(1);
    // Single insertion
    expect(damerauLevenshteinDistance('eart', 'earth')).toBe(1);
    // Single substitution
    expect(damerauLevenshteinDistance('pirats', 'pirate')).toBe(1);
    // Single adjacent transposition
    expect(damerauLevenshteinDistance('erath', 'earth')).toBe(1);
    // Two edits exceeds bounded limit
    expect(damerauLevenshteinDistance('abc', 'xyz')).toBeGreaterThanOrEqual(2);
  });

  it('evaluates isFuzzyTokenMatch requiring token length >= 4', () => {
    // Length < 4 returns false
    expect(isFuzzyTokenMatch('tot', 'top')).toBe(false);
    expect(isFuzzyTokenMatch('tea', 'tee')).toBe(false);

    // Length >= 4 allows 1 edit
    expect(isFuzzyTokenMatch('eart', 'earth')).toBe(true);
    expect(isFuzzyTokenMatch('pirats', 'pirates')).toBe(true);
    expect(isFuzzyTokenMatch('spaceshp', 'spaceship')).toBe(true);
    expect(isFuzzyTokenMatch('tran', 'train')).toBe(true);

    // Prefix match
    expect(isFuzzyTokenMatch('space', 'spaceship')).toBe(true);

    // More than 1 edit returns false
    expect(isFuzzyTokenMatch('spcshp', 'spaceship')).toBe(false);
  });
});

describe('Curated Experience Aliases & Acronyms', () => {
  it('matches major Disney World headliner acronyms with score 85 (alias_exact)', () => {
    const acronymCases: [string, SearchableExperience][] = [
      ['rotr', EXP_ROTR],
      ['sdd', EXP_SDD],
      ['7dmt', EXP_7DMT],
      ['sdmt', EXP_7DMT],
      ['tot', EXP_TOT],
      ['fop', EXP_FOP],
      ['gotg', EXP_GOTG],
      ['tta', EXP_PEOPLE_MOVER],
      ['potc', EXP_PIRATES],
    ];

    for (const [query, exp] of acronymCases) {
      const normQ = normalizeSearchText(query);
      const res = scoreExperienceSearch(exp, normQ, tokenizeSearchQuery(query));
      expect(res.score, `Query "${query}" for "${exp.name}" should score 85`).toBe(85);
      expect(res.tier).toBe('alias_exact');
    }
  });

  it('matches common colloquial nicknames with score 85 (alias_exact)', () => {
    const nicknameCases: [string, SearchableExperience][] = [
      ['people mover', EXP_PEOPLE_MOVER],
      ['peoplemover', EXP_PEOPLE_MOVER],
      ['mine train', EXP_7DMT],
      ['tea cups', EXP_MAD_TEA_PARTY],
      ['cosmic rewind', EXP_GOTG],
      ['tower of terror', EXP_TOT],
    ];

    for (const [query, exp] of nicknameCases) {
      const normQ = normalizeSearchText(query);
      const res = scoreExperienceSearch(exp, normQ, tokenizeSearchQuery(query));
      expect(res.score, `Nickname "${query}" for "${exp.name}" should score 85`).toBe(85);
      expect(res.tier).toBe('alias_exact');
    }
  });

  it('matches multi-target aliases like "dole whip" across all associated venues', () => {
    const query = 'dole whip';
    const normQ = normalizeSearchText(query);
    const tokens = tokenizeSearchQuery(query);

    const rAloha = scoreExperienceSearch(EXP_ALOHA_ISLE, normQ, tokens);
    const rLanai = scoreExperienceSearch(EXP_PINEAPPLE_LANAI, normQ, tokens);
    const rSunshine = scoreExperienceSearch(EXP_SUNSHINE_TREE, normQ, tokens);

    expect(rAloha).toEqual({ score: 85, tier: 'alias_exact' });
    expect(rLanai).toEqual({ score: 85, tier: 'alias_exact' });
    expect(rSunshine).toEqual({ score: 85, tier: 'alias_exact' });

    const results = filterAndRankExperiences(
      [EXP_SUNSHINE_TREE, EXP_ALOHA_ISLE, EXP_PINEAPPLE_LANAI],
      query,
    );
    expect(results.map((r) => r.name)).toEqual([
      'Aloha Isle',
      'Pineapple Lanai',
      'Sunshine Tree Terrace',
    ]);
  });

  it('matches alias prefixes with score 70 (alias_phrase)', () => {
    // "rot" is prefix of "rotr" (length >= 3)
    const resRot = scoreExperienceSearch(
      EXP_ROTR,
      normalizeSearchText('rot'),
      tokenizeSearchQuery('rot'),
    );
    expect(resRot).toEqual({ score: 70, tier: 'alias_phrase' });

    // "people" is prefix of "people mover" (length >= 3)
    const resPeople = scoreExperienceSearch(
      EXP_PEOPLE_MOVER,
      normalizeSearchText('people'),
      tokenizeSearchQuery('people'),
    );
    expect(resPeople).toEqual({ score: 70, tier: 'alias_phrase' });

    // query containing full alias phrase "dole whip"
    const resFull = scoreExperienceSearch(
      EXP_ALOHA_ISLE,
      normalizeSearchText('great dole whip treats'),
      tokenizeSearchQuery('great dole whip treats'),
    );
    expect(resFull).toEqual({ score: 70, tier: 'alias_phrase' });
  });
});

describe('Fuzzy Typo Tolerance Scoring', () => {
  it('assigns 35 to 1-edit typo queries on attractions with token length >= 4', () => {
    const typoCases: [string, SearchableExperience][] = [
      ['spaceshp eart', EXP_SPACESHIP_EARTH],
      ['pirats', EXP_PIRATES],
      ['mine tran', EXP_7DMT],
      ['flight of pasage', EXP_FOP],
    ];

    for (const [query, exp] of typoCases) {
      const normQ = normalizeSearchText(query);
      const res = scoreExperienceSearch(exp, normQ, tokenizeSearchQuery(query));
      expect(res.score, `Typo "${query}" for "${exp.name}" should score 35`).toBe(35);
      expect(res.tier).toBe('fuzzy');
    }
  });

  it('does NOT match fuzzily when token length < 4', () => {
    // "tot" vs "top" is 3 letters -> no fuzzy match
    const expTop: SearchableExperience = {
      id: 'top-id',
      name: 'Top of the World Lounge',
    };
    const normQ = normalizeSearchText('tot');
    const res = scoreExperienceSearch(expTop, normQ, tokenizeSearchQuery('tot'));
    expect(res.score).not.toBe(35);
  });

  it('does NOT match fuzzily when edit distance > 1', () => {
    // "spcshp" has 2 deletions from "spaceship"
    const normQ = normalizeSearchText('spcshp');
    const res = scoreExperienceSearch(EXP_SPACESHIP_EARTH, normQ, tokenizeSearchQuery('spcshp'));
    expect(res.score).toBe(0);
  });
});

describe('Search Ranking Hierarchy Integration', () => {
  it('ranks exact name > exact alias > prefix > phrase > tokens > fuzzy > metadata', () => {
    const expExact: SearchableExperience = { id: '1', name: 'Rise' };
    const expAlias: SearchableExperience = { id: '2', name: 'Star Wars: Rise of the Resistance' }; // matches 'rise' as exact alias
    const expPrefix: SearchableExperience = { id: '3', name: 'Rise and Shine Cafe' };
    const expPhrase: SearchableExperience = { id: '4', name: 'The Moon Rise Over Lake' };

    const pool = [expPhrase, expPrefix, expAlias, expExact];
    const ranked = filterAndRankExperiences(pool, 'rise');

    expect(ranked[0]?.id).toBe('1'); // score 100
    expect(ranked[1]?.id).toBe('2'); // score 85 (alias exact)
    expect(ranked[2]?.id).toBe('3'); // score 80 (prefix)
    expect(ranked[3]?.id).toBe('4'); // score 60 (phrase)
  });

  it('ranks fuzzy name match ahead of metadata fallback match', () => {
    const expFuzzy: SearchableExperience = {
      id: 'fuzz-1',
      name: 'Spaceship Earth',
      land: 'World Celebration',
    };
    const expMeta: SearchableExperience = {
      id: 'meta-1',
      name: 'The Seas with Nemo & Friends',
      land: 'Spaceshp Pavilion', // contains query token in metadata
    };

    const ranked = filterAndRankExperiences([expMeta, expFuzzy], 'spaceshp');
    expect(ranked[0]?.id).toBe('fuzz-1'); // score 35 beats score 20
    expect(ranked[1]?.id).toBe('meta-1'); // score 20
  });
});
