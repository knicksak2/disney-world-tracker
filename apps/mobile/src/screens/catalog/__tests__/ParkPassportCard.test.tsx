// Feature: experience-detail-redesign, Task 20.3 — ParkPassportCard & RestaurantDishLogCard render tests
//
// Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 18.1, 18.2, 18.3, 18.4

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ExperienceLogDTO,
  ExperienceVisitHistoryDTO,
  FoodItemLogWithContextDTO,
  NoteDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import ParkPassportCard from '../ParkPassportCard';
import RestaurantDishLogCard from '../RestaurantDishLogCard';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';

interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

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

function createQueryClient(): {
  readonly client: QueryClient;
  readonly invalidateSpy: jest.SpiedFunction<QueryClient['invalidateQueries']>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
  return { client, invalidateSpy };
}

function makeLog(
  partial: Partial<ExperienceLogDTO> & { id: string; visitedOn: string },
): ExperienceLogDTO {
  return {
    id: partial.id,
    experienceId: EXPERIENCE_ID,
    userId: 'user-1',
    userTz: 'America/New_York',
    visitedOn: partial.visitedOn,
    rating: partial.rating ?? null,
    note: partial.note ?? null,
    loggedAt: partial.loggedAt ?? '2026-05-01T12:00:00Z',
  };
}

