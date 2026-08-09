import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { intelligenceRoutes } from '../routes.js';
import type { SamplingService } from '../samplingService.js';
import type { PredictionService } from '../predictionService.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { AppError } from '../../../errors/AppError.js';

describe('Intelligence Routes', () => {
  const fakeSamplingService: SamplingService = {
    runSamplingPass: vi.fn().mockResolvedValue(undefined),
  };

  const fakePredictionService: PredictionService = {
    getDaySnapshot: vi.fn(),
    getCrowdMultiplier: vi.fn(),
    getCrowdCalendarDay: vi.fn().mockResolvedValue({}),
    getRawForecast: vi.fn(),
    getWaitInsights: vi.fn().mockResolvedValue({}),
  };

  function buildTestApp() {
    const app = Fastify();
    app.decorate('config', { intelligence: { samplingCronSecret: 'secret123' } } as any);
    
    registerErrorHandler(app);

    const requireSession = async (req: any) => {
      if (!req.headers.authorization) {
        throw new AppError('unauthorized', 'Missing session');
      }
    };

    void app.register(intelligenceRoutes({
      samplingService: fakeSamplingService,
      predictionService: fakePredictionService,
      requireSession,
    }));

    return app;
  }

  it('POST /internal/sampling/run - 401 on missing secret', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sampling/run',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /internal/sampling/run - 401 on wrong secret', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sampling/run',
      headers: { 'x-cron-secret': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /internal/sampling/run - 202 and runs async', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/sampling/run',
      headers: { 'x-cron-secret': 'secret123' },
    });
    
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(fakeSamplingService.runSamplingPass).toHaveBeenCalled();
  });

  it('HEAD /internal/sampling/run - 401 on missing secret', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'HEAD',
      url: '/internal/sampling/run',
    });
    expect(res.statusCode).toBe(401);
  });

  it('HEAD /internal/sampling/run - 202 with empty body and runs async', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'HEAD',
      url: '/internal/sampling/run',
      headers: { 'x-cron-secret': 'secret123' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toBe(''); // HEAD carries no body — cannot be "too large"
    expect(fakeSamplingService.runSamplingPass).toHaveBeenCalled();
  });

  it('GET /crowd-calendar - 401 without session', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/crowd-calendar?park=Magic%20Kingdom&from=2024-01-01&to=2024-01-02',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /crowd-calendar - calls service and returns days', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/crowd-calendar?park=Magic%20Kingdom&from=2024-01-01&to=2024-01-02',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(2);
    expect(fakePredictionService.getCrowdCalendarDay).toHaveBeenCalledTimes(2);
  });

  it('GET /crowd-calendar - defaults to Magic Kingdom when park parameter is omitted', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/crowd-calendar?from=2024-01-01&to=2024-01-01',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.statusCode).toBe(200);
    expect(fakePredictionService.getCrowdCalendarDay).toHaveBeenCalledWith('Magic Kingdom', expect.any(Date));
  });

  it('GET /experiences/:id/wait-insights - 401 without session', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/experiences/11111111-1111-4111-8111-111111111111/wait-insights',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /experiences/:id/wait-insights - calls service', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/experiences/11111111-1111-4111-8111-111111111111/wait-insights',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.statusCode).toBe(200);
    expect(fakePredictionService.getWaitInsights).toHaveBeenCalled();
  });
});
