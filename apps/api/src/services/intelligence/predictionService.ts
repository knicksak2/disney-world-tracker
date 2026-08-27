import type { IntelligenceRepo, ShowTimePatternRow } from './IntelligenceRepo.js';
import type { WeatherClient } from './weatherClient.js';
import { createLogger } from '../../logger.js';
import { wdwToday } from '../trips/wdwClock.js';
import { selectTier, crowdMultiplier, weatherAdjustment, displayLevel } from './waitMath.js';
import { forecastIndex, selectComparableIndices } from './crowdForecast.js';
import { applyBiasCorrection } from './calibration.js';
import { seasonalPrior } from './seasonalPrior.js';
import { getETDayOfWeek, minutesFromMidnightETToISO, normalizeShowtimeEntries } from './showtimePatterns.js';
import type { WaitSnapshot, CrowdCalendarDayDTO, WaitInsightsDTO } from '@dwt/shared';
import type { Park } from '@dwt/shared';

export interface PredictionServiceDeps {
  repo: IntelligenceRepo;
  weatherClient: WeatherClient;
  now?: () => Date;
  logger?: any;
}

export interface PredictionService {
  getDaySnapshot(experienceIds: string[], park: string, date: Date): Promise<Record<string, WaitSnapshot>>;
  getCrowdMultiplier(park: string, date: Date): Promise<number>;
  getCrowdCalendarDay(park: string, date: Date): Promise<CrowdCalendarDayDTO>;
  /**
   * The UNCALIBRATED continuous forecast ratio (1.0 = typical, clamped to
   * [0.4, 3.0]) — the model's own output, with no measured bias applied.
   * This is what the wait path consumes (R7.7).
   */
  getRawForecast(park: string, date: Date): Promise<number>;

  /**
   * The forecast as PUBLISHED and SCORED: `getRawForecast` with the measured
   * systematic bias of R7.4 subtracted, bounded to the ratio band.
   *
   * Consumed by the Crowd Calendar's displayed index and by `captureForecasts`
   * — and by nothing on the wait path, so a crowd-level correction can never
   * move a wait prediction (R7.7).
   */
  getCalibratedForecast(park: string, date: Date): Promise<number>;
  getWaitInsights(experienceId: string, date: Date): Promise<WaitInsightsDTO | null>;
}

