import { describe, expect, it } from '@jest/globals';
import { EXPERIENCE_CATEGORIES, type ExperienceCategory, type ExperienceDTO } from '@dwt/shared';
import { TAB_CATEGORIES } from '../../trips/experiencePickerFilters';
import { groupByCategory } from '../catalogGrouping';
import { categoryVisual } from '../../../theme/theme';
import { buildCategoryTiles } from '../../stats/statsView';

describe('Consumer Surfaces Taxonomy Extension (Task 7.3, Requirements 6.1-6.6)', () => {
  it('Requirement 6.1: TAB_CATEGORIES.attractions includes Walkthrough, PlayArea, and Game alongside Ride', () => {
    const attractions = TAB_CATEGORIES.attractions;
    expect(attractions).toContain('Ride');
    expect(attractions).toContain('Walkthrough');
    expect(attractions).toContain('PlayArea');
    expect(attractions).toContain('Game');
  });

  it('Requirement 6.2: groupByCategory orders sections in canonical EXPERIENCE_CATEGORIES order and omits empty categories', () => {
    const experiences: ExperienceDTO[] = [
      {
        id: '1',
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        land: 'Tomorrowland',
        description: 'High-speed roller coaster',
        active: true,
        imageUrl: null,
      },
      {
        id: '2',
        name: 'Swiss Family Treehouse',
        park: 'Magic Kingdom',
        category: 'Walkthrough',
        areaType: 'ThemePark',
        land: 'Adventureland',
        description: 'Treehouse walkthrough',
        active: true,
        imageUrl: null,
      },
      {
        id: '3',
        name: 'Dumbo Play Area',
        park: 'Magic Kingdom',
        category: 'PlayArea',
        areaType: 'ThemePark',
        land: 'Fantasyland',
        description: 'Play area for kids',
        active: true,
        imageUrl: null,
      },
      {
        id: '4',
        name: 'A Pirate’s Adventure',
        park: 'Magic Kingdom',
        category: 'Game',
        areaType: 'ThemePark',
        land: 'Adventureland',
        description: 'Interactive treasure hunt game',
        active: true,
        imageUrl: null,
      },
    ];

    const grouped = groupByCategory(experiences);
    const categoryKeys = grouped.map((g) => g.key);

    // Only non-empty categories are present
    expect(categoryKeys).toEqual(['Ride', 'Walkthrough', 'PlayArea', 'Game']);

    // Order matches canonical EXPERIENCE_CATEGORIES order
    const indices = categoryKeys.map((k) => EXPERIENCE_CATEGORIES.indexOf(k as ExperienceCategory));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it('Requirement 2.9, 6.6: Category visuals and distinct labels for Walkthrough, PlayArea, and Game', () => {
    const newCategories: ExperienceCategory[] = ['Walkthrough', 'PlayArea', 'Game'];
    for (const cat of newCategories) {
      const visual = categoryVisual[cat];
      expect(visual).toBeDefined();
      expect(visual.label).toBeTruthy();
      expect(visual.glyph).toBeTruthy();
      expect(visual.tint).toBeTruthy();
      expect(visual.label).not.toBe('Ride');
    }
  });

  it('Requirement 6.5: stats category coverage includes Walkthrough, PlayArea, and Game', () => {
    const dummyCell = { total: 5, completed: 2, percent: 40.0, remaining: 3, completeBadge: false };
    const byCategory: any = {};
    for (const cat of EXPERIENCE_CATEGORIES) {
      byCategory[cat] = dummyCell;
    }
    const tiles = buildCategoryTiles(byCategory);
    const categoryKeys = tiles.map((t) => t.key);
    expect(categoryKeys).toContain('Walkthrough');
    expect(categoryKeys).toContain('PlayArea');
    expect(categoryKeys).toContain('Game');

    const walkthroughTile = tiles.find((t) => t.key === 'Walkthrough');
    expect(walkthroughTile?.title).toBe('Walkthrough');

    const playAreaTile = tiles.find((t) => t.key === 'PlayArea');
    expect(playAreaTile?.title).toBe('Play Area');

    const gameTile = tiles.find((t) => t.key === 'Game');
    expect(gameTile?.title).toBe('Game');
  });
});
