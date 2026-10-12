/**
 * Pure calculation for Trip Net_Balances and Pairwise Balances.
 *
 * Validates: Requirements 2.7, 6.1, 6.2, 6.3, 6.5, 6.6
 */

/** One ledger contribution to a Trip_Member's running balance. */
export interface BalanceEvent {
  readonly kind: 'expense_payer' | 'expense_share' | 'settlement_paid' | 'settlement_received';
  readonly memberId: string; // already resolved past Trip_Guest sponsorship (Req 2.7)
  readonly amountCents: number; // always positive; sign is implied by `kind`
  readonly counterpartyId: string | null; // the other party, for the pairwise view / drill-down
  readonly sourceId: string; // Expense or Settlement id, for the drill-down (Req 6.4)
  readonly description: string;
  readonly date: string; // YYYY-MM-DD
  readonly payerId?: string | undefined;
  readonly recipientId?: string | undefined;
}


/**
 * Reduce a Trip's full event stream into each Trip_Member's Net_Balance
 * (Req 6.1, 6.2) — `expense_payer` and `settlement_received` are positive
 * contributions, `expense_share` and `settlement_paid` are negative. Every
 * Trip_Member who appears in at least one event is present in the result,
 * reporting exactly `0` for a Member with perfectly offsetting activity or
 * (by the caller including every Trip_Member id, not just those with
 * activity) a Member with none at all (Req 6.3).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.6.
 */
export function computeNetBalances(
  events: readonly BalanceEvent[],
  allMemberIds: readonly string[],
): ReadonlyMap<string, number> {
  const balances = new Map<string, number>();

  for (const id of allMemberIds) {
    balances.set(id, 0);
  }

  for (const event of events) {
    const cur = balances.get(event.memberId) ?? 0;
    if (event.kind === 'expense_payer' || event.kind === 'settlement_received') {
      balances.set(event.memberId, cur + event.amountCents);
    } else if (event.kind === 'expense_share' || event.kind === 'settlement_paid') {
      balances.set(event.memberId, cur - event.amountCents);
    }
  }

  return balances;
}

/**
 * Derive the simplified pairwise amount for every pair of Trip_Members with a
 * nonzero mutual balance (Req 6.5): for each pair, net every `expense_share`
 * contribution where one is the counterparty of the other's `expense_payer`
 * event (and vice versa) plus every Settlement between them, into one signed
 * amount describing what A owes B (or B owes A) if they settled directly.
 * Omits a pair whose net is exactly zero.
 *
 * Validates: Requirement 6.5.
 */
export function computePairwiseBalances(
  events: readonly BalanceEvent[],
): readonly { memberIdA: string; memberIdB: string; aOwesB: number }[] {
  // Map of canonical pair `${A}:${B}` (where A < B) to what A owes B
  const pairBalances = new Map<string, { memberIdA: string; memberIdB: string; aOwesB: number }>();
  const seenEventKeys = new Set<string>();

  for (const event of events) {
    if (!event.counterpartyId || event.memberId === event.counterpartyId) {
      continue;
    }

    const memberIdA = event.memberId < event.counterpartyId ? event.memberId : event.counterpartyId;
    const memberIdB = event.memberId < event.counterpartyId ? event.counterpartyId : event.memberId;
    const pairKey = `${memberIdA}:${memberIdB}`;

    // Dedup mirror events (e.g. payer and share events for the same sourceId)
    const dedupKey = `${pairKey}:${event.sourceId}`;
    if (seenEventKeys.has(dedupKey)) {
      continue;
    }
    seenEventKeys.add(dedupKey);

    // Compute change to what memberId owes counterpartyId
    let memberOwesCounterparty = 0;
    if (event.kind === 'expense_share') {
      memberOwesCounterparty = event.amountCents;
    } else if (event.kind === 'expense_payer') {
      memberOwesCounterparty = -event.amountCents;
    } else if (event.kind === 'settlement_paid') {
      memberOwesCounterparty = -event.amountCents;
    } else if (event.kind === 'settlement_received') {
      memberOwesCounterparty = event.amountCents;
    }

    // Translate to change in what A owes B
    const deltaAOwesB = event.memberId === memberIdA
      ? memberOwesCounterparty
      : -memberOwesCounterparty;

    const entry = pairBalances.get(pairKey) ?? { memberIdA, memberIdB, aOwesB: 0 };
    entry.aOwesB += deltaAOwesB;
    pairBalances.set(pairKey, entry);
  }

  const result: { memberIdA: string; memberIdB: string; aOwesB: number }[] = [];
  for (const entry of pairBalances.values()) {
    if (entry.aOwesB !== 0) {
      result.push(entry);
    }
  }

  result.sort((a, b) => {
    const cmpA = a.memberIdA.localeCompare(b.memberIdA);
    if (cmpA !== 0) return cmpA;
    return a.memberIdB.localeCompare(b.memberIdB);
  });

  return result;
}
