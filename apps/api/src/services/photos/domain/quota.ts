import { wdwToday } from '../../trips/wdwClock.js';

export function dayKey(now: Date = new Date()): string {
  return wdwToday(now);
}

export function checkTargetCap(current: number, requested: number, max: number): boolean {
  return current + requested <= max;
}

export function reserveDailyAllowed(count: number, requested: number, cap: number): boolean {
  return count + requested <= cap;
}
