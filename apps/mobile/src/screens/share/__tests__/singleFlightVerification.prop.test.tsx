// Feature: social-sharing-loop, Property 11: Destination verification is single-flight per share
//
// Validates: Requirements 5.7
//
// Property 11 (from design.md → Correctness Properties):
//   While the App is verifying a selected Share's destination it shows a
//   loading indication for that Share and does NOT initiate a second
//   navigation for the same Share until the verification completes (R5.7).
//   Equivalently: for any number of rapid repeated selections of the same
//   Share, the App initiates at most one destination verification and at most
//   one navigation for that Share.
//
// Test strategy:
//   - Drive the real `InboxScreen` render path so the property exercises the
//     production single-flight guard (`verifyingRef` + `verifyingIds`) rather
//     than a stand-in, mirroring the sibling Inbox render properties. Only the
//     lowest-level `apiRequest` is stubbed (the real `ApiError` is preserved),
//     and `useNavigation` is replaced with STABLE `navigate`/`goBack` mocks so
//     the number of initiated navigations can be counted across re-renders.
//   - `apiRequest` serves a single-item `GET /me/inbox` response (an
//     `experience` or `progress` Share), the read-state `POST .../open`, and
//     the destination-verification read for that kind: `GET /catalog/:id` for
//     an `experience` Share (R5.1) or `GET /me/friends` for a `progress` Share
//     (R5.2).
//   - Sub-property 11a (verification RESOLVES): the verification read resolves
//     so the destination is reachable. The row is pressed `k ≥ 2` times in a
//     tight synchronous loop (rapid taps land before the in-flight verification
//     settles). The guard must collapse those `k` taps into exactly ONE
//     navigation for the Share (R5.7 — "SHALL NOT initiate a second
//     navigation … until the verification completes").
//   - Sub-property 11b (verification PENDING): the verification read never
//     settles, modeling an in-flight verification. After `k ≥ 2` taps the row
//     shows its loading indication (`inbox-verifying-<shareId>`, R5.7) and NO
//     navigation is initiated; an unread Share is marked read at most once
//     (`POST .../open` fires exactly once — the guard suppresses the repeats).
//   - fast-check runs at numRuns: 100 per the plan's minimum.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type InboxItemDTO,
  type InboxResponse,
  type Park,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; keep the real `ApiError` (and everything else) so
// the screen's `instanceof ApiError` branches resolve against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// STABLE navigation mocks. `InboxScreen` calls `useNavigation()` on every
// render; returning a fresh object per call would make the initiated-navigation
// count unobservable, so the same `navigate`/`goBack` spies are returned every
// time. The `mock` prefix lets the factory reference them (jest hoist rule).
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useRoute: () => ({ params: undefined }),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import InboxScreen from '../InboxScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const displayNameArb: fc.Arbitrary<string> = fc.constantFrom(
  'Mickey Mouse',
  'Minnie Mouse',
  'Donald Duck',
  'Goofy',
  'Pluto',
);

/**
 * A single Share to render and tap. `read` varies so both the mark-read path
 * (R5.3) and the already-read path are exercised; `taps` is the number of
 * rapid repeated selections (≥ 2 so a second navigation is always possible if
 * the guard fails).
 */
type ShareCase =
  | {
      readonly kind: 'experience';
      readonly shareId: string;
      readonly experienceId: string;
      readonly senderDisplayName: string;
      readonly read: boolean;
      readonly taps: number;
      readonly name: string;
      readonly park: Park;
      readonly category: ExperienceCategory;
    }
  | {
      readonly kind: 'progress';
      readonly shareId: string;
      readonly senderDisplayName: string;
      readonly read: boolean;
      readonly taps: number;
      readonly overallPercent: number;
    };

const experienceCaseArb: fc.Arbitrary<ShareCase> = fc.record({
  kind: fc.constant('experience' as const),
  shareId: fc.uuid(),
  experienceId: fc.uuid(),
  senderDisplayName: displayNameArb,
  read: fc.boolean(),
  taps: fc.integer({ min: 2, max: 6 }),
  name: fc.constantFrom(
    'Space Mountain',
    'Haunted Mansion',
    'Test Track',
    'Be Our Guest',
  ),
  park: parkArb,
  category: categoryArb,
});

const progressCaseArb: fc.Arbitrary<ShareCase> = fc.record({
  kind: fc.constant('progress' as const),
  shareId: fc.uuid(),
  senderDisplayName: displayNameArb,
  read: fc.boolean(),
  taps: fc.integer({ min: 2, max: 6 }),
  overallPercent: fc
    .double({ min: 0, max: 100, noNaN: true })
    .map((n) => Number(n.toFixed(1))),
});

