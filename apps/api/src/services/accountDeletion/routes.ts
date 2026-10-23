/**
 * Account-deletion and public privacy HTTP routes (design, "Routes"):
 *
 *   POST /me/account/deletion/reauth             session + rate limit  -> a short-lived, single-use grant
 *   POST /me/account/deletion                    session               -> schedule the deletion
 *   GET  /account-deletion                       public HTML           -> self-service web deletion form
 *   POST /account-deletion                       public HTML + limit   -> verify password & schedule deletion
 *   GET  /privacy                                public HTML           -> public privacy policy page
 *   POST /internal/account-deletion/purge/run    x-cron-secret         -> 202, work runs in-process
 *   HEAD /internal/account-deletion/purge/run    x-cron-secret         -> 202, empty body
 *
 * Authentication: the two `/me` routes sit behind the session pre-handler; the two `/internal` routes sit
 * behind the shared cron secret; `/account-deletion` and `/privacy` are public web pages required by store
 * data-safety policy, with `POST /account-deletion` gated by `loginRateLimitConfig()` and password + lockout
 * verification in the service.
 *
 * Nothing here records or echoes a password, a grant or the confirmation phrase: the bodies are handed to the
 * service and never written anywhere. A wrong password answers `403 reauth_failed`, never `401`, because the
 * mobile client signs the user out on any `401`.
 *
 * This file imports nothing from another service folder (a structural test scans its import lines).
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 2.11, 3.4, 3.9, 8.1, 8.2, 17.3,
 *            19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 20.1, 20.2, 20.3
 */
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { z, ZodError } from 'zod';