export function createPredictionService(deps: PredictionServiceDeps): PredictionService {
  const { repo } = deps;
  const logger = deps.logger ?? createLogger();
  const clock = deps.now ?? (() => new Date());

  /**
   * Computes the raw continuous forecast ratio for a park+date.
   * Returns a value on the ratio scale (1.0 = typical) clamped to [0.4, 3.0].
   * If today has enough live samples, returns the observed crowd_index directly.
   */
  async function computeRawForecast(park: string, date: Date): Promise<number> {
    const clockDateStr = wdwToday(clock());
    const dateStr = date.toISOString().split('T')[0]!;

    // Check if there is an exact observed or seeded index for this date
    const indices = await repo.getParkCrowdIndices(park, [date]);
    if (indices.length > 0) {
      const idx = indices[0]!;
      if (idx.crowd_index != null && (idx.source === 'seed' || idx.sample_count > 5 || dateStr <= clockDateStr)) {
        return idx.crowd_index;
      }
    }

    // Otherwise use forecast based on schedule and seasonal features
    const schedRows = await repo.getParkScheduleSignals(park, date, date);
    const s = schedRows.length > 0 ? schedRows[0]! : null;
    
    // Estimate open hours
    let openHours = 12;
    if (s && s.open_time && s.close_time) {
      openHours = (s.close_time.getTime() - s.open_time.getTime()) / 3600000;
    }
    
    const seasonVal = seasonalPrior(date.toISOString().split('T')[0]!);
    
    const targetDateEastern = new Date(`${date.toISOString().split('T')[0]!}T12:00:00-04:00`);
    
    const comparableRows = await repo.getComparableCrowdIndices(park, targetDateEastern);
    const comparables = selectComparableIndices(targetDateEastern, comparableRows);
    let historyEstimate: number | null = null;
    if (comparables.length > 0) {
      historyEstimate = comparables.reduce((a, b) => a + b, 0) / comparables.length;
    }
    
    // Live correction for today/tomorrow (R4.3)
    let biasCorrection = 0;
    const targetTime = date.getTime();
    const nowTime = clock().getTime();
    const diffHours = (targetTime - nowTime) / 3600000;
    if (diffHours >= -24 && diffHours <= 48) {
      const todayDate = new Date(`${clockDateStr}T00:00:00Z`);
      const indices = await repo.getParkCrowdIndices(park, [todayDate]);
      if (indices.length > 0 && indices[0]!.sample_count > 5) {
        const observedToday = indices[0]!.crowd_index;
        const todaySeasonVal = seasonalPrior(clockDateStr);
        // Approximation of today's baseline forecast
        const todayForecast = forecastIndex({
          typicalContinuous: 1.0,
          openHours: 12, typicalOpenHours: 12, extendedEvening: false,
          seasonalPriorValue: todaySeasonVal,
          comparableSampleCount: 0, biasCorrection: 0
        });
        biasCorrection = todayForecast - observedToday;
      }
    }
    
    // Use forecastIndex pure math
    const raw = forecastIndex({
      typicalContinuous: 1.0,
      llMultipassPrice: s?.ll_multipass_price_cents ? s.ll_multipass_price_cents / 100 : null,
      trailingMedianPrice: 25, // Fallback typical price
      openHours,
      typicalOpenHours: 12,
      extendedEvening: s?.extended_evening ?? false,
      seasonalPriorValue: seasonVal,
      historyEstimate,
      comparableSampleCount: comparables.length,
      biasCorrection
    });

    return raw;
  }

  /**
   * The forecast as PUBLISHED and SCORED: `computeRawForecast` with the measured
   * systematic bias of R7.4 subtracted.
   *
   * `reconcileForecasts` had been measuring per-(park, lead_days) bias since the
   * forecast log shipped and nothing consumed it. The bias is overwhelmingly
   * systematic rather than noise — Magic Kingdom ran MAE 0.266 against bias
   * +0.236 (~89% of its error), Animal Kingdom MAE 0.220 against -0.203 (~92%)
   * — so subtracting it is the largest crowd-accuracy gain available.
   *
   * Exactly two consumers use this, and they MUST agree: `getCrowdCalendarDay`'s
   * displayed index and `getCalibratedForecast` (which `captureForecasts`
   * freezes). If they diverged, published accuracy would describe a forecast no
   * user was ever shown, and the loop would not converge.
   *
   * Deliberately NOT used by the wait path — see R7.7 and the note on
   * `getCrowdMultiplier`.
   *
   * Distinct from the `biasCorrection` term inside `computeRawForecast`, which
   * is the R4.3 same-day live correction and carries no cross-date memory.
   */
  async function computeCalibratedForecast(park: string, date: Date): Promise<number> {
    const raw = await computeRawForecast(park, date);
    const measuredBias = await measuredBiasFor(park, date);
    if (measuredBias === null) return raw;
    return applyBiasCorrection(raw, measuredBias);
  }

  /**
   * Looks up the recency-weighted measured bias for a park at the lead time
   * closest to this target date's actual lead. Returns `null` when nothing has
   * been reconciled yet for that park, so an uncalibrated park is left alone
   * rather than corrected by a fabricated zero.
   */
  async function measuredBiasFor(park: string, date: Date): Promise<number | null> {
    try {
      const accuracies = await repo.getForecastAccuracies(park);
      const scored = accuracies.filter((a) => a.sample_count > 0 && Number.isFinite(a.bias));
      if (scored.length === 0) return null;

      const leadDays = Math.max(
        0,
        Math.round((date.getTime() - clock().getTime()) / 86400000),
      );

      // Accuracy is tracked only at the captured lead times, so pick the
      // nearest one rather than requiring an exact match.
      let best = scored[0]!;
      for (const candidate of scored) {
        if (
          Math.abs(candidate.lead_days - leadDays) < Math.abs(best.lead_days - leadDays)
        ) {
          best = candidate;
        }
      }
      return best.bias;
    } catch (err) {
      // Calibration is an improvement, never a dependency: an unavailable
      // accuracy store must degrade to the uncorrected forecast.
      logger.warn?.({ err, park }, 'Could not read forecast accuracy for bias correction');
      return null;
    }
  }

  return {
    async getRawForecast(park: string, date: Date): Promise<number> {
      return computeRawForecast(park, date);
    },

    async getCalibratedForecast(park: string, date: Date): Promise<number> {
      return computeCalibratedForecast(park, date);
    },

    /**
     * The crowd factor consumed by the WAIT path (Day Planning's optimizer,
     * `getWaitInsights`). Intentionally built from the UNCALIBRATED forecast per
     * R7.7.
     *
     * The R7.4 bias is measured against the observed Crowd_Index, a park-level
     * ratio. Magic Kingdom's +0.236 would shift every MK wait prediction by
     * ~24% — about 11 minutes on a 45-minute headliner, which exceeds that
     * model's own measured MAE of ~10 minutes on those rides. No evidence says
     * a crowd-derived correction improves waits, and a holdout test pointed the
     * other way: de-meaning the index raised wait MAE from 5.87 to 6.52 min.
     *
     * Revisit once R18's wait-forecast log can score both variants. Do NOT
     * "tidy" this onto the calibrated path before then.
     */
    async getCrowdMultiplier(park: string, date: Date): Promise<number> {
      const raw = await computeRawForecast(park, date);
      return crowdMultiplier(raw, 1.0);
    },

    async getDaySnapshot(experienceIds: string[], park: string, date: Date): Promise<Record<string, WaitSnapshot>> {
      if (experienceIds.length === 0) return {};
      
      // R15: tier 1 divides the forecast by the season bucket's own embedded
      // crowd level, so `selectTier` needs the RAW (unclamped) ratio — clamping
      // first would distort that quotient. `multiplier` is still derived here
      // for the single-rider projection, which scales a shape directly.
      const rawForecast = await computeRawForecast(park, date);
      const multiplier = crowdMultiplier(rawForecast, 1.0);
      const shapes = await repo.getRideShapes(experienceIds);
      const seasons = await repo.getSeasonHours(experienceIds);
      const signals = await repo.getExperienceSignals(experienceIds);
      
      const targetDateStr = date.toISOString().split('T')[0]!;
      const targetDateEastern = new Date(`${targetDateStr}T12:00:00-04:00`);
      const dow = targetDateEastern.getDay(); 
      
      // Fetch forecast weather condition for the target date
      let forecastCondition: string | undefined;
      try {
        const weather = await deps.weatherClient.getWDWWeather();
        forecastCondition = weather.forecast.find(f => f.date.toISOString().split('T')[0] === targetDateStr)?.condition;
      } catch (_err) {
        // proceed without weather if failed
      }
      
      // Batch-fetch weather sensitivities for the forecast condition
      let weatherSensMap = new Map<string, number>();
      if (forecastCondition) {
        const sensRows = await repo.getWeatherSensitivities(experienceIds, forecastCondition);
        for (const row of sensRows) {
          weatherSensMap.set(row.experience_id, row.wait_multiplier);
        }
      }
      
      // Per-date signals (showtimes, Lightning Lane) — populated for near-term/past dates;
      // empty for far-future dates (shows then fall back to typical showtimes).
      const dailyByExp = new Map<string, { showtimes: unknown; ll_price_cents: number | null; ll_available: boolean | null }>();
      try {
        const dailyRows = await repo.getExperienceDailySignals(experienceIds, new Date(targetDateStr));
        for (const d of dailyRows) dailyByExp.set(d.experience_id, d);
      } catch (_err) {
        // proceed without per-date signals
      }

      // Pattern fallback for typical showtimes when per-date showtimes are absent
      const patternsByExp = new Map<string, ShowTimePatternRow[]>();
      try {
        const patternRows = await repo.getShowTimePatterns(experienceIds, dow);
        for (const p of patternRows) {
          const list = patternsByExp.get(p.experience_id) ?? [];
          list.push(p);
          patternsByExp.set(p.experience_id, list);
        }
      } catch (_err) {
        // proceed without pattern fallback
      }

      const result: Record<string, WaitSnapshot> = {};
      
      for (const id of experienceIds) {
        const shapeRows = shapes.filter(s => s.experience_id === id && s.day_of_week === dow);
        const seasonRows = seasons.filter(s => s.experience_id === id && s.day_of_week === dow);
        const signal = signals.find(s => s.experience_id === id);
        
        // Fallback typical wait for this experience's tier selection
        let expTypicalWait = 30;
        if (shapeRows.length > 0) {
          const totalWait = shapeRows.reduce((sum, r) => sum + r.avg_wait_minutes, 0);
          expTypicalWait = totalWait / shapeRows.length;
        }

        // R16: the day-of-week-POOLED mean per hour — averaged across all seven
        // weekdays for this experience — is the shrinkage target for this
        // weekday's (typically thin) bucket. Distinct from `expTypicalWait`,
        // which averages one weekday across all hours. Built from the rows
        // already fetched above, so this costs no extra query.
        const pooledByHour = new Map<number, number>();
        {
          const sums = new Map<number, { total: number; count: number }>();
          for (const s of shapes) {
            if (s.experience_id !== id) continue;
            if (!(s.avg_wait_minutes > 0)) continue;
            const acc = sums.get(s.hour) ?? { total: 0, count: 0 };
            acc.total += s.avg_wait_minutes;
            acc.count += 1;
            sums.set(s.hour, acc);
          }
          for (const [hour, acc] of sums) {
            pooledByHour.set(hour, acc.total / acc.count);
          }
        }

        // Look up per-experience weather sensitivity from the real table
        const sensitivity = weatherSensMap.get(id) ?? null;

        const waits: { hour: number, predictedWaitMinutes: number, singleRiderWaitMinutes?: number }[] = [];
        for (let h = 0; h < 24; h++) {
          const shapeH = shapeRows.find(s => s.hour === h);
          const seasonH = seasonRows.find(s => s.hour === h);
          
          let sBuck = null;
          if (seasonH) {
            sBuck = {
              wait: seasonH.avg_wait_minutes,
              sampleCount: seasonH.sample_count,
              // R15: null here means "level unknown" and selectTier falls back
              // to the raw average rather than asserting 1.0.
              avgCrowdIndex: seasonH.avg_crowd_index,
            };
          }

          let shBuck = null;
          if (shapeH) shBuck = { wait: shapeH.avg_wait_minutes, sampleCount: shapeH.sample_count };

          const wAdj = weatherAdjustment(sensitivity, forecastCondition ?? null);
          const rawWait = selectTier({
            seasonBucket: sBuck,
            shapeBucket: shBuck,
            pooledWait: pooledByHour.get(h) ?? null,
            parkTypical: expTypicalWait,
            forecastIndex: rawForecast,
          });
          const adjustedWait = rawWait * wAdj;
          
          const entry: { hour: number, predictedWaitMinutes: number, singleRiderWaitMinutes?: number } = {
            hour: h,
            predictedWaitMinutes: Math.max(0, Math.round(adjustedWait)),
          };
          // Single-rider wait from the ride's single-rider shape (available for any date).
          if (shapeH && shapeH.sr_avg_wait_minutes != null) {
            entry.singleRiderWaitMinutes = Math.max(0, Math.round(shapeH.sr_avg_wait_minutes * multiplier * wAdj));
          }
          waits.push(entry);
        }
        
        const daily = dailyByExp.get(id);
        const { instants: perDateInstants, skipped: perDateSkipped } = normalizeShowtimeEntries(daily?.showtimes);
        if (perDateSkipped > 0 && logger?.warn) {
          logger.warn(
            { experienceId: id, date: targetDateStr, skipped: perDateSkipped },
            `getDaySnapshot skipped ${perDateSkipped} unparseable showtime entries for experience ${id}`,
          );
        }
        const hasPerDateShowtimes = perDateInstants.length > 0;

        let showtimes: readonly string[] | undefined;
        let showtimesAreTypical: boolean | undefined;

        if (hasPerDateShowtimes) {
          showtimes = perDateInstants;
        } else {
          const expPatterns = patternsByExp.get(id);
          if (expPatterns && expPatterns.length > 0) {
            expPatterns.sort((a, b) => a.start_minutes - b.start_minutes);
            showtimes = expPatterns.map((p) => minutesFromMidnightETToISO(targetDateStr, p.start_minutes));
            showtimesAreTypical = true;
          }
        }
        
        result[id] = {
          experienceId: id,
          isVirtualQueue: signal?.uses_virtual_queue ?? false,
          waits,
          ...(showtimes && showtimes.length > 0 ? { showtimes } : {}),
          ...(showtimesAreTypical ? { showtimesAreTypical: true } : {}),
          ...(daily ? {
            lightningLane: {
              available: daily.ll_available ?? false,
              ...(daily.ll_price_cents != null ? { priceCents: daily.ll_price_cents } : {}),
            },
          } : {}),
        };
      }
      
      return result;
    },

    async getCrowdCalendarDay(park: string, date: Date): Promise<CrowdCalendarDayDTO> {
      const schedule = await repo.getParkScheduleSignals(park, date, date);
      const s = schedule.length > 0 ? schedule[0] : null;

      // PUBLISHED value — calibrated (R7.4). `captureForecasts` freezes this
      // same number via `getCalibratedForecast`, so the accuracy we later report
      // describes the forecast the user actually saw (R7.1 / Property 19.1).
      const rawForecast = await computeCalibratedForecast(park, date);
      
      const dateStr = date.toISOString().split('T')[0]!;
      let defaultOpenHour = 9;
      let defaultCloseHour = 21;
      if (park === 'Magic Kingdom') {
        defaultOpenHour = 9;
        defaultCloseHour = 22;
      } else if (park === 'Animal Kingdom') {
        defaultOpenHour = 8;
        defaultCloseHour = 18;
      }

      const defaultOpenTime = new Date(`${dateStr}T${String(defaultOpenHour).padStart(2, '0')}:00:00-04:00`).toISOString();
      const defaultCloseTime = new Date(`${dateStr}T${String(defaultCloseHour).padStart(2, '0')}:00:00-04:00`).toISOString();

      const openTime = s?.open_time ? s.open_time.toISOString() : defaultOpenTime;
      const closeTime = s?.close_time ? s.close_time.toISOString() : defaultCloseTime;

      // R7.5 — predicted-versus-actual, honestly.
      //
      // `observedIndex` is only set once the day has closed and its index is
      // finalized; before that there is no "actual" to compare against.
      // `capturedForecast` comes from the FROZEN log, not from recomputing the
      // forecast now: today's forecast for a past date can see the observed
      // index and return it verbatim, so a recomputed value would make the
      // model look perfect. `forecastAccuracy` attaches the measured error at
      // the same lead time so the claim carries its own error bar.
      let observedIndex: number | undefined;
      let capturedForecast:
        | { index: number; leadDays: number; capturedAt: string }
        | undefined;
      let forecastAccuracy:
        | { meanAbsoluteErrorLevels: number; leadDays: number; sampleCount: number }
        | undefined;

      const isPastOrToday = dateStr <= wdwToday(clock());
      if (isPastOrToday) {
        try {
          const observedRows = await repo.getParkCrowdIndices(park, [date]);
          const observedRow = observedRows.find(
            (r) => r.source === 'observed' && r.crowd_index != null && r.sample_count > 0,
          );
          if (observedRow) {
            observedIndex = displayLevel(observedRow.crowd_index);
          }
        } catch (_err) {
          // Predicted-vs-actual is a transparency extra, never a hard dependency.
        }

        if (typeof repo.getCapturedForecast === 'function') {
          try {
            const captured = await repo.getCapturedForecast(park, date);
            if (captured && Number.isFinite(captured.forecast_index)) {
              capturedForecast = {
                index: displayLevel(captured.forecast_index),
                leadDays: captured.lead_days,
                capturedAt: new Date(captured.forecasted_at).toISOString(),
              };

              if (typeof repo.getForecastAccuracies === 'function') {
                const accuracies = await repo.getForecastAccuracies(park);
                const match = accuracies.find(
                  (a) => a.lead_days === captured.lead_days && a.sample_count > 0,
                );
                if (match) {
                  forecastAccuracy = {
                    // A ratio-scale MAE times 5 is the same error in display
                    // levels (displayLevel is round(5 x ratio)).
                    meanAbsoluteErrorLevels: Math.round(match.mae * 5 * 10) / 10,
                    leadDays: match.lead_days,
                    sampleCount: match.sample_count,
                  };
                }
              }
            }
          } catch (_err) {
            // Same: absence of the log must not fail the calendar read.
          }
        }
      }

      // Populate rideSignals for experiences in this park
      let rideSignals: Array<{
        experienceId: string;
        reliability: number;
        llSelloutMedianHour?: number;
        showtimes?: readonly string[];
      }> | undefined;

      if (typeof repo.getExperiencesByPark === 'function') {
        const exps = await repo.getExperiencesByPark(park);
        const expIds = exps.map((e) => e.id);

        if (expIds.length > 0) {
          const signals = typeof repo.getExperienceSignals === 'function' ? await repo.getExperienceSignals(expIds) : [];
          const signalsMap = new Map(signals.map((sig) => [sig.experience_id, sig]));

          const dailyRows = typeof repo.getExperienceDailySignals === 'function' ? await repo.getExperienceDailySignals(expIds, new Date(dateStr)) : [];
          const dailyMap = new Map(dailyRows.map((d) => [d.experience_id, d]));

          const dow = getETDayOfWeek(dateStr);
          const patternRows = typeof repo.getShowTimePatterns === 'function' ? await repo.getShowTimePatterns(expIds, dow) : [];
          const patternMap = new Map<string, ShowTimePatternRow[]>();
          for (const p of patternRows) {
            const list = patternMap.get(p.experience_id) ?? [];
            list.push(p);
            patternMap.set(p.experience_id, list);
          }

          rideSignals = exps.map((e) => {
            const sig = signalsMap.get(e.id);
            const daily = dailyMap.get(e.id);
            const reliability = 1 - (sig?.downtime_rate ?? 0);

            const { instants: perDateInstants, skipped: perDateSkipped } = normalizeShowtimeEntries(daily?.showtimes);
            if (perDateSkipped > 0 && logger?.warn) {
              logger.warn(
                { experienceId: e.id, date: dateStr, skipped: perDateSkipped },
                `getCrowdCalendarDay skipped ${perDateSkipped} unparseable showtime entries for experience ${e.id}`,
              );
            }
            const hasPerDateShowtimes = perDateInstants.length > 0;

            let showtimes: readonly string[] | undefined;
            if (hasPerDateShowtimes) {
              showtimes = perDateInstants;
            } else {
              const expPatterns = patternMap.get(e.id);
              if (expPatterns && expPatterns.length > 0) {
                expPatterns.sort((a, b) => a.start_minutes - b.start_minutes);
                showtimes = expPatterns.map((p) => minutesFromMidnightETToISO(dateStr, p.start_minutes));
              }
            }


            return {
              experienceId: e.id,
              reliability,
              ...(sig?.ll_sellout_median_hour != null ? { llSelloutMedianHour: sig.ll_sellout_median_hour } : {}),
              ...(showtimes && showtimes.length > 0 ? { showtimes } : {}),
            };
          });
        }
      }

      return {
        date: dateStr,
        park: park as Park,
        forecastIndex: displayLevel(rawForecast),
        ...(observedIndex != null ? { observedIndex } : {}),
        ...(capturedForecast ? { capturedForecast } : {}),
        ...(forecastAccuracy ? { forecastAccuracy } : {}),
        parkHours: {
          openTime,
          closeTime,
        },
        earlyEntry: s?.early_entry ?? false,
        extendedEvening: s?.extended_evening ?? false,
        ticketedEvent: s?.ticketed_event ?? false,
        ...(s?.ll_multipass_price_cents != null ? { llMultipassPriceCents: s.ll_multipass_price_cents } : {}),
        ...(rideSignals && rideSignals.length > 0 ? { rideSignals } : {}),
      };
    },

    async getWaitInsights(experienceId: string, date: Date): Promise<WaitInsightsDTO | null> {
      const shapes = await repo.getRideShapes([experienceId]);
      const targetDateEastern = new Date(`${date.toISOString().split('T')[0]!}T12:00:00-04:00`);
      const dow = targetDateEastern.getDay();
      const shape = shapes.filter(s => s.day_of_week === dow).sort((a, b) => a.hour - b.hour);

      const signals = await repo.getExperienceSignals([experienceId]);
      const signal = signals.length > 0 ? signals[0] : null;

      // Resolve the ride's park from experiences.park (never a hardcoded default).
      const park = await repo.getExperiencePark(experienceId);
      if (!park) return null;

      // Compute crowd multiplier for this date
      const multiplier = await this.getCrowdMultiplier(park, targetDateEastern);

      // LL price for the decision helper from the park's schedule signal for this date.
      const scheduleSignals = await repo.getParkScheduleSignals(park, targetDateEastern, targetDateEastern);
      const scheduleSignal = scheduleSignals.length > 0 ? scheduleSignals[0] : null;

      const hourlyWaits = shape.map(s => ({
        hour: s.hour,
        predictedWaitMinutes: Math.round(s.avg_wait_minutes * multiplier),
      }));

      const best = hourlyWaits.length > 0 ? hourlyWaits.reduce((prev, curr) => curr.predictedWaitMinutes < prev.predictedWaitMinutes ? curr : prev) : undefined;
      const worst = hourlyWaits.length > 0 ? hourlyWaits.reduce((prev, curr) => curr.predictedWaitMinutes > prev.predictedWaitMinutes ? curr : prev) : undefined;
      const escalation = hourlyWaits.length >= 2 ? hourlyWaits[1]!.predictedWaitMinutes - hourlyWaits[0]!.predictedWaitMinutes : undefined;

      // Day-representative percentiles over the day's operating-hour buckets (not a single hour).
      const sortedWaits = hourlyWaits.map(h => h.predictedWaitMinutes).sort((a, b) => a - b);
      const p50WaitMinutes = sortedWaits.length > 0 ? sortedWaits[Math.floor(sortedWaits.length / 2)]! : 0;
      const p90WaitMinutes = sortedWaits.length > 0 ? sortedWaits[Math.floor(sortedWaits.length * 0.9)]! : 0;

      // Confidence signals aggregated across the day's buckets (drive the UI verdict tone, R11.11) —
      // NOT read from a single arbitrary hour bucket.
      const totalSamples = shape.reduce((sum, s) => sum + s.sample_count, 0);
      let cvWeightedSum = 0;
      let cvWeight = 0;
      for (const s of shape) {
        if (s.avg_wait_minutes > 0 && s.sample_count > 0) {
          cvWeightedSum += (s.stddev_wait / s.avg_wait_minutes) * s.sample_count;
          cvWeight += s.sample_count;
        }
      }
      const cv = cvWeight > 0 ? cvWeightedSum / cvWeight : 0;

      // Ride-level reliability: prefer the rolling experience signal, else the mean bucket down rate.
      let downRate: number;
      if (signal?.downtime_rate != null) {
        downRate = signal.downtime_rate;
      } else if (shape.length > 0) {
        downRate = shape.reduce((sum, s) => sum + s.down_rate, 0) / shape.length;
      } else {
        downRate = 0;
      }

      // Single-rider estimate: median of the single-rider hourly means (scaled to the date) where offered.
      const srWaits = shape
        .filter(s => s.sr_avg_wait_minutes != null && (s.sr_sample_count ?? 0) > 0)
        .map(s => Math.round(s.sr_avg_wait_minutes! * multiplier))
        .sort((a, b) => a - b);
      const singleRiderP50 = srWaits.length > 0 ? srWaits[Math.floor(srWaits.length / 2)]! : undefined;

      // Note: event/cascade highlights are skipped for now per Task 4 status
      return {
        experienceId,
        p50WaitMinutes,
        p90WaitMinutes,
        cv,
        downRate,
        ...(best != null ? { bestHour: best.hour } : {}),
        ...(worst != null ? { worstHour: worst.hour } : {}),
        ...(escalation != null ? { escalationRate: escalation } : {}),
        ...(signal?.ll_sellout_median_hour != null ? { llSelloutMedianHour: signal.ll_sellout_median_hour } : {}),
        waits: hourlyWaits,
        sampleCount: totalSamples,
        hasSingleRider: signal?.has_single_rider ?? (srWaits.length > 0),
        ...(singleRiderP50 != null ? { singleRiderP50WaitMinutes: singleRiderP50 } : {}),
        ...(scheduleSignal?.ll_multipass_price_cents != null ? { llMultipassPriceCents: scheduleSignal.ll_multipass_price_cents } : {}),
      };
    }
  };
}
