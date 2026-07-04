// Feature: social-sharing-loop, Property 10: Opening an unread share marks it read and decrements the unread count
//
// Validates: Requirements 5.3
//
// Property 10 (from design.md → Correctness Properties):
//   For any Inbox of delivered Shares with any mix of Read_State, selecting a
//   Share whose Read_State is `unread` sets that Share's Read_State to `read`
//   and decrements the Inbox unread count by exactly one; selecting a Share
//   that is already `read` leaves the unread count unchanged (R5.3 — the open
//   affects only the tapped unread Share).
//
// Test strategy:
//   - This is a render + interaction property over `InboxScreen`, so it mirrors
//     the render-based property pattern used elsewhere in the mobile suite
//     (e.g. `inboxDisclosure.prop.test.tsx`): only the lowest-level
//     `apiRequest` is stubbed, `ApiError` is preserved, and the React
//     Navigation hook the screen depends on (`useNavigation`) is replaced so
//     the screen renders standalone without mounting a real navigator.
//   - Generate a non-empty `InboxResponse` whose `items` are an
//     arbitrary-length mix of `experience` and `progress` payloads with
//     arbitrary `read` flags, plus a chosen tap index. The item at the tap
//     index is forced `unread` so every run exercises a genuine unread→read
//     transition (R5.3). Each item gets a unique `shareId` and, for experience
//     items, a unique `experienceId`.
//   - Pre-seed the React Query cache with the inbox response (key `['inbox']`),
//     every experience item's resolved catalog metadata (key
//     `['experience', experienceId]`), and the friends snapshot (key
//     `['friends']`) so the first render is synchronous and the tap-through
//     destination verification (R5.1/R5.2) resolves from cache without a
//     network round-trip. Navigation itself is a no-op stub — this property is
//     about read-state and the unread count, not the destination.
//   - The `apiRequest` stub is stateful: `GET /me/inbox` returns the current
//     server view and `POST /me/inbox/:shareId/open` marks that share read on
//     the server view. This keeps the optimistic cache patch and the
//     post-settle refetch consistent, so the displayed count settles at the
//     decremented value rather than reverting.
//   - Assert, after tapping the chosen unread row: the unread badge
//     (`inbox-unread-badge`) shows exactly `initialUnread - 1`, and the tapped
//     row's unread dot (`inbox-unread-dot-${shareId}`) is gone (Read_State is
//     now `read`).
//   - A complementary sub-property taps an already-`read` row and asserts the
//     unread badge is unchanged — the open path is not entered for a read
//     Share, so the count is untouched (R5.3).

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
// The implementation is installed per-run so the stub can carry the mutable
// server view the open path updates.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useNavigation()` for its header back control and its
// tap-through destinations. These runs mount the screen standalone (no
// navigator) and assert only read-state/unread-count, so the navigation
// methods are inert stubs.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

// ---------------------------------------------------------------------------
// Module under test (after the mocks above).
// ---------------------------------------------------------------------------

import InboxScreen from '../InboxScreen';
import { apiRequest } from '../../../api/client';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const displayNameArb: fc.Arbitrary<string> = fc
  .string({
    minLength: 1,
    maxLength: 40,
    unit: fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '.split(''),
    ),
  })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const isoTimestampArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2035-01-01T00:00:00.000Z'),
  })
  .map((d) => d.toISOString());

const percentArb: fc.Arbitrary<number> = fc
  .double({ min: 0, max: 100, noNaN: true })
  .map((n) => Number(n.toFixed(1)));

/** A per-item spec, independent of the unique ids assigned afterward. */
type ItemSpec =
  | {
      readonly kind: 'experience';
      readonly read: boolean;
      readonly senderDisplayName: string;
      readonly sentAt: string;
      readonly experienceName: string;
      readonly park: Park;
      readonly category: ExperienceCategory;
    }
  | {
      readonly kind: 'progress';
      readonly read: boolean;
      readonly senderDisplayName: string;
      readonly sentAt: string;
      readonly overallPercent: number;
    };

const experienceSpecArb: fc.Arbitrary<ItemSpec> = fc.record({
  kind: fc.constant('experience' as const),
  read: fc.boolean(),
  senderDisplayName: displayNameArb,
  sentAt: isoTimestampArb,
  experienceName: fc
    .string({ minLength: 1, maxLength: 60 })
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  park: parkArb,
  category: categoryArb,
});

