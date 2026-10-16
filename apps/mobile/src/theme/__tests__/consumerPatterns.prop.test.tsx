/**
 * Property 20: memoized and virtualized consumers repaint live.
 *
 * A probe built with the binding consumer patterns from design.md
 * ("Memoized and virtualized consumers") — a `useMemo` derived from `styles`
 * with `styles` in its deps, a `useCallback` `renderItem` passed to a
 * `FlatList` with `extraData={t.scheme}`, a `React.memo` row that receives
 * its style by prop, and a `useLayoutEffect` that calls
 * `navigation.setOptions` — is mounted once and switched between schemes.
 * Every probed host must report the current scheme's token after each
 * switch, without a remount. A control probe drops `styles` from the
 * `useMemo` deps and must NOT repaint, proving the probe detects the defect.
 *
 * Validates: Requirements 8.2, 8.5
 */

import React, { useCallback, useLayoutEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo, type TextStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import fc from 'fast-check';

import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import { makeStyles } from '../makeStyles';
import { themes } from '../theme';
import { useAppTheme } from '../useAppTheme';

type Scheme = 'light' | 'dark';

const useStyles = makeStyles((t) => ({
  title: { color: t.color.textPrimary, fontSize: 18 },
  row: { backgroundColor: t.color.surface },
  memoRow: { backgroundColor: t.color.surfaceAlt, color: t.color.textSecondary },
}));

const MemoRow = React.memo(function MemoRow({ style }: { readonly style: TextStyle }) {
  return (
    <Text testID="memo-row" style={style}>
      memo
    </Text>
  );
});

interface ProbeProps {
  readonly setOptions: (options: { headerStyle: { backgroundColor: string } }) => void;
  /** Control variant: omit `styles` from the `useMemo` deps (the defect). */
  readonly dropMemoDeps?: boolean;
}

function Probe({ setOptions, dropMemoDeps = false }: ProbeProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const titleStyle = useMemo(() => [styles.title, { fontWeight: '700' as const }], dropMemoDeps ? [] : [styles]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<string>) => (
      <Text testID={`item-${item}`} style={[styles.row, { color: t.color.textSecondary }]}>
        {item}
      </Text>
    ),
    [styles, t],
  );

  useLayoutEffect(() => {
    setOptions({ headerStyle: { backgroundColor: t.color.surface } });
  }, [setOptions, t]);

  return (
    <View>
      <Text testID="memo-title" style={titleStyle}>
        Title
      </Text>
      <FlatList
        data={['a', 'b', 'c']}
        keyExtractor={(x) => x}
        renderItem={renderItem}
        extraData={t.scheme}
      />
      <MemoRow style={styles.memoRow} />
    </View>
  );
}

const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style) ?? {};

afterEach(resetTestScheme);

describe('Property 20: memoized and virtualized consumers repaint live', () => {
  // Feature: dark-mode, Property 20: memoized and virtualized consumers repaint live
  it('every probed host reports the current scheme token after each switch, without remount', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Scheme>('light', 'dark'), { minLength: 1, maxLength: 8 }),
        (switches) => {
          const setOptions = jest.fn();
          render(<Probe setOptions={setOptions} />);
          const title = screen.getByTestId('memo-title');
          const item = screen.getByTestId('item-b');
          const memoRow = screen.getByTestId('memo-row');
          try {
            for (const s of switches) {
              setTestScheme(s);
              const t = themes[s];
              // Same host instances — no remount.
              expect(screen.getByTestId('memo-title')).toBe(title);
              expect(screen.getByTestId('item-b')).toBe(item);
              expect(screen.getByTestId('memo-row')).toBe(memoRow);

              expect(flat('memo-title').color).toBe(t.color.textPrimary);
              expect(flat('item-b').backgroundColor).toBe(t.color.surface);
              expect(flat('item-b').color).toBe(t.color.textSecondary);
              expect(flat('memo-row').backgroundColor).toBe(t.color.surfaceAlt);
              expect(flat('memo-row').color).toBe(t.color.textSecondary);
              expect(setOptions).toHaveBeenLastCalledWith({
                headerStyle: { backgroundColor: t.color.surface },
              });
            }
          } finally {
            screen.unmount();
            resetTestScheme();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('control: a useMemo that omits `styles` from its deps keeps stale light colours', () => {
    render(<Probe setOptions={jest.fn()} dropMemoDeps />);
    expect(flat('memo-title').color).toBe(themes.light.color.textPrimary);

    setTestScheme('dark');
    // The defect the binding rule forbids: the memoized style never repaints…
    expect(flat('memo-title').color).toBe(themes.light.color.textPrimary);
    expect(flat('memo-title').color).not.toBe(themes.dark.color.textPrimary);
    // …while the correctly-wired consumers beside it do.
    expect(flat('item-b').backgroundColor).toBe(themes.dark.color.surface);
    expect(flat('memo-row').backgroundColor).toBe(themes.dark.color.surfaceAlt);
  });
});
