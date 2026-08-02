/**
 * Trip_Members section — screen tests (tasks 17.10, 17.12).
 *
 * Validates: Requirements 18.1, 4.5, 4.6, 6.1, 6.4, 6.5, 6.8, 8.1, 8.2, 15.2
 *
 * The Members screen reads `GET /trips/:id/members` (+ `GET /me` to gate
 * self-scoped controls) and, for an Organizer, `GET /trips/:id/invites`. It
 * renders every Member with their role; an Organizer additionally gets promote
 * (on a `member`), demote (on an `organizer`), and remove controls per other
 * Member, and the caller gets a Leave control for themselves. An Organizer can
 * invite a Friend who is not already a Member (R6.4) and has no pending invite
 * (R6.5); outstanding invites are listed with a Cancel control (R6.8). A
 * duplicate-invite rejection surfaces friendly copy (the stale-pending-invite
 * case).
 *
 * The screen consumes `navigation`/`route` from props, so it renders directly
 * with a stubbed navigation object; only `apiRequest` is mocked, dispatched by
 * method + path.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import TripMembersScreen from '../TripMembersScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripMemberDTO, TripPendingInviteDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';
const OWN_ID = 'user-own';
const MEMBER_ID = 'user-member';
const ORG2_ID = 'user-org2';
const FRIEND_ID = 'user-friend';

const ORGANIZER_ROSTER: TripMemberDTO[] = [
  { userId: OWN_ID, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
  { userId: MEMBER_ID, displayName: 'Eric', avatarPreset: null, role: 'member' },
  { userId: ORG2_ID, displayName: 'Sebastian', avatarPreset: null, role: 'organizer' },
];

/** Caller is a plain member (no organizer controls). */
const MEMBER_ROSTER: TripMemberDTO[] = [
  { userId: ORG2_ID, displayName: 'Sebastian', avatarPreset: null, role: 'organizer' },
  { userId: OWN_ID, displayName: 'Ariel', avatarPreset: null, role: 'member' },
];

const PENDING_INVITE: TripPendingInviteDTO = {
  inviteId: 'invite-1',
  inviteeId: FRIEND_ID,
  inviteeDisplayName: 'Flounder',
  inviteeAvatarPreset: null,
};

