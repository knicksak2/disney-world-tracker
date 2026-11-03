/**
 * Background refresh orchestration and Admin port implementation for Disney ticket prices.
 *
 * Implements single-flight runs, circuit breaker, demand-driven scheduling, and admin operations.
 *
 * Validates: Requirements 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.3, 13.4,
 * 13.5, 13.6, 13.7, 13.9, 13.11, 13.12, 19.2, 19.3, 19.8
 */

import type { Pool } from 'pg';
import { wdwToday } from '../trips/wdwClock.js';
import type { AdminTicketPricesPort, AdminTicketPricesState } from './adminPort.js';
import { daysBetween } from './dates.js';
import { runDiagnose, type DiagnoseOutcome } from './diagnose.js';
import { parsePricesResponse } from './parsePricesResponse.js';
import { decideRefresh } from './refreshPlanner.js';
import type { StorableTicketPriceRow, TicketPricesRepo } from './repo.js';
import { acceptPricesSet } from './setAcceptance.js';
import { TicketClientError, type TicketPriceClient } from './ticketPriceClient.js';

export interface TicketPricesServiceConfig {
  readonly enabled: boolean;
  readonly baseUrl?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly groups: readonly string[];
  readonly flResidentNumDays: readonly number[];
  readonly staleAfterDays: number;
  readonly minAttemptIntervalHours: number;
  readonly probeMinIntervalHours: number;
  readonly blockCooldownMinutes: number;
  readonly failureCooldownMinutes: number;
  readonly diagnoseMinIntervalSeconds: number;
  readonly requestSpacingMs: number;
  readonly requestTimeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxConsecutiveFailures: number;
  readonly sanityMinRatio: number;
  readonly maxUnrecognizedFraction: number;
  readonly freshDays: number;
  readonly estimateAfterDays: number;
}

export interface TicketPricesService {
  readonly admin: AdminTicketPricesPort;
  noteDemand(demand: {
    readonly groups: readonly string[];
    readonly numDays: readonly number[];
    readonly maxStartDate: string | null;
  }): void;
  run(
    mode: 'full' | 'probe_only' | 'admin_full',
    neededNumDays?: readonly number[],
  ): Promise<{ readonly status: string }>;
  getAdminPort(): AdminTicketPricesPort;
}

export interface TicketPricesServiceDeps {
  readonly pool: Pool;
  readonly repo: TicketPricesRepo;
  readonly client: TicketPriceClient;
  readonly config: TicketPricesServiceConfig;
  readonly todayFn?: () => string;
  readonly nowFn?: () => Date;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
  };
}

