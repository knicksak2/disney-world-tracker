import { describe, expect, it, vi } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { IntelligenceRepo, ShowTimePatternRow } from '../IntelligenceRepo.js';
import type { WeatherClient } from '../weatherClient.js';

describe('predictionService showtimes fallback and typical showtimes flag', () => {
  const mockWeatherClient: WeatherClient = {
    getWDWWeather: vi.fn().mockResolvedValue({
      current: { condition: 'Clear', tempF: 75, precip: 0 },
      forecast: [],
    }),
  };

  it('normalizes real upstream object-shaped showtimes into canonical ISO instants and never produces "[object Object]"', async () => {
    const expId = 'exp-indiana-jones';
    const rawShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T12:00:00-04:00', endTime: '2026-08-17T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
    ];

    const mockRepo = {
      getParkCrowdIndices: vi.fn().mockResolvedValue([]),
      getParkScheduleSignals: vi.fn().mockResolvedValue([]),
      getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
      getForecastAccuracies: vi.fn().mockResolvedValue([]),
      getRideShapes: vi.fn().mockResolvedValue([]),
      getSeasonHours: vi.fn().mockResolvedValue([]),
      getExperienceSignals: vi.fn().mockResolvedValue([]),
      getWeatherSensitivities: vi.fn().mockResolvedValue([]),
      getExperienceDailySignals: vi.fn().mockResolvedValue([
        {
          experience_id: expId,
          date: new Date('2026-08-17'),
          ll_price_cents: null,
          ll_available: false,
          used_virtual_queue: false,
          showtimes: rawShowtimes,
        },
      ]),
      getShowTimePatterns: vi.fn().mockResolvedValue([]),
    } as unknown as IntelligenceRepo;

    const service = createPredictionService({
      repo: mockRepo,
      weatherClient: mockWeatherClient,
    });

    const targetDate = new Date('2026-08-17T12:00:00-04:00');
    const snapshot = await service.getDaySnapshot([expId], 'Hollywood Studios', targetDate);

    expect(snapshot[expId]).toBeDefined();
    expect(snapshot[expId]!.showtimes).toEqual([
      '2026-08-17T14:45:00.000Z',
      '2026-08-17T16:00:00.000Z',
      '2026-08-17T17:15:00.000Z',
    ]);
    expect(snapshot[expId]!.showtimes).not.toContain('[object Object]');
    expect(snapshot[expId]!.showtimesAreTypical).toBeUndefined();
  });

  it('logs at warn when unparseable showtime entries are skipped in getDaySnapshot', async () => {
    const expId = 'exp-dirty-show';
    const dirtyShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { invalid: true },
      'not-a-date',
    ];

    const mockLogger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const mockRepo = {
      getParkCrowdIndices: vi.fn().mockResolvedValue([]),
      getParkScheduleSignals: vi.fn().mockResolvedValue([]),
      getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
      getForecastAccuracies: vi.fn().mockResolvedValue([]),
      getRideShapes: vi.fn().mockResolvedValue([]),
      getSeasonHours: vi.fn().mockResolvedValue([]),
      getExperienceSignals: vi.fn().mockResolvedValue([]),
      getWeatherSensitivities: vi.fn().mockResolvedValue([]),
      getExperienceDailySignals: vi.fn().mockResolvedValue([
        {
          experience_id: expId,
          date: new Date('2026-08-17'),
          ll_price_cents: null,
          ll_available: false,
          used_virtual_queue: false,
          showtimes: dirtyShowtimes,
        },
      ]),
      getShowTimePatterns: vi.fn().mockResolvedValue([]),
    } as unknown as IntelligenceRepo;

    const service = createPredictionService({
      repo: mockRepo,
      weatherClient: mockWeatherClient,
      logger: mockLogger,
    });

    const targetDate = new Date('2026-08-17T12:00:00-04:00');
    const snapshot = await service.getDaySnapshot([expId], 'Hollywood Studios', targetDate);

    expect(snapshot[expId]!.showtimes).toEqual(['2026-08-17T14:45:00.000Z']);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        experienceId: expId,
        date: '2026-08-17',
        skipped: 2,
      }),
      expect.stringContaining('skipped 2 unparseable showtime entries'),
    );
  });

  it('falls back to show_time_patterns on the requested date in ET when per-date showtimes are absent, setting showtimesAreTypical to true', async () => {
    const expId = 'exp-show-1';

    const mockRepo = {
      getParkCrowdIndices: vi.fn().mockResolvedValue([]),
      getParkScheduleSignals: vi.fn().mockResolvedValue([]),
      getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
      getForecastAccuracies: vi.fn().mockResolvedValue([]),
      getRideShapes: vi.fn().mockResolvedValue([]),
      getSeasonHours: vi.fn().mockResolvedValue([]),
      getExperienceSignals: vi.fn().mockResolvedValue([]),
      getWeatherSensitivities: vi.fn().mockResolvedValue([]),
      getExperienceDailySignals: vi.fn().mockResolvedValue([]), // No per-date signals
      getShowTimePatterns: vi.fn().mockResolvedValue([
        {
          experience_id: expId,
          day_of_week: 4, // Thursday
          start_minutes: 600, // 10:00 AM ET
          frequency: 0.8,
          sample_count: 4,
        },
        {
          experience_id: expId,
          day_of_week: 4, // Thursday
          start_minutes: 840, // 2:00 PM ET
          frequency: 0.8,
          sample_count: 4,
        },
      ] as ShowTimePatternRow[]),
    } as unknown as IntelligenceRepo;

    const service = createPredictionService({
      repo: mockRepo,
      weatherClient: mockWeatherClient,
    });

    // Test EDT date: 2026-10-01 (Thursday) -> 10:00 AM EDT is 14:00:00Z, 2:00 PM EDT is 18:00:00Z
    const edtDate = new Date('2026-10-01T12:00:00-04:00');
    const edtSnapshot = await service.getDaySnapshot([expId], 'Animal Kingdom', edtDate);

    expect(edtSnapshot[expId]!.showtimes).toEqual([
      '2026-10-01T14:00:00.000Z',
      '2026-10-01T18:00:00.000Z',
    ]);
    expect(edtSnapshot[expId]!.showtimesAreTypical).toBe(true);

    // Test EST date: 2026-01-15 (Thursday) -> 10:00 AM EST is 15:00:00Z, 2:00 PM EST is 19:00:00Z
    const estDate = new Date('2026-01-15T12:00:00-05:00');
    const estSnapshot = await service.getDaySnapshot([expId], 'Animal Kingdom', estDate);

    expect(estSnapshot[expId]!.showtimes).toEqual([
      '2026-01-15T15:00:00.000Z',
      '2026-01-15T19:00:00.000Z',
    ]);
    expect(estSnapshot[expId]!.showtimesAreTypical).toBe(true);
  });
});
