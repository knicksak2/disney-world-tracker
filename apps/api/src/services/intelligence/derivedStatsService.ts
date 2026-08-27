import { createLogger } from '../../logger.js';
import type {
  IntelligenceRepo,
  ExperienceWeatherSensitivityRow,
  WaitForecastLogRow,
  WaitForecastAccuracyRow,
} from './IntelligenceRepo.js';
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

/**
 * R17: how far back the archive leg re-aggregates each run.
 *
 * Wider than one day on purpose. `wait_samples` is pruned at 30 days, so a day
 * that is never archived before its raw rows expire loses its day-to-day
 * variation permanently — and that variation is the entire reason the archive
 * exists. A 7-day window means the recompute can miss six consecutive days
 * (Render sleeping, a cron outage, a failed leg) and still lose nothing. The
 * aggregation is a single server-side GROUP BY over a bounded window, so the
 * extra days cost almost nothing.
 */
const WAIT_ARCHIVE_LOOKBACK_DAYS = 7;

/** R17.4: ~3 years of hourly aggregates, bounded for the Postgres free tier. */
const WAIT_ARCHIVE_RETENTION_DAYS = 1100;

/**
 * R18: lead times at which wait predictions are frozen for scoring.
 *
 * Shorter than the crowd forecast's `[30, 14, 7, 3, 1]` because wait predictions
 * are consumed for touring decisions days out, not a month out, and because a
 * 30-day-old wait prediction would be scored against a model that has since
 * re-learned the ride's shape several times over.
 */
const WAIT_FORECAST_LEAD_DAYS = [7, 3, 1] as const;

/**
 * Eastern hours sampled for scoring: mid-morning, early afternoon, late
 * afternoon, evening. Four points span the intra-day curve's shape (the climb,
 * the peak, the plateau, the evening fall) without logging all 24 hours for
 * every ride.
 */
const WAIT_FORECAST_HOURS = [10, 13, 16, 19] as const;

/**
 * R18.2: how many Experiences to track, ranked by frozen Ride_Baseline.
 *
 * 40 covers every headliner across the four parks — the rides where a 10-minute
 * error actually changes a plan. Bounded so the store stays trivial: 40 x 4
 * hours x 3 leads = 480 rows per capture day.
 */
const WAIT_FORECAST_MAX_EXPERIENCES = 40;

/** R18.7: retention for scored wait-forecast rows. */
const WAIT_FORECAST_RETENTION_DAYS = 180;

/**
 * R7.6: retention for scored crowd-forecast rows.
 *
 * Longer than the wait log because these rows are the only record of what the
 * calendar actually published for a past date (R7.5), so they back the
 * predicted-versus-actual display as well as the accuracy summary. Unscored rows
 * are never pruned — losing one before it can be reconciled would silently drop
 * a sample from the calibration loop.
 */
const CROWD_FORECAST_RETENTION_DAYS = 400;