const progressSpecArb: fc.Arbitrary<ItemSpec> = fc.record({
  kind: fc.constant('progress' as const),
  read: fc.boolean(),
  senderDisplayName: displayNameArb,
  sentAt: isoTimestampArb,
  overallPercent: percentArb,
});

const itemSpecArb: fc.Arbitrary<ItemSpec> = fc.oneof(
  experienceSpecArb,
  progressSpecArb,
);

// 1..8 items per inbox (non-empty so there is always a row to tap). The upper
// bound stays under the FlatList `initialNumToRender` window (10) so every row
// is materialized on the first render in the test environment.
const inboxSpecArb: fc.Arbitrary<ReadonlyArray<ItemSpec>> = fc.array(
  itemSpecArb,
  { minLength: 1, maxLength: 8 },
);

// ---------------------------------------------------------------------------
// Materialization: assign unique ids, build the DTO + catalog + friends views
// ---------------------------------------------------------------------------

interface Materialized {
  readonly response: InboxResponse;
  readonly items: ReadonlyArray<InboxItemDTO>;
  readonly catalog: Map<
    string,
    { name: string; park: Park; category: ExperienceCategory }
  >;
  readonly friends: ReadonlyArray<{ userId: string }>;
}

function materialize(specs: ReadonlyArray<ItemSpec>): Materialized {
  const catalog = new Map<
    string,
    { name: string; park: Park; category: ExperienceCategory }
  >();

  const items = specs.map((spec, index): InboxItemDTO => {
    const shareId = `share-${index}`;
    const senderId = `sender-${index}`;
    if (spec.kind === 'experience') {
      const experienceId = `exp-${index}`;
      catalog.set(experienceId, {
        name: spec.experienceName,
        park: spec.park,
        category: spec.category,
      });
      return {
        shareId,
        read: spec.read,
        senderId,
        senderDisplayName: spec.senderDisplayName,
        payloadKind: 'experience',
        payload: { kind: 'experience', experienceId },
        sentAt: spec.sentAt,
        myReaction: null,
      };
    }
    return {
      shareId,
      read: spec.read,
      senderId,
      senderDisplayName: spec.senderDisplayName,
      payloadKind: 'progress',
      payload: {
        kind: 'progress',
        overallPercent: spec.overallPercent,
        perParkPercent: {},
        perCategoryPercent: {},
      },
      sentAt: spec.sentAt,
      myReaction: null,
    };
  });

  const unread = items.reduce((acc, item) => (item.read ? acc : acc + 1), 0);
  // Every sender remains a Friend so a `progress` tap verifies and navigates
  // (a no-op stub here); the friend status is irrelevant to read-state.
  const friends = items.map((item) => ({ userId: item.senderId }));

  return {
    response: { unread, items },
    items,
    catalog,
    friends,
  };
}

// ---------------------------------------------------------------------------
// Stateful `apiRequest` stub — server view of the inbox for one run
// ---------------------------------------------------------------------------

/**
 * Install a stateful `apiRequest` implementation backed by a mutable server
 * view. `POST /me/inbox/:shareId/open` marks that share read on the server
 * view (mirroring `Sharing_Service.openShare`), and `GET /me/inbox` returns
 * the current view with its recomputed unread count. This keeps the screen's
 * optimistic cache patch and the post-settle refetch consistent, so the unread
 * count settles at the decremented value.
 */
function installApi(m: Materialized): void {
  const server = { items: m.items.map((it) => ({ ...it })) };

  // Clear the recorded call history so per-run assertions on `mock.calls` see
  // only the calls made during this fast-check run, not prior iterations.
  apiRequestMock.mockClear();
  apiRequestMock.mockImplementation(((method: string, path: string) => {
    if (method === 'GET' && path === '/me/inbox') {
      const items = server.items.map((it) => ({ ...it }));
      const unread = items.reduce((acc, it) => (it.read ? acc : acc + 1), 0);
      return Promise.resolve({ unread, items } as InboxResponse);
    }
    if (method === 'POST') {
      const match = /^\/me\/inbox\/(.+)\/open$/.exec(path);
      if (match) {
        const shareId = decodeURIComponent(match[1]!);
        server.items = server.items.map((it) =>
          it.shareId === shareId ? { ...it, read: true } : it,
        );
        return Promise.resolve(null);
      }
    }
    if (method === 'GET' && path === '/me/friends') {
      return Promise.resolve({ friends: m.friends });
    }
    if (method === 'GET' && path.startsWith('/catalog/')) {
      const id = decodeURIComponent(path.slice('/catalog/'.length));
      const meta = m.catalog.get(id);
      if (meta !== undefined) return Promise.resolve(meta);
    }
    return Promise.reject(new Error(`unexpected apiRequest: ${method} ${path}`));
  }) as unknown as typeof apiRequest);
}

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

