/**
 * Pure math for seasonal priors.
 * Rule-computed per year so it never goes stale.
 */

function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

function getNthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const date = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (date.getUTCMonth() === month) {
    if (date.getUTCDay() === weekday) {
      count++;
      if (count === n) return new Date(date);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  // Fallback to last occurrence if n is very large
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

/**
 * Returns a seasonal prior multiplier (~[0.8, 1.6]) for a given date.
 */
export function seasonalPrior(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const time = date.getTime();
  
  // Easter-anchored Spring Break
  const easter = getEaster(year);
  const springBreakStart = new Date(easter.getTime() - 14 * 86400000);
  const springBreakEnd = new Date(easter.getTime() + 7 * 86400000);
  
  // Thanksgiving window (4th Thursday in Nov)
  const thanksgiving = getNthWeekday(year, 10, 4, 4);
  const thanksgivingStart = new Date(thanksgiving.getTime() - 4 * 86400000);
  const thanksgivingEnd = new Date(thanksgiving.getTime() + 3 * 86400000);

  // Winter break (~Dec 20 to Jan 5)
  const isWinterBreak = (month === 11 && day >= 20) || (month === 0 && day <= 5);
  
  // Summer break (~June 15 to Aug 15)
  const isSummerBreak = (month === 5 && day >= 15) || month === 6 || (month === 7 && day <= 15);

  if (isWinterBreak) return 1.6;
  if (time >= thanksgivingStart.getTime() && time <= thanksgivingEnd.getTime()) return 1.5;
  if (time >= springBreakStart.getTime() && time <= springBreakEnd.getTime()) return 1.4;
  if (isSummerBreak) return 1.3;
  
  // Holidays (Memorial Day, Labor Day, Columbus Day, etc.)
  const memorialDay = getNthWeekday(year, 4, 1, 5); // Usually last Monday, using 5 will handle it or fallback
  if (Math.abs(time - memorialDay.getTime()) < 3 * 86400000) return 1.3;
  
  const laborDay = getNthWeekday(year, 8, 1, 1);
  if (Math.abs(time - laborDay.getTime()) < 3 * 86400000) return 1.3;
  
  // Off-peak (September, January after break)
  if (month === 8 || (month === 0 && day > 5)) return 0.8;

  return 1.0;
}
