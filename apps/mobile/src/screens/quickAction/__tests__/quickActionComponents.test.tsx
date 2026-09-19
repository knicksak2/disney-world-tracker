/**
 * Component tests for QuickActionSheet and MagicFab.
 * (Task 8.7, Requirements 1.1, 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7)
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiRequest } from '../../../api/client';
import { useClaimablePinsBadge } from '../../../components/pins/useClaimablePinsBadge';
import {
  navigateToLiveWaits,
  navigateToPinBoard,
  navigateToTripSchedule,
  navigateToTripsList,
} from '../../../navigation/navigationRef';
import { QuickActionSheet } from '../QuickActionSheet';
import MagicFab from '../MagicFab';
import { getTodayWDW } from '../../trips/TripScheduleScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../components/pins/useClaimablePinsBadge', () => ({
  useClaimablePinsBadge: jest.fn(),
}));

jest.mock('../../../navigation/navigationRef', () => ({
  navigateToLiveWaits: jest.fn(),
  navigateToPinBoard: jest.fn(),
  navigateToTripSchedule: jest.fn(),
  navigateToTripsList: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockUseClaimablePinsBadge = useClaimablePinsBadge as jest.MockedFunction<typeof useClaimablePinsBadge>;
const mockNavigateToLiveWaits = navigateToLiveWaits as jest.MockedFunction<typeof navigateToLiveWaits>;
const mockNavigateToPinBoard = navigateToPinBoard as jest.MockedFunction<typeof navigateToPinBoard>;
const mockNavigateToTripSchedule = navigateToTripSchedule as jest.MockedFunction<typeof navigateToTripSchedule>;
const mockNavigateToTripsList = navigateToTripsList as jest.MockedFunction<typeof navigateToTripsList>;

function mockBadge(count: number) {
  return {
    count,
    display: (count > 0
      ? { mode: 'count', text: String(count) }
      : { mode: 'hidden' }) as any,
  };
}

describe('QuickActionSheet & MagicFab', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockApiRequest.mockReset();
    mockUseClaimablePinsBadge.mockReturnValue(mockBadge(0));
    mockNavigateToLiveWaits.mockReset();
    mockNavigateToPinBoard.mockReset();
    mockNavigateToTripSchedule.mockReset();
    mockNavigateToTripsList.mockReset();
  });

  function renderWithClient(ui: React.ReactElement) {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>,
    );
  }

  describe('MagicFab', () => {
    it('renders the elevated FAB button and opens sheet on press', async () => {
      renderWithClient(<MagicFab />);

      const fab = screen.getByTestId('magic-fab');
      expect(fab).toBeTruthy();

      fireEvent.press(fab);

      await waitFor(() => {
        expect(screen.getByTestId('quick-action-sheet')).toBeTruthy();
        expect(screen.getByText('Quick Actions')).toBeTruthy();
      });
    });

    it('invokes custom onPress callback if provided', () => {
      const customOnPress = jest.fn();
      renderWithClient(<MagicFab onPress={customOnPress} />);

      fireEvent.press(screen.getByTestId('magic-fab'));
      expect(customOnPress).toHaveBeenCalledTimes(1);
    });

    it('opens experience picker modal when Log Ride is selected from sheet', async () => {
      mockApiRequest.mockResolvedValue([]);
      renderWithClient(<MagicFab />);

      // Open sheet
      fireEvent.press(screen.getByTestId('magic-fab'));
      await waitFor(() => expect(screen.getByTestId('quick-action-sheet')).toBeTruthy());

      // Tap Log Ride
      fireEvent.press(screen.getByTestId('quick-action-logRide'));

      // Modal should open
      await waitFor(() => {
        expect(screen.getByTestId('fab-experience-picker-modal')).toBeTruthy();
        expect(screen.getByTestId('fab-picker-title')).toHaveTextContent('Select Attraction to Log');
      });
    });
  });

  describe('QuickActionSheet', () => {
    it('renders the 4 baseline actions when claimable pin count is 0', async () => {
      mockUseClaimablePinsBadge.mockReturnValue(mockBadge(0));
      mockApiRequest.mockResolvedValue([]);

      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      expect(screen.getByTestId('quick-action-liveWaits')).toBeTruthy();
      expect(screen.getByTestId('quick-action-logRide')).toBeTruthy();
      expect(screen.getByTestId('quick-action-logSnack')).toBeTruthy();
      expect(screen.getByTestId('quick-action-todaySchedule')).toBeTruthy();
      expect(screen.queryByTestId('quick-action-claimPins')).toBeNull();
    });

    it('includes Claim Pins action when claimable count is greater than 0', async () => {
      mockUseClaimablePinsBadge.mockReturnValue(mockBadge(2));
      mockApiRequest.mockImplementation(async (_method, url) => {
        if (url === '/me/pins') {
          return {
            pins: [
              {
                id: 'pin-1',
                unlockedAt: '2026-09-17T00:00:00Z',
                claimedAt: null,
              },
              {
                id: 'pin-2',
                unlockedAt: '2026-09-17T00:00:00Z',
                claimedAt: null,
              },
            ],
          };
        }
        return [];
      });

      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      expect(screen.getByTestId('quick-action-claimPins')).toBeTruthy();
      expect(screen.getByText('Claim Pins')).toBeTruthy();

      fireEvent.press(screen.getByTestId('quick-action-claimPins'));

      expect(onClose).toHaveBeenCalled();
    });

    it('navigates to Live Waits for default park when Check Live Waits is tapped', async () => {
      mockUseClaimablePinsBadge.mockReturnValue(mockBadge(0));
      mockApiRequest.mockImplementation(async (_method, url) => {
        if (url === '/me/trips') {
          return [
            {
              status: 'active',
              trips: [
                {
                  id: 'trip-123',
                  name: 'Summer Trip',
                  startDate: '2026-09-15',
                  endDate: '2026-09-20',
                  dayTouringHours: {
                    [getTodayWDW()]: { startingPark: 'EPCOT' },
                  },
                },
              ],
            },
          ];
        }
        if (url.includes('/planned-items')) {
          return [];
        }
        return [];
      });

      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0);
      });

      fireEvent.press(screen.getByTestId('quick-action-liveWaits'));

      expect(onClose).toHaveBeenCalled();
      expect(mockNavigateToLiveWaits).toHaveBeenCalledWith('EPCOT');
    });

    it('navigates to today schedule when View Today Schedule is tapped with active trip', async () => {
      mockUseClaimablePinsBadge.mockReturnValue(mockBadge(0));
      mockApiRequest.mockImplementation(async (_method, url) => {
        if (url === '/me/trips') {
          return [
            {
              status: 'active',
              trips: [
                {
                  id: 'trip-456',
                  name: 'Fall Vacation',
                  startDate: '2026-09-15',
                  endDate: '2026-09-20',
                },
              ],
            },
          ];
        }
        return [];
      });

      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0);
      });

      fireEvent.press(screen.getByTestId('quick-action-todaySchedule'));

      expect(onClose).toHaveBeenCalled();
      expect(mockNavigateToTripSchedule).toHaveBeenCalledWith({ tripId: 'trip-456' });
    });

    it('navigates to trips list when View Today Schedule is tapped without an active trip', async () => {
      mockUseClaimablePinsBadge.mockReturnValue(mockBadge(0));
      mockApiRequest.mockImplementation(async (_method, url) => {
        if (url === '/me/trips') {
          return [];
        }
        return [];
      });

      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0);
      });

      fireEvent.press(screen.getByTestId('quick-action-todaySchedule'));

      expect(onClose).toHaveBeenCalled();
      expect(mockNavigateToTripsList).toHaveBeenCalled();
    });

    it('opens experience picker on Log Ride and Log Snack', () => {
      const onOpenPicker = jest.fn();
      const onClose = jest.fn();
      renderWithClient(
        <QuickActionSheet
          visible={true}
          onClose={onClose}
          onOpenExperiencePicker={onOpenPicker}
        />,
      );

      fireEvent.press(screen.getByTestId('quick-action-logRide'));
      expect(onOpenPicker).toHaveBeenCalledWith('rides');
      expect(onClose).toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('quick-action-logSnack'));
      expect(onOpenPicker).toHaveBeenCalledWith('dining');
    });

    it('dismisses when close button or backdrop is pressed', () => {
      const onClose = jest.fn();
      renderWithClient(<QuickActionSheet visible={true} onClose={onClose} />);

      fireEvent.press(screen.getByTestId('quick-action-close-btn'));
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.press(screen.getByTestId('quick-action-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
