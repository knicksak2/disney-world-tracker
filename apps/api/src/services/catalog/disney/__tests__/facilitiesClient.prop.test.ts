// Feature: disney-facilities-catalog-source, Property 1: Bulk-get batching partitions the id set without loss
/**
 * Property-based tests for the Facilities_Client (design.md → "3.
 * Facilities_Client refactor", `services/catalog/disney/facilitiesClient.ts`).
 *
 * The client now routes every Disney request through the shared
 * `DisneyTransport`; these tests drive it through a fake transport (recording
 * or answering `transport.request(spec)`) rather than a fake `fetch`. The
 * transport owns rate limiting, retry/backoff, the User-Agent, and failure
 * classification (covered by `transport.prop.test.ts`); these properties cover
 * the client's own concerns: loss-free batching, returning the full document
 * set untouched, single-error surfacing, and Public_Token caching.
 *
 * NOTE: This file is shared across several Facilities_Client property tasks.
 * Each task appends its own top-level `describe` block — do not clobber
 * existing blocks when adding a new property.
 *
 * ---------------------------------------------------------------------------
 * Property 1 — Bulk-get batching partitions the id set without loss
 * Validates: Requirements 2.3, 2.4
 * ---------------------------------------------------------------------------
 *
 * The client fetches documents by issuing one or more `POST /_bulk_get`
 * requests, each carrying between 1 and 100 ids, until every requested id has
 * been requested (R2.3); an empty id set sends no request at all (R2.4).
 * Batching is delegated to the pure `chunk(ids, size)` helper, so the invariant
 * is expressed and tested at two levels:
 *
 *   (a) `chunk` itself is a loss-free partition — the concatenation of the
 *       chunks equals the input exactly (no element dropped, added, reordered,
 *       or duplicated), every non-final chunk has exactly `size` elements, the
 *       final chunk has 1..size elements, and an empty input yields no chunks.
 *
 *   (b) driving `bulkGetDocuments` through a fake transport shows the same
 *       partition on the wire: each request body carries 1..BULK_GET_BATCH_SIZE
 *       ids, and the concatenation of all requested batches equals the input id
 *       list exactly; an empty id list drives zero requests (R2.4).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DisneyRequestSpec, DisneyResponse, DisneyFailureKind } from '@dwt/shared';
import { DISNEY_FAILURE_KINDS } from '@dwt/shared';

import {
  BULK_GET_BATCH_SIZE,
  chunk,
  createFacilitiesClient,
  FACILITIES_CHANNEL,
} from '../facilitiesClient.js';
import type { DisneyTransport } from '../transport.js';
import { UpstreamError } from '../../themeparks.js';

const NUM_RUNS = 100;

/** Static_Credentials stand-in; irrelevant to batching but required by options. */
const TEST_CREDENTIALS = { username: 'user', password: 'pass' } as const;

// ---------------------------------------------------------------------------
// Property 1(a) — the pure `chunk` partition
// ---------------------------------------------------------------------------

