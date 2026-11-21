// Feature: first-run-onboarding, Property 1: First-Read Grandfathering Never Interrupts Veterans and Never Fires Mid-Onboarding
// Feature: first-run-onboarding, Property 2: Onboarding Completion and Skip Timestamps Are Monotonic and Idempotent
// Feature: first-run-onboarding, Property 3: Starter Checklist Visibility Invariant

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_INTENTS,
  ONBOARDING_PARKS,
  type OnboardingPatchInput,
} from '@dwt/shared';

import {
  deriveOnboardingState,
  mergeOnboardingPatch,
  shouldGrandfatherOnFirstRead,
  type ActivitySignals,
  type StoredOnboardingRow,
} from '../statePolicy.js';

const RUNS = { numRuns: 100 };

const isoDateArb = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const nullableIsoArb = fc.option(isoDateArb, { nil: null });

const activitySignalsArb: fc.Arbitrary<ActivitySignals> = fc.record({
  hasCompletion: fc.boolean(),
  hasExperienceLog: fc.boolean(),
  hasFoodLog: fc.boolean(),
  hasFavorite: fc.boolean(),
  hasTripMembership: fc.boolean(),
  hasClaimedPin: fc.boolean(),
});

const storedRowArb: fc.Arbitrary<StoredOnboardingRow> = fc.record({
  completedAt: nullableIsoArb,
  skippedAt: nullableIsoArb,
  grandfatheredAt: nullableIsoArb,
  initialIntent: fc.option(fc.constantFrom(...ONBOARDING_INTENTS), { nil: null }),
  selectedPark: fc.option(fc.constantFrom(...ONBOARDING_PARKS), { nil: null }),
  starterChecklistDismissedAt: nullableIsoArb,
});

const patchArb: fc.Arbitrary<OnboardingPatchInput> = fc
  .record({
    initialIntent: fc.option(fc.constantFrom(...ONBOARDING_INTENTS), {
      nil: undefined,
    }),
    selectedPark: fc.option(fc.constantFrom(...ONBOARDING_PARKS), {
      nil: undefined,
    }),
    complete: fc.option(fc.boolean(), { nil: undefined }),
    skip: fc.option(fc.boolean(), { nil: undefined }),
    dismissStarterChecklist: fc.option(fc.boolean(), { nil: undefined }),
    restoreStarterChecklist: fc.option(fc.boolean(), { nil: undefined }),
  })
  .filter(
    (p) =>
      !(p.dismissStarterChecklist === true && p.restoreStarterChecklist === true),
  )
  .map((p) => {
    const out: Record<string, unknown> = {};
    if (p.initialIntent !== undefined) out['initialIntent'] = p.initialIntent;
    if (p.selectedPark !== undefined) out['selectedPark'] = p.selectedPark;
    if (p.complete !== undefined) out['complete'] = p.complete;
    if (p.skip !== undefined) out['skip'] = p.skip;
    if (p.dismissStarterChecklist !== undefined) {
      out['dismissStarterChecklist'] = p.dismissStarterChecklist;
    }
    if (p.restoreStarterChecklist !== undefined) {
      out['restoreStarterChecklist'] = p.restoreStarterChecklist;
    }
    return out as OnboardingPatchInput;
  });

describe('Onboarding statePolicy properties', () => {
  it('Property 1: first-read grandfathering stays permanent across cleared data and never fires mid-onboarding', () => {
    fc.assert(
      fc.property(
        activitySignalsArb,
        isoDateArb,
        nullableIsoArb,
        (signals, grandfatherTs, dismissedAt) => {
          const hasCore =
            signals.hasCompletion ||
            signals.hasExperienceLog ||
            signals.hasFoodLog ||
            signals.hasTripMembership;
          expect(shouldGrandfatherOnFirstRead(signals)).toBe(hasCore);

          // Grandfathered veteran remains non-onboarding even if all signals become false
          const veteranStored: StoredOnboardingRow = {
            completedAt: null,
            skippedAt: null,
            grandfatheredAt: grandfatherTs,
            initialIntent: null,
            selectedPark: null,
            starterChecklistDismissedAt: dismissedAt,
          };
          const veteranState = deriveOnboardingState(veteranStored, signals);
          expect(veteranState.needsOnboarding).toBe(false);
          expect(veteranState.showStarterChecklist).toBe(false);

          // New user initialized with grandfatheredAt === null stays in onboarding
          // even when Step 2 adds completions or trip memberships
          const activeOnboardingStored: StoredOnboardingRow = {
            completedAt: null,
            skippedAt: null,
            grandfatheredAt: null,
            initialIntent: 'plan',
            selectedPark: null,
            starterChecklistDismissedAt: null,
          };
          const midFlowState = deriveOnboardingState(
            activeOnboardingStored,
            signals,
          );
          expect(midFlowState.needsOnboarding).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('Property 2: completedAt, skippedAt, and grandfatheredAt are monotonic and idempotent across patches', () => {
    fc.assert(
      fc.property(
        storedRowArb,
        patchArb,
        isoDateArb,
        (current, patch, nowIso) => {
          const next = mergeOnboardingPatch(current, patch, nowIso);
          expect(next.grandfatheredAt).toBe(current.grandfatheredAt);

          if (current.completedAt !== null) {
            expect(next.completedAt).toBe(current.completedAt);
          }
          if (current.skippedAt !== null) {
            expect(next.skippedAt).toBe(current.skippedAt);
          }
          if (patch.complete === true && current.completedAt === null) {
            expect(next.completedAt).toBe(nowIso);
          }
          if (patch.skip === true && current.skippedAt === null) {
            expect(next.skippedAt).toBe(nowIso);
          }
        },
      ),
      RUNS,
    );
  });

  it('Property 3: showStarterChecklist is true iff non-veteran, not dismissed, and at least one item incomplete', () => {
    fc.assert(
      fc.property(storedRowArb, activitySignalsArb, (stored, signals) => {
        const state = deriveOnboardingState(stored, signals);
        const expectedLogged =
          signals.hasCompletion ||
          signals.hasExperienceLog ||
          signals.hasFoodLog;
        expect(state.checklist).toEqual({
          loggedFirstExperience: expectedLogged,
          starredFavorite: signals.hasFavorite,
          hasTrip: signals.hasTripMembership,
          claimedPin: signals.hasClaimedPin,
        });

        const allDone =
          state.checklist.loggedFirstExperience &&
          state.checklist.starredFavorite &&
          state.checklist.hasTrip &&
          state.checklist.claimedPin;

        const expectedShow =
          stored.grandfatheredAt === null &&
          stored.starterChecklistDismissedAt === null &&
          !allDone;

        expect(state.showStarterChecklist).toBe(expectedShow);
        if (allDone) {
          expect(state.showStarterChecklist).toBe(false);
        }
      }),
      RUNS,
    );
  });
});