import {
  deleteAccountRequestSchema,
  reauthRequestSchema,
  type DeleteAccountResponse,
  type ReauthResponse,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import { loginRateLimitConfig, reauthRateLimitConfig } from '../../plugins/rateLimit.js';
import { secretMatches } from './cronGate.js';
import type { AccountDeletionService } from './ports.js';
import type { PurgeRunner } from './purgeRunner.js';
import {
  renderPrivacyPolicyHtml,
  renderWebAccountDeletionFormHtml,
  renderWebAccountDeletionSuccessHtml,
  validateWebDeletionInput,
} from './webPages.js';

export const REAUTH_PATH = '/me/account/deletion/reauth';
export const DELETION_PATH = '/me/account/deletion';
export const PURGE_RUN_PATH = '/internal/account-deletion/purge/run';
export const WEB_DELETION_PATH = '/account-deletion';
export const PRIVACY_PATH = '/privacy';

export interface AccountDeletionRoutesOptions {
  readonly service: AccountDeletionService;
  readonly purgeRunner: PurgeRunner;
  readonly requireSession: preHandlerHookHandler;
  readonly now?: () => Date;
}

/**
 * The wire contract is the shared schema; the grant is additionally held to the shape `generateGrant` produces
 * (base64url, 20..128 characters) so a malformed value is a `validation_failed` before it reaches the repo.
 * `.extend` keeps the schema strict.
 */
const deletionBodySchema = deleteAccountRequestSchema.extend({
  reauthGrant: z
    .string()
    .min(20)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

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

/** The caller's user id and session id; either missing means the request never went through the middleware. */
function requireSessionIds(request: FastifyRequest): { userId: string; sessionId: string } {
  const { userId, sessionId } = request;
  if (typeof userId !== 'string' || userId.length === 0 || typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return { userId, sessionId };
}

function extractSubmittedEmail(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const raw = (body as Record<string, unknown>).email;
    if (typeof raw === 'string') return raw.trim();
  }
  return '';
}

function setWebPageSecurityHeaders(reply: FastifyReply, noStore: boolean): FastifyReply {
  reply
    .header('x-frame-options', 'DENY')
    .header('content-security-policy', "frame-ancestors 'none'");
  if (noStore) {
    reply.header('cache-control', 'no-store');
  }
  return reply;
}

function sendWebDeletionError(
  reply: FastifyReply,
  statusCode: number,
  graceDays: number,
  email: string,
  errorMessage: string,
): FastifyReply {
  return setWebPageSecurityHeaders(reply, true)
    .type('text/html; charset=utf-8')
    .code(statusCode)
    .send(
      renderWebAccountDeletionFormHtml({
        graceDays,
        email,
        errorMessage,
      }),
    );
}

export function accountDeletionRoutes(options: AccountDeletionRoutesOptions): FastifyPluginAsync {
  const { service, purgeRunner, requireSession } = options;

  return async function accountDeletionRoutesPlugin(app: FastifyInstance): Promise<void> {
    if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
      app.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_req, body, done) => {
          try {
            const bodyStr = typeof body === 'string' ? body : (body as Buffer).toString('utf-8');
            const parsed = Object.fromEntries(new URLSearchParams(bodyStr));
            done(null, parsed);
          } catch (err: unknown) {
            done(err as Error, undefined);
          }
        },
      );
    }

    // -----------------------------------------------------------------------------------------------
    // Step 1: re-authenticate. Budget and bucket: the login budget keyed on the hashed bearer token.
    // -----------------------------------------------------------------------------------------------
    app.post(
      REAUTH_PATH,
      { preHandler: requireSession, config: { rateLimit: reauthRateLimitConfig() } },
      async (request): Promise<ReauthResponse> => {
        const { userId, sessionId } = requireSessionIds(request);
        const body = parseBody(reauthRequestSchema, request.body);
        const result = await service.reauth(userId, sessionId, body.password);
        return {
          reauthGrant: result.reauthGrant,
          expiresAt: result.expiresAt.toISOString(),
          graceDays: result.graceDays,
        };
      },
    );

    // -----------------------------------------------------------------------------------------------
    // Step 2: confirm. The service checks the phrase before the grant is touched.
    // -----------------------------------------------------------------------------------------------
    app.post(DELETION_PATH, { preHandler: requireSession }, async (request): Promise<DeleteAccountResponse> => {
      const { userId, sessionId } = requireSessionIds(request);
      const body = parseBody(deletionBodySchema, request.body);
      const result = await service.requestDeletion(userId, sessionId, body.reauthGrant, body.confirmation);
      return {
        status: result.status,
        scheduledPurgeAt: result.scheduledPurgeAt.toISOString(),
        graceDays: result.graceDays,
      };
    });

    // -----------------------------------------------------------------------------------------------
    // Public web self-service account deletion form and submission (Requirements 19.1-19.11).
    // -----------------------------------------------------------------------------------------------
    app.get(WEB_DELETION_PATH, async (_request, reply) => {
      return setWebPageSecurityHeaders(reply, true)
        .type('text/html; charset=utf-8')
        .code(200)
        .send(renderWebAccountDeletionFormHtml({ graceDays: service.getGraceDays() }));
    });

    app.post(
      WEB_DELETION_PATH,
      {
        config: { rateLimit: loginRateLimitConfig() },
        errorHandler: (error, request, reply) => {
          const email = extractSubmittedEmail(request.body);
          const graceDays = service.getGraceDays();
          if (error instanceof AppError) {
            if (error.code === 'rate_limit_exceeded') {
              sendWebDeletionError(reply, 429, graceDays, email, error.message);
              return;
            }
            if (error.code === 'account_deletion_confirmation_invalid') {
              sendWebDeletionError(reply, 400, graceDays, email, error.message);
              return;
            }
            if (error.code === 'reauth_failed') {
              sendWebDeletionError(reply, 403, graceDays, email, 'Invalid email or password.');
              return;
            }
            if (error.code === 'account_locked') {
              sendWebDeletionError(
                reply,
                423,
                graceDays,
                email,
                'Your account is temporarily locked due to too many failed attempts. Please try again later.',
              );
              return;
            }
          }
          reply.send(error);
        },
      },
      async (request, reply) => {
        const graceDays = service.getGraceDays();
        const parsed = validateWebDeletionInput(request.body);
        if (!parsed.ok) {
          return sendWebDeletionError(reply, 400, graceDays, parsed.email, parsed.message);
        }

        const result = await service.requestDeletionByPassword(
          parsed.email,
          parsed.password,
          parsed.confirmation,
        );
        return setWebPageSecurityHeaders(reply, true)
          .type('text/html; charset=utf-8')
          .code(200)
          .send(
            renderWebAccountDeletionSuccessHtml({
              scheduledPurgeAt: result.scheduledPurgeAt,
              graceDays: result.graceDays,
            }),
          );
      },
    );

    // -----------------------------------------------------------------------------------------------
    // Public privacy policy web page (Requirements 20.1-20.3).
    // -----------------------------------------------------------------------------------------------
    app.get(PRIVACY_PATH, async (_request, reply) => {
      return setWebPageSecurityHeaders(reply, false)
        .type('text/html; charset=utf-8')
        .code(200)
        .send(
          renderPrivacyPolicyHtml({
            graceDays: service.getGraceDays(),
            // Validated at boot (config.ts SUPPORT_EMAIL); read per request like the cron secret below.
            supportEmail: app.config.support.email,
          }),
        );
    });

    // -----------------------------------------------------------------------------------------------
    // Purge cron: gated by the dedicated secret. The secret is read from the app config on each call, as
    // the other cron routes do, so there is one source of truth.
    // -----------------------------------------------------------------------------------------------
    const gateCronSecret = (request: FastifyRequest): void => {
      const expected = app.config?.accountDeletion?.cronSecret ?? '';
      if (!secretMatches(request.headers['x-cron-secret'], expected)) {
        throw new AppError('unauthorized', 'Missing or invalid cron secret');
      }
    };

    app.post(PURGE_RUN_PATH, async (request, reply) => {
      gateCronSecret(request);
      const started = purgeRunner.tryStart();
      return reply
        .code(202)
        .send(started.started ? { status: 'accepted' } : { status: 'skipped', reason: started.reason });
    });

    app.head(PURGE_RUN_PATH, async (request, reply) => {
      gateCronSecret(request);
      purgeRunner.tryStart();
      return reply.code(202).send();
    });
  };
}
