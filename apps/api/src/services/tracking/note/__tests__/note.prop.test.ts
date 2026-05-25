// Feature: disney-world-tracker, Property 11: note state machine validates trimmed 1..2000 and replaces/deletes correctly
/**
 * Property-based test for the Tracking_Service Note state machine (task 10.7).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10
 *
 * Property 11 (design.md → Correctness Properties → "Note state machine and
 * validator"):
 *
 *   For any `(User, Experience)` pair and any sequence of note `save(body)`,
 *   `edit(body)`, and `delete()` operations, the stored state contains at
 *   most one Note; after any successful save or edit the stored body equals
 *   the most recently submitted body; `save` or `edit` is rejected when the
 *   trimmed length is 0 or the length exceeds 2000, leaving the prior body
 *   unchanged; `delete` after a save returns the state to no-Note; and
 *   the rendered view shows the stored body when present and the empty-
 *   state indicator when absent.
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over the real Note routes plugin via Fastify's `app.inject` and an in-
 * memory `NoteRepo` whose only state is the single allowed
 * `(user_id, experience_id)` row. Driving through the route layer
 * exercises the `noteInputSchema` validator (R5.2, R5.10) and the route
 * handlers' UPSERT/DELETE wiring at the same time, so a divergence at
 * any layer surfaces as a counter-example.
 *
 * The model holds:
 *
 *   { current: string | null }
 *
 * which is the externally observable Note state for the pair: the
 * trimmed body when a Note is stored, `null` when no Note exists. The
 * GET path covered by R5.8/R5.9 is asserted indirectly through the in-
 * memory repo's `getNote` (the same surface the future detail-screen GET
 * uses), so a present body renders to the trimmed value and an absent
 * body renders to `null` — the back-end equivalents of "the body" and
 * "empty-state indicator".
 *
 * Three commands cover the full transition space called out by the
 * property:
 *
 *   - `SetValid(body)`   — `body` trims to 1..2000 chars (includes
 *                         leading/trailing whitespace, exact boundary
 *                         points, and arbitrary Unicode cores). Must
 *                         succeed; the persisted body equals
 *                         `body.trim()` (R5.2, R5.3, R5.4, R5.5, R5.8).
 *
 *   - `SetInvalid(body)` — empty, whitespace-only, or trimmed length
 *                         > 2000. Must reject with
 *                         `note_length_invalid`; the prior body (if any)
 *                         is preserved (R5.10).
 *
 *   - `Delete`           — when a Note exists, succeeds with 204 and
 *                         clears the model (R5.6); when no Note exists,
 *                         rejects with `note_not_found` and the model
 *                         is unchanged (R5.7 — assertion of "no
 *                         modification on rejected delete" is part of
 *                         R5.10's "preserve prior on rejection" pattern).
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import type { NoteDTO } from '@dwt/shared';

import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { noteRoutes, type NoteRoutesOptions } from '../routes.js';
import type { NoteRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 30;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// In-memory NoteRepo (encodes the (user, experience) PK structurally)
// ---------------------------------------------------------------------------

interface InMemoryNoteRepo extends NoteRepo {
  /**
   * The one allowed entry per `(user_id, experience_id)`. Encoding
   * the unique key as the Map key makes R5.1's "at most one note per
   * (user, experience)" structurally true: a buggy repo cannot create
   * a duplicate row because the Map would silently overwrite it, and
   * the size check in `assertRepoMatchesModel` pins `size <= 1` end-
   * to-end.
   */
  readonly store: Map<string, NoteDTO>;
}

function repoKey(userId: string, experienceId: string): string {
  return `${userId}\u0000${experienceId}`;
}

/**
 * Build an in-memory `NoteRepo`. Mirrors the real Postgres-backed repo
 * one-to-one:
 *   - `upsertNote` inserts on absent or replaces the body in place
 *     (matching INSERT...ON CONFLICT DO UPDATE).
 *   - `deleteNote` returns `true` iff a row was removed.
 *   - `getNote` returns the stored DTO or `null`.
 *
 * The repo trusts the route layer to have trimmed + validated `body`
 * before calling, exactly like production.
 */
