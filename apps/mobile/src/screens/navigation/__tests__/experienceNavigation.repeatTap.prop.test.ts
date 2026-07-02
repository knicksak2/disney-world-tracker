// Feature: experience-detail-navigation, Property 4: Repeated taps navigate exactly once
/**
 * Property-based test for the repeat-tap guard in `useOpenExperience`
 * (task 4.4).
 *
 * Validates: Requirements 5.1, 5.2
 *
 * Property 4 — Repeated taps navigate exactly once:
 *
 *   For any number N >= 1 of activations of a single Completed_Experience_Row
 *   that occur before the `ExperienceDetailScreen` is presented — i.e. before
 *   the originating screen regains focus — the App dispatches exactly one
 *   navigation to `ExperienceDetailScreen` and stacks no duplicate instances.
 *
 * `useOpenExperience` holds a `useRef` in-flight flag: the first activation in
 * a tap burst dispatches `navigate('ExperienceDetail', { experienceId })` and
 * sets the flag; every subsequent activation is ignored while the flag is set.
 * The flag is only cleared when the originating screen regains focus
 * (`useFocusEffect`). This test therefore mocks `@react-navigation/native` so
 * that:
 *
 *   - `useNavigation` returns a spy `navigate`, and
 *   - `useFocusEffect` fires its callback once on mount (the initial focus)
 *     and never again — modelling "no focus regained" for the duration of the
 *     tap burst.
 *
 * Runs with `numRuns: 100` per the spec convention. The generator produces
 * N in [1, 25] activations and an arbitrary non-empty `experienceId`, so the
 * single-dispatch invariant is exercised across burst sizes and ids.
 */

import fc from 'fast-check';
import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

// A single navigation spy observed by the assertions. Prefixed `mock*` so the
// jest.mock factory may reference it (jest hoists the factory above imports).
const mockNavigate = jest.fn();

// Model React Navigation in isolation: `useNavigation` yields the spy, and
// `useFocusEffect` runs its callback once on mount (initial focus) and never
// re-fires — i.e. the originating screen does not regain focus during the
// tap burst, which is precisely the precondition of Property 4.
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

import { useOpenExperience } from '../experienceNavigation';

const NUM_RUNS = 100;

describe('useOpenExperience — Property 4: repeated taps navigate exactly once', () => {
  it('dispatches exactly one navigation for N >= 1 activations before focus is regained', () => {
    fc.assert(
      fc.property(
        // N >= 1 activations in a single tap burst.
        fc.integer({ min: 1, max: 25 }),
        // An arbitrary present, non-empty Experience_Id.
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        (activationCount, experienceId) => {
          mockNavigate.mockClear();

          const { result, unmount } = renderHook(() => useOpenExperience());

          // Simulate a burst of N taps on the same row before the
          // ExperienceDetailScreen is presented (no focus regained between
          // taps, since the mocked useFocusEffect fires only on mount).
          act(() => {
            for (let i = 0; i < activationCount; i += 1) {
              result.current(experienceId);
            }
          });

          // Exactly one navigation dispatch, regardless of burst size
          // (R5.1, R5.2) — no duplicate ExperienceDetail instances stacked.
          expect(mockNavigate).toHaveBeenCalledTimes(1);
          // And it targets the tapped row's Experience via the root-level
          // ExperienceDetail route (pushed above MainTabs).
          expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
            experienceId,
          });

          unmount();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a single activation (N = 1) dispatches exactly one navigation (R5.1)', () => {
    mockNavigate.mockClear();

    const { result, unmount } = renderHook(() => useOpenExperience());

    act(() => {
      result.current('exp-single');
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-single',
    });

    unmount();
  });
});
