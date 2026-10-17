/**
 * Property 15 & Property 23: Reminder Runner Properties
 *
 * Validates: Requirements 7.5, 7.9, 8.5, 8.6, 8.7, 9.1, 9.2, 9.11, 9.12, 14.2
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { TripBookingReminderNotice } from '../events.js';
import type { ReminderConfig } from '../reminderConfig.js';
import {
  ledgerKey,
  type DueReminder,
} from '../reminders.js';
import {
  createReminderRunner,
  type CandidateTrip,
  type ReminderRunnerRepo,
} from '../runner.js';
import { wdwIsoAtMinutes } from '../../trips/wdwClock.js';

interface FakeLedgerItem {
  tripId: string;
  kind: string;
  dropAt: string;
  lead: string;
}

class FakeRunnerRepo implements ReminderRunnerRepo {
  public candidateTrips: CandidateTrip[] = [];
  public doneKeysMap = new Map<string, Set<string>>();
  public ledger: FakeLedgerItem[] = [];
  public recipientsMap = new Map<string, string[]>();
  public shouldClaimThrow = false;
  public pruneCalls: string[] = [];

  async listCandidateTrips(): Promise<CandidateTrip[]> {
    return this.candidateTrips;
  }

  async listDoneKeys(tripIds: readonly string[]): Promise<Map<string, Set<string>>> {
    const res = new Map<string, Set<string>>();
    for (const id of tripIds) {
      res.set(id, new Set(this.doneKeysMap.get(id) ?? []));
    }
    return res;
  }

  async listClaimedKeys(tripIds: readonly string[], sinceIso: string): Promise<Map<string, Set<string>>> {
    const res = new Map<string, Set<string>>();
    for (const id of tripIds) {
      res.set(id, new Set<string>());
    }
    for (const row of this.ledger) {
      if (tripIds.includes(row.tripId) && row.dropAt >= sinceIso) {
        const key = ledgerKey(row.kind as any, row.dropAt, row.lead as any);
        res.get(row.tripId)?.add(key);
      }
    }
    return res;
  }

  async claimReminder(tripId: string, r: DueReminder): Promise<boolean> {
    if (this.shouldClaimThrow) {
      throw new Error('Simulated DB claim failure');
    }
    // Conflict-ignoring behavior
    const exists = this.ledger.some(
      (row) =>
        row.tripId === tripId &&
        row.kind === r.kind &&
        row.dropAt === r.dropAt &&
        row.lead === r.lead,
    );
    if (exists) {
      return false;
    }
    this.ledger.push({
      tripId,
      kind: r.kind,
      dropAt: r.dropAt,
      lead: r.lead,
    });
    return true;
  }

  async listReminderRecipients(tripId: string): Promise<string[]> {
    return this.recipientsMap.get(tripId) ?? ['user-1'];
  }

  async pruneLedger(cutoffIso: string): Promise<number> {
    this.pruneCalls.push(cutoffIso);
    const initialLen = this.ledger.length;
    this.ledger = this.ledger.filter((r) => r.dropAt >= cutoffIso);
    return initialLen - this.ledger.length;
  }
}

function dummyLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const baseConfig: ReminderConfig = {
  leads: ['eve', 'open'],
  catchupMinutes: 180,
  minPassIntervalSeconds: 300,
  sendStartMinutes: 360, // 06:00
  sendEndMinutes: 1380, // 23:00
  retentionDays: 30,
};

describe('Reminder Runner', () => {
  // Feature: trip-booking-timeline, Property 15: Passes outside the Send_Window do nothing; passes inside dispatch everything due
  it('Property 15: passes outside Send_Window do nothing; passes inside dispatch everything due', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1439 }), // minute of day
        async (nowMinute) => {
          const repo = new FakeRunnerRepo();
          repo.candidateTrips = [
            {
              id: 'trip-1',
              name: 'Family Vacation',
              startDate: '2026-12-01',
              endDate: '2026-12-07',
              hasResortStay: true,
              settings: null,
            },
          ];
          repo.recipientsMap.set('trip-1', ['user-1', 'user-2']);

          const dispatched: TripBookingReminderNotice[] = [];
          const dispatch = async (notice: TripBookingReminderNotice) => {
            dispatched.push(notice);
          };

          // Anchor instant to 2026-10-02 at nowMinute in WDW
          const nowIso = wdwIsoAtMinutes('2026-10-02', nowMinute);
          const now = new Date(nowIso);

          const runner = createReminderRunner({
            repo,
            dispatch,
            config: baseConfig,
            logger: dummyLogger(),
            now: () => now,
          });

          const summary = await runner.runPass(now);

          const isInsideWindow = nowMinute >= 360 && nowMinute < 1380;
          if (!isInsideWindow) {
            expect(summary.tripsEvaluated).toBe(0);
            expect(summary.remindersClaimed).toBe(0);
            expect(summary.remindersDispatched).toBe(0);
            expect(repo.ledger.length).toBe(0);
            expect(dispatched.length).toBe(0);
          } else {
            // Inside send window: summary matches dispatched
            expect(summary.tripsEvaluated).toBe(1);
            expect(summary.remindersClaimed).toBe(repo.ledger.length);
            expect(summary.remindersDispatched).toBe(
              dispatched.reduce(
                (sum, n) => sum + (n.windows.length > 0 ? n.windows.length : 1),
                0,
              ),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: trip-booking-timeline, Property 23: Across any number of passes each ledger key is dispatched at most once
  it('Property 23: across any number of passes each ledger key is dispatched at most once', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }), // number of passes
        fc.boolean(), // whether dispatch throws
        fc.boolean(), // whether recipients empty
        async (numPasses, dispatchThrows, recipientsEmpty) => {
          const repo = new FakeRunnerRepo();
          repo.candidateTrips = [
            {
              id: 'trip-1',
              name: 'Family Vacation',
              startDate: '2026-12-02',
              endDate: '2026-12-08',
              hasResortStay: true,
              settings: null,
            },
          ];

          if (recipientsEmpty) {
            repo.recipientsMap.set('trip-1', []);
          } else {
            repo.recipientsMap.set('trip-1', ['user-1']);
          }

          const dispatchedNotices: TripBookingReminderNotice[] = [];
          const dispatch = async (notice: TripBookingReminderNotice) => {
            dispatchedNotices.push(notice);
            if (dispatchThrows) {
              throw new Error('Simulated push dispatch failure');
            }
          };

          // Trip is 2026-12-02 start; dining 60 days before is 2026-10-03.
          // Eve reminder fires at 2026-10-02T20:00 WDW (1200 minutes from midnight).
          const nowIso = wdwIsoAtMinutes('2026-10-02', 1205);
          const now = new Date(nowIso);

          const runner = createReminderRunner({
            repo,
            dispatch,
            config: baseConfig,
            logger: dummyLogger(),
            now: () => now,
          });

          // Run consecutive passes
          for (let i = 0; i < numPasses; i++) {
            await runner.runPass(now);
          }

          // In the first pass:
          // If claim was made, ledger has exactly 1 entry for this trip/kind/dropAt/lead.
          // In subsequent passes: claim was NOT made again.
          const uniqueLedgerKeys = new Set(
            repo.ledger.map((r) => `${r.tripId}|${r.kind}|${r.dropAt}|${r.lead}`),
          );
          expect(repo.ledger.length).toBe(uniqueLedgerKeys.size);

          if (recipientsEmpty) {
            expect(dispatchedNotices.length).toBe(0);
          } else {
            // Dispatched reached at most once despite multiple passes
            expect(dispatchedNotices.length).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('verifies ledger-before-dispatch and claim failure behavior (unit)', async () => {
    const repo = new FakeRunnerRepo();
    repo.candidateTrips = [
      {
        id: 'trip-1',
        name: 'Family Vacation',
        startDate: '2026-12-02',
        endDate: '2026-12-08',
        hasResortStay: true,
        settings: null,
      },
    ];
    repo.recipientsMap.set('trip-1', ['user-1']);

    // 1. Claim fails: throws error.
    repo.shouldClaimThrow = true;
    let dispatchCalled = false;
    const runner = createReminderRunner({
      repo,
      dispatch: async () => {
        dispatchCalled = true;
      },
      config: baseConfig,
      logger: dummyLogger(),
    });

    const nowIso = wdwIsoAtMinutes('2026-10-02', 1205);
    const now = new Date(nowIso);

    const s1 = await runner.runPass(now);
    expect(s1.remindersClaimed).toBe(0);
    expect(s1.remindersDispatched).toBe(0);
    expect(repo.ledger.length).toBe(0);
    expect(dispatchCalled).toBe(false);

    // 2. Next pass, claim succeeds, but dispatch fails.
    repo.shouldClaimThrow = false;
    let dispatchAttempted = false;
    const runner2 = createReminderRunner({
      repo,
      dispatch: async () => {
        dispatchAttempted = true;
        throw new Error('Network error during dispatch');
      },
      config: baseConfig,
      logger: dummyLogger(),
    });

    const s2 = await runner2.runPass(now);
    expect(s2.remindersClaimed).toBe(1);
    expect(dispatchAttempted).toBe(true);
    // Ledger row was claimed and retained despite dispatch failure
    expect(repo.ledger.length).toBe(1);

    // 3. Subsequent pass: already claimed, does not re-dispatch or re-claim
    let reDispatchAttempted = false;
    const runner3 = createReminderRunner({
      repo,
      dispatch: async () => {
        reDispatchAttempted = true;
      },
      config: baseConfig,
      logger: dummyLogger(),
    });

    const s3 = await runner3.runPass(now);
    expect(s3.remindersClaimed).toBe(0);
    expect(s3.remindersDispatched).toBe(0);
    expect(reDispatchAttempted).toBe(false);
  });

  it('tryStart enforces single in-flight pass and debouncing', async () => {
    const repo = new FakeRunnerRepo();
    let resolvePass!: () => void;
    const passPromise = new Promise<void>((r) => {
      resolvePass = r;
    });

    let passStarted = false;
    repo.listCandidateTrips = async () => {
      passStarted = true;
      await passPromise;
      return [];
    };

    let clockMs = 1_000_000;
    const runner = createReminderRunner({
      repo,
      dispatch: async () => {},
      config: baseConfig, // minPassIntervalSeconds = 300 (300,000 ms)
      logger: dummyLogger(),
      now: () => new Date(clockMs),
    });

    // First call: starts
    const r1 = runner.tryStart();
    expect(r1).toEqual({ started: true });

    // Second call while pass is in flight: skip in_flight
    const r2 = runner.tryStart();
    expect(r2).toEqual({ started: false, reason: 'in_flight' });

    // Resolve in-flight pass
    resolvePass();
    // Allow async runPass finally block to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(passStarted).toBe(true);

    // Third call: idle, but within debounce window (clockMs unchanged)
    const r3 = runner.tryStart();
    expect(r3).toEqual({ started: false, reason: 'debounced' });

    // Advance clock past 300s
    clockMs += 301_000;
    const r4 = runner.tryStart();
    expect(r4).toEqual({ started: true });
  });
});