/** R18.4 / R7.3: the shared capped-alpha weight for a rolling accuracy summary. */
const ACCURACY_EMA_MAX_SAMPLES = 100;

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
        // Archive BEFORE the wait-forecast legs: reconciliation reads its
        // observed values out of `wait_archive` (R18.3), so yesterday must be
        // archived before it can be scored.
        await runLeg('archiveWaitSamples', () => archiveWaitSamples(now), legOutcomes);
        await runLeg(
          'pruneWaitArchive',
          () => pruneWaitArchive(now),
          legOutcomes
        );
        await runLeg('pruneCrowdForecastLog', () => pruneCrowdForecastLog(now), legOutcomes);
        await runLeg('reconcileWaitForecasts', () => reconcileWaitForecasts(now), legOutcomes);
        await runLeg('captureWaitForecasts', () => captureWaitForecasts(now), legOutcomes);
        await runLeg('pruneWaitForecastLog', () => pruneWaitForecastLog(now), legOutcomes);

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

  /**
   * R17: fold recent raw `wait_samples` into the bounded `wait_archive`.
   *
   * This exists because `wait_samples` prunes at 30 days, which permanently
   * discards the day-to-day variation any future day-level model would train on.
   * The backtest put the reachable headroom for wait prediction almost entirely
   * in that day-level signal (a 5.58-minute ceiling for ride/hour/weekday
   * features against a 2.95-minute noise floor), so the data being deleted is
   * precisely the data that matters most.
   *
   * The archive is write-only with respect to prediction: nothing on the
   * prediction path reads it, and a test asserts `getDaySnapshot` is unchanged by
   * its contents (R17.5).
   */
  async function archiveWaitSamples(now: Date) {
    if (typeof repo.archiveWaitSamples !== 'function') return;
    const since = new Date(now.getTime() - WAIT_ARCHIVE_LOOKBACK_DAYS * 86400000);
    const written = await repo.archiveWaitSamples(since);
    logger.info(
      { since: since.toISOString(), rowsWritten: written, lookbackDays: WAIT_ARCHIVE_LOOKBACK_DAYS },
      `Archived ${written} wait_archive rows`,
    );
  }

  /** R17.4: keep the archive bounded. */
  async function pruneWaitArchive(now: Date) {
    if (typeof repo.pruneWaitArchive !== 'function') return;
    await repo.pruneWaitArchive(
      new Date(now.getTime() - WAIT_ARCHIVE_RETENTION_DAYS * 86400000),
    );
  }

  /**
   * R18.1/R18.2: freeze wait predictions for the tracked Experiences at each
   * lead time and hour.
   *
   * This is the piece that makes wait accuracy answerable at all. Until it
   * existed, the only way to learn the model's error was to reconstruct a
   * holdout by hand from raw samples — which also meant the answer could only
   * ever be retrospective and in-sample-ish, never a genuine forward score.
   *
   * `getDaySnapshot` is called once per (park, lead) rather than per experience:
   * it already returns all 24 hours for a whole batch of Experiences, so 4 parks
   * x 3 leads is 12 calls regardless of how many rides are tracked.
   */
  async function captureWaitForecasts(now: Date) {
    if (
      typeof repo.getTopExperiencesByBaseline !== 'function' ||
      typeof repo.upsertWaitForecastLogs !== 'function'
    ) {
      return;
    }

    const tracked = await repo.getTopExperiencesByBaseline(WAIT_FORECAST_MAX_EXPERIENCES);
    if (tracked.length === 0) {
      logger.info('No experiences with an established baseline yet; skipping wait forecast capture');
      return;
    }

    const byPark = new Map<string, string[]>();
    for (const row of tracked) {
      const list = byPark.get(row.park) ?? [];
      list.push(row.experience_id);
      byPark.set(row.park, list);
    }

    const todayStr = wdwToday(now);
    const todayEastern = new Date(`${todayStr}T12:00:00-04:00`);
    const logs: WaitForecastLogRow[] = [];

    for (const [park, experienceIds] of byPark) {
      for (const lead of WAIT_FORECAST_LEAD_DAYS) {
        const targetDate = new Date(todayEastern.getTime() + lead * 86400000);
        try {
          const snapshot = await deps.predictionService.getDaySnapshot(
            experienceIds,
            park,
            targetDate,
          );
          for (const experienceId of experienceIds) {
            const waits = snapshot[experienceId]?.waits;
            if (!waits) continue;
            for (const hour of WAIT_FORECAST_HOURS) {
              const entry = waits.find((w) => w.hour === hour);
              if (!entry || !Number.isFinite(entry.predictedWaitMinutes)) continue;
              logs.push({
                experience_id: experienceId,
                date: targetDate,
                hour,
                lead_days: lead,
                predicted_wait_minutes: entry.predictedWaitMinutes,
                forecasted_at: now,
                // R18.5: no challenger model is configured yet. The column exists
                // so one can be scored in shadow without touching the served path.
                challenger_wait_minutes: null,
                observed_wait_minutes: null,
                error: null,
                challenger_error: null,
              });
            }
          }
        } catch (err) {
          // One park/lead failing must not lose the rest of the capture.
          logger.warn({ err, park, lead }, 'Failed to capture wait forecast for park/lead');
        }
      }
    }

    await repo.upsertWaitForecastLogs(logs);
    logger.info(
      { tracked: tracked.length, parks: byPark.size, rows: logs.length },
      `Captured ${logs.length} wait forecast rows across ${tracked.length} experiences`,
    );
  }

  /**
   * R18.3/R18.4: score frozen wait predictions against what actually happened.
   *
   * Observed values come from `wait_archive`, not `wait_samples`, so scoring
   * still works once the 30-day raw prune has run — a 7-day-lead prediction made
   * five weeks ago is still reconcilable.
   *
   * Only whole elapsed days are scored (`date < today` in ET), so every logged
   * hour is guaranteed to be in the past.
   */
  async function reconcileWaitForecasts(now: Date) {
    if (
      typeof repo.getWaitForecastLogsToReconcile !== 'function' ||
      typeof repo.getWaitArchiveHours !== 'function' ||
      typeof repo.updateWaitForecastReconciliation !== 'function'
    ) {
      return;
    }

    const todayStr = wdwToday(now);
    const todayEastern = new Date(`${todayStr}T12:00:00-04:00`);
    const lastFullDay = new Date(todayEastern.getTime() - 86400000);

    const pending = await repo.getWaitForecastLogsToReconcile(lastFullDay);
    if (pending.length === 0) return;

    const experienceIds = Array.from(new Set(pending.map((p) => p.experience_id)));
    const dates = pending.map((p) => new Date(p.date).getTime());
    const observed = await repo.getWaitArchiveHours(
      experienceIds,
      new Date(Math.min(...dates)),
      new Date(Math.max(...dates)),
    );

    const observedByKey = new Map<string, number>();
    for (const row of observed) {
      observedByKey.set(
        `${row.experience_id}|${new Date(row.date).toISOString().split('T')[0]}|${row.hour}`,
        row.avg_wait_minutes,
      );
    }

    const updates: Array<{
      experience_id: string;
      date: Date;
      hour: number;
      lead_days: number;
      observed_wait_minutes: number;
      error: number;
      challenger_error: number | null;
    }> = [];

    // Accuracy is accumulated in memory across this batch, then written once.
    const accuracies = typeof repo.getWaitForecastAccuracies === 'function'
      ? await repo.getWaitForecastAccuracies(experienceIds)
      : [];
    const accByKey = new Map<string, WaitForecastAccuracyRow>();
    for (const a of accuracies) accByKey.set(`${a.experience_id}|${a.lead_days}`, { ...a });

    let unmatched = 0;
    for (const log of pending) {
      const dateStr = new Date(log.date).toISOString().split('T')[0];
      const observedWait = observedByKey.get(`${log.experience_id}|${dateStr}|${log.hour}`);
      if (observedWait === undefined) {
        // The ride may simply not have been operating that hour. Leave the row
        // unreconciled rather than inventing a zero — a closed ride is not a
        // 0-minute wait, and scoring it as one would bias the summary downward.
        unmatched++;
        continue;
      }

      const error = log.predicted_wait_minutes - observedWait;
      const challengerError =
        log.challenger_wait_minutes != null ? log.challenger_wait_minutes - observedWait : null;

      updates.push({
        experience_id: log.experience_id,
        date: new Date(log.date),
        hour: log.hour,
        lead_days: log.lead_days,
        observed_wait_minutes: observedWait,
        error,
        challenger_error: challengerError,
      });

      const key = `${log.experience_id}|${log.lead_days}`;
      const acc = accByKey.get(key) ?? {
        experience_id: log.experience_id,
        lead_days: log.lead_days,
        mae: 0,
        bias: 0,
        sample_count: 0,
        challenger_mae: null,
        challenger_bias: null,
        challenger_sample_count: 0,
      };

      const weight = 2 / (Math.min(acc.sample_count, ACCURACY_EMA_MAX_SAMPLES) + 2);
      const updated = updateAccuracy(
        { mae: acc.mae, bias: acc.bias, sampleCount: acc.sample_count },
        error,
        weight,
      );
      acc.mae = updated.mae;
      acc.bias = updated.bias;
      acc.sample_count = updated.sampleCount;

      // R18.5: the challenger keeps its OWN tally so it can never contaminate
      // the served model's numbers.
      if (challengerError !== null) {
        const cWeight = 2 / (Math.min(acc.challenger_sample_count, ACCURACY_EMA_MAX_SAMPLES) + 2);
        const cUpdated = updateAccuracy(
          {
            mae: acc.challenger_mae ?? 0,
            bias: acc.challenger_bias ?? 0,
            sampleCount: acc.challenger_sample_count,
          },
          challengerError,
          cWeight,
        );
        acc.challenger_mae = cUpdated.mae;
        acc.challenger_bias = cUpdated.bias;
        acc.challenger_sample_count = cUpdated.sampleCount;
      }

      accByKey.set(key, acc);
    }

    await repo.updateWaitForecastReconciliation(updates);
    if (typeof repo.upsertWaitForecastAccuracies === 'function') {
      await repo.upsertWaitForecastAccuracies(Array.from(accByKey.values()));
    }

    logger.info(
      { reconciled: updates.length, unmatched, pending: pending.length },
      `Reconciled ${updates.length} wait forecasts (${unmatched} had no observed hour)`,
    );
  }

  /** R7.6: keep the crowd-forecast log bounded, scored rows only. */
  async function pruneCrowdForecastLog(now: Date) {
    if (typeof repo.pruneCrowdForecastLog !== 'function') return;
    await repo.pruneCrowdForecastLog(
      new Date(now.getTime() - CROWD_FORECAST_RETENTION_DAYS * 86400000),
    );
  }

  /** R18.7: keep the wait-forecast log bounded, scored rows only. */
  async function pruneWaitForecastLog(now: Date) {
    if (typeof repo.pruneWaitForecastLog !== 'function') return;
    await repo.pruneWaitForecastLog(
      new Date(now.getTime() - WAIT_FORECAST_RETENTION_DAYS * 86400000),
    );
  }

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
          // Freeze the CALIBRATED forecast — the same continuous value the
          // calendar publishes (R7.1 / R7.7). Accuracy must be measured against
          // the forecast as issued, so capturing the uncalibrated model output
          // while displaying the corrected one would score a number no user saw
          // and the calibration loop would never converge. Still no display
          // round-trip: this is the continuous ratio, not displayLevel.
          const rawForecast = await deps.predictionService.getCalibratedForecast(parkKey, targetDate);
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
