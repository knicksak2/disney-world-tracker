// Feature: trip-budget, Property 29: Diagnose safety and token isolation
import { describe, expect, it } from 'vitest';
import { runDiagnose } from '../diagnose.js';
import { TicketClientError, type TicketPriceClient } from '../ticketPriceClient.js';
import type { TicketPricesRepo } from '../repo.js';

describe('diagnose (Property 29 & Round 4 M1)', () => {
  const today = '2026-10-25';
  let mockClock = new Date('2026-10-25T12:00:00.000Z');

  function createMockRepo() {
    let blockedUntil: Date | null = null;
    let inProgressSince: Date | null = null;
    let lastDiagnoseAt: Date | null = null;
    let lastStatus: string | null = null;
    let lastError: string | null = null;
    const releaseControlCalls: Array<{ status: string; error: string | null }> = [];

    const repo: TicketPricesRepo = {
      readBlockedUntil: async () => blockedUntil,
      claimControl: async (mode, _bypass, timeoutMins, intervalSecs) => {
        if (mode === 'diagnose') {
          if (blockedUntil && blockedUntil > mockClock) return false;
          if (inProgressSince && mockClock.getTime() - inProgressSince.getTime() < timeoutMins * 60_000) {
            return false;
          }
          if (lastDiagnoseAt && mockClock.getTime() - lastDiagnoseAt.getTime() < intervalSecs * 1000) {
            return false;
          }
          inProgressSince = mockClock;
          lastDiagnoseAt = mockClock;
          return true;
        }
        return false;
      },
      releaseControl: async (status, error) => {
        inProgressSince = null;
        lastStatus = status;
        lastError = error ?? null;
        releaseControlCalls.push({ status, error: error ?? null });
      },
      readBook: async () => ({
        rows: [],
        sets: [],
        control: {
          id: 1,
          lastAttemptAt: null,
          lastProbeAt: null,
          blockedUntil,
          inProgressSince,
          observedHorizonDate: null,
          lastDiagnoseAt,
          lastStatus,
          lastError,
          updatedAt: mockClock,
        },
      }),
      block: async (until, reason) => {
        blockedUntil = until;
        if (reason) lastError = reason;
      },
      upgradeClaimToFull: async () => false,
      recordProbe: async () => {},
      upsertRows: async () => 0,
      reconcileSet: async () => 0,
      pruneBeforeToday: async () => 0,
      updateSet: async () => {},
      recordSetError: async () => {},
    };

    return {
      repo,
      setBlocked: (until: Date | null) => {
        blockedUntil = until;
      },
      setInProgress: (since: Date | null) => {
        inProgressSince = since;
      },
      getLastError: () => lastError,
      getReleaseControlCalls: () => releaseControlCalls,
    };
  }

  function createMockClient(overrides?: {
    getToken?: () => Promise<string>;
    getPrices?: TicketPriceClient['getPrices'];
  }) {
    let tokenCalls = 0;
    let priceCalls = 0;

    const client: TicketPriceClient = {
      getToken: async () => {
        tokenCalls++;
        if (overrides?.getToken) return overrides.getToken();
        return 'secret_access_token_123';
      },
      getTokenWithMeta: async () => {
        tokenCalls++;
        return {
          token: 'secret_access_token_123',
          status: 200,
          bytes: 45,
          ms: 120,
        };
      },
      getPrices: async (p) => {
        priceCalls++;
        if (overrides?.getPrices) return overrides.getPrices(p);
        return {
          body: {
            maxPricingCalendarDate: '2027-10-25',
            pricingCalendar: [
              {
                numDays: '1',
                dates: [
                  {
                    date: p.startDate,
                    pricing: [
                      {
                        id: 'theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk',
                        subtotal: '184.00',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          bytes: 1500,
          ms: 250,
          status: 200,
          startDateSent: p.startDate,
        };
      },
    };

    return {
      client,
      counts: () => ({ tokenCalls, priceCalls }),
    };
  }

  it('runs two calls, returns AdminDiagnoseResult without token, extracts MK price', async () => {
    const { repo } = createMockRepo();
    const { client, counts } = createMockClient();

    const res = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });

    expect('refused' in res).toBe(false);
    if (!('refused' in res)) {
      expect(res.maxPricingCalendarDate).toBe('2027-10-25');
      expect(res.adultMk1DayPriceCents).toBe(18400);
      expect(res.prices.status).toBe(200);
      expect(res.token.status).toBe(200);

      // Property 29: result contains NO secret token
      expect(JSON.stringify(res)).not.toContain('secret_access_token_123');
    }

    expect(counts()).toEqual({ tokenCalls: 1, priceCalls: 1 });
  });

  it('second diagnose within 60s returns too_soon with zero client calls', async () => {
    const { repo } = createMockRepo();
    const { client, counts } = createMockClient();

    const res1 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res1).toBe(false);

    // Call 2 immediate (< 60s)
    const res2 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect(res2).toEqual({ refused: 'too_soon' });
    expect(counts()).toEqual({ tokenCalls: 1, priceCalls: 1 }); // No second client call
  });

  it('diagnose while run in flight returns already_running', async () => {
    const { repo, setInProgress } = createMockRepo();
    const { client, counts } = createMockClient();

    setInProgress(mockClock);
    const res = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect(res).toEqual({ refused: 'already_running' });
    expect(counts()).toEqual({ tokenCalls: 0, priceCalls: 0 });
  });

  it('diagnose while blocked returns blocked with blockedUntil', async () => {
    const { repo, setBlocked } = createMockRepo();
    const { client, counts } = createMockClient();

    const blockUntil = new Date(mockClock.getTime() + 3600_000);
    setBlocked(blockUntil);

    const res = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect(res).toEqual({ refused: 'blocked', blockedUntil: blockUntil.toISOString() });
    expect(counts()).toEqual({ tokenCalls: 0, priceCalls: 0 });
  });

  it('round 4 M1: works with enabled = false, and three consecutive diagnoses 61s apart succeed', async () => {
    const { repo } = createMockRepo();
    const { client, counts } = createMockClient();

    // 1st diagnose
    const res1 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res1).toBe(false);

    // Advance clock 61 seconds
    mockClock = new Date(mockClock.getTime() + 61_000);
    const res2 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res2).toBe(false);

    // Advance clock another 61 seconds
    mockClock = new Date(mockClock.getTime() + 61_000);
    const res3 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res3).toBe(false);

    expect(counts()).toEqual({ tokenCalls: 3, priceCalls: 3 });
  });

  it('A4: diagnose handles client throwing waf_block on price call without throwing (sets failure.call, failure.code, wafMarker: true)', async () => {
    const { repo } = createMockRepo();
    const { client, counts } = createMockClient({
      getPrices: async () => {
        throw new TicketClientError('waf_block', 'Akamai challenge detected', 403);
      },
    });

    const res = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });

    expect('refused' in res).toBe(false);
    if (!('refused' in res)) {
      expect(res.failure).toBeDefined();
      expect(res.failure?.call).toBe('prices');
      expect(res.failure?.code).toBe('waf_block');
      expect(res.prices.wafMarker).toBe(true);
    }
    expect(counts().tokenCalls).toBe(1);
    const book = await repo.readBook([], today);
    expect(book.control?.blockedUntil).not.toBeNull();
  });

  it('A4: diagnose handles client throwing timeout on token call without throwing (sets failure.call, failure.code, wafMarker: false)', async () => {
    const { repo } = createMockRepo();
    const { client, counts } = createMockClient({
      getToken: async () => {
        throw new TicketClientError('timeout', 'Gateway timeout', 504);
      },
    });

    const res = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 60,
      blockCooldownMinutes: 360,
    });

    expect('refused' in res).toBe(false);
    if (!('refused' in res)) {
      expect(res.failure).toBeDefined();
      expect(res.failure?.call).toBe('token');
      expect(res.failure?.code).toBe('timeout');
      expect(res.prices.wafMarker).toBe(false);
    }
    expect(counts().tokenCalls).toBe(1);
    expect(counts().priceCalls).toBe(0);
  });

  it('P3: runDiagnose releases control with waf_block on token WAF, on price WAF, and with null on success', async () => {
    // 1. Success path releases with (diagnose_complete, null)
    {
      const { repo, getReleaseControlCalls } = createMockRepo();
      const { client } = createMockClient();
      await runDiagnose(client, repo, today, () => mockClock, {
        claimTimeoutMinutes: 15,
        diagnoseMinIntervalSeconds: 60,
        blockCooldownMinutes: 360,
      });
      const calls = getReleaseControlCalls();
      expect(calls).toEqual([{ status: 'diagnose_complete', error: null }]);
    }

    // 2. WAF on token call releases with (diagnose_complete, 'waf_block')
    {
      const { repo, getReleaseControlCalls } = createMockRepo();
      const { client } = createMockClient({
        getToken: async () => {
          throw new TicketClientError('waf_block', 'Akamai blocked token', 403);
        },
      });
      await runDiagnose(client, repo, today, () => mockClock, {
        claimTimeoutMinutes: 15,
        diagnoseMinIntervalSeconds: 60,
        blockCooldownMinutes: 360,
      });
      const calls = getReleaseControlCalls();
      expect(calls).toEqual([{ status: 'diagnose_complete', error: 'waf_block' }]);
    }

    // 3. WAF on price call releases with (diagnose_complete, 'waf_block')
    {
      const { repo, getReleaseControlCalls } = createMockRepo();
      const { client } = createMockClient({
        getPrices: async () => {
          throw new TicketClientError('waf_block', 'Akamai blocked prices', 403);
        },
      });
      await runDiagnose(client, repo, today, () => mockClock, {
        claimTimeoutMinutes: 15,
        diagnoseMinIntervalSeconds: 60,
        blockCooldownMinutes: 360,
      });
      const calls = getReleaseControlCalls();
      expect(calls).toEqual([{ status: 'diagnose_complete', error: 'waf_block' }]);
    }
  });

  it('P4 / A6d: runDiagnose with requestSpacingMs: 1500 records exactly one sleep of 1500ms between token and price calls', async () => {
    const { repo } = createMockRepo();
    const { client } = createMockClient();
    const recordedSleeps: number[] = [];
    const eventOrder: string[] = [];

    const instrumentedClient: TicketPriceClient = {
      getToken: async () => {
        eventOrder.push('token');
        return client.getToken();
      },
      getPrices: async (params) => {
        eventOrder.push('prices');
        return client.getPrices(params);
      },
    };

    const sleepFn = async (ms: number) => {
      recordedSleeps.push(ms);
      eventOrder.push(`sleep:${ms}`);
    };

    const res = await runDiagnose(
      instrumentedClient,
      repo,
      today,
      () => mockClock,
      {
        claimTimeoutMinutes: 15,
        diagnoseMinIntervalSeconds: 60,
        blockCooldownMinutes: 360,
        requestSpacingMs: 1500,
      },
      sleepFn,
    );

    expect('refused' in res).toBe(false);
    expect(recordedSleeps).toEqual([1500]);
    expect(eventOrder).toEqual(['token', 'sleep:1500', 'prices']);
  });

  it('N-a: runDiagnose wires diagnoseMinIntervalSeconds config into claimControl (5s interval, succeeds at 6s)', async () => {
    const { repo } = createMockRepo();
    const { client } = createMockClient();

    // 1st diagnose with 5s min interval
    const res1 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 5,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res1).toBe(false);

    // 2nd diagnose 3s later (< 5s) -> refused too_soon
    mockClock = new Date(mockClock.getTime() + 3_000);
    const res2 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 5,
      blockCooldownMinutes: 360,
    });
    expect(res2).toEqual({ refused: 'too_soon' });

    // 3rd diagnose 3s later (total 6s > 5s) -> succeeds (would fail if 60s hardcoded!)
    mockClock = new Date(mockClock.getTime() + 3_000);
    const res3 = await runDiagnose(client, repo, today, () => mockClock, {
      claimTimeoutMinutes: 15,
      diagnoseMinIntervalSeconds: 5,
      blockCooldownMinutes: 360,
    });
    expect('refused' in res3).toBe(false);
  });
});

