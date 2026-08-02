/**
 * Notification_Center pure attention model for `@dwt/shared`.
 *
 * This module is the single source of truth for the domain-agnostic types that
 * the Notification_Center's merge / order / badge / failure-handling core
 * operates over. It is deliberately **pure**: no React, no `fetch`, no timers,
 * and no dependency on any transport. The mobile hook layer adapts the four raw
 * per-domain DTOs into these types, and the pure functions (added in later
 * tasks) turn them into the exact Attention_Feed and Attention_Badge.
 *
 * Keeping these types here — dependency-free — lets the merge, ordering, badge,
 * and partial-failure logic be exhaustively property-tested and reused
 * identically by both the feed and the badge, so the two can never drift
 * (R4.5, R5.6).
 *
 * Validates: Requirements 1.2, 4.1, 8.1
 */

// ---------------------------------------------------------------------------
// Domain identity
// ---------------------------------------------------------------------------

/**
 * The four independent domains the Notification_Center aggregates. The union is
 * closed: every Attention_Item and every per-source outcome names exactly one
 * of these. The fixed sequence used for tie-break ordering and group-by-domain
 * ordering (Friend_Request, Trip_Invite, Rode_With_Tag, Share — R1.5, R1.8) is
 * defined by the ordering functions, not by this union's declaration order.
 */
export type AttentionDomain =
  | 'friendRequest'
  | 'tripInvite'
  | 'rodeWithTag'
  | 'share';

/**
 * The opaque per-domain identifiers an Attention_Item needs to invoke its
 * domain's existing per-item action endpoints and to open its underlying
 * destination. These carry only identifiers already present in the source
 * domain DTO, so inline actions and destination-open reuse the unchanged domain
 * endpoints (R2.2, R7.6).
 *
 * Every field is optional because the required set differs per domain: a
 * Friend_Request needs only its `requestId`; a Trip_Invite needs `inviteId` and
 * `tripId`; a Rode_With_Tag needs `tagId` and `tripLogEntryId`; a Share needs
 * `shareId` and, only when it references a Share_Destination, that destination's
 * identifiers (R2.3). The hook/model layers populate exactly the identifiers a
 * given domain's actions require.
 */
export interface AttentionItemRef {
  /** Friend_Request identifier (friend-request accept/decline). */
  readonly requestId?: string;
  /** Trip_Invite identifier (trip-invite accept/decline). */
  readonly inviteId?: string;
  /** Trip identifier a Trip_Invite refers to. */
  readonly tripId?: string;
  /** Rode_With_Tag identifier (rode-with confirm/decline). */
  readonly tagId?: string;
  /** Linked trip-log-entry identifier for a Rode_With_Tag. */
  readonly tripLogEntryId?: string;
  /** Share identifier (share mark-read). */
  readonly shareId?: string;
  /**
   * The Share_Destination this item points to, when the Share references one
   * (for example an Experience). Absent when the Share has no openable
   * destination (R2.3).
   */
  readonly destination?: AttentionDestination;
}

/**
 * The openable subject a Share points to (R2.3). `kind` names the destination
 * type and `id` is that entity's identifier; both are carried opaquely so the
 * presentation layer can reuse the Share_Inbox's destination-verify +
 * cross-navigate logic without the pure model knowing about any concrete
 * screen.
 */