export function createTicketPricesService(deps: TicketPricesServiceDeps): TicketPricesService {
  const { pool, repo, client, config } = deps;
  const todayFn = deps.todayFn ?? (() => wdwToday());
  const nowFn = deps.nowFn ?? (() => new Date());
  const sleepFn = deps.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = deps.logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  const allowedNumDaysByGroup: Record<string, readonly number[]> = {
    'std-gst': config.groups.includes('std-gst') ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [],
    'fl-resident': config.groups.includes('fl-resident') ? config.flResidentNumDays : [],
  };

  async function executeRun(
    mode: 'full' | 'probe_only' | 'admin_full',
    neededNumDays?: readonly number[],
    options?: { readonly alreadyClaimed?: boolean },
  ): Promise<{ readonly status: string }> {
    if (!config.enabled && mode !== 'admin_full') {
      return { status: 'disabled' };
    }

    const now = nowFn();
    const today = todayFn();
    const isAdmin = mode === 'admin_full';
    const claimMode = isAdmin ? 'full' : mode;

    if (!options?.alreadyClaimed) {
      const intervalHours =
        claimMode === 'probe_only'
          ? config.probeMinIntervalHours
          : config.minAttemptIntervalHours;

      const claimed = await repo.claimControl(
        claimMode,
        isAdmin,
        15, // claimTimeoutMinutes
        intervalHours,
      );

      if (!claimed) {
        return { status: 'skipped' };
      }
    }

    let status = 'in_progress';
    let errorCode: string | null = null;
    let consecutiveFailures = 0;

    try {
      // 1. Get token
      let token: string;
      try {
        token = await client.getToken();
      } catch (err: unknown) {
        if (err instanceof TicketClientError && err.kind === 'waf_block') {
          const until = new Date(now.getTime() + config.blockCooldownMinutes * 60_000);
          await repo.block(until, 'waf_block');
          status = 'blocked';
          errorCode = 'waf_block';
          return { status };
        }
        status = 'failed';
        errorCode =
          err instanceof TicketClientError
            ? err.kind === 'http_status'
              ? `http_status:${err.status}`
              : err.kind
            : 'network';
        return { status };
      }

      // Spacing after token call before first price request
      if (config.requestSpacingMs > 0) {
        await sleepFn(config.requestSpacingMs);
      }

      // Check blocked_until before first price call
      const blocked1 = await repo.readBlockedUntil();
      if (blocked1 !== null && blocked1 > now) {
        status = 'blocked';
        errorCode = 'manual';
        return { status };
      }

      // 2. Horizon probe: ALWAYS std-gst numDays 1
      let probeHorizon: string;
      try {
        let probeRes: {
          readonly body: unknown;
          readonly startDateSent: string;
          readonly bytes: number;
          readonly ms: number;
          readonly status: number;
        };
        try {
          probeRes = await client.getPrices({
            token,
            discountGroup: 'std-gst',
            numDays: 1,
            startDate: today,
            endDate: today,
          });
        } catch (firstErr: unknown) {
          if (firstErr instanceof TicketClientError && firstErr.kind === 'unauthorized') {
            if (config.requestSpacingMs > 0) {
              await sleepFn(config.requestSpacingMs);
            }
            token = await client.getToken();
            if (config.requestSpacingMs > 0) {
              await sleepFn(config.requestSpacingMs);
            }
            probeRes = await client.getPrices({
              token,
              discountGroup: 'std-gst',
              numDays: 1,
              startDate: today,
              endDate: today,
            });
          } else {
            throw firstErr;
          }
        }
        const body =
          typeof probeRes.body === 'object' && probeRes.body !== null
            ? (probeRes.body as Record<string, unknown>)
            : null;
        probeHorizon =
          typeof body?.maxPricingCalendarDate === 'string'
            ? body.maxPricingCalendarDate
            : today;
        await repo.recordProbe(now, probeHorizon);
      } catch (err: unknown) {
        if (err instanceof TicketClientError) {
          if (err.kind === 'waf_block') {
            const until = new Date(now.getTime() + config.blockCooldownMinutes * 60_000);
            await repo.block(until, 'waf_block');
            status = 'blocked';
            errorCode = 'waf_block';
            return { status };
          }
          if (err.kind === 'start_date_rejected') {
            const until = new Date(now.getTime() + config.failureCooldownMinutes * 60_000);
            await repo.block(until, 'start_date_rejected');
            status = 'blocked';
            errorCode = 'start_date_rejected';
            return { status };
          }
          if (err.kind === 'unauthorized') {
            errorCode = 'http_status:401';
            consecutiveFailures++;
          } else if (err.kind === 'not_found') {
            // std-gst 404 is http_status:404
            errorCode = 'http_status:404';
            consecutiveFailures++;
          } else if (err.kind === 'http_status') {
            errorCode = `http_status:${err.status}`;
            consecutiveFailures++;
          } else {
            errorCode = err.kind;
            consecutiveFailures++;
          }
          if (consecutiveFailures >= config.maxConsecutiveFailures) {
            const until = new Date(now.getTime() + config.failureCooldownMinutes * 60_000);
            await repo.block(until, 'consecutive_failures');
            status = 'blocked';
            errorCode = 'consecutive_failures';
            return { status };
          }
        } else {
          errorCode = 'network';
        }
        status = 'failed';
        return { status };
      }

      // 3. Plan sets to fetch
      const book = await repo.readBook([], today);
      interface SetTarget {
        readonly discountGroup: string;
        readonly numDays: number;
      }
      const setsToFetch: SetTarget[] = [];

      for (const group of config.groups) {
        const allowed = allowedNumDaysByGroup[group] ?? [];
        for (const numDays of allowed) {
          const s = book.sets.find((set) => set.discountGroup === group && set.numDays === numDays);
          if (s?.lastError === 'not_offered') {
            continue;
          }
          // In probe_only mode, only fetch sets whose horizon actually expanded.
          // In full mode, fetch if missing, asOf is null, stale, or horizon moved.
          const isHorizonMoved = s?.horizonDate != null && s.horizonDate < probeHorizon;
          const shouldFetch =
            mode === 'probe_only'
              ? isHorizonMoved
              : !s ||
                s.asOf === null ||
                daysBetween(s.asOf.toISOString().split('T')[0]!, today) >= config.staleAfterDays ||
                isHorizonMoved;

          if (shouldFetch) {
            setsToFetch.push({ discountGroup: group, numDays });
          }
        }
      }

      // Sort needed numDays first if provided
      if (neededNumDays && neededNumDays.length > 0) {
        setsToFetch.sort((a, b) => {
          const aNeeded = neededNumDays.includes(a.numDays);
          const bNeeded = neededNumDays.includes(b.numDays);
          if (aNeeded && !bNeeded) return -1;
          if (!aNeeded && bNeeded) return 1;
          return a.numDays - b.numDays;
        });
      }

      // If probe_only mode:
      if (mode === 'probe_only') {
        if (setsToFetch.length === 0) {
          status = 'done';
          return { status };
        }
        // Upgrade claim to full
        const upgraded = await repo.upgradeClaimToFull(config.minAttemptIntervalHours);
        if (!upgraded) {
          status = 'horizon_changed';
          return { status };
        }
      }

      // 4. Fetch each set
      for (const target of setsToFetch) {
        if (config.requestSpacingMs > 0) {
          await sleepFn(config.requestSpacingMs);
        }

        // Check if blocked before every call after the first
        const currentBlock = await repo.readBlockedUntil();
        if (currentBlock !== null && currentBlock > nowFn()) {
          status = 'blocked';
          break;
        }

        try {
          let callRes: { body: unknown; startDateSent: string; bytes: number; ms: number; status: number };
          try {
            callRes = await client.getPrices({
              token,
              discountGroup: target.discountGroup,
              numDays: target.numDays,
              startDate: today,
              endDate: probeHorizon,
            });
          } catch (firstErr: unknown) {
            if (firstErr instanceof TicketClientError && firstErr.kind === 'unauthorized') {
              // Refetch token once and retry with request spacing
              try {
                if (config.requestSpacingMs > 0) {
                  await sleepFn(config.requestSpacingMs);
                }
                token = await client.getToken();
                if (config.requestSpacingMs > 0) {
                  await sleepFn(config.requestSpacingMs);
                }
                callRes = await client.getPrices({
                  token,
                  discountGroup: target.discountGroup,
                  numDays: target.numDays,
                  startDate: today,
                  endDate: probeHorizon,
                });
              } catch (secondErr: unknown) {
                if (secondErr instanceof TicketClientError && secondErr.kind === 'unauthorized') {
                  await repo.recordSetError(target.discountGroup, target.numDays, 'http_status:401');
                  consecutiveFailures++;
                  if (consecutiveFailures >= config.maxConsecutiveFailures) {
                    const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
                    await repo.block(until, 'consecutive_failures');
                    status = 'blocked';
                    break;
                  }
                  continue;
                }
                throw secondErr;
              }
            } else {
              throw firstErr;
            }
          }

          // Parse and accept
          let parsed;
          try {
            parsed = parsePricesResponse(callRes.body, {
              numDays: target.numDays,
              discountGroup: target.discountGroup,
            });
          } catch {
            await repo.recordSetError(target.discountGroup, target.numDays, 'invalid_response');
            consecutiveFailures++;
            if (consecutiveFailures >= config.maxConsecutiveFailures) {
              const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
              await repo.block(until, 'consecutive_failures');
              status = 'blocked';
              errorCode = 'consecutive_failures';
              break;
            }
            continue;
          }

          const windowDays = daysBetween(callRes.startDateSent, probeHorizon) + 1;
          const totalEntries =
            parsed.rows.length + parsed.skippedUnrecognized + parsed.skippedNotSellable;
          const prevSet = book.sets.find(
            (s) => s.discountGroup === target.discountGroup && s.numDays === target.numDays,
          );

          const previousMeta =
            prevSet &&
            typeof prevSet.rowCount === 'number' &&
            typeof prevSet.windowDays === 'number'
              ? {
                  rowCount: prevSet.rowCount,
                  windowDays: prevSet.windowDays,
                }
              : null;

          const verdict = acceptPricesSet(parsed, totalEntries, previousMeta, windowDays, {
            minRatio: config.sanityMinRatio,
            maxUnrecognizedFraction: config.maxUnrecognizedFraction,
          });

          if (!verdict.ok) {
            await repo.recordSetError(target.discountGroup, target.numDays, verdict.reason);
            continue;
          }

          // Upsert, reconcile, and update set
          const storableRows: StorableTicketPriceRow[] = parsed.rows.map((r) => ({
            discountGroup: r.discountGroup as 'std-gst' | 'fl-resident',
            numDays: r.numDays,
            ageGroup: r.ageGroup as 'child' | 'adult',
            optionCode: r.optionCode as StorableTicketPriceRow['optionCode'],
            park: r.park as StorableTicketPriceRow['park'],
            startDate: r.startDate,
            priceCents: r.priceCents,
            taxCents: r.taxCents,
            validEndDate: r.validEndDate ?? r.startDate,
            productId: r.productId ?? '',
          }));

          await repo.upsertRows(storableRows);
          await repo.reconcileSet(
            target.discountGroup,
            target.numDays,
            callRes.startDateSent,
            probeHorizon,
            parsed.rows,
          );
          await repo.updateSet(
            target.discountGroup,
            target.numDays,
            nowFn(),
            probeHorizon,
            parsed.rows.length,
            windowDays,
          );

          // Success resets consecutive failures
          consecutiveFailures = 0;
        } catch (setErr: unknown) {
          if (setErr instanceof TicketClientError) {
            if (setErr.kind === 'waf_block') {
              const until = new Date(nowFn().getTime() + config.blockCooldownMinutes * 60_000);
              await repo.block(until, 'waf_block');
              status = 'blocked';
              errorCode = 'waf_block';
              break;
            }
            if (setErr.kind === 'start_date_rejected') {
              await repo.recordSetError(target.discountGroup, target.numDays, 'start_date_rejected');
              const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
              await repo.block(until, 'start_date_rejected');
              status = 'blocked';
              errorCode = 'start_date_rejected';
              break;
            }
            if (setErr.kind === 'not_found') {
              if (target.discountGroup === 'fl-resident') {
                await repo.recordSetError(target.discountGroup, target.numDays, 'not_offered');
                continue;
              } else {
                await repo.recordSetError(target.discountGroup, target.numDays, 'http_status:404');
                consecutiveFailures++;
                if (consecutiveFailures >= config.maxConsecutiveFailures) {
                  const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
                  await repo.block(until, 'consecutive_failures');
                  status = 'blocked';
                  errorCode = 'consecutive_failures';
                  break;
                }
                continue;
              }
            }
            // network, timeout, 5xx, invalid_response
            const code = setErr.kind === 'http_status' ? `http_status:${setErr.status}` : setErr.kind;
            await repo.recordSetError(target.discountGroup, target.numDays, code);
            consecutiveFailures++;
            if (consecutiveFailures >= config.maxConsecutiveFailures) {
              const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
              await repo.block(until, 'consecutive_failures');
              status = 'blocked';
              errorCode = 'consecutive_failures';
              break;
            }
            continue;
          }
          // Generic failure
          consecutiveFailures++;
          if (consecutiveFailures >= config.maxConsecutiveFailures) {
            const until = new Date(nowFn().getTime() + config.failureCooldownMinutes * 60_000);
            await repo.block(until, 'consecutive_failures');
            status = 'blocked';
            errorCode = 'consecutive_failures';
            break;
          }
        }
      }

      // 5. Prune past rows
      await repo.pruneBeforeToday(today);
      if (status === 'in_progress') {
        status = 'done';
      }
      return { status };
    } finally {
      await repo.releaseControl(status, errorCode);
    }
  }

  // Admin port
  const adminPort: AdminTicketPricesPort = {
    async readState(): Promise<AdminTicketPricesState> {
      const today = todayFn();
      const book = await repo.readBook([], today);
      const ctrl = book.control;

      const totalRowsRes = await pool.query<{ count: string }>('SELECT count(*)::text as count FROM ticket_prices');
      const totalRows = parseInt(totalRowsRes.rows[0]?.count ?? '0', 10);

      const tableSizeRes = await pool.query<{ size: string }>(
        "SELECT pg_size_pretty(pg_total_relation_size('ticket_prices')) as size",
      );
      const tableSize = tableSizeRes.rows[0]?.size ?? '0 kB';

      // Adult 1-day MK price lookup
      const mk1DayRes = await pool.query<{ price_cents: number }>(
        `SELECT price_cents
           FROM ticket_prices
          WHERE discount_group = 'std-gst'
            AND num_days = 1
            AND age_group = 'adult'
            AND option_code = 'base'
            AND park = 'mk'
            AND start_date >= $1::date
          ORDER BY start_date ASC
          LIMIT 1`,
        [today],
      );
      const adultMk1DayPriceCents = mk1DayRes.rows[0]?.price_cents ?? null;

      const publicConfig: Record<string, string | number | boolean> = {
        enabled: config.enabled,
        groups: config.groups.join(','),
        flResidentNumDays: config.flResidentNumDays.join(','),
        staleAfterDays: config.staleAfterDays,
        minAttemptIntervalHours: config.minAttemptIntervalHours,
        probeMinIntervalHours: config.probeMinIntervalHours,
        blockCooldownMinutes: config.blockCooldownMinutes,
        failureCooldownMinutes: config.failureCooldownMinutes,
        diagnoseMinIntervalSeconds: config.diagnoseMinIntervalSeconds,
        requestSpacingMs: config.requestSpacingMs,
        requestTimeoutMs: config.requestTimeoutMs,
        maxBodyBytes: config.maxBodyBytes,
        maxConsecutiveFailures: config.maxConsecutiveFailures,
        sanityMinRatio: config.sanityMinRatio,
        maxUnrecognizedFraction: config.maxUnrecognizedFraction,
        freshDays: config.freshDays,
        estimateAfterDays: config.estimateAfterDays,
      };

      return {
        enabled: config.enabled,
        control: {
          lastAttemptAt: ctrl?.lastAttemptAt ? ctrl.lastAttemptAt.toISOString() : null,
          lastProbeAt: ctrl?.lastProbeAt ? ctrl.lastProbeAt.toISOString() : null,
          blockedUntil: ctrl?.blockedUntil ? ctrl.blockedUntil.toISOString() : null,
          inProgressSince: ctrl?.inProgressSince ? ctrl.inProgressSince.toISOString() : null,
          observedHorizonDate: ctrl?.observedHorizonDate ?? null,
          lastDiagnoseAt: ctrl?.lastDiagnoseAt ? ctrl.lastDiagnoseAt.toISOString() : null,
          lastStatus: ctrl?.lastStatus ?? null,
          lastError: ctrl?.lastError ?? null,
        },
        sets: book.sets.map((s) => ({
          discountGroup: s.discountGroup,
          numDays: s.numDays,
          asOf: s.asOf ? s.asOf.toISOString() : null,
          horizonDate: s.horizonDate,
          rowCount: s.rowCount ?? 0,
          windowDays: s.windowDays ?? null,
          lastError: s.lastError,
        })),
        totalRows,
        tableSize,
        config: publicConfig,
        adultMk1DayPriceCents,
      };
    },

    async runNow() {
      if (!config.enabled) {
        return { outcome: 'disabled' };
      }
      const blockedUntil = await repo.readBlockedUntil();
      if (blockedUntil !== null && blockedUntil > nowFn()) {
        return { outcome: 'blocked', blockedUntil: blockedUntil.toISOString() };
      }

      // Try claim
      const claimed = await repo.claimControl('full', true, 15, config.minAttemptIntervalHours);
      if (!claimed) {
        return { outcome: 'already_running' };
      }

      // Claim was acquired; run asynchronously with alreadyClaimed: true
      void executeRun('admin_full', undefined, { alreadyClaimed: true }).catch((err) => {
        logger.error('Admin refresh run failed: %s', err instanceof Error ? err.message : String(err));
      });

      return { outcome: 'started' };
    },

    async diagnose(): Promise<DiagnoseOutcome> {
      return runDiagnose(
        client,
        repo,
        todayFn(),
        nowFn,
        {
          claimTimeoutMinutes: 15,
          diagnoseMinIntervalSeconds: config.diagnoseMinIntervalSeconds,
          blockCooldownMinutes: config.blockCooldownMinutes,
          requestSpacingMs: config.requestSpacingMs,
        },
        sleepFn,
      );
    },

    async blockNow() {
      const until = new Date(nowFn().getTime() + config.blockCooldownMinutes * 60_000);
      await repo.block(until, 'manual');
      return { blockedUntil: until.toISOString() };
    },
  };

  return {
    noteDemand(demand) {
      if (!config.enabled) {
        return;
      }
      const today = todayFn();
      if (demand.maxStartDate && demand.maxStartDate < today) {
        return;
      }

      // Filter groups
      const permittedGroups = demand.groups.filter((g) => config.groups.includes(g));
      if (permittedGroups.length === 0) {
        return;
      }

      // Filter pairs against allowed numDays
      const hasPermittedPair = permittedGroups.some((g) => {
        const allowed = allowedNumDaysByGroup[g] ?? [];
        return demand.numDays.some((d) => allowed.includes(d));
      });
      if (!hasPermittedPair) {
        return;
      }

      // Asynchronously decide and run
      void (async () => {
        try {
          const now = nowFn();
          const book = await repo.readBook([], today);
          const decision = decideRefresh({
            enabled: config.enabled,
            now,
            today,
            control: book.control
              ? {
                  lastAttemptAt: book.control.lastAttemptAt,
                  lastProbeAt: book.control.lastProbeAt,
                  blockedUntil: book.control.blockedUntil,
                  inProgressSince: book.control.inProgressSince,
                  observedHorizonDate: book.control.observedHorizonDate,
                }
              : {
                  lastAttemptAt: null,
                  lastProbeAt: null,
                  blockedUntil: null,
                  inProgressSince: null,
                  observedHorizonDate: null,
                },
            sets: book.sets.map((s) => ({
              discountGroup: s.discountGroup,
              numDays: s.numDays,
              asOf: s.asOf,
              horizonDate: s.horizonDate,
              lastError: s.lastError,
            })),
            demand: {
              groups: permittedGroups,
              numDays: demand.numDays,
              maxStartDate: demand.maxStartDate,
            },
            allowedNumDaysByGroup,
            cfg: {
              staleAfterDays: config.staleAfterDays,
              attemptIntervalHours: config.minAttemptIntervalHours,
              probeIntervalHours: config.probeMinIntervalHours,
              claimTimeoutMinutes: 15,
            },
          });

          if (decision.action === 'full' || decision.action === 'probe_only') {
            await executeRun(decision.action, decision.neededNumDays);
          }
        } catch (err) {
          logger.error('Demand evaluation failed: %s', err instanceof Error ? err.message : String(err));
        }
      })();
    },

    async run(mode, neededNumDays) {
      return executeRun(mode, neededNumDays);
    },

    admin: adminPort,

    getAdminPort() {
      return adminPort;
    },
  };
}
