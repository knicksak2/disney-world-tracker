import { describe, it, expect, vi } from 'vitest';
import { createWeatherClient } from '../weatherClient.js';

function okResponse(body: any) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as any;
}
function status429() {
  return { ok: false, status: 429, headers: { get: () => null } } as any;
}

const SAMPLE = {
  current: { time: 1754340300, temperature_2m: 85.4, precipitation: 0, weather_code: 3 },
  daily: {
    time: [1754280000],
    weather_code: [61], // rain
    temperature_2m_max: [90],
    temperature_2m_min: [75],
    precipitation_sum: [0.2],
  },
};

describe('weatherClient', () => {
  it('parses unixtime into a correct UTC observed_at and caches within the TTL', async () => {
    const fetchMock = vi.fn(async () => okResponse(SAMPLE));
    let t = 1000;
    const client = createWeatherClient(fetchMock as any, 'https://x', { now: () => t, ttlMs: 10_000, sleep: async () => {} });

    const first = await client.getWDWWeather();
    expect(first.current?.temp_f).toBe(85.4);
    expect(first.current?.condition).toBe('clear'); // code 3
    // unix seconds → correct UTC instant, independent of server timezone
    expect(first.current?.observed_at.toISOString()).toBe(new Date(1754340300 * 1000).toISOString());
    expect(first.forecast[0]!.condition).toBe('rain'); // code 61

    t = 5000; // still within TTL
    await client.getWDWWeather();
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache

    t = 20_000; // past TTL
    await client.getWDWWeather();
    expect(fetchMock).toHaveBeenCalledTimes(2); // refetched
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls < 2 ? status429() : okResponse(SAMPLE);
    });
    const sleep = vi.fn(async () => {});
    const client = createWeatherClient(fetchMock as any, 'https://x', { now: () => 1, ttlMs: 1000, sleep, maxRetries: 2 });

    const r = await client.getWDWWeather();
    expect(r.current?.temp_f).toBe(85.4);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serves a stale cache when a later refresh 429s (graceful degrade)', async () => {
    let mode: 'ok' | '429' = 'ok';
    const fetchMock = vi.fn(async () => (mode === 'ok' ? okResponse(SAMPLE) : status429()));
    let t = 0;
    const client = createWeatherClient(fetchMock as any, 'https://x', { now: () => t, ttlMs: 100, sleep: async () => {}, maxRetries: 1 });

    const first = await client.getWDWWeather();
    expect(first.current?.temp_f).toBe(85.4);

    t = 1000; // past TTL → tries to refresh
    mode = '429'; // ...but Open-Meteo rate-limits
    const second = await client.getWDWWeather();
    expect(second.current?.temp_f).toBe(85.4); // stale value still served, no throw
  });
});
