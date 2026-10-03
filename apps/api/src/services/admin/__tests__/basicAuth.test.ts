import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBasicAuthHook, UNAUTHORIZED_BODY } from '../basicAuth.js';

describe('basicAuth — unit tests', () => {
  let app: FastifyInstance;
  let handlerRan = false;

  const validUsername = 'the-admin';
  const validPassword = 'super-secret-password-123';

  beforeEach(async () => {
    handlerRan = false;
    app = Fastify();
    const hook = createBasicAuthHook({
      username: validUsername,
      password: validPassword,
    });

    app.get('/admin', { preHandler: hook }, async (_req, reply) => {
      handlerRan = true;
      return reply.status(200).send('SUCCESS_ADMIN_PAGE');
    });

    await app.ready();
  });

  function toBasicHeader(user: string, pass: string): string {
    const creds = `${user}:${pass}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  it('rejects requests with missing Authorization header (401 + WWW-Authenticate)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('rejects requests with non-Basic scheme (e.g. Bearer token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: 'Bearer some-jwt-or-opaque-token',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('rejects requests with malformed base64', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: 'Basic !@#$%^&*()',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('rejects requests with base64 that does not contain a colon', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: `Basic ${Buffer.from('just-a-username-with-no-colon').toString('base64')}`,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('rejects requests with wrong username', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: toBasicHeader('wrong-admin', validPassword),
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('rejects requests with wrong password', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: toBasicHeader(validUsername, 'wrong-password'),
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(res.body).toBe(UNAUTHORIZED_BODY);
    expect(handlerRan).toBe(false);
  });

  it('allows requests with exact matching credentials (200 + executes handler)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: toBasicHeader(validUsername, validPassword),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('SUCCESS_ADMIN_PAGE');
    expect(handlerRan).toBe(true);
  });
});