export interface AttentionDestination {
  readonly kind: string;
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

/**
 * One normalized pending item in the Attention_Feed, produced from a single
 * domain DTO. Carries the domain type, the domain item identifier, the source
 * timestamp used as the primary sort key, a human-readable summary of at most
 * 140 characters that identifies the originating user and the referenced
 * subject, and the opaque {@link AttentionItemRef} needed to act on it
 * (R1.2, R1.3).
 */
export interface AttentionItem {
  /** Which domain this item came from. */
  readonly domain: AttentionDomain;
  /** Domain item identifier; the final ordering tie-break (R1.6). */
  readonly id: string;
  /** ISO-8601 source timestamp; the primary sort key (R1.4). */
  readonly sourceTimestamp: string;
  /** Human-readable summary, hard-truncated to ≤ 140 characters (R1.3). */
  readonly summary: string;
  /** Opaque identifiers used to invoke actions / open the destination. */
  readonly ref: AttentionItemRef;
}

// ---------------------------------------------------------------------------
// Per-source outcomes
// ---------------------------------------------------------------------------

/**
 * The read outcome for a single Domain_Source, fed into the model. A source
 * either succeeds with an arbitrary (possibly empty) set of pending items, or
 * fails — a rejection, a non-2xx response, or an exceeded Load_Deadline is all
 * normalized by the hook layer into the `failure` variant for that domain
 * (R8.1, R9.4). The feed and badge are then composed from the `success`
 * outcomes only.
 */
export type AttentionSourceOutcome =
  | {
      readonly domain: AttentionDomain;
      readonly status: 'success';
      readonly items: readonly AttentionItem[];
    }
  | {
      readonly domain: AttentionDomain;
      readonly status: 'failure';
    };

// ---------------------------------------------------------------------------
// Ordering and badge display modes
// ---------------------------------------------------------------------------

/**
 * How the Attention_Feed is ordered (R1.7). `timestampDesc` is the default —
 * most recent first, with domain-sequence and id tie-breaks (R1.4–R1.6).
 * `groupByDomain` groups items by domain in the fixed sequence, each group
 * sorted by source timestamp descending (R1.8).
 */
export type SortMode = 'timestampDesc' | 'groupByDomain';

/**
 * The display mode of the Attention_Badge, derived solely from the single total
 * attention count (R4.6): `hidden` when the count is 0 (R4.2), `count` when it
 * is 1–99 inclusive (R4.3), and `overflow` ("99+") when it is 100 or greater
 * (R4.4).
 */
export type BadgeDisplay = 'hidden' | 'count' | 'overflow';

// ---------------------------------------------------------------------------
// Aggregated state
// ---------------------------------------------------------------------------

/**
 * The complete, derived Notification_Center state produced from the four
 * per-source outcomes. `items` is the ordered Attention_Feed built from the
 * successful sources only; `badgeCount` is defined as `items.length` so the
 * badge and feed can never disagree (R4.5, R5.6, R8.4); `badgeDisplay` is
 * derived from that same count (R4.6); `failedDomains` names each domain whose
 * read failed (R8.1); and `allFailed` is `true` only when every source failed,
 * which drives the total-failure error state (R8.7).
 */
export interface AttentionState {
  /** The ordered Attention_Feed per the active {@link SortMode}. */
  readonly items: readonly AttentionItem[];
  /** Total attention count; equal to `items.length` (R4.1, R4.5). */
  readonly badgeCount: number;
  /** Badge display mode derived from `badgeCount` (R4.6). */
  readonly badgeDisplay: BadgeDisplay;
  /** The domain types whose reads failed (R8.1). */
  readonly failedDomains: readonly AttentionDomain[];
  /** `true` when every Domain_Source read failed (R8.7). */
  readonly allFailed: boolean;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * The fixed domain sequence the Attention_Feed orders by — Friend_Request,
 * then Trip_Invite, then Rode_With_Tag, then Share. It is the same-timestamp
 * tie-break in the default order (R1.5) and the group sequence in the
 * group-by-domain order (R1.8). Frozen so no caller can mutate the canonical
 * ordering at runtime.
 */
export const DOMAIN_ORDER: readonly AttentionDomain[] = Object.freeze([
  'friendRequest',
  'tripInvite',
  'rodeWithTag',
  'share',
] as const);

/**
 * Index of a domain within {@link DOMAIN_ORDER}. A domain outside the known
 * sequence sorts after all known domains, keeping the comparator total even for
 * unexpected input.
 */
function domainRank(domain: AttentionDomain): number {
  const index = DOMAIN_ORDER.indexOf(domain);
  return index === -1 ? DOMAIN_ORDER.length : index;
}

/**
 * Parse an ISO-8601 source timestamp to a millisecond value for descending
 * ordering. An unparseable timestamp yields `NaN`; {@link compareItems} treats
 * two `NaN` timestamps as tied and defers to the domain/id tie-breaks, so the
 * comparator stays total and deterministic regardless of timestamp validity.
 */
function timestampValue(item: AttentionItem): number {
  return Date.parse(item.sourceTimestamp);
}

/**
 * Total-order comparator for the default (`timestampDesc`) ordering (R1.4–R1.6):
 *
 * 1. source timestamp **descending** (most recent first),
 * 2. then domain type in the fixed {@link DOMAIN_ORDER} sequence,
 * 3. then domain item `id` in **ascending** lexicographic order.
 *
 * The comparator is a strict total order: it is antisymmetric and transitive,
 * and returns `0` only for items that share a timestamp, a domain, and an id.
 * That makes the sort result deterministic irrespective of the input order and
 * of the sort implementation's stability.
 */
export function compareItems(a: AttentionItem, b: AttentionItem): number {
  const ta = timestampValue(a);
  const tb = timestampValue(b);

  // Timestamp descending. Guard NaN (unparseable) as tied so we fall through
  // to the deterministic domain/id tie-breaks below.
  if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) {
    return tb - ta;
  }
  // A single valid timestamp always precedes an unparseable one.
  if (Number.isNaN(ta) !== Number.isNaN(tb)) {
    return Number.isNaN(ta) ? 1 : -1;
  }

