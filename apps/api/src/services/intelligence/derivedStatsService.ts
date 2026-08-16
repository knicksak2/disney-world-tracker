import { createLogger } from '../../logger.js';
import type { IntelligenceRepo, ExperienceWeatherSensitivityRow } from './IntelligenceRepo.js';
import { updateAccuracy } from './calibration.js';
import {
  computeWeatherSensitivities as computeWeatherSensitivitiesPure,
  type ConditionWaitAggregate,
} from './weatherLearning.js';
import { wdwToday } from '../trips/wdwClock.js';
import type { PredictionService } from './predictionService.js';
import type { Park } from '@dwt/shared';
import {
  SHOWTIME_PATTERN_WINDOW_DAYS,
  deriveShowTimePatterns,
  type RawShowtimeSignal,
} from './showtimePatterns.js';

/** The four WDW theme parks that have crowd indices. */
const WDW_THEME_PARKS: readonly Park[] = [
  'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'
] as const;

/** Learn weather sensitivity from waits within this recent window (matches the wait_samples retention). */
const WEATHER_LEARNING_WINDOW_DAYS = 30;
/** Bounded retention for observed weather (older rows can't join to pruned waits anyway). */
const WEATHER_OBSERVATION_RETENTION_DAYS = 90;

export interface DerivedStatsServiceDeps {
  repo: IntelligenceRepo;
  predictionService: PredictionService;
  logger?: any;
  now?: () => Date;
}

export interface DerivedStatsService {
  runDailyRecompute(): Promise<void>;
}

