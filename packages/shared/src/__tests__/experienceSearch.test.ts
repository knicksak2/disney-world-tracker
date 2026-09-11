import { describe, expect, it } from 'vitest';

import {
  MAX_METADATA_FALLBACK_ROWS,
  filterAndRankExperiences,
  normalizeSearchText,
  scoreExperienceSearch,
  tokenizeSearchQuery,
  type SearchableExperience,
} from '../search/experienceSearch.js';

describe('normalizeSearchText', () => {
  it('converts to lowercase and trims whitespace', () => {
    expect(normalizeSearchText('  Space Mountain  ')).toBe('space mountain');
  });

  it('folds accents and diacritics using NFD', () => {
    expect(normalizeSearchText('San Ángel Inn Restaurante')).toBe(
      'san angel inn restaurante',
    );
    expect(normalizeSearchText('Crêpes À Emporter')).toBe('crepes a emporter');
    expect(normalizeSearchText('Les Halles Boulangerie-Pâtisserie')).toBe(
      'les halles boulangerie patisserie',
    );
  });

  it('normalizes ampersands and connectors to standard "and" without fusing words', () => {
    expect(normalizeSearchText("Mickey & Minnie's Runaway Railway")).toBe(
      'mickey and minnies runaway railway',
    );
    expect(normalizeSearchText('Yak & Yeti™ Restaurant')).toBe(
      'yak and yeti restaurant',
    );
    expect(normalizeSearchText('A & B & C')).toBe('a and b and c');
    expect(normalizeSearchText('A + B')).toBe('a and b');
  });

  it('normalizes standalone "n" and "\'n\'" to "and"', () => {
    expect(normalizeSearchText("Rock 'n' Roller Coaster")).toBe(
      'rock and roller coaster',
    );
    expect(normalizeSearchText("Rock 'n Roller Coaster")).toBe(
      'rock and roller coaster',
    );
    expect(normalizeSearchText("Rock n' Roller Coaster")).toBe(
      'rock and roller coaster',
    );
    expect(normalizeSearchText('Rock n Roller Coaster')).toBe(
      'rock and roller coaster',
    );
  });

  it('strips straight quotes, smart apostrophes, okina, and modifier apostrophes completely', () => {
    expect(normalizeSearchText("Peter Pan's Flight")).toBe('peter pans flight');
    expect(normalizeSearchText('Peter Pan’s Flight')).toBe('peter pans flight');
    expect(normalizeSearchText('‘Ohana')).toBe('ohana');
    expect(normalizeSearchText('ʻOhana')).toBe('ohana');
    expect(normalizeSearchText("Satu'li Canteen")).toBe('satuli canteen');
    expect(normalizeSearchText('50’s Prime Time Café')).toBe(
      '50s prime time cafe',
    );
  });

  it('replaces non-alphanumeric punctuation and symbols with space', () => {
    expect(normalizeSearchText('TRON Lightcycle / Run')).toBe(
      'tron lightcycle run',
    );
    expect(normalizeSearchText('Star Wars: Rise of the Resistance')).toBe(
      'star wars rise of the resistance',
    );
    expect(normalizeSearchText('Toy Story Mania!')).toBe('toy story mania');
    expect(normalizeSearchText('The Twilight Zone Tower of Terror™')).toBe(
      'the twilight zone tower of terror',
    );
  });
});

describe('tokenizeSearchQuery', () => {
  it('extracts non-empty normalized tokens', () => {
    expect(tokenizeSearchQuery('  Mickey & Minnie  ')).toEqual([
      'mickey',
      'and',
      'minnie',
    ]);
    expect(tokenizeSearchQuery("Peter Pan's")).toEqual([
      'peter',
      'pans',
    ]);
  });
});

