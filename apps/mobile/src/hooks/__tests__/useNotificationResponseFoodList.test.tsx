// Feature: food-lists, Task 8.12, 8.14 — Property 10: Deep-link notification routing for food list shares
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type {
  NotificationContent,
  NotificationResponse,
  NotificationTrigger,
} from 'expo-notifications';

const mockGetLastNotificationResponseAsync = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockRemoveSubscription = jest.fn();

jest.mock('expo-notifications', () => ({
  __esModule: true,
  getLastNotificationResponseAsync: (...args: unknown[]) =>
    mockGetLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) =>
    mockAddNotificationResponseReceivedListener(...args),
}));

const mockNavigateToFoodListDetail = jest.fn();
const mockNavigateToInbox = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToFoodListDetail: (...args: unknown[]) =>
    mockNavigateToFoodListDetail(...args),
  navigateToInbox: (...args: unknown[]) => mockNavigateToInbox(...args),
}));

import {
  useNotificationResponse,
  classifyTap,
} from '../useNotificationResponse';
import { useSessionStore } from '../../state/sessionStore';

function makeResponse(data: Record<string, unknown>): NotificationResponse {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: Date.now(),
      request: {
        identifier: 'notif-1',
        content: {
          title: 'Food List Shared',
          body: 'Alice shared a list with you',
          data,
        } as unknown as NotificationContent,
        trigger: { type: 'push' } as unknown as NotificationTrigger,
      },
    },
  };
}

describe('useNotificationResponse — Food List deep-linking (Property 10, Task 8.12, 8.14)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    mockNavigateToFoodListDetail.mockReturnValue(true);
    mockNavigateToInbox.mockReturnValue(true);

    // Set authenticated session by default
    act(() => {
      useSessionStore.setState({
        token: 'valid-token',
        hydrated: true,
      });
    });
  });

  afterEach(() => {
    act(() => {
      useSessionStore.setState({
        token: null,
        hydrated: true,
      });
    });
  });

  describe('Property 10: classifyTap classifies foodListId before share fallback', () => {
    test('classifies a payload with only foodListId as foodListShare', () => {
      const tap = classifyTap(makeResponse({ foodListId: 'list-123' }));
      expect(tap).toEqual({
        kind: 'foodListShare',
        foodListId: 'list-123',
      });
    });

    test('classifies a payload with BOTH foodListId and shareId as foodListShare (Property 10)', () => {
      // Property 10: A notification response carrying a `foodListId` MUST classify as `foodListShare`
      // even if accompanied by a `shareId`, rather than falling through to the generic `share` branch.
      const tap = classifyTap(makeResponse({ foodListId: 'list-456', shareId: 'share-789' }));
      expect(tap).toEqual({
        kind: 'foodListShare',
        foodListId: 'list-456',
      });
    });

    test('classifies nested data with foodListId as foodListShare', () => {
      const tap = classifyTap(makeResponse({ data: { foodListId: 'list-nested' } }));
      expect(tap).toEqual({
        kind: 'foodListShare',
        foodListId: 'list-nested',
      });
    });
  });

  describe('Deep-link dispatch', () => {
    test('routes cold-launch food list tap to navigateToFoodListDetail', async () => {
      mockGetLastNotificationResponseAsync.mockResolvedValue(
        makeResponse({ foodListId: 'list-cold-launch' }),
      );

      renderHook(() => useNotificationResponse());

      await waitFor(() => {
        expect(mockNavigateToFoodListDetail).toHaveBeenCalledWith({
          foodListId: 'list-cold-launch',
        });
      });
      expect(mockNavigateToInbox).not.toHaveBeenCalled();
    });

    test('routes foreground listener food list tap to navigateToFoodListDetail', async () => {
      let listenerCallback: ((res: any) => void) | undefined;
      mockAddNotificationResponseReceivedListener.mockImplementation((cb) => {
        listenerCallback = cb;
        return { remove: mockRemoveSubscription };
      });

      renderHook(() => useNotificationResponse());

      act(() => {
        listenerCallback?.(makeResponse({ foodListId: 'list-foreground-tap' }));
      });

      await waitFor(() => {
        expect(mockNavigateToFoodListDetail).toHaveBeenCalledWith({
          foodListId: 'list-foreground-tap',
        });
      });
      expect(mockNavigateToInbox).not.toHaveBeenCalled();
    });

    test('holds unauthenticated food list tap until authenticated then dispatches', async () => {
      useSessionStore.setState({ token: null, hydrated: true });

      mockGetLastNotificationResponseAsync.mockResolvedValue(
        makeResponse({ foodListId: 'list-unauth' }),
      );

      renderHook(() => useNotificationResponse());

      // Should not navigate while unauthenticated
      expect(mockNavigateToFoodListDetail).not.toHaveBeenCalled();

      // Authenticate
      act(() => {
        useSessionStore.setState({
          token: 'valid-token',
          hydrated: true,
        });
      });

      await waitFor(() => {
        expect(mockNavigateToFoodListDetail).toHaveBeenCalledWith({
          foodListId: 'list-unauth',
        });
      });
    });
  });
});
