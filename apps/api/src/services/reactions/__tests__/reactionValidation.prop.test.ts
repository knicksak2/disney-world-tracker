// Feature: social-sharing-loop, Property 16: Reactions are accepted if and only if drawn from the Reaction_Vocabulary
/**
 * Property-based test for the Reaction_Service validation boundary (task 14.2).
 *
 * Validates: Requirements 11.2, 11.3
 *
 * Property 16 (design.md → Correctness Properties → "Reactions are accepted
 * if and only if drawn from the Reaction_Vocabulary"):
 *
 *   For any candidate reaction value, the Reaction_Service persists it if and
 *   only if the value belongs to the Reaction_Vocabulary; a value outside the
 *   vocabulary is rejected with a validation error and nothing is persisted.
 *
 * Test strategy: drive the real `POST /me/inbox/:shareId/reactions` route
 * plugin through Fastify's `app.inject` against a fake `ReactionsRepo` that
 * records every `upsertReaction` call and always authorizes (so a valid
 * reaction reaches the repo and yields 204 rather than being masked by an
 * authorization failure). `requireSession` is stubbed to a fixed recipient.
 *
 * The candidate reaction is a `fast-check`-generated string drawn from a
 * mixed space:
 *   - the four Reaction_Vocabulary members (must be accepted),
 *   - arbitrary Unicode strings (almost surely outside the vocabulary),
 *   - deliberate near-misses (case variants, padded, empty) that must be
 *     rejected because the vocabulary is a closed, exact-match set.
 *
 * The single observable behaviour asserted is the iff:
 *   value ∈ SHARE_REACTION_VALUES  ⇔  204 AND repo.upsertReaction called
 *                                      once with that exact value
 *   value ∉ SHARE_REACTION_VALUES  ⇔  400 `reaction_invalid` AND repo not
 *                                      called (nothing persisted)
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import { SHARE_REACTION_VALUES } from '@dwt/shared';
import type { ShareReactionDTO, ShareReactionValue } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { reactionRoutes, type ReactionRoutesOptions } from '../routes.js';
import type { ReactionsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SHARE_ID = '22222222-2222-4222-8222-222222222222';

/** Membership test against the closed Reaction_Vocabulary (exact match). */
const VOCAB: ReadonlySet<string> = new Set(SHARE_REACTION_VALUES);

// ---------------------------------------------------------------------------
// Recording fake ReactionsRepo — always authorizes so a valid reaction
// reaches persistence and yields 204 (rather than reaction_forbidden).
// ---------------------------------------------------------------------------

interface RecordingRepo extends ReactionsRepo {
  /** Every `(shareId, recipientId, reaction)` passed to `upsertReaction`. */
  readonly upserts: Array<{
    shareId: string;
    recipientId: string;
    reaction: ShareReactionValue;
  }>;
}

function makeRecordingRepo(): RecordingRepo {
  const upserts: RecordingRepo['upserts'] = [];
  return {
    upserts,
    async upsertReaction(shareId, recipientId, reaction): Promise<void> {
      // Records the value the route forwarded. Reaching this method at all
      // means the value passed the vocabulary check at the route boundary.
      upserts.push({ shareId, recipientId, reaction });
    },
    async deleteReaction(): Promise<boolean> {
      return false;
    },
    async listReactionsForSender(): Promise<ShareReactionDTO[]> {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub — always authenticates as the fixed recipient. The
// session lifecycle is out of scope for Property 16; a fixed identity keeps
// the test focused on the vocabulary boundary.
// ---------------------------------------------------------------------------

const requireSession: ReactionRoutesOptions['requireSession'] = async (
  request,
) => {
  request.userId = USER_ID;
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(repo: ReactionsRepo): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(reactionRoutes({ repo, requireSession }));
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Every member of the closed vocabulary — the "accept" half of the iff. */
const vocabularyMemberArb: fc.Arbitrary<string> = fc.constantFrom(
  ...SHARE_REACTION_VALUES,
);

/**
 * Deliberate near-misses that must be rejected: case variants, padded
 * members, empty string, and other close-but-not-equal strings. These pin
 * down the "closed, exact-match set" semantics so a lenient (e.g.
 * case-insensitive or trimming) validator would surface as a counter-example.
 */
const nearMissArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  ' ',
  'Like',
  'LOVE',
  'like ',
  ' love',
  'been there',
  'want-to-go',
  'wanttogo',
  'likes',
  'heart',
  '👍',
  '❤️',
  'null',
  'undefined',
);

/**
 * Arbitrary strings. Almost surely outside the vocabulary, but a post-check
 * on membership (not exclusion) drives the assertion, so the rare collision
 * with a real member is handled correctly rather than being filtered away.
 */
const arbitraryStringArb: fc.Arbitrary<string> = fc.string({ maxLength: 40 });

/**
 * The full candidate space, biased toward the vocabulary so both halves of
 * the iff are exercised heavily across a run.
 */
const candidateReactionArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: vocabularyMemberArb },
  { weight: 3, arbitrary: nearMissArb },
  { weight: 3, arbitrary: arbitraryStringArb },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Reaction routes — Property 16: vocabulary iff persistence', () => {
  it(
    'accepts (204 + persists) a reaction iff it is a Reaction_Vocabulary member; otherwise rejects with reaction_invalid and persists nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(candidateReactionArb, async (candidate) => {
          const repo = makeRecordingRepo();
          const app = await buildApp(repo);
          try {
            const res = await app.inject({
              method: 'POST',
              url: `/me/inbox/${SHARE_ID}/reactions`,
              payload: { reaction: candidate } as Record<string, unknown>,
            });

            const inVocabulary = VOCAB.has(candidate);

            if (inVocabulary) {
              // Accept half: 204 No Content and the exact value persisted once.
              expect(res.statusCode).toBe(204);
              expect(res.body).toBe('');
              expect(repo.upserts).toEqual([
                {
                  shareId: SHARE_ID,
                  recipientId: USER_ID,
                  reaction: candidate,
                },
              ]);
            } else {
              // Reject half: 400 reaction_invalid and nothing persisted.
              expect(res.statusCode).toBe(400);
              const body = res.json() as { error?: { code?: string } };
              expect(body.error?.code).toBe('reaction_invalid');
              expect(repo.upserts).toEqual([]);
            }
          } finally {
            await app.close();
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
