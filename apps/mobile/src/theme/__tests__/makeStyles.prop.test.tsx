/**
 * Property 11: `makeStyles` is lazy and memoized per scheme.
 *
 *   - the factory runs 0 times before the first render (never at import);
 *   - it runs at most once per distinct scheme visited;
 *   - every render under the same scheme returns the identical (`===`) object;
 *   - each object's colour values equal that scheme's tokens.
 *
 * Validates: Requirements 8.3, 8.4
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';
import fc from 'fast-check';

import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import { makeStyles } from '../makeStyles';
import { themes, type AppTheme } from '../theme';

type Scheme = 'light' | 'dark';

function makeProbe() {
  const factory = jest.fn((t: AppTheme) => ({
    root: { backgroundColor: t.color.background, borderColor: t.color.border },
    title: { color: t.color.textPrimary },
  }));
  const useStyles = makeStyles(factory);
  const renders: Array<ReturnType<typeof useStyles>> = [];
  function Probe(): JSX.Element {
    const styles = useStyles();
    renders.push(styles);
    return <View testID="probe" style={styles.root} />;
  }
  return { factory, Probe, renders };
}

afterEach(resetTestScheme);

describe('Property 11: makeStyles is lazy and memoized per scheme', () => {
  it('does not run the factory when the hook is created, nor when kit modules are required', () => {
    const { factory } = makeProbe();
    expect(factory).not.toHaveBeenCalled();

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rn = require('react-native') as typeof import('react-native');
      const create = jest.spyOn(rn.StyleSheet, 'create');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../components');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../charts');
      // Neither kit module builds its themed sheet at import time.
      const kitSheets = create.mock.calls.filter(([styles]) => {
        const keys = Object.keys(styles as object);
        return keys.includes('chipActive') || keys.includes('ringCenterLabel');
      });
      expect(kitSheets).toHaveLength(0);
      create.mockRestore();
    });
  });

  // Feature: dark-mode, Property 11: makeStyles is lazy and memoized per scheme
  it('runs the factory at most once per scheme and returns one stable object per scheme', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Scheme>('light', 'dark'), { minLength: 1, maxLength: 12 }),
        (switches) => {
          const { factory, Probe, renders } = makeProbe();
          expect(factory).toHaveBeenCalledTimes(0);

          const view = render(<Probe />);
          const visited = new Set<Scheme>(['light']);
          const sheetFor = new Map<Scheme, unknown>();
          sheetFor.set('light', renders[renders.length - 1]);

          for (const s of switches) {
            setTestScheme(s);
            visited.add(s);
            view.rerender(<Probe />);
            const current = renders[renders.length - 1]!;
            const previous = sheetFor.get(s);
            if (previous !== undefined) expect(current).toBe(previous);
            sheetFor.set(s, current);

            const root = StyleSheet.flatten(view.getByTestId('probe').props.style);
            expect(root.backgroundColor).toBe(themes[s].color.background);
            expect(root.borderColor).toBe(themes[s].color.border);
            expect(current.title.color).toBe(themes[s].color.textPrimary);
          }

          expect(factory.mock.calls.length).toBeLessThanOrEqual(visited.size);
          expect(factory.mock.calls.length).toBe(visited.size);
          expect(factory.mock.calls.map(([t]) => t.scheme).sort()).toEqual([...visited].sort());
          if (visited.size === 2) expect(sheetFor.get('light')).not.toBe(sheetFor.get('dark'));

          view.unmount();
          resetTestScheme();
        },
      ),
      { numRuns: 100 },
    );
  });
});
