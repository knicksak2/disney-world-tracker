// Feature: stats-experience-redesign, Property 17: Completion repeat count derivation and user isolation
/**
 * Property-based tests for CompletionEntryDTO.repeatCount derivation and user isolation.
 *
 * Validates: Requirements 21.2, 21.3
 *
 * Property 17:
 *   For any set of completed experiences, every returned CompletionEntry has
 *   repeatCount >= 1. When experience_logs rows exist for (targetUserId, experienceId),
 *   repeatCount equals that log count; when 0 logs exist (or legacy completion),
 *   repeatCount equals 1. Logs from other users never affect the target user's repeatCount.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../../db/pool.js';
import { createFriendCompletionsRepo } from '../repo.js';

const NUM_RUNS = 100;

interface TestCompletion {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly completedOn: string;
}

interface TestLog {
  readonly userId: string;
  readonly experienceId: string;
}

describe('Friend Completions — Property 17: repeatCount derivation and user isolation', () => {
  it('Property 17: repeatCount >= 1, matches user log count, and isolates from other users', async () => {
    const targetUserArb = fc.uuid();
    const otherUserArb = fc.uuid();

    const experienceArb: fc.Arbitrary<TestCompletion> = fc.record({
      experienceId: fc.uuid(),
      experienceName: fc.string({ minLength: 1, maxLength: 30 }),
      park: fc.constantFrom(...PARKS),
      category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
      completedOn: fc
        .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
        .map((d) => d.toISOString().slice(0, 10)),
    });

    await fc.assert(
      fc.asyncProperty(
        targetUserArb,
        otherUserArb.filter((id) => id !== '00000000-0000-0000-0000-000000000000'),
        fc.uniqueArray(experienceArb, {
          selector: (e) => e.experienceId,
          minLength: 1,
          maxLength: 15,
        }),
        fc.array(
          fc.record({
            experienceIndex: fc.integer({ min: 0, max: 14 }),
            isTargetUser: fc.boolean(),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        async (targetUserId, otherUserId, completions, rawLogs) => {
          // Construct logs referencing the completed experiences
          const logs: TestLog[] = rawLogs.map((l) => ({
            userId: l.isTargetUser ? targetUserId : otherUserId,
            experienceId:
              completions[l.experienceIndex % completions.length]!.experienceId,
          }));

          // Oracle: expected repeat counts for target user
          const expectedTargetLogsByExp = new Map<string, number>();
          for (const log of logs) {
            if (log.userId === targetUserId) {
              expectedTargetLogsByExp.set(
                log.experienceId,
                (expectedTargetLogsByExp.get(log.experienceId) ?? 0) + 1,
              );
            }
          }

          let queryParams: ReadonlyArray<unknown> = [];

          const fakePool: DbPool = {
            async query(text: string, params: ReadonlyArray<unknown> = []) {
              queryParams = params;

              // Assert that the SQL query includes user-scoped log join and COALESCE
              expect(text).toContain('COALESCE(l.log_count, 1)::int AS repeat_count');
              expect(text).toContain('FROM experience_logs');
              expect(text).toContain('WHERE user_id = $1');

              const queriedUserId = params[0] as string;

              // Simulate the SQL execution
              const rows = completions.map((c) => {
                const targetLogCount = logs.filter(
                  (l) =>
                    l.userId === queriedUserId &&
                    l.experienceId === c.experienceId,
                ).length;

                return {
                  experience_id: c.experienceId,
                  experience_name: c.experienceName,
                  park: c.park,
                  area_type: 'park' as AreaType,
                  category: c.category,
                  completed_on: c.completedOn,
                  rating: null,
                  shared_note: null,
                  repeat_count: targetLogCount > 0 ? targetLogCount : 1,
                };
              });

              return { rows };
            },
          } as unknown as DbPool;

          const repo = createFriendCompletionsRepo(fakePool);
          const entries = await repo.listCompletions(targetUserId);

          expect(queryParams[0]).toBe(targetUserId);
          expect(entries.length).toBe(completions.length);

          for (const entry of entries) {
            // Invariant 1: repeatCount is always >= 1
            expect(entry.repeatCount).toBeGreaterThanOrEqual(1);
            expect(Number.isInteger(entry.repeatCount)).toBe(true);

            const userLogs = expectedTargetLogsByExp.get(entry.experienceId) ?? 0;
            const expectedCount = Math.max(1, userLogs);

            // Invariant 2 & 3: matches target user's log count or defaults to 1
            expect(entry.repeatCount).toBe(expectedCount);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
