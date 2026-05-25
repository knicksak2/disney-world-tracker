/**
 * Unit tests for the global error handler and `AppError` class.
 *
 * The handler is exercised through Fastify's `inject` helper so that the
 * full request-reply lifecycle (status code, body parsing, log emission)
 * runs under test. A throw-only route is registered for each scenario:
 * domain `AppError`, schema validation failure, and unhandled exception.
 */

import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

import { errorCodeToHttpStatus } from '@dwt/shared';

import { AppError } from '../AppError.js';
import { registerErrorHandler } from '../handler.js';

function buildTestServer() {
  // `disableRequestLogging` keeps test output quiet; the error hook still
  // emits its own log lines via `request.log`, which we inspect via spies
  // when needed.
  const server = Fastify({ logger: false });
  registerErrorHandler(server);
  return server;
}

describe('AppError', () => {
  it('sets code, message, field, and details when provided', () => {
    const err = new AppError('rating_out_of_range', 'must be 1..10', {
      field: 'value',
      details: { received: 11 },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('rating_out_of_range');
    expect(err.message).toBe('must be 1..10');
    expect(err.field).toBe('value');
    expect(err.details).toEqual({ received: 11 });
  });

  it('omits field and details when not provided', () => {
    const err = new AppError('unauthorized', 'no session');
    expect(err.field).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('preserves cause for log context without exposing it', () => {
    const underlying = new Error('db constraint x');
    const err = new AppError('email_in_use', 'email already registered', {
      cause: underlying,
    });
    // Node's Error supports the `cause` property directly.
    expect((err as Error & { cause?: unknown }).cause).toBe(underlying);
  });
});

describe('registerErrorHandler — AppError mapping', () => {
  it.each([
    ['email_in_use', 409],
    ['validation_failed', 400],
    ['invalid_credentials', 401],
    ['account_locked', 423],
    ['unauthorized', 401],
    ['catalog_unavailable', 503],
    ['completion_future_date', 400],
    ['completion_not_found', 404],
    ['rating_out_of_range', 400],
    ['rating_not_found', 404],
    ['note_length_invalid', 400],
    ['note_not_found', 404],
    ['display_name_invalid', 400],
    ['avatar_invalid', 400],
    ['profile_forbidden', 403],
    ['friend_self_target', 400],
    ['friend_duplicate_relationship', 409],
    ['friend_recipient_unknown', 400],
    ['friendship_not_found', 404],
    ['share_recipient_count_invalid', 400],
    ['share_atomic_rejected', 403],
  ] as const)('maps AppError(%s) to HTTP %i with envelope', async (code, status) => {
    const server = buildTestServer();
    server.get('/boom', () => {
      throw new AppError(code, `failed: ${code}`);
    });

    const res = await server.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(status);
    expect(res.statusCode).toBe(errorCodeToHttpStatus[code]);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code, message: `failed: ${code}` } });
  });

  it('forwards optional field and details into the envelope', async () => {
    const server = buildTestServer();
    server.get('/boom', () => {
      throw new AppError('validation_failed', 'bad email', {
        field: 'email',
        details: { received: 'not-an-email' },
      });
    });

    const res = await server.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'validation_failed',
        message: 'bad email',
        field: 'email',
        details: { received: 'not-an-email' },
      },
    });
  });

  it('omits field and details from the envelope when not set', async () => {
    const server = buildTestServer();
    server.get('/boom', () => {
      throw new AppError('unauthorized', 'no session');
    });

    const res = await server.inject({ method: 'GET', url: '/boom' });

    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({
      error: { code: 'unauthorized', message: 'no session' },
    });
    expect((body['error'] as Record<string, unknown>)['field']).toBeUndefined();
    expect((body['error'] as Record<string, unknown>)['details']).toBeUndefined();
  });
});

describe('registerErrorHandler — unhandled exceptions', () => {
  it('returns internal_error 500 with a generic message and logs the error', async () => {
    const server = buildTestServer();
    const errorSpy = vi.fn();
    // Replace the request logger so we can assert an `error`-level log fires.
    server.addHook('onRequest', async (request) => {
      request.log = {
        ...request.log,
        error: errorSpy,
        info: vi.fn(),
      } as typeof request.log;
    });
    server.get('/boom', () => {
      throw new Error('database constraint users_email_key violated');
    });

    const res = await server.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    // The original message must NOT leak to the client.
    expect(body.error.message).not.toContain('users_email_key');
    expect(body.error.message).toBe('An internal error occurred.');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('registerErrorHandler — Fastify schema validation', () => {
  it('maps schema validation failures to validation_failed 400', async () => {
    const server = buildTestServer();
    server.post(
      '/things',
      {
        schema: {
          body: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email' } },
          },
        },
      },
      () => ({ ok: true }),
    );

    const res = await server.inject({
      method: 'POST',
      url: '/things',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
  });
});
