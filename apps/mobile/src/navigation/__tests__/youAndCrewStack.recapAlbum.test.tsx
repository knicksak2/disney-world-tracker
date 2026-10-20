/**
 * The real YouAndCrewStack registers the TripRecapAlbum route (photo-uploads D35, R15.31).
 *
 * A fake harness cannot catch a missing registration, so this renders the real stack with the
 * album route as its initial state and only `apiRequest` stubbed.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import YouAndCrewStack from '../YouAndCrewStack';
import { apiRequest as mockedApiRequest } from '../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

describe('YouAndCrewStack registers TripRecapAlbum', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('renders the album screen for the TripRecapAlbum route and requests the share photos', async () => {
    apiRequestMock.mockResolvedValue({
      access: 'granted',
      photos: [
        {
          id: 'photo-1',
          thumbUrl: 'https://r2.test/p/photo-1/thumb.jpg',
          url: 'https://r2.test/p/photo-1/full.jpg',
          width: 800,
          height: 600,
          sortAt: '2026-05-02T01:30:00.000Z',
        },
      ],
      nextCursor: null,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <NavigationContainer
          initialState={{
            routes: [{ name: 'TripRecapAlbum', params: { shareId: 's1', tripName: 'T' } }],
          }}
        >
          <YouAndCrewStack />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('trip-recap-album-list')).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/inbox/s1/trip-recap/photos');
    expect(screen.getByText('All trip photos')).toBeTruthy();
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.getByTestId('photo-grid-tile-photo-1')).toBeTruthy();
  });
});
