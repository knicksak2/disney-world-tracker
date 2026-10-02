// Feature: experience-detail-redesign, Task 18.4 — TodayInParkLens render tests
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10,
//            14.1, 14.2, 14.3, 14.4

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LiveDetailDTO } from '@dwt/shared';

import TodayInParkLens from '../TodayInParkLens';
import LiveWaitCockpit from '../LiveWaitCockpit';
import * as client from '../../../api/client';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApiRequest = client.apiRequest as jest.Mock;

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('TodayInParkLens & LiveWaitCockpit (Task 18.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/wait-insights')) {
        return {
          experienceId: 'exp-1',
          sampleCount: 50,
          cv: 0.2,
          p50WaitMinutes: 20,
          p90WaitMinutes: 45,
          downRate: 0.05,
          hasSingleRider: true,
          singleRiderP50WaitMinutes: 10,
          llMultipassPriceCents: 2200,
          bestHour: 9,
          worstHour: 14,
          waits: [
            { hour: 9, predictedWaitMinutes: 15 },
            { hour: 12, predictedWaitMinutes: 40 },
            { hour: 18, predictedWaitMinutes: 25 },
          ],
        };
      }
      if (url.includes('/me/trips?filter=active')) {
        return { trips: [] };
      }
      return {};
    });
  });

  describe('Category Dispatch (Requirements 14.1-14.4)', () => {
    const mockLocationGroup = {
      id: 'location' as const,
      label: 'Location',
      tags: [{ kind: 'land' as const, label: 'Adventureland', accessibilityLabel: 'Land: Adventureland' }],
    };

    it('R14.1: renders LiveWaitCockpit and LocationGroup for Ride', async () => {
      const { getByTestId, queryByTestId } = renderWithClient(
        <TodayInParkLens
          experienceId="exp-1"
          experienceName="Pirates"
          category="Ride"
          locationGroup={mockLocationGroup}
          latitude={28.41}
          longitude={-81.58}
          onReserve={jest.fn()}
        />,
      );

      expect(getByTestId('live-wait-cockpit')).toBeTruthy();
      expect(queryByTestId('dining-reservation-card')).toBeNull();
      expect(queryByTestId('showtimes-card')).toBeNull();
      expect(getByTestId('experience-location-group')).toBeTruthy();
    });

    it('R14.1: renders DiningReservationCard, MenuSummaryCard, and LocationGroup for Restaurant', () => {
      const onReserve = jest.fn();
      const onLogFoodItem = jest.fn();
      const onMyLoggedItems = jest.fn();
      const onAddToList = jest.fn();
      const { getByTestId, getByText, queryByTestId } = renderWithClient(
        <TodayInParkLens
          experienceId="exp-dining"
          experienceName="Be Our Guest"
          category="Restaurant"
          diningUrl="https://disneyworld.disney.go.com/dining/be-our-guest"
          menus={[
            { menuType: 'Lunch', groups: [] },
            { menuType: 'Dinner', groups: [] },
          ]}
          locationGroup={mockLocationGroup}
          latitude={28.42}
          longitude={-81.58}
          onReserve={onReserve}
          onLogFoodItem={onLogFoodItem}
          onMyLoggedItems={onMyLoggedItems}
          onAddToList={onAddToList}
          loggedDishesCount={3}
        />
      );

      expect(queryByTestId('live-wait-cockpit')).toBeNull();
      expect(getByTestId('dining-reservation-card')).toBeTruthy();
      expect(getByText('Open Today')).toBeTruthy();
      expect(getByTestId('experience-reserve-action')).toBeTruthy();
      expect(getByText("Reserve on Disney's Site")).toBeTruthy();
      expect(getByTestId('dining-card-log-dish-btn')).toBeTruthy();
      expect(getByText('Log a Dish')).toBeTruthy();
      expect(getByTestId('dining-card-add-to-list-btn')).toBeTruthy();
      expect(getByText('Add to List')).toBeTruthy();
      expect(getByTestId('dining-card-my-dishes-btn')).toBeTruthy();
      expect(getByText('My Dishes (3) →')).toBeTruthy();
      expect(getByTestId('menu-summary-card')).toBeTruthy();
      expect(getByText('2 menus available')).toBeTruthy();
      expect(getByTestId('experience-location-group')).toBeTruthy();
      expect(getByText(/Beast's Castle/)).toBeTruthy();
      expect(getByText(/Cross the stone bridge into the Enchanted Forest/)).toBeTruthy();

      fireEvent.press(getByTestId('experience-reserve-action'));
      expect(onReserve).toHaveBeenCalledWith(
        'https://disneyworld.disney.go.com/dining/be-our-guest',
      );

      fireEvent.press(getByTestId('dining-card-log-dish-btn'));
      expect(onLogFoodItem).toHaveBeenCalled();

      fireEvent.press(getByTestId('dining-card-add-to-list-btn'));
      expect(onAddToList).toHaveBeenCalled();

      fireEvent.press(getByTestId('dining-card-my-dishes-btn'));
      expect(onMyLoggedItems).toHaveBeenCalled();
    });

    it('R21.4: renders Quick Service & Dishes title and suppresses reserve table button when isQuickService is true', () => {
      const onReserve = jest.fn();
      const { getByTestId, getByText, queryByTestId } = renderWithClient(
        <TodayInParkLens
          experienceId="exp-quick"
          experienceName="El Mercado de Coronado"
          category="Restaurant"
          diningUrl="https://disneyworld.disney.go.com/dining/el-mercado-de-coronado"
          isQuickService
          locationGroup={mockLocationGroup}
          onReserve={onReserve}
        />
      );

      expect(getByTestId('dining-reservation-card')).toBeTruthy();
      expect(getByText('Quick Service & Dishes')).toBeTruthy();
      expect(getByText('Counter Service & Mobile Order')).toBeTruthy();
      expect(queryByTestId('experience-reserve-action')).toBeNull();
      expect(getByTestId('dining-card-log-dish-btn')).toBeTruthy();
    });

    it('R14.2: renders ShowtimesCard and LocationGroup for Show', () => {
      const { getByTestId, queryByTestId } = renderWithClient(
        <TodayInParkLens
          experienceId="exp-show"
          experienceName="Festival of the Lion King"
          category="Show"
          liveDetail={{
            status: 'Operating',
            waitMinutes: undefined,
            showtimes: [{ start: '2026-09-24T14:00:00Z', type: 'Standard' }],
            operatingHours: [],
            diningAvailability: [],
          } as unknown as LiveDetailDTO}
          locationGroup={mockLocationGroup}
          latitude={28.35}
          longitude={-81.59}
          onReserve={jest.fn()}
        />,
      );

      expect(queryByTestId('live-wait-cockpit')).toBeNull();
      expect(queryByTestId('dining-reservation-card')).toBeNull();
      expect(getByTestId('showtimes-card')).toBeTruthy();
      expect(getByTestId('experience-location-group')).toBeTruthy();
    });

    it('R14.3, R14.4: renders neither cockpit nor dining/show card for Tour, but preserves LocationGroup', () => {
      const { queryByTestId, getByTestId } = renderWithClient(
        <TodayInParkLens
          experienceId="exp-tour"
          experienceName="Keys to the Kingdom"
          category="Tour"
          locationGroup={mockLocationGroup}
          latitude={28.41}
          longitude={-81.58}
          onReserve={jest.fn()}
        />,
      );

      expect(queryByTestId('live-wait-cockpit')).toBeNull();
      expect(queryByTestId('dining-reservation-card')).toBeNull();
      expect(queryByTestId('showtimes-card')).toBeNull();
      expect(getByTestId('experience-location-group')).toBeTruthy();
    });
  });

  describe('LiveWaitCockpit Context & Content (Requirements 13.1-13.10)', () => {
    it('R13.2, R13.3: defaults to Now; omits Trip chip when unresolvable', async () => {
      const { getByTestId, queryByTestId } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          activeTripRange={null}
          plannedDate={null}
          todayWdw="2026-09-24"
        />,
      );

      expect(getByTestId('wait-context-now')).toBeTruthy();
      expect(getByTestId('wait-context-typical')).toBeTruthy();
      // Unresolvable trip date -> Trip chip omitted
      expect(queryByTestId('wait-context-trip')).toBeNull();

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith(
          'GET',
          '/experiences/exp-1/wait-insights?date=2026-09-24',
        );
      });
    });

    it('R13.2, R16.4: omits Trip chip when fallback query contains only past trips', async () => {
      mockApiRequest.mockImplementation(async (_method: string, url: string) => {
        if (url.includes('/me/trips')) {
          return [
            {
              status: 'past',
              trips: [
                {
                  id: 'past-trip-1',
                  status: 'past',
                  startDate: '2024-01-01',
                  endDate: '2024-01-05',
                },
              ],
            },
          ];
        }
        if (url.includes('/wait-insights')) {
          return {
            p50WaitMinutes: 15,
            p90WaitMinutes: 30,
            downRate: 0.05,
            waits: [],
          };
        }
        return {};
      });

      const { getByTestId, queryByTestId } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          todayWdw="2026-09-24"
        />,
      );

      await waitFor(() => {
        expect(getByTestId('wait-context-now')).toBeTruthy();
      });

      expect(queryByTestId('wait-context-trip')).toBeNull();
    });

    it('R13.2, R13.6: renders Trip chip when resolvable and requests with Trip date', async () => {
      const { getByTestId } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          activeTripRange={{ startDate: '2026-10-10', endDate: '2026-10-15' }}
          plannedDate="2026-10-12"
          todayWdw="2026-09-24"
        />,
      );

      const tripChip = getByTestId('wait-context-trip');
      expect(tripChip).toBeTruthy();

      fireEvent.press(tripChip);

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith(
          'GET',
          '/experiences/exp-1/wait-insights?date=2026-10-12',
        );
      });
    });

    it('R13.5: switching to Typical requests without date query parameter', async () => {
      const { getByTestId } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          activeTripRange={null}
          plannedDate={null}
          todayWdw="2026-09-24"
        />,
      );

      const typicalChip = getByTestId('wait-context-typical');
      fireEvent.press(typicalChip);

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith(
          'GET',
          '/experiences/exp-1/wait-insights',
        );
      });
    });

    it('R13.7, R13.8, R13.9, R13.10: renders stats, verdict, LL ticket, VQ banner, and Single Rider strip', async () => {
      const mockLiveDetail: LiveDetailDTO = {
        status: 'Operating',
        waitMinutes: 35,
        singleRiderWaitMinutes: 10,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
        lightningLane: {
          available: true,
          returnStart: '2026-09-24T15:00:00Z',
          returnEnd: '2026-09-24T16:00:00Z',
        },
        boardingGroup: {
          state: 'Open',
          currentGroupStart: 20,
          currentGroupEnd: 40,
        },
      };

      const { getByTestId, getByText } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          liveDetail={mockLiveDetail}
          todayWdw="2026-09-24"
        />,
      );

      // Standby wait & LL ticket
      expect(getByTestId('cockpit-standby-wait')).toBeTruthy();
      expect(getByText('35 min')).toBeTruthy();
      expect(getByTestId('cockpit-lightning-lane')).toBeTruthy();

      // Virtual Queue banner
      expect(getByTestId('experience-virtual-queue-banner')).toBeTruthy();
      expect(getByText('Open')).toBeTruthy();

      // Single Rider strip
      expect(getByTestId('single-rider-strip')).toBeTruthy();
      expect(getByTestId('single-rider-wait')).toBeTruthy();

      // Stats & Verdict
      await waitFor(() => {
        expect(getByTestId('cockpit-stat-typical')).toBeTruthy();
        expect(getByTestId('cockpit-stat-reliability')).toBeTruthy();
        expect(getByTestId('cockpit-verdict')).toBeTruthy();
        expect(getByTestId('cockpit-verdict-headline')).toBeTruthy();
      });
    });

    it('R13.4: tapping forecast bars updates scrub label and toggles inspection', async () => {
      const { getByTestId } = renderWithClient(
        <LiveWaitCockpit
          experienceId="exp-1"
          activeTripRange={null}
          plannedDate={null}
          todayWdw="2026-09-24"
        />,
      );

      await waitFor(() => {
        expect(getByTestId('cockpit-forecast-chart')).toBeTruthy();
      });

      const scrubLabel = getByTestId('forecast-scrub-label');
      expect(scrubLabel.props.children).toBe('Tap bars to inspect');

      // Tap 9 AM bar (waits: [{ hour: 9, predictedWaitMinutes: 15 }, ...])
      fireEvent.press(getByTestId('forecast-bar-9'));
      expect(scrubLabel.props.children).toBe('9 AM: ~15m wait');

      // Tap 12 PM bar
      fireEvent.press(getByTestId('forecast-bar-12'));
      expect(scrubLabel.props.children).toBe('12 PM: ~40m wait');

      // Tap 12 PM bar again to deselect
      fireEvent.press(getByTestId('forecast-bar-12'));
      expect(scrubLabel.props.children).toBe('Tap bars to inspect');

      // Check lowest forecast legend formatting (e.g. 9:00 AM, not 9 AM:00)
      const legend = getByTestId('lowest-forecast-legend');
      expect(legend.props.children.join('')).toBe(
        'Lowest predicted wait: 20 min at 9:00 AM',
      );
    });
  });
});

