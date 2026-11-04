// Feature: unified-experience-logging, Task 7.4 — Entry-point smoke tests
//
// Validates: Requirements 1.1, 13.3
//
// One render test per entry point that opens LogVisitModal / LogExperienceSheet:
// 1. YourVisitCard
// 2. ParkPassportCard
// 3. ExperienceDetailScreen
// 4. LiveWaitsScreen
// 5. ExperienceListDetailScreen
// 6. MagicFab
// 7. HomeScreen
//
// Asserts the sheet opens and submit posts to /me/experiences/:id/logs.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ExperienceDTO,
  ExperienceVisitHistoryDTO,
  ParkLiveSnapshotDTO,
} from '@dwt/shared';
import type { MainTabParamList } from '../../../navigation/RootNavigator';

const Tab = createBottomTabNavigator<MainTabParamList>();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => () => {}),
      isFocused: jest.fn(() => true),
    }),
    useRoute: () => ({
      params: mockRouteParams,
    }),
    useFocusEffect: jest.fn((callback) => callback()),
    useIsFocused: jest.fn(() => true),
  };
});

jest.mock('react-native-draggable-flatlist', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  function NestableScrollContainerMock({ children }: { children: React.ReactNode }) {
    return ReactActual.createElement(ViewActual, null, children);
  }
  function NestableDraggableFlatListMock({
    data,
    renderItem,
    keyExtractor,
  }: {
    readonly data: readonly unknown[];
    readonly renderItem: (params: {
      item: unknown;
      getIndex: () => number | undefined;
      drag: () => void;
      isActive: boolean;
    }) => React.ReactNode;
    readonly keyExtractor: (item: unknown, index: number) => string;
  }) {
    return ReactActual.createElement(
      ViewActual,
      null,
      data.map((item, index) =>
        ReactActual.createElement(
          ViewActual,
          { key: keyExtractor(item, index) },
          renderItem({ item, getIndex: () => index, drag: () => {}, isActive: false }),
        ),
      ),
    );
  }
  return {
    __esModule: true,
    NestableScrollContainer: NestableScrollContainerMock,
    NestableDraggableFlatList: NestableDraggableFlatListMock,
  };
});

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

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

import { apiRequest as mockedApiRequest } from '../../../api/client';
import YourVisitCard from '../../catalog/YourVisitCard';
import ParkPassportCard from '../../catalog/ParkPassportCard';
import ExperienceDetailScreen from '../../catalog/ExperienceDetailScreen';
import LiveWaitsScreen from '../../liveWaits/LiveWaitsScreen';
import ExperienceListDetailScreen from '../../experienceLists/ExperienceListDetailScreen';
import { MagicFab } from '../../quickAction/MagicFab';
import HomeScreen from '../../home/HomeScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';

const sampleExp: ExperienceDTO = {
  id: EXPERIENCE_ID,
  name: 'Space Mountain',
  category: 'Ride',
  park: 'Magic Kingdom',
  land: 'Tomorrowland',
  description: 'High-speed coaster in space',
  active: true,
  imageUrl: null,
  areaType: 'ThemePark',
};

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

const dataQuery = <T,>(data: T) => ({
  isLoading: false,
  isError: false,
  data,
});

