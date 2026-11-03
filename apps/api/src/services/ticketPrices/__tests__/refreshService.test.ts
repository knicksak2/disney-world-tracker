/**
 * Feature: trip-budget, Property 16 & Property 37: Ticket Prices Refresh Service Tests
 *
 * Validates: Requirements 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.3, 13.4, 13.5, 13.6, 13.7, 13.9, 13.11, 13.12, 11.13, 19.2, 19.3, 19.8
 */

import { describe, expect, it } from 'vitest';
import {
  createTicketPricesService,
  type TicketPricesServiceConfig,
} from '../refreshService.js';
import { TicketClientError, type TicketPriceClient } from '../ticketPriceClient.js';
import type { TicketPricesRepo, StorableTicketPriceRow } from '../repo.js';
import type { TicketPriceKey, TicketPriceSetMeta } from '../types.js';

describe('TicketPricesService (refreshService.ts) - Property 16 & Property 37', () => {
  const defaultCfg: TicketPricesServiceConfig = {
    enabled: true,
    groups: ['std-gst', 'fl-resident'],
    flResidentNumDays: [3, 4],
    staleAfterDays: 1,
    minAttemptIntervalHours: 24,
    probeMinIntervalHours: 4,
    blockCooldownMinutes: 360,
    failureCooldownMinutes: 60,
    diagnoseMinIntervalSeconds: 60,
    requestSpacingMs: 0,
    requestTimeoutMs: 5000,
    maxBodyBytes: 100_000,
    maxConsecutiveFailures: 2,
    sanityMinRatio: 0.7,
    maxUnrecognizedFraction: 0.1,
    freshDays: 45,
    estimateAfterDays: 120,
  };

  const today = '2026-10-25';

  function createTestHarness(cfgOverrides?: Partial<TicketPricesServiceConfig>) {
    const config: TicketPricesServiceConfig = { ...defaultCfg, ...cfgOverrides };
    let mockClock = new Date('2026-10-25T12:00:00.000Z');
    let blockedUntil: Date | null = null;
    let inProgressSince: Date | null = null;
    let lastAttemptAt: Date | null = null;
    let lastProbeAt: Date | null = null;
    let observedHorizon: string | null = null;
    let lastStatus: string | null = null;
    let lastError: string | null = null;
    let readBookCallCount = 0;

    const setErrors = new Map<string, string>();
    const updatedSets = new Map<string, any>();
    const upsertedRows: StorableTicketPriceRow[] = [];
    const releaseControlCalls: { status: string; err: string | null }[] = [];
    const sleepCalls: number[] = [];
    const timeline: string[] = [];
    let pruneCalled = false;

    let customSets: Array<{
      discountGroup: string;
      numDays: number;
      asOf: Date | null;
      horizonDate: string | null;
      rowCount?: number;
      windowDays?: number;
      lastAttemptAt?: Date | null;
      lastError: string | null;
    }> | null = null;

    const repo: TicketPricesRepo = {
      readBlockedUntil: async () => blockedUntil,
      claimControl: async (mode, bypass, timeoutMins = 15, intervalVal = 24) => {
        if (blockedUntil && blockedUntil > mockClock) return false;
        if (inProgressSince && mockClock.getTime() - inProgressSince.getTime() < timeoutMins * 60_000) {
          return false;
        }
        if (mode === 'full') {
          if (!bypass && lastAttemptAt && mockClock.getTime() - lastAttemptAt.getTime() < intervalVal * 3600_000) {
            return false;
          }
          lastAttemptAt = mockClock;
          inProgressSince = mockClock;
          return true;
        }
        if (mode === 'probe_only') {
          if (lastProbeAt && mockClock.getTime() - lastProbeAt.getTime() < intervalVal * 3600_000) {
            return false;
          }
          lastProbeAt = mockClock;
          inProgressSince = mockClock;
          return true;
        }
        if (mode === 'diagnose') {
          if (inProgressSince && mockClock.getTime() - inProgressSince.getTime() < timeoutMins * 60_000) {
            return false;
          }
          return true;
        }
        return false;
      },
      upgradeClaimToFull: async (hours) => {
        if (!inProgressSince) return false;
        if (lastAttemptAt && mockClock.getTime() - lastAttemptAt.getTime() < hours * 3600_000) {
          return false;
        }
        lastAttemptAt = mockClock;
        return true;
      },
      releaseControl: async (status, err) => {
        releaseControlCalls.push({ status, err: err ?? null });
        inProgressSince = null;
        lastStatus = status;
        if (err !== undefined && err !== null) {
          lastError = err;
        } else if (status === 'blocked' || (blockedUntil && blockedUntil > mockClock)) {
          // preserve existing lastError
        } else {
          lastError = null;
        }
      },
      recordProbe: async (_now, h) => {
        lastProbeAt = mockClock;
        observedHorizon = h;
      },
      block: async (until, reason) => {
        blockedUntil = until;
        lastError = reason;
      },
      readBook: async (_keys: readonly TicketPriceKey[] = [], _today: string = today) => {
        readBookCallCount++;
        const defaultSets = [
          {
            discountGroup: 'std-gst',
            numDays: 1,
            asOf: null,
            horizonDate: null,
            lastError: setErrors.get('std-gst|1') ?? null,
          },
          {
            discountGroup: 'std-gst',
            numDays: 4,
            asOf: null,
            horizonDate: null,
            lastError: setErrors.get('std-gst|4') ?? null,
          },
          {
            discountGroup: 'fl-resident',
            numDays: 3,
            asOf: null,
            horizonDate: null,
            lastError: setErrors.get('fl-resident|3') ?? null,
          },
        ];
        return {
          rows: [],
          sets: (customSets ?? defaultSets) as TicketPriceSetMeta[],
          control: {
            id: 1,
            lastAttemptAt,
            lastProbeAt,
            blockedUntil,
            inProgressSince,
            observedHorizonDate: observedHorizon,
            lastDiagnoseAt: null,
            lastStatus,
            lastError,
            updatedAt: mockClock,
          },
        };
      },
      upsertRows: async (rows) => {
        upsertedRows.push(...rows);
        return rows.length;
      },
      reconcileSet: async () => 0,
      pruneBeforeToday: async () => {
        pruneCalled = true;
        return 0;
      },
      updateSet: async (g, n, asOf, h, count, w) => {
        updatedSets.set(`${g}|${n}`, { asOf, h, count, w });
      },
      recordSetError: async (g, n, err) => {
        setErrors.set(`${g}|${n}`, err);
      },
    };

    const clientCalls: { path: string; group?: string; numDays?: number; start?: string; end?: string }[] = [];
    const client: TicketPriceClient = {
      getToken: async () => {
        clientCalls.push({ path: 'T' });
        timeline.push('T');
        return 'token_test_123';
      },
      getPrices: async (p) => {
        clientCalls.push({
          path: 'P',
          group: p.discountGroup,
          numDays: p.numDays,
          start: p.startDate,
          end: p.endDate,
        });
        timeline.push(`P:${p.discountGroup}:${p.numDays}`);
        return {
          body: {
            maxPricingCalendarDate: '2027-10-25',
            pricingCalendar: [
              {
                numDays: String(p.numDays),
                dates: [
                  {
                    date: p.startDate,
                    validityEndDate: p.endDate,
                    pricing: [
                      {
                        id: `theme-park_${p.numDays}_A_0_${p.discountGroup === 'std-gst' ? '0' : '2'}_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                        ageGroup: 'adult',
                        pricePerDay: '100.00',
                        subtotal: `${p.numDays * 100}.00`,
                        tax: '6.50',
                        stopSale: false,
                        availability: true,
                        enabled: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          bytes: 1200,
          ms: 100,
          status: 200,
          startDateSent: p.startDate,
        };
      },
    };

    const mockPool: any = {
      query: async (text: string) => {
        if (text.includes('SELECT count(*)')) return { rows: [{ count: '10' }] };
        if (text.includes('pg_size_pretty')) return { rows: [{ size: '16 kB' }] };
        if (text.includes('theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk')) return { rows: [{ price_cents: 18400 }] };
        return { rows: [] };
      },
    };

    const sleepFn = async (ms: number) => {
      sleepCalls.push(ms);
      timeline.push(`sleep:${ms}`);
      mockClock = new Date(mockClock.getTime() + ms);
    };

    const service = createTicketPricesService({
      pool: mockPool,
      repo,
      client,
      config,
      todayFn: () => today,
      nowFn: () => mockClock,
      sleepFn,
    });

    return {
      service,
      repo,
      client,
      clientCalls,
      timeline,
      setErrors,
      updatedSets,
      sleepCalls,
      releaseControlCalls,
      setBlocked: (until: Date | null) => {
        blockedUntil = until;
      },
      setInProgress: (since: Date | null) => {
        inProgressSince = since;
      },
      setLastAttemptAt: (at: Date | null) => {
        lastAttemptAt = at;
      },
      setCustomSets: (sets: any[]) => {
        customSets = sets;
      },
      setObservedHorizon: (h: string | null) => {
        observedHorizon = h;
      },
      getBlockedUntil: () => blockedUntil,
      getLastAttemptAt: () => lastAttemptAt,
      getLastProbeAt: () => lastProbeAt,
      getLastError: () => lastError,
      getInFlightSince: () => inProgressSince,
      getReadBookCallCount: () => readBookCallCount,
      getUpsertedRows: () => upsertedRows,
      isPruneCalled: () => pruneCalled,
      advanceClock: (ms: number) => {
        mockClock = new Date(mockClock.getTime() + ms);
      },
      now: () => mockClock,
    };
  }

  // =========================================================================
  // A1: R1 runNow semantics
  // =========================================================================

  it('R1: runNow claims control row once, client receives token and price calls, releaseControl runs, and second runNow returns already_running', async () => {
    const h = createTestHarness();
    const admin = h.service.getAdminPort();

    // 1. First runNow claims once and runs to completion
    const res = await admin.runNow();
    expect(res.outcome).toBe('started');

    // Yield macro-task so the fire-and-forget background executeRun completes
    await new Promise((r) => setTimeout(r, 20));

    // Client received the token call and price calls
    expect(h.clientCalls.length).toBeGreaterThanOrEqual(2);
    expect(h.clientCalls[0]?.path).toBe('T');
    expect(h.clientCalls[1]?.path).toBe('P');

    // releaseControl ran and in_progress_since is cleared
    expect(h.getInFlightSince()).toBeNull();
    expect(h.releaseControlCalls.length).toBeGreaterThanOrEqual(1);

    // 2. Second runNow during run returns already_running
    h.setInProgress(h.now());
    const secondRes = await admin.runNow();
    expect(secondRes.outcome).toBe('already_running');
  });

  it('R1 & round 4 L5: runNow 2 hours after full run starts a run (bypasses cooldown); with switch off returns disabled; while blocked returns blocked', async () => {
    const h = createTestHarness();
    const admin = h.service.getAdminPort();

    // Set lastAttemptAt 2 hours ago
    const twoHoursAgo = new Date(h.now().getTime() - 2 * 3600_000);
    h.setLastAttemptAt(twoHoursAgo);

    // runNow bypasses 24h attempt cooldown
    const r1 = await admin.runNow();
    expect(r1.outcome).toBe('started');

    // While kill switch is off
    const hDisabled = createTestHarness({ enabled: false });
    const rDisabled = await hDisabled.service.getAdminPort().runNow();
    expect(rDisabled.outcome).toBe('disabled');

    // While blocked
    const hBlocked = createTestHarness();
    hBlocked.setBlocked(new Date(hBlocked.now().getTime() + 3600_000));
    const rBlocked = await hBlocked.service.getAdminPort().runNow();
    expect(rBlocked.outcome).toBe('blocked');
  });

  // =========================================================================
  // A1: R2 Acceptance rate drop with stored rowCount and windowDays
  // =========================================================================

  it('R2: acceptance rate drop: under minRatio of previous per-day rate gives row_count_drop with no upsertRows, reconcileSet or updateSet', async () => {
    const h = createTestHarness();

    // Previous set has 100 rows over 100 window days (rate = 1.0)
    h.setCustomSets([
      {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-24T00:00:00Z'),
        horizonDate: '2027-10-25',
        rowCount: 100,
        windowDays: 100,
        lastError: null,
      },
    ]);

    // Script client to return only 5 rows over 100 days (rate = 0.05, ratio = 0.05 / 1.0 < minRatio 0.7)
    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      return {
        body: {
          maxPricingCalendarDate: '2027-10-25',
          pricingCalendar: [
            {
              numDays: String(p.numDays),
              dates: [
                {
                  date: p.startDate,
                  validityEndDate: p.endDate,
                  pricing: [
                    {
                      id: 'theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk',
                      subtotal: '100.00',
                      tax: '6.50',
                    },
                  ],
                },
              ],
            },
          ],
        },
        bytes: 400,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('done');

    // Must record row_count_drop on set
    expect(h.setErrors.get('std-gst|1')).toBe('row_count_drop');

    // No rows upserted and set was not updated
    expect(h.getUpsertedRows().length).toBe(0);
    expect(h.updatedSets.has('std-gst|1')).toBe(false);
  });

  // =========================================================================
  // A1: R4 invalid_response recorded on parse failure
  // =========================================================================

  it('R4: invalid response from parsePricesResponse records invalid_response on the set', async () => {
    const h = createTestHarness();
    let priceCount = 0;
    h.client.getPrices = async (p) => {
      priceCount++;
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      if (priceCount === 2) {
        // Only set 1 returns invalid response (missing pricingCalendar)
        return {
          body: { badStructure: true },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }
      return {
        body: {
          maxPricingCalendarDate: '2027-10-25',
          pricingCalendar: [
            {
              numDays: String(p.numDays),
              dates: [
                {
                  date: p.startDate,
                  validityEndDate: p.endDate,
                  pricing: [
                    {
                      id: `theme-park_${p.numDays}_A_0_0_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                      subtotal: '100.00',
                      tax: '6.50',
                    },
                  ],
                },
              ],
            },
          ],
        },
        bytes: 100,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('done');
    expect(h.setErrors.get('std-gst|1')).toBe('invalid_response');
  });

  // =========================================================================
  // A1: R3 noteDemand tests (Property 37)
  // =========================================================================

  it('R3 / Property 37: noteDemand - 50 calls inside start_date_rejected block start zero runs and cause zero client calls', async () => {
    const h = createTestHarness();

    // Trigger start_date_rejected to establish block
    h.client.getPrices = async () => {
      throw new TicketClientError('start_date_rejected', 'Rejected', 400);
    };

    const firstRun = await h.service.run('full');
    expect(firstRun.status).toBe('blocked');
    expect(h.getBlockedUntil()).not.toBeNull();
    expect(h.getLastAttemptAt()).not.toBeNull();

    const clientCallsBefore = h.clientCalls.length;

    // 50 further noteDemand calls inside the block
    for (let i = 0; i < 50; i++) {
      h.service.noteDemand({
        groups: ['std-gst'],
        numDays: [1, 4],
        maxStartDate: '2026-12-01',
      });
    }

    // Yield execution
    await new Promise((r) => setTimeout(r, 20));

    // Zero runs started and zero client calls made!
    expect(h.clientCalls.length).toBe(clientCallsBefore);
  });

  it('R3: noteDemand ignores past start date, non-permitted pair, and switch off does zero reads', async () => {
    const h = createTestHarness();

    // 1. Past start date: today is 2026-10-25 in the harness clock
    h.service.noteDemand({
      groups: ['std-gst'],
      numDays: [1],
      maxStartDate: '2026-10-24', // past date
    });
    expect(h.getReadBookCallCount()).toBe(0);

    // 2. Non-permitted pair: fl-resident allows only [3, 4], so 7 is non-permitted
    h.service.noteDemand({
      groups: ['fl-resident'],
      numDays: [7],
      maxStartDate: '2026-12-01',
    });
    expect(h.getReadBookCallCount()).toBe(0);

    // 3. Switch off: zero repo reads
    const hDisabled = createTestHarness({ enabled: false });
    hDisabled.service.noteDemand({
      groups: ['std-gst'],
      numDays: [1],
      maxStartDate: '2026-12-01',
    });
    expect(hDisabled.getReadBookCallCount()).toBe(0);
  });

  // =========================================================================
  // A1: R3 probe_only pulls nothing when horizon is unchanged, and horizon_changed
  // =========================================================================

  it('R3: probe_only pulls nothing when horizon is unchanged', async () => {
    const h = createTestHarness();
    h.setObservedHorizon('2027-10-25');
    h.setCustomSets([
      {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-25T00:00:00Z'),
        horizonDate: '2027-10-25',
        lastError: null,
      },
    ]);

    const res = await h.service.run('probe_only');
    expect(res.status).toBe('done');
    // Only Token (T) and Probe (P) called; zero set price calls
    expect(h.clientCalls).toHaveLength(2);
    expect(h.clientCalls[0]?.path).toBe('T');
    expect(h.clientCalls[1]?.path).toBe('P');
  });

  it('R3 / Property 37: probe_only ends horizon_changed when upgradeClaimToFull loses attempt cooldown', async () => {
    const h = createTestHarness();

    // Set observed horizon and set horizon to yesterday's observation
    h.setObservedHorizon('2027-10-25');
    h.setCustomSets([
      {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-25T00:00:00Z'),
        horizonDate: '2027-10-25',
        lastError: null,
      },
    ]);

    // Active attempt cooldown (lastAttemptAt was 2 hours ago)
    h.setLastAttemptAt(new Date(h.now().getTime() - 2 * 3600_000));

    // Probe returns expanded horizon
    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      return {
        body: { maxPricingCalendarDate: '2027-10-26', pricingCalendar: [] },
        bytes: 500,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('probe_only');
    expect(res.status).toBe('horizon_changed');
    // Only T and P called; zero set price calls!
    expect(h.clientCalls).toHaveLength(2);
  });

  it('R3: needed numDays are fetched first', async () => {
    const h = createTestHarness();
    const fetchedOrder: number[] = [];

    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      if (p.numDays) {
        fetchedOrder.push(p.numDays);
      }
      return {
        body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
        bytes: 500,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    // Run full with neededNumDays = [4]
    await h.service.run('full', [4]);

    // Probe is first (numDays: 1), then needed numDays (4) is fetched before other days!
    const setDays = fetchedOrder.slice(1);
    expect(setDays[0]).toBe(4);
  });

  it('R3 / round 3 L5: probe_only claim leaves last_attempt_at unchanged, and later successful upgradeClaimToFull sets it to full attempt claim time', async () => {
    const h = createTestHarness();
    expect(h.getLastAttemptAt()).toBeNull();
    expect(h.getLastProbeAt()).toBeNull();

    const resProbe = await h.service.run('probe_only');
    expect(resProbe.status).toBe('done');
    expect(h.getLastAttemptAt()).toBeNull(); // unchanged!
    expect(h.getLastProbeAt()).not.toBeNull();

    // Now simulate horizon expanded and upgradeClaimToFull succeeds
    h.setCustomSets([
      {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-25T00:00:00Z'),
        horizonDate: '2027-10-25',
        lastError: null,
      },
    ]);

    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      return {
        body: { maxPricingCalendarDate: '2027-10-26', pricingCalendar: [] },
        bytes: 500,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    // Advance clock past the 4-hour probe cooldown
    h.advanceClock(5 * 3600_000);

    const resUpgrade = await h.service.run('probe_only');
    expect(resUpgrade.status).toBe('done');
    // After upgradeClaimToFull succeeded, lastAttemptAt was set!
    expect(h.getLastAttemptAt()).not.toBeNull();
  });

  // =========================================================================
  // A1: 401 retry, 404 std-gst, and reset on success
  // =========================================================================

  it('R3: probe 401 refetches token once, retries; second 401 recorded as http_status:401 and counted', async () => {
    const h = createTestHarness();
    let probeCallCount = 0;

    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      probeCallCount++;
      throw new TicketClientError('unauthorized', 'Unauthorized probe', 401);
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('failed');
    // Called token, probe, token refetch, probe retry
    expect(h.clientCalls).toEqual([
      { path: 'T' },
      { path: 'P', group: 'std-gst', numDays: 1 },
      { path: 'T' },
      { path: 'P', group: 'std-gst', numDays: 1 },
    ]);
    expect(probeCallCount).toBe(2);
    expect(h.getLastError()).toBe('http_status:401');
  });

  it('R3: 404 on std-gst recorded as http_status:404 and counted toward consecutive failures', async () => {
    const h = createTestHarness();
    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      if (h.clientCalls.filter((c) => c.path === 'P').length === 1) {
        // Probe call succeeds
        return {
          body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }
      // Set call 404
      throw new TicketClientError('not_found', 'Not found', 404);
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('blocked'); // 2 consecutive failures reaches limit (2) and blocks
    expect(h.setErrors.get('std-gst|1')).toBe('http_status:404');
    expect(h.getBlockedUntil()).not.toBeNull();
  });

  it('R3: success between two failures resets the consecutive failure count', async () => {
    const h = createTestHarness({ maxConsecutiveFailures: 2 });
    let priceCount = 0;

    h.client.getPrices = async (p) => {
      priceCount++;
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      if (priceCount === 1) {
        // Probe succeeds
        return {
          body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }
      if (priceCount === 2) {
        // Set 1 fails (consecutive = 1)
        throw new TicketClientError('network', 'Network glitch');
      }
      if (priceCount === 3) {
        // Set 2 succeeds (resets consecutive to 0!)
        return {
          body: {
            maxPricingCalendarDate: '2027-10-25',
            pricingCalendar: [
              {
                numDays: String(p.numDays),
                dates: [
                  {
                    date: p.startDate,
                    validityEndDate: p.endDate,
                    pricing: [
                      {
                        id: `theme-park_${p.numDays}_A_0_0_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                        subtotal: '100.00',
                        tax: '6.50',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }
      if (priceCount === 4) {
        // Set 3 fails (consecutive = 1, NOT 2)
        throw new TicketClientError('network', 'Network glitch');
      }
      // Set 4+ succeed
      return {
        body: {
          maxPricingCalendarDate: '2027-10-25',
          pricingCalendar: [
            {
              numDays: String(p.numDays),
              dates: [
                {
                  date: p.startDate,
                  validityEndDate: p.endDate,
                  pricing: [
                    {
                      id: `theme-park_${p.numDays}_A_0_0_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                      subtotal: '100.00',
                      tax: '6.50',
                    },
                  ],
                },
              ],
            },
          ],
        },
        bytes: 100,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    // Result is done, NOT blocked, because success reset the counter!
    expect(res.status).toBe('done');
    expect(h.getBlockedUntil()).toBeNull();
  });

  it('R3 / Property 37: call counts never exceed 2 + sets + 1 token retry + 1 start-date retry', async () => {
    const h = createTestHarness();
    await h.service.run('full');

    const setsCount = 12; // 10 std-gst + 2 fl-resident
    const maxBound = 2 + setsCount + 1 + 1;
    expect(h.clientCalls.length).toBeLessThanOrEqual(maxBound);
  });

  // =========================================================================
  // A6 / N4 / Property 35: Request spacing on a fake clock
  // =========================================================================

  it('A6 / N4 / Property 35: enforces request spacing between token call, probe call, and around 401 refetch on a fake clock', async () => {
    const spacingMs = 1500;
    const h = createTestHarness({ requestSpacingMs: spacingMs });
    let probeCalls = 0;

    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      probeCalls++;
      if (probeCalls === 1) {
        // First probe call fails with 401 to trigger refetch
        throw new TicketClientError('unauthorized', 'Unauthorized', 401);
      }
      return {
        body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
        bytes: 100,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const start = h.now();
    await h.service.run('probe_only');

    // Spacing occurred:
    // 1. After initial token call before probe
    // 2. Around 401 refetch (before token refetch)
    // 3. Around 401 refetch (before probe retry)
    expect(h.sleepCalls.length).toBeGreaterThanOrEqual(3);
    for (const ms of h.sleepCalls) {
      expect(ms).toBe(spacingMs);
    }
    expect(h.now().getTime() - start.getTime()).toBeGreaterThanOrEqual(3 * spacingMs);
  });

  it('P4 / N-c / A6b / A6c: full run with 2 sets and set-loop 401 refetch enforces request spacing before sets and around token refetch', async () => {
    const spacingMs = 1500;
    const h = createTestHarness({
      groups: ['std-gst'],
      requestSpacingMs: spacingMs,
    });

    // Seed sets: std-gst 1 and 2 needed (asOf: null); 3..10 marked not_offered so only 2 sets are pulled
    const customSets = [
      { discountGroup: 'std-gst', numDays: 1, asOf: null, horizonDate: null, lastError: null },
      { discountGroup: 'std-gst', numDays: 2, asOf: null, horizonDate: null, lastError: null },
      ...[3, 4, 5, 6, 7, 8, 9, 10].map((d) => ({
        discountGroup: 'std-gst',
        numDays: d,
        asOf: null,
        horizonDate: null,
        lastError: 'not_offered',
      })),
    ];
    h.setCustomSets(customSets);

    let set2CallCount = 0;
    h.client.getPrices = async (p) => {
      h.clientCalls.push({
        path: 'P',
        group: p.discountGroup,
        numDays: p.numDays,
        start: p.startDate,
        end: p.endDate,
      });
      h.timeline.push(`P:${p.discountGroup}:${p.numDays}`);

      // Probe call (startDate === endDate)
      if (p.startDate === p.endDate) {
        return {
          body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }

      // Inside set loop: std-gst 2 fails once with 401
      if (p.numDays === 2) {
        set2CallCount++;
        if (set2CallCount === 1) {
          throw new TicketClientError('unauthorized', 'Set pull unauthorized', 401);
        }
      }

      // Successful pricing response
      return {
        body: {
          maxPricingCalendarDate: '2027-10-25',
          pricingCalendar: [
            {
              numDays: String(p.numDays),
              dates: [
                {
                  date: p.startDate,
                  validityEndDate: p.endDate,
                  pricing: [
                    {
                      id: `theme-park_${p.numDays}_A_0_0_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                      ageGroup: 'adult',
                      pricePerDay: '100.00',
                      subtotal: `${p.numDays * 100}.00`,
                      tax: '6.50',
                      stopSale: false,
                      availability: true,
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
        bytes: 1200,
        ms: 100,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('done');

    // Recorded sleeps:
    // 1. After initial token call before probe (1500)
    // 2. Before set 1 call (1500)
    // 3. Before set 2 call (1500)
    // 4. Before token refetch on 401 (1500)
    // 5. Before set 2 retry (1500)
    expect(h.sleepCalls).toEqual([1500, 1500, 1500, 1500, 1500]);
    expect(h.timeline).toEqual([
      'T',
      'sleep:1500',
      'P:std-gst:1',
      'sleep:1500',
      'P:std-gst:1',
      'sleep:1500',
      'P:std-gst:2',
      'sleep:1500',
      'T',
      'sleep:1500',
      'P:std-gst:2',
    ]);
  });

  // =========================================================================
  // A1: Admin diagnose with enabled = false through admin port
  // =========================================================================

  it('R3 / round 4 M1: admin.diagnose() with enabled = false makes the two client calls and returns AdminDiagnoseResult', async () => {
    const h = createTestHarness({ enabled: false });
    const admin = h.service.getAdminPort();

    const res = await admin.diagnose();
    expect('refused' in res).toBe(false);
    if (!('refused' in res)) {
      expect(res.prices.status).toBe(200);
      expect(res.token.status).toBe(200);
      expect(res.adultMk1DayPriceCents).toBe(10000);
    }
    expect(h.clientCalls).toHaveLength(2);
    expect(h.clientCalls[0]?.path).toBe('T');
    expect(h.clientCalls[1]?.path).toBe('P');
  });

  // =========================================================================
  // Baseline behavior tests
  // =========================================================================

  it('runs full refresh successfully, fetches sets, obeys probe std-gst rule', async () => {
    const h = createTestHarness({ groups: ['fl-resident', 'std-gst'] });
    const res = await h.service.run('full');

    expect(res.status).toBe('done');
    expect(h.clientCalls[0]?.path).toBe('T');
    expect(h.clientCalls[1]?.group).toBe('std-gst');
  });

  it('circuit breaker: WAF stops all further calls and sets blocked_until', async () => {
    const h = createTestHarness();
    let callIdx = 0;
    h.client.getPrices = async (p) => {
      callIdx++;
      h.clientCalls.push({ path: 'P', numDays: p.numDays });
      if (callIdx === 2) {
        throw new TicketClientError('waf_block', 'WAF Block', 403);
      }
      return {
        body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
        bytes: 100,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('blocked');
    expect(h.getBlockedUntil()).not.toBeNull();
    expect(callIdx).toBe(2);
  });

  it('circuit breaker: consecutive failures reach limit (2) and set failure cooldown', async () => {
    const h = createTestHarness({ maxConsecutiveFailures: 2 });
    let callIdx = 0;
    h.client.getPrices = async (p) => {
      callIdx++;
      h.clientCalls.push({ path: 'P', numDays: p.numDays });
      if (callIdx === 1) {
        return {
          body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
          bytes: 100,
          ms: 50,
          status: 200,
          startDateSent: p.startDate,
        };
      }
      throw new TicketClientError('network', 'Network error');
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('blocked');
    expect(h.getBlockedUntil()).not.toBeNull();
    expect(callIdx).toBe(3);
  });

  it('not_found on fl-resident records not_offered and does NOT increment consecutive failures', async () => {
    const h = createTestHarness();
    h.client.getPrices = async (p) => {
      h.clientCalls.push({ path: 'P', group: p.discountGroup, numDays: p.numDays });
      if (p.discountGroup === 'fl-resident') {
        throw new TicketClientError('not_found', 'Not found', 404);
      }
      return {
        body: {
          maxPricingCalendarDate: '2027-10-25',
          pricingCalendar: [
            {
              numDays: String(p.numDays),
              dates: [
                {
                  date: p.startDate,
                  validityEndDate: p.endDate,
                  pricing: [
                    {
                      id: `theme-park_${p.numDays}_A_0_0_RF_AF_SOF_progenstr${p.numDays === 1 ? '_mk' : ''}`,
                      ageGroup: 'adult',
                      pricePerDay: '100.00',
                      subtotal: '100.00',
                      tax: '6.50',
                      stopSale: false,
                      availability: true,
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
        bytes: 1200,
        ms: 100,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('done');
    expect(h.setErrors.get('fl-resident|3')).toBe('not_offered');
    expect(h.getBlockedUntil()).toBeNull();
  });

  it('start_date_rejected keeps claim-time last_attempt_at and sets failure cooldown', async () => {
    const h = createTestHarness();
    h.client.getPrices = async () => {
      throw new TicketClientError('start_date_rejected', 'Rejected', 400);
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('blocked');
    expect(h.getBlockedUntil()).not.toBeNull();
    expect(h.getLastAttemptAt()).not.toBeNull();
  });

  it('kill switch off makes zero client calls', async () => {
    const h = createTestHarness({ enabled: false });
    const res = await h.service.run('full');
    expect(res.status).toBe('disabled');
    expect(h.clientCalls).toHaveLength(0);
  });

  it('round 5 L4: block now while run is in flight stops before next call', async () => {
    const h = createTestHarness();
    let priceCallCount = 0;

    h.client.getPrices = async (p) => {
      priceCallCount++;
      h.clientCalls.push({ path: 'P', numDays: p.numDays });
      if (priceCallCount === 2) {
        await h.repo.block(new Date(h.now().getTime() + 3600_000), 'manual');
      }
      return {
        body: { maxPricingCalendarDate: '2027-10-25', pricingCalendar: [] },
        bytes: 100,
        ms: 50,
        status: 200,
        startDateSent: p.startDate,
      };
    };

    const res = await h.service.run('full');
    expect(res.status).toBe('blocked');
    expect(priceCallCount).toBe(2);
  });

  it('admin runNow bypasses attempt cooldown but respects blocked and in_flight', async () => {
    const h = createTestHarness();
    const admin = h.service.getAdminPort();

    const r1 = await admin.runNow();
    expect(r1.outcome).toBe('started');

    await h.repo.block(new Date(h.now().getTime() + 3600_000), 'manual');
    const rBlocked = await admin.runNow();
    expect(rBlocked.outcome).toBe('blocked');
  });
});
