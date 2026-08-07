import { describe, expect, it } from 'vitest';

import { createSamplingService } from '../samplingService.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';

/**
 * Regression: the sampling throttle must not halve the effective sampling rate.
 *
 * The bug: the throttle window equaled the ~10-minute cron interval AND
 * `lastSampleTime` was stamped at pass *completion*. Because a pass ends a bit
 * after its trigger, the next 10-minute cron hit landed just under the window
 * and was throttled — so only every other tick ran (~20-minute effective rate,
 * which is exactly what the dev DB showed: 3 passes/hour).
 *
 * These tests simulate a non-zero pass duration (the weather fetch advances the
 * clock) so two cron ticks spaced a full cron-interval apart both execute. They
 * fail against the pre-fix code (second tick throttled) and pass with the
 * start-stamped, sub-interval debounce.
 */

const T0 = new Date('2026-08-06T13:00:00Z').getTime();
const CRON_INTERVAL_MS = 10 * 60 * 1000;
const PASS_DURATION_MS = 2 * 60 * 1000;

function makeService() {
  let nowMs = T0;
  let weatherCalls = 0;

  const fakeWeatherClient = {
    // Each pass starts by fetching weather; advance the clock to model the pass
    // taking real time (this is what made the completion-stamped throttle skip
    // the next tick).
    getWDWWeather: async () => {
      weatherCalls++;
      nowMs += PASS_DURATION_MS;
      return { current: null, forecast: [] };
    },
  } as any;

  const fakeCatalogClient = {
    async getDestinations() {
      return { destinations: [] };
    },
  } as unknown as ThemeParksClient;

  const fakeLiveClient = {
    async getEntityLive(id: string) {
      return { id, name: id, entityType: 'PARK', timezone: 'America/New_York', liveData: [] };
    },
    async getEntitySchedule() {
      return { schedule: [] };
    },
  } as unknown as ThemeParksLiveClient;

  const fakeRepo = {
    getExperiencesWithUpstreamIds: async () => [],
    upsertWeatherObservations: async () => {},
    upsertParkScheduleSignals: async () => {},
    insertWaitSamples: async () => {},
    upsertExperienceDailySignals: async () => {},
    upsertRideShapes: async () => {},
    upsertSeasonHours: async () => {},
    upsertExperienceSignals: async () => {},
    getParkCrowdIndices: async () => [],
    upsertParkCrowdIndices: async () => {},
    pruneWaitSamples: async () => {},
    getRideShapes: async () => [],
    getSeasonHours: async () => [],
    getExperienceSignals: async () => [],
  } as any;

  const fakeDirectory = { resolveEntityId: async () => null, prime: async () => {} } as any;

  const service = createSamplingService({
    repo: fakeRepo,
    liveClient: fakeLiveClient,
    catalogClient: fakeCatalogClient,
    directory: fakeDirectory,
    weatherClient: fakeWeatherClient,
    now: () => new Date(nowMs),
  });

  return {
    service,
    setNow: (ms: number) => { nowMs = ms; },
    weatherCalls: () => weatherCalls,
  };
}

describe('sampling throttle cadence', () => {
  it('runs on two cron ticks one full cron-interval apart (no rate halving)', async () => {
    const h = makeService();

    // Tick 1 at T0 — runs (pass advances clock by PASS_DURATION_MS internally).
    await h.service.runSamplingPass();
    expect(h.weatherCalls()).toBe(1);

    // Tick 2 fires one cron interval after tick 1's START.
    h.setNow(T0 + CRON_INTERVAL_MS);
    await h.service.runSamplingPass();

    // Pre-fix this was 1 (second tick throttled to a ~20-min effective rate).
    expect(h.weatherCalls()).toBe(2);
  });

  it('debounces a re-fire that arrives well within the min interval', async () => {
    const h = makeService();

    await h.service.runSamplingPass();
    expect(h.weatherCalls()).toBe(1);

    // A stray re-fire 2 minutes after the pass started — inside the debounce.
    h.setNow(T0 + 2 * 60 * 1000);
    await h.service.runSamplingPass();
    expect(h.weatherCalls()).toBe(1);
  });
});
