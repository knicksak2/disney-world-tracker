/**
 * Inbox rows from a deleted sender (account-deletion R6.4, R6.1; tasks.md 14.4).
 *
 * Real `InboxScreen`, real navigation; only `apiRequest` is mocked. The sender id
 * is a real `generatePlaceholderId` output (the `deadc0de-` alias the server
 * sends for a pending or purged person).
 */

import React from 'react';
import { View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DELETED_USER_DISPLAY_NAME, type InboxItemDTO, type InboxResponse } from '@dwt/shared';

import { generatePlaceholderId } from '../../../../../api/src/services/accountDeletion/placeholderId';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import InboxScreen from '../InboxScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const SENDER_COPY = 'This friend\u2019s profile is no longer available.';
const DELETED_ID = generatePlaceholderId(() => new Uint8Array(16).map((_, i) => (i * 37 + 11) % 256));
const REAL_ID = '11111111-2222-4333-8444-555555555555';
const EXPERIENCE_ID = 'exp-space-mountain-0001';

function base(shareId: string, senderId: string, senderName: string) {
  return {
    shareId,
    read: true,
    senderId,
    senderDisplayName: senderName,
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  } as const;
}

const progressFrom = (shareId: string, senderId: string, name: string): InboxItemDTO => ({
  ...base(shareId, senderId, name),
  payloadKind: 'progress',
  payload: { kind: 'progress', overallPercent: 42.5, perParkPercent: {}, perCategoryPercent: {} },
});

const experienceFrom = (shareId: string, senderId: string, name: string): InboxItemDTO => ({
  ...base(shareId, senderId, name),
  payloadKind: 'experience',
  payload: { kind: 'experience', experienceId: EXPERIENCE_ID },
});

type StackParams = {
  Inbox: { shareId?: string } | undefined;
  FriendProfile: { friendId: string; displayName: string };
  PinShowcase: { userId?: string; readOnly?: boolean };
  ExperienceDetail: { experienceId: string };
};
const Stack = createNativeStackNavigator<StackParams>();
const navRef = createNavigationContainerRef<StackParams>();

function Stub(): JSX.Element {
  return <View />;
}

function renderInbox(items: InboxItemDTO[], deepLinkShareId?: string): void {
  apiRequestMock.mockImplementation((async (_method: string, path: string) => {
    if (path === '/me/inbox') return { unread: 0, items } satisfies InboxResponse;
    if (path === `/catalog/${encodeURIComponent(EXPERIENCE_ID)}`) {
      return { name: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' };
    }
    if (path === '/me/friends') return { friends: [{ userId: REAL_ID }] };
    return null;
  }) as never);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <NavigationContainer ref={navRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="Inbox"
            component={InboxScreen}
            {...(deepLinkShareId !== undefined ? { initialParams: { shareId: deepLinkShareId } } : {})}
          />
          <Stack.Screen name="FriendProfile" component={Stub} />
          <Stack.Screen name="PinShowcase" component={Stub} />
          <Stack.Screen name="ExperienceDetail" component={Stub} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function callsTo(path: string): unknown[][] {
  return apiRequestMock.mock.calls.filter((c) => c[1] === path);
}

describe('Inbox: a Share from a deleted sender', () => {
  let errorSpy: jest.SpyInstance;
  beforeAll(() => {
    const realError = console.error.bind(console);
    errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
      realError(...(args as []));
    });
  });
  afterAll(() => errorSpy.mockRestore());
  beforeEach(() => apiRequestMock.mockReset());

  it('the fixture id really is a placeholder id from the real generator', () => {
    expect(DELETED_ID.startsWith('deadc0de-')).toBe(true);
  });

  it('shows "Deleted user" with an accessibility label that includes it, and the row is NOT a button', async () => {
    const item = progressFrom('s-del', DELETED_ID, DELETED_USER_DISPLAY_NAME);
    renderInbox([item]);

    const sender = await screen.findByTestId('inbox-sender-s-del');
    expect(sender).toHaveTextContent(DELETED_USER_DISPLAY_NAME);
    expect(sender.props.accessibilityLabel).toContain('Deleted user');

    const row = screen.getByTestId('inbox-row-s-del');
    // No pressable wrapper: no role, no handler, no "Open share from" label.
    expect(row.props.accessibilityRole).not.toBe('button');
    expect(row.props.accessibilityLabel).toBeUndefined();
  });

  it('pressing the row of a deleted sender navigates nowhere and does not look the sender up', async () => {
    const item = progressFrom('s-del', DELETED_ID, DELETED_USER_DISPLAY_NAME);
    renderInbox([item]);
    fireEvent.press(await screen.findByTestId('inbox-row-s-del'));

    // Give any (wrong) async navigation a chance to happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(callsTo('/me/friends')).toHaveLength(0);
    expect(callsTo('/me/inbox/s-del/open')).toHaveLength(0);
  });

  it('a deleted sender\u2019s experience Share still opens its experience (content, not a person link)', async () => {
    const item = experienceFrom('s-exp', DELETED_ID, DELETED_USER_DISPLAY_NAME);
    renderInbox([item]);

    const row = await screen.findByTestId('inbox-row-s-exp');
    expect(row.props.accessibilityLabel).toBe('Open share from Deleted user');
    fireEvent.press(row);

    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail'));
    expect(navRef.getCurrentRoute()?.params).toEqual({ experienceId: EXPERIENCE_ID });
  });

  it('control: an ordinary friend\u2019s progress Share is still a button and opens FriendProfile', async () => {
    const item = progressFrom('s-real', REAL_ID, 'Minnie Mouse');
    renderInbox([item]);

    const row = await screen.findByTestId('inbox-row-s-real');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('Open share from Minnie Mouse');
    fireEvent.press(row);

    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('FriendProfile'));
  });

  it('a notification deep link to a deleted sender\u2019s progress Share shows the unavailable message and never reads friends', async () => {
    const item = progressFrom('s-del', DELETED_ID, DELETED_USER_DISPLAY_NAME);
    renderInbox([item], 's-del');

    const message = await screen.findByTestId('inbox-tap-message-s-del');
    expect(message.props.children).toBe(SENDER_COPY);
    expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    expect(callsTo('/me/friends')).toHaveLength(0);
  });
});
