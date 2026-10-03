/**
 * HTTP Basic Authentication gate for the Admin Panel.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 1.7
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

export interface BasicAuthOptions {
  readonly username: string;
  readonly password: string;
}

export const UNAUTHORIZED_BODY = 'Unauthorized';

/**
 * Compares two strings in constant time by comparing their SHA-256 digests.
 * Both digests are fixed 32-byte buffers, ensuring timingSafeEqual is invoked
 * over identical buffer lengths regardless of input length or content.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

function isValidBase64(str: string): boolean {
  if (str.length === 0 || str.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(str);
}

function sendUnauthorized(reply: FastifyReply): void {
  reply
    .status(401)
    .header('WWW-Authenticate', 'Basic realm="admin"')
    .type('text/plain; charset=utf-8')
    .send(UNAUTHORIZED_BODY);
}

export function createBasicAuthHook(
  options: BasicAuthOptions,
): preHandlerHookHandler {
  return function basicAuthHook(request: FastifyRequest, reply: FastifyReply, done) {
    const authHeader = request.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) {
      sendUnauthorized(reply);
      return;
    }

    const base64Part = authHeader.slice(6).trim();
    if (!isValidBase64(base64Part)) {
      sendUnauthorized(reply);
      return;
    }

    let decoded: string;
    try {
      decoded = Buffer.from(base64Part, 'base64').toString('utf8');
    } catch {
      sendUnauthorized(reply);
      return;
    }

    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      sendUnauthorized(reply);
      return;
    }

    const user = decoded.slice(0, colonIndex);
    const pass = decoded.slice(colonIndex + 1);

    const userMatch = constantTimeCompare(user, options.username);
    const passMatch = constantTimeCompare(pass, options.password);

    if (!userMatch || !passMatch) {
      sendUnauthorized(reply);
      return;
    }

    done();
  };
}
