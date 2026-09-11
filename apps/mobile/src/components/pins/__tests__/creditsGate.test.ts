/**
 * Build-gate (R6.2): the in-app "Art credits" list must stay exactly in sync with the audit trail
 * in `motifs/CREDITS.md`. The screen renders `PIN_CREDITS`; this test parses the "Attribution
 * required in-app" block out of CREDITS.md and asserts it equals `PIN_CREDITS`, in both directions.
 * So a motif library added to (or removed from) the audit trail forces the in-app credits to be
 * updated too — the app can never show credits that drift from the licensing record.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { PIN_CREDITS } from '../pinCredits';

const CREDITS_MD = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '.kiro',
  'specs',
  'pin-collection',
  'motifs',
  'CREDITS.md',
);

/** Extract the blockquote attribution lines from the "Attribution required in-app" section. */
function attributionLinesFromCredits(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## Attribution required in-app'));
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  const block = end >= 0 ? rest.slice(0, end) : rest;
  return block
    .map((l) => l.match(/^>\s+(.+\S)\s*$/)?.[1]?.trim())
    .filter((l): l is string => !!l);
}

describe('in-app pin credits parity with CREDITS.md', () => {
  const md = readFileSync(CREDITS_MD, 'utf8');
  const fromFile = attributionLinesFromCredits(md);

  it('extracts a non-trivial attribution block from CREDITS.md', () => {
    expect(fromFile.length).toBeGreaterThanOrEqual(8);
  });

  it('PIN_CREDITS matches the CREDITS.md attribution block exactly and in order', () => {
    expect(PIN_CREDITS).toEqual(fromFile);
  });

  it('every in-app credit line names an author/source and a licence', () => {
    for (const line of PIN_CREDITS) {
      expect(line).toMatch(/—/); // author — source — licence, em-dash separated
      expect(line).toMatch(/CC BY|CC0|MIT|Apache|Proprietary/);
    }
  });
});
