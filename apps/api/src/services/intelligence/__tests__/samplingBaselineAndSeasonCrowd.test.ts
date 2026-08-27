/**
 * Feature: crowd-calendar — task 19.5. Covers the two paths in
 * `samplingService` that R14/R15 added and that no assertion reached: the
 * in-pass `establishBaseline` call, and the `avg_crowd_index` EMA on the season
 * bucket. Both were executed by existing sampling tests and asserted by none,
 * which is exactly the executed-but-unasserted gap a green suite hides.
 *
 * Fixed clock: 2026-08-05T18:00:00Z -> 14:00 ET, DOW 3 (Wednesday), season 2.
 */
import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import { BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES, applyEma } from '../waitMath.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';

const NOW = new Date('2026-08-05T18:00:00Z');
const DOW = 3;
const HOUR = 14;
const SEASON = 2;
const OBSERVED_WAIT = 50;

interface FixtureOptions {
  /** Rows returned by `getRideShapes`. */
  shapes: any[];
  /** Rows returned by `getSeasonHours`. */
  seasons?: any[];
  /** Rows returned by `getParkCrowdIndices` — the day's index so far. */
  crowdIndices?: any[];
}

function makeFixture(opts: FixtureOptions) {
  const shapeUpserts: any[] = [];
  const seasonUpserts: any[] = [];

  const fakeLiveClient: ThemeParksLiveClient = {
    async getEntityLive(id: string) {
      if (id === 'mk') {
        return {
          id,
          name: 'Magic Kingdom',
          entityType: 'PARK',
          timezone: 'America/New_York',
          liveData: [
            { id: 'ride-tp', status: 'OPERATING', queue: { STANDBY: { waitTime: OBSERVED_WAIT } } },
          ],
        };
      }
      return { id, name: 'Other', entityType: 'PARK', timezone: 'America/New_York', liveData: [] };
    },
    async getEntitySchedule() {
      return { schedule: [] };
    },
  };

  const fakeCatalogClient = {
    async getDestinations() {
      return {
        destinations: [
          {
            id: 'wdw',
            name: 'Walt Disney World Resort',
            parks: [{ id: 'mk', name: 'Magic Kingdom' }],
          },
        ],
      };
    },
  } as unknown as ThemeParksClient;

  const fakeRepo = {
    getExperiencesWithUpstreamIds: async () => [
      { id: 'ride-db', upstream_entity_id: 'ride-tp', park: 'Magic Kingdom' },
    ],
    upsertWeatherObservations: async () => {},
    upsertParkScheduleSignals: async () => {},
    insertWaitSamples: async () => {},
    upsertExperienceDailySignals: async () => {},
    upsertRideShapes: async (rows: any[]) => {
      shapeUpserts.push(...rows.map((r) => ({ ...r })));
    },
    upsertSeasonHours: async (rows: any[]) => {
      seasonUpserts.push(...rows.map((r) => ({ ...r })));
    },
    upsertExperienceSignals: async () => {},
    getParkCrowdIndices: async () => opts.crowdIndices ?? [],
    upsertParkCrowdIndices: async () => {},
    pruneWaitSamples: async () => {},
    getRideShapes: async () => opts.shapes,
    getSeasonHours: async () => opts.seasons ?? [],
    getExperienceSignals: async () => [],
  } as any;

  const service = createSamplingService({
    repo: fakeRepo,
    liveClient: fakeLiveClient,
    catalogClient: fakeCatalogClient,
    directory: { resolveEntityId: async (id: string) => id, prime: async () => {} } as any,
    weatherClient: { getWDWWeather: async () => ({ current: null, forecast: [] }) } as any,
    now: () => NOW,
  });

  return { service, shapeUpserts, seasonUpserts };
}

function shapeRow(overrides: Record<string, unknown> = {}) {
  return {
    experience_id: 'ride-db',
    day_of_week: DOW,
    hour: HOUR,
    avg_wait_minutes: 30,
    sample_count: 40,
    sr_avg_wait_minutes: null,
    sr_sample_count: null,
    stddev_wait: 5,
    p50_wait: 30,
    p90_wait: 45,
    down_rate: 0,
    baseline_wait_minutes: null,
    baseline_sample_count: 0,
    ...overrides,
  };
}

function seasonRow(overrides: Record<string, unknown> = {}) {
  return {
    experience_id: 'ride-db',
    season: SEASON,
    day_of_week: DOW,
    hour: HOUR,
    avg_wait_minutes: 40,
    sample_count: 10,
    avg_crowd_index: null,
    ...overrides,
  };
}

function crowdIndexRow(crowd_index: number, sample_count: number) {
  return {
    park: 'Magic Kingdom',
    date: new Date('2026-08-05'),
    crowd_index,
    daily_avg_wait: 25,
    sample_count,
    source: 'observed',
  };
}

