/**
 * Legal routes: public Terms of Service endpoint (`GET /terms`).
 * (Requirements 2.1, 2.2, 2.3)
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { renderTermsOfServiceHtml } from '../accountDeletion/webPages.js';

export const TERMS_PATH = '/terms';

export function legalRoutes(): FastifyPluginAsync {
  return async function legalRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.get(TERMS_PATH, async (_request, reply) => {
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .header('x-frame-options', 'DENY')
        .header('content-security-policy', "frame-ancestors 'none'")
        .send(
          renderTermsOfServiceHtml({
            supportEmail: app.config.support.email,
          }),
        );
    });
  };
}

