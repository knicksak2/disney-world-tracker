// Feature: first-run-onboarding, Property 6: Starter Rides Selection Determinism and Uniqueness

import fc from 'fast-check';
import type { ExperienceCategory, ExperienceDTO, Park } from '@dwt/shared';

import {
  STARTER_RIDES_MAX,
  normalizeRideTitle,
  selectStarterRides,
} from '../starterRides';

const NUM_RUNS = 120;

const PARKS: readonly (Park | null)[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
  null,
];

const CATEGORIES: readonly ExperienceCategory[] = [
  'Ride',
  'Show',
  'Restaurant',
  'Resort',
];

function makeExp(
  overrides: Partial<ExperienceDTO> & Pick<ExperienceDTO, 'id' | 'name'>,
): ExperienceDTO {
  return {
    park: 'Magic Kingdom',
    category: 'Ride',
    description: '',
    active: true,
    ...overrides,
  } as ExperienceDTO;
}

describe('Property 6: Starter Rides Selection Determinism and Uniqueness', () => {
  it('selects at most 12 unique active Rides deterministically regardless of input order', () => {
    const expArb = fc.record({
      id: fc.uuid(),
      name: fc.constantFrom(
        'Space Mountain',
        'Haunted Mansion',
        'Pirates of the Caribbean',
        'Soarin\u2019 Around the World',
        'Guardians of the Galaxy: Cosmic Rewind',
        'Spaceship Earth',
        'Star Wars: Rise of the Resistance',
        'The Twilight Zone Tower of Terror',
        'Slinky Dog Dash',
        'Avatar Flight of Passage',
        'Expedition Everest \u2014 Legend',
        'Kilimanjaro Safaris',
        'Jungle Cruise',
        'Big Thunder Mountain Railroad',
        'Test Track',
        'Frozen Ever After',
        'Remy\u2019s Ratatouille Adventure',
      ),
      park: fc.constantFrom(...PARKS),
      category: fc.constantFrom(...CATEGORIES),
      active: fc.boolean(),
    });

    fc.assert(
      fc.property(fc.array(expArb, { maxLength: 35 }), (raw) => {
        const catalog: ExperienceDTO[] = raw.map((r) =>
          makeExp({
            id: r.id,
            name: r.name,
            park: r.park,
            category: r.category,
            active: r.active,
          }),
        );

        const first = selectStarterRides(catalog);
        const second = selectStarterRides([...catalog].reverse());

        expect(first.length).toBeLessThanOrEqual(STARTER_RIDES_MAX);
        expect(first).toEqual(second);

        const seenIds = new Set<string>();
        for (const item of first) {
          expect(item.active).toBe(true);
          expect(item.category).toBe('Ride');
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('normalizes curly apostrophes and en/em dashes identically and excludes inactive/non-Ride rows', () => {
    const catalog: ExperienceDTO[] = [
      makeExp({
        id: 'soarin-curly',
        name: 'Soarin\u2019 Around the World',
        park: 'EPCOT',
        category: 'Ride',
        active: true,
      }),
      makeExp({
        id: 'everest-emdash',
        name: 'Expedition Everest \u2014 Legend of the Forbidden Mountain',
        park: 'Animal Kingdom',
        category: 'Ride',
        active: true,
      }),
      makeExp({
        id: 'inactive-space',
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        active: false,
      }),
      makeExp({
        id: 'dining-space',
        name: 'Space 220 Restaurant',
        park: 'EPCOT',
        category: 'Restaurant',
        active: true,
      }),
      makeExp({
        id: 'resort-row',
        name: 'Disney\u2019s Polynesian Village Resort',
        park: null,
        category: 'Resort',
        active: true,
      }),
      makeExp({
        id: 'mk-backfill',
        name: 'Big Thunder Mountain Railroad',
        park: 'Magic Kingdom',
        category: 'Ride',
        active: true,
      }),
    ];

    expect(normalizeRideTitle('Soarin\u2019 Around the World')).toBe(
      normalizeRideTitle("Soarin' Around the World"),
    );
    expect(normalizeRideTitle('A \u2014 B')).toBe('a - b');

    const picked = selectStarterRides(catalog);
    const ids = picked.map((e) => e.id);
    expect(ids).toContain('soarin-curly');
    expect(ids).toContain('everest-emdash');
    expect(ids).toContain('mk-backfill');
    expect(ids).not.toContain('inactive-space');
    expect(ids).not.toContain('dining-space');
    expect(ids).not.toContain('resort-row');
  });
});
