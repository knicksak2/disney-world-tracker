import { UpstreamError } from '../catalog/themeparks.js';

export interface WeatherObservation {
  readonly observed_at: Date;
  readonly temp_f: number;
  readonly precip: number;
  readonly condition: string;
}

export interface WeatherForecastEntry {
  readonly date: Date;
  readonly condition: string;
  readonly precip: number;
  readonly temp_max_f: number;
  readonly temp_min_f: number;
}

export interface WeatherResult {
  readonly current: WeatherObservation | null;
  readonly forecast: WeatherForecastEntry[];
}

export interface WeatherClient {
  getWDWWeather(): Promise<WeatherResult>;
}

export interface WeatherClientOptions {
  /** Serve a cached result until it is this old. Default: hourly. Overridable via WEATHER_REFRESH_MS. */
  ttlMs?: number;
  /** Injectable clock (ms since epoch). */
  now?: () => number;
  /** Retries on a 429 from Open-Meteo. Default 2. */
  maxRetries?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export const WDW_LAT = 28.3852;
export const WDW_LON = -81.5639;

// Refresh hourly. This drives how often a fresh observed reading lands in
// `weather_observations` (the PK is `observed_at`, so passes inside one TTL
// window are idempotent no-ops). Open-Meteo's free non-commercial tier allows
// <10k calls/day, 5k/hour, 600/minute — one combined current+forecast call per
// hour (~17/day) is a rounding error against that, and the client already
// degrades gracefully on a 429 by serving the stale cache. Overridable via
// WEATHER_REFRESH_MS.
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createWeatherClient(
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl = 'https://api.open-meteo.com/v1',
  options: WeatherClientOptions = {},
): WeatherClient {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs
    ?? (process.env.WEATHER_REFRESH_MS ? Number(process.env.WEATHER_REFRESH_MS) : DEFAULT_TTL_MS);
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  // Process-lifetime cache shared by every caller (sampling pass + prediction),
  // so Open-Meteo is hit at most once per ttl regardless of request/pass volume.
  let cache: WeatherResult | null = null;
  let cachedAt = 0;
  let inFlight: Promise<WeatherResult> | null = null;

  async function fetchFresh(): Promise<WeatherResult> {
    // `timeformat=unixtime` returns all times as UTC epoch seconds, removing the
    // ambiguity of parsing a zoneless local-time string on a UTC server. No `hourly`
    // block — it was never used and only bloated the response.
    const url = `${baseUrl}/forecast?latitude=${WDW_LAT}&longitude=${WDW_LON}`
      + `&current=temperature_2m,precipitation,weather_code`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum`
      + `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FNew_York`
      + `&timeformat=unixtime&forecast_days=14`;

    let res: Response | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        res = await fetchImpl(url);
      } catch (err) {
        throw new UpstreamError('network', 'Failed to fetch Open-Meteo weather', { url, cause: err });
      }
      if (res.status !== 429 || attempt === maxRetries) break;
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt));
    }

    if (!res || !res.ok) {
      throw new UpstreamError('http_status', 'Open-Meteo returned error', { url, status: res?.status ?? 0 });
    }

    let data: any;
    try {
      data = await res.json();
    } catch (err) {
      throw new UpstreamError('invalid_response', 'Open-Meteo returned invalid JSON', { url, cause: err });
    }

    let current: WeatherObservation | null = null;
    if (data.current && typeof data.current.time === 'number') {
      current = {
        observed_at: new Date(data.current.time * 1000), // unix seconds → ms
        temp_f: data.current.temperature_2m ?? 0,
        precip: data.current.precipitation ?? 0,
        condition: mapWeatherCode(data.current.weather_code),
      };
    }

    const forecast: WeatherForecastEntry[] = [];
    if (data.daily && Array.isArray(data.daily.time)) {
      for (let i = 0; i < data.daily.time.length; i++) {
        forecast.push({
          date: new Date(data.daily.time[i] * 1000),
          condition: mapWeatherCode(data.daily.weather_code[i]),
          temp_max_f: data.daily.temperature_2m_max[i] ?? 0,
          temp_min_f: data.daily.temperature_2m_min[i] ?? 0,
          precip: data.daily.precipitation_sum[i] ?? 0,
        });
      }
    }

    return { current, forecast };
  }

  return {
    async getWDWWeather(): Promise<WeatherResult> {
      if (cache && now() - cachedAt < ttlMs) return cache;
      // De-dupe concurrent refreshes so a burst of callers triggers one fetch.
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const fresh = await fetchFresh();
          cache = fresh;
          cachedAt = now();
          return fresh;
        } catch (err) {
          // Degrade gracefully: serve a stale cache if we have one (e.g. a 429 on
          // the daily refresh), so predictions keep their weather signal.
          if (cache) return cache;
          throw err;
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}

function mapWeatherCode(code: number): string {
  if (code == null) return 'clear';
  if (code <= 3) return 'clear'; // 0=Clear, 1,2,3=Partly cloudy
  if (code >= 45 && code <= 48) return 'cloudy'; // Fog
  if (code >= 51 && code <= 67) return 'rain'; // Drizzle / Rain
  if (code >= 71 && code <= 86) return 'rain'; // Snow / Showers
  if (code >= 95) return 'storm'; // Thunderstorm
  return 'clear';
}
