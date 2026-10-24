/**
 * Tests for the legal routes (`GET /terms`).
 * (Requirements 2.1, 2.2, 2.3)
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { legalRoutes, TERMS_PATH } from '../routes.js';

describe('legalRoutes: GET /terms', () => {
  // Feature: legal-disclaimers-and-terms, Property 2: Public Route Security and Framing Headers
  it('Property 2: GET /terms returns 200 text/html with anti-framing headers, Disney disclaimer, ThemeParks.wiki credit, and support email link', async () => {
    const app = Fastify();
    app.decorate('config', {
      support: { email: 'legal@example.org' },
    } as never);

    await app.register(legalRoutes());

    const res = await app.inject({
      method: 'GET',
      url: TERMS_PATH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");

    // Content checks
    expect(res.payload).toContain('Terms of Service');
    expect(res.payload).toContain('The Walt Disney Company');
    expect(res.payload).toContain('nominative fair use');
    expect(res.payload).toContain('ThemeParks.wiki');
    expect(res.payload).toContain('href="/privacy"');
    expect(res.payload).toContain('href="/account-deletion"');
    expect(res.payload).toContain('href="mailto:legal@example.org"');

    await app.close();
  });
});

