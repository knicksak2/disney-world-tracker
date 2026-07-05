/**
 * CoverageSection — the shared, lens-driven coverage renderer
 * (stats-experience-redesign task 6.1; restyled to the design mockup).
 *
 * Given the nested `coverage` object and one active `lens`, renders exactly that
 * lens's coverage content as ranked bars (`LabeledCellList`) matching the
 * mockup — most→least complete for the fixed-enum lenses, server order for the
 * open-ended ones. Shared by the Coverage detail screen (which owns the lens
 * switcher + the at-a-glance header — task 7.1) so the layout stays in one
 * place.
 *
 * Lens → content:
 *   - `parks`      → parks ranked most→least complete (all `PARKS`, incl. 0%).
 *   - `categories` → categories ranked most→least complete (all categories).
 *   - `areas`      → area types ranked, plus a ranked `coverage.byResortArea`.
 *   - `lands`      → ranked `coverage.byLand` (server order).
 *   - `resorts`    → the hotels-visited `coverage.resort` bar (a treatment kept
 *                    **distinct** from — never merged with — the per-resort
 *                    activity list, R5.11, R6.4) followed by a ranked
 *                    `coverage.byResort` list **in server order** (R6.1),
 *                    reading each entry only through `resortId` / `label` /
 *                    `cell` (R6.2), with a compact empty state (R6.3).
 *
 * Fixed-enum lenses always include every enum member — even `total === 0` ones
 * (they rank last with an empty bar, never hidden) (R5.4, R5.5). Every
 * completion decision (`completeBadge`, "N to go") is delegated to the pure
 * `statsView.ts` transforms and the server-owned cell math; this component
 * recomputes nothing.
 *
 * Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 6.1, 6.2,
 * 6.3, 6.4, 12.2, 15.1, 15.3, 15.5
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AREA_TYPES } from '@dwt/shared';
import type { AreaType } from '@dwt/shared';

import type { CoverageResponse } from '../../../api/statsTypes';
import { SectionLabel } from '../../../theme/components';
import { theme } from '../../../theme/theme';
import type { RankedRow } from '../statsView';
import { rankCategoryRows, rankParkRows } from '../statsView';

import { LabeledCellList } from './LabeledCellList';
import type { LabeledCellRow } from './LabeledCellList';

/**
 * The active coverage lens — the exact five options offered by the Coverage
 * detail screen's lens switcher (`Parks · Categories · Areas · Lands · Resorts`,
 * R5.1). Exactly one lens is rendered at a time (R5.3).
 */
export type CoverageLens =
  | 'parks'
  | 'categories'
  | 'areas'
  | 'lands'
  | 'resorts';

export interface CoverageSectionProps {
  /** The nested coverage object from the shared cached snapshot. */
  readonly coverage: CoverageResponse;
  /** Which single lens to render (R5.3). */
  readonly lens: CoverageLens;
  readonly testID?: string;
}

/** Per-`AreaType` display label + accent used for the ranked area rows. */
const AREA_TYPE_VISUAL: Record<AreaType, { label: string; accent: string }> = {
  ThemePark: { label: 'Theme Parks', accent: '#7e57c2' },
  WaterPark: { label: 'Water Parks', accent: '#17a2b8' },
  DisneySprings: { label: 'Disney Springs', accent: '#f6a609' },
  Resort: { label: 'Resorts', accent: theme.resortVisual.tint },
};

/** Area-type rows ranked most→least complete (all members, incl. 0%). */
function rankAreaRows(
  byAreaType: CoverageResponse['byAreaType'],
): readonly RankedRow[] {
  return AREA_TYPES.map((areaType) => {
    const visual = AREA_TYPE_VISUAL[areaType];
    return {
      key: areaType,
      label: visual.label,
      cell: byAreaType[areaType],
      color: visual.accent,
    };
  }).sort((a, b) =>
    b.cell.percent !== a.cell.percent
      ? b.cell.percent - a.cell.percent
      : b.cell.total - a.cell.total,
  );
}

/** Map open-ended `LabeledCell[]` (lands / resort areas) onto rows in server
 * order; the label doubles as the stable row key. */
function labeledRows(
  items: CoverageResponse['byLand'],
): readonly LabeledCellRow[] {
  return items.map((item) => ({
    key: item.label,
    label: item.label,
    cell: item.cell,
    color: theme.color.primary,
  }));
}

/** Map `byResort` onto rows, preserving server order (R6.1) and reading only
 * `resortId` / `label` / `cell` (R6.2). */
function resortRows(
  byResort: CoverageResponse['byResort'],
): readonly LabeledCellRow[] {
  return byResort.map((entry) => ({
    key: entry.resortId,
    label: entry.label,
    cell: entry.cell,
    color: theme.resortVisual.tint,
  }));
}

/**
 * Render exactly one coverage lens's content as ranked bars.
 */
export function CoverageSection({
  coverage,
  lens,
  testID,
}: CoverageSectionProps): JSX.Element {
  switch (lens) {
    case 'parks':
      return (
        <View testID={testID}>
          <LabeledCellList rows={rankParkRows(coverage.byPark)} rowTestIDPrefix="park-row" />
        </View>
      );

    case 'categories':
      return (
        <View testID={testID}>
          <LabeledCellList
            rows={rankCategoryRows(coverage.byCategory)}
            rowTestIDPrefix="category-row"
          />
        </View>
      );

    case 'areas':
      return (
        <View style={styles.stack} testID={testID}>
          <LabeledCellList rows={rankAreaRows(coverage.byAreaType)} rowTestIDPrefix="area-row" />
          <SectionLabel>Resort areas</SectionLabel>
          <LabeledCellList
            rows={labeledRows(coverage.byResortArea)}
            emptyTitle="No resort areas yet"
            emptyBody="Complete an experience in a resort area to see it here."
            rowTestIDPrefix="resort-area-row"
            testID="coverage-resort-areas"
          />
        </View>
      );

    case 'lands':
      return (
        <View testID={testID}>
          <LabeledCellList
            rows={labeledRows(coverage.byLand)}
            emptyTitle="No lands yet"
            emptyBody="Complete an experience in a themed land to see it here."
            rowTestIDPrefix="land-row"
            testID="coverage-lands"
          />
        </View>
      );

    case 'resorts':
      return (
        <View style={styles.stack} testID={testID}>
          {/* Hotels-visited (stayed) — a treatment kept DISTINCT from the
              per-resort activity list below; the two are never merged
              (R5.11, R6.4). */}
          <SectionLabel>Hotels visited</SectionLabel>
          <LabeledCellList
            rows={[
              {
                key: 'resort',
                label: 'Resorts stayed at',
                cell: coverage.resort,
                color: theme.resortVisual.tint,
              },
            ]}
            testID="coverage-hotels-visited"
          />
          {/* Per-resort activity completion, in server order (R6.1). */}
          <SectionLabel>What you&rsquo;ve done at each resort</SectionLabel>
          <LabeledCellList
            rows={resortRows(coverage.byResort)}
            emptyTitle="No resort activity yet"
            emptyBody="Complete a dining, recreation, or spa experience at a resort to see it here."
            rowTestIDPrefix="resort-row"
            testID="coverage-by-resort"
          />
        </View>
      );

    default: {
      // Exhaustiveness guard: every `CoverageLens` is handled above.
      const _exhaustive: never = lens;
      return _exhaustive;
    }
  }
}

const styles = StyleSheet.create({
  stack: {
    gap: theme.spacing.md,
  },
});
