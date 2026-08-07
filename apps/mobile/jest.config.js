/**
 * Jest configuration for the Expo mobile app.
 *
 * Uses the `jest-expo` preset, which configures the React Native /
 * Expo Babel transform pipeline, the React Native test environment,
 * and platform-specific module resolution.
 *
 * Key extensions on top of the preset:
 *
 *   - `setupFilesAfterEnv` wires in the
 *     `@testing-library/jest-native` matcher extensions
 *     (`toBeOnTheScreen`, `toHaveTextContent`, …) for every test file.
 *   - `transformIgnorePatterns` extends the preset's default to allow
 *     transformation of `@react-navigation/*`, `react-native-*`,
 *     `expo*`, `@expo/*`, `@dwt/shared`, and a few other ESM packages
 *     that ship un-transpiled JS.
 *   - `moduleNameMapper` resolves `@dwt/shared` to the workspace
 *     TypeScript source (rather than the compiled `dist`), matching the
 *     `babel.config.js` `module-resolver` alias used in dev.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  // React Native's Animated module schedules background timers that the
  // BottomTabBar uses for its press feedback. They keep the Node event
  // loop alive after the test suite finishes; force-exit avoids a
  // 1-second hang at the end of every Jest run without masking real
  // unsettled promises (we do not have any).
  forceExit: true,
  // Parallelism. jest-expo workers are memory-heavy, so we don't let Jest
  // fan out to all 32 cores (its default of cores-1 risks V8 heap exhaustion).
  // 8 workers cuts the suite from ~167s (at the previous, over-conservative
  // maxWorkers=2) to ~35s while staying well within memory — a measured
  // sweet spot, not a guess.
  maxWorkers: 8,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-calendars|react-native-swipe-gestures|@dwt/shared))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  moduleNameMapper: {
    '^@dwt/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@dwt/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    // The `@dwt/shared` sources use explicit ESM `.js` specifiers on their
    // relative imports (e.g. `export … from './enums.js'`) so the compiled
    // output is valid ESM. Under Jest's resolver those map onto the `.ts`
    // sources, so strip the `.js` extension from relative specifiers and let
    // the resolver pick up the TypeScript file. Anchored to `./` / `../`
    // prefixes so only relative imports are rewritten.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
