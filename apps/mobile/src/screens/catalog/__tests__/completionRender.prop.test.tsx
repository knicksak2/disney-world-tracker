// Feature: disney-world-tracker, Property 8: rendered indicator/date matches stored completion state
//
// Validates: Requirements 2.4
//
// Property 8 (from design.md):
//   For any (User, Experience) Completion state, the rendered indicator and
//   date in the App match the stored state: a Completion-present indicator
//   with the stored date when present, a no-Completion indicator otherwise.
//
// Test strategy:
//   - Generate the Completion state as a tagged union:
//       { kind: 'absent' }                      — no Completion stored.
//       { kind: 'present', date: 'YYYY-MM-DD' } — Completion stored on `date`.
//   - For the absent case, render `<CompletionControls completion={null} ...>`
//     and assert the empty-state indicator (`completion-empty-status`) is
//     present, the populated-state node (`completion-date`) is NOT present,
//     and the empty-state copy reads "Not visited yet" — exactly the
//     no-Completion indicator R2.4 requires.
//   - For the present case, render
//     `<CompletionControls completion={{ ..., completedOn: date }} ...>` and
//     assert the populated-state node (`completion-date`) is present with
//     text content `"Completed on ${date}"` — the same string the component
//     emits — and the empty-state node is absent.
//   - Wrap each render in a `QueryClientProvider` so the test environment
//     matches production (the parent screen lives under one) even though
//     `CompletionControls` itself does not call `useQuery`.
//   - Stub the three callback props (`onMutated` and the implicit no-op
//     handlers) with `jest.fn()`s — the component should still render
//     correctly without ever invoking them since the property only exercises
//     the render path, not the mutation path.
//   - `unmount()` between samples so the test does not leak React trees
//     across the 100 fast-check runs.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import type { CompletionDTO } from '@dwt/shared';

import CompletionControls from '../CompletionControls';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// `CompletionControls` imports `apiRequest` for its mutation handlers; the
// render path never calls it, but the import must resolve. We stub it with a
// rejecting fn so an accidental call would surface loudly.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(() =>
      Promise.reject(new Error('apiRequest should not be called in render-only property test')),
    ),
  };
});

// `expo-constants` is read by the API client at module load time.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// `expo-secure-store` is referenced through the session storage helper.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DD` calendar-date arbitrary. The day range stops at 28 so every
 * (year, month, day) triple is a valid Gregorian date without month-length
 * branching — sufficient coverage for the render contract under test (R2.4
 * cares about string equality, not date semantics).
 */
const ymdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

type CompletionState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly date: string };

const completionStateArb: fc.Arbitrary<CompletionState> = fc.oneof(
  fc.constant({ kind: 'absent' as const }),
  ymdArb.map((date) => ({ kind: 'present' as const, date })),
);

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

const FIXED_USER_ID = '00000000-0000-0000-0000-000000000001';
const FIXED_EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_TZ = 'America/New_York';

function buildCompletion(state: CompletionState): CompletionDTO | null {
  if (state.kind === 'absent') return null;
  return {
    userId: FIXED_USER_ID,
    experienceId: FIXED_EXPERIENCE_ID,
    completedOn: state.date,
    userTz: FIXED_TZ,
  };
}

function makeQueryClient(): QueryClient {
  // Disabling retries / cache time keeps any incidental query attempts
  // synchronous and bounded — the property test renders 100 trees and we
  // do not want the default 5-minute gcTime keeping them alive in memory.
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(state: CompletionState): ReturnType<typeof render> {
  const client = makeQueryClient();
  const completion = buildCompletion(state);
  return render(
    <QueryClientProvider client={client}>
      <CompletionControls
        experienceId={FIXED_EXPERIENCE_ID}
        completion={completion}
        onMutated={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 8: Completion render matches stored state (R2.4)', () => {
  test('rendered indicator/date matches stored completion state', () => {
    fc.assert(
      fc.property(completionStateArb, (state) => {
        const view = renderWithProviders(state);
        try {
          if (state.kind === 'absent') {
            // No-Completion indicator must be present, with the exact
            // empty-state copy R2.4 mandates ("not-completed indicator").
            const empty = view.queryByTestId('completion-empty-status');
            expect(empty).not.toBeNull();
            expect(view.queryByText('Not visited yet')).not.toBeNull();

            // ...and the populated-state date node must be absent.
            expect(view.queryByTestId('completion-date')).toBeNull();

            // The mark affordance is the no-Completion indicator's
            // companion control; it must render so the User can transition
            // out of the empty state.
            expect(view.queryByTestId('completion-mark-button')).not.toBeNull();
          } else {
            // Completion-present indicator + stored date must be rendered
            // verbatim. The component formats the populated state as
            // "Completed on YYYY-MM-DD"; we assert exact text-content
            // equality so any drift in the component's date format
            // (locale-dependent month names, slashes, etc.) would fail
            // the property. RNTL's `queryByText` matches a Text node whose
            // resolved text equals the supplied string, which is exactly
            // the predicate we want.
            const dateNode = view.queryByTestId('completion-date');
            expect(dateNode).not.toBeNull();
            expect(
              view.queryByText(`Completed on ${state.date}`),
            ).not.toBeNull();

            // The empty-state node must NOT be rendered alongside the
            // populated state; the two are mutually exclusive per R2.4.
            expect(view.queryByTestId('completion-empty-status')).toBeNull();

            // Edit / unmark affordances accompany a present Completion.
            expect(view.queryByTestId('completion-edit-button')).not.toBeNull();
            expect(view.queryByTestId('completion-unmark-button')).not.toBeNull();
          }
        } finally {
          // Always unmount so React trees do not accumulate across the 100
          // fast-check runs.
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
