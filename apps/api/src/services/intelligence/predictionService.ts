import type { IntelligenceRepo, ShowTimePatternRow } from './IntelligenceRepo.js';
import type { WeatherClient } from './weatherClient.js';
import { createLogger } from '../../logger.js';
import { wdwToday } from '../trips/wdwClock.js';
import { selectTier, crowdMultiplier, weatherAdjustment, displayLevel } from './waitMath.js';
import { forecastIndex, selectComparableIndices } from './crowdForecast.js';
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
  /** Returns the raw continuous forecast ratio (1.0 = typical, clamped to [0.4, 3.0]). */
  getRawForecast(park: string, date: Date): Promise<number>;
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
    return forecastIndex({
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
  }

  return {
    async getRawForecast(park: string, date: Date): Promise<number> {
      return computeRawForecast(park, date);
    },

    async getCrowdMultiplier(park: string, date: Date): Promise<number> {
      const raw = await computeRawForecast(park, date);
      return crowdMultiplier(raw, 1.0);
    },

    async getDaySnapshot(experienceIds: string[], park: string, date: Date): Promise<Record<string, WaitSnapshot>> {
      if (experienceIds.length === 0) return {};
      
      const multiplier = await this.getCrowdMultiplier(park, date);
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

        // Look up per-experience weather sensitivity from the real table
        const sensitivity = weatherSensMap.get(id) ?? null;

        const waits: { hour: number, predictedWaitMinutes: number, singleRiderWaitMinutes?: number }[] = [];
        for (let h = 0; h < 24; h++) {
          const shapeH = shapeRows.find(s => s.hour === h);
          const seasonH = seasonRows.find(s => s.hour === h);
          
          let sBuck = null;
          if (seasonH) sBuck = { wait: seasonH.avg_wait_minutes, sampleCount: seasonH.sample_count };
          
          let shBuck = null;
          if (shapeH) shBuck = { wait: shapeH.avg_wait_minutes };
          
          const wAdj = weatherAdjustment(sensitivity, forecastCondition ?? null);
          const rawWait = selectTier(sBuck, shBuck, expTypicalWait, multiplier);
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
      
      const rawForecast = await computeRawForecast(park, date);
      
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
