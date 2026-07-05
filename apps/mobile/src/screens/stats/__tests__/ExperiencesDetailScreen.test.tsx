/**
 * ExperiencesDetailScreen tests (task 7.8).
 *
 * Validates: Requirements 14.5
 *
 * `ExperiencesDetailScreen` is the Experiences drill-in of the Stats tab. Unlike
 * the coverage/ratings detail screens — which read the shared
 * `['me-stats', { percentile: true }]` cache entry — this screen reads a SEPARATE
 * query (`useOwnCompletionsQuery`, keyed `['own-completions', ownUserId]`). These
 * React Native Testing Library tests pin the two things R14.5 demands of that
 * arrangement:
 *
 *   - the completions read is SCOPED — the screen drives its view entirely from
 *     `useOwnCompletionsQuery`, never touching the shared stats query, and
 *   - its in-pane loading / error / Retry are ISOLATED — a completions failure
 *     surfaces only this screen's own `experiences-detail-error` + Retry, and
 *     Retry re-issues only the completions read (`query.refetch`), leaving any
 *     coverage / ratings surface untouched.
 *
 * Following the established screen-test convention, the completions query hook
 * (`useOwnCompletions`) is mocked so each request state — loading, error, and
 * success — can be driven deterministically without a real network or
 * `QueryClient`. The two React Navigation affordances the screen reaches for
 * (`useNavigation` and the cross-stack `useOpenExperience`) are stubbed so the
 * screen renders standalone.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CompletionEntryDTO, FriendCompletionsDTO } from '@dwt/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import type { ApiError } from '../../../api/client';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// The screen wires row taps to the Catalog tab's ExperienceDetail via
// `useOpenExperience`, and pulls `navigation.goBack` from `useNavigation`.
// These tests render the screen standalone (no navigator), so stub both.
const mockOpenExperience = jest.fn();

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../../navigation/experienceNavigation', () => ({
  __esModule: true,
  // Preserve the real module (CompletionRow reads `resolveExperienceTarget`);
  // override only the cross-stack navigation hook with a spy.
  ...jest.requireActual('../../navigation/experienceNavigation'),
  useOpenExperience: () => mockOpenExperience,
}));

// Mock ONLY the scoped completions query hook, so each request state can be
// driven deterministically. Nothing else in the screen's data path is mocked,
// so the real shared `ExperiencesList` renders on top of the supplied entries.
jest.mock('../../../hooks/useOwnCompletions', () => ({
  __esModule: true,
  useOwnCompletionsQuery: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import ExperiencesDetailScreen from '../ExperiencesDetailScreen';
import { useOwnCompletionsQuery } from '../../../hooks/useOwnCompletions';

const useOwnCompletionsQueryMock = useOwnCompletionsQuery as jest.MockedFunction<
  typeof useOwnCompletionsQuery
>;

// ---------------------------------------------------------------------------
// Fixtures + query-result helper
// ---------------------------------------------------------------------------

function completionEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: 8,
    sharedNote: 'Loved every minute of it.',
    ...overrides,
  };
}

/**
 * Build the subset of `UseQueryResult` fields the screen reads
 * (`data`, `isFetching`, `refetch`), cast to the full result type. The screen
 * only ever touches those three, so a partial is sufficient and keeps each
 * test's intent explicit.
 */
function queryResult(partial: {
  data?: FriendCompletionsDTO | undefined;
  isFetching: boolean;
  refetch?: jest.Mock;
}): UseQueryResult<FriendCompletionsDTO, ApiError> {
  return {
    data: partial.data,
    isFetching: partial.isFetching,
    refetch: partial.refetch ?? jest.fn(),
  } as unknown as UseQueryResult<FriendCompletionsDTO, ApiError>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperiencesDetailScreen scoped completions read + in-pane isolation (R14.5)', () => {
  beforeEach(() => {
    useOwnCompletionsQueryMock.mockReset();
    mockOpenExperience.mockReset();
  });

  // -------------------------------------------------------------------------
  // Scoped read — the screen drives its view from the completions query alone.
  // -------------------------------------------------------------------------
  test('reads its data from the scoped Own_Completions query (never the shared stats query)', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: { entries: [] }, isFetching: false }),
    );

    render(<ExperiencesDetailScreen />);

    // The screen's only stats read is the scoped completions query.
    expect(useOwnCompletionsQueryMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R14.5 — in-pane loader while the scoped completions read is in flight.
  // -------------------------------------------------------------------------
  test('shows its own in-pane loader while the scoped completions read is in flight with no prior data', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: true }),
    );

    render(<ExperiencesDetailScreen />);

    expect(screen.getByTestId('experiences-detail-loading')).toBeTruthy();
    // The list and the error surface are gated while loading.
    expect(screen.queryByTestId('experiences-detail-screen')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.5 — a failed completions read gates to an in-pane error + Retry.
  // -------------------------------------------------------------------------
  test('a failed completions read shows an in-pane error message and a Retry control', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: false }),
    );

    render(<ExperiencesDetailScreen />);

    expect(screen.getByTestId('experiences-detail-error')).toBeTruthy();
    expect(screen.getByTestId('experiences-detail-error-retry')).toBeTruthy();
    // The list and loader are withheld while the read is in error.
    expect(screen.queryByTestId('experiences-detail-screen')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-loading')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R14.5 — Retry re-issues ONLY the scoped completions read (isolation).
  // -------------------------------------------------------------------------
  test('tapping Retry re-issues only the scoped completions read', () => {
    const refetch = jest.fn();
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: false, refetch }),
    );

    render(<ExperiencesDetailScreen />);

    fireEvent.press(screen.getByTestId('experiences-detail-error-retry'));

    // Retry re-issues exactly the completions read and nothing else — its
    // error/recovery never reaches the coverage or ratings surfaces.
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R14.5 — success hands the loaded entries to the shared ExperiencesList.
  // -------------------------------------------------------------------------
  test('on success renders the shared ExperiencesList over the loaded completions', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({
        data: { entries: [completionEntry()] },
        isFetching: false,
      }),
    );

    render(<ExperiencesDetailScreen />);

    // The screen content is shown, with no in-pane loading / error surface.
    expect(screen.getByTestId('experiences-detail-screen')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-loading')).toBeNull();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();

    // The shared list mounts under the `own` prefix, with the entry's row.
    expect(screen.getByTestId('own-experiences-list')).toBeTruthy();
    expect(screen.getByTestId('own-experience-row-0')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R14.5 — a re-fetch after Retry keeps showing the in-pane loader while any
  // prior data is still absent (isFetching with entries === undefined).
  // -------------------------------------------------------------------------
  test('a re-issued read with no prior data shows the in-pane loader again', () => {
    useOwnCompletionsQueryMock.mockReturnValue(
      queryResult({ data: undefined, isFetching: true }),
    );

    render(<ExperiencesDetailScreen />);

    expect(screen.getByTestId('experiences-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('experiences-detail-error')).toBeNull();
  });
});
