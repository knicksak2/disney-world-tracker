/**
 * Stay date arithmetic for the dining plan engine (Requirement 3.4, Property 19 nights half).
 *
 * Built on `ticketPrices/dates.ts` (UTC-midnight arithmetic), never on `new Date('YYYY-MM-DD')` local math, so a DST
 * change inside a stay never shifts a night.
 */

import { addDays, daysBetween } from '../../ticketPrices/dates.js';

export interface StayDates {
  readonly checkIn: string;
  readonly checkOut: string;
}

/** The nights of a stay: `checkIn` up to but not including `checkOut`; empty when `checkOut <= checkIn`. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const count = daysBetween(checkIn, checkOut);
  const nights: string[] = [];
  for (let i = 0; i < count; i += 1) nights.push(addDays(checkIn, i));
  return nights;
}

/** The calendar days of a stay, both ends included; 0 when `checkOut < checkIn`. */
export function daysInclusive(checkIn: string, checkOut: string): number {
  return Math.max(0, daysBetween(checkIn, checkOut) + 1);
}

/** True when `date` is in `[checkIn, checkOut]`, both ends included (Requirement 4.7). */
export function isInStay(date: string, stay: StayDates): boolean {
  return daysBetween(stay.checkIn, date) >= 0 && daysBetween(date, stay.checkOut) >= 0;
}
