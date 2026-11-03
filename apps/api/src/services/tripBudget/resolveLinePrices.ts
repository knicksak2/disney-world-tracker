/**
 * Pure price resolution for Trip Budget lines (Requirement 5).
 *
 * Resolves live/cached prices for tickets and Lightning Lane,
 * respects user_entered and disney_menu frozen snapshots,
 * and falls back to stored snapshots with aged labels on cache misses.
 *
 * Validates: Requirements 5.2, 5.4, 5.5, 5.6, 5.9, 5.10
 */

import {
  TICKET_PARK_BY_CANONICAL_PARK,
  type PriceLabelKind,
  type TicketPriceRef,
  type LlPriceRef,
} from '@dwt/shared';
import { dateToInstant } from '../ticketPrices/dates.js';
import { ticketAgeClass, worseLabel } from '../ticketPrices/freshness.js';
import { resolveTicketPrice, type TicketBook } from '../ticketPrices/resolveTicketPrice.js';
import { lookupLlPrice } from '../lightningLane/lookupLlPrice.js';
import type { LlBook, ResolveCfg } from '../lightningLane/types.js';
import type { EffectiveAllocation, ResolvedLine, StoredLine } from './types.js';

export interface ResolveLinePricesInput {
  lines: readonly StoredLine[];
  ticketBook: TicketBook;
  llBook: LlBook;
  today: string; // YYYY-MM-DD
  now: Date;
  cfg: ResolveCfg;
}

