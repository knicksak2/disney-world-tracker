import { z } from 'zod';
import type { CurrentWeatherDTO } from '../dto/Weather.js';

export const currentWeatherSchema = z.object({
  current: z.object({ tempF: z.number(), condition: z.string() }).nullable(),
});

export type { CurrentWeatherDTO };