describe('Feature: crowd-calendar — sampling establishes the Ride_Baseline (R14.3, R14.4)', () => {
  it('establishes the baseline from the settled shape average, not from the observation', async () => {
    // Shape has 40 samples (>= the 20-sample settle threshold) and no baseline.
    const { service, shapeUpserts } = makeFixture({ shapes: [shapeRow()] });

    await service.runSamplingPass();

    const written = shapeUpserts.find((r) => r.day_of_week === DOW && r.hour === HOUR);
    expect(written).toBeDefined();

    // The shape itself moved toward the 50-minute observation...
    expect(written.avg_wait_minutes).toBeGreaterThan(30);
    // ...but the baseline froze the POST-update shape average, and crucially is
    // nowhere near the raw 50-minute observation (R14.4).
    expect(written.baseline_wait_minutes).toBeCloseTo(written.avg_wait_minutes, 6);
    expect(written.baseline_wait_minutes).not.toBeCloseTo(OBSERVED_WAIT, 1);
    expect(written.baseline_sample_count).toBe(written.sample_count);
  });

  it('refuses to establish a baseline while the fast shape is still thin', async () => {
    const thin = BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES - 5;
    const { service, shapeUpserts } = makeFixture({
      shapes: [shapeRow({ sample_count: thin })],
    });

    await service.runSamplingPass();

    const written = shapeUpserts.find((r) => r.day_of_week === DOW && r.hour === HOUR);
    // One pass takes it to `thin + 1`, still under the threshold, so no baseline
    // is frozen and the ride simply stays out of the crowd-index basket.
    expect(written.sample_count).toBe(thin + 1);
    expect(written.baseline_wait_minutes).toBeNull();
  });

  it('writes an already-established baseline back completely unchanged', async () => {
    const { service, shapeUpserts } = makeFixture({
      shapes: [shapeRow({ baseline_wait_minutes: 27.5, baseline_sample_count: 123 })],
    });

    await service.runSamplingPass();

    const written = shapeUpserts.find((r) => r.day_of_week === DOW && r.hour === HOUR);
    // The fast shape moved; the baseline did not. This is the R14.8 guarantee at
    // the service layer rather than the pure-function layer.
    expect(written.avg_wait_minutes).toBeGreaterThan(30);
    expect(written.baseline_wait_minutes).toBe(27.5);
    expect(written.baseline_sample_count).toBe(123);
  });
});

describe('Feature: crowd-calendar — sampling records the season bucket\'s crowd level (R15.2)', () => {
  it('seeds avg_crowd_index from the day\'s observed index on the first sample that sees one', async () => {
    const { service, seasonUpserts } = makeFixture({
      shapes: [shapeRow({ baseline_wait_minutes: 30, baseline_sample_count: 40 })],
      seasons: [seasonRow({ avg_crowd_index: null })],
      crowdIndices: [crowdIndexRow(0.85, 12)],
    });

    await service.runSamplingPass();

    const written = seasonUpserts.find((r) => r.season === SEASON && r.hour === HOUR);
    expect(written).toBeDefined();
    // No prior value, so it takes the observed level directly rather than
    // EMA-ing against a fabricated 1.0.
    expect(written.avg_crowd_index).toBeCloseTo(0.85, 6);
  });

  it('EMAs avg_crowd_index toward the observed index using the season bucket weight', async () => {
    const priorLevel = 1.0;
    const observedLevel = 0.7;
    const priorCount = 10;

    const { service, seasonUpserts } = makeFixture({
      shapes: [shapeRow({ baseline_wait_minutes: 30, baseline_sample_count: 40 })],
      seasons: [seasonRow({ avg_crowd_index: priorLevel, sample_count: priorCount })],
      crowdIndices: [crowdIndexRow(observedLevel, 20)],
    });

    await service.runSamplingPass();

    const written = seasonUpserts.find((r) => r.season === SEASON && r.hour === HOUR);
    // Same capped-alpha weight the bucket's wait uses: 2 / (min(n, 10) + 2).
    const weight = 2 / (Math.min(priorCount, 10) + 2);
    expect(written.avg_crowd_index).toBeCloseTo(applyEma(priorLevel, observedLevel, weight), 6);
    // Moved toward the observation but not all the way to it.
    expect(written.avg_crowd_index).toBeLessThan(priorLevel);
    expect(written.avg_crowd_index).toBeGreaterThan(observedLevel);
  });

  it('leaves avg_crowd_index null on the day\'s first pass rather than assuming a typical day', async () => {
    // No crowd-index row for today yet — the level is genuinely unknown.
    const { service, seasonUpserts } = makeFixture({
      shapes: [shapeRow({ baseline_wait_minutes: 30, baseline_sample_count: 40 })],
      seasons: [seasonRow({ avg_crowd_index: null })],
      crowdIndices: [],
    });

    await service.runSamplingPass();

    const written = seasonUpserts.find((r) => r.season === SEASON && r.hour === HOUR);
    expect(written.avg_crowd_index).toBeNull();
    // The bucket's wait still updated — only the crowd level was withheld.
    expect(written.sample_count).toBe(11);
  });

  it('ignores a crowd-index row with no samples behind it', async () => {
    const { service, seasonUpserts } = makeFixture({
      shapes: [shapeRow({ baseline_wait_minutes: 30, baseline_sample_count: 40 })],
      seasons: [seasonRow({ avg_crowd_index: null })],
      // sample_count 0 — a placeholder/seed row, not an observation.
      crowdIndices: [crowdIndexRow(0.85, 0)],
    });

    await service.runSamplingPass();

    const written = seasonUpserts.find((r) => r.season === SEASON && r.hour === HOUR);
    expect(written.avg_crowd_index).toBeNull();
  });
});
