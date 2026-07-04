// Feature: social-sharing-loop, Property 5: Inbox discloses sender, content, and timestamp for every item; unread counts unread items
//
// Validates: Requirements 4.1, 6.2
//
// Property 5 (from design.md → Correctness Properties):
//   For any inbox of delivered Shares with any mix of Read_State, the Inbox
//   discloses the sending User's display name, the Share content, and the
//   delivery timestamp for EVERY delivered Share regardless of its Read_State
//   (R4.1, R6.2), and the unread count equals the number of items whose
//   Read_State is `unread` (R6.2 — Read_State drives only the unread count).
//
// Test strategy:
//   - This is a render property over `InboxScreen`, so it mirrors the
//     render-based property pattern used elsewhere in the mobile suite
//     (e.g. `completionRender.prop.test.tsx`): only the lowest-level
//     `apiRequest` is stubbed, `ApiError` is preserved, and the React
//     Navigation hook the screen depends on (`useNavigation`) is replaced so
//     the screen renders standalone without mounting a real navigator.
//   - Generate an `InboxResponse` whose `items` are an arbitrary-length mix of
//     `experience` and `progress` payloads with arbitrary `read` flags. Each
//     item gets a unique `shareId` (FlatList key + testID scope) and, for
//     experience items, a unique `experienceId`. The response's `unread` field
//     is set to the true count of unread items — the value the server derives
//     and the value the Inbox must display.
//   - Pre-seed the React Query cache with the inbox response (key `['inbox']`)
//     and, for every experience item, its resolved catalog metadata (key
//     `['experience', experienceId]`, shared with `ExperienceDetailScreen`),
//     each with `staleTime: Infinity`. This makes the first render fully
//     synchronous and deterministic: the inbox list renders immediately and
//     every experience row resolves straight to its name rather than sitting
//     in the 10-second loading window.
//   - Assert, for EVERY item regardless of `read`:
//       * the sender node (`inbox-sender-${shareId}`) is present with the
//         sender's display name (R4.1),
//       * the timestamp node (`inbox-timestamp-${shareId}`) is present (R6.2),
//       * the content is disclosed (R6.2): a `progress` item shows its overall
//         percentage node; an `experience` item shows its resolved name node.
//   - Assert the unread badge (`inbox-unread-badge`) shows exactly the number
//     of unread items — Read_State drives only the count (R6.2). A dedicated
//     sub-property crosses this over inboxes with a controlled unread count.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, within } from '@testing-library/react-native';
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
// The cache is pre-seeded so the render path never actually needs the network,
// but a stray call would reject loudly rather than hang the render.
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

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

// Display names: 1..40 chars from a readable charset, trimmed non-empty so the
// value survives the schema's trim rule and renders as a stable Text node.
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

// An ISO-8601 timestamp within a plausible range.
const isoTimestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2035-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

// A percentage snapped to one decimal in [0.0, 100.0].
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

// 0..8 items per inbox, exercising the empty inbox and multi-item lists. The
// upper bound stays under the FlatList `initialNumToRender` window (10) so
// every row is materialized on the first render in the test environment (no
// scroll/layout events fire to page in virtualized rows).
const inboxSpecArb: fc.Arbitrary<ReadonlyArray<ItemSpec>> = fc.array(itemSpecArb, {
  minLength: 0,
  maxLength: 8,
});

// ---------------------------------------------------------------------------
// Materialization: assign unique ids and build the DTO + resolved catalog map
// ---------------------------------------------------------------------------

interface Materialized {
  readonly response: InboxResponse;
  readonly items: ReadonlyArray<{
    readonly item: InboxItemDTO;
    readonly spec: ItemSpec;
  }>;
  readonly catalog: ReadonlyArray<{
    readonly experienceId: string;
    readonly name: string;
    readonly park: Park;
    readonly category: ExperienceCategory;
  }>;
}

