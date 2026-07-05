/**
 * CoverageStatGrid — a responsive grid of fixed-enum coverage tiles
 * (stats-experience-redesign task 6.1).
 *
 * Renders one `CompletionStatTile` for every `TileSpec` it is given, in the
 * order supplied. The fixed-enum builders (`buildParkTiles`,
 * `buildCategoryTiles`, and the area-type tiles built by the caller) always
 * include every enum member — even members whose `Completion_Cell` has
 * `total === 0` (rendered muted, never hidden) — so a lens's layout stays
 * stable regardless of the user's data (R5.4, R5.5, R9.2).
 *
 * Purely presentational: it does no ordering or math of its own (the pure
 * `statsView.ts` transforms own ordering, the server owns the completion math).
 *
 * Validates: Requirements 5.4, 5.5, 5.7, 9.2, 15.1
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { TileSpec } from '../statsView';

import { CompletionStatTile } from './CompletionStatTile';

export interface CoverageStatGridProps {
  /** The ordered tiles to render (from a `buildParkTiles`-style transform). */
  readonly tiles: readonly TileSpec[];
  readonly testID?: string;
}

/**
 * A two-column wrapping grid of `CompletionStatTile`s.
 */
export function CoverageStatGrid({
  tiles,
  testID,
}: CoverageStatGridProps): JSX.Element {
  return (
    <View style={styles.grid} testID={testID}>
      {tiles.map((tile) => (
        <View key={tile.key} style={styles.cell}>
          <CompletionStatTile
            title={tile.title}
            cell={tile.cell}
            accentColor={tile.accentColor}
            {...(tile.icon !== undefined
              ? { icon: tile.icon as CompletionStatTileIcon }
              : {})}
            testID={`coverage-tile-${tile.key}`}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * The `icon` field on `TileSpec` is a plain string (the pure transform stays
 * framework-free); narrow it to the `CompletionStatTile` glyph type at the
 * render boundary here. `NonNullable` drops the `undefined` arm so the
 * conditional spread never assigns `icon: undefined` under
 * `exactOptionalPropertyTypes`.
 */
type CompletionStatTileIcon = NonNullable<
  React.ComponentProps<typeof CompletionStatTile>['icon']
>;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '50%',
  },
});
