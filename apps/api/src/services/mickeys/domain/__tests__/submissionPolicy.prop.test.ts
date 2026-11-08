// Feature: hidden-mickeys, Property 12: Submission policy

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  containsUrlOrEmail,
  initialStatus,
  checkDailyCap,
  validateSubmission,
} from '../submissionPolicy.js';
import {
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
  type MickeyZone,
  type MickeyDifficulty,
} from '@dwt/shared';

describe('submissionPolicy domain module', () => {
  describe('containsUrlOrEmail', () => {
    it('detects realistic URL and email shapes', () => {
      const forbiddenSamples = [
        'check https://example.com/page here',
        'see http://x.com/a for details',
        'visit www.example.org right now',
        'go to disneyparks.com/mickey on your phone',
        'details at x.co/abc',
        'email me at user@example.com please',
        'contact test.name+tag@sub.domain.co for info',
      ];
      for (const text of forbiddenSamples) {
        expect(containsUrlOrEmail(text), `Expected "${text}" to be flagged`).toBe(true);
      }
    });

    it('passes clean text containing standalone dots or at-signs', () => {
      const allowedSamples = [
        'Look about 3.5 feet up on the left rafter.',
        'It is shaped like Mickey. Look closely at the wall.',
        'Meet the character @ noon near the arch.',
        'Notice the three circles: 1. Head. 2. Left ear. 3. Right ear.',
        'Hidden in the mural on the rock wall.',
      ];
      for (const text of allowedSamples) {
        expect(containsUrlOrEmail(text), `Expected "${text}" to pass`).toBe(false);
      }
    });
  });

  describe('initialStatus', () => {
    // Feature: hidden-mickeys, Property 12: Submission policy
    it('Property 12: initialStatus is approved only for publish mode with passing screen', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<'publish' | 'review'>('publish', 'review'),
          fc.constantFrom<'pass' | 'unscreened'>('pass', 'unscreened'),
          (mode, screen) => {
            const status = initialStatus(mode, screen);
            if (mode === 'publish' && screen === 'pass') {
              expect(status).toBe('approved');
            } else {
              expect(status).toBe('pending');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('checkDailyCap', () => {
    // Feature: hidden-mickeys, Property 12: Submission policy
    it('Property 12: checkDailyCap boundary is exact', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 1, max: 10 }),
          (createdLast24h, cap) => {
            const outcome = checkDailyCap(createdLast24h, cap);
            if (createdLast24h >= cap) {
              expect(outcome).toBe('limit');
            } else {
              expect(outcome).toBe('ok');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('validateSubmission', () => {
    const validCleanText = (min: number, max: number) =>
      fc
        .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.-'), {
          minLength: min,
          maxLength: max,
        })
        .filter((s) => !containsUrlOrEmail(s));

    // Feature: hidden-mickeys, Property 12: Submission policy
    it('Property 12: valid submissions with clean text pass validation', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom<MickeyZone>(...MICKEY_ZONES),
          fc.constantFrom<MickeyDifficulty>(...MICKEY_DIFFICULTIES),
          validCleanText(10, 140),
          validCleanText(10, 300),
          validCleanText(10, 500),
          (experienceId, zone, difficulty, clue1, clue2, reveal) => {
            const res = validateSubmission({
              experienceId,
              zone,
              difficulty,
              clue1,
              clue2,
              reveal,
            });
            expect(res.valid).toBe(true);
            if (res.valid) {
              expect(res.zone).toBe(zone);
              expect(res.difficulty).toBe(difficulty);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Feature: hidden-mickeys, Property 12: Submission policy
    it('Property 12: URL or email in clue1, clue2, or reveal rejects with mickey_text_rejected', () => {
      const urlText = 'check https://example.com/bad';
      const cleanClue1 = 'This is a clean clue 1 text.';
      const cleanClue2 = 'This is a clean clue 2 text with more info.';
      const cleanReveal = 'This is a clean reveal text where Mickey is.';

      // URL in clue1
      const res1 = validateSubmission({
        experienceId: '00000000-0000-4000-8000-000000000001',
        zone: 'queue',
        difficulty: 'medium',
        clue1: cleanClue1 + ' ' + urlText,
        clue2: cleanClue2,
        reveal: cleanReveal,
      });
      expect(res1.valid).toBe(false);
      if (!res1.valid) {
        expect(res1.code).toBe('mickey_text_rejected');
      }

      // URL in clue2
      const res2 = validateSubmission({
        experienceId: '00000000-0000-4000-8000-000000000001',
        zone: 'queue',
        difficulty: 'medium',
        clue1: cleanClue1,
        clue2: cleanClue2 + ' visit www.disney.com',
        reveal: cleanReveal,
      });
      expect(res2.valid).toBe(false);
      if (!res2.valid) {
        expect(res2.code).toBe('mickey_text_rejected');
      }

      // URL in reveal
      const res3 = validateSubmission({
        experienceId: '00000000-0000-4000-8000-000000000001',
        zone: 'queue',
        difficulty: 'medium',
        clue1: cleanClue1,
        clue2: cleanClue2,
        reveal: cleanReveal + ' contact admin@disney.org',
      });
      expect(res3.valid).toBe(false);
      if (!res3.valid) {
        expect(res3.code).toBe('mickey_text_rejected');
      }
    });

    // Feature: hidden-mickeys, Property 12: Submission policy
    it('Property 12: out-of-bounds text lengths reject with validation_failed', () => {
      // Too short clue1 (< 10 chars)
      const resShort = validateSubmission({
        experienceId: '00000000-0000-4000-8000-000000000001',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'Short',
        clue2: 'Valid clean clue 2 text here',
        reveal: 'Valid clean reveal text here',
      });
      expect(resShort.valid).toBe(false);
      if (!resShort.valid) {
        expect(resShort.code).toBe('validation_failed');
      }

      // Too long clue1 (> 140 chars)
      const resLong = validateSubmission({
        experienceId: '00000000-0000-4000-8000-000000000001',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'A'.repeat(141),
        clue2: 'Valid clean clue 2 text here',
        reveal: 'Valid clean reveal text here',
      });
      expect(resLong.valid).toBe(false);
      if (!resLong.valid) {
        expect(resLong.code).toBe('validation_failed');
      }
    });
  });
});
