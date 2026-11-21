/**
 * Fastify plugin for first-run onboarding endpoints:
 *   - GET  /me/onboarding
 *   - PATCH /me/onboarding
 *   - POST /me/onboarding/quick-completions
 */

import {
  onboardingPatchSchema,
  quickCompletionsInputSchema,
  type OnboardingStateDTO,
  type QuickCompletionsResponseDTO,
} from '@dwt/shared';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import type { OnboardingService } from './service.js';

export interface OnboardingRoutesOptions {
  readonly service: OnboardingService;
  readonly requireSession: preHandlerHookHandler;
}

function requireUserId(request: FastifyRequest): string {
  const userId = (request as { userId?: string }).userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  try {
    return schema.parse(body) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
      throw field !== undefined
        ? new AppError('validation_failed', message, { field })
        : new AppError('validation_failed', message);
    }
    throw err;
  }
}

export function onboardingRoutes(
  options: OnboardingRoutesOptions,
): FastifyPluginAsync {
  const { service, requireSession } = options;

  return async function onboardingRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.get(
      '/me/onboarding',
      { preHandler: requireSession },
      async (request): Promise<OnboardingStateDTO> => {
        const userId = requireUserId(request);
        return service.getOnboardingState(userId);
      },
    );

    app.patch(
      '/me/onboarding',
      { preHandler: requireSession },
      async (request): Promise<OnboardingStateDTO> => {
        const userId = requireUserId(request);
        const body = parseBody(onboardingPatchSchema, request.body);
        return service.patchOnboardingState(userId, body);
      },
    );

    app.post(
      '/me/onboarding/quick-completions',
      { preHandler: requireSession },
      async (request): Promise<QuickCompletionsResponseDTO> => {
        const userId = requireUserId(request);
        const body = parseBody(quickCompletionsInputSchema, request.body);
        return service.submitQuickCompletions(userId, body);
      },
    );
  };
}
