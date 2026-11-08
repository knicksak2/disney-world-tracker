import { describe, expect, it } from 'vitest';

import {
  aliasFileEntrySchema,
  errorCodeToHttpStatus,
  mickeyFindBodySchema,
  mickeyHintBodySchema,
  mickeyListQuerySchema,
  mickeyReportBodySchema,
  mickeySubmissionBodySchema,
  mickeyVoteBodySchema,
  seedMickeyEntrySchema,
  MICKEY_CLUE1_MAX,
  MICKEY_CLUE1_MIN,
  MICKEY_CLUE2_MAX,
  MICKEY_CLUE2_MIN,
  MICKEY_REVEAL_MAX,
  MICKEY_REVEAL_MIN,
  MICKEY_ZONES,
  MICKEY_REPORT_REASONS,
} from '../index.js';

const UUID_1 = '00000000-0000-4000-8000-000000000001';

describe('Hidden Mickeys Shared Contracts and Schemas (Task 1.4)', () => {
  describe('mickeyListQuerySchema', () => {
    it('accepts an empty query and applies defaults', () => {
      const parsed = mickeyListQuerySchema.parse({});
      expect(parsed.limit).toBe(50);
      expect(parsed.found).toBeUndefined();
      expect(parsed.zone).toBeUndefined();
    });

    it('accepts each valid zone and omitting zone', () => {
      for (const zone of MICKEY_ZONES) {
        const res = mickeyListQuerySchema.safeParse({ zone });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.zone).toBe(zone);
        }
      }
      expect(mickeyListQuerySchema.safeParse({}).success).toBe(true);
    });

    it('rejects an invalid zone', () => {
      const res = mickeyListQuerySchema.safeParse({ zone: 'gift_shop' });
      expect(res.success).toBe(false);
    });

    it('validates search query string length (2 to 60 characters)', () => {
      expect(mickeyListQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
      expect(mickeyListQuerySchema.safeParse({ q: 'ab' }).success).toBe(true);
      expect(mickeyListQuerySchema.safeParse({ q: 'a'.repeat(60) }).success).toBe(true);
      expect(mickeyListQuerySchema.safeParse({ q: 'a'.repeat(61) }).success).toBe(false);
    });

    it('rejects unknown fields due to .strict()', () => {
      const res = mickeyListQuerySchema.safeParse({ unknownField: 'foo' });
      expect(res.success).toBe(false);
    });
  });

  describe('mickeyHintBodySchema', () => {
    it('accepts level 2 and level 3', () => {
      expect(mickeyHintBodySchema.safeParse({ level: 2 }).success).toBe(true);
      expect(mickeyHintBodySchema.safeParse({ level: 3 }).success).toBe(true);
    });

    it('rejects level 1, level 4, and negative levels', () => {
      expect(mickeyHintBodySchema.safeParse({ level: 1 }).success).toBe(false);
      expect(mickeyHintBodySchema.safeParse({ level: 4 }).success).toBe(false);
      expect(mickeyHintBodySchema.safeParse({ level: 0 }).success).toBe(false);
    });

    it('rejects unknown fields', () => {
      expect(mickeyHintBodySchema.safeParse({ level: 2, extra: true }).success).toBe(false);
    });
  });

  describe('mickeyFindBodySchema', () => {
    it('accepts empty body or valid tripId', () => {
      expect(mickeyFindBodySchema.safeParse({}).success).toBe(true);
      expect(mickeyFindBodySchema.safeParse({ tripId: UUID_1 }).success).toBe(true);
      expect(mickeyFindBodySchema.safeParse({ tripId: null }).success).toBe(true);
    });

    it('rejects invalid tripId or extra fields', () => {
      expect(mickeyFindBodySchema.safeParse({ tripId: 'not-a-uuid' }).success).toBe(false);
      expect(mickeyFindBodySchema.safeParse({ tripId: UUID_1, extra: 123 }).success).toBe(false);
    });
  });

  describe('mickeyVoteBodySchema', () => {
    it('accepts there and gone', () => {
      expect(mickeyVoteBodySchema.safeParse({ vote: 'there' }).success).toBe(true);
      expect(mickeyVoteBodySchema.safeParse({ vote: 'gone' }).success).toBe(true);
    });

    it('rejects other vote values or extra fields', () => {
      expect(mickeyVoteBodySchema.safeParse({ vote: 'maybe' }).success).toBe(false);
      expect(mickeyVoteBodySchema.safeParse({ vote: 'there', extra: 'bad' }).success).toBe(false);
    });
  });

  describe('mickeyReportBodySchema', () => {
    it('accepts all valid report reasons with optional note', () => {
      for (const reason of MICKEY_REPORT_REASONS) {
        expect(mickeyReportBodySchema.safeParse({ reason }).success).toBe(true);
        expect(
          mickeyReportBodySchema.safeParse({ reason, note: 'Valid note explaining report' }).success
        ).toBe(true);
      }
    });

    it('rejects invalid reasons, oversized notes, and extra fields', () => {
      expect(mickeyReportBodySchema.safeParse({ reason: 'fake_reason' }).success).toBe(false);
      expect(
        mickeyReportBodySchema.safeParse({
          reason: 'spam',
          note: 'a'.repeat(301),
        }).success
      ).toBe(false);
      expect(
        mickeyReportBodySchema.safeParse({
          reason: 'spam',
          extra: true,
        }).success
      ).toBe(false);
    });
  });

  describe('mickeySubmissionBodySchema', () => {
    const validSubmission = {
      experienceId: UUID_1,
      zone: 'queue' as const,
      difficulty: 'medium' as const,
      clue1: 'A valid clue 1 string',
      clue2: 'A valid clue 2 string with more details to look for',
      reveal: 'The complete reveal description showing where the Mickey is located',
    };

    it('accepts a valid submission', () => {
      expect(mickeySubmissionBodySchema.safeParse(validSubmission).success).toBe(true);
    });

    it('rejects clue1 under min (10) or over max (140)', () => {
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          clue1: 'a'.repeat(MICKEY_CLUE1_MIN - 1),
        }).success
      ).toBe(false);
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          clue1: 'a'.repeat(MICKEY_CLUE1_MAX + 1),
        }).success
      ).toBe(false);
    });

    it('rejects clue2 under min (10) or over max (300)', () => {
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          clue2: 'a'.repeat(MICKEY_CLUE2_MIN - 1),
        }).success
      ).toBe(false);
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          clue2: 'a'.repeat(MICKEY_CLUE2_MAX + 1),
        }).success
      ).toBe(false);
    });

    it('rejects reveal under min (10) or over max (500)', () => {
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          reveal: 'a'.repeat(MICKEY_REVEAL_MIN - 1),
        }).success
      ).toBe(false);
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          reveal: 'a'.repeat(MICKEY_REVEAL_MAX + 1),
        }).success
      ).toBe(false);
    });

    it('rejects invalid zone, difficulty, or extra fields', () => {
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          zone: 'parking_lot',
        }).success
      ).toBe(false);
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          difficulty: 'impossible',
        }).success
      ).toBe(false);
      expect(
        mickeySubmissionBodySchema.safeParse({
          ...validSubmission,
          extraField: 'not_allowed',
        }).success
      ).toBe(false);
    });
  });

  describe('seedMickeyEntrySchema', () => {
    const validSeedEntry = {
      seedKey: 'mk-haunted-mansion-ballroom-plates',
      experienceName: 'Haunted Mansion',
      park: 'Magic Kingdom' as const,
      zone: 'on_ride' as const,
      difficulty: 'easy' as const,
      clue1: 'Banquet table place settings in the Grand Ballroom',
      clue2: 'Look down from your doom buggy onto the large dining table',
      reveal: 'A large dinner plate flanked by two smaller saucers forms Mickey',
    };

    it('accepts valid seed entries with and without photoUrl', () => {
      expect(seedMickeyEntrySchema.safeParse(validSeedEntry).success).toBe(true);
      expect(
        seedMickeyEntrySchema.safeParse({
          ...validSeedEntry,
          photoUrl: 'https://example.com/photo.webp',
        }).success
      ).toBe(true);
    });

    it('rejects photoUrl exceeding max characters (2048)', () => {
      expect(
        seedMickeyEntrySchema.safeParse({
          ...validSeedEntry,
          photoUrl: 'https://example.com/' + 'a'.repeat(2050),
        }).success
      ).toBe(false);
    });

    it('rejects unknown fields due to .strict()', () => {
      expect(
        seedMickeyEntrySchema.safeParse({
          ...validSeedEntry,
          unrecognizedProp: 123,
        }).success
      ).toBe(false);
    });
  });

  describe('aliasFileEntrySchema', () => {
    it('accepts valid alias and canonical entity IDs', () => {
      expect(
        aliasFileEntrySchema.safeParse({
          aliasUpstreamEntityId: '412010036;entityType=Attraction',
          canonicalUpstreamEntityId: '80010161;entityType=Attraction',
        }).success
      ).toBe(true);
    });

    it('rejects missing or empty IDs and unknown fields', () => {
      expect(
        aliasFileEntrySchema.safeParse({
          aliasUpstreamEntityId: '',
          canonicalUpstreamEntityId: '80010161;entityType=Attraction',
        }).success
      ).toBe(false);
      expect(
        aliasFileEntrySchema.safeParse({
          aliasUpstreamEntityId: '412010036',
          canonicalUpstreamEntityId: '80010161',
          extra: true,
        }).success
      ).toBe(false);
    });
  });

  describe('Error Codes and HTTP Mappings', () => {
    it('maps all Hidden Mickey error codes to their spec HTTP statuses', () => {
      expect(errorCodeToHttpStatus.mickey_not_found).toBe(404);
      expect(errorCodeToHttpStatus.mickey_text_rejected).toBe(400);
      expect(errorCodeToHttpStatus.mickey_submission_limit).toBe(429);
      expect(errorCodeToHttpStatus.mickey_submissions_banned).toBe(403);
      expect(errorCodeToHttpStatus.mickey_feature_disabled).toBe(503);
    });
  });
});
