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
import { applyEma, emaVariance, normalizeCrowdIndex } from './waitMath.js';

/** Cold-start seed for per-park normalization when no history exists yet (R2.1). */
const DEFAULT_TYPICAL_WAIT = 35;

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
  let lastSampleTime = 0;
  let lastRecomputeTime = 0;
  
  return {
    async runSamplingPass(): Promise<void> {
      if (isRunning) {
        logger.debug('Sampling pass already running, skipping overlap');
        return;
      }
      
      const now = clock();
      if (now.getTime() - lastSampleTime < 10 * 60 * 1000) {
        logger.debug('Sampling pass throttled (10m interval)');
        return;
      }
      
      isRunning = true;
      try {
        await executePass(now);
        lastSampleTime = clock().getTime();
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
    for (const exp of experiences) {
      try {
        const tpId = await directory.resolveEntityId(exp.upstream_entity_id);
        if (tpId) tpIdToDbId.set(tpId, exp.id);
      } catch (_err) {
        // Log and ignore
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
    
    for (const park of wdwParks) {
      try {
        const liveRes = await liveClient.getEntityLive(park.id);

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

        const schedRes = await liveClient.getEntitySchedule(park.id);
        
        const schedRows: ScheduleSignalRow[] = [];
        for (const se of schedRes.schedule) {
           if (!se.date) continue;
           const sDate = new Date(se.date);
           let openTime = se.openingTime ? new Date(se.openingTime) : null;
           let closeTime = se.closingTime ? new Date(se.closingTime) : null;
           
           const desc = (se.description || '').toLowerCase();
           const ll = se.purchases?.find(p => p.name === 'Lightning Lane Multi Pass');
           
           schedRows.push({
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
        await repo.upsertParkScheduleSignals(schedRows);

        const waitSamples: WaitSampleRow[] = [];
        const dailySignals: DailySignalRow[] = [];
        const updatedShapes: RideShapeRow[] = [];
        const updatedSeasons: SeasonHourRow[] = [];
        const updatedSignals: ExperienceSignalRow[] = [];
        
        let parkTotalWait = 0;
        let parkTotalSamples = 0;

        for (const entry of liveRes.liveData) {
          if (!entry.id) continue;
          const expId = tpIdToDbId.get(entry.id);
          if (!expId) continue;

          const isOperating = entry.status === 'OPERATING';
          const waitMinutes = (isOperating && entry.queue?.STANDBY?.waitTime) || 0;
          const singleRiderWait = (isOperating && entry.queue?.SINGLE_RIDER?.waitTime) || null;
          
          if (isOperating && typeof waitMinutes === 'number') {
            waitSamples.push({
              experience_id: expId,
              observed_at: now,
              wait_minutes: waitMinutes,
              status: entry.status
            });
            parkTotalWait += waitMinutes;
            parkTotalSamples++;
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
          // Downtime rate EMA
          const downSample = (entry.status === 'DOWN' || entry.status === 'CLOSED') ? 1.0 : 0.0;
          const sigWeight = 2 / (Math.min(sig.sample_count, 100) + 2); // Cap alpha
          sig.downtime_rate = applyEma(sig.downtime_rate, downSample, sigWeight);
          sig.sample_count++;
          updatedSignals.push(sig);

          // Only update shapes if OPERATING and valid wait
          if (isOperating && waitMinutes > 0) {
            // Shape EMA
            let shape = existingShapes.find(s => s.experience_id === expId && s.day_of_week === currentDow && s.hour === currentHour) || {
              experience_id: expId, day_of_week: currentDow, hour: currentHour,
              avg_wait_minutes: waitMinutes, sample_count: 0,
              sr_avg_wait_minutes: singleRiderWait, sr_sample_count: singleRiderWait ? 0 : null,
              stddev_wait: 0, p50_wait: waitMinutes, p90_wait: waitMinutes, down_rate: 0
            };
            const w = 2 / (Math.min(shape.sample_count, 20) + 2);
            const prevAvg = shape.avg_wait_minutes;
            shape.avg_wait_minutes = applyEma(shape.avg_wait_minutes, waitMinutes, w);
            // using welford-like variance, we store variance briefly as stddev_wait^2
            const prevVar = shape.stddev_wait * shape.stddev_wait;
            const newVar = emaVariance(prevVar, prevAvg, waitMinutes, w);
            shape.stddev_wait = Math.sqrt(newVar);
            shape.sample_count++;
            
            if (singleRiderWait !== null) {
              shape.sr_avg_wait_minutes = applyEma(shape.sr_avg_wait_minutes || singleRiderWait, singleRiderWait, w);
              shape.sr_sample_count = (shape.sr_sample_count || 0) + 1;
            }
            updatedShapes.push(shape);

            // Season EMA
            let season = existingSeasons.find(s => s.experience_id === expId && s.season === currentSeason && s.day_of_week === currentDow && s.hour === currentHour) || {
              experience_id: expId, season: currentSeason, day_of_week: currentDow, hour: currentHour,
              avg_wait_minutes: waitMinutes, sample_count: 0
            };
            const sw = 2 / (Math.min(season.sample_count, 10) + 2);
            season.avg_wait_minutes = applyEma(season.avg_wait_minutes, waitMinutes, sw);
            season.sample_count++;
            updatedSeasons.push(season);
          }
        }
        
        await repo.insertWaitSamples(waitSamples);
        await repo.upsertExperienceDailySignals(dailySignals);
        await repo.upsertRideShapes(updatedShapes);
        await repo.upsertSeasonHours(updatedSeasons);
        await repo.upsertExperienceSignals(updatedSignals);

        // Park Crowd Index (running daily aggregate, per-park normalization R2.1)
        if (parkTotalSamples > 0) {
          const parkAvgWait = parkTotalWait / parkTotalSamples;

          // Per-park rolling baseline; cold-start seed only when no history exists
          const rollingBaseline = await repo.getParkRollingBaseline(canonicalPark);
          const parkTypical = rollingBaseline ?? DEFAULT_TYPICAL_WAIT;
          const continuousIndex = normalizeCrowdIndex(parkAvgWait, { typical: parkTypical, maxTypical: parkTypical * 2 });
          
          const todayDate = new Date(dateStr);
          const existingIndices = await repo.getParkCrowdIndices(canonicalPark, [todayDate]);
          let idxRow = existingIndices.length > 0 ? existingIndices[0]! : {
            park: canonicalPark,
            date: todayDate,
            crowd_index: continuousIndex,
            daily_avg_wait: parkAvgWait,
            sample_count: 0
          };
          
          // Running average of the day's index slices
          const iw = 1 / (idxRow.sample_count + 1);
          idxRow.crowd_index = applyEma(idxRow.crowd_index, continuousIndex, iw);
          idxRow.daily_avg_wait = applyEma(idxRow.daily_avg_wait, parkAvgWait, iw);
          idxRow.sample_count++;
          
          await repo.upsertParkCrowdIndices([idxRow]);
        }
        
      } catch (err) {
        logger.warn({ err, park: park.name }, 'Failed to sample park');
      }
    }
    
    // Prune old samples (30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await repo.pruneWaitSamples(thirtyDaysAgo);
  }
}
