/**
 * Unit tests for the Phase 2 reaction contracts.
 *
 * Covers the example/edge-case portion of the closed `Reaction_Vocabulary`
 * (R11.2, R11.3) and its integration into the recipient inbox projection:
 *   - `shareReactionValueSchema` accepts every vocabulary member and rejects
 *     values outside it
 *   - `inboxItemSchema.myReaction` accepts a vocabulary value or `null` and
 *     rejects an out-of-vocabulary string
 *   - the new error codes map to the HTTP statuses from the design catalog
 *
 * Validates: Requirements 8.7, 11.2, 11.3
 */

import { describe, expect, it } from 'vitest';

import { SHARE_REACTION_VALUES } from '../../enums.js';
import { errorCodeToHttpStatus } from '../../errors.js';
import { inboxItemSchema } from '../Inbox.js';
import { shareReactionValueSchema } from '../primitives.js';

const BASE_INBOX_ITEM = {
  shareId: '11111111-1111-4111-8111-111111111111',
  read: false,
  senderId: '22222222-2222-4222-8222-222222222222',
  senderDisplayName: 'Ariel',
  payloadKind: 'progress',
  payload: {
    kind: 'progress',
    overallPercent: 12.5,
    perParkPercent: {},
    perCategoryPercent: {},
  },
  sentAt: '2024-01-01T00:00:00Z',
} as const;

describe('shareReactionValueSchema — closed Reaction_Vocabulary', () => {
  it('accepts every vocabulary member', () => {
    for (const value of SHARE_REACTION_VALUES) {
      expect(shareReactionValueSchema.safeParse(value).success).toBe(true);
    }
  });

  it('exposes exactly the four documented reaction values', () => {
    expect([...SHARE_REACTION_VALUES]).toEqual([
      'like',
      'love',
      'been_there',
      'want_to_go',
    ]);
  });

  it('rejects a value outside the vocabulary', () => {
    expect(shareReactionValueSchema.safeParse('dislike').success).toBe(false);
    expect(shareReactionValueSchema.safeParse('').success).toBe(false);
  });
});

describe('inboxItemSchema.myReaction — finalized reaction type', () => {
  it('accepts a vocabulary reaction value', () => {
    const result = inboxItemSchema.safeParse({
      ...BASE_INBOX_ITEM,
      myReaction: 'love',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null reaction (recipient has not reacted)', () => {
    const result = inboxItemSchema.safeParse({
      ...BASE_INBOX_ITEM,
      myReaction: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-vocabulary reaction string', () => {
    const result = inboxItemSchema.safeParse({
      ...BASE_INBOX_ITEM,
      myReaction: 'thumbs_up',
    });
    expect(result.success).toBe(false);
  });
});

describe('errorCodeToHttpStatus — new Phase 2 codes', () => {
  it('maps the new codes to their catalog HTTP statuses', () => {
    expect(errorCodeToHttpStatus.reaction_invalid).toBe(400);
    expect(errorCodeToHttpStatus.reaction_forbidden).toBe(403);
    expect(errorCodeToHttpStatus.push_registration_invalid).toBe(400);
  });
});