describe('ParkPassportCard (Requirements 17.1 - 17.8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R17.7: renders empty state when zero visit logs exist', () => {
    const { client } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 0,
      logs: [],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('passport-empty-state')).toBeTruthy();
    expect(
      screen.getByText('No visits logged yet. Log your first visit to start your passport!'),
    ).toBeTruthy();
    expect(screen.queryByTestId('passport-average-rating')).toBeNull();
  });

  test('R17.2, R17.3: displays visit count and average rating when ratings exist; omits average when none rated', () => {
    const { client } = createQueryClient();
    const historyWithRatings: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 3,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-05-01',
          rating: 8,
          note: 'Great ride',
        }),
        makeLog({
          id: 'log-2',
          visitedOn: '2026-05-02',
          rating: 9,
          note: null,
        }),
        makeLog({
          id: 'log-3',
          visitedOn: '2026-05-03',
          rating: null,
          note: 'No rating given',
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(historyWithRatings)}
        />
      </QueryClientProvider>,
    );

    // Mean of [8, 9] is 8.5
    expect(screen.getByTestId('passport-visit-count')).toBeTruthy();
    expect(screen.getByText('3 visits')).toBeTruthy();
    const avgElement = screen.getByTestId('passport-average-rating');
    expect(avgElement).toBeTruthy();
    expect(screen.getByText('8.5 / 10')).toBeTruthy();
  });

  test('R17.3: omits passport average rating when all logs have null rating', () => {
    const { client } = createQueryClient();
    const historyNoRatings: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 2,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-05-01',
          rating: null,
          note: 'First time',
        }),
        makeLog({
          id: 'log-2',
          visitedOn: '2026-05-02',
          rating: null,
          note: null,
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(historyNoRatings)}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('2 visits')).toBeTruthy();
    expect(screen.queryByTestId('passport-average-rating')).toBeNull();
  });

  test('R17.4: expands visit history timeline and shows details per entry', () => {
    const { client } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 1,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-05-01',
          rating: 10,
          note: 'Favorite ride ever!',
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('visit-history-item-log-1')).toBeNull();

    // Expand timeline
    fireEvent.press(screen.getByTestId('visit-history-toggle'));

    expect(screen.getByTestId('visit-history-item-log-1')).toBeTruthy();
    expect(screen.getByText('2026-05-01')).toBeTruthy();
    expect(screen.getByText('10 / 10')).toBeTruthy();
    expect(screen.getByText('Favorite ride ever!')).toBeTruthy();
  });

  test('R17.5: editing an entry rating recomputes header average and invalidates experience-rating and aggregate', async () => {
    const { client, invalidateSpy } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 2,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-05-01',
          rating: 6,
          note: null,
        }),
        makeLog({
          id: 'log-2',
          visitedOn: '2026-05-02',
          rating: 8,
          note: null,
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    // Initial average of [6, 8] = 7.0
    expect(screen.getByText('7.0 / 10')).toBeTruthy();

    // Expand timeline
    fireEvent.press(screen.getByTestId('visit-history-toggle'));

    // Open rating picker on log-1
    fireEvent.press(screen.getByTestId('edit-rating-btn-log-1'));

    // Change rating to 10
    fireEvent.press(screen.getByTestId('rating-picker-option-log-1-10'));

    // Post-edit average of [10, 8] = 9.0
    await waitFor(() => {
      expect(screen.getByText('9.0 / 10')).toBeTruthy();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-rating', EXPERIENCE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-aggregate', EXPERIENCE_ID],
    });
  });

  test('R17.6: deleting a visit removes entry, recomputes count and average, and fires all 5 invalidations', async () => {
    const { client, invalidateSpy } = createQueryClient();
    apiRequestMock.mockResolvedValueOnce(null);

    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 2,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-05-01',
          rating: 6,
          note: null,
        }),
        makeLog({
          id: 'log-2',
          visitedOn: '2026-05-02',
          rating: 10,
          note: null,
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    // Initial average of [6, 10] = 8.0
    expect(screen.getByText('8.0 / 10')).toBeTruthy();
    expect(screen.getByText('2 visits')).toBeTruthy();

    // Expand timeline
    fireEvent.press(screen.getByTestId('visit-history-toggle'));

    // Delete log-1
    fireEvent.press(screen.getByTestId('visit-history-delete-log-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/me/experiences/${encodeURIComponent(EXPERIENCE_ID)}/logs/log-1`,
      );
    });

    // After deleting log-1, only log-2 (rating 10) remains
    await waitFor(() => {
      expect(screen.getByText('1 visit')).toBeTruthy();
      expect(screen.getByText('10.0 / 10')).toBeTruthy();
      expect(screen.queryByTestId('visit-history-item-log-1')).toBeNull();
      expect(screen.getByTestId('visit-history-item-log-2')).toBeTruthy();
    });

    // Invalidation checks
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-logs', EXPERIENCE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-completion', EXPERIENCE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-rating', EXPERIENCE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['experience-aggregate', EXPERIENCE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me-stats'] });
  });

  test('R17.8: preserves completion, rating, and note control errors and loading states independently', () => {
    const { client } = createQueryClient();
    const errorQuery: QueryLike<null> = {
      isLoading: false,
      isError: true,
      data: null,
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={errorQuery}
          ratingQuery={errorQuery}
          noteQuery={errorQuery}
          logsQuery={emptyQuery()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Could not load completion.')).toBeTruthy();
    expect(screen.getByText('Could not load rating.')).toBeTruthy();
    expect(screen.getByText('Could not load note.')).toBeTruthy();
  });

  test('R17.2, R17.4: renders header title and badge ribbon, and renders visit note inline with quotes', () => {
    const { client } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 1,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-09-25',
          rating: 9,
          note: 'Very nice',
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    // Header title and ribbon
    expect(screen.getByText('Park Passport & Journal')).toBeTruthy();
    expect(screen.getByText('Completed • 1 Visit • ★ 9.0 Avg')).toBeTruthy();

    // Expand timeline to verify note rendering
    fireEvent.press(screen.getByTestId('visit-history-toggle'));
    expect(screen.getByText('Very nice')).toBeTruthy();
  });

  test('R17.11: renders empty tip prompt and "+ Add Tip" when no note exists, and opens "Add Tip for Friends" modal', () => {
    const { client } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 1,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-09-25',
          rating: 8,
          note: null,
        }),
      ],
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    // Assert placeholder quote does NOT exist
    expect(screen.queryByText(/Captain Jack/i)).toBeNull();

    // Assert empty tip prompt renders
    expect(screen.getByTestId('passport-tip-empty')).toBeTruthy();
    expect(
      screen.getByText('No shared tip yet. Add advice to share with friends!'),
    ).toBeTruthy();

    // Button label is "+ Add Tip"
    const addTipBtn = screen.getByTestId('edit-tip-button');
    expect(screen.getByText('+ Add Tip')).toBeTruthy();

    // Tapping button opens modal with title "Add Tip for Friends"
    fireEvent.press(addTipBtn);
    expect(screen.getByText('Add Tip for Friends')).toBeTruthy();
  });

  test('R17.11: renders authentic tip and "✏ Edit Tip" when note exists, and opens "Edit Tip for Friends" modal', () => {
    const { client } = createQueryClient();
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 1,
      logs: [
        makeLog({
          id: 'log-1',
          visitedOn: '2026-09-25',
          rating: 9,
          note: null,
        }),
      ],
    };
    const noteData: NoteDTO = {
      experienceId: EXPERIENCE_ID,
      userId: 'user-1',
      body: 'Get a Dole Whip right before fireworks!',
      shareable: true,
      updatedAt: '2026-09-25T10:00:00Z',
    };

    render(
      <QueryClientProvider client={client}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={dataQuery(noteData)}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    // Assert authentic tip renders
    expect(screen.getByTestId('passport-tip-quote')).toBeTruthy();
    expect(
      screen.getByText('“Get a Dole Whip right before fireworks!”'),
    ).toBeTruthy();

    // Button label is "✏ Edit Tip"
    const editTipBtn = screen.getByTestId('edit-tip-button');
    expect(screen.getByText('✏ Edit Tip')).toBeTruthy();

    // Tapping button opens modal with title "Edit Tip for Friends"
    fireEvent.press(editTipBtn);
    expect(screen.getByText('Edit Tip for Friends')).toBeTruthy();
  });
});

