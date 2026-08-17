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

  async function recordLegOutcome(
    leg: string,
    outcome: { ok: true } | { ok: false; error: unknown }
  ): Promise<void> {
    if (typeof repo.recordDerivedStatRun !== 'function') return;
    try {
      await repo.recordDerivedStatRun(leg, outcome);
    } catch (recordErr) {
      logger.error({ err: recordErr, leg }, 'Failed to record derived stat run outcome');
    }
  }

  async function runLeg(
    leg: string,
    action: () => Promise<void>,
    legOutcomes: { leg: string; ok: boolean; error?: unknown }[]
  ): Promise<void> {
    try {
      await action();
      legOutcomes.push({ leg, ok: true });
      await recordLegOutcome(leg, { ok: true });
    } catch (err) {
      logger.error({ err }, `Failed ${leg}`);
      legOutcomes.push({ leg, ok: false, error: err });
      await recordLegOutcome(leg, { ok: false, error: err });
    }
  }
  
  return {
    async runDailyRecompute(): Promise<void> {
      const now = clock();
      const todayDateStr = wdwToday(now);
      const yesterday = new Date(new Date(`${todayDateStr}T12:00:00-04:00`).getTime() - 86400000);
      
      logger.info('Starting daily derived stats recompute');
      
      const legOutcomes: { leg: string; ok: boolean; error?: unknown }[] = [];

      try {
        await runLeg('reconcileForecasts', () => reconcileForecasts(yesterday), legOutcomes);
        await runLeg('captureForecasts', () => captureForecasts(now), legOutcomes);
        await runLeg('learnWeatherSensitivities', () => learnWeatherSensitivities(now), legOutcomes);
        await runLeg('recomputePercentiles', () => recomputePercentiles(), legOutcomes);
        await runLeg('recomputeShowtimePatterns', () => recomputeShowtimePatterns(now), legOutcomes);
        await runLeg(
          'pruneWeatherObservations',
          () => repo.pruneWeatherObservations(new Date(now.getTime() - WEATHER_OBSERVATION_RETENTION_DAYS * 86400000)),
          legOutcomes
        );

        const succeededLegs = legOutcomes.filter((o) => o.ok).map((o) => o.leg);
        const failedLegs = legOutcomes.filter((o) => !o.ok).map((o) => o.leg);

        if (failedLegs.length > 0) {
          logger.warn(
            { succeededLegs, failedLegs, total: legOutcomes.length },
            `Completed daily derived stats recompute with failures (${failedLegs.length}/${legOutcomes.length} legs failed)`
          );
        } else {
          logger.info(
            { succeededLegs, total: legOutcomes.length },
            'Completed daily derived stats recompute successfully'
          );
        }
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
      showtimes: r.showtimes,
    }));

    const patterns = deriveShowTimePatterns(signals, logger);
    const distinctExpIds = Array.from(new Set(signals.map((s) => s.experience_id)));

    if (patterns.length > 0 && typeof repo.upsertShowTimePatterns === 'function') {
      await repo.upsertShowTimePatterns(patterns);
    }
    if (typeof repo.pruneStaleShowTimePatterns === 'function') {
      await repo.pruneStaleShowTimePatterns(distinctExpIds, patterns);
    }
  }
}