describe('scoreExperienceSearch', () => {
  const EXP_RUNAWAY: SearchableExperience = {
    id: 'exp-1',
    name: "Mickey & Minnie's Runaway Railway",
  };
  const EXP_PETER: SearchableExperience = {
    id: 'exp-2',
    name: "Peter Pan's Flight",
  };
  const EXP_ROCK: SearchableExperience = {
    id: 'exp-3',
    name: "Rock 'n' Roller Coaster Starring Aerosmith",
  };
  const EXP_SAN_ANGEL: SearchableExperience = {
    id: 'exp-4',
    name: 'San Ángel Inn Restaurante',
  };
  const EXP_TRON: SearchableExperience = {
    id: 'exp-5',
    name: 'TRON Lightcycle / Run',
  };
  const EXP_STAR_WARS: SearchableExperience = {
    id: 'exp-6',
    name: 'Star Wars: Rise of the Resistance',
    land: "Star Wars: Galaxy's Edge",
  };
  const EXP_OHANA: SearchableExperience = {
    id: 'exp-7',
    name: '‘Ohana',
  };

  it('assigns 100 to exact normalized name match', () => {
    const q = 'Peter Pans Flight';
    const res = scoreExperienceSearch(
      EXP_PETER,
      normalizeSearchText(q),
      tokenizeSearchQuery(q),
    );
    expect(res).toEqual({ score: 100, tier: 'exact' });
  });

  it('assigns 80 to name prefix match', () => {
    const q = 'Mickey and Minnie';
    const res = scoreExperienceSearch(
      EXP_RUNAWAY,
      normalizeSearchText(q),
      tokenizeSearchQuery(q),
    );
    expect(res).toEqual({ score: 80, tier: 'prefix' });
  });

  it('assigns 60 to contiguous phrase in name (mid-token and multi-word)', () => {
    const q1 = 'cycle';
    const res1 = scoreExperienceSearch(
      EXP_TRON,
      normalizeSearchText(q1),
      tokenizeSearchQuery(q1),
    );
    expect(res1).toEqual({ score: 60, tier: 'phrase' });

    const q2 = 'Roller Coaster';
    const res2 = scoreExperienceSearch(
      EXP_ROCK,
      normalizeSearchText(q2),
      tokenizeSearchQuery(q2),
    );
    expect(res2).toEqual({ score: 60, tier: 'phrase' });
  });

  it('assigns 40 to prefix-token matches', () => {
    // "Mickey Minnie" -> [mickey, minnie], minnie prefix-matches minnies
    const q = 'Mickey Minnie';
    const res = scoreExperienceSearch(
      EXP_RUNAWAY,
      normalizeSearchText(q),
      tokenizeSearchQuery(q),
    );
    expect(res).toEqual({ score: 40, tier: 'tokens' });
  });

  it('matches Okina/accent variants', () => {
    const q1 = 'Ohana';
    const res1 = scoreExperienceSearch(
      EXP_OHANA,
      normalizeSearchText(q1),
      tokenizeSearchQuery(q1),
    );
    expect(res1.score).toBeGreaterThanOrEqual(80);

    const q2 = 'San Angel';
    const res2 = scoreExperienceSearch(
      EXP_SAN_ANGEL,
      normalizeSearchText(q2),
      tokenizeSearchQuery(q2),
    );
    expect(res2.score).toBeGreaterThanOrEqual(80);
  });

  it('assigns 20 to metadata fallback matches when name does not match', () => {
    const q = "Galaxy's Edge";
    const res = scoreExperienceSearch(
      EXP_STAR_WARS,
      normalizeSearchText(q),
      tokenizeSearchQuery(q),
    );
    expect(res).toEqual({ score: 20, tier: 'metadata' });
  });
});