export function resolveLinePrices(i: ResolveLinePricesInput): ResolvedLine[] {
  const { lines, ticketBook, llBook, today, now, cfg } = i;

  return lines.map((line) => {
    // 1. Frozen snapshot: user_entered
    if (line.priceSource === 'user_entered') {
      const allocations: EffectiveAllocation[] = line.allocations.map((a) => ({
        allocationId: a.id,
        personKey: a.personKey,
        storedCents: a.storedCents,
        effectiveCents: a.storedCents,
        labelKind: 'your_price',
        effectivePriceSource: 'user_entered',
        asOf: line.priceAsOf,
        priceRef: a.priceRef ?? line.priceRef ?? null,
      }));

      return {
        ...line,
        allocations,
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'your_price',
        asOf: line.priceAsOf,
        soldOut: false,
        attribution: null,
      };
    }

    // 2. Frozen snapshot: disney_menu
    if (line.priceSource === 'disney_menu') {
      const menuLabel = ticketAgeClass(line.priceAsOf, today, {
        freshDays: cfg.freshDays,
        estimateAfterDays: cfg.estimateAfterDays,
      });

      const allocations: EffectiveAllocation[] = line.allocations.map((a) => ({
        allocationId: a.id,
        personKey: a.personKey,
        storedCents: a.storedCents,
        effectiveCents: a.storedCents,
        labelKind: menuLabel,
        effectivePriceSource: 'disney_menu',
        asOf: line.priceAsOf,
        priceRef: a.priceRef ?? line.priceRef ?? null,
      }));

      return {
        ...line,
        allocations,
        effectivePriceSource: 'disney_menu',
        priceLabelKind: menuLabel,
        asOf: line.priceAsOf,
        soldOut: false,
        attribution: 'disney',
      };
    }

    // Check if line is typical_estimate without an LL priceRef (stays frozen snapshot)
    const hasAnyLlRef =
      (line.priceRef && line.priceRef.kind === 'll') ||
      line.allocations.some((a) => a.priceRef && a.priceRef.kind === 'll');

    if (line.priceSource === 'typical_estimate' && !hasAnyLlRef) {
      const allocations: EffectiveAllocation[] = line.allocations.map((a) => ({
        allocationId: a.id,
        personKey: a.personKey,
        storedCents: a.storedCents,
        effectiveCents: a.storedCents,
        labelKind: 'estimate',
        effectivePriceSource: 'typical_estimate',
        asOf: line.priceAsOf,
        priceRef: a.priceRef ?? line.priceRef ?? null,
      }));

      return {
        ...line,
        allocations,
        effectivePriceSource: 'typical_estimate',
        priceLabelKind: 'estimate',
        asOf: line.priceAsOf,
        soldOut: false,
        attribution: 'themeparks_wiki',
      };
    }

    // 3. Sourced lines: disney_ticket_calendar or themeparks_ll (or typical_estimate with LL ref)
    const isTicket = line.priceSource === 'disney_ticket_calendar';

    const allocations: EffectiveAllocation[] = line.allocations.map((alloc) => {
      if (isTicket) {
        // Resolve ticket allocation
        let ref: TicketPriceRef | null = null;
        if (alloc.priceRef && alloc.priceRef.kind === 'ticket') {
          ref = alloc.priceRef;
        } else if (line.priceRef && line.priceRef.kind === 'ticket') {
          ref = line.priceRef;
        }

        if (ref) {
          // If 1-day base ticket has no park on ref, map from canonical line park
          if (ref.optionCode === 'base' && ref.numDays === 1 && !ref.park && line.park) {
            const mappedPark =
              TICKET_PARK_BY_CANONICAL_PARK[line.park as keyof typeof TICKET_PARK_BY_CANONICAL_PARK];
            if (mappedPark) {
              ref = { ...ref, park: mappedPark };
            }
          }

          const pairPermitted = (cfg.allowedNumDaysByGroup[ref.discountGroup] ?? []).includes(
            ref.numDays,
          );

          const resolution = resolveTicketPrice(ref, ticketBook, today, cfg, pairPermitted);

          if (resolution.priceCents !== null) {
            return {
              allocationId: alloc.id,
              personKey: alloc.personKey,
              storedCents: alloc.storedCents,
              effectiveCents: resolution.priceCents,
              labelKind: resolution.labelKind,
              effectivePriceSource: 'disney_ticket_calendar',
              asOf: resolution.asOf ?? line.priceAsOf,
              estimateReason: resolution.estimateReason,
              soldOut: false,
              priceRef: ref,
            };
          }
        }

        // Ticket fallback to stored snapshot
        const rawAge = ticketAgeClass(line.priceAsOf, today, {
          freshDays: cfg.freshDays,
          estimateAfterDays: cfg.estimateAfterDays,
        });
        const fallbackLabel: PriceLabelKind = rawAge === 'current' ? 'may_have_changed' : rawAge;

        return {
          allocationId: alloc.id,
          personKey: alloc.personKey,
          storedCents: alloc.storedCents,
          effectiveCents: alloc.storedCents,
          labelKind: fallbackLabel,
          effectivePriceSource: 'disney_ticket_calendar',
          asOf: line.priceAsOf,
          soldOut: false,
          priceRef: ref,
        };
      } else {
        // Resolve Lightning Lane allocation
        let ref: LlPriceRef | null = null;
        if (alloc.priceRef && alloc.priceRef.kind === 'll') {
          ref = alloc.priceRef;
        } else if (line.priceRef && line.priceRef.kind === 'll') {
          ref = line.priceRef;
        }

        if (ref) {
          const historyKey = `${ref.passType}|${ref.park}|${ref.experienceId ?? ''}`;
          const history = llBook.history.get(historyKey) ?? [];

          const quote = lookupLlPrice(ref, llBook.stored, history, today, now, {
            staleHours: cfg.llStaleHours,
            lookbackDays: cfg.lookbackDays,
            minSamples: cfg.minSamples,
          });

          if (quote.priceCents !== null) {
            let quoteAsOf: Date = line.priceAsOf;
            if (quote.asOf) {
              quoteAsOf = quote.asOf.includes('T') ? new Date(quote.asOf) : dateToInstant(quote.asOf);
            }

            return {
              allocationId: alloc.id,
              personKey: alloc.personKey,
              storedCents: alloc.storedCents,
              effectiveCents: quote.priceCents,
              labelKind: quote.priceLabelKind,
              effectivePriceSource: quote.effectivePriceSource,
              asOf: quoteAsOf,
              estimateReason: quote.estimateReason,
              soldOut: quote.soldOut ?? false,
              priceRef: ref,
            };
          }
        }

        // Lightning Lane fallback to stored snapshot
        const rawAge = ticketAgeClass(line.priceAsOf, today, {
          freshDays: cfg.freshDays,
          estimateAfterDays: cfg.estimateAfterDays,
        });
        const fallbackLabel: PriceLabelKind = rawAge === 'current' ? 'may_have_changed' : rawAge;

        return {
          allocationId: alloc.id,
          personKey: alloc.personKey,
          storedCents: alloc.storedCents,
          effectiveCents: alloc.storedCents,
          labelKind: fallbackLabel,
          effectivePriceSource: 'themeparks_ll',
          asOf: line.priceAsOf,
          soldOut: false,
          priceRef: ref,
        };
      }
    });

    // Compute line roll-ups
    const worstLabel = allocations.reduce<PriceLabelKind>(
      (worst, a) => worseLabel(worst, a.labelKind),
      allocations[0]?.labelKind ?? 'current',
    );

    const hasEstimateSource = allocations.some((a) => a.effectivePriceSource === 'typical_estimate');
    const effectivePriceSource = hasEstimateSource
      ? 'typical_estimate'
      : isTicket
        ? 'disney_ticket_calendar'
        : 'themeparks_ll';

    const oldestAsOf = new Date(Math.min(...allocations.map((a) => a.asOf.getTime())));
    const isSoldOut = allocations.some((a) => Boolean(a.soldOut));
    const attribution = isTicket ? 'disney' : 'themeparks_wiki';

    return {
      ...line,
      allocations,
      effectivePriceSource,
      priceLabelKind: worstLabel,
      asOf: oldestAsOf,
      soldOut: isSoldOut,
      attribution,
    };
  });
}

