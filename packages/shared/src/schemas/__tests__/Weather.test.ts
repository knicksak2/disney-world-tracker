import { describe, expect, it } from 'vitest';
import { currentWeatherSchema } from '../Weather.js';

describe('currentWeatherSchema', () => {
  it('accepts null current weather when observation is absent', () => {
    const parsed = currentWeatherSchema.parse({ current: null });
    expect(parsed.current).toBeNull();
  });

  it('accepts valid current weather observation', () => {
    const parsed = currentWeatherSchema.parse({
      current: {
        tempF: 78,
        condition: 'Sunny',
      },
    });
    expect(parsed.current).toEqual({
      tempF: 78,
      condition: 'Sunny',
    });
  });

  it('rejects invalid tempF type', () => {
    expect(() =>
      currentWeatherSchema.parse({
        current: {
          tempF: '78',
          condition: 'Sunny',
        },
      }),
    ).toThrow();
  });

  it('rejects missing condition', () => {
    expect(() =>
      currentWeatherSchema.parse({
        current: {
          tempF: 78,
        },
      }),
    ).toThrow();
  });

  it('rejects missing current property', () => {
    expect(() => currentWeatherSchema.parse({})).toThrow();
  });
});
