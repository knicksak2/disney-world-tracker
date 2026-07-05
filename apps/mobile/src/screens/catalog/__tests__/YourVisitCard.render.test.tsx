// Feature: experience-detail-redesign, Task 4.2 — YourVisitCard render tests
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
//
// These example-based render tests pin the composition contract of the
// consolidated "Your visit" card. They assert:
//   - Fixed vertical control order completion -> rating -> note (R6.1).
//   - Each control's loading / error / empty state renders independently of
//     the other two (R6.5, R6.7), and `isError` takes precedence over the
//     loading indicator per control (R6.6).
//   - Activating a control fires the EXACT query invalidations the redesign
//     must preserve (R6.2, R6.3, R6.4):
//       * completion -> ['experience-completion', id] + ['me-stats']
//       * rating     -> ['experience-rating', id] + ['experience-aggregate', id]
//       * note       -> ['experience-note', id]
//   - An in-progress mutation disables its own control while leaving the other
//     two interactive (R6.9).
//   - The preserved per-control accessibility labels remain reachable (R6.8),
//     including the loading spinners' "Loading completion / rating / note".
//
// The tests wrap the card in a real `QueryClientProvider` and spy on the
// provided client's `invalidateQueries`, so the assertions run against the
// component's actual `useQueryClient()` wiring rather than a stand-in.

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { CompletionDTO, NoteDTO, RatingDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

// The three controls import `apiRequest` for their mutation handlers. The
// render-only assertions never touch it; the mutation-wiring assertions
// override its resolved value per test.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
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
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import YourVisitCard from '../YourVisitCard';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';

interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

const loadingQuery = <T,>(): QueryLike<T> => ({
  isLoading: true,
  isError: false,
  data: undefined,
});

const errorQuery = <T,>(): QueryLike<T> => ({
  isLoading: false,
  isError: true,
  data: undefined,
});

// A settled query with no stored value drives the empty state.
const emptyQuery = <T,>(): QueryLike<T | null> => ({
  isLoading: false,
  isError: false,
  data: null,
});

const dataQuery = <T,>(data: T): QueryLike<T> => ({
  isLoading: false,
  isError: false,
  data,
});

function makeCompletion(): CompletionDTO {
  return {
    userId: 'user-1',
    experienceId: EXPERIENCE_ID,
    completedOn: '2024-06-01',
    userTz: 'America/New_York',
  };
}

function makeRating(): RatingDTO {
  return {
    experienceId: EXPERIENCE_ID,
    value: 7,
    updatedAt: '2024-06-01T12:00:00.000Z',
  } as RatingDTO;
}

function makeNote(): NoteDTO {
  return {
    userId: 'user-1',
    experienceId: EXPERIENCE_ID,
    body: 'A lovely ride.',
    shareable: false,
    updatedAt: '2024-06-01T12:00:00.000Z',
  };
}

interface RenderOptions {
  readonly completionQuery?: QueryLike<CompletionDTO | null>;
  readonly ratingQuery?: QueryLike<RatingDTO | null>;
  readonly noteQuery?: QueryLike<NoteDTO | null>;
}

function renderCard(options: RenderOptions = {}): {
  readonly client: QueryClient;
  readonly invalidateSpy: jest.SpiedFunction<QueryClient['invalidateQueries']>;
  readonly view: ReturnType<typeof render>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

  const view = render(
    <QueryClientProvider client={client}>
      <YourVisitCard
        experienceId={EXPERIENCE_ID}
        completionQuery={options.completionQuery ?? emptyQuery()}
        ratingQuery={options.ratingQuery ?? emptyQuery()}
        noteQuery={options.noteQuery ?? emptyQuery()}
      />
    </QueryClientProvider>,
  );

  return { client, invalidateSpy, view };
}

/**
 * Depth-first collection of every `testID` in render order. Used to assert the
 * fixed top-to-bottom control order without depending on layout geometry.
 */
function collectTestIDs(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined) return acc;
  if (Array.isArray(node)) {
    for (const child of node) collectTestIDs(child, acc);
    return acc;
  }
  if (typeof node === 'object') {
    const n = node as {
      props?: { testID?: unknown };
      children?: unknown;
    };
    const testID = n.props?.testID;
    if (typeof testID === 'string') acc.push(testID);
    if (n.children !== undefined) collectTestIDs(n.children, acc);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('YourVisitCard render (R6.1–R6.10)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // R6.1 — fixed control order completion -> rating -> note
  // -------------------------------------------------------------------------

  test('renders the three controls in the fixed order completion -> rating -> note (R6.1)', () => {
    const { view } = renderCard({
      completionQuery: emptyQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    // Card wrapper is present.
    expect(screen.getByTestId('your-visit-card')).not.toBeNull();

    const ids = collectTestIDs(view.toJSON());
    const completionIdx = ids.indexOf('completion-controls');
    const ratingIdx = ids.indexOf('rating-control');
    const noteIdx = ids.indexOf('note-empty');

    expect(completionIdx).toBeGreaterThanOrEqual(0);
    expect(ratingIdx).toBeGreaterThan(completionIdx);
    expect(noteIdx).toBeGreaterThan(ratingIdx);
  });

  // -------------------------------------------------------------------------
  // R6.5 / R6.7 — per-control loading / empty independence
  // -------------------------------------------------------------------------

  test('each control renders its loading indicator independently of the other two (R6.5)', () => {
    // Only completion is loading; rating + note are settled-empty.
    renderCard({
      completionQuery: loadingQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    expect(screen.getByLabelText('Loading completion')).not.toBeNull();
    // Rating and note render their empty states, not spinners.
    expect(screen.queryByLabelText('Loading rating')).toBeNull();
    expect(screen.queryByLabelText('Loading note')).toBeNull();
    expect(screen.getByTestId('rating-empty')).not.toBeNull();
    expect(screen.getByTestId('note-empty')).not.toBeNull();
  });

  test('a single loading control does not force the siblings to load (rating loading only) (R6.5)', () => {
    renderCard({
      completionQuery: emptyQuery(),
      ratingQuery: loadingQuery(),
      noteQuery: emptyQuery(),
    });

    expect(screen.getByLabelText('Loading rating')).not.toBeNull();
    expect(screen.queryByLabelText('Loading completion')).toBeNull();
    expect(screen.queryByLabelText('Loading note')).toBeNull();
    expect(screen.getByTestId('completion-empty-status')).not.toBeNull();
    expect(screen.getByTestId('note-empty')).not.toBeNull();
  });

  test('note loading alone leaves completion and rating in their settled states (R6.5)', () => {
    renderCard({
      completionQuery: dataQuery(makeCompletion()),
      ratingQuery: dataQuery(makeRating()),
      noteQuery: loadingQuery(),
    });

    expect(screen.getByLabelText('Loading note')).not.toBeNull();
    // Completion populated, rating populated, note spinner.
    expect(screen.getByTestId('completion-date')).not.toBeNull();
    expect(screen.getByTestId('rating-value')).not.toBeNull();
    expect(screen.queryByTestId('note-empty')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R6.6 — error state and its precedence over loading
  // -------------------------------------------------------------------------

  test('each control renders its own error text independently (R6.6)', () => {
    renderCard({
      completionQuery: errorQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    expect(screen.getByText('Could not load completion.')).not.toBeNull();
    // Siblings are unaffected and render their empty states.
    expect(screen.getByTestId('rating-empty')).not.toBeNull();
    expect(screen.getByTestId('note-empty')).not.toBeNull();
    expect(screen.queryByText('Could not load rating.')).toBeNull();
    expect(screen.queryByText('Could not load note.')).toBeNull();
  });

  test('isError takes precedence over isLoading for the same control (R6.6)', () => {
    // All three are simultaneously loading AND in error — error must win.
    renderCard({
      completionQuery: { isLoading: true, isError: true, data: undefined },
      ratingQuery: { isLoading: true, isError: true, data: undefined },
      noteQuery: { isLoading: true, isError: true, data: undefined },
    });

    expect(screen.getByText('Could not load completion.')).not.toBeNull();
    expect(screen.getByText('Could not load rating.')).not.toBeNull();
    expect(screen.getByText('Could not load note.')).not.toBeNull();

    // No loading spinner should be shown when the control is in error.
    expect(screen.queryByLabelText('Loading completion')).toBeNull();
    expect(screen.queryByLabelText('Loading rating')).toBeNull();
    expect(screen.queryByLabelText('Loading note')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R6.7 — empty state affordances
  // -------------------------------------------------------------------------

  test('all three controls render their empty-state affordances when settled with no value (R6.7)', () => {
    renderCard({
      completionQuery: emptyQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    expect(screen.getByTestId('completion-empty-status')).not.toBeNull();
    expect(screen.getByTestId('completion-mark-button')).not.toBeNull();
    expect(screen.getByTestId('rating-empty')).not.toBeNull();
    expect(screen.getByTestId('rating-open')).not.toBeNull();
    expect(screen.getByTestId('note-empty')).not.toBeNull();
    expect(screen.getByTestId('note-add')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // R6.8 — preserved accessibility labels
  // -------------------------------------------------------------------------

  test('preserves the per-control accessibility labels (R6.8)', () => {
    renderCard({
      completionQuery: emptyQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    // Reused controls keep their own spoken labels.
    expect(screen.getByLabelText('Mark as visited')).not.toBeNull();
    expect(screen.getByLabelText('Rate this experience')).not.toBeNull();
  });

  test('loading spinners keep their distinct accessibility labels (R6.8)', () => {
    renderCard({
      completionQuery: loadingQuery(),
      ratingQuery: loadingQuery(),
      noteQuery: loadingQuery(),
    });

    expect(screen.getByLabelText('Loading completion')).not.toBeNull();
    expect(screen.getByLabelText('Loading rating')).not.toBeNull();
    expect(screen.getByLabelText('Loading note')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // R6.2 — completion invalidations
  // -------------------------------------------------------------------------

  test('marking completion invalidates ["experience-completion", id] and ["me-stats"] (R6.2)', async () => {
    apiRequestMock.mockResolvedValueOnce(makeCompletion());
    const { invalidateSpy } = renderCard({ completionQuery: emptyQuery() });

    fireEvent.press(screen.getByTestId('completion-mark-button'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-completion', EXPERIENCE_ID],
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me-stats'] });
  });

  // -------------------------------------------------------------------------
  // R6.3 — rating invalidations
  // -------------------------------------------------------------------------

  test('setting a rating invalidates ["experience-rating", id] and ["experience-aggregate", id] (R6.3)', async () => {
    apiRequestMock.mockResolvedValueOnce({
      experienceId: EXPERIENCE_ID,
      value: 7,
      updatedAt: '2024-06-01T12:00:00.000Z',
    });
    const { invalidateSpy } = renderCard({ ratingQuery: emptyQuery() });

    // Open the picker, then choose a value.
    fireEvent.press(screen.getByTestId('rating-open'));
    fireEvent.press(screen.getByTestId('rating-pick-7'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-rating', EXPERIENCE_ID],
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-aggregate', EXPERIENCE_ID],
    });
  });

  // -------------------------------------------------------------------------
  // R6.4 — note invalidation
  // -------------------------------------------------------------------------

  test('saving a note invalidates ["experience-note", id] (R6.4)', async () => {
    apiRequestMock.mockResolvedValueOnce(makeNote());
    const { invalidateSpy } = renderCard({ noteQuery: emptyQuery() });

    fireEvent.press(screen.getByTestId('note-add'));
    fireEvent.changeText(screen.getByTestId('note-input'), 'A lovely ride.');
    fireEvent.press(screen.getByTestId('note-save'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-note', EXPERIENCE_ID],
      });
    });
  });

  // -------------------------------------------------------------------------
  // R6.9 — in-progress mutation disables only its own control
  // -------------------------------------------------------------------------

  test('an in-progress completion mutation disables only the completion control (R6.9)', async () => {
    // Never-resolving request keeps the completion control busy.
    apiRequestMock.mockImplementation(
      () => new Promise(() => {}) as ReturnType<typeof mockedApiRequest>,
    );
    renderCard({
      completionQuery: emptyQuery(),
      ratingQuery: emptyQuery(),
      noteQuery: emptyQuery(),
    });

    fireEvent.press(screen.getByTestId('completion-mark-button'));

    await waitFor(() => {
      expect(screen.getByTestId('completion-mark-button')).toBeDisabled();
    });
    // The other two controls remain interactive.
    expect(screen.getByTestId('rating-open')).toBeEnabled();
    expect(screen.getByTestId('note-add')).toBeEnabled();
  });
});
