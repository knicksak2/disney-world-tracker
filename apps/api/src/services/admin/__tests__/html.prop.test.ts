/**
 * Property tests for the viewer-local timestamp helper.
 *
 * Validates: Requirements 16.1, 16.3, 16.5
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { escapeHtml, localTime } from '../html.js';

const RUNS = { numRuns: 100 };

describe('localTime — property tests', () => {
  // Feature: admin-panel, Property 9: Instants render as exact UTC <time> elements and are safe and total
  it('Property 9: any valid Date round-trips through datetime/title and every accepted input form agrees', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('0001-01-01T00:00:00.000Z'),
          max: new Date('9999-12-31T23:59:59.999Z'),
          noInvalidDate: true,
        }),
        (d) => {
          const out = localTime(d);
          const iso = d.toISOString();
          expect(out).toContain(`datetime="${iso}"`);
          expect(out).toContain(`title="${iso}"`);
          expect(out).toContain('data-local-time');
          // Fallback text is the UTC rendering.
          const fallback = `${iso.slice(0, 19).replace('T', ' ')} UTC`;
          expect(out).toContain(`>${fallback}</time>`);
          // The datetime attribute round-trips to the same instant.
          const m = /datetime="([^"]*)"/.exec(out);
          expect(m).not.toBeNull();
          expect(new Date(m![1]!).getTime()).toBe(d.getTime());
          // Date, ISO string and epoch ms are interchangeable.
          expect(localTime(iso)).toBe(out);
          expect(localTime(d.getTime())).toBe(out);
          // No unescaped markup beyond the fixed template.
          const inner = out.replace(/^<time class="mono" data-local-time datetime="[^"<>]*" title="[^"<>]*">/, '').replace(/<\/time>$/, '');
          expect(inner).not.toMatch(/[<>"]/);
        },
      ),
      RUNS,
    );
  });

  // Feature: admin-panel, Property 9: Instants render as exact UTC <time> elements and are safe and total
  it('Property 9: arbitrary strings never throw and never leak unescaped <, > or " from the input', () => {
    const arbitraryText = fc.oneof(fc.string(), fc.fullUnicodeString(), fc.constantFrom('<script>alert(1)</script>', '"><img src=x onerror=1>', "'; DROP TABLE x;--"));
    fc.assert(
      fc.property(arbitraryText, (s) => {
        const out = localTime(s);
        if (s === '') {
          expect(out).toBe('-');
          return;
        }
        const ms = new Date(s).getTime();
        const year = Number.isNaN(ms) ? Number.NaN : new Date(ms).getUTCFullYear();
        if (Number.isNaN(ms) || year < 0 || year > 9999) {
          expect(out).toBe(`<span class="mono">${escapeHtml(s)}</span>`);
          const inner = out.replace('<span class="mono">', '').replace(/<\/span>$/, '');
          expect(inner).not.toMatch(/[<>"]/);
        } else {
          expect(out).toContain(`datetime="${new Date(ms).toISOString()}"`);
          expect(out.startsWith('<time class="mono" data-local-time ')).toBe(true);
        }
      }),
      RUNS,
    );
  });
});
