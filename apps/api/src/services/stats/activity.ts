/**
 * Stats_Service — Activity & Repeat Statistics pure roll-up.
 *
 * Implements pure roll-up of activity volume, podium, and personal records
 * for the Stats_Service. Free of I/O, database dependencies, or side effects.
 *
 * Validates: Requirements 18.1–18.7, 19.1–19.3, 20.1–20.6
 */

import type {
  ActivityStatistics,
  MostRiddenAttraction,
  PersonalRecords,
  Park,
} from '@dwt/shared';

export interface RawActivityVolumeRow {
  readonly totalLogs: number;
  readonly distinctParkDays: number;
  readonly uniqueLoggedExperiences: number;
}

export interface RawMostRiddenRow {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly count: number;
}

export interface RawProductiveDayRow {
  readonly date: string;
  readonly rideCount: number;
  readonly parks: readonly Park[];
}

export interface RawMarathonRecordRow {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly date: string;
  readonly count: number;
}

export interface RawActivityMaterial {
  readonly volume: RawActivityVolumeRow;
  readonly mostRidden: readonly RawMostRiddenRow[];
  readonly mostProductiveDay: RawProductiveDayRow | null;
  readonly marathonRecord: RawMarathonRecordRow | null;
}

export const EMPTY_ACTIVITY_MATERIAL: RawActivityMaterial = {
  volume: {
    totalLogs: 0,
    distinctParkDays: 0,
    uniqueLoggedExperiences: 0,
  },
  mostRidden: [],
  mostProductiveDay: null,
  marathonRecord: null,
};

/**
 * Pure roll-up of activity volume, podium, and personal records.
 */
export function rollUpActivity(raw: RawActivityMaterial): ActivityStatistics {
  const { totalLogs, distinctParkDays, uniqueLoggedExperiences } = raw.volume;

  const averageRidesPerDay =
    distinctParkDays > 0
      ? Number((totalLogs / distinctParkDays).toFixed(1))
      : 0.0;

  const repeatMultiplier =
    uniqueLoggedExperiences > 0
      ? Math.max(1.0, Number((totalLogs / uniqueLoggedExperiences).toFixed(1)))
      : 1.0;

  if (totalLogs === 0) {
    return {
      totalLogs: 0,
      distinctParkDays: 0,
      repeatMultiplier: 1.0,
      averageRidesPerDay: 0.0,
      mostRidden: [],
      personalRecords: {},
    };
  }

  const mostRidden: MostRiddenAttraction[] = raw.mostRidden.slice(0, 5).map((row) => ({
    experienceId: row.experienceId,
    experienceName: row.experienceName,
    park: row.park,
    count: row.count,
  }));

  const personalRecords: PersonalRecords = {
    ...(raw.mostProductiveDay
      ? {
          mostProductiveDay: {
            date: raw.mostProductiveDay.date,
            rideCount: raw.mostProductiveDay.rideCount,
            parks: raw.mostProductiveDay.parks.filter(
              (p): p is Park => p !== null && p !== undefined,
            ),
          },
        }
      : {}),
    ...(raw.marathonRecord
      ? {
          marathonRecord: {
            experienceId: raw.marathonRecord.experienceId,
            experienceName: raw.marathonRecord.experienceName,
            date: raw.marathonRecord.date,
            count: raw.marathonRecord.count,
          },
        }
      : {}),
  };

  return {
    totalLogs,
    distinctParkDays,
    repeatMultiplier,
    averageRidesPerDay,
    mostRidden,
    personalRecords,
  };
}
