/**
 * Feature: crowd-calendar, Property 18 — R18 wait prediction accuracy logging.
 *
 * Until these legs existed, wait-model accuracy was unmeasurable: the only way to
 * learn the error was to reconstruct a holdout by hand from raw samples, which
 * could only ever be retrospective. These tests pin the three behaviors that make
 * the measurement trustworthy rather than merely present:
 *
 *  1. A captured prediction is FROZEN — a later run cannot overwrite it, or
 *     accuracy would be scored against a number nobody was ever shown.
 *  2. Observed values come from `wait_archive`, so scoring survives the 30-day
 *     raw prune.
 *  3. A challenger's error is tallied SEPARATELY and never touches the served
 *     model's summary.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDerivedStatsService } from '../derivedStatsService.js';
import type { PredictionService } from '../predictionService.js';

const NOW = new Date('2026-08-26T12:00:00Z');
const PARK = 'Magic Kingdom';
const EXP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Hours the capture leg samples, per the design constants. */
const HOURS = [10, 13, 16, 19];
const LEADS = [7, 3, 1];

interface RepoState {
  waitForecastLogs: any[];
  waitForecastAccuracies: any[];
  reconciliationUpdates: any[];
  archiveHours: any[];
  pendingLogs: any[];
  topExperiences: any[];
  prunedBefore: Date | null;
}

function makeRepo(overrides: Partial<RepoState> = {}) {
  const state: RepoState = {
    waitForecastLogs: [],
    waitForecastAccuracies: [],
    reconciliationUpdates: [],
    archiveHours: [],
    pendingLogs: [],
    topExperiences: [{ experience_id: EXP_A, park: PARK, peak_baseline: 60 }],
    prunedBefore: null,
    ...overrides,
  };

  const repo = {
    // Legs unrelated to R18 are all no-ops so the run stays focused.
    getParkCrowdIndices: async () => [],
    getForecastLogsToReconcile: async () => [],
    getForecastAccuracies: async () => [],
    upsertForecastAccuracies: async () => {},
    upsertForecastLogs: async () => {},
    getRecentPercentiles: async () => [],
    getExperiencesWithUpstreamIds: async () => [],
    getRideShapes: async () => [],
    upsertRideShapes: async () => {},
    getWaitWeatherAggregates: async () => [],
    upsertWeatherSensitivities: async () => {},
    getTrailingShowtimeSignals: async () => [],
    upsertShowTimePatterns: async () => {},
    pruneStaleShowTimePatterns: async () => {},
    pruneWeatherObservations: async () => {},
    recordDerivedStatRun: async () => {},
    archiveWaitSamples: async () => 0,
    pruneWaitArchive: async () => {},

    // R18 surface.
    getTopExperiencesByBaseline: vi.fn(async () => state.topExperiences),
    upsertWaitForecastLogs: vi.fn(async (rows: any[]) => {
      state.waitForecastLogs.push(...rows.map((r) => ({ ...r })));
    }),
    getWaitForecastLogsToReconcile: vi.fn(async () => state.pendingLogs),
    getWaitArchiveHours: vi.fn(async () => state.archiveHours),
    updateWaitForecastReconciliation: vi.fn(async (rows: any[]) => {
      state.reconciliationUpdates.push(...rows.map((r) => ({ ...r })));
    }),
    getWaitForecastAccuracies: vi.fn(async () => state.waitForecastAccuracies),
    upsertWaitForecastAccuracies: vi.fn(async (rows: any[]) => {
      state.waitForecastAccuracies = rows.map((r) => ({ ...r }));
    }),
    pruneWaitForecastLog: vi.fn(async (before: Date) => {
      state.prunedBefore = before;
    }),
  } as any;

  return { repo, state };
}

/** A prediction service returning a fixed wait for every hour. */
function makePrediction(waitByExperience: Record<string, number>) {
  return {
    getRawForecast: async () => 1.0,
    getCalibratedForecast: async () => 1.0,
    getDaySnapshot: vi.fn(async (experienceIds: string[]) => {
      const out: Record<string, any> = {};
      for (const id of experienceIds) {
        out[id] = {
          experienceId: id,
          isVirtualQueue: false,
          waits: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            predictedWaitMinutes: waitByExperience[id] ?? 0,
          })),
        };
      }
      return out;
    }),
    getCrowdMultiplier: vi.fn(),
    getCrowdCalendarDay: vi.fn(),
    getWaitInsights: vi.fn(),
  } as unknown as PredictionService;
}

function makeService(repo: any, prediction: PredictionService) {
  return createDerivedStatsService({
    repo,
    predictionService: prediction,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    now: () => NOW,
  });
}

