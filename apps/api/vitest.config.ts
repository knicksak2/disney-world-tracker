import { defineConfig } from 'vitest/config';

/**
 * Vitest 4 configuration for the Disney World Tracker API.
 *
 * Two things this config has to get right that vitest 1 handled implicitly:
 *
 * 1. File collection. Vitest 4 changed its default include/exclude globbing
 *    and started picking up the compiled `.js` test files under `dist/`,
 *    inflating the suite from 66 source test files to 129. We scope
 *    collection to the TypeScript sources under `src/` and explicitly
 *    exclude build output so the suite stays at its 66-file baseline.
 *
 * 2. Single zod instance. The route helpers do `schema.parse()` then
 *    `catch (err) { if (err instanceof ZodError) ... }`. The schemas come
 *    from `@dwt/shared` (which depends on zod) while the routes import
 *    `ZodError`/`z` directly from `zod`. Under vitest 4's transform/SSR
 *    pipeline these can resolve to two distinct module instances, making
 *    `instanceof ZodError` false and turning a 400 into a 500. Deduping
 *    `zod` and `@dwt/shared` forces every importer onto a single instance
 *    so `instanceof` holds at test runtime.
 */
export default defineConfig({
  resolve: {
    dedupe: ['zod', '@dwt/shared'],
  },
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Several suites drive the production SQL through an in-memory Postgres
    // (`pg-mem`) and rebuild a freshly-migrated database on every property-test
    // iteration (numRuns: 100). Under full file-level parallelism on slower or
    // loaded machines those legitimately exceed vitest's 5s/10s defaults, so
    // give tests and setup hooks generous headroom. This changes only the
    // tolerance for slow runs, never test behavior or coverage.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Coverage gate — scoped ONLY to the day-planning pure modules. `all: true` +
    // this narrow `include` means any planning source file that isn't exercised by a
    // test counts as 0% and fails the threshold, so untested optimizer/travel code
    // fails the normal `npm run test` run (it cannot be marked "done"). The rest of the
    // codebase is not instrumented, so there is no overhead or reporting noise elsewhere.
    coverage: {
      // Off by default so ad-hoc scoped runs (`vitest run <one-file>`) are not
      // failed by the planning threshold when they don't touch planning/** —
      // that false exit-1 broke the single-file inner loop and pushed agents to
      // re-run the whole suite. The gate is still enforced on the full run: the
      // `test` script passes `--coverage` (so `npm run test` / `npm run verify`
      // turn it back on), which is the only place the threshold must hold.
      enabled: false,
      provider: 'v8',
      all: true,
      include: ['src/services/planning/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/__tests__/**'],
      thresholds: {
        'src/services/planning/**': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 80,
        },
      },
    },
    server: {
      deps: {
        // Inline the workspace package so its zod import is transformed by
        // the same pipeline as the API sources, keeping a single zod
        // instance shared between schema definitions and `instanceof` checks.
        inline: ['@dwt/shared'],
      },
    },
  },
});
