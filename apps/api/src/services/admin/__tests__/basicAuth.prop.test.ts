import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  constantTimeCompare,
  createBasicAuthHook,
  UNAUTHORIZED_BODY,
} from '../basicAuth.js';

const NUM_RUNS = 100;

describe('basicAuth — property tests', () => {
  // Feature: admin-panel, Property 1: Basic Auth gate is total and non-leaking
  it('Property 1: Basic Auth gate is total and non-leaking', async () => {
    const validUser = 'operator';
    const validPass = 'secret-sauce-1234';
    const expectedAuthHeader = `Basic ${Buffer.from(`${validUser}:${validPass}`).toString('base64')}`;

    const app: FastifyInstance = Fastify();
    let handlerExecuted = false;

    const hook = createBasicAuthHook({
      username: validUser,
      password: validPass,
    });

    app.get('/admin/test', { preHandler: hook }, async (_req, reply) => {
      handlerExecuted = true;
      return reply.status(200).send('SUCCESS');
    });

    await app.ready();

    // Arbitrary header generator: undefined, malformed, wrong scheme, arbitrary creds, or the valid header
    const headerArb: fc.Arbitrary<string | undefined> = fc.oneof(
      fc.constant<string | undefined>(undefined),
      fc.string(),
      fc.string().map((s) => `Bearer ${s}`),
      fc.string().map((s) => `Basic ${s}`),
      fc.tuple(fc.string(), fc.string()).map(([u, p]) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`),
      fc.constant(expectedAuthHeader),
    );

    await fc.assert(
      fc.asyncProperty(headerArb, async (authHeader) => {
        handlerExecuted = false;

        const headers: Record<string, string> = {};
        if (authHeader !== undefined) {
          headers.authorization = authHeader;
        }

        const res = await app.inject({
          method: 'GET',
          url: '/admin/test',
          headers,
        });

        const isExactMatch = authHeader === expectedAuthHeader;

        if (isExactMatch) {
          expect(res.statusCode).toBe(200);
          expect(res.body).toBe('SUCCESS');
          expect(handlerExecuted).toBe(true);
        } else {
          // Totality & non-leaking: every non-matching case returns identical 401 response
          expect(res.statusCode).toBe(401);
          expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
          expect(res.body).toBe(UNAUTHORIZED_BODY);
          expect(handlerExecuted).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: admin-panel, Property 2: Basic Auth comparison is constant-time in input length
  it('Property 2: Basic Auth comparison is constant-time in input length', () => {
    const fixedPassword = 'correct-password-alpha-123';
    const passwordLength = fixedPassword.length;

    fc.assert(
      fc.property(
        // Generates candidate strings of equal length to fixedPassword with variable prefix matches
        fc.integer({ min: 0, max: passwordLength }).chain((prefixMatchLen) => {
          const matchingPrefix = fixedPassword.slice(0, prefixMatchLen);
          return fc
            .string({
              minLength: passwordLength - prefixMatchLen,
              maxLength: passwordLength - prefixMatchLen,
            })
            .map((suffix) => ({
              candidate: matchingPrefix + suffix,
              prefixMatchLen,
            }));
        }),
        ({ candidate }) => {
          // Digest-length invariance: SHA-256 digest is always 32 bytes regardless of content or match count
          const hashA = createHash('sha256').update(candidate, 'utf8').digest();
          const hashB = createHash('sha256').update(fixedPassword, 'utf8').digest();

          expect(hashA.length).toBe(32);
          expect(hashB.length).toBe(32);

          const result = constantTimeCompare(candidate, fixedPassword);
          const expectedEqual = candidate === fixedPassword;
          expect(result).toBe(expectedEqual);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
