// Feature: social-sharing-loop, Property 9: Inbox renders progress percentages to one decimal place
//
// Validates: Requirements 4.9
//
// Property 9 (from design.md → Correctness Properties):
//   For any Progress_Share payload, the Inbox renders the overall, per-Park,
//   and per-Experience_Category percentages as their one-decimal-formatted
//   values from the payload (R4.9).
//
// Test strategy:
//   - This is a render property over `InboxScreen`, so it mirrors the
//     render-based property pattern already established for the Inbox
//     (`inboxDisclosure.prop.test.tsx`): only the lowest-level `apiRequest` is
//     stubbed, `ApiError` is preserved, and the React Navigation hook the
//     screen depends on (`useNavigation`) is replaced so the screen renders
//     standalone without a real navigator. A `progress` row performs no async
//     metadata read (only `experience` rows resolve catalog data), so the
//     inbox response is pre-seeded into the React Query cache (key `['inbox']`)
//     and the first render is fully synchronous and deterministic.
//   - Generate a single `progress` inbox item whose overall percentage plus an
//     arbitrary subset of per-Park and per-Experience_Category percentages are
//     drawn as unconstrained doubles in `[0, 100]` (the schema's completion
//     range) WITHOUT pre-rounding. This lets the property exercise the Inbox's
//     own one-decimal formatting: it must render each raw value as
//     `value.toFixed(1)%`, not merely echo an already-snapped input.
//   - Assert, for the generated payload:
//       * the overall node (`inbox-progress-overall-${shareId}`) renders
//         `Overall: ${overall.toFixed(1)}%`,
//       * each PRESENT per-Park node renders `${park}: ${v.toFixed(1)}%` and is
//         formatted to exactly one decimal place,
//       * each PRESENT per-category node renders
//         `${category}: ${v.toFixed(1)}%` (underscores → spaces) to exactly one
//         decimal place,
//       * each ABSENT Park / category renders no node (the payload's optional
//         keys drive presence).
//   - fast-check runs at numRuns: 100 per the plan's minimum.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type InboxItemDTO,
  type InboxResponse,
  type Park,
  type ProgressSharePayload,
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
// The cache is pre-seeded so the render path never needs the network, but a
// stray call rejects loudly rather than hanging the render.
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

// A completion percentage in the schema's `[0, 100]` range, drawn as an
// unconstrained double (NOT pre-rounded) so the property exercises the Inbox's
// own one-decimal formatting rather than echoing an already-snapped value.
const rawPercentArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 100,
  noNaN: true,
});

// An arbitrary subset of an enum mapped to raw percentages: each key is
// present with independent probability, so ABSENT keys (which must render no
// node) are exercised alongside present ones.
function partialPercentMapArb<K extends string>(
  keys: readonly K[],
): fc.Arbitrary<{ [key in K]?: number }> {
  return fc
    .tuple(
      ...keys.map((key) =>
        fc.option(rawPercentArb, { nil: undefined }).map(
          (value) => [key, value] as const,
        ),
      ),
    )
    .map((entries) => {
      const out: { [key in K]?: number } = {};
      for (const [key, value] of entries) {
        if (typeof value === 'number') out[key] = value;
      }
      return out;
    });
}

const progressPayloadArb: fc.Arbitrary<ProgressSharePayload> = fc
  .record({
    overallPercent: rawPercentArb,
    perParkPercent: partialPercentMapArb<Park>(PARKS),
    perCategoryPercent: partialPercentMapArb<ExperienceCategory>(
      EXPERIENCE_CATEGORIES,
    ),
  })
  .map((r) => ({
    kind: 'progress',
    overallPercent: r.overallPercent,
    perParkPercent: r.perParkPercent,
    perCategoryPercent: r.perCategoryPercent,
  }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

const SHARE_ID = 'progress-share-1';

function buildResponse(payload: ProgressSharePayload): InboxResponse {
  const item: InboxItemDTO = {
    shareId: SHARE_ID,
    read: false,
    senderId: 'sender-1',
    senderDisplayName: 'Mickey Mouse',
    payloadKind: 'progress',
    payload,
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction: null,
  };
  return { unread: 1, items: [item] };
}

/**
 * Flatten a Text node's children into the string it renders. The Inbox builds
 * the percentage lines from a literal label plus an expression (e.g.
 * `Overall: {formatPercent(v)}`), so `props.children` is an array of string
 * fragments; joining them reproduces the on-screen text.
 */
function nodeText(node: { props: { children?: unknown } }): string {
  const children = node.props.children;
  if (Array.isArray(children)) return children.join('');
  return String(children);
}

/** The Inbox's percentage format: one decimal place with a trailing `%`. */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** A value formatted to exactly one decimal place, e.g. `12.3%` or `100.0%`. */
const ONE_DECIMAL_PERCENT = /^\d+\.\d%$/;

/** Render a category enum literal as user-facing text (underscores → spaces). */
function formatCategory(category: ExperienceCategory): string {
  return category.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 9: Inbox renders progress percentages to one decimal place (R4.9)', () => {
  it('renders overall, per-Park, and per-category percentages as their one-decimal-formatted payload values', () => {
    fc.assert(
      fc.property(progressPayloadArb, (payload) => {
        const client = makeQueryClient();
        client.setQueryData(['inbox'], buildResponse(payload));

        const view = render(
          <QueryClientProvider client={client}>
            <InboxScreen />
          </QueryClientProvider>,
        );

        try {
          // R4.9: the overall percentage renders to one decimal place.
          const overallNode = view.getByTestId(
            `inbox-progress-overall-${SHARE_ID}`,
          );
          const overallText = nodeText(overallNode);
          expect(overallText).toBe(
            `Overall: ${formatPercent(payload.overallPercent)}`,
          );
          // The formatted percentage fragment itself has exactly one decimal.
          expect(overallText.replace('Overall: ', '').replace('%', '')).toMatch(
            /^\d+\.\d$/,
          );

          // R4.9: every PRESENT per-Park percentage renders to one decimal
          // place; every ABSENT Park renders no node.
          for (const park of PARKS) {
            const testId = `inbox-progress-park-${SHARE_ID}-${park}`;
            const value = payload.perParkPercent[park];
            if (typeof value === 'number') {
              const node = view.getByTestId(testId);
              const text = nodeText(node);
              expect(text).toBe(`${park}: ${formatPercent(value)}`);
              const fragment = text.slice(`${park}: `.length);
              expect(fragment).toMatch(ONE_DECIMAL_PERCENT);
            } else {
              expect(view.queryByTestId(testId)).toBeNull();
            }
          }

          // R4.9: every PRESENT per-Experience_Category percentage renders to
          // one decimal place; every ABSENT category renders no node.
          for (const category of EXPERIENCE_CATEGORIES) {
            const testId = `inbox-progress-category-${SHARE_ID}-${category}`;
            const value = payload.perCategoryPercent[category];
            if (typeof value === 'number') {
              const node = view.getByTestId(testId);
              const text = nodeText(node);
              const label = `${formatCategory(category)}: `;
              expect(text).toBe(`${label}${formatPercent(value)}`);
              const fragment = text.slice(label.length);
              expect(fragment).toMatch(ONE_DECIMAL_PERCENT);
            } else {
              expect(view.queryByTestId(testId)).toBeNull();
            }
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
