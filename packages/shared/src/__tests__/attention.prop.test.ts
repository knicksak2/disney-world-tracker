// Feature: notification-center, Property 2: Item summary and shape
/**
 * Property-based tests for the Notification_Center pure attention model's
 * per-item normalization (`summarize` + `toAttentionItem` in `../attention.ts`).
 *
 * Property 2 (design.md → Correctness Properties):
 *
 *   For any pending domain item, its Attention_Item carries the item's domain
 *   type and its source timestamp, and its summary is at most 140 characters.
 *
 * These assertions hold across every domain (friendRequest, tripInvite,
 * rodeWithTag, share) and, crucially, across summary inputs that exceed 140
 * characters and inputs that contain multi-byte / emoji / surrogate-pair
 * characters. The hard-truncation in `summarize` must never emit a summary
 * longer than 140 UTF-16 code units, and must never leave a dangling (lone)
 * surrogate at the truncation boundary — so the result is always a well-formed
 * string of bounded length.
 *
 * Validates: Requirements 1.3
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  SUMMARY_MAX_LENGTH,
  toAttentionItem,
  type AttentionItem,
} from '../attention.js';
import type { FriendRequestDTO, InboxItemDTO } from '../dto/index.js';
import type { PendingRodeWithTagDTO, TripIncomingInviteDTO } from '../trips.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A syntactically valid UUID string. */
const uuidArb = fc.uuid();

/** A valid ISO-8601 timestamp spanning a wide, realistic range. */
const isoTimestampArb = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

/**
 * A single emoji whose UTF-16 encoding is a surrogate pair (two code units).
 * Repeating it lets us force a truncation boundary to fall *between* the two
 * units of a pair, exercising the surrogate-safe back-off in `hardTruncate`.
 */
const EMOJI = '😀'; // U+1F600, encoded as the surrogate pair D83D DE00

/**
 * A rich free-text field that feeds a domain summary. It deliberately mixes:
 *  - arbitrary Unicode (via `fullUnicodeString`, which includes astral-plane
 *    code points encoded as surrogate pairs — multi-byte / emoji coverage),
 *  - long runs that push the composed summary past 140 characters, and
 *  - runs crafted so a surrogate pair straddles the 140-unit boundary.
 *
 * `fullUnicodeString` only produces well-formed strings (no lone surrogates),
 * so any lone surrogate observed in the output would be a truncation bug.
 */
const summaryFieldArb = fc.oneof(
  // Ordinary well-formed Unicode, sometimes short, sometimes long.
  fc.fullUnicodeString({ minLength: 0, maxLength: 200 }),
  // Long, pure-emoji run: each emoji is a 2-unit surrogate pair, so the
  // 140-unit boundary can only ever fall between the units of a pair.
  fc.integer({ min: 60, max: 120 }).map((n) => EMOJI.repeat(n)),
  // Text prefix of a length near the boundary, followed by emoji, so a pair
  // straddles unit index 139/140 for odd prefix lengths.
  fc
    .integer({ min: 130, max: 148 })
    .map((prefixLen) => 'a'.repeat(prefixLen) + EMOJI.repeat(6)),
  // Mixed: arbitrary Unicode then an emoji tail pushing past the boundary.
  fc
    .tuple(fc.fullUnicodeString({ maxLength: 138 }), fc.integer({ min: 10, max: 40 }))
    .map(([text, n]) => text + EMOJI.repeat(n)),
);

// ---------------------------------------------------------------------------
// Per-domain DTO generators (summary-feeding fields use `summaryFieldArb`)
// ---------------------------------------------------------------------------

const friendRequestDtoArb: fc.Arbitrary<FriendRequestDTO> = fc.record({
  id: uuidArb,
  senderId: summaryFieldArb, // feeds the summary
  recipientId: uuidArb,
  createdAt: isoTimestampArb,
});

const tripInviteDtoArb: fc.Arbitrary<TripIncomingInviteDTO> = fc.record({
  inviteId: uuidArb,
  tripId: uuidArb,
  tripName: summaryFieldArb, // feeds the summary
  startDate: isoTimestampArb,
  endDate: isoTimestampArb,
  inviterDisplayName: summaryFieldArb, // feeds the summary
  inviterAvatarPreset: fc.constant(null),
  createdAt: isoTimestampArb,
});

