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
