// Feature: experience-detail-redesign, Task 21.3 — FloatingActionDock & PassportAndLoreLens tests
//
// Validates: Requirements 11.1, 11.5, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExperienceCategory } from '@dwt/shared';

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

import FloatingActionDock from '../FloatingActionDock';
import PassportAndLoreLens from '../PassportAndLoreLens';

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const emptyQuery = <T,>() => ({
  isLoading: false,
  isError: false,
  data: null as T | null,
});

describe('FloatingActionDock (Requirements 19.1 - 19.7)', () => {
  const mockHandlers = {
    onLogVisit: jest.fn(),
    onAddToPlan: jest.fn(),
    onRateMostRecent: jest.fn(),
    onLogDish: jest.fn(),
    onReserve: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('R19.2: Ride/Character_Meet/Show on Today lens renders Log visit & Add to trip', () => {
    const categories: ExperienceCategory[] = ['Ride', 'Character_Meet', 'Show'];

    for (const category of categories) {
      const { unmount } = render(
        <FloatingActionDock
          category={category}
          activeLens="today"
          {...mockHandlers}
        />,
      );

      const primary = screen.getByTestId('dock-primary-action');
      const secondary = screen.getByTestId('dock-secondary-action');

      expect(screen.getByText(/Log Visit/i)).toBeTruthy();
      expect(screen.getByText(/Add to Trip/i)).toBeTruthy();
      expect(primary.props.accessibilityLabel).toBeTruthy();
      expect(secondary.props.accessibilityLabel).toBeTruthy();

      fireEvent.press(primary);
      expect(mockHandlers.onLogVisit).toHaveBeenCalled();

      fireEvent.press(secondary);
      expect(mockHandlers.onAddToPlan).toHaveBeenCalled();

      unmount();
    }
  });

  test('R19.3: Ride/Character_Meet/Show on Passport lens renders Log visit & Add to trip', () => {
    render(
      <FloatingActionDock
        category="Ride"
        activeLens="passport"
        {...mockHandlers}
      />,
    );

    const primary = screen.getByTestId('dock-primary-action');
    const secondary = screen.getByTestId('dock-secondary-action');

    expect(screen.getByText(/Log Visit/i)).toBeTruthy();
    expect(screen.getByText(/Add to Trip/i)).toBeTruthy();
    expect(primary.props.accessibilityLabel).toBeTruthy();
    expect(secondary.props.accessibilityLabel).toBeTruthy();

    fireEvent.press(primary);
    expect(mockHandlers.onLogVisit).toHaveBeenCalledTimes(1);

    fireEvent.press(secondary);
    expect(mockHandlers.onAddToPlan).toHaveBeenCalledTimes(1);
  });

  test('R19.4: Restaurant on both Today and Passport lenses renders Log dish & Reserve table', () => {
    const lenses: Array<'today' | 'passport'> = ['today', 'passport'];

    for (const lens of lenses) {
      const { unmount } = render(
        <FloatingActionDock
          category="Restaurant"
          activeLens={lens}
          {...mockHandlers}
        />,
      );

      const primary = screen.getByTestId('dock-primary-action');
      const secondary = screen.getByTestId('dock-secondary-action');

      expect(screen.getByText(/Log (a )?dish/i)).toBeTruthy();
      expect(screen.getByText(/Reserve Table/i)).toBeTruthy();
      expect(primary.props.accessibilityLabel).toBeTruthy();
      expect(secondary.props.accessibilityLabel).toBeTruthy();

      fireEvent.press(primary);
      expect(mockHandlers.onLogDish).toHaveBeenCalled();

      fireEvent.press(secondary);
      expect(mockHandlers.onReserve).toHaveBeenCalled();

      unmount();
    }
  });

  test('R20.5: Resort renders Log Stay & Add to Trip', () => {
    render(
      <FloatingActionDock
        category="Resort"
        activeLens="today"
        {...mockHandlers}
      />,
    );

    const primary = screen.getByTestId('dock-primary-action');
    const secondary = screen.getByTestId('dock-secondary-action');

    expect(screen.getByText('Log Stay')).toBeTruthy();
    expect(screen.getByText('Add to Trip')).toBeTruthy();
    expect(primary.props.accessibilityLabel).toBe('Log Stay');
    expect(secondary.props.accessibilityLabel).toBe('Add to trip');

    fireEvent.press(primary);
    expect(mockHandlers.onLogVisit).toHaveBeenCalledTimes(1);

    fireEvent.press(secondary);
    expect(mockHandlers.onAddToPlan).toHaveBeenCalledTimes(1);
  });

  test('R21.3: Quick Service restaurant renders Log a Dish & Add to Trip', () => {
    render(
      <FloatingActionDock
        category="Restaurant"
        activeLens="today"
        isQuickService
        {...mockHandlers}
      />,
    );

    const primary = screen.getByTestId('dock-primary-action');
    const secondary = screen.getByTestId('dock-secondary-action');

    expect(screen.getByText('Log a Dish')).toBeTruthy();
    expect(screen.getByText('Add to Trip')).toBeTruthy();
    expect(primary.props.accessibilityLabel).toBe('Log a Dish');
    expect(secondary.props.accessibilityLabel).toBe('Add to trip');

    fireEvent.press(primary);
    expect(mockHandlers.onLogDish).toHaveBeenCalledTimes(1);

    fireEvent.press(secondary);
    expect(mockHandlers.onAddToPlan).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onReserve).not.toHaveBeenCalled();
  });
});

