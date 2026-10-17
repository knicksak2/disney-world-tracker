import { REMINDER_LEADS, type ReminderLead } from '@dwt/shared';

export interface ReminderConfig {
  readonly leads: readonly ReminderLead[];
  readonly catchupMinutes: number;
  readonly minPassIntervalSeconds: number;
  readonly sendStartMinutes: number;
  readonly sendEndMinutes: number;
  readonly retentionDays: number;
}

/**
 * R7.2: Unknown tokens ignored; empty result ⇒ no reminders.
 * Case-insensitive, de-duplicated, returned in canonical REMINDER_LEADS order.
 */
export function parseReminderLeads(raw: string): ReminderLead[] {
  if (!raw || typeof raw !== 'string') return [];
  const tokens = raw
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  const matched = new Set<ReminderLead>();
  for (const token of tokens) {
    if ((REMINDER_LEADS as readonly string[]).includes(token)) {
      matched.add(token as ReminderLead);
    }
  }

  // Canonical order
  return REMINDER_LEADS.filter(lead => matched.has(lead));
}

/**
 * Parses 'HH:MM' string to whole minutes from midnight (0 to 1439).
 * Returns null if string is malformed or outside 00:00 - 23:59.
 */
export function parseClockMinutes(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  return hours * 60 + minutes;
}
