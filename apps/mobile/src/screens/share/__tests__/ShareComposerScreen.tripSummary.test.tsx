/**
 * ShareComposerScreen `tripSummary` variant (photo-uploads task 22.4,
 * Requirements 15.2, 15.8, 15.9).
 *
 * Renders the real composer inside a real native stack typed with the app's
 * `RootStackParamList`; only `apiRequest` is spied.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as clientModule from '../../../api/client';
import type { RootStackParamList } from '../../../navigation/RootNavigator';
import ShareComposerScreen, { TRIP_RECAP_CREW_PHOTOS_NOTE } from '../ShareComposerScreen';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

const TRIP_ID = 'trip-0001';
const TRIP_NAME = 'Fall 2026 Family Trip';

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-02T00:00:00Z',
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function renderComposer(): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="ShareComposer"
            component={ShareComposerScreen}
            initialParams={{ kind: 'tripSummary', tripId: TRIP_ID, tripName: TRIP_NAME }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ShareComposerScreen tripSummary variant', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest
      .spyOn(clientModule, 'apiRequest')
      .mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path === '/me/friends') {
          return { friends: [FRIEND], incomingRequests: [], outgoingRequests: [] };
        }
        if (method === 'POST' && path === '/me/shares') {
          return { shareId: 'share-1', deliveredTo: [FRIEND.userId] };
        }
        throw new Error(`unexpected apiRequest ${method} ${path}`);
      });
  });
  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  function postedBody(): unknown {
    const call = apiRequestSpy.mock.calls.find(
      ([method, path]) => method === 'POST' && path === '/me/shares',
    );
    return call?.[2];
  }

  test('previews the trip, shows "Include trip photos" on by default, and states photos come from all crew members next to it', async () => {
    renderComposer();

    expect(await screen.findByTestId('preview-trip-name')).toBeTruthy();
    expect(screen.getByText(TRIP_NAME)).toBeTruthy();
    expect(screen.getByTestId('trip-summary-include-photos-label').props.children).toBe(
      'Include trip photos',
    );
    const toggle = screen.getByTestId('toggle-trip-photos');
    expect(toggle.props.value).toBe(true);
    expect(toggle.props.accessibilityLabel).toBe('Include trip photos');
    expect(toggle.props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('trip-summary-crew-photos-note').props.children).toBe(
      'The recap includes photos from all crew members, not only yours.',
    );
    expect(TRIP_RECAP_CREW_PHOTOS_NOTE).toBe(
      'The recap includes photos from all crew members, not only yours.',
    );
    // No Rating or Note toggles exist for this kind.
    expect(screen.queryByTestId('toggle-rating')).toBeNull();
    expect(screen.queryByTestId('toggle-note')).toBeNull();
  });

  test('Send posts kind tripSummary with the trip id, recipient ids, and includePhotos true, then shows Sent', async () => {
    renderComposer();

    fireEvent.press(await screen.findByText(FRIEND.displayName));
    fireEvent.press(screen.getByLabelText('Send share'));

    await waitFor(() => {
      expect(postedBody()).toEqual({
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND.userId],
        includePhotos: true,
      });
    });
    expect(await screen.findByText('Sent')).toBeTruthy();
    // The body is a pointer: no sharer id, no figures, no photos, no URLs.
    expect(Object.keys(postedBody() as Record<string, unknown>).sort()).toEqual([
      'includePhotos',
      'kind',
      'recipientIds',
      'tripId',
    ]);
  });

  test('toggling "Include trip photos" off sends includePhotos false and updates the switch state', async () => {
    renderComposer();

    fireEvent.press(await screen.findByText(FRIEND.displayName));
    fireEvent(screen.getByTestId('toggle-trip-photos'), 'valueChange', false);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-trip-photos').props.value).toBe(false);
    });
    expect(screen.getByTestId('toggle-trip-photos').props.accessibilityState).toEqual({
      checked: false,
    });

    fireEvent.press(screen.getByLabelText('Send share'));

    await waitFor(() => {
      expect(postedBody()).toEqual({
        kind: 'tripSummary',
        tripId: TRIP_ID,
        recipientIds: [FRIEND.userId],
        includePhotos: false,
      });
    });
  });
});
