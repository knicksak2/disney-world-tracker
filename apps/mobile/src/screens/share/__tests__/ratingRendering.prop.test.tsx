// Feature: social-sharing-loop, Property 7: Inbox rating rendering matches payload rating state
//
// Validates: Requirements 4.4, 4.5, 4.6
//
// Property 7 (from design.md → Correctness Properties):
//   For any Experience_Share, the Inbox renders the sender's Rating as a whole
//   number 1–10 when the payload carries a numeric Rating (R4.4), a
//   rating-unavailable indication when the payload marks the Rating as
//   unavailable (R4.5), and NO Rating at all when the payload carries neither a
//   numeric Rating nor the unavailable marker (R4.6).
//
// Test strategy:
//   - Drive the real InboxScreen render path so the property exercises the
//     production rating branch (`ExperienceRatingNote`) rather than a stand-in,
//     mirroring the sibling `resolvedMetadataRendering.prop.test.tsx`. The
//     lowest level `apiRequest` is stubbed to (a) return a single `experience`
//     inbox item from `GET /me/inbox` and (b) resolve that Experience's
//     metadata from `GET /catalog/:experienceId` so the row settles into its
//     resolved state and the rating/note block renders deterministically.
//   - `useNavigation` is stubbed so the screen mounts without a real navigator;
//     every other hook (React Query) runs for real under a fresh client.
//   - The generator produces the three mutually exclusive rating states as a
//     tagged variant so each run asserts exactly one expected outcome:
//       * `present`    → `rating` is an integer 1..10           (R4.4)
//       * `unavailable`→ `rating: null, ratingUnavailable: true`(R4.5)
//       * `absent`     → neither a numeric Rating nor the marker (R4.6)
//     The `absent` variant also covers the equivalent shapes the payload can
//     take (`{}`, `{ ratingUnavailable: false }`, `{ rating: null }`) so the
//     "render nothing" branch is exercised across all of them.
//   - The Note state is crossed in independently (present or absent) so the
//     property proves the rating rendering is decided solely by the rating
//     fields, never by the presence of a Note.
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

// The copy the row renders when the payload marks the Rating unavailable
// (R4.5). Mirrors `RATING_UNAVAILABLE_COPY` in InboxScreen.
const RATING_UNAVAILABLE_COPY = 'Rating unavailable';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const experienceNameArb: fc.Arbitrary<string> = fc.constantFrom(
  'Space Mountain',
  'Haunted Mansion',
  'Pirates of the Caribbean',
  'Test Track',
  'Be Our Guest',
);

// The three mutually exclusive rating states, tagged so each run can assert the
// single expected outcome. Each carries the payload fragment it maps to.
type RatingCase =
  | { readonly variant: 'present'; readonly rating: number; readonly fields: Partial<ExperienceSharePayload> }
  | { readonly variant: 'unavailable'; readonly fields: Partial<ExperienceSharePayload> }
  | { readonly variant: 'absent'; readonly fields: Partial<ExperienceSharePayload> };

const presentRatingArb: fc.Arbitrary<RatingCase> = fc
  .integer({ min: 1, max: 10 })
  .map((rating) => ({ variant: 'present' as const, rating, fields: { rating } }));

const unavailableRatingArb: fc.Arbitrary<RatingCase> = fc.constant({
  variant: 'unavailable' as const,
  fields: { rating: null, ratingUnavailable: true },
});

// The "render nothing" state (R4.6) has several equivalent payload shapes: no
// rating fields at all, an explicit `ratingUnavailable: false`, or a `null`
// rating without the unavailable marker. All must render no Rating.
const absentRatingArb: fc.Arbitrary<RatingCase> = fc
  .constantFrom<Partial<ExperienceSharePayload>>(
    {},
    { ratingUnavailable: false },
    { rating: null },
    { rating: null, ratingUnavailable: false },
  )
  .map((fields) => ({ variant: 'absent' as const, fields }));

const ratingCaseArb: fc.Arbitrary<RatingCase> = fc.oneof(
  presentRatingArb,
  unavailableRatingArb,
  absentRatingArb,
);

// Note state, crossed in independently (R4.7/R4.8) so the property proves the
// rating rendering does not depend on the Note.
const noteStateArb: fc.Arbitrary<Partial<ExperienceSharePayload>> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0)
    .map((note) => ({ note })),
  fc.constant<Partial<ExperienceSharePayload>>({}),
);

interface RatingRenderCase {
  readonly shareId: string;
  readonly experienceId: string;
  readonly senderDisplayName: string;
  readonly read: boolean;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly ratingCase: RatingCase;
  readonly payload: ExperienceSharePayload;
}

const ratingRenderCaseArb: fc.Arbitrary<RatingRenderCase> = fc
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
    ratingCase: ratingCaseArb,
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
    ratingCase: r.ratingCase,
    payload: {
      kind: 'experience',
      experienceId: r.experienceId,
      ...r.ratingCase.fields,
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

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 7: Inbox rating rendering matches payload rating state (R4.4, R4.5, R4.6)', () => {
  // The Inbox's 10-second metadata window arms a `setTimeout` and a trailing
  // React Query notify can land just after `findBy*` resolves; both surface as
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

  it('renders the Rating as N/10 when present, a rating-unavailable indication when marked unavailable, and nothing otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(ratingRenderCaseArb, async (c) => {
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
            // Resolve the Experience metadata so the row settles into its
            // resolved state and the rating/note block renders deterministically.
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
          // Wait for the row to resolve so the rating/note block has rendered.
          await view.findByTestId(`inbox-experience-name-${c.shareId}`);

          const ratingTestId = `inbox-experience-rating-${c.shareId}`;
          const unavailableTestId = `inbox-experience-rating-unavailable-${c.shareId}`;

          if (c.ratingCase.variant === 'present') {
            // R4.4: the sender's Rating renders as the whole number 1–10.
            const ratingNode = view.getByTestId(ratingTestId);
            expect(ratingNode.props.children).toBe(
              `Rating: ${c.ratingCase.rating}/10`,
            );
            // The unavailable indication must NOT also appear.
            expect(view.queryByTestId(unavailableTestId)).toBeNull();
          } else if (c.ratingCase.variant === 'unavailable') {
            // R4.5: a rating-unavailable indication renders.
            const unavailableNode = view.getByTestId(unavailableTestId);
            expect(unavailableNode.props.children).toBe(RATING_UNAVAILABLE_COPY);
            // The numeric Rating must NOT appear.
            expect(view.queryByTestId(ratingTestId)).toBeNull();
          } else {
            // R4.6: neither a Rating nor an unavailable indication renders.
            expect(view.queryByTestId(ratingTestId)).toBeNull();
            expect(view.queryByTestId(unavailableTestId)).toBeNull();
            // Belt and braces: the unavailable copy never appears anywhere.
            expect(view.queryByText(RATING_UNAVAILABLE_COPY)).toBeNull();
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 180_000);
});