describe('PassportAndLoreLens composition (Requirements 11.1, 11.5)', () => {
  function orderOf(testID: string): number {
    return JSON.stringify(screen.toJSON()).indexOf(`"testID":"${testID}"`);
  }

  test('R11.1, R11.5: renders cards in specified order with Imagineers Insider Notes label for Restaurant', () => {
    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <PassportAndLoreLens
          experienceId={EXPERIENCE_ID}
          experienceName="Be Our Guest"
          category="Restaurant"
          description="A magnificent castle dining experience."
          whyThis={{
            title: 'Why visit',
            bullets: ['Dine in the Beast Ballroom', 'Sample the Grey Stuff'],
            quotes: [],
          }}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={emptyQuery()}
          aggregateQuery={emptyQuery()}
          remainingGroups={[
            {
              id: 'goodToKnow',
              label: 'Good to know',
              tags: [
                {
                  kind: 'interest',
                  label: 'Water Classic',
                  accessibilityLabel: 'Interest: Water Classic',
                },
              ],
            },
          ]}
        />
      </QueryClientProvider>,
    );

    // Verify Imagineer's Insider Notes label copy (R11.5)
    expect(screen.getByText("Imagineer's Insider Notes")).toBeTruthy();
    expect(screen.getByText('Dine in the Beast Ballroom')).toBeTruthy();
    expect(screen.getByText('Sample the Grey Stuff')).toBeTruthy();

    // Verify ordering: ParkPassportCard -> RestaurantDishLogCard -> AboutSection -> WhyThis -> CommunityRating -> TagGroups
    const passportOrder = orderOf('park-passport-card');
    const dishLogOrder = orderOf('restaurant-dish-log-card');
    const aboutOrder = orderOf('about-section');
    const whyThisOrder = orderOf('experience-why-this');
    const communityOrder = orderOf('community-rating-section');
    const tagGroupOrder = orderOf('experience-tag-group-goodToKnow');

    expect(passportOrder).toBeGreaterThan(-1);
    expect(dishLogOrder).toBeGreaterThan(passportOrder);
    expect(aboutOrder).toBeGreaterThan(dishLogOrder);
    expect(whyThisOrder).toBeGreaterThan(aboutOrder);
    expect(communityOrder).toBeGreaterThan(whyThisOrder);
    expect(tagGroupOrder).toBeGreaterThan(communityOrder);
  });

  test('R18.4: omits RestaurantDishLogCard when category is Ride', () => {
    const client = createQueryClient();

    render(
      <QueryClientProvider client={client}>
        <PassportAndLoreLens
          experienceId={EXPERIENCE_ID}
          experienceName="Space Mountain"
          category="Ride"
          description="High speed coaster in the dark."
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={emptyQuery()}
          aggregateQuery={emptyQuery()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('restaurant-dish-log-card')).toBeNull();
    expect(screen.getByTestId('park-passport-card')).toBeTruthy();
    expect(screen.getByTestId('about-section')).toBeTruthy();
    expect(screen.getByTestId('community-rating-section')).toBeTruthy();
  });
});