function makeInMemoryRepo(): InMemoryNoteRepo {
  const store = new Map<string, NoteDTO>();
  return {
    store,
    async upsertNote(
      userId: string,
      experienceId: string,
      body: string,
    ): Promise<NoteDTO> {
      const dto: NoteDTO = {
        userId,
        experienceId,
        body,
        updatedAt: new Date().toISOString(),
      };
      store.set(repoKey(userId, experienceId), dto);
      return dto;
    },
    async deleteNote(
      userId: string,
      experienceId: string,
    ): Promise<boolean> {
      return store.delete(repoKey(userId, experienceId));
    },
    async getNote(
      userId: string,
      experienceId: string,
    ): Promise<NoteDTO | null> {
      return store.get(repoKey(userId, experienceId)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------

/**
 * Minimal `requireSession` that always assigns `USER_ID`. The session
 * lifecycle is the subject of Property 14, not Property 11; exercising
 * it here would only add noise.
 */
const requireSession: NoteRoutesOptions['requireSession'] = async (
  request,
) => {
  request.userId = USER_ID;
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(repo: NoteRepo): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    noteRoutes({
      repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InjectionResult {
  statusCode: number;
  body: unknown;
  rawBody: string;
}

function bodyJson(body: string): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function injectPut(
  app: FastifyInstance,
  payload: unknown,
): Promise<InjectionResult> {
  const res = await app.inject({
    method: 'PUT',
    url: `/me/experiences/${EXPERIENCE_ID}/note`,
    payload: payload as Record<string, unknown>,
  });
  return {
    statusCode: res.statusCode,
    body: bodyJson(res.body),
    rawBody: res.body,
  };
}

async function injectDelete(app: FastifyInstance): Promise<InjectionResult> {
  const res = await app.inject({
    method: 'DELETE',
    url: `/me/experiences/${EXPERIENCE_ID}/note`,
  });
  return {
    statusCode: res.statusCode,
    body: bodyJson(res.body),
    rawBody: res.body,
  };
}

function expectErrorCode(result: InjectionResult, expectedCode: string): void {
  const body = result.body;
  if (
    body === null ||
    typeof body !== 'object' ||
    !('error' in body) ||
    typeof (body as { error: unknown }).error !== 'object' ||
    (body as { error: { code: unknown } }).error.code !== expectedCode
  ) {
    throw new AppError(
      'internal_error',
      `expected error code "${expectedCode}", got status=${result.statusCode}, body=${JSON.stringify(body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** The current trimmed Note body, or `null` when no Note is stored. */
  current: string | null;
}

interface Real {
  app: FastifyInstance;
  repo: InMemoryNoteRepo;
}

/**
 * R5.1 + R5.8 + R5.9: at most one Note per `(user, experience)`; when a
 * Note exists, its body equals the model's `current`; when none exists,
 * `getNote` resolves to `null`. The `getNote` round-trip stands in for
 * the App's "render the body" / "render the empty-state" path.
 */
async function assertRepoMatchesModel(
  m: Readonly<Model>,
  r: Readonly<Real>,
  context: string,
): Promise<void> {
  if (r.repo.store.size > 1) {
    throw new AppError(
      'internal_error',
      `R5.1 violated (${context}): repo holds ${r.repo.store.size} rows, expected <= 1`,
    );
  }
  const dto = await r.repo.getNote(USER_ID, EXPERIENCE_ID);
  if (m.current === null) {
    if (dto !== null) {
      throw new AppError(
        'internal_error',
        `model expects no note (${context}) but repo has body=${JSON.stringify(dto.body)}`,
      );
    }
    return;
  }
  if (dto === null) {
    throw new AppError(
      'internal_error',
      `model expects body=${JSON.stringify(m.current)} (${context}) but repo has no row`,
    );
  }
  if (dto.body !== m.current) {
    throw new AppError(
      'internal_error',
      `body drift (${context}): model=${JSON.stringify(m.current)}, repo=${JSON.stringify(dto.body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Trimmable whitespace runs that JavaScript's `String.prototype.trim`
 * removes. Used to wrap valid cores so generated bodies exercise R5.2's
 * "trim leading and trailing whitespace before validating" rule.
 */
const trimmableWhitespaceArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 0,
    maxLength: 5,
  })
  .map((parts) => parts.join(''));

/**
 * A non-whitespace core string of length 1..2000. Built from a string
 * generator that includes Unicode and then filtered to ensure
 * `core.trim()` has length 1..2000 (the inner-trim length is what
 * matters; surrounding whitespace is added by `validBodyArb`).
 *
 * `string16bits` rather than `string` so generators can produce surrogate
 * pairs and other interesting Unicode without the cost of the full
 * unicode generator (the property does not depend on grapheme semantics).
 */
const validInnerArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => {
    const t = s.trim();
    return t.length >= 1 && t.length <= 2000;
  });

/**
 * Bodies whose trimmed length is in `1..2000`. Includes the boundary
 * points (length 1 and length 2000) explicitly so shrinking can land
 * on them, and includes runs with leading/trailing whitespace that
 * trim away to a valid body.
 */
const validBodyArb: fc.Arbitrary<string> = fc.oneof(
  // Random core wrapped in random trimmable whitespace; the post-filter
  // keeps the trim length in `1..2000` (the wrapping whitespace can only
  // reduce, never grow, the trimmed length).
  fc
    .tuple(trimmableWhitespaceArb, validInnerArb, trimmableWhitespaceArb)
    .map(([pre, core, post]) => `${pre}${core}${post}`)
    .filter((s) => {
      const t = s.trim();
      return t.length >= 1 && t.length <= 2000;
    }),
  // Boundary seeds: exact 1- and 2000-character trimmed bodies, with
  // and without surrounding whitespace.
  fc.constantFrom(
    'a',
    'A',
    '  a  ',
    '\t\nz\n\t',
    'a'.repeat(2000),
    `   ${'b'.repeat(2000)}   `,
    'café',
    '🎢',
  ),
);

/**
 * Bodies that fail `noteInputSchema`'s trim-then-1..2000 check:
 *   - empty string
 *   - whitespace-only strings (trim → length 0)
 *   - strings whose trimmed length is strictly greater than 2000
 *
 * The boundary `'a'.repeat(2001)` is the immediate neighbor of the
 * 2000-character ceiling so shrinking lands on it.
 */
const whitespaceOnlyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 0,
    maxLength: 50,
  })
  .map((parts) => parts.join(''));

const overLengthArb: fc.Arbitrary<string> = fc
  .integer({ min: 2001, max: 2200 })
  .chain((len) =>
    // Build a non-whitespace string of exactly `len` chars so the trimmed
    // length is `len` and therefore strictly > 2000.
    fc.constant('a'.repeat(len)),
  );

/**
 * Strings that are wrapped in whitespace and whose inner non-whitespace
 * core exceeds 2000 chars. Hits the "trim is irrelevant — still too long"
 * branch.
 */
const wrappedOverLengthArb: fc.Arbitrary<string> = fc
  .tuple(
    trimmableWhitespaceArb,
    fc.integer({ min: 2001, max: 2100 }).map((n) => 'x'.repeat(n)),
    trimmableWhitespaceArb,
  )
  .map(([pre, core, post]) => `${pre}${core}${post}`);

const invalidBodyArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  whitespaceOnlyArb,
  overLengthArb,
  wrappedOverLengthArb,
  // Boundary seeds that shrinking can land on directly.
  fc.constantFrom(
    '',
    ' ',
    '\t',
    '\n',
    '   \t\n   ',
    'a'.repeat(2001),
    `  ${'b'.repeat(2001)}  `,
  ),
);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `SetValid(body)`: `body` trims to a 1..2000-character string. Must
 * succeed:
 *   - status 200,
 *   - response body is a `NoteDTO` whose `body` equals `body.trim()`,
 *   - the model's `current` becomes `body.trim()`,
 *   - the repo holds exactly that body.
 *
 * The acknowledgement (R5.3) is the 200-with-DTO response itself; we
 * also match the DTO's `body` field against the trimmed input to pin
 * down R5.2's "the trimmed body is what gets persisted".
 */
class SetValidCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly body: string) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const expectedBody = this.body.trim();
    const result = await injectPut(r.app, { body: this.body });

    if (result.statusCode !== 200) {
      throw new AppError(
        'internal_error',
        `SetValid expected 200; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    const dto = result.body as NoteDTO | null;
    if (
      dto === null ||
      typeof dto !== 'object' ||
      typeof dto.body !== 'string'
    ) {
      throw new AppError(
        'internal_error',
        `SetValid expected NoteDTO ack; got body=${JSON.stringify(result.body)}`,
      );
    }
    if (dto.body !== expectedBody) {
      throw new AppError(
        'internal_error',
        `SetValid persisted-body mismatch: expected=${JSON.stringify(expectedBody)}, ack=${JSON.stringify(dto.body)}`,
      );
    }
    if (
      dto.userId !== USER_ID ||
      dto.experienceId !== EXPERIENCE_ID
    ) {
      throw new AppError(
        'internal_error',
        `SetValid ack carries wrong identifiers: ${JSON.stringify(dto)}`,
      );
    }

    m.current = expectedBody;
    await assertRepoMatchesModel(m, r, 'SetValid');
  }
  toString(): string {
    return `SetValid(len=${this.body.length}, trimmed=${this.body.trim().length})`;
  }
}

/**
 * `SetInvalid(body)`: empty, whitespace-only, or trimmed length > 2000.
 * Must reject with `note_length_invalid`. Per R5.10 the prior Note
 * (if any) must be preserved, so the model is unchanged and the repo
 * still matches it.
 */
class SetInvalidCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly body: string) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const before: Model = { current: m.current };
    const result = await injectPut(r.app, { body: this.body });

    if (result.statusCode !== 400) {
      throw new AppError(
        'internal_error',
        `SetInvalid expected 400; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    expectErrorCode(result, 'note_length_invalid');

    // R5.10: prior state preserved on rejection.
    if (m.current !== before.current) {
      throw new AppError(
        'internal_error',
        'SetInvalid mutated the model; rejection must be a no-op',
      );
    }
    await assertRepoMatchesModel(m, r, 'SetInvalid');
  }
  toString(): string {
    const trimmed = this.body.trim().length;
    return `SetInvalid(len=${this.body.length}, trimmed=${trimmed})`;
  }
}

/**
 * `Delete`:
 *   - When a Note exists: success → 204, model.current = null (R5.6).
 *   - When no Note exists: rejected with `note_not_found`; model
 *     unchanged.
 */
class DeleteCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const before: Model = { current: m.current };
    const result = await injectDelete(r.app);

    if (before.current === null) {
      if (result.statusCode !== 404) {
        throw new AppError(
          'internal_error',
          `Delete on empty expected 404; got ${result.statusCode}`,
        );
      }
      expectErrorCode(result, 'note_not_found');
      if (m.current !== before.current) {
        throw new AppError(
          'internal_error',
          'rejected Delete mutated the model; should be a no-op',
        );
      }
      await assertRepoMatchesModel(m, r, 'Delete on empty');
      return;
    }

    if (result.statusCode !== 204) {
      throw new AppError(
        'internal_error',
        `Delete on existing expected 204; got ${result.statusCode}, body=${JSON.stringify(result.body)}`,
      );
    }
    if (result.rawBody !== '') {
      throw new AppError(
        'internal_error',
        `Delete on existing expected empty body; got ${JSON.stringify(result.rawBody)}`,
      );
    }
    m.current = null;
    await assertRepoMatchesModel(m, r, 'Delete on existing');
  }
  toString(): string {
    return 'Delete';
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Note routes — Property 11: state machine and validator', () => {
  it(
    'a sequence of save/edit/delete plus invalid bodies preserves R5.1 cardinality, persists the trimmed body, and preserves prior on rejection',
    async () => {
      const setValidCmdArb = validBodyArb.map((b) => new SetValidCommand(b));
      const setInvalidCmdArb = invalidBodyArb.map(
        (b) => new SetInvalidCommand(b),
      );
      const deleteCmdArb = fc.constant(new DeleteCommand());

      // Bias the distribution so successful saves dominate (long runs
      // spend significant time in the "note exists" half of the state
      // machine), with frequent rejections and deletes to keep the
      // validator and the not-found branches well-exercised.
      const cmdArb = fc.oneof(
        { weight: 5, arbitrary: setValidCmdArb },
        { weight: 3, arbitrary: setInvalidCmdArb },
        { weight: 3, arbitrary: deleteCmdArb },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
          async (cmds) => {
            const repo = makeInMemoryRepo();
            const app = await buildApp(repo);
            try {
              const setup = (): { model: Model; real: Real } => ({
                model: { current: null },
                real: { app, repo },
              });
              await fc.asyncModelRun(setup, cmds);
            } finally {
              await app.close();
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
