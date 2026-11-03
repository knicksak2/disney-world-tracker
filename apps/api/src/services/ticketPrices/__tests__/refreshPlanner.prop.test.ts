import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decideRefresh, type RefreshDecisionInput } from '../refreshPlanner.js';

describe('refreshPlanner', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  const today = '2026-10-25';

  const defaultCfg = {
    staleAfterDays: 1,
    attemptIntervalHours: 24,
    probeIntervalHours: 4,
    claimTimeoutMinutes: 15 as const,
  };

  const defaultAllowed = {
    'std-gst': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'fl-resident': [3, 4],
  };

  const baseInput: RefreshDecisionInput = {
    enabled: true,
    now,
    today,
    control: {
      lastAttemptAt: null,
      lastProbeAt: null,
      blockedUntil: null,
      inProgressSince: null,
      observedHorizonDate: '2027-10-25',
    },
    sets: [
      {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-25T08:00:00.000Z'),
        horizonDate: '2027-10-25',
        lastError: null,
      },
    ],
    demand: {
      groups: ['std-gst'],
      numDays: [1],
      maxStartDate: '2026-11-01',
    },
    allowedNumDaysByGroup: defaultAllowed,
    cfg: defaultCfg,
  };

  it('rule 1: disabled returns action none / disabled', () => {
    const input: RefreshDecisionInput = { ...baseInput, enabled: false };
    expect(decideRefresh(input)).toEqual({ action: 'none', reason: 'disabled' });
  });

  it('rule 2: blockedUntil in future returns action none / blocked', () => {
    const input: RefreshDecisionInput = {
      ...baseInput,
      control: {
        ...baseInput.control,
        blockedUntil: new Date('2026-10-25T14:00:00.000Z'),
      },
    };
    expect(decideRefresh(input)).toEqual({ action: 'none', reason: 'blocked' });
  });

  it('rule 3: inProgressSince within claim timeout returns action none / in_flight', () => {
    const input: RefreshDecisionInput = {
      ...baseInput,
      control: {
        ...baseInput.control,
        inProgressSince: new Date(now.getTime() - 10 * 60_000), // 10 min ago < 15 min
      },
    };
    expect(decideRefresh(input)).toEqual({ action: 'none', reason: 'in_flight' });
  });

  it('rule 4: a not_offered set or non-permitted pair never produces full', () => {
    // fl-resident numDays 2 is not permitted (only 3, 4 allowed)
    // fl-resident numDays 3 has lastError: 'not_offered'
    const input: RefreshDecisionInput = {
      ...baseInput,
      sets: [
        {
          discountGroup: 'fl-resident',
          numDays: 3,
          asOf: null,
          horizonDate: null,
          lastError: 'not_offered',
        },
      ],
      demand: {
        groups: ['fl-resident'],
        numDays: [2, 3],
        maxStartDate: '2026-11-01',
      },
    };

    const res = decideRefresh(input);
    expect(res.action).not.toBe('full');

    // std-gst numDays 11 is not permitted (1..10)
    const inputStd: RefreshDecisionInput = {
      ...baseInput,
      demand: {
        groups: ['std-gst'],
        numDays: [11],
        maxStartDate: '2026-11-01',
      },
    };
    const resStd = decideRefresh(inputStd);
    expect(resStd.action).not.toBe('full');
  });

  it('rule 5: a demanded set whose horizonDate is earlier than observedHorizonDate is stale and yields full after attempt cooldown', () => {
    const staleHorizonInput: RefreshDecisionInput = {
      ...baseInput,
      control: {
        ...baseInput.control,
        observedHorizonDate: '2027-11-01', // Probe saw a newer horizon
        lastAttemptAt: new Date(now.getTime() - 25 * 3600_000), // 25h ago >= 24h
      },
      sets: [
        {
          discountGroup: 'std-gst',
          numDays: 1,
          asOf: new Date('2026-10-25T08:00:00.000Z'),
          horizonDate: '2027-10-25', // earlier than 2027-11-01
          lastError: null,
        },
      ],
      demand: {
        groups: ['std-gst'],
        numDays: [1],
        maxStartDate: '2026-11-01',
      },
    };

    const res = decideRefresh(staleHorizonInput);
    expect(res).toEqual({ action: 'full', neededNumDays: [1] });

    // But if attempt cooldown is active (e.g. attempted 2 hours ago):
    const cooldownInput: RefreshDecisionInput = {
      ...staleHorizonInput,
      control: {
        ...staleHorizonInput.control,
        lastAttemptAt: new Date(now.getTime() - 2 * 3600_000),
      },
    };
    expect(decideRefresh(cooldownInput)).toEqual({ action: 'none', reason: 'attempt_cooldown' });
  });

  it('rule 6: probe_only is judged on lastProbeAt only (ignoring lastAttemptAt)', () => {
    // Demand extends beyond known horizon
    const beyondInput: RefreshDecisionInput = {
      ...baseInput,
      control: {
        ...baseInput.control,
        lastAttemptAt: new Date(now.getTime() - 1 * 3600_000), // Recent full run 1h ago!
        lastProbeAt: new Date(now.getTime() - 5 * 3600_000), // Probe was 5h ago >= 4h
        observedHorizonDate: '2027-10-25',
      },
      sets: [
        {
          discountGroup: 'std-gst',
          numDays: 1,
          asOf: new Date('2026-10-25T08:00:00.000Z'),
          horizonDate: '2027-10-25',
          lastError: null,
        },
      ],
      demand: {
        groups: ['std-gst'],
        numDays: [1],
        maxStartDate: '2027-11-15', // Beyond 2027-10-25!
      },
    };

    // Even though lastAttemptAt is only 1h ago, probe_only triggers because lastProbeAt is 5h ago!
    expect(decideRefresh(beyondInput)).toEqual({ action: 'probe_only', neededNumDays: [1] });

    // If lastProbeAt was 1h ago, returns probe_cooldown
    const probeCooldownInput: RefreshDecisionInput = {
      ...beyondInput,
      control: {
        ...beyondInput.control,
        lastProbeAt: new Date(now.getTime() - 1 * 3600_000),
      },
    };
    expect(decideRefresh(probeCooldownInput)).toEqual({ action: 'none', reason: 'probe_cooldown' });
  });

  it('rule 7: fresh sets and within horizon return action none / fresh', () => {
    expect(decideRefresh(baseInput)).toEqual({ action: 'none', reason: 'fresh' });
  });

  // Feature: trip-budget, Property 15: The refresh planner never starts an unsafe refresh
  it('Property 15: The refresh planner never starts an unsafe refresh (fast-check, 100 runs)', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // enabled
        fc.option(fc.date(), { nil: null }), // blockedUntil
        fc.option(fc.date(), { nil: null }), // inProgressSince
        fc.option(fc.date(), { nil: null }), // lastAttemptAt
        fc.option(fc.date(), { nil: null }), // lastProbeAt
        fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 5 }), // demand numDays
        (enabled, blockedUntil, inProgressSince, lastAttemptAt, lastProbeAt, numDays) => {
          const input: RefreshDecisionInput = {
            enabled,
            now,
            today,
            control: {
              lastAttemptAt,
              lastProbeAt,
              blockedUntil,
              inProgressSince,
              observedHorizonDate: '2027-10-25',
            },
            sets: [
              {
                discountGroup: 'std-gst',
                numDays: 1,
                asOf: new Date('2026-10-25T08:00:00.000Z'),
                horizonDate: '2027-10-25',
                lastError: null,
              },
            ],
            demand: {
              groups: ['std-gst'],
              numDays,
              maxStartDate: '2026-11-01',
            },
            allowedNumDaysByGroup: defaultAllowed,
            cfg: defaultCfg,
          };

          const res = decideRefresh(input);

          // Invariant 1: If not enabled, must be action: none, reason: disabled
          if (!enabled) {
            expect(res).toEqual({ action: 'none', reason: 'disabled' });
          }

          // Invariant 2: If blocked, must be action: none, reason: blocked (unless disabled came first)
          if (enabled && blockedUntil !== null && blockedUntil > now) {
            expect(res).toEqual({ action: 'none', reason: 'blocked' });
          }

          // Invariant 3: If in flight, must be action: none, reason: in_flight (unless disabled or blocked came first)
          if (
            enabled &&
            (blockedUntil === null || blockedUntil <= now) &&
            inProgressSince !== null &&
            now.getTime() - inProgressSince.getTime() < 15 * 60_000
          ) {
            expect(res).toEqual({ action: 'none', reason: 'in_flight' });
          }

          // Invariant 4: If action is full, attempt cooldown must NOT be active
          if (res.action === 'full') {
            if (lastAttemptAt !== null) {
              const diffMs = now.getTime() - lastAttemptAt.getTime();
              expect(diffMs).toBeGreaterThanOrEqual(24 * 3600_000);
            }
          }

          // Invariant 5: If action is probe_only, probe cooldown must NOT be active
          if (res.action === 'probe_only') {
            if (lastProbeAt !== null) {
              const diffMs = now.getTime() - lastProbeAt.getTime();
              expect(diffMs).toBeGreaterThanOrEqual(4 * 3600_000);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