function materialize(specs: ReadonlyArray<ItemSpec>): Materialized {
  const catalog: Array<{
    experienceId: string;
    name: string;
    park: Park;
    category: ExperienceCategory;
  }> = [];

  const items = specs.map((spec, index) => {
    const shareId = `share-${index}`;
    if (spec.kind === 'experience') {
      const experienceId = `exp-${index}`;
      catalog.push({
        experienceId,
        name: spec.experienceName,
        park: spec.park,
        category: spec.category,
      });
      const item: InboxItemDTO = {
        shareId,
        read: spec.read,
        senderId: `sender-${index}`,
        senderDisplayName: spec.senderDisplayName,
        payloadKind: 'experience',
        payload: { kind: 'experience', experienceId },
        sentAt: spec.sentAt,
        myReaction: null,
      };
      return { item, spec };
    }
    const item: InboxItemDTO = {
      shareId,
      read: spec.read,
      senderId: `sender-${index}`,
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
    return { item, spec };
  });

  // The server derives `unread` as the count of items whose `read` is false —
  // exactly what the Inbox must display (R6.2).
  const unread = items.reduce((acc, { item }) => (item.read ? acc : acc + 1), 0);

  return {
    response: { unread, items: items.map(({ item }) => item) },
    items,
    catalog,
  };
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
  // Seed the inbox read (key `['inbox']`) and every experience's catalog
  // metadata (key `['experience', experienceId]`) so the list and each row
  // resolve on the first synchronous render.
  client.setQueryData(['inbox'], m.response);
  for (const entry of m.catalog) {
    client.setQueryData(['experience', entry.experienceId], {
      name: entry.name,
      park: entry.park,
      category: entry.category,
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <InboxScreen />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property 5a — disclosure of sender, content, and timestamp for every item
// ---------------------------------------------------------------------------

describe('Property 5: Inbox discloses sender/content/timestamp for every item; unread counts unread items (R4.1, R6.2)', () => {
  test('every delivered item discloses sender name, content, and timestamp regardless of Read_State', () => {
    fc.assert(
      fc.property(inboxSpecArb, (specs) => {
        const m = materialize(specs);
        const view = renderInbox(m);
        try {
          for (const { item, spec } of m.items) {
            const id = item.shareId;

            // R4.1 / R6.2: the sender display name is disclosed for EVERY
            // item, regardless of `read`. Assert against the per-row sender
            // node's own text so a display name shared by two rows (or one
            // that collides with other on-screen copy) never trips a global
            // multi-match.
            const senderNode = view.getByTestId(`inbox-sender-${id}`);
            expect(senderNode.props.children).toBe(item.senderDisplayName);

            // R6.2: the delivery timestamp is disclosed for EVERY item.
            expect(view.queryByTestId(`inbox-timestamp-${id}`)).not.toBeNull();

            // R6.2: the Share content is disclosed for EVERY item. Because the
            // catalog metadata is pre-seeded, an experience row resolves to its
            // name (never the raw identifier) and a progress row shows its
            // overall percentage.
            if (spec.kind === 'experience') {
              const nameNode = view.getByTestId(`inbox-experience-name-${id}`);
              expect(nameNode.props.children).toBe(spec.experienceName);
            } else {
              expect(
                view.queryByTestId(`inbox-progress-overall-${id}`),
              ).not.toBeNull();
            }
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 5b — the unread badge equals the number of unread items
  // -------------------------------------------------------------------------

  test('the unread count equals the number of unread items (Read_State drives only the count)', () => {
    fc.assert(
      fc.property(inboxSpecArb, (specs) => {
        const m = materialize(specs);
        const expectedUnread = m.items.reduce(
          (acc, { item }) => (item.read ? acc : acc + 1),
          0,
        );

        const view = renderInbox(m);
        try {
          const badge = view.getByTestId('inbox-unread-badge');
          // The badge label reads "N unread"; assert the exact count scoped to
          // the badge subtree so it never collides with row copy elsewhere.
          expect(
            within(badge).queryByText(`${expectedUnread} unread`),
          ).not.toBeNull();
        } finally {
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
