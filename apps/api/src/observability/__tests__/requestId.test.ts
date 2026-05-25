/**
 * Unit tests for the observability surface (task 13.4):
 *
 *   - `createDomainEventLogger` produces the canonical
 *     `(request_id, user_id, action, target_id, outcome)` shape and
 *     never leaks fields beyond it.
 *   - `registerLatencyMetrics` emits one structured `request_latency`
 *     line per response carrying `request_id`, `method`, `route`,
 *     `status_code`, and a numeric `duration_ms`.
 *   - The module re-exports `genRequestId` / `registerRequestId` from
 *     the existing `plugins/requestId.ts` so observability has a
 *     single entry point.
 */

import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_EVENT_TYPE,
  REQUEST_LATENCY_EVENT_TYPE,
  REQUEST_ID_HEADER,
  createDomainEventLogger,
  genRequestId,
  registerLatencyMetrics,
  registerRequestId,
} from '../requestId.js';
import { createLogger, loggerOptions } from '../../logger.js';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Small in-memory pino sink so we can assert on the JSON the logger
 * actually emits (matching the pattern used by `logger.test.ts`).
 */
function captureLogs(): {
  lines: Array<Record<string, unknown>>;
  stream: Writable;
} {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, cb): void {
      const text = String(chunk).trim();
      if (text.length > 0) {
        for (const part of text.split('\n')) {
          if (part.length > 0) {
            lines.push(JSON.parse(part) as Record<string, unknown>);
          }
        }
      }
      cb();
    },
  });
  return { lines, stream };
}

describe('observability surface re-exports', () => {
  it('exposes genRequestId and registerRequestId from plugins/requestId', () => {
    expect(typeof genRequestId).toBe('function');
    expect(typeof registerRequestId).toBe('function');
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
    expect(genRequestId()).toMatch(UUID_V4_RE);
  });
});

describe('createDomainEventLogger', () => {
  it('emits the canonical (request_id, user_id, action, target_id, outcome) shape', () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: 'info' }, stream);
    const emitter = createDomainEventLogger(log);

    emitter.emit({
      request_id: '11111111-2222-4333-8444-555555555555',
      user_id: 'user-abc',
      action: 'rating.set',
      target_id: 'experience-xyz',
      outcome: 'success',
    });

    expect(lines).toHaveLength(1);
    const entry = lines[0]!;
    expect(entry['event_type']).toBe(DOMAIN_EVENT_TYPE);
    expect(entry['request_id']).toBe('11111111-2222-4333-8444-555555555555');
    expect(entry['user_id']).toBe('user-abc');
    expect(entry['action']).toBe('rating.set');
    expect(entry['target_id']).toBe('experience-xyz');
    expect(entry['outcome']).toBe('success');
    expect(entry['msg']).toBe('domain_event');
  });

  it('preserves null user_id and target_id (anonymous/no-target mutations)', () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: 'info' }, stream);
    const emitter = createDomainEventLogger(log);

    emitter.emit({
      request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      user_id: null,
      action: 'auth.register',
      target_id: null,
      outcome: 'failure',
    });

    const entry = lines[0]!;
    expect(entry['user_id']).toBeNull();
    expect(entry['target_id']).toBeNull();
    expect(entry['outcome']).toBe('failure');
  });

  it('drops fields outside the canonical shape', () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: 'info' }, stream);
    const emitter = createDomainEventLogger(log);

    // Caller smuggles an extra field via a structural cast. The
    // emitter must not propagate it: dashboards group on the
    // canonical shape and unsanctioned fields would let the schema
    // drift over time.
    emitter.emit({
      request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      user_id: 'user-1',
      action: 'rating.set',
      target_id: 'exp-1',
      outcome: 'success',
      // @ts-expect-error — verifying the runtime drops unknown fields
      extra: 'should-not-appear',
      password: 'leaked-secret',
    });

    const entry = lines[0]!;
    expect(entry['extra']).toBeUndefined();
    expect(entry['password']).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('leaked-secret');
  });

  it('emits at info level so it survives default log filtering', () => {
    const { lines, stream } = captureLogs();
    const log = createLogger({ ...loggerOptions, level: 'info' }, stream);
    const emitter = createDomainEventLogger(log);

    emitter.emit({
      request_id: '11111111-2222-4333-8444-555555555555',
      user_id: 'user-1',
      action: 'completion.mark',
      target_id: 'exp-1',
      outcome: 'success',
    });

    // pino's level for `info` is 30.
    expect(lines[0]!['level']).toBe(30);
  });
});

describe('registerLatencyMetrics', () => {
  it('emits one request_latency line per response with duration_ms and request_id', async () => {
    const { lines, stream } = captureLogs();
    const app = Fastify({
      logger: { ...loggerOptions, level: 'info', stream },
      genReqId: genRequestId,
    });
    await registerRequestId(app);
    await registerLatencyMetrics(app);

    app.get('/ping', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/ping' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const requestId = res.headers[REQUEST_ID_HEADER];
    expect(typeof requestId).toBe('string');

    const latencyLines = lines.filter(
      (line) => line['event_type'] === REQUEST_LATENCY_EVENT_TYPE,
    );
    expect(latencyLines).toHaveLength(1);

    const entry = latencyLines[0]!;
    expect(entry['request_id']).toBe(requestId);
    expect(entry['method']).toBe('GET');
    expect(entry['route']).toBe('/ping');
    expect(entry['status_code']).toBe(200);
    expect(typeof entry['duration_ms']).toBe('number');
    expect(entry['duration_ms']).toBeGreaterThanOrEqual(0);
    expect(entry['msg']).toBe('request_completed');
  });

  it('uses the parameterized route template, not the concrete URL', async () => {
    const { lines, stream } = captureLogs();
    const app = Fastify({
      logger: { ...loggerOptions, level: 'info', stream },
      genReqId: genRequestId,
    });
    await registerRequestId(app);
    await registerLatencyMetrics(app);

    app.get('/users/:id', async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/users/abc-123' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const latencyLines = lines.filter(
      (line) => line['event_type'] === REQUEST_LATENCY_EVENT_TYPE,
    );
    expect(latencyLines).toHaveLength(1);
    expect(latencyLines[0]!['route']).toBe('/users/:id');
  });

  it('emits a latency line for non-2xx responses too', async () => {
    const { lines, stream } = captureLogs();
    const app = Fastify({
      logger: { ...loggerOptions, level: 'info', stream },
      genReqId: genRequestId,
    });
    await registerRequestId(app);
    await registerLatencyMetrics(app);

    // No route registered → 404. The latency hook must still fire so
    // dashboards see error-path response times.
    const res = await app.inject({ method: 'GET', url: '/nope' });
    await app.close();

    expect(res.statusCode).toBe(404);
    const latencyLines = lines.filter(
      (line) => line['event_type'] === REQUEST_LATENCY_EVENT_TYPE,
    );
    expect(latencyLines).toHaveLength(1);
    expect(latencyLines[0]!['status_code']).toBe(404);
    expect(typeof latencyLines[0]!['duration_ms']).toBe('number');
  });
});