const rodeWithTagDtoArb: fc.Arbitrary<PendingRodeWithTagDTO> = fc.record({
  tagId: uuidArb,
  tripLogEntryId: uuidArb,
  experienceName: summaryFieldArb, // feeds the summary
  taggingMemberDisplayName: summaryFieldArb, // feeds the summary
  createdAt: isoTimestampArb,
});

/** An InboxItemDTO whose sender display name feeds the summary. */
const shareDtoArb: fc.Arbitrary<InboxItemDTO> = fc
  .record({
    shareId: uuidArb,
    senderId: uuidArb,
    senderDisplayName: summaryFieldArb, // feeds the summary
    sentAt: isoTimestampArb,
    kind: fc.constantFrom('experience' as const, 'progress' as const),
    experienceId: uuidArb,
  })
  .map(({ shareId, senderId, senderDisplayName, sentAt, kind, experienceId }) => {
    const base = {
      shareId,
      read: false,
      senderId,
      senderDisplayName,
      payloadKind: kind,
      sentAt,
      myReaction: null,
    };
    if (kind === 'experience') {
      return {
        ...base,
        payload: { kind: 'experience', experienceId },
      } as InboxItemDTO;
    }
    return {
      ...base,
      payload: {
        kind: 'progress',
        overallPercent: 0,
        perParkPercent: {},
        perCategoryPercent: {},
      },
    } as InboxItemDTO;
  });

// ---------------------------------------------------------------------------
// Well-formedness helper: detect a lone (unpaired) UTF-16 surrogate.
// ---------------------------------------------------------------------------

/**
 * Return `true` if `s` contains a lone surrogate — a high surrogate not
 * followed by a low surrogate, or a low surrogate not preceded by a high one.
 * A surrogate-safe truncation must never produce such a string.
 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      // High surrogate: the next unit must be a low surrogate.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i += 1; // consume the paired low surrogate
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      // Low surrogate with no preceding high surrogate.
      return true;
    }
  }
  return false;
}

/**
 * Assert the shared shape invariants for a normalized {@link AttentionItem}:
 * it carries the expected domain type, the exact source timestamp from the
 * DTO, and a well-formed summary of at most 140 UTF-16 code units (R1.3).
 */
function assertItemShape(
  item: AttentionItem,
  expectedDomain: AttentionItem['domain'],
  expectedTimestamp: string,
): void {
  expect(item.domain).toBe(expectedDomain);
  expect(item.sourceTimestamp).toBe(expectedTimestamp);
  expect(item.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
  expect(hasLoneSurrogate(item.summary)).toBe(false);
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: Item summary and shape', () => {
  it('friendRequest: carries the domain + createdAt timestamp and a ≤140-char summary (R1.3)', () => {
    fc.assert(
      fc.property(friendRequestDtoArb, (dto) => {
        const item = toAttentionItem('friendRequest', dto);
        assertItemShape(item, 'friendRequest', dto.createdAt);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('tripInvite: carries the domain + createdAt timestamp and a ≤140-char summary (R1.3)', () => {
    fc.assert(
      fc.property(tripInviteDtoArb, (dto) => {
        const item = toAttentionItem('tripInvite', dto);
        assertItemShape(item, 'tripInvite', dto.createdAt);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rodeWithTag: carries the domain + createdAt timestamp and a ≤140-char summary (R1.3)', () => {
    fc.assert(
      fc.property(rodeWithTagDtoArb, (dto) => {
        const item = toAttentionItem('rodeWithTag', dto);
        assertItemShape(item, 'rodeWithTag', dto.createdAt);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('share: carries the domain + sentAt timestamp and a ≤140-char summary (R1.3)', () => {
    fc.assert(
      fc.property(shareDtoArb, (dto) => {
        const item = toAttentionItem('share', dto);
        assertItemShape(item, 'share', dto.sentAt);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
