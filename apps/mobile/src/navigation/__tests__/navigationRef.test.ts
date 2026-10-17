import {
  navigationRef,
  navigateToTripSchedule,
  navigateToTripDetail,
  navigateToBookingTimeline,
} from '../navigationRef';

describe('navigationRef', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('navigateToTripSchedule', () => {
    it('returns false when navigationRef is not ready', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToTripSchedule({ tripId: 'trip-123' });

      expect(result).toBe(false);
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('seeds TripDetail then navigates to TripSchedule in the Trips stack when ready', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToTripSchedule({ tripId: 'trip-123' });

      expect(result).toBe(true);
      expect(navigateSpy).toHaveBeenCalledTimes(2);

      // First call seeds TripDetail so the user can easily go back to the rest of the trip
      expect(navigateSpy).toHaveBeenNthCalledWith(1, 'MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripDetail',
          params: { tripId: 'trip-123' },
        },
      });

      // Second call opens TripSchedule on top of TripDetail
      expect(navigateSpy).toHaveBeenNthCalledWith(2, 'MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripSchedule',
          params: { tripId: 'trip-123' },
        },
      });
    });
  });

  describe('navigateToBookingTimeline', () => {
    it('returns false when navigationRef is not ready', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToBookingTimeline({ tripId: 'trip-123' });

      expect(result).toBe(false);
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('seeds TripDetail then navigates to TripBookingTimeline in the Trips stack when ready', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
      jest.spyOn(navigationRef, 'getCurrentRoute').mockReturnValue(undefined);
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToBookingTimeline({ tripId: 'trip-123' });

      expect(result).toBe(true);
      expect(navigateSpy).toHaveBeenCalledTimes(2);

      expect(navigateSpy).toHaveBeenNthCalledWith(1, 'MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripDetail',
          params: { tripId: 'trip-123' },
        },
      });

      expect(navigateSpy).toHaveBeenNthCalledWith(2, 'MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripBookingTimeline',
          params: { tripId: 'trip-123' },
        },
      });
    });

    it('returns true without navigating when current route is already TripBookingTimeline for the same tripId', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
      jest.spyOn(navigationRef, 'getCurrentRoute').mockReturnValue({
        key: 'TripBookingTimeline-1',
        name: 'TripBookingTimeline',
        params: { tripId: 'trip-123' },
      });
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToBookingTimeline({ tripId: 'trip-123' });

      expect(result).toBe(true);
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('navigates when current route is TripBookingTimeline for a different tripId', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
      jest.spyOn(navigationRef, 'getCurrentRoute').mockReturnValue({
        key: 'TripBookingTimeline-1',
        name: 'TripBookingTimeline',
        params: { tripId: 'trip-other' },
      });
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToBookingTimeline({ tripId: 'trip-123' });

      expect(result).toBe(true);
      expect(navigateSpy).toHaveBeenCalledTimes(2);
      expect(navigateSpy).toHaveBeenNthCalledWith(2, 'MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripBookingTimeline',
          params: { tripId: 'trip-123' },
        },
      });
    });
  });

  describe('navigateToTripDetail', () => {
    it('navigates directly to TripDetail on the Trips stack', () => {
      jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
      const navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation();

      const result = navigateToTripDetail({ tripId: 'trip-456' });

      expect(result).toBe(true);
      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(navigateSpy).toHaveBeenCalledWith('MainTabs', {
        screen: 'Trips',
        params: {
          screen: 'TripDetail',
          params: { tripId: 'trip-456' },
        },
      });
    });
  });
});
