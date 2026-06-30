import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for `@dwt/shared`.
 *
 * Collection is scoped to the TypeScript sources under `src/` so the compiled
 * `.js` output under `dist/` is never picked up as a duplicate test file.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