  // Same (or equally unparseable) timestamp → domain sequence (R1.5).
  const domainDelta = domainRank(a.domain) - domainRank(b.domain);
  if (domainDelta !== 0) {
    return domainDelta;
  }

  // Same timestamp and domain → id ascending lexicographic (R1.6).
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Order an Attention_Feed for the given {@link SortMode} without mutating the
 * input. The input array is always copied first, so callers keep their original
 * ordering and the result is a fresh, deterministic permutation.
 *
 * - `timestampDesc` (default): a single total-order sort via
 *   {@link compareItems} — timestamp descending, then domain sequence, then id
 *   ascending (R1.4–R1.6).
 * - `groupByDomain`: items are grouped by domain in the fixed
 *   {@link DOMAIN_ORDER} sequence, and within each group are sorted by source
 *   timestamp descending (with the same id tie-break for determinism), so the
 *   groups appear in domain order and each group is most-recent-first (R1.8).
 */
export function orderItems(
  items: readonly AttentionItem[],
  sortMode: SortMode,
): AttentionItem[] {
  if (sortMode === 'groupByDomain') {
    // Sorting the full copy by compareItems already yields items grouped by the
    // DOMAIN_ORDER sequence, each group internally ordered by timestamp
    // descending then id ascending — exactly the group-by-domain contract.
    // Grouping explicitly keeps the intent clear and independent of the
    // comparator's cross-domain timestamp handling.
    const grouped: AttentionItem[] = [];
    for (const domain of DOMAIN_ORDER) {
      const group = items
        .filter((item) => item.domain === domain)
        .sort(compareItems);
      grouped.push(...group);
    }
    // Preserve any items whose domain is outside DOMAIN_ORDER, ordered after
    // the known groups, so no item is ever dropped.
    const known = new Set<AttentionDomain>(DOMAIN_ORDER);
    const rest = items.filter((item) => !known.has(item.domain)).sort(compareItems);
    grouped.push(...rest);
    return grouped;
  }

  // timestampDesc (default): copy then total-order sort.
  return [...items].sort(compareItems);
}

// ---------------------------------------------------------------------------
// Badge display derivation
// ---------------------------------------------------------------------------

/** The count boundary at and above which the badge shows the "99+" overflow. */
const BADGE_OVERFLOW_THRESHOLD = 100;

/**
 * Derive the Attention_Badge display mode from a total attention count.
 *
 * The mapping is the single source of truth for the badge's display rules and
 * is intentionally total over every integer count:
 *
 * - `0` (or any non-positive count) → `hidden`; the badge shows no indicator
 *   (R4.2).
 * - `1..99` inclusive → `count`; the badge shows the exact value (R4.3).
 * - `>= 100` → `overflow`; the badge shows "99+", including at exactly 100
 *   (R4.4).
 *
 * Because {@link AttentionState.badgeDisplay} is derived from the same
 * `badgeCount` used for the feed, the displayed indicator is always consistent
 * with that count (R4.6).
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.6
 */
export function badgeDisplayFor(count: number): BadgeDisplay {
  if (count <= 0) {
    return 'hidden';
  }
  if (count >= BADGE_OVERFLOW_THRESHOLD) {
    return 'overflow';
  }
  return 'count';
}

// ---------------------------------------------------------------------------
// Top-level state reducer
// ---------------------------------------------------------------------------

/**
 * Reduce the four per-source read outcomes into the complete, derived
 * {@link AttentionState} that drives both the Attention_Feed and the
 * Attention_Badge.
 *
 * The reducer:
 *
 * 1. Concatenates the pending items from **successful** sources only, so no
 *    item from a failed source is ever presented and the feed is exactly the
 *    merged domain truth of the sources that loaded (R1.2, R6.1, R6.3, R8.1).
 * 2. Orders the merged items via {@link orderItems} for the active
 *    {@link SortMode} (R1.4–R1.8).
 * 3. Sets `badgeCount = items.length`, so the badge count is *defined as* the
 *    feed size and the two can never drift; removing k items reduces the count
 *    by exactly k and it is never negative (R4.1, R4.5, R5.3, R5.6, R6.2,
 *    R8.4).
 * 4. Derives `badgeDisplay` from that same count via {@link badgeDisplayFor}
 *    (R4.6).
 * 5. Collects `failedDomains` as exactly the set of sources that failed (R8.1).
 * 6. Sets `allFailed` when every source failed, which drives the total-failure
 *    error state and a hidden badge (R8.7).
 *
 * The function is pure and dependency-free: it derives everything from its
 * inputs and neither reads nor mutates external state.
 *
 * Validates: Requirements 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.6, 6.1,
 * 6.2, 6.3, 8.1, 8.4, 8.7
 */
export function buildAttentionState(
  outcomes: readonly AttentionSourceOutcome[],
  sortMode: SortMode,
): AttentionState {
  const mergedItems: AttentionItem[] = [];
  const failedDomains: AttentionDomain[] = [];

  for (const outcome of outcomes) {
    if (outcome.status === 'success') {
      mergedItems.push(...outcome.items);
    } else {
      failedDomains.push(outcome.domain);
    }
  }

  const items = orderItems(mergedItems, sortMode);
  const badgeCount = items.length;

  return {
    items,
    badgeCount,
    badgeDisplay: badgeDisplayFor(badgeCount),
    failedDomains,
    // Total failure only when there is at least one source and every one failed.
    allFailed: outcomes.length > 0 && failedDomains.length === outcomes.length,
  };
}

// ---------------------------------------------------------------------------
// Retry: merge prior and retried per-source outcomes
// ---------------------------------------------------------------------------

/**
 * Merge a prior set of per-source outcomes with the outcomes produced by a
 * retry, keeping exactly the **latest** outcome for every Domain_Source.
 *
 * The Notification_Center's retry re-requests only the failed sources and then
 * recomputes state from every source's most recent outcome (R8.5, R8.6). This
 * helper expresses that "latest outcome per source" rule purely:
 *
 * - For each domain present in `retried`, its retried outcome supersedes any
 *   prior outcome for that domain — a retried success replaces a prior failure
 *   (and would replace a prior success too), and a still-failing source keeps a
 *   `failure` outcome.
 * - Every domain present only in `prior` (typically the sources that succeeded
 *   the first time and were therefore not re-requested) is carried through
 *   unchanged, so previously loaded successful items are preserved and merged.
 * - Within either array, a later entry for the same domain wins, so the result
 *   holds at most one outcome per domain.
 *
 * Ordering is deterministic: domains keep their first-seen position in `prior`,
 * and any domain seen only in `retried` is appended in its `retried` order. The
 * inputs are never mutated.
 *
 * The returned outcomes are the exact input {@link buildAttentionState} needs
 * to recompute the post-retry {@link AttentionState}; see
 * {@link recomputeAfterRetry}.
 */
export function mergeOutcomes(
  prior: readonly AttentionSourceOutcome[],
  retried: readonly AttentionSourceOutcome[],
): AttentionSourceOutcome[] {
  // Latest outcome per domain: retried entries override prior ones, and within
  // each array a later entry overrides an earlier one for the same domain.
  const latestByDomain = new Map<AttentionDomain, AttentionSourceOutcome>();
  // Preserve first-seen domain order: prior first, then retried-only domains.
  const order: AttentionDomain[] = [];

  const record = (outcome: AttentionSourceOutcome): void => {
    if (!latestByDomain.has(outcome.domain)) {
      order.push(outcome.domain);
    }
    latestByDomain.set(outcome.domain, outcome);
  };

  for (const outcome of prior) record(outcome);
  for (const outcome of retried) record(outcome);

  return order.map((domain) => latestByDomain.get(domain)!);
}

/**
 * Recompute the full {@link AttentionState} after a retry.
 *
 * Merges the `prior` per-source outcomes with the `retried` outcomes via
 * {@link mergeOutcomes} — taking the latest outcome for every Domain_Source —
 * and then derives the state with {@link buildAttentionState}. The result is,
 * by construction, exactly the state computed from every source's latest
 * outcome: retried successes replace their prior failures and merge with the
 * previously loaded successful items, while still-failed sources remain in
 * `failedDomains` (R8.5, R8.6).
 *
 * Pure and dependency-free: it neither reads nor mutates external state and is
 * a deterministic function of its inputs.
 *
 * Validates: Requirements 8.5, 8.6
 */
export function recomputeAfterRetry(
  prior: readonly AttentionSourceOutcome[],
  retried: readonly AttentionSourceOutcome[],
  sortMode: SortMode,
): AttentionState {
  return buildAttentionState(mergeOutcomes(prior, retried), sortMode);
}

// ---------------------------------------------------------------------------
// Normalization: domain DTO -> AttentionItem
// ---------------------------------------------------------------------------

import type { SharePayloadKind } from './enums.js';
import type { FriendRequestDTO, InboxItemDTO } from './dto/index.js';
import type { PendingRodeWithTagDTO, TripIncomingInviteDTO } from './trips.js';

/**
 * The maximum length, in UTF-16 code units, of an Attention_Item summary
 * (R1.3). Summaries are hard-truncated to this bound.
 */
export const SUMMARY_MAX_LENGTH = 140;

/**
 * The raw per-domain read DTO that normalizes into an {@link AttentionItem}.
 * The mapping mirrors the design's normalization table: a `friendRequest`
 * comes from a {@link FriendRequestDTO}, a `tripInvite` from a
 * {@link TripIncomingInviteDTO}, a `rodeWithTag` from a
 * {@link PendingRodeWithTagDTO}, and a `share` from an unread
 * {@link InboxItemDTO}. All four are `@dwt/shared` contracts, so the pure model
 * stays dependency-free.
 */
export type AttentionSourceDTO =
  | FriendRequestDTO
  | TripIncomingInviteDTO
  | PendingRodeWithTagDTO
  | InboxItemDTO;

/**
 * Hard-truncate `text` to at most {@link SUMMARY_MAX_LENGTH} UTF-16 code units
 * without splitting a surrogate pair (R1.3).
 *
 * JavaScript strings are UTF-16, so an astral-plane character (most emoji) is
 * stored as a two-unit surrogate pair. A naive `slice(0, 140)` can cut such a
 * pair in half and leave a lone, invalid high surrogate. This helper backs off
 * by one unit when the boundary would fall between a pair, so the result is
 * always well-formed and its `.length` is `<= SUMMARY_MAX_LENGTH` (and, since
 * code points never outnumber code units, its code-point count is `<= 140`
 * too). Combining/ZWJ grapheme clusters may still be split at the boundary, but
 * the output remains a valid string of bounded length.
 */
function hardTruncate(text: string): string {
  if (text.length <= SUMMARY_MAX_LENGTH) {
    return text;
  }
  let end = SUMMARY_MAX_LENGTH;
  const boundaryUnit = text.charCodeAt(end - 1);
  // 0xD800–0xDBFF is a high surrogate: the pair's second unit was cut off, so
  // drop the dangling high surrogate rather than emit an invalid character.
  if (boundaryUnit >= 0xd800 && boundaryUnit <= 0xdbff) {
    end -= 1;
  }
  return text.slice(0, end);
}

/** Human-readable label for the subject of a Share, keyed by its payload kind. */
function sharePayloadLabel(kind: SharePayloadKind): string {
  switch (kind) {
    case 'experience':
      return 'an experience';
    case 'progress':
      return 'their progress';
    default:
      return 'a share';
  }
}

/**
 * Build the human-readable Attention_Item summary for a domain DTO, identifying
 * the originating user and the referenced subject, hard-truncated to
 * {@link SUMMARY_MAX_LENGTH} characters (R1.3).
 *
 * Per-domain summary inputs follow the design's normalization table:
 * - `friendRequest` — the sender identity (`FriendRequestDTO` carries only
 *   `senderId`; a display name is not part of that shared contract).
 * - `tripInvite` — the inviter's display name and the trip name.
 * - `rodeWithTag` — the tagging member's display name and the Experience name.
 * - `share` — the sender's display name and a label for the Share payload.
 */
export function summarize(domain: 'friendRequest', dto: FriendRequestDTO): string;
export function summarize(domain: 'tripInvite', dto: TripIncomingInviteDTO): string;
export function summarize(domain: 'rodeWithTag', dto: PendingRodeWithTagDTO): string;
export function summarize(domain: 'share', dto: InboxItemDTO): string;
export function summarize(domain: AttentionDomain, dto: AttentionSourceDTO): string {
  let summary: string;
  switch (domain) {
    case 'friendRequest': {
      const d = dto as FriendRequestDTO;
      summary = `${d.senderId} sent you a friend request`;
      break;
    }
    case 'tripInvite': {
      const d = dto as TripIncomingInviteDTO;
      summary = `${d.inviterDisplayName} invited you to ${d.tripName}`;
      break;
    }
    case 'rodeWithTag': {
      const d = dto as PendingRodeWithTagDTO;
      summary = `${d.taggingMemberDisplayName} tagged you on ${d.experienceName}`;
      break;
    }
    case 'share': {
      const d = dto as InboxItemDTO;
      summary = `${d.senderDisplayName} shared ${sharePayloadLabel(d.payloadKind)}`;
      break;
    }
    default: {
      // Exhaustiveness guard: a new AttentionDomain must extend this switch.
      const _exhaustive: never = domain;
      summary = String(_exhaustive);
    }
  }
  return hardTruncate(summary);
}

/**
 * Normalize a domain DTO into an {@link AttentionItem} per the design's
 * normalization table: the item's `id`, `sourceTimestamp`, `summary`, and
 * action `ref` are each projected from the source DTO's fields. The `ref`
 * carries only identifiers already present in the DTO, so inline actions and
 * destination-open reuse the unchanged domain endpoints (R2.2, R7.6). The
 * `summary` is composed by {@link summarize} and hard-truncated to
 * {@link SUMMARY_MAX_LENGTH} (R1.2, R1.3).
 */
export function toAttentionItem(domain: 'friendRequest', dto: FriendRequestDTO): AttentionItem;
export function toAttentionItem(domain: 'tripInvite', dto: TripIncomingInviteDTO): AttentionItem;
export function toAttentionItem(domain: 'rodeWithTag', dto: PendingRodeWithTagDTO): AttentionItem;
export function toAttentionItem(domain: 'share', dto: InboxItemDTO): AttentionItem;
export function toAttentionItem(domain: AttentionDomain, dto: AttentionSourceDTO): AttentionItem {
  switch (domain) {
    case 'friendRequest': {
      const d = dto as FriendRequestDTO;
      return {
        domain,
        id: d.id,
        sourceTimestamp: d.createdAt,
        summary: summarize('friendRequest', d),
        ref: { requestId: d.id },
      };
    }
    case 'tripInvite': {
      const d = dto as TripIncomingInviteDTO;
      return {
        domain,
        id: d.inviteId,
        sourceTimestamp: d.createdAt,
        summary: summarize('tripInvite', d),
        ref: { inviteId: d.inviteId, tripId: d.tripId },
      };
    }
    case 'rodeWithTag': {
      const d = dto as PendingRodeWithTagDTO;
      return {
        domain,
        id: d.tagId,
        sourceTimestamp: d.createdAt,
        summary: summarize('rodeWithTag', d),
        ref: { tagId: d.tagId, tripLogEntryId: d.tripLogEntryId },
      };
    }
    case 'share': {
      const d = dto as InboxItemDTO;
      const ref: AttentionItemRef =
        d.payload.kind === 'experience'
          ? { shareId: d.shareId, destination: { kind: 'experience', id: d.payload.experienceId } }
          : { shareId: d.shareId };
      return {
        domain,
        id: d.shareId,
        sourceTimestamp: d.sentAt,
        summary: summarize('share', d),
        ref,
      };
    }
    default: {
      // Exhaustiveness guard: a new AttentionDomain must extend this switch.
      const _exhaustive: never = domain;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// View classification
// ---------------------------------------------------------------------------

/**
 * The single mutually-exclusive view the Notification_Center renders at any
 * given time (R9.6). Exactly one of these is ever active:
 *
 * - `loading` — at least one Domain_Source read is still in flight (R9.1, R9.3).
 * - `empty` — all four reads succeeded and there are zero total Pending_Items
 *   (R9.2).
 * - `error` — no read is in flight and at least one Domain_Source read failed
 *   (a rejection, non-2xx, or exceeded Load_Deadline; R8, R9.4).
 * - `list` — no read is in flight, no read failed, and there is at least one
 *   Pending_Item to show.
 */
export type AttentionView = 'loading' | 'empty' | 'error' | 'list';

/**
 * Classify which of the four mutually-exclusive Notification_Center views to
 * render from the current in-flight status and the per-source read outcomes
 * (Property 12; R9.2, R9.3, R9.6). Returns exactly one {@link AttentionView},
 * applying the rules in strict precedence so the views can never overlap:
 *
 * 1. **loading wins.** If any Domain_Source read is still in flight, the view is
 *    `loading` regardless of the outcomes gathered so far — the loading
 *    indication is shown in preference to empty until every read resolves by
 *    succeeding, failing, or exceeding the Load_Deadline (R9.3). A read that
 *    exceeds the deadline is surfaced by the caller as a resolved `failure`
 *    outcome and clears its in-flight flag (R9.4), so it does not keep the view
 *    in `loading`.
 * 2. **error when any source failed.** Once nothing is in flight, if at least
 *    one outcome is a `failure` the view is `error` — this includes the
 *    total-failure case, so a fully-failed load is never mistaken for
 *    empty-success (R8.3, R8.7).
 * 3. **empty only when all succeeded with zero items.** With nothing in flight
 *    and no failures, every read succeeded; the view is `empty` exactly when the
 *    total number of Pending_Items across those successful sources is zero
 *    (R9.2).
 * 4. **list otherwise.** All reads succeeded and there is at least one
 *    Pending_Item to present.
 *
 * `inFlight` is the caller's collapsed "any read still in flight" flag: the hook
 * layer ORs the four per-source loading flags into this single boolean before
 * calling the classifier. The function is pure and dependency-free — it derives
 * the view solely from its two inputs.
 *
 * Validates: Requirements 9.2, 9.3, 9.6
 */
export function classifyView(
  inFlight: boolean,
  outcomes: readonly AttentionSourceOutcome[],
): AttentionView {
  // 1. Loading wins whenever at least one read is still in flight (R9.3).
  if (inFlight) {
    return 'loading';
  }

  // 2. Nothing in flight: any failed source puts the view in error, including
  //    the total-failure case, so it is never confused with empty-success
  //    (R8.3, R8.7).
  const anyFailed = outcomes.some((outcome) => outcome.status === 'failure');
  if (anyFailed) {
    return 'error';
  }

  // 3/4. All reads succeeded: empty only when the total Pending_Item count is
  //      zero (R9.2), otherwise the populated list.
  let totalItems = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'success') {
      totalItems += outcome.items.length;
    }
  }
  return totalItems === 0 ? 'empty' : 'list';
}
