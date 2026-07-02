// Feature: catalog-navigation-redesign, Property 16: Default-expanded seeding and toggle
//
// Validates: Requirements 6.4, 6.5
//
// Property 16 (from tasks.md → 8.8):
//   `useDestinationSections(keys)` seeds a **default-expanded** policy: on the
//   first render every provided section key reports Expanded (R6.4). Thereafter
//   each `toggle(key)` flips exactly that one key's Expanded state and leaves
//   every other key untouched (R6.5) — the proven toggle-isolation / self-
//   inverse behavior of the underlying pure reducer, surfaced through the hook.
//
// Test strategy:
//   - `useDestinationSections` is a React hook wrapping in-memory state, so it
//     is exercised with `renderHook` + `act` (the same convention as the
//     `useOpenExperience` hook property tests).
//   - Seeding half: draw an arbitrary set of unique keys, render the hook, and
//     assert every provided key reports Expanded while an arbitrary
//     non-provided key reports Collapsed (the reducer's natural default).
//   - Toggle half: draw a query pool that is a superset of the provided keys
//     (so it also contains never-seeded keys, which start Collapsed) and an
//     arbitrary sequence of toggle operations over that pool. Maintain an
//     independent model — a `Map<string, boolean>` seeded to `true` for
//     provided keys and `false` otherwise — apply each toggle to both the hook
//     and the model, and after every toggle assert the hook agrees with the
//     model on the *entire* pool. Agreement across the whole pool after each
//     step is exactly "flips only that key, leaves the rest unchanged".

import fc from 'fast-check';
import { act, renderHook } from '@testing-library/react-native';

import { useDestinationSections } from '../useDestinationSections';

const NUM_RUNS = 100;

// A small key pool keeps collisions likely so toggle-isolation is genuinely
// exercised across repeated and interleaved keys.
const keyArb = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');

// The provided (seeded) section keys — a unique subset of the pool.
const providedKeysArb = fc.uniqueArray(keyArb, { maxLength: 8 });

describe('Property 16: useDestinationSections default-expanded seeding (R6.4)', () => {
  it('reports every provided key as Expanded on first render', () => {
    fc.assert(
      fc.property(providedKeysArb, (keys) => {
        const { result, unmount } = renderHook(() =>
          useDestinationSections(keys),
        );

        try {
          for (const key of keys) {
            expect(result.current.isExpanded(key)).toBe(true);
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports a key that was never provided as Collapsed by default', () => {
    fc.assert(
      fc.property(providedKeysArb, keyArb, (keys, probe) => {
        // Only meaningful when the probe key was not seeded.
        fc.pre(!keys.includes(probe));

        const { result, unmount } = renderHook(() =>
          useDestinationSections(keys),
        );

        try {
          expect(result.current.isExpanded(probe)).toBe(false);
        } finally {
          unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 16: useDestinationSections toggle flips exactly that key (R6.5)', () => {
  it('each toggle flips only its own key and leaves every other key unchanged', () => {
    fc.assert(
      fc.property(
        providedKeysArb,
        fc.array(keyArb, { maxLength: 20 }),
        (keys, toggles) => {
          const { result, unmount } = renderHook(() =>
            useDestinationSections(keys),
          );

          try {
            // Independent model: provided keys start Expanded (true),
            // everything else in the pool starts Collapsed (false).
            const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
            const expected = new Map<string, boolean>(
              pool.map((k) => [k, keys.includes(k)]),
            );

            // Seed agreement before any toggle.
            for (const k of pool) {
              expect(result.current.isExpanded(k)).toBe(expected.get(k));
            }

            for (const t of toggles) {
              act(() => {
                result.current.toggle(t);
              });

              // Flip exactly the toggled key in the model.
              expected.set(t, !expected.get(t));

              // The hook must agree with the model on the whole pool: the
              // toggled key flipped, every other key is untouched.
              for (const k of pool) {
                expect(result.current.isExpanded(k)).toBe(expected.get(k));
              }
            }
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('toggling the same key twice returns it to its seeded state (self-inverse)', () => {
    fc.assert(
      fc.property(providedKeysArb, keyArb, (keys, key) => {
        const { result, unmount } = renderHook(() =>
          useDestinationSections(keys),
        );

        try {
          const before = result.current.isExpanded(key);

          act(() => {
            result.current.toggle(key);
          });
          expect(result.current.isExpanded(key)).toBe(!before);

          act(() => {
            result.current.toggle(key);
          });
          expect(result.current.isExpanded(key)).toBe(before);
        } finally {
          unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
