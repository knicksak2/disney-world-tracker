// Feature: disney-world-tracker, Property 23: delivered payload contains rating, note (<=2000), or capped progress percentages per share kind
/**
 * Property-based test for the Sharing_Service share payload composition
 * (task 12.3).
 *
 * Validates: Requirements 9.4, 9.5, 9.6, 9.7
 *
 * Design Property 23 (design.md → Correctness Properties → "Share payload
 * composition"):
 *
 *   For any delivered Share, the delivered payload satisfies:
 *     - when the Share includes the sender's Rating and a Rating exists at
 *       delivery time, the payload contains the integer Rating value in
 *       `1..10` (R9.4);
 *     - when the Share includes the sender's Rating and no Rating exists at
 *       delivery time, the payload omits the Rating value and includes a
 *       rating-unavailable notice (R9.5);
 *     - when the Share includes the sender's Note, the payload contains the
 *       Note body truncated to at most 2000 characters (R9.6);
 *     - when the Share is an overall-progress share, the payload contains
 *       overall, per-Park, and per-Experience_Category percentages each in
 *       `[0.0, 100.0]` (R9.7).
 *
 * Test strategy:
 *
 *   We drive randomly generated `POST /me/shares` request bodies through the
 *   real Sharing routes plugin via Fastify's `app.inject`, with a fake
 *   `SharingRepo` that captures the composed `SharePayload` handed to
 *   `createShareAtomic`. The fake repo is the seam at which the route
 *   layer's payload composition is observable: whatever the route writes to
 *   the repo's `payload` argument is exactly what would be persisted in the
 *   `payload_snapshot` column.
 *
 *   For each generated request we record both the input shape and the
 *   captured payload (or the rejection envelope), then assert per-kind:
 *
 *     - `experience` requests:
 *         * R9.4: when a numeric `rating` is supplied (irrespective of the
 *           `includeRating` flag), the captured payload's `rating` equals
 *           that integer and `ratingUnavailable` is absent.
 *         * R9.5: when `rating` is `null` or omitted but `includeRating` is
 *           `true`, the captured payload has `rating === null` and
 *           `ratingUnavailable === true`.
 *         * R9.5 (negative): when `includeRating` is false/omitted and no
 *           rating is supplied, neither `rating` nor `ratingUnavailable`
 *           appears in the payload.
 *         * R9.6: when a `note` of trimmed length 1..2000 is supplied, the
 *           captured payload's `note` equals the trimmed body. When the
 *           supplied `note` is overlong (trim length > 2000), the request
 *           is rejected with `note_length_invalid` *before* the repo is
 *           ever called — the route layer's `noteBodySchema` enforces this
 *           and the captured payload is therefore never produced.
 *
 *     - `progress` requests:
 *         * R9.7: every percentage in the captured payload's
 *           `overallPercent`, `perParkPercent`, and `perCategoryPercent`
 *           fields lies in `[0.0, 100.0]`. The route's `clampPercent`
 *           helper is responsible for capping the input range
 *           `[-50, 200]` we generate.
 *
 *   `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import type {
  ExperienceCategory,
  ExperienceSharePayload,
  Park,
  ProgressSharePayload,
  SharePayload,
} from '@dwt/shared';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type {
  InboxResponse,
  OpenedShareDetail,
  ShareDeliveryResult,
  SharingRepo,
} from '../repo.js';
import { sharingRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

const SENDER = '11111111-1111-4111-8111-111111111111';
const REC_A = '22222222-2222-4222-8222-222222222222';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';
const EXPERIENCE_ID = '55555555-5555-4555-8555-555555555555';

// ---------------------------------------------------------------------------
// Capture-only fake repo
// ---------------------------------------------------------------------------

/**
 * The repo's only job in this property is to capture the `payload` argument
 * passed to `createShareAtomic`. The other repo methods are stubbed because
 * the property only exercises `POST /me/shares`.
 *
 * Returning a plausible `ShareDeliveryResult` keeps the route layer on the
 * happy path so a 201 response is produced and we can assert the captured
 * payload reflects the route's composition logic.
 */
interface CaptureRepo extends SharingRepo {
  /** Most recent payload composed by the route layer, or `undefined`. */
  lastPayload: SharePayload | undefined;
  /** Number of times `createShareAtomic` was invoked. */
  callCount: number;
}

