/**
 * Reminder runner implementation.
 *
 * Runs scheduled passes to evaluate candidate Trips, claim due reminders in the
 * ledger, coalesce them per lead, and dispatch them to the Notification_Service.
 *
 * Validates: Requirements 7.5, 7.7, 7.9, 8.1, 8.3, 8.5, 8.6, 8.7, 8.9,
 *            9.1, 9.2, 9.3, 9.4, 9.11, 9.12, 14.2
 */

import { wdwMinutesFromMidnight, wdwToday } from '../trips/wdwClock.js';
import type { TripBookingReminderNotice } from './events.js';
import { decidePassStart } from './passGate.js';
import type { ReminderConfig } from './reminderConfig.js';
import {
  coalesceReminders,
  deriveDueReminders,
  inSendWindow,
  reminderHorizonDate,
  type DueReminder,
  type ReminderEnv,
} from './reminders.js';
import { deriveBookingTimeline, type StoredBookingSettings } from './timeline.js';

export const TRIPS_PER_PASS = 500; // R7.7

export interface CandidateTrip {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly hasResortStay: boolean;
  readonly settings: StoredBookingSettings | null;
}

export interface ReminderRunnerRepo {
  listCandidateTrips(args: { today: string; horizon: string; limit: number }): Promise<CandidateTrip[]>;
  listDoneKeys(tripIds: readonly string[]): Promise<Map<string, Set<string>>>; // tripId → windowKeys
  listClaimedKeys(tripIds: readonly string[], sinceIso: string): Promise<Map<string, Set<string>>>;
  claimReminder(tripId: string, r: DueReminder): Promise<boolean>; // true iff THIS call inserted
  listReminderRecipients(tripId: string): Promise<string[]>; // members minus muted
  pruneLedger(cutoffIso: string): Promise<number>;
}

export interface ReminderRunnerDeps {
  readonly repo: ReminderRunnerRepo;
  readonly dispatch: (event: TripBookingReminderNotice) => Promise<void>;
  readonly config: ReminderConfig;
  readonly logger: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
  readonly now?: () => Date;
  readonly tripsPerPass?: number; // tests only; default TRIPS_PER_PASS
}

export type StartResult = { started: true } | { started: false; reason: 'in_flight' | 'debounced' };

export interface PassSummary {
  tripsEvaluated: number;
  remindersClaimed: number;
  remindersDispatched: number;
}

export interface ReminderRunner {
  /** Synchronous decision. When started, the pass runs asynchronously in-process; errors are logged, never thrown. */
  tryStart(): StartResult;
  /** Exposed for tests: run exactly one pass now, ignoring the gate. Resolves to the summary. */
  runPass(now?: Date): Promise<PassSummary>;
}

export function createReminderRunner(deps: ReminderRunnerDeps): ReminderRunner {
  let inFlight = false;
  let lastStartMs: number | null = null;

  async function runPass(nowArg?: Date): Promise<PassSummary> {
    const now = nowArg ?? (deps.now ? deps.now() : new Date());
    const today = wdwToday(now);
    const minutes = wdwMinutesFromMidnight(today, now.toISOString());
    const summary: PassSummary = {
      tripsEvaluated: 0,
      remindersClaimed: 0,
      remindersDispatched: 0,
    };
    const cfg = deps.config;
    const tripsLimit = deps.tripsPerPass ?? TRIPS_PER_PASS;

    try {
      if (!inSendWindow(minutes, cfg.sendStartMinutes, cfg.sendEndMinutes) || cfg.leads.length === 0) {
        return summary;
      }
      const horizon = reminderHorizonDate(today, cfg.leads);
      const trips = await deps.repo.listCandidateTrips({ today, horizon, limit: tripsLimit });
      if (trips.length === 0) {
        return summary;
      }

      const tripIds = trips.map((t) => t.id);
      const sinceMs = now.getTime() - cfg.retentionDays * 86_400_000;
      const sinceIso = new Date(sinceMs).toISOString();
      const [done, claimed] = await Promise.all([
        deps.repo.listDoneKeys(tripIds),
        deps.repo.listClaimedKeys(tripIds, sinceIso),
      ]);

      const env: ReminderEnv = {
        nowMs: now.getTime(),
        today,
        leads: cfg.leads,
        catchupMs: cfg.catchupMinutes * 60_000,
      };

      for (const trip of trips) {
        try {
          summary.tripsEvaluated++;
          const timeline = deriveBookingTimeline({
            startDate: trip.startDate,
            endDate: trip.endDate,
            hasResortStay: trip.hasResortStay,
            settings: trip.settings,
          });
          const tripDoneKeys = done.get(trip.id) ?? new Set<string>();
          const tripClaimedKeys = claimed.get(trip.id) ?? new Set<string>();
          const due = deriveDueReminders(timeline.windows, tripDoneKeys, tripClaimedKeys, env);
          if (due.length === 0) continue;

          const won: DueReminder[] = [];
          for (const r of due) {
            try {
              const claimedSuccess = await deps.repo.claimReminder(trip.id, r);
              if (claimedSuccess) {
                won.push(r);
                summary.remindersClaimed++;
              }
            } catch (claimErr) {
              deps.logger.warn({ err: claimErr, tripId: trip.id, reminder: r }, 'failed to claim reminder');
            }
          }

          if (won.length === 0) continue;
          const groups = coalesceReminders(won);
          if (groups.length === 0) continue;

          const recipients = await deps.repo.listReminderRecipients(trip.id);
          if (recipients.length === 0) continue; // R9.11: claim retained, nothing sent

          for (const g of groups) {
            try {
              const notice: TripBookingReminderNotice = {
                tripId: trip.id,
                tripName: trip.name,
                lead: g.lead,
                windows: g.windows,
                dispatchedAt: now.toISOString(),
                recipientIds: recipients,
              };
              await deps.dispatch(notice);
              summary.remindersDispatched += g.reminderCount;
            } catch (dispatchErr) {
              deps.logger.error({ err: dispatchErr, tripId: trip.id, lead: g.lead }, 'failed to dispatch reminder group');
            }
          }
        } catch (tripErr) {
          deps.logger.error({ err: tripErr, tripId: trip.id }, 'error evaluating trip booking reminders');
        }
      }

      deps.logger.info(summary, 'trip booking reminder pass complete');
    } catch (passErr) {
      deps.logger.error({ err: passErr, summary }, 'trip booking reminder pass encountered unexpected error');
    } finally {
      try {
        const cutoffMs = now.getTime() - cfg.retentionDays * 86_400_000;
        const cutoffIso = new Date(cutoffMs).toISOString();
        await deps.repo.pruneLedger(cutoffIso);
      } catch (pruneErr) {
        deps.logger.warn({ err: pruneErr }, 'failed to prune trip booking reminder ledger');
      }
    }

    return summary;
  }

  function tryStart(): StartResult {
    const now = deps.now ? deps.now() : new Date();
    const decision = decidePassStart({
      inFlight,
      lastStartMs,
      nowMs: now.getTime(),
      minIntervalMs: deps.config.minPassIntervalSeconds * 1000,
    });

    if (decision === 'skip_in_flight') {
      return { started: false, reason: 'in_flight' };
    }
    if (decision === 'skip_debounce') {
      return { started: false, reason: 'debounced' };
    }

    lastStartMs = now.getTime();
    inFlight = true;

    void runPass(now)
      .catch((err) => {
        deps.logger.error({ err }, 'trip booking reminder pass error');
      })
      .finally(() => {
        inFlight = false;
      });

    return { started: true };
  }

  return {
    tryStart,
    runPass,
  };
}
