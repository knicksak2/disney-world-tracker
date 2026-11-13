/**
 * Fastify routes of the Dining Plan calculator (dining-plan-calculator Requirements 16.1 to 16.8, 23.2, 23.3, 26.1,
 * 26.2; design.md "Request flows" and "Error Handling").
 *
 * - GET    /trips/:id/dining-plan                               (view_dining_plan) -> DiningPlanDTO
 * - PUT    /trips/:id/dining-plan/settings                      (edit_dining_plan) -> DiningPlanDTO
 * - PUT    /trips/:id/dining-plan/entries/:date/:mealPeriod     (edit_dining_plan) -> DiningPlanDTO
 * - DELETE /trips/:id/dining-plan/entries/:date/:mealPeriod     (edit_dining_plan) -> DiningPlanDTO
 * - POST   /trips/:id/dining-plan/import-reservations           (edit_dining_plan) -> DiningPlanImportResultDTO
 * - POST   /trips/:id/dining-plan/export-to-budget              (edit_dining_plan and edit_budget, in the service)
 * - POST   /dining-plan/calculate                               (session only) -> DiningPlanResultDTO
 *
 * The Trip routes authorize before reading the body, so a non-member and an unknown Trip always get the same
 * `trip_forbidden`; invalid params and bodies answer `trip_validation_failed` naming the field. The stateless route
 * answers `validation_failed`. The export authorizes in the service (it checks two actions); its body is parsed first.
 */

import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';

import {
  DINING_MEAL_PERIODS,
  diningBudgetExportBodySchema,
  diningCalculateBodySchema,
  diningPlanEntryBodySchema,
  diningPlanImportBodySchema,
  diningPlanSettingsSchema,
  tripCalendarDateSchema,
  uuidSchema,
  type DiningBudgetExportResultDTO,
  type DiningPlanDTO,
  type DiningPlanImportResultDTO,
  type DiningPlanResultDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { parseOrAppError } from '../tripExpenses/routes.js';
import { requireDiningPlanAction } from './authz.js';
import type { DiningPlanService } from './service.js';

const tripParamsSchema = z.object({ id: uuidSchema }).strict();
const entryParamsSchema = z
  .object({ id: uuidSchema, date: tripCalendarDateSchema, mealPeriod: z.enum(DINING_MEAL_PERIODS) })
  .strict();

export interface DiningPlanRoutesOptions {
  readonly pool: DbPool;
  readonly service: DiningPlanService;
  readonly requireSession: preHandlerHookHandler;
}

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

/** The stateless route's validation: `validation_failed` naming the first invalid field (Requirement 16.4). */
function parseStateless<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    const issue = err.issues[0];
    const field = issue !== undefined && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
    const message = `Invalid value${field === undefined ? '' : ` for "${field}"`}.`;
    throw new AppError('validation_failed', message, field === undefined ? {} : { field });
  }
}

export function diningPlanRoutes(options: DiningPlanRoutesOptions): FastifyPluginAsync {
  const { pool, service, requireSession } = options;

  return async (fastify) => {
    fastify.get('/trips/:id/dining-plan', { preHandler: [requireSession] }, async (request): Promise<DiningPlanDTO> => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(tripParamsSchema, request.params);
      await requireDiningPlanAction(pool, userId, id, 'view_dining_plan');
      return service.getPlan(id);
    });

    fastify.put('/trips/:id/dining-plan/settings', { preHandler: [requireSession] }, async (request): Promise<DiningPlanDTO> => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(tripParamsSchema, request.params);
      await requireDiningPlanAction(pool, userId, id, 'edit_dining_plan');
      const settings = parseOrAppError(diningPlanSettingsSchema, request.body);
      return service.putSettings(id, settings);
    });

    fastify.put(
      '/trips/:id/dining-plan/entries/:date/:mealPeriod',
      { preHandler: [requireSession] },
      async (request): Promise<DiningPlanDTO> => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripParamsSchema, { id: (request.params as { id?: unknown }).id });
        await requireDiningPlanAction(pool, userId, id, 'edit_dining_plan');
        const { date, mealPeriod } = parseOrAppError(entryParamsSchema, request.params);
        const body = parseOrAppError(diningPlanEntryBodySchema, request.body);
        return service.putEntry(id, date, mealPeriod, body);
      },
    );

    fastify.delete(
      '/trips/:id/dining-plan/entries/:date/:mealPeriod',
      { preHandler: [requireSession] },
      async (request): Promise<DiningPlanDTO> => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripParamsSchema, { id: (request.params as { id?: unknown }).id });
        await requireDiningPlanAction(pool, userId, id, 'edit_dining_plan');
        const { date, mealPeriod } = parseOrAppError(entryParamsSchema, request.params);
        return service.deleteEntry(id, date, mealPeriod);
      },
    );

    fastify.post(
      '/trips/:id/dining-plan/import-reservations',
      { preHandler: [requireSession] },
      async (request): Promise<DiningPlanImportResultDTO> => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripParamsSchema, request.params);
        await requireDiningPlanAction(pool, userId, id, 'edit_dining_plan');
        const body = parseOrAppError(diningPlanImportBodySchema, request.body ?? {});
        return service.importReservations(id, body);
      },
    );

    fastify.post(
      '/trips/:id/dining-plan/export-to-budget',
      { preHandler: [requireSession] },
      async (request): Promise<DiningBudgetExportResultDTO> => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(tripParamsSchema, request.params);
        const body = parseOrAppError(diningBudgetExportBodySchema, request.body ?? {});
        return service.exportToBudget(id, userId, body);
      },
    );

    fastify.post('/dining-plan/calculate', { preHandler: [requireSession] }, async (request): Promise<DiningPlanResultDTO> => {
      requireUser(request);
      const body = parseStateless(diningCalculateBodySchema, request.body);
      return service.calculateStateless(body);
    });
  };
}
