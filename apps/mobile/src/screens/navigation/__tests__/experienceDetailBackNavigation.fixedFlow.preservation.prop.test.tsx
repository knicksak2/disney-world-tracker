/**
 * Fixed-flow preservation property tests for the Experience Detail
 * back-navigation bugfix (spec: experience-detail-back-navigation, Task 4).
 *
 * Validates: Requirements 3.3, 3.5
 *   (Property 2 — Preservation: single-instance repeat-tap guard, and
 *    no-affordance rows for missing/blank Experience_Id.)
 *
 * Two preserved invariants are exercised over wide generated domains:
 *
 *   1. Repeat-tap single dispatch (clause 3.3) — for a generated burst of
 *      N >= 1 activations of a single row before the originating screen regains
 *      focus, `useOpenExperience` dispatches EXACTLY ONE navigation, now
 *      targeting the root-level `navigate('ExperienceDetail', { experienceId })`
 *      route. Mirrors `experienceNavigation.repeatTap.prop.test.ts`, asserting
 *      both the single-dispatch count and the fixed route target.
 *
 *   2. No-affordance rows (clause 3.5) — for a generated Experience_Id value
 *      (present, empty, whitespace-only, explicit-null, or omitted), the
 *      presence of a navigation affordance on a `CompletionRow` matches the
 *      original rule exactly: a row is an activatable button (and a tap invokes
 *      the open callback) IFF `resolveExperienceTarget` resolves a non-null
 *      target. The fix relocates WHERE navigation is dispatched, never WHETHER
 *      a no-id row is activatable, so this presence must be unchanged.
 *
 * React Navigation is mocked at the module level so `useOpenExperience` can be
 * driven in isolation (the same approach as the existing repeat-tap prop test).
 * `CompletionRow` takes its open callback as a prop and does not use navigation
 * hooks, so it renders correctly under the same mock.
 */

import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// A single navigation spy observed by the assertions. Prefixed `mock*` so the
// jest.mock factory may reference it (jest hoists the factory above imports).
const mockNavigate = jest.fn();

// The latest `useFocusEffect` callback registered by the hook, captured so a
// test can re-fire focus (modelling the originating screen regaining focus).
let latestFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      latestFocusCallback = callback;
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

import { CompletionRow, type CompletionRowFields } from '../CompletionRow';
import {
  resolveExperienceTarget,
  useOpenExperience,
} from '../experienceNavigation';

const NUM_RUNS = 100;
const ROW_TEST_ID = 'completion-row';

// ===========================================================================
// Preservation 3.3 — a burst of N >= 1 taps dispatches exactly one navigation
// to the root-level ExperienceDetail route.
// ===========================================================================

describe('Fixed flow Preservation 3.3 — repeat taps dispatch exactly one root-level navigation', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    latestFocusCallback = null;
  });

  it('dispatches exactly one navigate("ExperienceDetail", { experienceId }) for N >= 1 activations before focus is regained', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        (activationCount, experienceId) => {
          mockNavigate.mockClear();

          const { result, unmount } = renderHook(() => useOpenExperience());

          act(() => {
            for (let i = 0; i < activationCount; i += 1) {
              result.current(experienceId);
            }
          });

          // Exactly one dispatch regardless of burst size (clause 3.3)...
          expect(mockNavigate).toHaveBeenCalledTimes(1);
          // ...targeting the relocated root-level ExperienceDetail route.
          expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
            experienceId,
          });

          unmount();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('re-arms after the originating screen regains focus so a later tap navigates again', () => {
    const { result, unmount } = renderHook(() => useOpenExperience());

    act(() => {
      result.current('exp-rearm');
      result.current('exp-rearm');
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    // Originating screen regains focus (returning from the detail screen).
    act(() => {
      latestFocusCallback?.();
    });

    act(() => {
      result.current('exp-rearm');
    });
    expect(mockNavigate).toHaveBeenCalledTimes(2);

    unmount();
  });
});

// ===========================================================================
// Preservation 3.5 — navigation-affordance presence matches the original rule
// for any generated Experience_Id (present / blank / missing).
// ===========================================================================

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const ratingArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 10 }),
);

const completedOnArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2018-01-01'), max: new Date('2025-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

const experienceNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

const fieldsArb: fc.Arbitrary<CompletionRowFields> = fc.constantFrom(
  'parks',
  'categories',
  'experiences',
);

const baseEntryArb = fc.record({
  experienceName: experienceNameArb,
  park: parkArb,
  category: categoryArb,
  completedOn: completedOnArb,
  rating: ratingArb,
  sharedNote: fc.constant(null),
});

// A present, non-empty Experience_Id (the affordance-present shape).
const presentIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim() !== '');

// A blank Experience_Id: empty or whitespace-only.
const blankIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 1,
    maxLength: 6,
  }),
);

type MaybeId = { readonly experienceId?: string | null };
const missingIdArb: fc.Arbitrary<MaybeId> = fc.oneof(
  fc.constant<MaybeId>({ experienceId: null }),
  fc.constant<MaybeId>({}),
);

// The full Experience_Id domain: present, blank, or missing/null.
const anyEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.oneof(
  fc
    .record({ base: baseEntryArb, experienceId: presentIdArb })
    .map(
      ({ base, experienceId }) =>
        ({ ...base, experienceId }) as CompletionEntryDTO,
    ),
  fc
    .record({ base: baseEntryArb, experienceId: blankIdArb })
    .map(
      ({ base, experienceId }) =>
        ({ ...base, experienceId }) as CompletionEntryDTO,
    ),
  fc
    .record({ base: baseEntryArb, maybeId: missingIdArb })
    .map(
      ({ base, maybeId }) =>
        ({ ...base, ...maybeId }) as unknown as CompletionEntryDTO,
    ),
);

describe('Fixed flow Preservation 3.5 — affordance presence matches resolveExperienceTarget for any Experience_Id', () => {
  it('a row is an activatable button (and a tap opens the experience) IFF a navigation target resolves', () => {
    fc.assert(
      fc.property(anyEntryArb, fieldsArb, (entry, fields) => {
        const target = resolveExperienceTarget(entry);
        const shouldHaveAffordance = target !== null;

        const onOpenExperience = jest.fn();
        const view = render(
          <CompletionRow
            entry={entry}
            fields={fields}
            onOpenExperience={onOpenExperience}
            testID={ROW_TEST_ID}
          />,
        );

        try {
          const row = view.getByTestId(ROW_TEST_ID);
          const isButton = row.props.accessibilityRole === 'button';

          // Affordance presence matches the original target-resolution rule.
          expect(isButton).toBe(shouldHaveAffordance);

          fireEvent.press(row);
          if (shouldHaveAffordance) {
            // A present, non-blank id navigates with that exact id.
            expect(onOpenExperience).toHaveBeenCalledTimes(1);
            expect(onOpenExperience).toHaveBeenCalledWith(target);
          } else {
            // A blank/missing id carries no affordance and performs no
            // navigation.
            expect(onOpenExperience).not.toHaveBeenCalled();
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