describe('RestaurantDishLogCard (Requirements 18.1 - 18.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R18.4: omits RestaurantDishLogCard when category is not Restaurant', () => {
    const { client } = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <RestaurantDishLogCard
          experienceId={EXPERIENCE_ID}
          category="Ride"
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('restaurant-dish-log-card')).toBeNull();
  });

  test('R18.3: renders empty state when Restaurant has zero logged food items', async () => {
    const { client } = createQueryClient();
    apiRequestMock.mockResolvedValueOnce([]);

    render(
      <QueryClientProvider client={client}>
        <RestaurantDishLogCard
          experienceId={EXPERIENCE_ID}
          category="Restaurant"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-log-empty-state')).toBeTruthy();
      expect(
        screen.getByText('No dishes logged yet. Log a dish to keep track of what you ate!'),
      ).toBeTruthy();
    });
  });

  test('R18.1, R18.2: renders logged items count, item details, and action buttons', async () => {
    const { client } = createQueryClient();
    const dishLogs: FoodItemLogWithContextDTO[] = [
      {
        id: 'dish-1',
        userId: 'user-1',
        foodItemId: 'item-1',
        foodItemName: 'Grey Stuff',
        visitedOn: '2026-05-01',
        userTz: 'America/New_York',
        loggedAt: '2026-05-01T12:00:00Z',
        rating: 9,
        note: 'Delicious!',
        currentlyOnMenu: true,
        restaurantName: 'Be Our Guest',
        locationName: null,
      },
      {
        id: 'dish-2',
        userId: 'user-1',
        foodItemId: 'item-2',
        foodItemName: 'French Onion Soup',
        visitedOn: '2026-05-01',
        userTz: 'America/New_York',
        loggedAt: '2026-05-01T12:00:00Z',
        rating: null,
        note: null,
        currentlyOnMenu: true,
        restaurantName: 'Be Our Guest',
        locationName: null,
      },
    ];

    apiRequestMock.mockResolvedValueOnce(dishLogs);

    const onLogFoodItem = jest.fn();
    const onMyLoggedItems = jest.fn();
    const onAddToList = jest.fn();

    render(
      <QueryClientProvider client={client}>
        <RestaurantDishLogCard
          experienceId={EXPERIENCE_ID}
          experienceName="Be Our Guest"
          category="Restaurant"
          onLogFoodItem={onLogFoodItem}
          onMyLoggedItems={onMyLoggedItems}
          onAddToList={onAddToList}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-log-count')).toBeTruthy();
      expect(screen.getByText('2 dishes logged')).toBeTruthy();
    });

    expect(screen.getByText('Grey Stuff')).toBeTruthy();
    expect(screen.getByText('9 / 10')).toBeTruthy();
    expect(screen.getByText('Delicious!')).toBeTruthy();

    expect(screen.getByText('French Onion Soup')).toBeTruthy();

    // Test button presses
    fireEvent.press(screen.getByTestId('experience-log-food-item-btn'));
    expect(onLogFoodItem).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('experience-my-logged-items-btn'));
    expect(onMyLoggedItems).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('experience-add-to-list-btn'));
    expect(onAddToList).toHaveBeenCalledTimes(1);
  });
});
