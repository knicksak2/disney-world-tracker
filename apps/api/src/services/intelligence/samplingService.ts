import { createLogger } from '../../logger.js';
import type { 
  IntelligenceRepo, 
  WaitSampleRow, 
  ScheduleSignalRow, 
  DailySignalRow,
  RideShapeRow,
  SeasonHourRow,
  ExperienceSignalRow
} from './IntelligenceRepo.js';
import type { ThemeParksLiveClient } from '../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../catalog/themeparks.js';
import type { ThemeParksDirectory } from '../live/themeParksDirectory.js';
import type { WeatherClient } from './weatherClient.js';
import type { DerivedStatsService } from './derivedStatsService.js';
import { wdwToday } from '../trips/wdwClock.js';
import {
  applyEma,
  emaVariance,
  isStandbyBasketEntry,
  relativeCrowdIndex,
  establishBaseline,
  isBaselineEstablished,
  shapeEmaWeight,
} from './waitMath.js';
import type { RelativeCrowdRide } from './waitMath.js';


/**
 * Minimum spacing between sampling passes (start-to-start), a debounce against
 * accidental rapid re-fires. Kept well below the ~10-minute cron cadence so a
 * legitimate 10-minute tick always clears it; must never equal the trigger
 * interval (see the throttle in `runSamplingPass`).
 */
const MIN_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The Crowd_Index is a theme-park concept derived from posted standby waits.
 * Water parks (Blizzard Beach, Typhoon Lagoon) do not post standby waits via the
 * live feed, so a naive index over their "operating, 0-wait" entries collapses to
 * a meaningless ~1.0. Restrict Crowd_Index to the four WDW theme parks (values
 * match `experiences.park`). Ride shapes/signals are still collected for any park.
 */
const CROWD_INDEX_PARKS = new Set<string>([
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
]);

export interface SamplingServiceDeps {
  repo: IntelligenceRepo;
  liveClient: ThemeParksLiveClient;
  catalogClient: ThemeParksClient;
  directory: ThemeParksDirectory;
  weatherClient: WeatherClient;
  derivedStatsService?: DerivedStatsService;
  logger?: any;
  now?: () => Date;
}

export interface SamplingService {
  runSamplingPass(): Promise<void>;
}

