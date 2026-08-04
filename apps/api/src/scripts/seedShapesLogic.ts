import { IntelligenceRepo, RideShapeRow } from '../services/intelligence/IntelligenceRepo.js';
import { ThemeParksDirectory } from '../services/live/themeParksDirectory.js';

export interface SeedShapesDeps {
  repo: IntelligenceRepo;
  directory: ThemeParksDirectory;
  fetch: typeof globalThis.fetch;
  baseUrl: string;
  userAgent: string;
  log?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  /** Polite delay between ride requests to avoid rate-limiting the free source. Default 600ms. */
  delayMs?: number;
  /** Retries on 429/503 responses with exponential backoff. Default 4. */
  maxRetries?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runSeedShapes(deps: SeedShapesDeps): Promise<void> {
  const log = deps.log || console.log;
  const warn = deps.warn || console.warn;
  const error = deps.error || console.error;
  const delayMs = deps.delayMs ?? 600;
  const maxRetries = deps.maxRetries ?? 4;
  const sleep = deps.sleep ?? defaultSleep;
  let firstFetch = true;

  log(`Starting seedShapes with RopeDrop base URL: ${deps.baseUrl}`);

  const experiences = await deps.repo.getExperiencesWithUpstreamIds();
  log(`Found ${experiences.length} experiences with upstream_entity_id.`);

  for (const exp of experiences) {
    try {
      const guid = await deps.directory.resolveEntityId(exp.upstream_entity_id);
      if (!guid) {
        warn(`[WARN] Skipping ${exp.id}: Could not resolve ThemeParks GUID for upstream_entity_id ${exp.upstream_entity_id}`);
        continue;
      }

      const url = `${deps.baseUrl}/analysis/ride/${guid}`;

      // Polite throttle between ride requests (not before the very first fetch).
      if (!firstFetch && delayMs > 0) await sleep(delayMs);
      firstFetch = false;

      log(`Fetching shape for ${exp.id} (${guid})...`);

      // Fetch with retry + exponential backoff on 429 (rate limit) / 503.
      let res: Response | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        res = await deps.fetch(url, { headers: { 'User-Agent': deps.userAgent } });
        if (res.status !== 429 && res.status !== 503) break;
        if (attempt === maxRetries) break;
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(15000, delayMs * Math.pow(2, attempt + 1));
        warn(`[WARN] ${res.status} for ${exp.id}; backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(backoff);
      }

      if (!res || !res.ok) {
        warn(`[WARN] Fetch failed for ${exp.id} (${url}): ${res?.status} ${res?.statusText}`);
        continue;
      }

      const data = (await res.json()) as any;
      const bestWorstHours = data?.best_worst_hours;

      if (!Array.isArray(bestWorstHours)) {
        warn(`[WARN] Skipping ${exp.id}: best_worst_hours is not an array`);
        continue;
      }

      // RopeDrop's `dow` is BigQuery DAYOFWEEK (1=Sunday..7=Saturday); our day_of_week is
      // JS getDay() (0=Sunday..6=Saturday), so subtract 1. Filter out malformed/out-of-range
      // buckets so one bad row can't fail the whole ride's bulk upsert (the CHECK(0..6) on
      // day_of_week previously rejected the raw dow=7 rows and silently zeroed the seed).
      const shapesToUpsert: RideShapeRow[] = bestWorstHours
        .filter((row: any) =>
          Number.isInteger(row?.dow) && row.dow >= 1 && row.dow <= 7 &&
          Number.isInteger(row?.hour_et) && row.hour_et >= 0 && row.hour_et <= 23 &&
          typeof row?.avg_wait === 'number')
        .map((row: any) => ({
          experience_id: exp.id,
          day_of_week: row.dow - 1,
          hour: row.hour_et,
          avg_wait_minutes: row.avg_wait,
          sample_count: row.n,
          sr_avg_wait_minutes: null,
          sr_sample_count: null,
          stddev_wait: 0,
          p50_wait: 0,
          p90_wait: 0,
          down_rate: 0,
        }));

      if (shapesToUpsert.length > 0) {
        await deps.repo.upsertRideShapes(shapesToUpsert);
        log(`[OK] Inserted ${shapesToUpsert.length} shape buckets for ${exp.id}`);
      } else {
        log(`[INFO] No shape data for ${exp.id}`);
      }

    } catch (err) {
      error(`[ERROR] Failed processing experience ${exp.id}:`, err);
    }
  }
}