describe('Feature: crowd-calendar — captureWaitForecasts freezes predictions (R18.1, R18.2)', () => {
  it('captures every tracked experience at each lead time and hour', async () => {
    const { repo, state } = makeRepo({
      topExperiences: [
        { experience_id: EXP_A, park: PARK, peak_baseline: 70 },
        { experience_id: EXP_B, park: PARK, peak_baseline: 55 },
      ],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 52, [EXP_B]: 31 })).runDailyRecompute();

    // 2 experiences x 3 leads x 4 hours
    expect(state.waitForecastLogs).toHaveLength(24);
    expect(new Set(state.waitForecastLogs.map((r) => r.hour))).toEqual(new Set(HOURS));
    expect(new Set(state.waitForecastLogs.map((r) => r.lead_days))).toEqual(new Set(LEADS));

    const a = state.waitForecastLogs.filter((r) => r.experience_id === EXP_A);
    expect(a).toHaveLength(12);
    expect(a.every((r) => r.predicted_wait_minutes === 52)).toBe(true);
    // Every row records when it was issued and starts unscored.
    expect(a.every((r) => r.forecasted_at === NOW)).toBe(true);
    expect(a.every((r) => r.observed_wait_minutes === null && r.error === null)).toBe(true);
  });

  it('dates each row by its lead time relative to the WDW calendar day', async () => {
    const { repo, state } = makeRepo();
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    const dates = new Set(
      state.waitForecastLogs.map((r) => new Date(r.date).toISOString().split('T')[0]),
    );
    // NOW is 2026-08-26 ET, so leads 7/3/1 target Sep 2, Aug 29, Aug 27.
    expect(dates).toEqual(new Set(['2026-09-02', '2026-08-29', '2026-08-27']));
  });

  it('calls getDaySnapshot once per (park, lead), not once per experience', async () => {
    const { repo } = makeRepo({
      topExperiences: [
        { experience_id: EXP_A, park: PARK, peak_baseline: 70 },
        { experience_id: EXP_B, park: PARK, peak_baseline: 55 },
      ],
    });
    const prediction = makePrediction({ [EXP_A]: 52, [EXP_B]: 31 });
    await makeService(repo, prediction).runDailyRecompute();

    // One park, three leads — batching, so adding rides costs nothing extra.
    expect((prediction.getDaySnapshot as any).mock.calls).toHaveLength(3);
    expect((prediction.getDaySnapshot as any).mock.calls[0]![0]).toEqual([EXP_A, EXP_B]);
  });

  it('leaves the challenger column null when no shadow model is configured (R18.5)', async () => {
    const { repo, state } = makeRepo();
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.waitForecastLogs.every((r) => r.challenger_wait_minutes === null)).toBe(true);
    expect(state.waitForecastLogs.every((r) => r.challenger_error === null)).toBe(true);
  });

  it('captures nothing when no experience has an established baseline yet', async () => {
    const { repo, state } = makeRepo({ topExperiences: [] });
    await makeService(repo, makePrediction({})).runDailyRecompute();

    expect(state.waitForecastLogs).toHaveLength(0);
    expect(repo.upsertWaitForecastLogs).not.toHaveBeenCalled();
  });

  it('keeps the other parks and leads when one snapshot call fails', async () => {
    const { repo, state } = makeRepo({
      topExperiences: [
        { experience_id: EXP_A, park: PARK, peak_baseline: 70 },
        { experience_id: EXP_B, park: 'EPCOT', peak_baseline: 55 },
      ],
    });
    const prediction = makePrediction({ [EXP_A]: 52, [EXP_B]: 31 });
    let calls = 0;
    (prediction.getDaySnapshot as any).mockImplementation(async (ids: string[]) => {
      calls++;
      if (calls === 1) throw new Error('upstream timeout');
      const out: Record<string, any> = {};
      for (const id of ids) {
        out[id] = {
          experienceId: id,
          waits: Array.from({ length: 24 }, (_, hour) => ({ hour, predictedWaitMinutes: 44 })),
        };
      }
      return out;
    });

    await makeService(repo, prediction).runDailyRecompute();

    // 2 parks x 3 leads = 6 calls, one failed -> 5 x 4 hours = 20 rows.
    expect(state.waitForecastLogs).toHaveLength(20);
  });
});