export function createSamplingService(deps: SamplingServiceDeps): SamplingService {
  const logger = deps.logger ?? createLogger();
  const { repo, liveClient, catalogClient, directory, weatherClient } = deps;
  const clock = deps.now ?? (() => new Date());
  
  let isRunning = false;
  let lastSampleStart = 0;
  let lastRecomputeTime = 0;
  
  return {
    async runSamplingPass(): Promise<void> {
      if (isRunning) {
        logger.debug('Sampling pass already running, skipping overlap');
        return;
      }
      
      const now = clock();
      // Debounce accidental rapid re-fires, measured start-to-start. This MUST
      // stay safely below the cron cadence (~10 min): if the throttle window
      // equals the trigger interval, clock/pass-duration jitter pushes every
      // alternate cron hit just under the window and halves the effective
      // sampling rate. Stamping from the pass START (not completion) makes the
      // interval independent of how long a pass takes.
      if (now.getTime() - lastSampleStart < MIN_SAMPLE_INTERVAL_MS) {
        logger.debug('Sampling pass throttled (min-interval debounce)');
        return;
      }
      
      isRunning = true;
      lastSampleStart = now.getTime();
      try {
        await executePass(now);
      } catch (err) {
        logger.error({ err }, 'Sampling pass failed fatally');
      } finally {
        isRunning = false;
      }
    }
  };

  async function executePass(now: Date) {
    try {
      const weather = await weatherClient.getWDWWeather();
      if (weather.current) {
        await repo.upsertWeatherObservations([weather.current]);
      }
    } catch (err) {
      logger.warn({ err }, 'Weather sampling failed');
    }

    // Daily recomputes (Task 4.5)
    if (deps.derivedStatsService && now.getTime() - lastRecomputeTime > 86400000) {
      lastRecomputeTime = now.getTime();
      deps.derivedStatsService.runDailyRecompute().catch(err => {
        logger.error({ err }, 'Failed daily recompute');
      });
    }

    let wdwParks: {id: string, name: string}[] = [];
    try {
      const { destinations } = await catalogClient.getDestinations();
      const wdw = destinations.find(d => /walt disney world/i.test(d.name));
      if (wdw && wdw.parks) {
        wdwParks = [...wdw.parks];
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch destinations for sampling');
      return;
    }

    const experiences = await repo.getExperiencesWithUpstreamIds();

    // Build ThemeParks GUID → DB experience ID map
    const tpIdToDbId = new Map<string, string>();
    let unresolvedCount = 0;
    for (const exp of experiences) {
      try {
        const tpId = await directory.resolveEntityId(exp.upstream_entity_id);
        if (tpId) {
          tpIdToDbId.set(tpId, exp.id);
        } else {
          unresolvedCount++;
          logger.debug({ upstreamEntityId: exp.upstream_entity_id, experienceId: exp.id }, 'Could not resolve entity ID for experience');
        }
      } catch (err) {
        unresolvedCount++;
        logger.debug({ err, upstreamEntityId: exp.upstream_entity_id, experienceId: exp.id }, 'Failed to resolve entity ID for experience');
      }
    }

    // Build DB experience ID → canonical Park (from experiences.park)
    const dbIdToPark = new Map<string, string>();
    for (const exp of experiences) {
      dbIdToPark.set(exp.id, exp.park);
    }

    const dateStr = wdwToday(now);
    // Use mid-day Eastern to get correct Date object for DOW logic
    const currentDate = new Date(`${dateStr}T12:00:00-04:00`);
    const currentDow = currentDate.getDay(); 
    // 0-23 hour of day in America/New_York
    const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
    const currentHour = parseInt(hourFormatter.format(now), 10);
    // Simple 4-season approximation based on month (0-3)
    const currentSeason = Math.floor(currentDate.getMonth() / 3);

    const allDbIds = Array.from(tpIdToDbId.values());
    const existingShapes = await repo.getRideShapes(allDbIds);
    const existingSeasons = await repo.getSeasonHours(allDbIds);
    const existingSignals = await repo.getExperienceSignals(allDbIds);
    
    const unmappedStandbyEntries = new Map<string, { id: string; name: string; waitTime: number }>();
    let totalWaitSamplesRecorded = 0;
    let parksSampledCount = 0;

    for (const park of wdwParks) {
      try {
        const liveRes = await liveClient.getEntityLive(park.id);

        for (const entry of liveRes.liveData) {
          if (!entry.id) continue;
          if (!tpIdToDbId.has(entry.id)) {
            const standbyWait = entry.queue?.STANDBY?.waitTime;
            if (typeof standbyWait === 'number' && !Number.isNaN(standbyWait)) {
              unmappedStandbyEntries.set(entry.id, {
                id: entry.id,
                name: entry.name ?? entry.id,
                waitTime: standbyWait,
              });
            }
          }
        }

        // Determine canonical Park from experiences.park (not from ThemeParks display name).
        // Pick the canonical park from the first matched experience in this park's live data.
        let canonicalPark: string | null = null;
        for (const entry of liveRes.liveData) {
          if (!entry.id) continue;
          const expId = tpIdToDbId.get(entry.id);
          if (expId) {
            canonicalPark = dbIdToPark.get(expId) ?? null;
            if (canonicalPark) break;
          }
        }
        if (!canonicalPark) {
          logger.debug({ tpPark: park.name }, 'No mapped experiences for park, skipping');
          continue;
        }

        parksSampledCount++;

        const schedRes = await liveClient.getEntitySchedule(park.id);
        
        const schedRowsMap = new Map<string, ScheduleSignalRow>();
        for (const se of schedRes.schedule) {
           if (!se.date) continue;
           const sDate = new Date(se.date as string);
           const dateKey = sDate.toISOString().split('T')[0] as string;
           
           let openTime = se.openingTime ? new Date(se.openingTime as string) : null;
           let closeTime = se.closingTime ? new Date(se.closingTime as string) : null;
           
           const desc = (se.description || '').toLowerCase();
           const ll = se.purchases?.find(p => p.name === 'Lightning Lane Multi Pass');
           
           if (schedRowsMap.has(dateKey)) {
             const existing = schedRowsMap.get(dateKey)!;
             if (openTime && (!existing.open_time || openTime < existing.open_time)) {
               existing.open_time = openTime;
             }
             if (closeTime && (!existing.close_time || closeTime > existing.close_time)) {
               existing.close_time = closeTime;
             }
             existing.early_entry = existing.early_entry || desc.includes('early entry');
             existing.extended_evening = existing.extended_evening || desc.includes('extended evening');
             existing.ticketed_event = existing.ticketed_event || desc.includes('special ticketed');
             if (ll?.price?.amount && !existing.ll_multipass_price_cents) {
               existing.ll_multipass_price_cents = ll.price.amount;
             }
           } else {
             schedRowsMap.set(dateKey, {
               park: canonicalPark,
               date: sDate,
               open_time: openTime,
               close_time: closeTime,
               early_entry: desc.includes('early entry'),
               extended_evening: desc.includes('extended evening'),
               ticketed_event: desc.includes('special ticketed'),
               ll_multipass_price_cents: ll?.price?.amount ?? null
             });
           }
        }
        await repo.upsertParkScheduleSignals(Array.from(schedRowsMap.values()));

        const waitSamples: WaitSampleRow[] = [];
        const dailySignals: DailySignalRow[] = [];
        const updatedShapes: RideShapeRow[] = [];
        const updatedSeasons: SeasonHourRow[] = [];
        const updatedSignals: ExperienceSignalRow[] = [];
        
        // Standby basket for the per-ride-relative crowd index (R2.7/R2.8)
        const basketRides: RelativeCrowdRide[] = [];
        let basketTotalWait = 0;
        let basketCount = 0;
        const seenExpIds = new Set<string>();

        // R15: the day's observed Crowd_Index so far, read ONCE before the entry
        // loop (the crowd-index write below happens after it). Each season
        // bucket EMAs this in so it records the crowd level its samples were
        // taken under. `null` on the day's first pass — the level is genuinely
        // unknown then and the bucket is left alone rather than assuming 1.0.
        let observedCrowdLevel: number | null = null;
        try {
          const todayIdxRows = await repo.getParkCrowdIndices(canonicalPark, [new Date(dateStr)]);
          const todayIdx = todayIdxRows.length > 0 ? todayIdxRows[0]! : null;
          if (
            todayIdx &&
            todayIdx.crowd_index != null &&
            Number.isFinite(todayIdx.crowd_index) &&
            todayIdx.sample_count > 0
          ) {
            observedCrowdLevel = todayIdx.crowd_index;
          }
        } catch (err) {
          logger.debug(
            { err, park: canonicalPark },
            'Could not read today crowd index for the season bucket crowd level',
          );
        }

        for (const entry of liveRes.liveData) {
          if (!entry.id) continue;
          const expId = tpIdToDbId.get(entry.id);
          if (!expId) continue;
          if (seenExpIds.has(expId)) continue;
          seenExpIds.add(expId);

          const isOperating = entry.status === 'OPERATING';
          const waitMinutes = (isOperating && entry.queue?.STANDBY?.waitTime) || 0;
          const singleRiderWait = (isOperating && entry.queue?.SINGLE_RIDER?.waitTime) || null;
          
          // Gate wait_samples on isStandbyBasketEntry: only entries with a
          // real posted STANDBY queue (shows/dining/parades excluded; walk-on
          // 0-min included). Shape/season EMA keep the existing gate below.
          const inBasket = isStandbyBasketEntry(entry);
          if (inBasket) {
            const standbyWait = entry.queue!.STANDBY!.waitTime as number;
            waitSamples.push({
              experience_id: expId,
              observed_at: now,
              wait_minutes: standbyWait,
              status: entry.status!
            });
            basketTotalWait += standbyWait;
            basketCount++;

            // Collect ride data for relativeCrowdIndex (R14).
            //
            // `expected` is the ride's SLOW Ride_Baseline, NOT its fast
            // `avg_wait_minutes`. The fast shape is updated toward this very
            // observation a few lines below, so using it as the denominator made
            // the index measure its own decay: over Aug 11-18 -> Aug 19-25 2026
            // the index rose in all four parks while the mean posted wait fell.
            //
            // Read before the update block below, so this is the baseline as it
            // stood at the start of the pass — a genuine prior expectation.
            const shapeBucket = existingShapes.find(
              s => s.experience_id === expId && s.day_of_week === currentDow && s.hour === currentHour
            );
            if (
              shapeBucket &&
              isBaselineEstablished(shapeBucket.baseline_wait_minutes, shapeBucket.baseline_sample_count)
            ) {
              basketRides.push({
                observed: standbyWait,
                expected: shapeBucket.baseline_wait_minutes as number,
                sampleCount: shapeBucket.baseline_sample_count,
              });
            }
          }

          // Daily Signals
          dailySignals.push({
            experience_id: expId,
            date: new Date(dateStr),
            ll_price_cents: entry.queue?.PAID_RETURN_TIME?.price?.amount ?? null,
            ll_available: entry.queue?.PAID_RETURN_TIME?.state === 'AVAILABLE' ? true : (entry.queue?.PAID_RETURN_TIME?.state === 'SOLD_OUT' ? false : null),
            used_virtual_queue: entry.queue?.BOARDING_GROUP !== undefined ? true : null,
            showtimes: entry.showtimes || null
          });

          // Rolling Signals Update
          let sig = existingSignals.find(s => s.experience_id === expId) || {
            experience_id: expId,
            has_single_rider: false,
            uses_virtual_queue: false,
            downtime_rate: 0,
            ll_sellout_median_hour: null,
            sample_count: 0
          };
          
          sig.has_single_rider = sig.has_single_rider || entry.queue?.SINGLE_RIDER !== undefined;
          sig.uses_virtual_queue = sig.uses_virtual_queue || entry.queue?.BOARDING_GROUP !== undefined;
          // Downtime/reliability rate EMA (R9.2). Only fold in statuses that
          // reflect operational reliability: OPERATING (up) and DOWN (an
          // unexpected mid-day breakdown). Scheduled non-operation — CLOSED
          // (before open, after close, seasonal) and REFURBISHMENT — is NOT a
          // reliability signal; folding it in collapses the metric into a
          // "not-currently-open" rate dominated by overnight/pre-open passes
          // (observed ~22% before this fix). The denominator (sample_count)
          // therefore counts only reliability observations, not total passes.
          if (entry.status === 'OPERATING' || entry.status === 'DOWN') {
            const downSample = entry.status === 'DOWN' ? 1.0 : 0.0;
            const sigWeight = 2 / (Math.min(sig.sample_count, 100) + 2); // Cap alpha
            sig.downtime_rate = applyEma(sig.downtime_rate, downSample, sigWeight);
            sig.sample_count++;
          }
          updatedSignals.push(sig);

          // Only update shapes if OPERATING and valid wait
          if (isOperating && waitMinutes > 0) {
            // Shape EMA
            let shape = existingShapes.find(s => s.experience_id === expId && s.day_of_week === currentDow && s.hour === currentHour) || {
              experience_id: expId, day_of_week: currentDow, hour: currentHour,
              avg_wait_minutes: waitMinutes, sample_count: 0,
              sr_avg_wait_minutes: singleRiderWait, sr_sample_count: singleRiderWait ? 0 : null,
              stddev_wait: 0, p50_wait: waitMinutes, p90_wait: waitMinutes, down_rate: 0,
              baseline_wait_minutes: null, baseline_sample_count: 0
            };
            const w = shapeEmaWeight(shape.sample_count);
            const prevAvg = shape.avg_wait_minutes;
            shape.avg_wait_minutes = applyEma(shape.avg_wait_minutes, waitMinutes, w);
            // using welford-like variance, we store variance briefly as stddev_wait^2
            const prevVar = shape.stddev_wait * shape.stddev_wait;
            const newVar = emaVariance(prevVar, prevAvg, waitMinutes, w);
            shape.stddev_wait = Math.sqrt(newVar);
            shape.sample_count++;

            // R14: establish the Ride_Baseline that denominates the Crowd_Index,
            // then leave it frozen. This call is a no-op once established — it
            // deliberately does NOT average this sample in, however slowly. A
            // denominator that responds to the numerator measures its own decay
            // (see waitMath.establishBaseline for the measured rejection of the
            // slow-EMA alternative). Real multi-season change is absorbed by the
            // periodic archive re-anchor (R14.9), not by drift.
            const nextBaseline = establishBaseline(
              shape.baseline_wait_minutes,
              shape.baseline_sample_count,
              shape.avg_wait_minutes,
              shape.sample_count,
            );
            shape.baseline_wait_minutes = nextBaseline.baselineWaitMinutes;
            shape.baseline_sample_count = nextBaseline.baselineSampleCount;
            
            if (singleRiderWait !== null) {
              shape.sr_avg_wait_minutes = applyEma(shape.sr_avg_wait_minutes || singleRiderWait, singleRiderWait, w);
              shape.sr_sample_count = (shape.sr_sample_count || 0) + 1;
            }
            updatedShapes.push(shape);

            // Season EMA
            let season = existingSeasons.find(s => s.experience_id === expId && s.season === currentSeason && s.day_of_week === currentDow && s.hour === currentHour) || {
              experience_id: expId, season: currentSeason, day_of_week: currentDow, hour: currentHour,
              avg_wait_minutes: waitMinutes, sample_count: 0, avg_crowd_index: null
            };
            const sw = 2 / (Math.min(season.sample_count, 10) + 2);
            season.avg_wait_minutes = applyEma(season.avg_wait_minutes, waitMinutes, sw);

            // R15: track the crowd level this bucket's samples were taken under,
            // on the same EMA weight as the wait so the two stay in step. A
            // season bucket is a direct average, so it embeds its own samples'
            // crowd level; storing that level is what lets the season tier scale
            // by a RELATIVE factor instead of ignoring the date entirely.
            //
            // Left untouched when today's level is not yet known (the day's
            // first pass) rather than defaulted to 1.0 — asserting "typical" for
            // what might be a holiday would poison the bucket.
            if (observedCrowdLevel !== null) {
              season.avg_crowd_index =
                season.avg_crowd_index == null
                  ? observedCrowdLevel
                  : applyEma(season.avg_crowd_index, observedCrowdLevel, sw);
            }

            season.sample_count++;
            updatedSeasons.push(season);
          }
        }
        
        await repo.insertWaitSamples(waitSamples);
        totalWaitSamplesRecorded += waitSamples.length;
        await repo.upsertExperienceDailySignals(dailySignals);
        await repo.upsertRideShapes(updatedShapes);
        await repo.upsertSeasonHours(updatedSeasons);
        await repo.upsertExperienceSignals(updatedSignals);

        // Park Crowd Index — per-ride-relative aggregate over the standby
        // basket (R2.7 / R2.8). Only the four theme parks.
        if (CROWD_INDEX_PARKS.has(canonicalPark)) {
          const crowdSlice = relativeCrowdIndex(basketRides);

          // If the basket is empty for this pass (no ride has an eligible
          // shape yet), write NO index slice — let the forecast/seed carry.
          // Guard NaN BEFORE applyEma so NaN never reaches park_crowd_index.
          if (!Number.isNaN(crowdSlice)) {
            const basketAvgWait = basketCount > 0 ? basketTotalWait / basketCount : 0;

            const todayDate = new Date(dateStr);
            const existingIndices = await repo.getParkCrowdIndices(canonicalPark, [todayDate]);
            let idxRow = existingIndices.length > 0 ? existingIndices[0]! : {
              park: canonicalPark,
              date: todayDate,
              crowd_index: crowdSlice,
              daily_avg_wait: basketAvgWait,
              sample_count: 0
            };

            // Running average of the day's index slices
            const iw = 1 / (idxRow.sample_count + 1);
            idxRow.crowd_index = applyEma(idxRow.crowd_index, crowdSlice, iw);
            idxRow.daily_avg_wait = applyEma(idxRow.daily_avg_wait, basketAvgWait, iw);
            idxRow.sample_count++;

            await repo.upsertParkCrowdIndices([idxRow]);
          }
        }
        
      } catch (err) {
        logger.warn({ err, park: park.name }, 'Failed to sample park');
      }
    }

    if (unmappedStandbyEntries.size > 0) {
      const unmappedList = Array.from(unmappedStandbyEntries.values());
      const sample = unmappedList.slice(0, 5).map(e => `${e.name} (${e.id})`);
      logger.warn(
        {
          count: unmappedList.length,
          sample,
          unmappedIds: unmappedList.map(e => e.id),
          unmapped: unmappedList.slice(0, 10),
        },
        `Unmapped live experiences with standby waits detected: ${unmappedList.length} (sample: ${sample.join(', ')})`
      );
    }

    logger.info(
      {
        parksSampled: parksSampledCount,
        experiencesMapped: tpIdToDbId.size,
        totalWaitSamples: totalWaitSamplesRecorded,
        unmappedWithWaitCount: unmappedStandbyEntries.size,
        unresolvedCount,
      },
      `Sampling pass summary: ${parksSampledCount} parks sampled, ${tpIdToDbId.size} experiences mapped, ${totalWaitSamplesRecorded} wait samples recorded, ${unmappedStandbyEntries.size} unmapped with standby waits, ${unresolvedCount} unresolved`
    );

    // Prune old samples (30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await repo.pruneWaitSamples(thirtyDaysAgo);
  }
}
