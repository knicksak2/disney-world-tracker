import {
  BOOKING_RULES,
  REMINDER_LEAD_SCHEDULE,
  REMINDER_LEADS,
  WINDOW_KINDS,
  addCalendarDays,
  type ReminderLead,
  type WindowKind,
} from '@dwt/shared';
import { wdwIsoAtMinutes } from '../trips/wdwClock.js';
import type { DerivedWindow } from './timeline.js';

export interface ReminderEnv {
  readonly nowMs: number;
  readonly today: string; // wdwToday(now)
  readonly leads: readonly ReminderLead[]; // already filtered to valid values (R7.2)
  readonly catchupMs: number; // BOOKING_REMINDER_CATCHUP_MINUTES * 60_000
}

export interface DueReminder {
  readonly windowKey: string;
  readonly kind: WindowKind;
  readonly dropOn: string;
  readonly dropAt: string;
  readonly lead: ReminderLead;
  readonly fireAt: string;
  readonly firstCovered: string;
  readonly lastCovered: string;
}

export function reminderFireAt(
  w: Pick<DerivedWindow, 'dropOn' | 'dropAt'>,
  lead: ReminderLead
): string {
  const s = REMINDER_LEAD_SCHEDULE[lead];
  return s.kind === 'at_drop'
    ? w.dropAt
    : wdwIsoAtMinutes(addCalendarDays(w.dropOn, -s.daysBefore), s.minutes);
}

export const ledgerKey = (kind: WindowKind, dropAt: string, lead: ReminderLead) =>
  `${kind}|${dropAt}|${lead}`;

/**
 * R7.3: Half-open interval fireAt <= now < fireAt + catchup.
 * Upper bound is strictly exclusive (<).
 */
export function isDue(fireAtMs: number, nowMs: number, catchupMs: number): boolean {
  return nowMs >= fireAtMs && nowMs < fireAtMs + catchupMs;
}

export function deriveDueReminders(
  windows: readonly DerivedWindow[],
  doneKeys: ReadonlySet<string>, // windowKeys with a Window_Done_Mark
  claimedKeys: ReadonlySet<string>, // ledgerKey(...) already in trip_booking_reminder_log
  env: ReminderEnv
): DueReminder[] {
  if (env.leads.length === 0) return [];

  const out: DueReminder[] = [];

  for (const w of windows) {
    if (doneKeys.has(w.windowKey)) continue;
    const lastCovered = w.coveredDates[w.coveredDates.length - 1]!;
    if (lastCovered < env.today) continue;

    for (const lead of env.leads) {
      const fireAt = reminderFireAt(w, lead);
      const fireAtMs = Date.parse(fireAt);
      if (!isDue(fireAtMs, env.nowMs, env.catchupMs)) continue;

      const key = ledgerKey(w.kind, w.dropAt, lead);
      if (claimedKeys.has(key)) continue;

      out.push({
        windowKey: w.windowKey,
        kind: w.kind,
        dropOn: w.dropOn,
        dropAt: w.dropAt,
        lead,
        fireAt,
        firstCovered: w.coveredDates[0]!,
        lastCovered,
      });
    }
  }

  // Ordered by (fireAt, kind order, lead order) for determinism
  return out.sort((a, b) => {
    const cmpFireAt = a.fireAt.localeCompare(b.fireAt);
    if (cmpFireAt !== 0) return cmpFireAt;
    const cmpKind = WINDOW_KINDS.indexOf(a.kind) - WINDOW_KINDS.indexOf(b.kind);
    if (cmpKind !== 0) return cmpKind;
    return REMINDER_LEADS.indexOf(a.lead) - REMINDER_LEADS.indexOf(b.lead);
  });
}

export function inSendWindow(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number
): boolean {
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

const MAX_HEAD_OFFSET_DAYS = Math.max(
  ...Object.values(BOOKING_RULES.dining.byStayType).map(r => r.headOffsetDays),
  ...Object.values(BOOKING_RULES.lightning_lane.byTiming).map(r => r.headOffsetDays)
);

export function reminderHorizonDays(leads: readonly ReminderLead[]): number {
  const maxDaysBefore = Math.max(
    0,
    ...leads.map(l => {
      const s = REMINDER_LEAD_SCHEDULE[l];
      return s.kind === 'day_before' ? s.daysBefore : 0;
    })
  );
  return MAX_HEAD_OFFSET_DAYS + Math.max(1, maxDaysBefore);
}

export function reminderHorizonDate(today: string, leads: readonly ReminderLead[]): string {
  return addCalendarDays(today, reminderHorizonDays(leads));
}

export function isCandidateTrip(
  t: { startDate: string; endDate: string; checkInOverride: string | null },
  today: string,
  horizon: string
): boolean {
  return (
    t.endDate >= today &&
    (t.startDate <= horizon || (t.checkInOverride !== null && t.checkInOverride <= horizon))
  );
}

export interface ReminderGroup {
  readonly lead: ReminderLead;
  readonly windows: readonly {
    readonly kind: WindowKind;
    readonly dropAt: string;
    readonly firstCovered: string;
    readonly lastCovered: string;
  }[]; // ≤ 2 distinct kinds
  readonly reminderCount: number; // claimed reminders folded in (for summary counter)
}

export function coalesceReminders(claimed: readonly DueReminder[]): ReminderGroup[] {
  const groups: ReminderGroup[] = [];

  for (const lead of REMINDER_LEADS) {
    const forLead = claimed.filter(r => r.lead === lead);
    if (forLead.length === 0) continue;

    const kindEntries: {
      kind: WindowKind;
      dropAt: string;
      firstCovered: string;
      lastCovered: string;
    }[] = [];

    for (const kind of WINDOW_KINDS) {
      const forKind = forLead.filter(r => r.kind === kind);
      if (forKind.length === 0) continue;

      let earliestDropAt = forKind[0]!.dropAt;
      let minFirstCovered = forKind[0]!.firstCovered;
      let maxLastCovered = forKind[0]!.lastCovered;

      for (const r of forKind) {
        if (r.dropAt.localeCompare(earliestDropAt) < 0) earliestDropAt = r.dropAt;
        if (r.firstCovered.localeCompare(minFirstCovered) < 0) minFirstCovered = r.firstCovered;
        if (r.lastCovered.localeCompare(maxLastCovered) > 0) maxLastCovered = r.lastCovered;
      }

      kindEntries.push({
        kind,
        dropAt: earliestDropAt,
        firstCovered: minFirstCovered,
        lastCovered: maxLastCovered,
      });
    }

    groups.push({
      lead,
      windows: kindEntries,
      reminderCount: forLead.length,
    });
  }

  return groups;
}

export function selectRecipients(
  memberIds: readonly string[],
  mutedIds: readonly string[]
): string[] {
  const mutedSet = new Set(mutedIds);
  const eligible = new Set<string>();
  for (const id of memberIds) {
    if (!mutedSet.has(id)) {
      eligible.add(id);
    }
  }
  return [...eligible].sort();
}
