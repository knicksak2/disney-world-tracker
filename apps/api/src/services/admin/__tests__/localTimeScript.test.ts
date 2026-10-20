/**
 * Behavior test for the inline LOCAL_TIME_SCRIPT.
 *
 * jsdom is not a declared apps/api dependency, so the script is evaluated with
 * node:vm against a minimal stub `document` (the script only uses
 * querySelectorAll, getAttribute, textContent and Intl.DateTimeFormat). The
 * viewer's zone is pinned by wrapping the real Intl.DateTimeFormat.
 *
 * Validates: Requirements 16.2, 16.5
 */

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LOCAL_TIME_SCRIPT, localTime, renderPage, table } from '../html.js';

interface StubEl {
  attrs: Record<string, string>;
  textContent: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function makeEl(datetime: string | null, text: string): StubEl & { setCalls: number } {
  const attrs: Record<string, string> = datetime === null ? {} : { datetime };
  const el = {
    attrs,
    textContent: text,
    setCalls: 0,
    getAttribute(name: string) {
      return name in this.attrs ? this.attrs[name]! : null;
    },
    setAttribute(name: string, value: string) {
      this.setCalls += 1;
      this.attrs[name] = value;
    },
  };
  return el;
}

function run(
  els: Array<ReturnType<typeof makeEl>>,
  opts: { timeZone?: string; intlThrows?: boolean } = {},
): { selectors: string[] } {
  const selectors: string[] = [];
  const RealDTF = Intl.DateTimeFormat;
  const sandboxIntl = {
    DateTimeFormat: function (locale: string, options: Intl.DateTimeFormatOptions) {
      if (opts.intlThrows) throw new Error('Intl unavailable');
      return new RealDTF(locale, { ...options, timeZone: opts.timeZone ?? 'UTC' });
    },
  };
  const document = {
    querySelectorAll(selector: string) {
      selectors.push(selector);
      return els;
    },
  };
  vm.runInNewContext(LOCAL_TIME_SCRIPT, { document, Intl: sandboxIntl });
  return { selectors };
}

describe('LOCAL_TIME_SCRIPT', () => {
  it('rewrites to America/Los_Angeles daylight time with the PDT abbreviation', () => {
    const el = makeEl('2026-10-19T14:03:00.000Z', '2026-10-19 14:03:00 UTC');
    run([el], { timeZone: 'America/Los_Angeles' });
    expect(el.textContent).toBe('2026-10-19 07:03:00 PDT');
  });

  it('renders local midnight as 00:00:00 (never 24:00:00) in winter time', () => {
    const el = makeEl('2026-01-15T08:00:00.000Z', '2026-01-15 08:00:00 UTC');
    run([el], { timeZone: 'America/Los_Angeles' });
    expect(el.textContent).toBe('2026-01-15 00:00:00 PST');
  });

  it('converts the instant (date rolls forward) for Asia/Kolkata', () => {
    const el = makeEl('2026-10-19T20:00:00.000Z', '2026-10-19 20:00:00 UTC');
    run([el], { timeZone: 'Asia/Kolkata' });
    expect(el.textContent).toMatch(/^2026-10-20 01:30:00 GMT\+5:30$/);
  });

  it('renders the UTC zone as UTC', () => {
    const el = makeEl('2026-10-19T14:03:00.000Z', 'x');
    run([el], { timeZone: 'UTC' });
    expect(el.textContent).toBe('2026-10-19 14:03:00 UTC');
  });

  it('keeps the fallback text for a missing, blank or invalid datetime attribute', () => {
    const missing = makeEl(null, 'fallback-missing');
    const blank = makeEl('', 'fallback-blank');
    const bad = makeEl('not-a-date', 'fallback-bad');
    run([missing, blank, bad], { timeZone: 'America/Los_Angeles' });
    expect(missing.textContent).toBe('fallback-missing');
    expect(blank.textContent).toBe('fallback-blank');
    expect(bad.textContent).toBe('fallback-bad');
  });

  it('keeps the fallback text and does not throw when Intl.DateTimeFormat throws', () => {
    const el = makeEl('2026-10-19T14:03:00.000Z', '2026-10-19 14:03:00 UTC');
    expect(() => run([el], { intlThrows: true })).not.toThrow();
    expect(el.textContent).toBe('2026-10-19 14:03:00 UTC');
  });

  it('never modifies datetime or title (no setAttribute calls) and keeps the original datetime', () => {
    const el = makeEl('2026-10-19T14:03:00.000Z', 'x');
    run([el], { timeZone: 'Asia/Tokyo' });
    expect(el.setCalls).toBe(0);
    expect(el.attrs['datetime']).toBe('2026-10-19T14:03:00.000Z');
  });

  it('queries only time[data-local-time]', () => {
    const { selectors } = run([], { timeZone: 'UTC' });
    expect(selectors).toEqual(['time[data-local-time]']);
  });

  it('end to end: a rendered table cell + the shell script localize the exact server instant', () => {
    const html = renderPage(
      'T',
      table([{ at: new Date('2026-10-19T14:03:00Z') }], [{ header: 'At', cell: (r) => localTime(r.at) }]),
    );
    const m = /<time [^>]*datetime="([^"]+)"[^>]*>([^<]*)<\/time>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('2026-10-19 14:03:00 UTC');
    const el = makeEl(m![1]!, m![2]!);
    // The script embedded in the page is the one under test.
    const embedded = /<script>([\s\S]*)<\/script>/.exec(html);
    expect(embedded![1]).toBe(LOCAL_TIME_SCRIPT);
    run([el], { timeZone: 'America/New_York' });
    expect(el.textContent).toBe('2026-10-19 10:03:00 EDT');
  });
});