function renderInbox(m: Materialized): ReturnType<typeof render> {
  const client = makeQueryClient();
  client.setQueryData(['inbox'], m.response);
  client.setQueryData(['friends'], { friends: m.friends });
  for (const [experienceId, meta] of m.catalog) {
    client.setQueryData(['experience', experienceId], meta);
  }
  return render(
    <QueryClientProvider client={client}>
      <InboxScreen />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: Opening an unread share marks it read and decrements the unread count (R5.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('tapping an unread share marks it read and decrements the unread count by one', async () => {
    await fc.assert(
      fc.asyncProperty(
        inboxSpecArb,
        fc.nat(),
        async (specs, rawIndex) => {
          // Force the tapped item to be unread so every run exercises a genuine
          // unread → read transition (R5.3).
          const tapIndex = rawIndex % specs.length;
          const forced = specs.map((spec, i) =>
            i === tapIndex ? { ...spec, read: false } : spec,
          );

          const m = materialize(forced);
          const initialUnread = m.items.reduce(
            (acc, item) => (item.read ? acc : acc + 1),
            0,
          );
          const tapped = m.items[tapIndex]!;

          installApi(m);
          const view = renderInbox(m);
          try {
            // Sanity: the badge starts at the true unread count and the tapped
            // row is unread (its dot is present).
            const badge = view.getByTestId('inbox-unread-badge');
            expect(
              within(badge).queryByText(`${initialUnread} unread`),
            ).not.toBeNull();
            expect(
              view.queryByTestId(`inbox-unread-dot-${tapped.shareId}`),
            ).not.toBeNull();

            // Select the unread Share (R5.3).
            fireEvent.press(view.getByTestId(`inbox-row-${tapped.shareId}`));

            // The unread count drops by exactly one and the tapped row is now
            // read (its unread dot is gone).
            await waitFor(() => {
              const b = view.getByTestId('inbox-unread-badge');
              expect(
                within(b).queryByText(`${initialUnread - 1} unread`),
              ).not.toBeNull();
              expect(
                view.queryByTestId(`inbox-unread-dot-${tapped.shareId}`),
              ).toBeNull();
            });
          } finally {
            view.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  test('tapping an already-read share leaves the unread count unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        inboxSpecArb,
        fc.nat(),
        async (specs, rawIndex) => {
          // Force the tapped item to be read; the open path is not entered so
          // the unread count must be untouched (R5.3).
          const tapIndex = rawIndex % specs.length;
          const forced = specs.map((spec, i) =>
            i === tapIndex ? { ...spec, read: true } : spec,
          );

          const m = materialize(forced);
          const initialUnread = m.items.reduce(
            (acc, item) => (item.read ? acc : acc + 1),
            0,
          );
          const tapped = m.items[tapIndex]!;

          installApi(m);
          const view = renderInbox(m);
          try {
            const badge = view.getByTestId('inbox-unread-badge');
            expect(
              within(badge).queryByText(`${initialUnread} unread`),
            ).not.toBeNull();

            fireEvent.press(view.getByTestId(`inbox-row-${tapped.shareId}`));

            // Let any tap-through verification settle, then assert the count is
            // still the original unread count.
            await waitFor(() => {
              const b = view.getByTestId('inbox-unread-badge');
              expect(
                within(b).queryByText(`${initialUnread} unread`),
              ).not.toBeNull();
            });

            // The open endpoint must never be called for an already-read Share.
            const openCalls = apiRequestMock.mock.calls.filter(
              (call) =>
                call[0] === 'POST' &&
                typeof call[1] === 'string' &&
                /\/open$/.test(call[1]),
            );
            expect(openCalls).toHaveLength(0);
          } finally {
            view.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