describe('Feature: crowd-calendar — reconcileWaitForecasts scores against the archive (R18.3, R18.4)', () => {
  function pendingLog(overrides: Record<string, unknown> = {}) {
    return {
      experience_id: EXP_A,
      date: new Date('2026-08-25T12:00:00-04:00'),
      hour: 13,
      lead_days: 1,
      predicted_wait_minutes: 50,
      forecasted_at: new Date('2026-08-24T12:00:00Z'),
      challenger_wait_minutes: null,
      observed_wait_minutes: null,
      error: null,
      challenger_error: null,
      ...overrides,
    };
  }

  function archiveHour(avg: number, overrides: Record<string, unknown> = {}) {
    return {
      experience_id: EXP_A,
      date: new Date('2026-08-25'),
      hour: 13,
      avg_wait_minutes: avg,
      sample_count: 5,
      ...overrides,
    };
  }

  it('records signed error as predicted minus observed', async () => {
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog({ predicted_wait_minutes: 50 })],
      archiveHours: [archiveHour(38)],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.reconciliationUpdates).toHaveLength(1);
    expect(state.reconciliationUpdates[0]!.observed_wait_minutes).toBe(38);
    // Over-predicted by 12 minutes.
    expect(state.reconciliationUpdates[0]!.error).toBeCloseTo(12, 6);
  });

  it('records a negative error when the model under-predicted', async () => {
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog({ predicted_wait_minutes: 30 })],
      archiveHours: [archiveHour(45)],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.reconciliationUpdates[0]!.error).toBeCloseTo(-15, 6);
  });

  it('seeds the accuracy summary from the first scored prediction', async () => {
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog({ predicted_wait_minutes: 50 })],
      archiveHours: [archiveHour(38)],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    const acc = state.waitForecastAccuracies.find(
      (a) => a.experience_id === EXP_A && a.lead_days === 1,
    );
    expect(acc).toBeDefined();
    expect(acc.mae).toBeCloseTo(12, 6);
    expect(acc.bias).toBeCloseTo(12, 6);
    expect(acc.sample_count).toBe(1);
  });

  it('EMAs an existing accuracy summary rather than replacing it', async () => {
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog({ predicted_wait_minutes: 50 })],
      archiveHours: [archiveHour(38)],
      waitForecastAccuracies: [
        {
          experience_id: EXP_A,
          lead_days: 1,
          mae: 4,
          bias: 0,
          sample_count: 10,
          challenger_mae: null,
          challenger_bias: null,
          challenger_sample_count: 0,
        },
      ],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    const acc = state.waitForecastAccuracies.find((a) => a.lead_days === 1);
    const weight = 2 / (10 + 2);
    expect(acc.mae).toBeCloseTo(4 + weight * (12 - 4), 6);
    expect(acc.bias).toBeCloseTo(0 + weight * (12 - 0), 6);
    expect(acc.sample_count).toBe(11);
  });

  it('leaves a prediction unreconciled when the ride has no observed hour', async () => {
    // A closed ride is not a 0-minute wait; scoring it as one would bias the
    // summary downward.
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog()],
      archiveHours: [],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.reconciliationUpdates).toHaveLength(0);
    expect(repo.updateWaitForecastReconciliation).toHaveBeenCalledWith([]);
  });

  it('matches on experience, date AND hour, not just the experience', async () => {
    const { repo, state } = makeRepo({
      pendingLogs: [pendingLog({ hour: 13, predicted_wait_minutes: 50 })],
      archiveHours: [
        archiveHour(10, { hour: 10 }),
        archiveHour(38, { hour: 13 }),
        archiveHour(90, { hour: 16 }),
      ],
    });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.reconciliationUpdates).toHaveLength(1);
    expect(state.reconciliationUpdates[0]!.observed_wait_minutes).toBe(38);
  });

  it('only asks for whole elapsed days', async () => {
    const { repo } = makeRepo({ pendingLogs: [], archiveHours: [] });
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    const askedFor = repo.getWaitForecastLogsToReconcile.mock.calls[0]![0] as Date;
    // NOW is 2026-08-26 ET, so the last fully elapsed day is the 25th.
    expect(askedFor.toISOString().split('T')[0]).toBe('2026-08-25');
  });

  describe('challenger isolation (R18.5, R18.6)', () => {
    it('tallies challenger error separately from the served model', async () => {
      const { repo, state } = makeRepo({
        pendingLogs: [
          pendingLog({ predicted_wait_minutes: 50, challenger_wait_minutes: 40 }),
        ],
        archiveHours: [archiveHour(38)],
      });
      await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

      const update = state.reconciliationUpdates[0]!;
      expect(update.error).toBeCloseTo(12, 6);       // served: 50 - 38
      expect(update.challenger_error).toBeCloseTo(2, 6); // challenger: 40 - 38

      const acc = state.waitForecastAccuracies.find((a) => a.lead_days === 1);
      // The served summary is untouched by the challenger's better score.
      expect(acc.mae).toBeCloseTo(12, 6);
      expect(acc.sample_count).toBe(1);
      // The challenger's own tally records its own error.
      expect(acc.challenger_mae).toBeCloseTo(2, 6);
      expect(acc.challenger_bias).toBeCloseTo(2, 6);
      expect(acc.challenger_sample_count).toBe(1);
    });

    it('leaves the challenger tally empty when no challenger prediction exists', async () => {
      const { repo, state } = makeRepo({
        pendingLogs: [pendingLog({ predicted_wait_minutes: 50 })],
        archiveHours: [archiveHour(38)],
      });
      await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

      const acc = state.waitForecastAccuracies.find((a) => a.lead_days === 1);
      expect(acc.challenger_mae).toBeNull();
      expect(acc.challenger_bias).toBeNull();
      expect(acc.challenger_sample_count).toBe(0);
      expect(state.reconciliationUpdates[0]!.challenger_error).toBeNull();
    });
  });
});

describe('Feature: crowd-calendar — pruneWaitForecastLog keeps the log bounded (R18.7)', () => {
  it('prunes at the documented retention window', async () => {
    const { repo, state } = makeRepo();
    await makeService(repo, makePrediction({ [EXP_A]: 40 })).runDailyRecompute();

    expect(state.prunedBefore).not.toBeNull();
    const expected = new Date(NOW.getTime() - 180 * 86400000);
    expect(state.prunedBefore!.getTime()).toBe(expected.getTime());
  });
});