const FRIENDS_RESPONSE = {
  friends: [
    {
      userId: FRIEND_ID,
      displayName: 'Flounder',
      avatarPreset: null,
      establishedAt: '2024-01-01T00:00:00Z',
    },
    // Already a Member — must be excluded from the picker (R6.4).
    {
      userId: MEMBER_ID,
      displayName: 'Eric',
      avatarPreset: null,
      establishedAt: '2024-01-01T00:00:00Z',
    },
  ],
  incomingRequests: [],
  outgoingRequests: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Handlers {
  readonly members?: () => Promise<unknown>;
  readonly invites?: () => Promise<unknown>;
  readonly friends?: () => Promise<unknown>;
  readonly mutate?: (method: string, path: string, body?: unknown) => Promise<unknown>;
}

/** Wire the `apiRequest` mock to dispatch by method + path. */
function installApi(roster: TripMemberDTO[], handlers: Handlers = {}): void {
  apiRequestMock.mockImplementation(
    async (method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/me') {
        return { user: { id: OWN_ID } };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) {
        return handlers.members ? await handlers.members() : roster;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/invites`) {
        return handlers.invites ? await handlers.invites() : [];
      }
      if (method === 'GET' && path === '/me/friends') {
        return handlers.friends ? await handlers.friends() : FRIENDS_RESPONSE;
      }
      if (handlers.mutate) {
        return handlers.mutate(method, path, body);
      }
      throw new Error(`unexpected apiRequest ${method} ${path}`);
    },
  );
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): { navigate: jest.Mock; goBack: jest.Mock; canGoBack: jest.Mock } {
  return { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
}

/**
 * Flush any pending query state (e.g. the Organizer-gated invites read settling
 * to `[]`) inside `act` so a background React Query notify does not fire after
 * the test returns and trip the "update not wrapped in act(...)" warning.
 */
async function flushPending(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderMembers(
  navigation: ReturnType<typeof makeNavigation>,
): ReturnType<typeof render> {
  const props = {
    navigation,
    route: { key: 'TripMembers-1', name: 'TripMembers', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripMembersScreen>;

  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripMembersScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Members screen', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R4.5/R4.6/R8.2: an Organizer sees promote on a member, demote on an organizer, remove on others, and Leave on self', async () => {
    installApi(ORGANIZER_ROSTER);

    renderMembers(makeNavigation());

    expect(await screen.findByTestId(`trip-member-${MEMBER_ID}`)).toBeTruthy();
    // Invite entry point is visible for an Organizer.
    expect(screen.getByTestId('trip-members-invite-open')).toBeTruthy();
    // A `member` target offers promote; an `organizer` target offers demote.
    expect(screen.getByTestId(`trip-member-promote-${MEMBER_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`trip-member-demote-${ORG2_ID}`)).toBeTruthy();
    // Remove is offered on both other Members.
    expect(screen.getByTestId(`trip-member-remove-${MEMBER_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`trip-member-remove-${ORG2_ID}`)).toBeTruthy();
    // The caller sees Leave on their own row, and no self-management controls.
    expect(screen.getByTestId('trip-members-leave')).toBeTruthy();
    expect(screen.queryByTestId(`trip-member-promote-${OWN_ID}`)).toBeNull();
    expect(screen.queryByTestId(`trip-member-remove-${OWN_ID}`)).toBeNull();

    await flushPending();
  });

  test('R4.5: promoting a member calls the promote endpoint', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi(ORGANIZER_ROSTER, { mutate });

    renderMembers(makeNavigation());
    fireEvent.press(await screen.findByTestId(`trip-member-promote-${MEMBER_ID}`));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/members/${MEMBER_ID}/promote`,
        undefined,
      );
    });

    await flushPending();
  });

  test('R8.1: leaving calls the leave endpoint and returns to the trips list', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi(ORGANIZER_ROSTER, { mutate });
    const navigation = makeNavigation();

    renderMembers(navigation);
    fireEvent.press(await screen.findByTestId('trip-members-leave'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/leave`, undefined);
    });
    expect(navigation.navigate).toHaveBeenCalledWith('TripsList');

    await flushPending();
  });

  test('a plain Member sees no invite entry point or organizer controls, only Leave, and never reads invites', async () => {
    installApi(MEMBER_ROSTER);

    renderMembers(makeNavigation());

    expect(await screen.findByTestId('trip-members-leave')).toBeTruthy();
    expect(screen.queryByTestId('trip-members-invite-open')).toBeNull();
    expect(screen.queryByTestId(`trip-member-promote-${ORG2_ID}`)).toBeNull();
    expect(screen.queryByTestId(`trip-member-remove-${ORG2_ID}`)).toBeNull();
    // The Organizer-gated invites read must not fire for a plain Member.
    expect(
      apiRequestMock.mock.calls.some(
        ([, path]) => path === `/trips/${TRIP_ID}/invites`,
      ),
    ).toBe(false);

    await flushPending();
  });

  test('R6.8: an outstanding pending invite is listed with a working Cancel control', async () => {
    const mutate = jest.fn().mockResolvedValue(undefined);
    installApi(ORGANIZER_ROSTER, {
      invites: async () => [PENDING_INVITE],
      mutate,
    });

    renderMembers(makeNavigation());

    expect(
      await screen.findByTestId(`trip-invite-${PENDING_INVITE.inviteId}`),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId(`trip-invite-cancel-${PENDING_INVITE.inviteId}`));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/invites/${PENDING_INVITE.inviteId}/cancel`,
        undefined,
      );
    });

    await flushPending();
  });

  test('R6.4/R6.5: the invite picker excludes Members and already-invited Friends and sends the invite', async () => {
    const mutate = jest
      .fn()
      .mockResolvedValue({ inviteId: 'invite-2', tripId: TRIP_ID, inviterId: OWN_ID, inviteeId: FRIEND_ID });
    installApi(ORGANIZER_ROSTER, {
      invites: async () => [], // no pending invites yet, so FRIEND_ID is eligible
      mutate,
    });

    renderMembers(makeNavigation());
    fireEvent.press(await screen.findByTestId('trip-members-invite-open'));

    // Only the non-member, un-invited Friend appears as a candidate.
    expect(
      await screen.findByTestId(`trip-members-invite-candidate-${FRIEND_ID}`),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`trip-members-invite-candidate-${MEMBER_ID}`),
    ).toBeNull();

    fireEvent.press(screen.getByTestId(`trip-members-invite-candidate-${FRIEND_ID}`));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/invites`, {
        userId: FRIEND_ID,
      });
    });

    await flushPending();
  });

  test('a duplicate-invite rejection surfaces friendly copy (stale pending invite)', async () => {
    const mutate = jest.fn().mockRejectedValue(
      new ApiError({
        code: 'trip_invite_duplicate',
        message: 'duplicate',
        status: 409,
      }),
    );
    installApi(ORGANIZER_ROSTER, { invites: async () => [], mutate });

    renderMembers(makeNavigation());
    fireEvent.press(await screen.findByTestId('trip-members-invite-open'));
    fireEvent.press(
      await screen.findByTestId(`trip-members-invite-candidate-${FRIEND_ID}`),
    );

    expect(await screen.findByTestId('trip-members-invite-error')).toBeTruthy();

    await flushPending();
  });

  test('R15.2: a failed roster read shows an error with a Retry control', async () => {
    installApi(ORGANIZER_ROSTER, {
      members: async () => {
        throw new ApiError({ code: 'trip_forbidden', message: 'forbidden', status: 403 });
      },
    });

    renderMembers(makeNavigation());

    expect(await screen.findByTestId('trip-members-error')).toBeTruthy();
    expect(screen.getByTestId('trip-members-retry')).toBeTruthy();

    await flushPending();
  });
});
