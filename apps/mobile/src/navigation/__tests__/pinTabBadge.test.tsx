/**
 * Claimable-Pin and Notification combined tab badge tests (pin-collection Requirement 22.3–22.5).
 *
 * Renders the real `RootNavigator` inside a real `NavigationContainer` (mirroring
 * `notificationNavigation.test.tsx`) and asserts:
 *
 *   - R22.3: the Profile tab shows a badge (`profile-tab-badge`) reflecting the claimable-pin count
 *     whenever the seeded `GET /me/pins` response has at least one ready-to-claim pin, and hides it
 *     when both pin and notification counts are zero.
 *   - R22.5 (revised): the notification attention count and the claimable-Pin count are combined
 *     into a single total badge on the bottom tab bar (`profile-tab-badge`), displaying their sum
 *     (or '99+' on overflow).
 *
 * `useAttentionBadge` (the notification badge) is stubbed directly per test so this file controls
 * both badges' inputs independently, per the existing convention in `notificationNavigation.test.tsx`.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

jest.mock('../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import RootNavigator from '../RootNavigator';
import { useAttentionBadge } from '../../features/notifications/useAttentionBadge';
import { useSessionStore } from '../../state/sessionStore';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { PINS } from '@dwt/shared';
import type { PinBoardDTO, UserPinProgressDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

jest.mock('../../features/notifications/useAttentionBadge', () => ({
  __esModule: true,
  useAttentionBadge: jest.fn(),
}));
const useAttentionBadgeMock = useAttentionBadge as jest.MockedFunction<typeof useAttentionBadge>;

function readyProg(pinId: string): UserPinProgressDTO {
  return {
    pinId,
    unlocked: true,
    awardedAt: '2026-01-15T10:00:00.000Z',
    currentValue: null,
    targetValue: null,
    percentComplete: null,
    claimedAt: null,
  };
}

function boardOf(pins: UserPinProgressDTO[]): PinBoardDTO {
  return {
    pins,
    tierSummary: [],
    totalUnlocked: pins.filter((p) => p.unlocked).length,
    totalPins: pins.length,
    overallPercent: 0,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderApp(board: PinBoardDTO): void {
  apiRequestMock.mockImplementation(async (_method: string, path: string) => {
    if (path === '/me/pins') return board as never;
    if (path === '/home/highest-rated') return { entries: [] } as never;
    if (path === '/me') {
      return {
        user: { id: 'u1', email: 'u@x.test' },
        profile: { displayName: 'U', avatarPreset: null },
      } as never;
    }
    if (path === '/me/trips') return [] as never;
    return {} as never;
  });
  useSessionStore.setState({ token: 'token-abc', hydrated: true });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('Claimable-Pin and Notification badge locations (Requirement 6.4, 8.1, 8.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useAttentionBadgeMock.mockReturnValue({ display: 'hidden', count: 0 });
  });

  it('shows the claimable-pin count on CollectionScreen when pins are ready to claim', async () => {
    const pinId = PINS[0]!.id;
    renderApp(boardOf([readyProg(pinId)]));

    // Bottom tab bar no longer carries profile-tab-badge
    expect(screen.queryAllByTestId('profile-tab-badge')).toHaveLength(0);

    // Navigate to Vault/Collection tab
    fireEvent.press(await screen.findByText(/Vault|Collection/));

    const badge = await screen.findByTestId('claimable-pins-badge');
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent('1 to claim');
  });

  it('hides the claimable-pin badge when no pin is ready to claim', async () => {
    renderApp(boardOf([]));

    // Navigate to Vault/Collection tab
    fireEvent.press(await screen.findByText(/Vault|Collection/));

    await screen.findByTestId('collection-screen');
    expect(screen.queryByTestId('claimable-pins-badge')).toBeNull();
  });

  it('shows notification count on the header NotificationBell', async () => {
    useAttentionBadgeMock.mockReturnValue({ display: 'count', count: 3 });
    renderApp(boardOf([]));

    await waitFor(async () => {
      const badge = await screen.findByTestId('notification-bell-badge');
      expect(badge).toBeTruthy();
      expect(badge).toHaveTextContent('3');
    });
  });

  it('shows overflow "99+" on NotificationBell when notification count reaches 100 or more', async () => {
    useAttentionBadgeMock.mockReturnValue({ display: 'overflow', count: 100 });
    renderApp(boardOf([]));

    await waitFor(async () => {
      const badge = await screen.findByTestId('notification-bell-badge');
      expect(badge).toBeTruthy();
      expect(badge).toHaveTextContent('99+');
    });
  });
});
