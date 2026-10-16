// Feature: dark-mode — theme-aware, lazily built style sheets.
//
// `StyleSheet.create` at module scope freezes colours at import time, so it
// can't follow a runtime scheme switch. `makeStyles` defers the factory to
// the first render under each scheme and caches the result per scheme, so:
//   - the factory never runs at import (no module-scope colour read);
//   - it runs at most once per scheme per module;
//   - the same object comes back for the same scheme (stable identity for
//     `React.memo` children and style equality checks).

import { StyleSheet } from 'react-native';

import { useAppTheme } from './useAppTheme';
import type { AppTheme, ColorScheme } from './theme';

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (t: AppTheme) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    // Unconditional hook call: subscribes the caller to scheme changes.
    const t = useAppTheme();
    let styles = cache[t.scheme];
    if (styles === undefined) {
      styles = StyleSheet.create(factory(t));
      cache[t.scheme] = styles;
    }
    return styles;
  };
}
