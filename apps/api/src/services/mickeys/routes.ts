import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';
import type { MickeysConfig } from '../../config.js';
import type { HuntService } from './service.js';
import { AppError } from '../../errors/AppError.js';
import {
  uuidSchema,
  mickeyListQuerySchema,
  mickeyHintBodySchema,
  mickeyFindBodySchema,
  mickeyVoteBodySchema,
  mickeyReportBodySchema,
  mickeySubmissionBodySchema,
} from '@dwt/shared';
import type { SubmissionService } from './submissionService.js';
import type { ReportService } from './reportService.js';

export interface MickeyRoutesOptions {
  readonly huntService: HuntService;
  readonly submissionService?: SubmissionService;
  readonly reportService?: ReportService;
  readonly requireSession: preHandlerHookHandler;
  readonly config: MickeysConfig;
}

const idParamSchema = z.object({ id: uuidSchema }).strict();
const summaryQuerySchema = z.object({ for: uuidSchema.optional() }).strict();
const emptyBodySchema = z.union([
  z.undefined(),
  z.null(),
  z.object({}).strict(),
]);

function assertMickeysEnabled(config: MickeysConfig): void {
  if (!config.enabled) {
    throw new AppError(
      'mickey_feature_disabled',
      'Hidden Mickeys feature is currently disabled.',
    );
  }
}

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (!userId) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function parseOrAppError<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0
          ? issue.path.map(String).join('.')
          : undefined;
      const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
      throw new AppError('validation_failed', message, field !== undefined ? { field } : undefined);
    }
    throw err;
  }
}

import type { MickeyListFilters } from './repo.js';

function cleanOptionalFilters(obj: Record<string, unknown>): MickeyListFilters {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      result[k] = v;
    }
  }
  return result as unknown as MickeyListFilters;
}

export function mickeyRoutes(options: MickeyRoutesOptions): FastifyPluginAsync {
  return async function mickeyRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. Static routes registered FIRST so they are not captured by /mickeys/:id
    // -------------------------------------------------------------------------

    // GET /mickeys/config (R14.3 — always accessible, even if feature is disabled)
    app.get('/mickeys/config', async (_request, reply) => {
      const cfg = options.huntService.getConfig();
      reply.code(200).send(cfg);
    });

    // GET /mickeys/summary (R2.5 - R2.8, R10.1)
    app.get(
      '/mickeys/summary',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const query = parseOrAppError(summaryQuerySchema, request.query);
        const summary = await options.huntService.getSummary(userId, query.for);
        reply.code(200).send(summary);
      },
    );

    // POST /me/mickeys/submissions (Requirement 6) and POST /mickeys alias
    const handleSubmission = async (request: FastifyRequest, reply: any) => {
      assertMickeysEnabled(options.config);
      const userId = requireUser(request);
      if (!options.submissionService) {
        throw new AppError('mickey_feature_disabled', 'Submissions service is not available.');
      }
      const body = parseOrAppError(mickeySubmissionBodySchema, request.body);
      const submission = await options.submissionService.createSubmission(userId, body);
      reply.code(201).send(submission);
    };

    app.post(
      '/me/mickeys/submissions',
      { preHandler: options.requireSession },
      handleSubmission,
    );

    app.post(
      '/mickeys',
      { preHandler: options.requireSession },
      handleSubmission,
    );

    // GET /me/mickeys/submissions (Requirement 9.1)
    app.get(
      '/me/mickeys/submissions',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        if (!options.submissionService) {
          throw new AppError('mickey_feature_disabled', 'Submissions service is not available.');
        }
        const list = await options.submissionService.listMySubmissions(userId);
        reply.code(200).send(list);
      },
    );

    // -------------------------------------------------------------------------
    // 2. Collection route
    // -------------------------------------------------------------------------

    // GET /mickeys (R2.1 - R2.4)
    app.get(
      '/mickeys',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const query = parseOrAppError(mickeyListQuerySchema, request.query);
        const result = await options.huntService.listMickeys(cleanOptionalFilters(query), userId);
        reply.code(200).send(result);
      },
    );

    // GET /users/:userId/mickeys/finds (R10.2, R10.3)
    app.get<{ Params: { userId: string } }>(
      '/users/:userId/mickeys/finds',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const requesterId = requireUser(request);
        const { userId } = parseOrAppError(
          z.object({ userId: uuidSchema }).strict(),
          request.params,
        );
        const query = parseOrAppError(
          z.object({
            cursor: z.string().min(1).optional(),
            limit: z.coerce.number().int().min(1).max(50).default(20),
          }).strict(),
          request.query,
        );
        const page = await options.huntService.getUserFinds(
          requesterId,
          userId,
          query.cursor,
          query.limit,
        );
        reply.code(200).send(page);
      },
    );

    // -------------------------------------------------------------------------
    // 3. Parametric item route
    // -------------------------------------------------------------------------

    // GET /mickeys/:id (R3.2, R3.7)
    app.get<{ Params: { id: string } }>(
      '/mickeys/:id',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        const detail = await options.huntService.getMickeyDetail(id, userId);
        reply.code(200).send(detail);
      },
    );

    // -------------------------------------------------------------------------
    // 4. User actions under /me/mickeys/:id
    // -------------------------------------------------------------------------

    // POST /me/mickeys/:id/hint (R3.3, R3.4)
    app.post<{ Params: { id: string } }>(
      '/me/mickeys/:id/hint',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        const body = parseOrAppError(mickeyHintBodySchema, request.body);
        const detail = await options.huntService.recordHint(userId, id, body.level);
        reply.code(200).send(detail);
      },
    );

    // POST /me/mickeys/:id/find (R4.1 - R4.4)
    app.post<{ Params: { id: string } }>(
      '/me/mickeys/:id/find',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        const body = parseOrAppError(mickeyFindBodySchema, request.body);
        const progress = await options.huntService.recordFind(userId, id, body.tripId);
        reply.code(200).send(progress);
      },
    );

    // DELETE /me/mickeys/:id/find (R4.5, R4.6)
    app.delete<{ Params: { id: string } }>(
      '/me/mickeys/:id/find',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        parseOrAppError(emptyBodySchema, request.body);
        await options.huntService.undoFind(userId, id);
        reply.code(204).send();
      },
    );

    // PUT /me/mickeys/:id/vote (R5.1 - R5.6)
    app.put<{ Params: { id: string } }>(
      '/me/mickeys/:id/vote',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        const body = parseOrAppError(mickeyVoteBodySchema, request.body);
        await options.huntService.recordVote(userId, id, body.vote);
        reply.code(204).send();
      },
    );

    // POST /mickeys/:id/report (R7.1 - R7.7)
    app.post<{ Params: { id: string } }>(
      '/mickeys/:id/report',
      { preHandler: options.requireSession },
      async (request, reply) => {
        assertMickeysEnabled(options.config);
        const userId = requireUser(request);
        const { id } = parseOrAppError(idParamSchema, request.params);
        const body = parseOrAppError(mickeyReportBodySchema, request.body);
        if (!options.reportService) {
          throw new AppError('internal_error', 'Report service not configured.');
        }
        await options.reportService.reportMickey(userId, id, body);
        reply.code(204).send();
      },
    );
  };
}
