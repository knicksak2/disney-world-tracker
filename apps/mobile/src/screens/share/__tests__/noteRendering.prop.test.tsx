// Feature: social-sharing-loop, Property 8: Inbox note rendering matches payload note state
//
// Validates: Requirements 4.7, 4.8
//
// Property 8 (from design.md → Correctness Properties):
//   For any Experience_Share, the Inbox shows the sender's complete Note text
//   (bounded to ≤2000 chars by the payload schema) exactly when the payload
//   carries a Note (R4.7), and shows no Note when the payload carries none
//   (R4.8). Note rendering is independent of the row's Rating state, which the
//   generator therefore varies freely.
//
// Test strategy:
//   - This is a render property over the real `InboxScreen`, so it mirrors the
//     render-based property pattern used by the sibling inbox tests
//     (`inboxDisclosure.prop.test.tsx`, `resolvedMetadataRendering.prop.test.tsx`):
//     only the lowest-level `apiRequest` is stubbed, the real `ApiError` is
//     preserved, and the `useNavigation` hook is replaced so the screen mounts
//     standalone without a real navigator.
//   - The React Query cache is pre-seeded with the inbox response (key
//     `['inbox']`) and the referenced Experience's resolved catalog metadata
//     (key `['experience', experienceId]`, shared with `ExperienceDetailScreen`)
//     with `staleTime: Infinity`, so the first render is fully synchronous and
//     deterministic and the metadata block resolves straight to the name rather
//     than sitting in the 10-second loading window. The Note (`ExperienceRatingNote`)
//     renders below that block regardless of the metadata state.
//   - Generators cross a Note state (present with a 1..2000-char body — including
//     the 2000-char boundary, multi-line and unicode bodies — or absent) with an
//     arbitrary Rating state so Note rendering is exercised independently of the
//     Rating block.
//   - For a present Note (R4.7): the note node (`inbox-experience-note-${shareId}`)
//     exists and its rendered text equals the complete payload Note verbatim, with
//     no truncation.
//   - For an absent Note (R4.8): no note node exists for that share.
//   - fast-check runs at numRuns: 100 per the plan's minimum.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
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

// In-memory `expo-secure-store` — the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL, read by the client at load time.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` and everything else.
// The cache is pre-seeded so the render path never actually needs the network,
// but a stray call rejects loudly rather than hangs the render.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(() =>
      Promise.reject(
        new Error('apiRequest should not be called in the pre-seeded render property'),
      ),
    ),
  };
});

// The screen calls `useNavigation()` for its header back control. These render
// property runs mount the screen standalone (no navigator), so stub the hook.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

// ---------------------------------------------------------------------------
// Module under test (after the mocks above).
// ---------------------------------------------------------------------------

import InboxScreen from '../InboxScreen';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

// A Note body that a valid `experience` payload can carry: trimmed, 1..2000
// characters (the payload schema's `noteBodySchema` bound, R4.7). Blends
// short arbitrary strings, multi-line/unicode bodies, and the 2000-char
// boundary so the "complete text, no truncation" guarantee is exercised at
// the limit.
const noteBodyArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 300 })
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      'Loved this one!\nGo at rope drop.',
      'Best ride in the park 🎢✨ — must do twice',
      'Line was long but so worth it. 10/10 would wait again.',
    ),
  },
  {
    // The upper boundary (R4.7 "up to 2000 characters"): the full body must
    // render untruncated.
    weight: 1,
    arbitrary: fc
      .integer({ min: 1990, max: 2000 })
      .map((len) => 'x'.repeat(len)),
  },
);

// Rating state of an `experience` payload (R4.4/R4.5/R4.6), varied so Note
// rendering is shown to be independent of the Rating block.
const ratingStateArb: fc.Arbitrary<Partial<ExperienceSharePayload>> = fc.oneof(
  fc.integer({ min: 1, max: 10 }).map((rating) => ({ rating })),
  fc.constant<Partial<ExperienceSharePayload>>({
    rating: null,
    ratingUnavailable: true,
  }),
  fc.constant<Partial<ExperienceSharePayload>>({}),
);

// Note state: present (a valid ≤2000-char body, R4.7) or absent (R4.8).
const noteStateArb: fc.Arbitrary<{ note?: string }> = fc.oneof(
  noteBodyArb.map((note) => ({ note })),
  fc.constant<{ note?: string }>({}),
);

interface NoteCase {
  readonly shareId: string;
  readonly experienceId: string;
  readonly senderDisplayName: string;
  readonly read: boolean;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly payload: ExperienceSharePayload;
  readonly note: string | undefined;
}

const noteCaseArb: fc.Arbitrary<NoteCase> = fc
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
    name: fc.constantFrom(
      'Space Mountain',
      'Haunted Mansion',
      'Test Track',
      'Be Our Guest',
    ),
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
    note: r.noteState.note,
    payload: {
      kind: 'experience',
      experienceId: r.experienceId,
      ...r.ratingState,
      ...r.noteState,
    } as ExperienceSharePayload,
  }));

// ---------------------------------------------------------------------------
// Render helper — pre-seed the cache so the first render is synchronous
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderInbox(c: NoteCase): ReturnType<typeof render> {
  const client = makeQueryClient();
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
  // Seed the inbox read (key `['inbox']`) and the referenced Experience's
  // catalog metadata (key `['experience', experienceId]`) so the list and the
  // row's metadata block resolve on the first synchronous render.
  client.setQueryData(['inbox'], response);
  client.setQueryData(['experience', c.experienceId], {
    name: c.name,
    park: c.park,
    category: c.category,
  });
  return render(
    <QueryClientProvider client={client}>
      <InboxScreen />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 8: Inbox note rendering matches payload note state (R4.7, R4.8)', () => {
  test('renders the complete Note when present and nothing when absent', () => {
    fc.assert(
      fc.property(noteCaseArb, (c) => {
        const view = renderInbox(c);
        try {
          const noteTestId = `inbox-experience-note-${c.shareId}`;

          if (typeof c.note === 'string') {
            // R4.7: the Note node exists and shows the sender's complete Note
            // text verbatim — untruncated, even at the 2000-char boundary.
            const noteNode = view.getByTestId(noteTestId);
            expect(noteNode.props.children).toBe(c.note);
          } else {
            // R4.8: no Note is displayed for a Share whose payload carries none.
            expect(view.queryByTestId(noteTestId)).toBeNull();
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