function makeCaptureRepo(): CaptureRepo {
  const repo: CaptureRepo = {
    lastPayload: undefined,
    callCount: 0,
    async createShareAtomic(
      _senderId: string,
      _recipientIds: ReadonlyArray<string>,
      payload: SharePayload,
    ): Promise<ShareDeliveryResult> {
      repo.lastPayload = payload;
      repo.callCount += 1;
      return { shareId: SHARE_ID, deliveredTo: _recipientIds.length };
    },
    async listInbox(): Promise<InboxResponse> {
      return { unread: 0, items: [] };
    },
    async openShare(): Promise<OpenedShareDetail | null> {
      return null;
    },
    async softDeleteForRecipient(): Promise<boolean> {
      return false;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// requireSession stub (Property 14 covers session lifecycle)
// ---------------------------------------------------------------------------

const requireSession = async (
  request: { userId?: string },
): Promise<void> => {
  request.userId = SENDER;
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(repo: SharingRepo): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    sharingRoutes({
      repo,
      // The session middleware's `preHandlerHookHandler` shape is matched
      // structurally by the stub above; cast for type compatibility.
      requireSession: requireSession as never,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Trimmable whitespace runs that JavaScript's `String.prototype.trim`
 * removes. Used to generate notes with leading/trailing whitespace so the
 * route layer's `noteBodySchema` (which trims before checking length) is
 * exercised on both branches.
 */
const trimmableWhitespaceArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 0,
    maxLength: 5,
  })
  .map((parts) => parts.join(''));

/**
 * Generate raw note bodies with trimmed length up to 2500 characters.
 *
 * The schema's bound is 2000 (R9.6); generating up to 2500 lets fast-check
 * land on counterexamples on either side of the boundary so the
 * "overlong notes are rejected before reaching the repo" path is covered
 * uniformly with the "in-range notes flow through to the payload" path.
 *
 * Length 0 is included as a special case so the whitespace-only / empty
 * branch of the schema is also exercised.
 */
const noteBodyArb: fc.Arbitrary<string> = fc.oneof(
  // Empty / whitespace-only — schema rejects with note_length_invalid.
  trimmableWhitespaceArb,
  // Wrapped non-whitespace core whose total length lands in `[1, 2500]`.
  fc
    .tuple(
      trimmableWhitespaceArb,
      fc.integer({ min: 1, max: 2500 }).chain((len) =>
        // A non-whitespace string of exactly `len` chars so the trimmed
        // length is `len`.
        fc.constant('a'.repeat(len)),
      ),
      trimmableWhitespaceArb,
    )
    .map(([pre, core, post]) => `${pre}${core}${post}`),
  // Boundary seeds so shrinking lands on them directly.
  fc.constantFrom(
    '',
    ' ',
    'a',
    'a'.repeat(2000),
    'a'.repeat(2001),
    `   ${'b'.repeat(2000)}   `,
    `   ${'b'.repeat(2001)}   `,
  ),
);

/**
 * Rating choice generator. Includes:
 *   - integer `1..10` (the in-range R9.4 path)
 *   - `null` (the "explicit unavailable" R9.5 path)
 *   - "absent" sentinel (rating field omitted from the body)
 */
type RatingChoice =
  | { kind: 'integer'; value: number }
  | { kind: 'null' }
  | { kind: 'absent' };

const ratingChoiceArb: fc.Arbitrary<RatingChoice> = fc.oneof(
  fc
    .integer({ min: 1, max: 10 })
    .map((value) => ({ kind: 'integer' as const, value })),
  fc.constant({ kind: 'null' as const }),
  fc.constant({ kind: 'absent' as const }),
);

/**
 * `includeRating` flag generator. Includes the explicit `true` / `false`
 * values plus an "absent" sentinel so the route's "omitted ⇒ inferred"
 * branch is exercised.
 */
type IncludeRatingChoice = { value: boolean } | { absent: true };

const includeRatingChoiceArb: fc.Arbitrary<IncludeRatingChoice> = fc.oneof(
  fc.boolean().map((b) => ({ value: b })),
  fc.constant({ absent: true as const }),
);

/**
 * Note choice generator. `absent` means the note field is omitted from the
 * body entirely (the route then composes a payload with no `note` key);
 * `present` carries a generated raw body which may or may not satisfy the
 * trim-length bound.
 */
type NoteChoice = { kind: 'absent' } | { kind: 'present'; body: string };

const noteChoiceArb: fc.Arbitrary<NoteChoice> = fc.oneof(
  fc.constant({ kind: 'absent' as const }),
  noteBodyArb.map((body) => ({ kind: 'present' as const, body })),
);

/**
 * Experience-share input generator. Combines the rating, includeRating,
 * and note dimensions, then assembles a request body in the shape the
 * route expects.
 */
interface ExperienceShareInput {
  kind: 'experience';
  rating: RatingChoice;
  includeRating: IncludeRatingChoice;
  note: NoteChoice;
}

const experienceShareInputArb: fc.Arbitrary<ExperienceShareInput> = fc
  .record({
    rating: ratingChoiceArb,
    includeRating: includeRatingChoiceArb,
    note: noteChoiceArb,
  })
  .map((parts) => ({ kind: 'experience' as const, ...parts }));

/**
 * Percentage generator covering `[-50, 200]` so the route's
 * `clampPercent` helper is exercised on both the negative-floor and the
 * over-100 cap. Includes the boundary points `-50`, `0`, `100`, `200`
 * explicitly so shrinking can land on them.
 *
 * Integer-valued generation keeps counterexamples readable; the repo's
 * contract is range-only, not precision-based.
 */
const rawPercentArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -50, max: 200 }),
  fc.constantFrom(-50, -1, 0, 1, 50, 99, 100, 101, 150, 200),
);

/**
 * Optional per-Park / per-category percentage map. For each enum value, we
 * randomly include or omit a generated percentage so the route's "skip
 * undefined keys" loop is exercised.
 */
function partialPercentMapArb<K extends string>(
  keys: ReadonlyArray<K>,
): fc.Arbitrary<{ [P in K]?: number }> {
  return fc
    .tuple(
      ...keys.map((key) =>
        fc
          .option(rawPercentArb, { freq: 2, nil: undefined })
          .map((value) => ({ key, value })),
      ),
    )
    .map((entries) => {
      const result: { [P in K]?: number } = {};
      for (const { key, value } of entries) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
      return result;
    });
}

const perParkPercentArb = partialPercentMapArb<Park>(PARKS);
const perCategoryPercentArb = partialPercentMapArb<ExperienceCategory>(
  EXPERIENCE_CATEGORIES,
);

interface ProgressShareInput {
  kind: 'progress';
  overallPercent: number;
  perParkPercent: { [K in Park]?: number };
  perCategoryPercent: { [K in ExperienceCategory]?: number };
}

const progressShareInputArb: fc.Arbitrary<ProgressShareInput> = fc.record({
  kind: fc.constant('progress' as const),
  overallPercent: rawPercentArb,
  perParkPercent: perParkPercentArb,
  perCategoryPercent: perCategoryPercentArb,
});

type ShareInput = ExperienceShareInput | ProgressShareInput;

const shareInputArb: fc.Arbitrary<ShareInput> = fc.oneof(
  experienceShareInputArb,
  progressShareInputArb,
);

// ---------------------------------------------------------------------------
// Body construction
// ---------------------------------------------------------------------------

/**
 * Build the `POST /me/shares` request body from a generated input record.
 *
 * The construction faithfully reproduces the wire format the route's Zod
 * schema expects: optional fields are entirely omitted (rather than set to
 * `undefined`) so the schema's `optional` semantics decide presence.
 */
function buildBody(input: ShareInput): Record<string, unknown> {
  if (input.kind === 'experience') {
    const body: Record<string, unknown> = {
      kind: 'experience',
      recipientIds: [REC_A],
      experienceId: EXPERIENCE_ID,
    };
    if (input.rating.kind === 'integer') {
      body.rating = input.rating.value;
    } else if (input.rating.kind === 'null') {
      body.rating = null;
    }
    // `kind: 'absent'` ⇒ no rating key set.
    if ('value' in input.includeRating) {
      body.includeRating = input.includeRating.value;
    }
    if (input.note.kind === 'present') {
      body.note = input.note.body;
    }
    return body;
  }
  return {
    kind: 'progress',
    recipientIds: [REC_A],
    statsSnapshot: {
      overallPercent: input.overallPercent,
      perParkPercent: input.perParkPercent,
      perCategoryPercent: input.perCategoryPercent,
    },
  };
}

// ---------------------------------------------------------------------------
// Oracle helpers
// ---------------------------------------------------------------------------

/**
 * R9.6 oracle: a note is rejected by `noteBodySchema` iff its trimmed length
 * is not in `[1, 2000]`.
 */
function noteIsRejected(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length < 1 || trimmed.length > 2000;
}

function clampPercentExpected(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Infinity ? 100 : 0;
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Sharing routes — Property 23: payload composition', () => {
  it(
    'composes the payload per share kind: rating decision table, note <=2000, progress percentages capped to [0,100]',
    async () => {
      const repo = makeCaptureRepo();
      const app = await buildApp(repo);

      try {
        await fc.assert(
          fc.asyncProperty(shareInputArb, async (input) => {
            // Reset capture state for this iteration.
            repo.lastPayload = undefined;
            const callCountBefore = repo.callCount;

            const response = await app.inject({
              method: 'POST',
              url: '/me/shares',
              payload: buildBody(input),
            });

            // -----------------------------------------------------------
            // experience kind
            // -----------------------------------------------------------
            if (input.kind === 'experience') {
              const noteRejected =
                input.note.kind === 'present' && noteIsRejected(input.note.body);

              if (noteRejected) {
                // R9.6: an overlong / empty / whitespace-only note must
                // be rejected by `noteBodySchema` *before* the route
                // hands a payload to the repo. The captured payload is
                // therefore never produced for this iteration.
                if (response.statusCode !== 400) {
                  throw new AppError(
                    'internal_error',
                    `R9.6 oracle: expected 400 for overlong note (trim length ${input.note.kind === 'present' ? input.note.body.trim().length : -1}); got ${response.statusCode}`,
                  );
                }
                const errBody = response.json() as { error: { code: string } };
                if (errBody.error.code !== 'note_length_invalid') {
                  throw new AppError(
                    'internal_error',
                    `R9.6 oracle: expected note_length_invalid; got ${errBody.error.code}`,
                  );
                }
                if (repo.callCount !== callCountBefore) {
                  throw new AppError(
                    'internal_error',
                    'R9.6 oracle: repo was invoked even though the schema rejected the note',
                  );
                }
                return;
              }

              // Otherwise the route should compose a payload and call
              // the repo exactly once.
              if (response.statusCode !== 201) {
                throw new AppError(
                  'internal_error',
                  `experience share: expected 201; got ${response.statusCode}, body=${response.body}`,
                );
              }
              if (repo.callCount !== callCountBefore + 1) {
                throw new AppError(
                  'internal_error',
                  `experience share: expected exactly one repo call; got ${repo.callCount - callCountBefore}`,
                );
              }
              const payload = repo.lastPayload as
                | ExperienceSharePayload
                | undefined;
              if (!payload || payload.kind !== 'experience') {
                throw new AppError(
                  'internal_error',
                  `experience share: captured payload missing or wrong kind: ${JSON.stringify(payload)}`,
                );
              }
              if (payload.experienceId !== EXPERIENCE_ID) {
                throw new AppError(
                  'internal_error',
                  `experience share: experienceId drift: ${payload.experienceId}`,
                );
              }

              // R9.4 / R9.5 decision-table oracle.
              //
              //   includesRating := (includeRating === true) || ('rating' in body)
              //   ratingPresent  := body.rating is a finite number
              //
              // When includesRating is false, the payload has no rating
              // fields. When includesRating is true and ratingPresent,
              // the payload's rating is the integer (R9.4). When
              // includesRating is true and not ratingPresent, the
              // payload has rating: null and ratingUnavailable: true
              // (R9.5).
              const includeRatingValue =
                'value' in input.includeRating
                  ? input.includeRating.value
                  : false;
              const ratingKeyPresent = input.rating.kind !== 'absent';
              const includesRating = includeRatingValue || ratingKeyPresent;
              const ratingPresent = input.rating.kind === 'integer';

              if (!includesRating) {
                if ('rating' in payload) {
                  throw new AppError(
                    'internal_error',
                    `R9.5 oracle: rating field unexpectedly present (${JSON.stringify(payload.rating)}) when not requested`,
                  );
                }
                if (payload.ratingUnavailable !== undefined) {
                  throw new AppError(
                    'internal_error',
                    'R9.5 oracle: ratingUnavailable set when rating not requested',
                  );
                }
              } else if (ratingPresent) {
                // R9.4: integer 1..10 included verbatim.
                const expected = (input.rating as { kind: 'integer'; value: number })
                  .value;
                if (payload.rating !== expected) {
                  throw new AppError(
                    'internal_error',
                    `R9.4: rating drift: expected=${expected}, payload=${JSON.stringify(payload.rating)}`,
                  );
                }
                if (payload.ratingUnavailable === true) {
                  throw new AppError(
                    'internal_error',
                    'R9.4: ratingUnavailable=true even though rating was supplied',
                  );
                }
              } else {
                // R9.5: rating null + ratingUnavailable true.
                if (payload.rating !== null) {
                  throw new AppError(
                    'internal_error',
                    `R9.5: rating should be null; got ${JSON.stringify(payload.rating)}`,
                  );
                }
                if (payload.ratingUnavailable !== true) {
                  throw new AppError(
                    'internal_error',
                    `R9.5: ratingUnavailable should be true; got ${JSON.stringify(payload.ratingUnavailable)}`,
                  );
                }
              }

              // R9.6 happy path: when an in-range note was supplied, the
              // payload's note equals the schema's trimmed body and is
              // bounded by 2000 chars.
              if (input.note.kind === 'present') {
                const expectedNote = input.note.body.trim();
                if (payload.note !== expectedNote) {
                  throw new AppError(
                    'internal_error',
                    `R9.6: note body drift: expected=${JSON.stringify(expectedNote)}, payload=${JSON.stringify(payload.note)}`,
                  );
                }
                if (
                  typeof payload.note === 'string' &&
                  payload.note.length > 2000
                ) {
                  throw new AppError(
                    'internal_error',
                    `R9.6: note exceeded 2000 chars in payload (length=${payload.note.length})`,
                  );
                }
              } else if (payload.note !== undefined) {
                throw new AppError(
                  'internal_error',
                  `R9.6: note unexpectedly present in payload: ${JSON.stringify(payload.note)}`,
                );
              }
              return;
            }

            // -----------------------------------------------------------
            // progress kind
            // -----------------------------------------------------------
            if (response.statusCode !== 201) {
              throw new AppError(
                'internal_error',
                `progress share: expected 201; got ${response.statusCode}, body=${response.body}`,
              );
            }
            if (repo.callCount !== callCountBefore + 1) {
              throw new AppError(
                'internal_error',
                `progress share: expected exactly one repo call; got ${repo.callCount - callCountBefore}`,
              );
            }
            const payload = repo.lastPayload as ProgressSharePayload | undefined;
            if (!payload || payload.kind !== 'progress') {
              throw new AppError(
                'internal_error',
                `progress share: captured payload missing or wrong kind: ${JSON.stringify(payload)}`,
              );
            }

            // R9.7: every percentage in `[0.0, 100.0]` and equal to the
            // route's `clampPercent` of the input. We assert range and
            // exact-value equality so the property pins both the bound
            // (capped at 100, floored at 0) and the no-rounding contract
            // (within-range inputs flow through verbatim).
            const overallExpected = clampPercentExpected(input.overallPercent);
            if (payload.overallPercent !== overallExpected) {
              throw new AppError(
                'internal_error',
                `R9.7 overallPercent: expected=${overallExpected}, payload=${payload.overallPercent}`,
              );
            }
            if (payload.overallPercent < 0 || payload.overallPercent > 100) {
              throw new AppError(
                'internal_error',
                `R9.7 overallPercent out of [0,100]: ${payload.overallPercent}`,
              );
            }

            for (const park of PARKS) {
              const inputValue = input.perParkPercent[park];
              const payloadValue = payload.perParkPercent[park];
              if (inputValue === undefined) {
                if (payloadValue !== undefined) {
                  throw new AppError(
                    'internal_error',
                    `R9.7 perParkPercent[${park}]: expected absent, got ${payloadValue}`,
                  );
                }
                continue;
              }
              const expected = clampPercentExpected(inputValue);
              if (payloadValue !== expected) {
                throw new AppError(
                  'internal_error',
                  `R9.7 perParkPercent[${park}]: expected=${expected}, payload=${payloadValue}`,
                );
              }
              if (
                payloadValue === undefined ||
                payloadValue < 0 ||
                payloadValue > 100
              ) {
                throw new AppError(
                  'internal_error',
                  `R9.7 perParkPercent[${park}] out of [0,100]: ${payloadValue}`,
                );
              }
            }

            for (const category of EXPERIENCE_CATEGORIES) {
              const inputValue = input.perCategoryPercent[category];
              const payloadValue = payload.perCategoryPercent[category];
              if (inputValue === undefined) {
                if (payloadValue !== undefined) {
                  throw new AppError(
                    'internal_error',
                    `R9.7 perCategoryPercent[${category}]: expected absent, got ${payloadValue}`,
                  );
                }
                continue;
              }
              const expected = clampPercentExpected(inputValue);
              if (payloadValue !== expected) {
                throw new AppError(
                  'internal_error',
                  `R9.7 perCategoryPercent[${category}]: expected=${expected}, payload=${payloadValue}`,
                );
              }
              if (
                payloadValue === undefined ||
                payloadValue < 0 ||
                payloadValue > 100
              ) {
                throw new AppError(
                  'internal_error',
                  `R9.7 perCategoryPercent[${category}] out of [0,100]: ${payloadValue}`,
                );
              }
            }
          }),
          { numRuns: NUM_RUNS },
        );
      } finally {
        await app.close();
      }
    },
    60_000,
  );
});