describe('Entry-point smoke tests (Requirements 1.1, 13.3)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    queryClient = createQueryClient();

    apiRequestMock.mockImplementation(async (method, path, _body) => {
      if (method === 'GET' && path === '/me/trips') return [];
      if (method === 'GET' && path === '/me') return { user: { id: 'user-me' } };
      if (method === 'GET' && typeof path === 'string' && path.startsWith('/catalog')) {
        return {
          experiences: [sampleExp],
          ...sampleExp,
        };
      }
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-1',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('1. YourVisitCard: activates sheet and submits to /me/experiences/:id/logs', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <YourVisitCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery<ExperienceVisitHistoryDTO>({
            experienceId: EXPERIENCE_ID,
            repeatCount: 0,
            logs: [],
          })}
        />
      </QueryClientProvider>,
    );

    const logBtn = await screen.findByTestId('log-visit-button');
    fireEvent.press(logBtn);

    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('2. ParkPassportCard: activates sheet and submits to /me/experiences/:id/logs', async () => {
    const history: ExperienceVisitHistoryDTO = {
      experienceId: EXPERIENCE_ID,
      repeatCount: 1,
      logs: [
        {
          id: 'prev-log-1',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          userTz: 'America/New_York',
          visitedOn: '2026-05-01',
          rating: 8,
          note: null,
          loggedAt: '2026-05-01T12:00:00Z',
        },
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && typeof path === 'string' && path.includes('visit-summary')) {
        return {
          [EXPERIENCE_ID]: { repeatCount: 1, ratedCount: 1, averageRating: 8 },
        };
      }
      if (method === 'GET' && path === '/me/trips') return [];
      if (method === 'GET' && path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-2',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ParkPassportCard
          experienceId={EXPERIENCE_ID}
          completionQuery={emptyQuery()}
          ratingQuery={emptyQuery()}
          noteQuery={emptyQuery()}
          logsQuery={dataQuery(history)}
        />
      </QueryClientProvider>,
    );

    const logBtn = await screen.findByTestId('log-visit-button');
    fireEvent.press(logBtn);

    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('3. ExperienceDetailScreen: dock primary action activates sheet and submits to /me/experiences/:id/logs', async () => {
    mockRouteParams = { experienceId: EXPERIENCE_ID, initialLens: 'today' };

    const detail: ExperienceDTO = {
      id: EXPERIENCE_ID,
      name: 'Space Mountain',
      category: 'Ride',
      park: 'Magic Kingdom',
      land: 'Tomorrowland',
      description: 'High-speed coaster in space',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) return detail;
      if (path === `/me/experiences/${EXPERIENCE_ID}/completion`) return null;
      if (path === `/me/experiences/${EXPERIENCE_ID}/rating`) return null;
      if (path === `/me/experiences/${EXPERIENCE_ID}/note`) return null;
      if (path === `/experiences/${EXPERIENCE_ID}/aggregate-rating`) {
        return { value: 8.5, count: 12 };
      }
      if (path === `/me/experiences/${EXPERIENCE_ID}/logs`) {
        return { repeatCount: 1, logs: [] };
      }
      if (path === `/catalog/${EXPERIENCE_ID}/live`) {
        return {
          operatingStatus: 'OPERATING',
          liveDetail: { waitMinutes: 15, showtimes: [] },
        };
      }
      if (typeof path === 'string' && path.includes('visit-summary')) {
        return { [EXPERIENCE_ID]: { repeatCount: 0, ratedCount: 0, averageRating: null } };
      }
      if (path === '/me/trips') return [];
      if (path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-3',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ExperienceDetailScreen />
      </QueryClientProvider>,
    );

    const dockAction = await screen.findByTestId('dock-primary-action');
    fireEvent.press(dockAction);

    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('4. LiveWaitsScreen: per-row Log button activates sheet and submits to /me/experiences/:id/logs', async () => {
    mockRouteParams = { parkId: 'Magic Kingdom' };

    const liveSnapshot: ParkLiveSnapshotDTO = {
      park: 'Magic Kingdom',
      entries: [
        {
          experienceId: EXPERIENCE_ID,
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 25,
        },
      ],
      retrievedAt: '2026-11-04T12:00:00Z',
      stale: false,
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (typeof path === 'string' && path.includes('/live')) return liveSnapshot;
      if (typeof path === 'string' && path.startsWith('/catalog')) return { experiences: [sampleExp] };
      if (path === '/me/trips') return [];
      if (path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-4',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LiveWaitsScreen />
      </QueryClientProvider>,
    );

    const rowLogBtn = await screen.findByTestId(`log-visit-${EXPERIENCE_ID}`);
    fireEvent.press(rowLogBtn);

    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('5. ExperienceListDetailScreen: item log action activates sheet and submits to /me/experiences/:id/logs', async () => {
    mockRouteParams = { experienceListId: 'list-123' };

    const sampleList = {
      id: 'list-123',
      ownerUserId: 'user-me',
      title: 'Top Coasters',
      description: '',
      isPrivate: false,
      likeCount: 0,
      saveCount: 0,
      itemCount: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      version: 1,
      isLiked: false,
      isSaved: false,
      userRole: 'owner',
      items: [
        {
          id: 'item-1',
          experienceId: EXPERIENCE_ID,
          sortOrder: 0,
          addedByUserId: 'user-me',
          createdAt: '2026-01-01T00:00:00Z',
          experience: sampleExp,
        },
      ],
      contributors: [],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === `/experience-lists/${sampleList.id}`) return sampleList;
      if (typeof path === 'string' && path.includes('visit-summary')) {
        return { [EXPERIENCE_ID]: { repeatCount: 0, ratedCount: 0, averageRating: null } };
      }
      if (path === '/me/trips') return [];
      if (path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-5',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ExperienceListDetailScreen />
      </QueryClientProvider>,
    );

    const itemLogBtn = await screen.findByTestId(`experience-list-item-log-visit-${EXPERIENCE_ID}`);
    fireEvent.press(itemLogBtn);

    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('6. MagicFab: quick-action log ride activates sheet and submits to /me/experiences/:id/logs', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (typeof path === 'string' && path.startsWith('/catalog')) return { experiences: [sampleExp] };
      if (path === '/me/trips') return [];
      if (path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-6',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MagicFab />
      </QueryClientProvider>,
    );

    // Open FAB
    fireEvent.press(screen.getByTestId('magic-fab'));

    // Tap Log Ride in QuickActionSheet
    const logRideAction = await screen.findByTestId('quick-action-logRide');
    fireEvent.press(logRideAction);

    // Select experience from ExperiencePicker
    const expRow = await screen.findByTestId(`fab-picker-result-${EXPERIENCE_ID}`);
    fireEvent.press(expRow);

    // Sheet is now visible
    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });

  test('7. HomeScreen: quick log ride activates sheet and submits to /me/experiences/:id/logs', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (typeof path === 'string' && path.startsWith('/catalog')) return { experiences: [sampleExp] };
      if (path === '/home') return {};
      if (path === '/me/trips') return [];
      if (path === '/me') return { user: { id: 'user-me' } };
      if (method === 'POST' && typeof path === 'string' && path.includes('/logs')) {
        return {
          id: 'log-smoke-7',
          experienceId: EXPERIENCE_ID,
          userId: 'user-me',
          visitedOn: '2026-11-04',
          rating: null,
          note: null,
          tripId: null,
        };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <Tab.Navigator>
            <Tab.Screen name="Home" component={HomeScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Tap Log Ride on HomeScreen
    const logRideTile = await screen.findByTestId('home-quick-log-ride');
    fireEvent.press(logRideTile);

    // Select experience from ExperiencePicker
    const expRow = await screen.findByTestId(`home-picker-result-${EXPERIENCE_ID}`);
    fireEvent.press(expRow);

    // Sheet is now visible
    const submitBtn = await screen.findByTestId('log-visit-submit');
    expect(submitBtn).toBeTruthy();
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          visitedOn: expect.any(String),
          userTz: expect.any(String),
        }),
      );
    });
  });
});