/**
 * The bundled `locationRules.seed.json` (design.md "Seed location rules"). It is imported (not read from disk), so
 * `tsc` emits it into `dist/` beside this module and the deployed build carries it.
 */

import seed from './locationRules.seed.json' with { type: 'json' };

/** The raw file; `parseSeedFile` validates it before any write. */
export const BUNDLED_SEED: unknown = seed;
