/**
 * Preservation property test for the repeat-tap single-instance guard in
 * `useOpenExperience` (bugfix spec: experience-detail-back-navigation, Task 2).
 *
 * Validates (Preservation — behavior that must remain unchanged by the fix):
 *   Requirements 3.3
 *   (Property 2 — Preservation: Single Instance / Restored Context)
 *
 * Mirrors `experienceNavigation.repeatTap.prop.test.ts`, but deliberately
 * asserts only the behavior the bugfix must PRESERVE rather than the exact
 * dispatch target. The fix repoints `useOpenExperience` from the cross-tab
 * `navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`
 * to a root-level `navigate('ExperienceDetail', { experienceId })`; the
 * preserved invariant is the COUNT of dispatches, not their shape, so these
 * tests assert call counts and never the navigate arguments. They are EXPECTED
 * TO PASS on the unfixed code and must CONTINUE TO PASS after the fix.
 *
 * Preserved invariants (clause 3.3):
 *   - A burst of N >= 1 activations of a single row before the originating
 *     screen regains focus dispatches EXACTLY ONE navigation (no duplicate
 *     ExperienceDetail instances stacked).
 *   - When the originating screen regains focus (`useFocusEffect`), the guard
 *     is re-armed so a deliberate later tap navigates again.
 */

import fc from 'fast-check';
import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

// A single navigation spy observed by the assertions. Prefixed `mock*` so the
// jest.mock factory may reference it (jest hoists the factory above imports).
const mockNavigate = jest.fn();

// The latest `useFocusEffect` callback registered by the hook, captured so a
// test can re-fire focus (modelling the originating screen regaining focus
// after returning from the detail screen).
let latestFocusCallback: (() => void | (() => void)) | null = null;

// Model React Navigation in isolation: `useNavigation` yields the spy, and
// `useFocusEffect` runs its callback once on mount (initial focus) while also
// capturing it so a test can re-invoke it on demand.
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

import { useOpenExperience } from '../experienceNavigation';

const NUM_RUNS = 100;

describe('useOpenExperience — Preservation 3.3: repeated taps navigate exactly once', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    latestFocusCallback = null;
  });

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

          // A burst of N taps on the same row before the ExperienceDetail
          // screen is presented (no focus regained between taps).
          act(() => {
            for (let i = 0; i < activationCount; i += 1) {
              result.current(experienceId);
            }
          });

          // Preserved invariant: exactly one navigation dispatch regardless of
          // burst size (clause 3.3). The dispatch TARGET is intentionally not
          // asserted here — only the single-instance count, which the fix
          // preserves.
          expect(mockNavigate).toHaveBeenCalledTimes(1);

          unmount();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a single activation (N = 1) dispatches exactly one navigation', () => {
    const { result, unmount } = renderHook(() => useOpenExperience());

    act(() => {
      result.current('exp-single');
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('re-arms after the originating screen regains focus so a later tap navigates again', () => {
    const { result, unmount } = renderHook(() => useOpenExperience());

    // First burst → exactly one dispatch.
    act(() => {
      result.current('exp-rearm');
      result.current('exp-rearm');
      result.current('exp-rearm');
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    // The originating screen regains focus (e.g. after returning from the
    // detail screen): the captured `useFocusEffect` callback fires again,
    // clearing the in-flight guard.
    act(() => {
      latestFocusCallback?.();
    });

    // A deliberate later tap navigates anew — the guard was re-armed on focus,
    // not permanently latched (clause 3.3 / R5.3).
    act(() => {
      result.current('exp-rearm');
    });
    expect(mockNavigate).toHaveBeenCalledTimes(2);

    unmount();
  });
});