describe('chunk — Property 1: partitions the id set without loss (R2.3, R2.4)', () => {
  /** Arbitrary list of ids (as strings), any length including empty. */
  const idsArb = fc.array(fc.string(), { maxLength: 350 });
  /** A positive integer batch size. */
  const sizeArb = fc.integer({ min: 1, max: 120 });

  it('concatenation of the chunks equals the input exactly (no loss/reorder/dupe)', () => {
    fc.assert(
      fc.property(idsArb, sizeArb, (ids, size) => {
        const batches = chunk(ids, size);
        expect(batches.flat()).toEqual([...ids]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every non-final chunk has exactly `size` elements; the final chunk has 1..size', () => {
    fc.assert(
      fc.property(idsArb, sizeArb, (ids, size) => {
        const batches = chunk(ids, size);
        batches.forEach((batch, index) => {
          if (index < batches.length - 1) {
            expect(batch.length).toBe(size);
          } else {
            // Final chunk: non-empty and never exceeds `size`.
            expect(batch.length).toBeGreaterThanOrEqual(1);
            expect(batch.length).toBeLessThanOrEqual(size);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the number of chunks is ceil(length / size), and no chunk is empty', () => {
    fc.assert(
      fc.property(idsArb, sizeArb, (ids, size) => {
        const batches = chunk(ids, size);
        expect(batches.length).toBe(Math.ceil(ids.length / size));
        expect(batches.every((b) => b.length > 0)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('an empty input yields no chunks (R2.4)', () => {
    fc.assert(
      fc.property(sizeArb, (size) => {
        expect(chunk([], size)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws for a non-positive or non-integer size (programmer error, not upstream)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -50, max: 0 }), fc.double({ min: 0.1, max: 5, noNaN: true }).filter((n) => !Number.isInteger(n))),
        (badSize) => {
          expect(() => chunk([1, 2, 3], badSize)).toThrow(RangeError);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 1(b) — the partition observed on the wire through bulkGetDocuments
// ---------------------------------------------------------------------------

/**
 * Build a minimal, valid `multipart/related` body echoing one JSON document per
 * requested id, so `parseBulkGet` recovers at least one document per batch and
 * `bulkGetDocuments` completes. The batching invariant — not the parsing — is
 * what this block asserts.
 */
function multipartBodyFor(ids: readonly string[], boundary: string): string {
  const parts = ids
    .map((id) => `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ id })}`)
    .join('\r\n');
  return `${parts}\r\n--${boundary}--\r\n`;
}

/** Read the JSON `_bulk_get` request body's requested ids off a spec. */
function bulkGetIdsOf(spec: DisneyRequestSpec): string[] {
  const raw = typeof spec.body === 'string' ? spec.body : '';
  const parsed = JSON.parse(raw) as { docs?: { id: string }[] };
  return (parsed.docs ?? []).map((d) => d.id);
}

/**
 * A fake transport that records the ids requested in each `POST /_bulk_get`
 * body and answers with a well-formed multipart response echoing those ids. The
 * captured `batches` array is the sequence of id batches seen on the wire.
 */
function makeRecordingTransport(): { transport: DisneyTransport; batches: string[][] } {
  const batches: string[][] = [];
  const boundary = 'testboundary123';

  const transport: DisneyTransport = {
    async request(spec: DisneyRequestSpec): Promise<DisneyResponse> {
      const ids = bulkGetIdsOf(spec);
      batches.push(ids);
      return {
        status: 200,
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        text: multipartBodyFor(ids, boundary),
      };
    },
  };

  return { transport, batches };
}

describe('bulkGetDocuments — Property 1: on-wire batching partitions the id set (R2.3, R2.4)', () => {
  /**
   * Unique ids so the per-request `1..100` bound and the "all ids requested
   * across batches" reconstruction are unambiguous. Sized up to comfortably
   * exceed BULK_GET_BATCH_SIZE so multiple full batches are exercised.
   */
  const uniqueIdsArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 350 })
    .map((nums) => nums.map((n) => `${n};entityType=Attraction`));

  it('each request carries 1..BULK_GET_BATCH_SIZE ids and all ids are requested in order', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueIdsArb, async (ids) => {
        const { transport, batches } = makeRecordingTransport();
        const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

        const docs = await client.bulkGetDocuments(ids);

        // Every batch is non-empty and never exceeds the batch-size cap (R2.3).
        expect(batches.every((b) => b.length >= 1 && b.length <= BULK_GET_BATCH_SIZE)).toBe(true);
        // The concatenation of all requested batches equals the input exactly:
        // no id dropped, added, reordered, or duplicated (R2.3).
        expect(batches.flat()).toEqual([...ids]);
        // Number of requests is the ceil partition of the id set.
        expect(batches.length).toBe(Math.ceil(ids.length / BULK_GET_BATCH_SIZE));
        // Every requested id is reflected back as a fetched document.
        expect(docs.map((d) => d.id)).toEqual([...ids]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('an empty id set sends no request and returns an empty document set (R2.4)', async () => {
    const { transport, batches } = makeRecordingTransport();
    const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

    const docs = await client.bulkGetDocuments([]);

    expect(docs).toEqual([]);
    expect(batches).toEqual([]);
  });
});

// ===========================================================================
// Feature: disney-facilities-catalog-source, Property 2: Document retrieval returns the full set untouched
// ---------------------------------------------------------------------------
// Property 2 — Document retrieval returns the full set untouched
// Validates: Requirements 2.5
//
// When the channel enumeration and all corresponding `POST /_bulk_get` fetches
// complete, the client returns to the caller *every* fetched document, with no
// business classification, filtering, or deduplication applied (R2.5). The
// property drives `bulkGetDocuments` through a fake transport that answers each
// batch with a `multipart/related` body encoding exactly the requested docs
// (looked up by id), then asserts the returned document set equals the full
// requested set — in order, once per requested id occurrence, byte-for-byte
// (modulo the JSON wire round-trip) — across single and multiple batches.
//
// To make "untouched" concrete, the generated document set deliberately
// includes documents that downstream normalization/classification *would*
// drop or transform (`softDeleted: true`, blank/whitespace `name`, and
// Non_Experience_Type values); the client must return all of them unchanged.
//
// Each `fc.assert` runs with `numRuns: 100` per the spec convention.
// ===========================================================================

/** One raw document as it travels the wire; fields are intentionally tolerant. */
type WireDoc = Record<string, unknown>;

/**
 * Encode a list of documents as a `multipart/related` body — one JSON part per
 * document, in order — mirroring the real `POST /_bulk_get` response shape so
 * `parseBulkGet` recovers each document.
 */
function encodeDocsMultipartP2(docs: readonly WireDoc[], boundary: string): string {
  const parts = docs
    .map((doc) => `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(doc)}`)
    .join('\r\n');
  return `${parts}\r\n--${boundary}--\r\n`;
}

/**
 * A fake transport that, for each `POST /_bulk_get`, reads the requested ids
 * from the request body, looks each id up in `docById`, and answers with a
 * multipart body encoding exactly those documents (in the requested order,
 * including repeats). It records the number of requests so multi-batch
 * behavior can be asserted.
 */
function makeEchoTransportP2(docById: ReadonlyMap<string, WireDoc>): {
  transport: DisneyTransport;
  requests: { count: number };
} {
  const boundary = 'prop2-boundary-abc';
  const requests = { count: 0 };

  const transport: DisneyTransport = {
    async request(spec: DisneyRequestSpec): Promise<DisneyResponse> {
      const ids = bulkGetIdsOf(spec);
      const docs = ids.map((id) => docById.get(id) ?? { id });
      requests.count += 1;
      return {
        status: 200,
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        text: encodeDocsMultipartP2(docs, boundary),
      };
    },
  };

  return { transport, requests };
}

/** The JSON wire round-trip a document undergoes end-to-end (stringify → parse). */
function jsonRoundTripP2(doc: WireDoc): WireDoc {
  return JSON.parse(JSON.stringify(doc)) as WireDoc;
}

/**
 * A tolerant document generator whose field set is JSON-safe. The `id` is
 * assigned by the scenario (per index) to guarantee uniqueness; the fields here
 * deliberately span values that downstream steps would filter or classify:
 * blank/whitespace names, `softDeleted: true`, and Non_Experience_Type types.
 */
const docFieldsArbP2 = fc.record(
  {
    name: fc.oneof(fc.string(), fc.constant(''), fc.constant('   ')),
    type: fc.constantFrom(
      'attraction',
      'entertainment',
      'restaurant',
      'resort',
      'resort-area',
      'transportation',
      'land',
      'guest-service',
      'spa',
      'tour',
    ),
    subType: fc.option(fc.string(), { nil: undefined }),
    description: fc.option(fc.string(), { nil: undefined }),
    detailImageUrl: fc.option(fc.webUrl(), { nil: undefined }),
    softDeleted: fc.option(fc.boolean(), { nil: undefined }),
    latitude: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
    longitude: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
    facets: fc.option(
      fc.record({ accessibility: fc.array(fc.string()) }, { requiredKeys: [] }),
      { nil: undefined },
    ),
    channels: fc.option(fc.array(fc.string()), { nil: undefined }),
  },
  { requiredKeys: [] },
);

/** A document set (1..250 docs) with unique, well-formed Enterprise_Ids. */
const docSetArbP2 = fc
  .array(docFieldsArbP2, { minLength: 1, maxLength: 250 })
  .map((list): readonly WireDoc[] =>
    list.map((fields, index) => ({ id: `${index + 1};entityType=Facility`, ...fields })),
  );

describe('bulkGetDocuments — Property 2: returns the full set untouched (R2.5)', () => {
  it('returns every requested document, in order and unmodified, across all batches', async () => {
    await fc.assert(
      fc.asyncProperty(docSetArbP2, async (docs) => {
        const docById = new Map<string, WireDoc>(docs.map((d) => [d['id'] as string, d]));
        const { transport, requests } = makeEchoTransportP2(docById);
        const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

        const ids = docs.map((d) => d['id'] as string);
        const result = await client.bulkGetDocuments(ids);

        // Full set: exactly as many documents out as ids in — nothing filtered
        // (softDeleted/blank-name docs retained) and nothing deduplicated.
        expect(result.length).toBe(docs.length);
        // Untouched: each returned document equals its upstream payload (via the
        // inherent JSON wire round-trip), in the requested order.
        expect(result).toEqual(docs.map(jsonRoundTripP2));
        // Batching spans the whole set: the run completes across ceil(n/100)
        // requests, so multi-batch retrieval is exercised for large sets.
        expect(requests.count).toBe(Math.ceil(docs.length / BULK_GET_BATCH_SIZE));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not deduplicate repeated ids: one document per requested occurrence, in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        docSetArbP2,
        fc.array(fc.nat(), { minLength: 1, maxLength: 400 }),
        async (docs, picks) => {
          const docById = new Map<string, WireDoc>(docs.map((d) => [d['id'] as string, d]));
          const { transport } = makeEchoTransportP2(docById);
          const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

          // An id request sequence that samples (with repeats) from the doc set.
          const ids = picks.map((p) => docs[p % docs.length]!['id'] as string);
          const result = await client.bulkGetDocuments(ids);

          // No dedup: one returned document per requested id occurrence, order preserved.
          expect(result.length).toBe(ids.length);
          expect(result.map((d) => (d as unknown as WireDoc)['id'])).toEqual(ids);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('bulkGetDocuments — Property 2 fixed regression examples (R2.5)', () => {
  it('retains documents that downstream steps would filter or classify (multi-batch)', async () => {
    // 150 docs → two batches (100 + 50); include a soft-deleted, a blank-name,
    // and Non_Experience_Type documents to prove the client applies none of the
    // sync orchestrator's filtering/classification.
    const docs: WireDoc[] = Array.from({ length: 150 }, (_unused, i) => {
      const id = `${i + 1};entityType=Facility`;
      if (i === 0) return { id, name: 'Space Mountain', type: 'attraction' };
      if (i === 1) return { id, name: '   ', type: 'restaurant' }; // blank name
      if (i === 2) return { id, name: 'Ghost', type: 'attraction', softDeleted: true };
      if (i === 3) return { id, name: 'Bus Depot', type: 'transportation' }; // Non_Experience_Type
      return { id, name: `Facility ${i}`, type: 'entertainment' };
    });

    const docById = new Map<string, WireDoc>(docs.map((d) => [d['id'] as string, d]));
    const { transport, requests } = makeEchoTransportP2(docById);
    const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

    const result = await client.bulkGetDocuments(docs.map((d) => d['id'] as string));

    expect(requests.count).toBe(2);
    expect(result.length).toBe(150);
    expect(result).toEqual(docs.map(jsonRoundTripP2));
    // The would-be-filtered documents are present and unchanged.
    expect(result.find((d) => (d as unknown as WireDoc)['softDeleted'] === true)).toBeDefined();
    expect(result.some((d) => (d as unknown as WireDoc)['name'] === '   ')).toBe(true);
    expect(result.some((d) => (d as unknown as WireDoc)['type'] === 'transportation')).toBe(true);
  });
});

// ===========================================================================
// Feature: disney-facilities-catalog-source, Property 17: The client surfaces exactly one typed error whose discriminator is in the closed set
// ---------------------------------------------------------------------------
// Property 17 — The client surfaces exactly one typed error whose discriminator
// is in the closed set.
// Validates: Requirements 1.7, 1.8
//
// Post-refactor, the transport owns HTTP-status / network / abort / WAF / auth
// classification and raises a single `DisneyTransportError` (see
// `transport.prop.test.ts` for that discipline). The client's own contract is:
//   - it propagates the transport's single typed error unchanged, and
//   - when a *successful* (2xx) response body cannot be parsed into the agreed
//     shape, it raises exactly one `UpstreamError('invalid_response')`.
// In both cases the surfaced error carries a `kind` that is a member of the
// closed `DisneyFailureKind` set, so the "exactly one typed error in the closed
// set" invariant (R1.7, R1.8) holds at the client boundary too.
//
// Strategy: drive a fake transport to either throw a transport-shaped error
// (any `DisneyFailureKind`) or return a 2xx body that is unparseable for every
// operation, and exercise each of the three client operations that reach a
// Disney source (`listChannelDocumentIds`, `bulkGetDocuments`, `getMenus`).
//
// Each `fc.assert` runs with `numRuns: 100` per the spec convention.
// ===========================================================================

/** The Facilities_Client operations that reach a Disney source. */
type OperationNameP17 = 'listChannelDocumentIds' | 'bulkGetDocuments' | 'getMenus';

/** The failure outcome the fake transport should produce for an operation. */
type FailureOutcomeP17 =
  | { readonly kind: 'transport_error'; readonly errKind: DisneyFailureKind }
  | { readonly kind: 'invalid_response' };

/** A transport-shaped error mirroring `DisneyTransportError` (keyed off `kind`). */
class FakeTransportError extends Error {
  public readonly kind: DisneyFailureKind;
  constructor(kind: DisneyFailureKind) {
    super(`fake transport error: ${kind}`);
    this.name = 'DisneyTransportError';
    this.kind = kind;
  }
}

/**
 * A fake transport that produces the given failure `outcome` on every call,
 * regardless of spec, and counts how many times it was invoked. The call count
 * lets the test assert the failure surfaced as exactly one error.
 */
function makeOutcomeTransportP17(outcome: FailureOutcomeP17): {
  transport: DisneyTransport;
  calls: { count: number };
} {
  const calls = { count: 0 };

  const transport: DisneyTransport = {
    async request(): Promise<DisneyResponse> {
      calls.count += 1;
      if (outcome.kind === 'transport_error') {
        // The transport classified and raised its single typed error; the
        // client must propagate it unchanged.
        throw new FakeTransportError(outcome.errKind);
      }
      // A 200 body that is neither valid JSON (so the `_changes` and
      // Public_Token JSON reads fail) nor a multipart body with a readable
      // boundary (so `_bulk_get` recovers no document) → `invalid_response`
      // for every operation.
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        text: 'not a parseable body',
      };
    },
  };

  return { transport, calls };
}

/** Invoke the named operation with a benign, well-formed argument. */
async function invokeOperationP17(
  client: ReturnType<typeof createFacilitiesClient>,
  operation: OperationNameP17,
): Promise<void> {
  switch (operation) {
    case 'listChannelDocumentIds':
      await client.listChannelDocumentIds(FACILITIES_CHANNEL);
      return;
    case 'bulkGetDocuments':
      // A non-empty id set so a `POST /_bulk_get` is actually issued (an empty
      // set would short-circuit to `[]` with no request, R2.4).
      await client.bulkGetDocuments(['80010177;entityType=Attraction']);
      return;
    case 'getMenus':
      // `getMenus` first acquires a Public_Token, so the driven failure surfaces
      // on the token request — still exactly one error out of the operation.
      await client.getMenus('90002417;entityType=Restaurant');
      return;
  }
}

/** Generator over the three Disney-source-reaching operations. */
const operationArbP17: fc.Arbitrary<OperationNameP17> = fc.constantFrom(
  'listChannelDocumentIds',
  'bulkGetDocuments',
  'getMenus',
);

/**
 * Generator over the failure outcomes: any transport-classified failure kind,
 * or an unparseable successful body.
 */
const outcomeArbP17: fc.Arbitrary<FailureOutcomeP17> = fc.oneof(
  fc
    .constantFrom(...DISNEY_FAILURE_KINDS)
    .map((errKind) => ({ kind: 'transport_error', errKind }) as const),
  fc.constant({ kind: 'invalid_response' } as const),
);

describe('Facilities_Client — Property 17: surfaces exactly one typed error in the closed set (R1.7, R1.8)', () => {
  it('every operation × failure outcome rejects with exactly one error whose discriminator is in the closed set', async () => {
    await fc.assert(
      fc.asyncProperty(operationArbP17, outcomeArbP17, async (operation, outcome) => {
        const { transport } = makeOutcomeTransportP17(outcome);
        const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

        // Capture the single thrown value.
        let thrownCount = 0;
        let caught: unknown;
        try {
          await invokeOperationP17(client, operation);
        } catch (error) {
          thrownCount += 1;
          caught = error;
        }

        // Exactly one error was raised (R1.7).
        expect(thrownCount).toBe(1);

        // Its discriminator is exactly one member of the closed set (R1.7).
        const kind = (caught as { kind?: unknown }).kind as DisneyFailureKind;
        expect(DISNEY_FAILURE_KINDS).toContain(kind);

        if (outcome.kind === 'transport_error') {
          // A transport failure propagates unchanged with its original kind.
          expect(caught).toBeInstanceOf(FakeTransportError);
          expect(kind).toBe(outcome.errKind);
        } else {
          // An unparseable 2xx body is the client's own `invalid_response`.
          expect(caught).toBeInstanceOf(UpstreamError);
          expect(kind).toBe('invalid_response');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('propagates the transport error instance unchanged (no re-wrapping)', async () => {
    await fc.assert(
      fc.asyncProperty(
        operationArbP17,
        fc.constantFrom(...DISNEY_FAILURE_KINDS),
        async (operation, errKind) => {
          const { transport } = makeOutcomeTransportP17({ kind: 'transport_error', errKind });
          const client = createFacilitiesClient({ credentials: TEST_CREDENTIALS, transport });

          const caught = await invokeOperationP17(client, operation).catch((e: unknown) => e);
          expect(caught).toBeInstanceOf(FakeTransportError);
          expect((caught as FakeTransportError).kind).toBe(errKind);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Feature: disney-facilities-catalog-source, Property 18: The Public_Token is obtained exactly when none unexpired is held
// ---------------------------------------------------------------------------
// Property 18 — The Public_Token is obtained exactly when none unexpired is
// held.
// Validates: Requirements 1.4
//
// The implementation acquires the token lazily inside `getMenus`: it reuses a
// cached token while `expiresAtMs > now()` and otherwise obtains a fresh one via
// the `assertion`/`public` grant, caching it with an expiry of
// `now() + expires_in * 1000`. `options.now` injects a controllable clock so the
// expiry decision is deterministic.
//
// Strategy: drive a fake transport that distinguishes the token-grant request
// (POST to the configured `authorizationUrl`) from the Menu_Service request
// (GET under the configured menu `baseUrl`). The grant endpoint answers with a
// unique, sequential `access_token` (`token-0`, `token-1`, …) and a generated
// `expires_in`; the menu endpoint records the bearer token it was actually
// called with. A reference simulation predicts the exact grant count and the
// exact bearer each call must carry.
//
// Each `fc.assert` runs with `numRuns: 100` per the spec convention.
// ===========================================================================

/** Distinct stand-in endpoints so the fake transport can tell the two calls apart. */
const AUTH_URL_P18 = 'https://auth.test.invalid/token';
const MENU_BASE_URL_P18 = 'https://menu.test.invalid/dining-menus';

/**
 * A fake transport for Property 18. The token-grant request (POST to
 * {@link AUTH_URL_P18}) is answered with a unique sequential `access_token` and
 * the next generated `expires_in` (seconds); every other request is treated as
 * a Menu_Service GET and answered with an empty menu array, while its
 * `Authorization: Bearer <token>` header is recorded.
 */
function makeTokenTrackingTransportP18(lifetimesSec: readonly number[]): {
  transport: DisneyTransport;
  grants: { count: number };
  bearers: string[];
} {
  const grants = { count: 0 };
  const bearers: string[] = [];

  const transport: DisneyTransport = {
    async request(spec: DisneyRequestSpec): Promise<DisneyResponse> {
      if (spec.url === AUTH_URL_P18) {
        // Anonymous `assertion`/`public` grant: hand out a fresh, uniquely-named
        // token and the next lifetime from the generated schedule.
        const token = `token-${grants.count}`;
        const expiresIn = lifetimesSec[grants.count % lifetimesSec.length]!;
        grants.count += 1;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ access_token: token, expires_in: expiresIn }),
        };
      }

      // Menu_Service GET: record the bearer token actually presented (R1.3)
      // and answer with a valid, empty menu payload so `getMenus` completes.
      const authorization = spec.headers?.['Authorization'] ?? '';
      bearers.push(authorization.replace(/^Bearer\s+/u, ''));
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify([]),
      };
    },
  };

  return { transport, grants, bearers };
}

/**
 * Reference model of the token cache: replay the same call schedule and clock,
 * acquiring a new token exactly when no held token is still unexpired at the
 * call instant (`heldExpiresAtMs > t` is the reuse condition), and reusing the
 * held token otherwise. Returns the expected grant count and expected bearers.
 */
function simulateP18(
  callTimesMs: readonly number[],
  lifetimesSec: readonly number[],
): { expectedGrants: number; expectedBearers: string[] } {
  let heldExpiresAtMs: number | null = null;
  let grantIndex = 0;
  const expectedBearers: string[] = [];

  for (const t of callTimesMs) {
    if (heldExpiresAtMs === null || heldExpiresAtMs <= t) {
      const lifetimeMs = lifetimesSec[grantIndex % lifetimesSec.length]! * 1000;
      heldExpiresAtMs = t + lifetimeMs;
      grantIndex += 1;
    }
    expectedBearers.push(`token-${grantIndex - 1}`);
  }

  return { expectedGrants: grantIndex, expectedBearers };
}

/** A non-decreasing schedule of clock readings (ms) and the getMenus call count. */
const scheduleArbP18 = fc
  .array(fc.integer({ min: 0, max: 1_500_000 }), { minLength: 1, maxLength: 40 })
  .map((deltas) => {
    const base = 1_000_000;
    const times: number[] = [];
    let acc = base;
    for (const d of deltas) {
      acc += d;
      times.push(acc);
    }
    return times;
  });

/**
 * Token lifetimes (seconds) the grant endpoint reports. Includes `0`, which the
 * client treats as an immediately-expired token, alongside lifetimes short and
 * long relative to the call-time deltas.
 */
const lifetimesArbP18 = fc.array(fc.integer({ min: 0, max: 1200 }), {
  minLength: 1,
  maxLength: 10,
});

describe('Facilities_Client — Property 18: Public_Token obtained exactly when none unexpired is held (R1.4)', () => {
  it('acquires a new token on the first call and after expiry, and reuses it otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(scheduleArbP18, lifetimesArbP18, async (callTimesMs, lifetimesSec) => {
        const { transport, grants, bearers } = makeTokenTrackingTransportP18(lifetimesSec);

        let clock = 0;
        const client = createFacilitiesClient({
          credentials: TEST_CREDENTIALS,
          transport,
          menuService: { baseUrl: MENU_BASE_URL_P18, authorizationUrl: AUTH_URL_P18 },
          now: () => clock,
        });

        for (const t of callTimesMs) {
          clock = t;
          await client.getMenus('90002417;entityType=Restaurant');
        }

        const { expectedGrants, expectedBearers } = simulateP18(callTimesMs, lifetimesSec);

        // A grant is issued exactly when — and only when — no unexpired token is
        // held: the observed grant count equals the reference count (R1.4).
        expect(grants.count).toBe(expectedGrants);
        // Every Menu_Service call carried the token current at that instant.
        expect(bearers).toEqual(expectedBearers);
        // One bearer recorded per getMenus call — no menu call skipped the token.
        expect(bearers.length).toBe(callTimesMs.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reuses a single token across many calls while it stays unexpired (no redundant grants)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (callCount) => {
        const lifetimeSec = 3600;
        const { transport, grants, bearers } = makeTokenTrackingTransportP18([lifetimeSec]);

        let clock = 1_000_000;
        const client = createFacilitiesClient({
          credentials: TEST_CREDENTIALS,
          transport,
          menuService: { baseUrl: MENU_BASE_URL_P18, authorizationUrl: AUTH_URL_P18 },
          now: () => clock,
        });

        for (let i = 0; i < callCount; i += 1) {
          clock += 1000; // 1s steps, far below the 3600s lifetime
          await client.getMenus('90002417;entityType=Restaurant');
        }

        // Exactly one acquisition for the whole burst (R1.4: reused while unexpired).
        expect(grants.count).toBe(1);
        // Every call carried the same first token.
        expect(bearers).toEqual(Array.from({ length: callCount }, () => 'token-0'));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('re-acquires exactly at the expiry boundary: unexpired iff expiresAt > now (R1.4)', async () => {
    const lifetimeSec = 100;
    const expiryMs = lifetimeSec * 1000;

    // Case A: second call one ms before expiry → reuse (one grant total).
    {
      const { transport, grants, bearers } = makeTokenTrackingTransportP18([lifetimeSec]);
      let clock = 0;
      const client = createFacilitiesClient({
        credentials: TEST_CREDENTIALS,
        transport,
        menuService: { baseUrl: MENU_BASE_URL_P18, authorizationUrl: AUTH_URL_P18 },
        now: () => clock,
      });
      clock = 0;
      await client.getMenus('90002417;entityType=Restaurant');
      clock = expiryMs - 1;
      await client.getMenus('90002417;entityType=Restaurant');
      expect(grants.count).toBe(1);
      expect(bearers).toEqual(['token-0', 'token-0']);
    }

    // Case B: second call exactly at the expiry instant → re-acquire (two grants).
    {
      const { transport, grants, bearers } = makeTokenTrackingTransportP18([lifetimeSec]);
      let clock = 0;
      const client = createFacilitiesClient({
        credentials: TEST_CREDENTIALS,
        transport,
        menuService: { baseUrl: MENU_BASE_URL_P18, authorizationUrl: AUTH_URL_P18 },
        now: () => clock,
      });
      clock = 0;
      await client.getMenus('90002417;entityType=Restaurant');
      clock = expiryMs;
      await client.getMenus('90002417;entityType=Restaurant');
      expect(grants.count).toBe(2);
      expect(bearers).toEqual(['token-0', 'token-1']);
    }
  });
});
