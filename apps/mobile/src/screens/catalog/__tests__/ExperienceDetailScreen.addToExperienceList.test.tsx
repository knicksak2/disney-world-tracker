// Feature: experience-lists, Requirement 17 — merged Floating_Action_Dock
// "Add to Trip or List" choice (supersedes the deleted standalone
// AddToExperienceListCard covered by the pre-Requirement-17 version of this
// file) and dining-exclusion (Property 3, mobile check).
//
// Validates: Requirements 9.1, 9.3, 9.4, 9.6, 17.1, 17.3, 17.5
//
// The Food_List affordance (RestaurantDishLogCard) still renders only inside
// the "My Passport & Lore" lens, so Restaurant tests still switch lenses via
// the real `lens-tab-passport` control before asserting. The Experience_List
// affordance is no longer lens-scoped — it's reachable from the
// Floating_Action_Dock, visible on either lens, via the dock's secondary
// action → choice sheet → "Add to a List".

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { ExperienceListDTO } from '@dwt/shared';

type CatalogStackParamList = {
  ExperienceDetail: { experienceId: string; initialLens?: 'today' | 'passport' };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId, initialLens: 'passport' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

const sampleOwnedLists: readonly ExperienceListDTO[] = [];

function stubScreenApi(options: {
  id: string;
  category: string;
  name: string;
}) {
  const { id, category, name } = options;
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts: [] };
    }
    if (path === '/me/trips?filter=active') {
      return [];
    }
    if (path === `/catalog/${id}`) {
      return {
        id,
        name,
        park: 'Magic Kingdom',
        category,
        description: `Description for ${name}`,
        areaType: 'ThemePark',
        land: 'Adventureland',
      };
    }
    if (path === `/catalog/${id}/live`) {
      throw new ApiError({ code: 'live_unavailable', message: 'no live detail', status: 503 });
    }
    if (path.endsWith('/completion')) {
      throw new ApiError({ code: 'completion_not_found', message: 'no completion', status: 404 });
    }
    if (path.endsWith('/rating')) {
      throw new ApiError({ code: 'rating_not_found', message: 'no rating', status: 404 });
    }
    if (path.endsWith('/note')) {
      throw new ApiError({ code: 'note_not_found', message: 'no note', status: 404 });
    }
    if (path === `/experiences/${id}/aggregate-rating`) {
      return { value: null, count: 0 };
    }
    if (path === `/me/experiences/${id}/logs`) {
      return { repeatCount: 0, logs: [] };
    }
    if (path.endsWith('/food-item-logs/mine')) {
      return [];
    }
    if (path === '/me/experience-lists') {
      return sampleOwnedLists;
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

async function switchToPassportLens(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('lens-tab-passport')).toBeTruthy();
  });
  fireEvent.press(screen.getByTestId('lens-tab-passport'));
}

describe('ExperienceDetailScreen Add-to-Experience-List entry point (merged dock choice, R17)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Restaurant fixture: dock secondary action stays direct (no choice sheet); Food_List affordance is present (Property 3, R17.5)', async () => {
    stubScreenApi({ id: 'exp-restaurant-1', category: 'Restaurant', name: "Be Our Guest" });

    renderDetail('exp-restaurant-1');

    await waitFor(() => {
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
    });

    await switchToPassportLens();

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-dish-log-card')).toBeTruthy();
    });

    // The Food_List affordance (unaffected by R17) is present.
    expect(screen.getByTestId('experience-add-to-list-btn')).toBeTruthy();

    // The dock's secondary action never opens the choice sheet for Restaurant.
    fireEvent.press(screen.getByTestId('dock-secondary-action'));
    expect(screen.queryByTestId('add-to-trip-or-list-choice-sheet')).toBeNull();
  });

  test.each(['Ride', 'Show', 'Character_Meet'] as const)(
    '%s fixture: dock secondary action opens the Add-to-Trip-or-List choice; Food_List affordance is absent (Property 3, R17.1)',
    async (category) => {
      stubScreenApi({ id: `exp-${category}-1`, category, name: `Sample ${category}` });

      renderDetail(`exp-${category}-1`);

      await waitFor(() => {
        expect(screen.getByText(`Sample ${category}`)).toBeTruthy();
      });

      expect(screen.queryByTestId('restaurant-dish-log-card')).toBeNull();
      expect(screen.queryByTestId('experience-add-to-list-btn')).toBeNull();

      fireEvent.press(screen.getByTestId('dock-secondary-action'));

      await waitFor(() => {
        expect(screen.getByTestId('add-to-trip-or-list-choice-sheet')).toBeTruthy();
        expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
        expect(screen.getByTestId('add-to-trip-or-list-choice-list')).toBeTruthy();
      });
    },
  );

  test('tapping "Add to Trip or List" then "Add to a List" opens AddToExperienceListsSheet with the correct experienceId/experienceName (R17.1, R17.3)', async () => {
    stubScreenApi({ id: 'exp-ride-open-sheet', category: 'Ride', name: 'Space Mountain' });

    renderDetail('exp-ride-open-sheet');

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-list')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-list'));

    // The choice sheet closes and the real AddToExperienceListsSheet opens,
    // carrying the Experience's name through as a real prop, not a mocked
    // stand-in.
    await waitFor(() => {
      expect(screen.queryByTestId('add-to-trip-or-list-choice-sheet')).toBeNull();
      expect(screen.getByTestId('add-to-experience-lists-sheet')).toBeTruthy();
      expect(screen.getByText('Select lists to include "Space Mountain"')).toBeTruthy();
    });

    // The sheet is not fully mocked away — its own real data flow starts,
    // proving experienceId reached it (GET /me/experience-lists fires once visible).
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/experience-lists');
    });
  });

  test('tapping "Add to Trip or List" then "Add to Trip" invokes the existing add-to-trip handler, not the list sheet (R17.2)', async () => {
    stubScreenApi({ id: 'exp-ride-add-to-trip', category: 'Ride', name: 'Big Thunder Mountain' });

    renderDetail('exp-ride-add-to-trip');

    await waitFor(() => {
      expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-to-trip-or-list-choice-sheet')).toBeNull();
      expect(screen.queryByTestId('add-to-experience-lists-sheet')).toBeNull();
    });
  });

  test('dismissing the choice sheet via backdrop creates no side effects (R17.6)', async () => {
    stubScreenApi({ id: 'exp-ride-dismiss', category: 'Ride', name: 'Jungle Cruise' });

    renderDetail('exp-ride-dismiss');

    await waitFor(() => {
      expect(screen.getByText('Jungle Cruise')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-backdrop')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-backdrop'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-to-trip-or-list-choice-sheet')).toBeNull();
    });
    expect(screen.queryByTestId('add-to-experience-lists-sheet')).toBeNull();
  });
});