const shareCaseArb: fc.Arbitrary<ShareCase> = fc.oneof(
  experienceCaseArb,
  progressCaseArb,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SENDER_ID = 'sender-1';

function buildResponse(c: ShareCase): InboxResponse {
  const item: InboxItemDTO =
    c.kind === 'experience'
      ? {
          shareId: c.shareId,
          read: c.read,
          senderId: SENDER_ID,
          senderDisplayName: c.senderDisplayName,
          payloadKind: 'experience',
          payload: { kind: 'experience', experienceId: c.experienceId },
          sentAt: '2024-01-02T03:04:05.000Z',
          myReaction: null,
        }
      : {
          shareId: c.shareId,
          read: c.read,
          senderId: SENDER_ID,
          senderDisplayName: c.senderDisplayName,
          payloadKind: 'progress',
          payload: {
            kind: 'progress',
            overallPercent: c.overallPercent,
            perParkPercent: {},
            perCategoryPercent: {},
          },
          sentAt: '2024-01-02T03:04:05.000Z',
          myReaction: null,
        };
  return { unread: c.read ? 0 : 1, items: [item] };
}

/** The destination-verification endpoint the row hits for this Share's kind. */
function verificationPath(c: ShareCase): string {
  return c.kind === 'experience'
    ? `/catalog/${encodeURIComponent(c.experienceId)}`
    : '/me/friends';
}

/** Resolved verification payload making the destination reachable. */
function verificationResolved(c: ShareCase): unknown {
  return c.kind === 'experience'
    ? { name: c.name, park: c.park, category: c.category }
    : { friends: [{ userId: SENDER_ID }] };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function openCallCount(shareId: string): number {
  return apiRequestMock.mock.calls.filter(
    (args) =>
      args[0] === 'POST' &&
      typeof args[1] === 'string' &&
      args[1] === `/me/inbox/${encodeURIComponent(shareId)}/open`,
  ).length;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 11: Destination verification is single-flight per share (R5.7)', () => {
  // The tap-through IIFE settles verification and clears the guard via state
  // updates that can land just after `waitFor` resolves, surfacing benign
  // "not wrapped in act(...)" warnings. They are not failures; filter just that
  // warning so the 100-iteration run stays readable while every other
  // console.error is preserved.
  let errorSpy: jest.SpyInstance;
  beforeAll(() => {
    const realError = console.error.bind(console);
    errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
          return;
        }
        realError(...(args as []));
      });
  });
  afterAll(() => {
    errorSpy.mockRestore();
  });

  afterEach(() => {
    apiRequestMock.mockReset();
    mockNavigate.mockReset();
  });

  // -------------------------------------------------------------------------
  // 11a — rapid repeated taps collapse into exactly one navigation
  // -------------------------------------------------------------------------

  it('initiates exactly one navigation for any number of rapid repeated taps (verification resolves)', async () => {
    await fc.assert(
      fc.asyncProperty(shareCaseArb, async (c) => {
        apiRequestMock.mockReset();
        mockNavigate.mockReset();

        const response = buildResponse(c);
        const verifyPath = verificationPath(c);
        apiRequestMock.mockImplementation((async (method: string, path: string) => {
          if (path === '/me/inbox') return response as never;
          if (path === `/me/inbox/${encodeURIComponent(c.shareId)}/open`) {
            return null as never;
          }
          if (path === verifyPath) return verificationResolved(c) as never;
          throw new Error(`unexpected call: ${method} ${path}`);
        }) as never);

        // Capture the render result in a local and unmount it in `finally` so
        // no un-awaited work from this iteration overlaps the next `render()`
        // under parallel workers.
        const view = render(
          <QueryClientProvider client={makeQueryClient()}>
            <InboxScreen />
          </QueryClientProvider>,
        );
        try {
          const row = await view.findByTestId(`inbox-row-${c.shareId}`);

          // Rapid repeated taps in a tight synchronous loop: every tap after the
          // first lands while the first verification is still in flight (its
          // resolution is a microtask that cannot run until this loop unwinds),
          // so the single-flight guard must suppress them.
          for (let i = 0; i < c.taps; i += 1) {
            fireEvent.press(row);
          }

          // R5.7: exactly one navigation is initiated for the Share despite the
          // repeated taps.
          await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledTimes(1);
          });
          if (c.kind === 'experience') {
            expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
              experienceId: c.experienceId,
            });
          } else {
            expect(mockNavigate).toHaveBeenCalledWith('FriendProfile', {
              friendId: SENDER_ID,
              displayName: c.senderDisplayName,
              initialSection: 'comparison',
            });
          }

          // R5.3: an unread Share is marked read at most once regardless of the
          // repeated taps; an already-read Share is never re-opened.
          expect(openCallCount(c.shareId)).toBe(c.read ? 0 : 1);
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 180_000);

  // -------------------------------------------------------------------------
  // 11b — while verification is in flight: loading shown, no navigation
  // -------------------------------------------------------------------------

  it('shows a loading indication and initiates no navigation while verification is in flight', async () => {
    await fc.assert(
      fc.asyncProperty(shareCaseArb, async (c) => {
        apiRequestMock.mockReset();
        mockNavigate.mockReset();

        const response = buildResponse(c);
        const verifyPath = verificationPath(c);
        apiRequestMock.mockImplementation(((method: string, path: string) => {
          if (path === '/me/inbox') return Promise.resolve(response) as never;
          if (path === `/me/inbox/${encodeURIComponent(c.shareId)}/open`) {
            return Promise.resolve(null) as never;
          }
          // Verification never settles → the destination stays "in flight".
          if (path === verifyPath) return new Promise<never>(() => {}) as never;
          throw new Error(`unexpected call: ${method} ${path}`);
        }) as never);

        // Capture the render result in a local and unmount it in `finally` so
        // no un-awaited work from this iteration overlaps the next `render()`
        // under parallel workers.
        const view = render(
          <QueryClientProvider client={makeQueryClient()}>
            <InboxScreen />
          </QueryClientProvider>,
        );
        try {
          const row = await view.findByTestId(`inbox-row-${c.shareId}`);

          for (let i = 0; i < c.taps; i += 1) {
            fireEvent.press(row);
          }

          // R5.7: the row shows a loading indication for the Share whose
          // destination is being verified.
          await waitFor(() => {
            expect(
              view.queryByTestId(`inbox-verifying-${c.shareId}`),
            ).not.toBeNull();
          });

          // R5.7: no navigation is initiated while the verification is in flight,
          // no matter how many times the row was tapped.
          expect(mockNavigate).not.toHaveBeenCalled();

          // R5.3 + single-flight: an unread Share is marked read at most once;
          // the repeated taps are suppressed by the guard.
          await waitFor(() => {
            expect(openCallCount(c.shareId)).toBe(c.read ? 0 : 1);
          });
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 180_000);
});
