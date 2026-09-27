import type { FastifyInstance, FastifyPluginAsync, onRequestHookHandler } from 'fastify';
import { ZodError, z } from 'zod';
import { isoDateSchema, parkSchema, uuidSchema } from '@dwt/shared';
import type { SamplingService } from './samplingService.js';
import type { PredictionService } from './predictionService.js';
import type { WeatherClient } from './weatherClient.js';
import { AppError } from '../../errors/AppError.js';

export interface IntelligenceRoutesOptions {
  samplingService: SamplingService;
  predictionService: PredictionService;
  weatherClient: WeatherClient;
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

/**
 * Concurrency cap for `GET /crowd-calendar`'s per-day fan-out below the shared
 * DB pool's `max: 10` (`db/pool.ts`), so one calendar request cannot occupy
 * every pooled connection and starve other concurrent requests on this
 * single-process API.
 */
const CROWD_CALENDAR_CONCURRENCY = 6;

/**
 * Maps `items` through the async `fn`, running at most `limit` invocations
 * concurrently, and returns results in the same order as `items` regardless of
 * completion order. A minimal worker-pool implementation — no new dependency
 * — since bounded concurrency (not full sequential, not unbounded
 * `Promise.all`) is all `GET /crowd-calendar` needs.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
      const dates: Date[] = [];
      const current = new Date(fromDate);
      while (current <= toDate) {
        dates.push(new Date(current));
        current.setUTCDate(current.getUTCDate() + 1);
      }

      // Each day's `getCrowdCalendarDay` was previously awaited one at a time —
      // for the mobile Crowd_Calendar's ~70-day query window that meant up to 70
      // sequential round trips of DB work, which is what made the screen slow
      // to load. The days are independent (each computes its own park+date
      // forecast/signals), so they are fetched with bounded concurrency instead
      // of full sequential `await`. Bounded — not `Promise.all` over the whole
      // range — so a 90-day request doesn't fire more concurrent DB work than
      // the process's connection pool (`db/pool.ts`, `max: 10`) can actually use
      // at once; excess would just queue at the pool level anyway, but bounding
      // it explicitly keeps a single request from monopolizing the shared pool.
      const days = await mapWithConcurrency(dates, CROWD_CALENDAR_CONCURRENCY, (date) =>
        options.predictionService.getCrowdCalendarDay(selectedPark, date),
      );

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

    app.get('/weather/current', { preHandler: [options.requireSession] }, async () => {
      const weather = await options.weatherClient.getWDWWeather();
      return {
        current: weather.current
          ? { tempF: weather.current.temp_f, condition: weather.current.condition }
          : null,
      };
    });
  };
}
