// Feature: social-sharing-loop, Property 6: Inbox renders resolved Experience metadata and never the raw identifier
//
// Validates: Requirements 4.2, 4.3
//
// Property 6 (from design.md → Correctness Properties):
//   For any Experience_Share whose Experience metadata has been resolved, the
//   rendered row shows the Experience's name, Park, and Experience_Category,
//   and never uses the raw internal identifier as the primary label.
//
// Test strategy:
//   - Drive the real InboxScreen render path so the property exercises the
//     production resolution logic (`ExperienceShareContent` → deduplicated
//     `GET /catalog/:experienceId` read) rather than a stand-in. The lowest
//     level `apiRequest` is stubbed to (a) return a single `experience` inbox
//     item from `GET /me/inbox` and (b) resolve that Experience's metadata
//     from `GET /catalog/:experienceId`, mirroring the sibling screen tests.
//   - `useNavigation` is stubbed so the screen mounts without a real navigator;
//     every other hook (React Query) runs for real under a fresh client.
//   - Generators cross an arbitrary Experience metadata triple (a non-empty
//     name distinct from the raw uuid identifier, any Park, any
//     Experience_Category) with arbitrary Rating/Note payload states, so the
//     "remaining Share content" varies independently of the metadata block.
//   - For every generated case the resolved row must (R4.2) show the resolved
//     name as its primary label plus the "Park · Category" context line, and
//     (R4.3) never surface the raw internal identifier — neither as the primary
//     label nor anywhere else in the row, and never fall back to the
//     Experience-unavailable label.
//   - fast-check runs at numRuns: 100 per the plan's minimum.

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type ExperienceSharePayload,
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

// InboxScreen reaches React Navigation only through `useNavigation` (for the
// header back control). Preserve the rest of the module for the theme
// components and stub the hook so the screen mounts without a real navigator.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
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

// A non-empty Experience name: a blend of real-looking names and arbitrary
// strings, each retaining a non-whitespace character. Kept short so it cannot
// collide with the raw uuid identifier used below.
const experienceNameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      'Space Mountain',
      'Haunted Mansion',
      'Pirates of the Caribbean',
      'Test Track',
      'Be Our Guest',
      "It's a Small World",
    ),
  },
  {
    weight: 3,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 24 })
      .filter((s) => s.trim().length > 0),
  },
);

// Rating states of an `experience` payload (R4.4/R4.5/R4.6): a whole 1–10, the
// marked-unavailable state, or absent. Varying this exercises the "remaining
// Share content" independently of the metadata block under test.
const ratingStateArb: fc.Arbitrary<Partial<ExperienceSharePayload>> = fc.oneof(
  fc.integer({ min: 1, max: 10 }).map((rating) => ({ rating })),
  fc.constant<Partial<ExperienceSharePayload>>({
    rating: null,
    ratingUnavailable: true,
  }),
  fc.constant<Partial<ExperienceSharePayload>>({}),
);

// Note state (R4.7/R4.8): present (≤2000 chars) or absent.
const noteStateArb: fc.Arbitrary<Partial<ExperienceSharePayload>> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.length > 0)
    .map((note) => ({ note })),
  fc.constant<Partial<ExperienceSharePayload>>({}),
);

interface ResolvedCase {
  readonly shareId: string;
  readonly experienceId: string;
  readonly senderDisplayName: string;
  readonly read: boolean;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly payload: ExperienceSharePayload;
}

const resolvedCaseArb: fc.Arbitrary<ResolvedCase> = fc
  .record({
    shareId: fc.uuid(),
    experienceId: fc.uuid(),
    senderDisplayName: fc.constantFrom(
      'Mickey Mouse',
      'Minnie Mouse',
      'Donald Duck',
      'Goofy',
    ),
    read: fc.boolean(),
    name: experienceNameArb,
    park: parkArb,
    category: categoryArb,
    ratingState: ratingStateArb,
    noteState: noteStateArb,
  })
  .map((r) => ({
    shareId: r.shareId,
    experienceId: r.experienceId,
    senderDisplayName: r.senderDisplayName,
    read: r.read,
    name: r.name,
    park: r.park,
    category: r.category,
    payload: {
      kind: 'experience',
      experienceId: r.experienceId,
      ...r.ratingState,
      ...r.noteState,
    } as ExperienceSharePayload,
  }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** The context line the row renders for resolved metadata: "Park · Category". */
function expectedContext(park: Park, category: ExperienceCategory): string {
  return `${park} \u00b7 ${category.replace(/_/g, ' ')}`;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 6: Inbox renders resolved Experience metadata and never the raw identifier (R4.2, R4.3)', () => {
  // The Inbox's 10-second metadata window arms a `setTimeout` and a trailing
  // React Query notify can land just after `waitFor` resolves; both surface as
  // benign "not wrapped in act(...)" warnings. They are not failures, but the
  // stack traces flood output and slow the 100-iteration run, so filter just
  // that warning while leaving every other console.error intact.
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
  });

  it('shows the resolved name/Park/Category and never the raw identifier', async () => {
    await fc.assert(
      fc.asyncProperty(resolvedCaseArb, async (c) => {
        apiRequestMock.mockReset();
        apiRequestMock.mockImplementation(async (_method, path) => {
          if (path === '/me/inbox') {
            const response: InboxResponse = {
              unread: c.read ? 0 : 1,
              items: [
                {
                  shareId: c.shareId,
                  read: c.read,
                  senderId: 'sender-1',
                  senderDisplayName: c.senderDisplayName,
                  payloadKind: 'experience',
                  payload: c.payload,
                  sentAt: '2024-01-02T03:04:05.000Z',
                  myReaction: null,
                },
              ],
            };
            return response as never;
          }
          if (path === `/catalog/${encodeURIComponent(c.experienceId)}`) {
            // Resolved metadata for the referenced Experience (R4.2).
            return { name: c.name, park: c.park, category: c.category } as never;
          }
          throw new Error(`unexpected call to ${String(path)}`);
        });

        // Capture the render result in a local and unmount it in `finally` so
        // no un-awaited work from this iteration overlaps the next `render()`
        // under parallel workers.
        const view = render(
          <QueryClientProvider client={makeQueryClient()}>
            <InboxScreen />
          </QueryClientProvider>,
        );
        try {
          // R4.2: the row resolves and shows the Experience name as its primary
          // label. Wait for the resolved-name node to appear.
          const nameNode = await view.findByTestId(
            `inbox-experience-name-${c.shareId}`,
          );

          // The primary label is the resolved name — never the raw identifier
          // (R4.3).
          expect(nameNode.props.children).toBe(c.name);
          expect(nameNode.props.children).not.toBe(c.experienceId);

          // R4.2: the Park and Experience_Category are shown on the context line.
          const contextNode = view.getByTestId(
            `inbox-experience-context-${c.shareId}`,
          );
          expect(contextNode.props.children).toBe(
            expectedContext(c.park, c.category),
          );

          // R4.3: the raw internal identifier never appears anywhere in the row,
          // and the row never falls back to the Experience-unavailable label when
          // metadata has resolved.
          expect(view.queryByText(c.experienceId)).toBeNull();
          expect(
            view.queryByTestId(`inbox-experience-unavailable-${c.shareId}`),
          ).toBeNull();
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 180_000);
});
