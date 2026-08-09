import type { FastifyInstance, FastifyPluginAsync, onRequestHookHandler } from 'fastify';
import { ZodError, z } from 'zod';
import { isoDateSchema, parkSchema, uuidSchema } from '@dwt/shared';
import type { SamplingService } from './samplingService.js';
import type { PredictionService } from './predictionService.js';
import { AppError } from '../../errors/AppError.js';

export interface IntelligenceRoutesOptions {
  samplingService: SamplingService;
  predictionService: PredictionService;
  requireSession: onRequestHookHandler;
}

const calendarQuerySchema = z.object({
  park: parkSchema.optional(),
  from: isoDateSchema,
  to: isoDateSchema,
});

const experienceParamsSchema = z.object({
  id: uuidSchema,
});

const waitInsightsQuerySchema = z.object({
  date: isoDateSchema.optional(),
});

function parseOrAppError<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      throw new AppError('validation_failed', issue?.message ?? 'Invalid request', field ? { field } : undefined);
    }
    throw err;
  }
}

export function intelligenceRoutes(options: IntelligenceRoutesOptions): FastifyPluginAsync {
  return async function (app: FastifyInstance): Promise<void> {
    
    // Shared cron-secret gate for the sampling trigger.
    const assertCronSecret = (request: { headers: Record<string, unknown> }): void => {
      const authHeader = request.headers['x-cron-secret'];
      const expectedSecret = app.config.intelligence.samplingCronSecret;
      if (!authHeader || authHeader !== expectedSecret) {
        throw new AppError('unauthorized', 'Missing or invalid cron secret');
      }
    };

    // Fire-and-forget the pass; errors are logged, never surfaced to the caller.
    const kickOffSamplingPass = (): void => {
      options.samplingService.runSamplingPass().catch(err => {
        app.log.error({ err }, 'Sampling pass failed');
      });
    };

    // POST returns a tiny JSON ack.
    app.post('/internal/sampling/run', async (request, reply) => {
      assertCronSecret(request);
      void reply.code(202).send({ status: 'accepted' });
      kickOffSamplingPass();
      return reply;
    });

    // HEAD does the same but replies with headers only (no body) — the keep-alive
    // cron can use HEAD so the response can never be "too large". Same secret gate.
    app.head('/internal/sampling/run', async (request, reply) => {
      assertCronSecret(request);
      void reply.code(202).send();
      kickOffSamplingPass();
      return reply;
    });

    app.get('/crowd-calendar', { preHandler: [options.requireSession] }, async (request) => {
      const query = parseOrAppError(calendarQuerySchema, request.query);
      
      const fromDate = new Date(`${query.from}T00:00:00Z`);
      const toDate = new Date(`${query.to}T00:00:00Z`);
      
      if (fromDate > toDate) {
        throw new AppError('validation_failed', 'from date must be before or equal to to date', { field: 'from' });
      }
      
      // Cap at 90 days to prevent abuse
      const daysDiff = (toDate.getTime() - fromDate.getTime()) / 86400000;
      if (daysDiff > 90) {
        throw new AppError('validation_failed', 'Date range too large', { field: 'to' });
      }

      const selectedPark = query.park ?? 'Magic Kingdom';
      const days = [];
      const current = new Date(fromDate);
      while (current <= toDate) {
        const day = await options.predictionService.getCrowdCalendarDay(selectedPark, new Date(current));
        days.push(day);
        current.setUTCDate(current.getUTCDate() + 1);
      }
      
      return { days };
    });

    app.get('/experiences/:id/wait-insights', { preHandler: [options.requireSession] }, async (request, reply) => {
      const params = parseOrAppError(experienceParamsSchema, request.params);
      const query = parseOrAppError(waitInsightsQuerySchema, request.query);
      
      // Default to today if no date provided
      let targetDate = new Date();
      if (query.date) {
        targetDate = new Date(`${query.date}T12:00:00-04:00`);
      }
      
      const insights = await options.predictionService.getWaitInsights(params.id, targetDate);
      if (!insights) {
        reply.callNotFound();
        return reply;
      }
      
      return insights;
    });
  };
}
