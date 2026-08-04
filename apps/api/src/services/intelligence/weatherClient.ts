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

export interface WeatherClient {
  getWDWWeather(): Promise<{
    current: WeatherObservation | null;
    forecast: WeatherForecastEntry[];
  }>;
}

export const WDW_LAT = 28.3852;
export const WDW_LON = -81.5639;

export function createWeatherClient(fetchImpl: typeof fetch = globalThis.fetch, baseUrl = 'https://api.open-meteo.com/v1'): WeatherClient {
  return {
    async getWDWWeather() {
      // Fetch both current weather and 14-day daily forecast
      const url = `${baseUrl}/forecast?latitude=${WDW_LAT}&longitude=${WDW_LON}&current=temperature_2m,precipitation,weather_code&hourly=temperature_2m,precipitation,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FNew_York&forecast_days=14`;
      
      let res;
      try {
        res = await fetchImpl(url);
      } catch (err) {
        throw new UpstreamError('network', 'Failed to fetch Open-Meteo weather', { url, cause: err });
      }

      if (!res.ok) {
        throw new UpstreamError('http_status', 'Open-Meteo returned error', { url, status: res.status });
      }

      let data: any;
      try {
        data = await res.json();
      } catch (err) {
        throw new UpstreamError('invalid_response', 'Open-Meteo returned invalid JSON', { url, cause: err });
      }

      let current: WeatherObservation | null = null;
      if (data.current) {
        current = {
          observed_at: new Date(data.current.time),
          temp_f: data.current.temperature_2m || 0,
          precip: data.current.precipitation || 0,
          condition: mapWeatherCode(data.current.weather_code)
        };
      }

      const forecast: WeatherForecastEntry[] = [];
      if (data.daily && Array.isArray(data.daily.time)) {
        for (let i = 0; i < data.daily.time.length; i++) {
          forecast.push({
            date: new Date(data.daily.time[i]),
            condition: mapWeatherCode(data.daily.weather_code[i]),
            temp_max_f: data.daily.temperature_2m_max[i] || 0,
            temp_min_f: data.daily.temperature_2m_min[i] || 0,
            precip: data.daily.precipitation_sum[i] || 0
          });
        }
      }

      return { current, forecast };
    }
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
