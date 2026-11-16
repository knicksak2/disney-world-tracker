/**
 * `POST /me/feedback` (`.kiro/specs/in-app-feedback`, Requirements 2.1 to 2.7, 3.1 to 3.3, 6.1, 6.2).
 *
 * Flow: validate the body, enforce the per-user caps from the database, insert one row (which also proves the account
 * is active), then make one best-effort bounded prune of old resolved rows. The message, the contact email and the
 * device values are never logged.
 */
import { feedbackSubmitInputSchema, type FeedbackSubmitResponse } from '@dwt/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { checkCaps, pruneCutoff, type FeedbackCaps } from './policy.js';
import type { FeedbackRepo } from './repo.js';

export const FEEDBACK_PATH = '/me/feedback';
/** Max rows one accepted submission may prune (design, Configuration & Constants). */
export const FEEDBACK_PRUNE_BATCH = 200;
export const FEEDBACK_LIMIT_MESSAGE = 'You have sent a lot of feedback recently. Please try again later.';

export interface FeedbackRoutesOptions {
  readonly repo: FeedbackRepo;
  readonly caps: FeedbackCaps;
  readonly retentionDays: number;
  readonly requireSession: preHandlerHookHandler;
  readonly now?: () => Date;
}

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  try {
    return schema.parse(body) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      // The message names the field only: never the submitted value.
      const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
      throw field !== undefined
        ? new AppError('validation_failed', message, { field })
        : new AppError('validation_failed', message);
    }
    throw err;
  }
}

function requireUserId(request: FastifyRequest): string {
  const { userId } = request;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

export function feedbackRoutes(options: FeedbackRoutesOptions): FastifyPluginAsync {
  const { repo, caps, retentionDays, requireSession } = options;
  const now = options.now ?? ((): Date => new Date());

  return async function feedbackRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.post(FEEDBACK_PATH, { preHandler: requireSession }, async (request, reply): Promise<FeedbackSubmitResponse> => {
      const userId = requireUserId(request);
      const body = parseBody(feedbackSubmitInputSchema, request.body);
      const at = now();

      const counts = await repo.countRecent(userId, at);
      if (checkCaps(counts, caps) === 'limit') {
        throw new AppError('rate_limit_exceeded', FEEDBACK_LIMIT_MESSAGE);
      }

      const id = await repo.insert({
        userId,
        kind: body.kind,
        message: body.message,
        contactOk: body.contactOk,
        device: body.device,
      });
      if (id === null) {
        // The account is not active (for example pending deletion): nothing was stored.
        throw new AppError('unauthorized', 'Authentication is required.');
      }

      try {
        await repo.pruneResolved(pruneCutoff(at, retentionDays), FEEDBACK_PRUNE_BATCH);
      } catch (err) {
        // Best effort (Requirement 6.1): log the error class only, never anything the user wrote.
        request.log.warn({ errName: err instanceof Error ? err.name : 'unknown' }, 'feedback prune failed');
      }

      return reply.code(201).send({ id });
    });
  };
}