describe('filterAndRankExperiences', () => {
  const experiences: readonly SearchableExperience[] = [
    { id: '1', name: "Mickey & Minnie's Runaway Railway" },
    { id: '2', name: "Peter Pan's Flight" },
    { id: '3', name: "Rock 'n' Roller Coaster Starring Aerosmith" },
    { id: '4', name: 'San Ángel Inn Restaurante' },
    { id: '5', name: 'TRON Lightcycle / Run' },
    { id: '6', name: 'Space Mountain' },
    { id: '7', name: 'Seven Dwarfs Mine Train' },
    { id: '8', name: 'Yak & Yeti™ Restaurant' },
    {
      id: '9',
      name: 'Star Wars: Rise of the Resistance',
      land: "Star Wars: Galaxy's Edge",
    },
    {
      id: '10',
      name: 'Impressions de France',
      worldShowcaseCountry: 'France',
    },
    {
      id: '11',
      name: 'Chefs de France',
      worldShowcaseCountry: 'France',
    },
    {
      id: '12',
      name: 'Les Halles Boulangerie-Pâtisserie',
      worldShowcaseCountry: 'France',
    },
  ];

  it('matches "Mickey and Minnie" to Runaway Railway as #1', () => {
    const results = filterAndRankExperiences(experiences, 'Mickey and Minnie');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('1');
  });

  it('matches "Yak and Yeti" to Yak & Yeti™ Restaurant', () => {
    const results = filterAndRankExperiences(experiences, 'Yak and Yeti');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('8');
  });

  it('matches "Rock n Roller" and "Rock and Roller" to Rock \'n\' Roller Coaster', () => {
    const res1 = filterAndRankExperiences(experiences, 'Rock n Roller');
    expect(res1.length).toBeGreaterThan(0);
    expect(res1[0]?.id).toBe('3');

    const res2 = filterAndRankExperiences(experiences, 'Rock and Roller');
    expect(res2.length).toBeGreaterThan(0);
    expect(res2[0]?.id).toBe('3');
  });

  it('matches "Peter Pans Flight" and "Peter Pan Flight" to Peter Pan\'s Flight', () => {
    const res1 = filterAndRankExperiences(experiences, 'Peter Pans Flight');
    expect(res1.length).toBeGreaterThan(0);
    expect(res1[0]?.id).toBe('2');

    const res2 = filterAndRankExperiences(experiences, 'Peter Pan Flight');
    expect(res2.length).toBeGreaterThan(0);
    expect(res2[0]?.id).toBe('2');
  });

  it('matches "San Angel Inn" to San Ángel Inn Restaurante', () => {
    const results = filterAndRankExperiences(experiences, 'San Angel Inn');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('4');
  });

  it('matches mid-token substring "cycle" to TRON Lightcycle / Run', () => {
    const results = filterAndRankExperiences(experiences, 'cycle');
    expect(results.some((r) => r.id === '5')).toBe(true);
  });

  it('matches prefix token "Space M" to Space Mountain', () => {
    const results = filterAndRankExperiences(experiences, 'Space M');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe('6');
  });

  it('matches "France" with name match first (Impressions de France, Chefs de France) followed by country fallback (Les Halles)', () => {
    const results = filterAndRankExperiences(experiences, 'France');
    expect(results.length).toBeGreaterThanOrEqual(3);
    // Name matches must precede metadata fallback match
    const ids = results.map((r) => r.id);
    expect(ids.indexOf('10')).toBeLessThan(ids.indexOf('12'));
    expect(ids.indexOf('11')).toBeLessThan(ids.indexOf('12'));
  });

  it('caps metadata-only matches at MAX_METADATA_FALLBACK_ROWS (25) and sorts by name ascending', () => {
    const largePool: SearchableExperience[] = [];
    for (let i = 0; i < 40; i++) {
      const pad = String(i).padStart(2, '0');
      largePool.push({
        id: `meta-${pad}`,
        name: `Venue ${pad}`,
        land: 'Adventureland',
      });
    }

    const results = filterAndRankExperiences(largePool, 'Adventureland');
    expect(results.length).toBe(MAX_METADATA_FALLBACK_ROWS);
    // Ensure sorted by name ascending
    for (let i = 1; i < results.length; i++) {
      expect(
        results[i - 1]!.name.localeCompare(results[i]!.name),
      ).toBeLessThanOrEqual(0);
    }
  });

  it('returns experiences unmodified when query is empty or whitespace', () => {
    expect(filterAndRankExperiences(experiences, '')).toBe(experiences);
    expect(filterAndRankExperiences(experiences, '   \t  ')).toBe(experiences);
  });

  describe('enriched metadata matching (lands, facets, pavilions, accessibility)', () => {
    const metaTestPool: SearchableExperience[] = [
      {
        id: 'space-mtn',
        name: 'Space Mountain',
        land: 'Tomorrowland',
        subType: 'Roller Coaster',
        groupedFacets: {
          thrillFactor: [
            { id: 'thrill', name: 'Thrill Rides' },
            { id: 'big-drops', name: 'Big Drops' },
          ],
          interests: [{ id: 'indoor', name: 'Indoor' }],
        },
        heightRequirement: {
          id: 'h-44in',
          name: '44 inches (112 cm) or taller',
          minInches: 44,
          minCentimeters: 112,
        },
        accessibility: ['Must Transfer from Wheelchair'],
      },
      {
        id: 'peter-pan',
        name: "Peter Pan's Flight",
        land: 'Fantasyland',
        groupedFacets: {
          thrillFactor: [{ id: 'slow-rides', name: 'Slow Rides' }],
          interests: [{ id: 'classics', name: 'Disney Classics' }],
        },
        physicalConsiderations: [
          { id: 'pc-expectant', name: 'Expectant Mothers Advisory' },
        ],
      },
      {
        id: 'cinderella-table',
        name: "Cinderella's Royal Table",
        land: 'Fantasyland',
        groupedFacets: {
          diningInterests: [{ id: 'opq-char-dining', name: 'Character Dining' }],
          cuisine: [{ id: 'american', name: 'American' }],
        },
      },
      {
        id: 'san-angel',
        name: 'San Ángel Inn Restaurante',
        land: 'World Showcase',
        worldShowcaseCountry: 'Mexico',
        groupedFacets: {
          cuisine: [{ id: 'mexican', name: 'Mexican' }],
          dining: [{ id: 'table-service', name: 'Table Service' }],
        },
        accessibility: ['Audio Description', 'Handheld Captioning'],
      },
      {
        id: 'dino-spin',
        name: 'TriceraTop Spin',
        land: 'DinoLand U.S.A.',
        groupedFacets: {
          thrillFactor: [{ id: 'spinning', name: 'Spinning' }],
        },
      },
      {
        id: 'rise-resistance',
        name: 'Star Wars: Rise of the Resistance',
        land: "Star Wars: Galaxy's Edge",
        interestFacets: {
          franchise: [{ id: 'star-wars', name: 'Star Wars' }],
        },
      },
    ];

    it('matches compound land names when queried with spaces ("fantasy land" -> "Fantasyland")', () => {
      const res = filterAndRankExperiences(metaTestPool, 'fantasy land');
      expect(res.map((r) => r.id)).toEqual(['cinderella-table', 'peter-pan']);
    });

    it('matches compound land names when queried with spaces ("tomorrow land" -> "Tomorrowland")', () => {
      const res = filterAndRankExperiences(metaTestPool, 'tomorrow land');
      expect(res.map((r) => r.id)).toEqual(['space-mtn']);
    });

    it('matches compound land names when queried with spaces ("dino land" -> "DinoLand U.S.A.")', () => {
      const res = filterAndRankExperiences(metaTestPool, 'dino land');
      expect(res.map((r) => r.id)).toEqual(['dino-spin']);
    });

    it('matches facet names: thrillFactor ("thrill", "big drops", "spinning")', () => {
      const thrillHits = filterAndRankExperiences(metaTestPool, 'thrill');
      expect(thrillHits.some((r) => r.id === 'space-mtn')).toBe(true);

      const dropsHits = filterAndRankExperiences(metaTestPool, 'big drops');
      expect(dropsHits.map((r) => r.id)).toEqual(['space-mtn']);

      const spinHits = filterAndRankExperiences(metaTestPool, 'spinning');
      expect(spinHits.map((r) => r.id)).toEqual(['dino-spin']);
    });

    it('matches facet names: dining & cuisine ("character dining", "mexican", "table service")', () => {
      const charHits = filterAndRankExperiences(
        metaTestPool,
        'character dining',
      );
      expect(charHits.map((r) => r.id)).toEqual(['cinderella-table']);

      const mexicanHits = filterAndRankExperiences(metaTestPool, 'mexican');
      expect(mexicanHits.map((r) => r.id)).toEqual(['san-angel']);

      const tableHits = filterAndRankExperiences(metaTestPool, 'table service');
      expect(tableHits.map((r) => r.id)).toEqual(['san-angel']);
    });

    it('matches interest facets ("star wars")', () => {
      const starWarsHits = filterAndRankExperiences(metaTestPool, 'star wars');
      expect(starWarsHits.some((r) => r.id === 'rise-resistance')).toBe(true);
    });

    it('matches physical considerations ("expectant mothers")', () => {
      const expectantHits = filterAndRankExperiences(
        metaTestPool,
        'expectant mothers',
      );
      expect(expectantHits.map((r) => r.id)).toEqual(['peter-pan']);
    });

    it('matches height requirements ("44 inches")', () => {
      const heightHits = filterAndRankExperiences(metaTestPool, '44 inches');
      expect(heightHits.map((r) => r.id)).toEqual(['space-mtn']);
    });

    it('matches accessibility tags ("audio description", "wheelchair")', () => {
      const audioHits = filterAndRankExperiences(
        metaTestPool,
        'audio description',
      );
      expect(audioHits.map((r) => r.id)).toEqual(['san-angel']);

      const wheelchairHits = filterAndRankExperiences(metaTestPool, 'wheelchair');
      expect(wheelchairHits.map((r) => r.id)).toEqual(['space-mtn']);
    });

    it('does NOT match opaque facet IDs (e.g. "pc-expectant", "h-44in", "opq-char-dining")', () => {
      expect(filterAndRankExperiences(metaTestPool, 'pc-expectant')).toHaveLength(
        0,
      );
      expect(filterAndRankExperiences(metaTestPool, 'h-44in')).toHaveLength(0);
      expect(
        filterAndRankExperiences(metaTestPool, 'opq-char-dining'),
      ).toHaveLength(0);
    });

    it('keeps worldShowcaseCountry matched as plain text without spurious suffix splitting', () => {
      const mexicoHits = filterAndRankExperiences(metaTestPool, 'Mexico');
      expect(mexicoHits.map((r) => r.id)).toEqual(['san-angel']);
    });
  });
});