export function createDerivedStatsService(deps: DerivedStatsServiceDeps): DerivedStatsService {
  const logger = deps.logger ?? createLogger();
  const { repo } = deps;
  const clock = deps.now ?? (() => new Date());
  
  return {
    async runDailyRecompute(): Promise<void> {
      const now = clock();
      const todayDateStr = wdwToday(now);
      const yesterday = new Date(new Date(`${todayDateStr}T12:00:00-04:00`).getTime() - 86400000);
      
      logger.info('Starting daily derived stats recompute');
      
      try {
        await reconcileForecasts(yesterday).catch((err) => logger.error({ err }, 'Failed reconcileForecasts'));
        await captureForecasts(now).catch((err) => logger.error({ err }, 'Failed captureForecasts'));
        await learnWeatherSensitivities(now).catch((err) => logger.error({ err }, 'Failed learnWeatherSensitivities'));
        await recomputePercentiles().catch((err) => logger.error({ err }, 'Failed recomputePercentiles'));
        await recomputeShowtimePatterns(now).catch((err) => logger.error({ err }, 'Failed recomputeShowtimePatterns'));
        await repo.pruneWeatherObservations(
          new Date(now.getTime() - WEATHER_OBSERVATION_RETENTION_DAYS * 86400000),
        ).catch((err) => logger.error({ err }, 'Failed pruneWeatherObservations'));
        logger.info('Completed daily derived stats recompute');
      } catch (err) {
        logger.error({ err }, 'Failed daily derived stats recompute');
      }
    }
  };

  async function reconcileForecasts(dateToReconcile: Date) {
    for (const parkKey of WDW_THEME_PARKS) {
      const observedRows = await repo.getParkCrowdIndices(parkKey, [dateToReconcile]);
      if (observedRows.length === 0) continue;
      
      const observedIndex = observedRows[0]!.crowd_index;
      
      const logs = await repo.getForecastLogsToReconcile(parkKey, dateToReconcile);
      if (logs.length === 0) continue;
      
      const accuracies = await repo.getForecastAccuracies(parkKey);
      
      for (const log of logs) {
        log.observed_index = observedIndex;
        log.error = log.forecast_index - observedIndex; // Bias: forecast - observed
        
        let acc = accuracies.find(a => a.lead_days === log.lead_days) || {
          park: parkKey,
          lead_days: log.lead_days,
          mae: 0,
          bias: 0,
          sample_count: 0
        };
        
        const weight = 2 / (Math.min(acc.sample_count, 100) + 2);
        const inputState = { mae: acc.mae, bias: acc.bias, sampleCount: acc.sample_count };
        const updated = updateAccuracy(inputState, log.error, weight);
        
        acc.mae = updated.mae;
        acc.bias = updated.bias;
        acc.sample_count = updated.sampleCount;
        
        await repo.upsertForecastAccuracies([acc]);
      }
      
      await repo.upsertForecastLogs(logs);
    }
  }

  async function captureForecasts(now: Date) {
    const todayStr = wdwToday(now);
    const todayEastern = new Date(`${todayStr}T12:00:00-04:00`);
    const leadDays = [1, 3, 7, 14, 30];
    
    for (const parkKey of WDW_THEME_PARKS) {
      for (const lead of leadDays) {
        const targetDate = new Date(todayEastern.getTime() + lead * 86400000);
        try {
          // Use the raw continuous forecast directly — no display round-trip
          const rawForecast = await deps.predictionService.getRawForecast(parkKey, targetDate);
          await repo.upsertForecastLogs([{
            park: parkKey,
            date: targetDate,
            lead_days: lead,
            forecast_index: rawForecast,
            forecasted_at: now,
            observed_index: null,
            error: null
          }]);
        } catch (_err) {
          // ignore failures for specific leads
        }
      }
    }
  }

  /**
   * Learn each Experience's per-condition wait multiplier vs its clear-sky
   * baseline, by joining recent waits to observed weather. Self-activating: it
   * writes nothing until a condition has enough overlapping observations, so it
   * is a safe no-op until history accrues.
   */
  async function learnWeatherSensitivities(now: Date) {
    const since = new Date(now.getTime() - WEATHER_LEARNING_WINDOW_DAYS * 86400000);
    const rows = await repo.getWaitWeatherAggregates(since);
    if (rows.length === 0) return;

    const byExperience = new Map<string, ConditionWaitAggregate[]>();
    for (const row of rows) {
      const list = byExperience.get(row.experience_id) ?? [];
      list.push({ condition: row.condition, avgWait: row.avg_wait, sampleCount: row.sample_count });
      byExperience.set(row.experience_id, list);
    }

    const upserts: ExperienceWeatherSensitivityRow[] = [];
    for (const [experienceId, aggregates] of byExperience) {
      for (const s of computeWeatherSensitivitiesPure(aggregates)) {
        upserts.push({
          experience_id: experienceId,
          condition: s.condition,
          wait_multiplier: s.waitMultiplier,
          sample_count: s.sampleCount,
        });
      }
    }
    await repo.upsertWeatherSensitivities(upserts);
  }

  async function recomputePercentiles() {
    const thirtyDaysAgo = new Date(clock().getTime() - 30 * 24 * 60 * 60 * 1000);
    const percentiles = await repo.getRecentPercentiles(thirtyDaysAgo);
    
    const exps = await repo.getExperiencesWithUpstreamIds();
    const expIds = exps.map(e => e.id);
    const currentShapes = await repo.getRideShapes(expIds);
    
    const updatedShapes = [];
    for (const s of currentShapes) {
      const p = percentiles.find(p => p.experience_id === s.experience_id && p.day_of_week === s.day_of_week && p.hour === s.hour);
      if (p) {
        s.p50_wait = p.p50_wait;
        s.p90_wait = p.p90_wait;
        updatedShapes.push(s);
      }
    }
    await repo.upsertRideShapes(updatedShapes);
  }

  async function recomputeShowtimePatterns(now: Date) {
    if (typeof repo.getTrailingShowtimeSignals !== 'function') return;
    const sinceDate = new Date(now.getTime() - SHOWTIME_PATTERN_WINDOW_DAYS * 86400000);
    const rawSignals = await repo.getTrailingShowtimeSignals(sinceDate);
    if (!rawSignals || rawSignals.length === 0) return;

    const signals: RawShowtimeSignal[] = rawSignals.map((r) => ({
      experience_id: r.experience_id,
      date: typeof r.date === 'string' ? r.date.split('T')[0]! : (r.date instanceof Date ? r.date.toISOString().split('T')[0]! : String(r.date).split('T')[0]!),
      showtimes: Array.isArray(r.showtimes) ? (r.showtimes as unknown[]).map(String) : [],
    }));

    const patterns = deriveShowTimePatterns(signals);
    const distinctExpIds = Array.from(new Set(signals.map((s) => s.experience_id)));

    if (patterns.length > 0 && typeof repo.upsertShowTimePatterns === 'function') {
      await repo.upsertShowTimePatterns(patterns);
    }
    if (typeof repo.pruneStaleShowTimePatterns === 'function') {
      await repo.pruneStaleShowTimePatterns(distinctExpIds, patterns);
    }
  }
}
