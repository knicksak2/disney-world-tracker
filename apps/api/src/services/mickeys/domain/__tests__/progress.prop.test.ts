// Feature: hidden-mickeys, Property 5: Progress summary invariants
// Feature: hidden-mickeys, Property 6: Community entries never move the official total

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { summarizeProgress, type MickeyProgressInputItem } from '../progress.js';
import { PARKS, type Park, MICKEY_STATUSES, type MickeyStatus } from '@dwt/shared';

describe('progress domain module', () => {
  const parkArb = fc.option(fc.constantFrom<Park>(...PARKS), { nil: null });
  const mickeyArb: fc.Arbitrary<MickeyProgressInputItem> = fc.record({
    id: fc.uuid(),
    official: fc.boolean(),
    status: fc.constantFrom<MickeyStatus>(...MICKEY_STATUSES),
    park: parkArb,
  });

  // Feature: hidden-mickeys, Property 5: Progress summary invariants
  it('Property 5: summarizeProgress satisfies all progress invariants', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(mickeyArb, { selector: (m) => m.id, maxLength: 50 }),
        fc.array(fc.uuid(), { maxLength: 50 }),
        fc.array(fc.uuid(), { maxLength: 50 }),
        (mickeys, userAIds, userBIds) => {
          const findsA = new Set(userAIds);
          const findsB = new Set(userBIds);

          const summaryA = summarizeProgress(mickeys, findsA);
          const summaryB = summarizeProgress(mickeys, findsB);

          // 1. found <= total for overall and every byPark entry
          expect(summaryA.overall.found).toBeLessThanOrEqual(summaryA.overall.total);
          expect(summaryA.overall.found).toBeGreaterThanOrEqual(0);
          for (const bp of summaryA.byPark) {
            expect(bp.found).toBeLessThanOrEqual(bp.total);
            expect(bp.found).toBeGreaterThanOrEqual(0);
          }

          // 2. overall equals the sum of the byPark entries
          const sumTotal = summaryA.byPark.reduce((acc, bp) => acc + bp.total, 0);
          const sumFound = summaryA.byPark.reduce((acc, bp) => acc + bp.found, 0);
          expect(summaryA.overall.total).toBe(sumTotal);
          expect(summaryA.overall.found).toBe(sumFound);

          // 3. Two users with different finds see identical totals per park and overall
          expect(summaryA.overall.total).toBe(summaryB.overall.total);
          expect(summaryA.byPark.length).toBe(summaryB.byPark.length);
          for (let i = 0; i < summaryA.byPark.length; i++) {
            expect(summaryA.byPark[i]?.park).toBe(summaryB.byPark[i]?.park);
            expect(summaryA.byPark[i]?.total).toBe(summaryB.byPark[i]?.total);
          }

          // 4. Null-park entries are all grouped in at most one park: null entry
          const nullEntries = summaryA.byPark.filter((bp) => bp.park === null);
          expect(nullEntries.length).toBeLessThanOrEqual(1);

          const approvedOfficialNullPark = mickeys.filter(
            (m) => m.status === 'approved' && m.official && m.park === null,
          );
          if (approvedOfficialNullPark.length > 0) {
            expect(nullEntries.length).toBe(1);
            expect(nullEntries[0]?.total).toBe(approvedOfficialNullPark.length);
          } else {
            expect(nullEntries.length).toBe(0);
          }

          // 5. community.found counts only finds on approved Community Hidden Mickeys, total counts approved Community Hidden Mickeys
          const expectedCommunityFound = mickeys.filter(
            (m) => m.status === 'approved' && !m.official && findsA.has(m.id),
          ).length;
          const expectedCommunityTotal = mickeys.filter(
            (m) => m.status === 'approved' && !m.official,
          ).length;
          expect(summaryA.community.found).toBe(expectedCommunityFound);
          expect(summaryA.community.total).toBe(expectedCommunityTotal);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: hidden-mickeys, Property 6: Community entries never move the official total
  it('Property 6: community entries never alter official totals or finds; promoting raises official total by 1', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(mickeyArb, { selector: (m) => m.id, minLength: 1, maxLength: 30 }),
        fc.uuid(),
        parkArb,
        fc.constantFrom<MickeyStatus>(...MICKEY_STATUSES),
        fc.boolean(),
        (mickeys, newId, park, status, userHasFound) => {
          const userFound = new Set(mickeys.slice(0, 5).map((m) => m.id));
          if (userHasFound) {
            userFound.add(newId);
          }

          const before = summarizeProgress(mickeys, userFound);

          // Add a community entry with arbitrary status
          const communityMickey: MickeyProgressInputItem = {
            id: newId,
            official: false,
            status,
            park,
          };
          const withCommunity = summarizeProgress([...mickeys, communityMickey], userFound);

          // Official overall and byPark totals and finds must be completely unchanged
          expect(withCommunity.overall).toEqual(before.overall);
          expect(withCommunity.byPark).toEqual(before.byPark);

          // Now test promotion: promote the community entry to approved Official
          const promotedMickey: MickeyProgressInputItem = {
            ...communityMickey,
            official: true,
            status: 'approved',
          };
          const afterPromotion = summarizeProgress([...mickeys, promotedMickey], userFound);

          expect(afterPromotion.overall.total).toBe(before.overall.total + 1);
          if (userHasFound) {
            expect(afterPromotion.overall.found).toBe(before.overall.found + 1);
          } else {
            expect(afterPromotion.overall.found).toBe(before.overall.found);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
