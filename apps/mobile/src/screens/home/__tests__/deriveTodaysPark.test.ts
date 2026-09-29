import type { ExperienceDTO, PlannedItemDTO, TripDTO } from '@dwt/shared';
import { deriveTodaysPark } from '../deriveTodaysPark';

describe('deriveTodaysPark', () => {
  const todayStr = '2026-09-18';
  const yesterdayStr = '2026-09-17';
  const tomorrowStr = '2026-09-19';

  const makeTrip = (overrides?: Partial<TripDTO>): TripDTO => ({
    id: 'trip-1',
    name: 'Walt Disney World Vacation',
    description: '',
    startDate: yesterdayStr,
    endDate: '2026-09-27',
    status: 'active',
    createdAt: '2026-09-17T00:00:00.000Z',
    resorts: [],
    foodLists: [],
    experienceLists: [],
    ...overrides,
  });

  const makePlannedItem = (overrides?: Partial<PlannedItemDTO>): PlannedItemDTO => ({
    id: 'pi-1',
    experienceId: null,
    experienceName: null,
    park: null,
    customTitle: null,
    addedByDisplayName: 'User',
    plannedDate: todayStr,
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 1,
    itemType: 'experience',
    durationMinutes: 30,
    catalogDurationMinutes: null,
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    reservationKind: null,
    confirmationNumber: null,
    partySize: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
    ...overrides,
  });

  const makeExperience = (overrides?: Partial<ExperienceDTO>): ExperienceDTO => ({
    id: 'exp-1',
    name: 'Experience Name',
    park: 'EPCOT',
    category: 'Ride',
    description: '',
    active: true,
    imageUrl: null,
    areaType: 'ThemePark',
    ...overrides,
  });

  it('returns park from a planned item scheduled for today', () => {
    const plannedItems: PlannedItemDTO[] = [
      makePlannedItem({
        id: 'pi-1',
        experienceId: 'exp-1',
        experienceName: "Remy's Ratatouille Adventure",
        park: 'EPCOT',
        plannedDate: todayStr,
        plannedTime: '2026-09-18T13:00:00.000Z',
      }),
    ];

    const result = deriveTodaysPark({
      activeTrip: makeTrip(),
      plannedItems,
      todayStr,
    });
    expect(result).toBe('EPCOT');
  });

  it('resolves park from catalog experiencesById for today item lacking direct park field', () => {
    const plannedItems: PlannedItemDTO[] = [
      makePlannedItem({
        id: 'pi-1',
        experienceId: 'exp-slinky',
        experienceName: 'Slinky Dog Dash',
        park: null,
        plannedDate: todayStr,
      }),
    ];

    const experiencesById = new Map<string, ExperienceDTO>([
      [
        'exp-slinky',
        makeExperience({
          id: 'exp-slinky',
          name: 'Slinky Dog Dash',
          park: 'Hollywood Studios',
        }),
      ],
    ]);

    const result = deriveTodaysPark({
      activeTrip: makeTrip(),
      plannedItems,
      todayStr,
      experiencesById,
    });
    expect(result).toBe('Hollywood Studios');
  });

  it('does NOT bleed previous or future day planned items into today when today has no items', () => {
    const plannedItems: PlannedItemDTO[] = [
      makePlannedItem({
        id: 'pi-yesterday',
        experienceId: 'exp-epcot',
        experienceName: "Remy's Ratatouille Adventure",
        park: 'EPCOT',
        plannedDate: yesterdayStr,
        plannedTime: '2026-09-17T13:00:00.000Z',
      }),
      makePlannedItem({
        id: 'pi-tomorrow',
        experienceId: 'exp-ak',
        experienceName: 'Flight of Passage',
        park: 'Animal Kingdom',
        plannedDate: tomorrowStr,
        plannedTime: '2026-09-19T10:00:00.000Z',
      }),
    ];

    // Case 1: Today has a startingPark configured in dayTouringHours
    const tripWithStartingPark = makeTrip({
      dayTouringHours: {
        [todayStr]: { startingPark: 'Hollywood Studios' },
      },
    });

    const resultWithTouringHours = deriveTodaysPark({
      activeTrip: tripWithStartingPark,
      plannedItems,
      todayStr,
    });
    // Should NOT be EPCOT (yesterday) or Animal Kingdom (tomorrow); should respect today's startingPark
    expect(resultWithTouringHours).toBe('Hollywood Studios');

    // Case 2: Today has NO startingPark configured either
    const tripWithoutStartingPark = makeTrip({
      dayTouringHours: {},
    });

    const resultWithoutTouringHours = deriveTodaysPark({
      activeTrip: tripWithoutStartingPark,
      plannedItems,
      todayStr,
    });
    // Must default to Magic Kingdom, NEVER yesterday's EPCOT
    expect(resultWithoutTouringHours).toBe('Magic Kingdom');
  });

  it('falls back to Magic Kingdom when no items and no touring hours exist', () => {
    const result = deriveTodaysPark({
      activeTrip: makeTrip(),
      plannedItems: [],
      todayStr,
    });
    expect(result).toBe('Magic Kingdom');
  });
});
