import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../../api/client', () => ({
  __esModule: true,
  apiRequest: jest.fn(),
}));

import { apiRequest } from '../../../api/client';
import { HomeSearchBar } from '../HomeSearchBar';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

function renderSearchBar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HomeSearchBar />
    </QueryClientProvider>,
  );
}

describe('HomeSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [
          {
            status: 'active',
            trips: [
              {
                id: 'trip-1',
                name: 'Summer Magic 27',
                description: 'Family vacation',
                startDate: '2027-06-01',
                endDate: '2027-06-07',
              },
            ],
          },
        ] as never;
      }
      return {
        experiences: [
          {
            id: 'exp-1',
            name: 'Guardians of the Galaxy: Cosmic Rewind',
            park: 'EPCOT',
            category: 'Attraction',
            resortArea: null,
          },
        ],
      } as never;
    });
  });

  it('finds app tools like Crowd Calendar with section header and breadcrumb and navigates directly on press', () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'crowd');
    expect(screen.getByTestId('home-search-section-tools')).toBeTruthy();
    const row = screen.getByTestId('home-search-result-tool-crowds');
    expect(row).toBeTruthy();
    expect(screen.getByText('Explore › Crowds')).toBeTruthy();

    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', { screen: 'CrowdCalendar' });
  });

  it('shows Popular Tools when focused with an empty query and dismisses on close/blur', async () => {
    renderSearchBar();

    const input = screen.getByTestId('home-search-input');
    fireEvent(input, 'focus');

    expect(screen.getByTestId('home-search-popular-tools')).toBeTruthy();
    expect(screen.getByTestId('home-search-popular-tool-waits')).toBeTruthy();
    expect(screen.getByTestId('home-search-popular-tool-dining')).toBeTruthy();

    fireEvent.press(screen.getByTestId('home-search-popular-tool-dining'));
    expect(mockNavigate).toHaveBeenCalledWith('Trips', { screen: 'DiningPlanCalculator' });

    fireEvent(input, 'focus');
    fireEvent.press(screen.getByTestId('home-search-popular-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('home-search-popular-tools')).toBeNull();
    });
  });

  it('queries GET /catalog?q= debounced (supporting aliases) and opens ExperienceDetail', async () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'RotR');
    const expRow = await screen.findByTestId('home-search-exp-exp-1');
    expect(expRow).toBeTruthy();
    expect(screen.getByTestId('home-search-section-experiences')).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/catalog?q=RotR');

    fireEvent.press(expRow);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-1',
    });
  });

  it('clears search results when clear button is pressed', async () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'waits');
    expect(screen.getByTestId('home-search-results')).toBeTruthy();

    fireEvent.press(screen.getByTestId('home-search-clear'));
    await waitFor(() => {
      expect(screen.queryByTestId('home-search-results')).toBeNull();
    });
  });

  it('routes Pin Board & Showcase to CollectionHome Pins hub', () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'pin');
    fireEvent.press(screen.getByTestId('home-search-result-tool-pins'));

    expect(mockNavigate).toHaveBeenCalledWith('Collection', {
      screen: 'CollectionHome',
      params: { initialTab: 'pins' },
    });
  });

  it('splits Food Lists and Experience Lists into separate results that open their own screens', () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'list');
    expect(screen.getByTestId('home-search-result-tool-food-lists')).toBeTruthy();
    const expListRow = screen.getByTestId('home-search-result-tool-experience-lists');
    expect(expListRow).toBeTruthy();

    fireEvent.press(expListRow);
    expect(mockNavigate).toHaveBeenCalledWith('Collection', {
      screen: 'MyExperienceLists',
    });
  });

  it('searches user trips by name and opens TripDetail', async () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'summer');
    const tripRow = await screen.findByTestId('home-search-trip-trip-1');
    expect(tripRow).toBeTruthy();

    fireEvent.press(tripRow);
    expect(mockNavigate).toHaveBeenCalledWith('Trips', {
      screen: 'TripDetail',
      params: { tripId: 'trip-1' },
    });
  });

  it('routes Profile, Crew & Settings directly to YouAndCrew, Settings to Settings, and Shared Inbox to Inbox', () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'settings');
    fireEvent.press(screen.getByTestId('home-search-result-tool-settings'));
    expect(mockNavigate).toHaveBeenCalledWith('YouAndCrew', {
      screen: 'YouAndCrewMain',
    });

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'settings');
    fireEvent.press(screen.getByTestId('home-search-result-tool-app-settings'));
    expect(mockNavigate).toHaveBeenCalledWith('YouAndCrew', {
      screen: 'Settings',
    });

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'inbox');
    fireEvent.press(screen.getByTestId('home-search-result-tool-inbox'));
    expect(mockNavigate).toHaveBeenCalledWith('YouAndCrew', { screen: 'Inbox' });
  });

  it('surfaces trip-scoped tools at 0 trips and opens a bridge modal routing to TripsList', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [] as never;
      }
      return { experiences: [] } as never;
    });

    renderSearchBar();
    fireEvent.changeText(screen.getByTestId('home-search-input'), 'packing');

    const packingRow = await screen.findByTestId('home-search-result-tool-packing');
    expect(packingRow).toBeTruthy();
    expect(await screen.findByText('Start a trip to unlock this tool')).toBeTruthy();

    fireEvent.press(packingRow);
    const modal = await screen.findByTestId('home-search-no-trip-modal');
    expect(modal).toBeTruthy();

    fireEvent.press(screen.getByTestId('home-search-no-trip-create-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('Trips', { screen: 'TripsList' });
  });

  it('names the single trip and jumps straight to TripPackingList when there is 1 active/upcoming trip', async () => {
    renderSearchBar();
    fireEvent.changeText(screen.getByTestId('home-search-input'), 'packing');

    const packingRow = await screen.findByTestId('home-search-result-tool-packing');
    expect(await screen.findByText('Shared checklists · Summer Magic 27')).toBeTruthy();

    fireEvent.press(packingRow);
    expect(mockNavigate).toHaveBeenCalledWith('Trips', {
      screen: 'TripPackingList',
      params: { tripId: 'trip-1' },
    });
  });

  it('opens a trip picker modal when 2+ active/upcoming trips exist', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [
          {
            status: 'active',
            trips: [
              {
                id: 'trip-1',
                name: 'Summer Magic 27',
                description: null,
                startDate: '2027-06-01',
                endDate: '2027-06-07',
              },
            ],
          },
          {
            status: 'upcoming',
            trips: [
              {
                id: 'trip-2',
                name: 'Holiday Trip',
                description: null,
                startDate: '2027-12-10',
                endDate: '2027-12-15',
              },
            ],
          },
        ] as never;
      }
      return { experiences: [] } as never;
    });

    renderSearchBar();
    fireEvent.changeText(screen.getByTestId('home-search-input'), 'packing');

    const packingRow = await screen.findByTestId('home-search-result-tool-packing');
    expect(await screen.findByText('Choose a trip (2)')).toBeTruthy();

    fireEvent.press(packingRow);
    const picker = await screen.findByTestId('home-search-trip-picker');
    expect(picker).toBeTruthy();

    fireEvent.press(screen.getByTestId('home-search-trip-pick-trip-2'));
    expect(mockNavigate).toHaveBeenCalledWith('Trips', {
      screen: 'TripPackingList',
      params: { tripId: 'trip-2' },
    });
  });

  it('finds Activity & Experiences when searching activ and navigates to ExperiencesDetail', () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'activ');
    const row = screen.getByTestId('home-search-result-tool-activity-experiences');
    expect(row).toBeTruthy();

    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith('Collection', {
      screen: 'Stats',
      params: { screen: 'ExperiencesDetail' },
    });
  });

  it('finds Discover Lists, Submit Hidden Mickey, and Trip Photo Album', async () => {
    renderSearchBar();

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'discover');
    fireEvent.press(screen.getByTestId('home-search-result-tool-discover-food-lists'));
    expect(mockNavigate).toHaveBeenCalledWith('FoodListDiscovery');

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'submit');
    fireEvent.press(screen.getByTestId('home-search-result-tool-submit-mickey'));
    expect(mockNavigate).toHaveBeenCalledWith('SubmitMickey');

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'album');
    const albumRow = await screen.findByTestId('home-search-result-tool-trip-album');
    expect(await screen.findByText('Shared trip photos · Summer Magic 27')).toBeTruthy();
    fireEvent.press(albumRow);
    expect(mockNavigate).toHaveBeenCalledWith('Trips', {
      screen: 'TripAlbum',
      params: { tripId: 'trip-1' },
    });

    fireEvent.changeText(screen.getByTestId('home-search-input'), 'onboard');
    fireEvent.press(screen.getByTestId('home-search-result-tool-onboarding-preview'));
    expect(mockNavigate).toHaveBeenCalledWith('OnboardingFlow', { mode: 'preview' });
  });

  it('omits Preview Onboarding tool shortcut when __DEV__ is false', () => {
    const g = global as unknown as { __DEV__: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      renderSearchBar();
      fireEvent.changeText(screen.getByTestId('home-search-input'), 'onboard');
      expect(screen.queryByTestId('home-search-result-tool-onboarding-preview')).toBeNull();
    } finally {
      g.__DEV__ = originalDev;
    }
  });
});
