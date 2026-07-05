/**
 * InterestsSection — the per-facet ("interests") coverage section
 * (stats-experience-redesign task 6.5).
 *
 * Renders the `coverage.byFacetValue` entries as a ranked list of
 * `FacetCoverageTile`s ordered for display via the pure `sortFacetsForDisplay`
 * transform (percent desc, total desc, case-insensitive label asc — R9.2), one
 * tile per facet (R9.1). When there are no facets it falls back to a compact
 * empty state (R9.3).
 *
 * Shared by the Interests detail screen and the Interests highlight surface;
 * consumes only the shared cached snapshot's facet list (no math recompute).
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 15.1
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { FacetCoverage } from '../../../api/statsTypes';
import { EmptyState } from '../../../theme/components';
import { theme } from '../../../theme/theme';
import { sortFacetsForDisplay } from '../statsView';

import { FacetCoverageTile } from './FacetCoverageTile';

/**
 * Accent palette cycled across the ranked facet rows so the interests list
 * reads as a colorful ranking (matching the mockup) rather than a monochrome
 * stack. Assigned by display position, not by facet identity.
 */
const FACET_PALETTE: readonly string[] = [
  '#7e57c2', // purple
  '#2f80ed', // blue
  '#17a2b8', // teal
  '#f6a609', // amber
  '#e8505b', // red
  '#3fa34d', // green
];

export interface InterestsSectionProps {
  /** The per-facet coverage entries (server order); sorted here for display. */
  readonly facets: readonly FacetCoverage[];
  readonly testID?: string;
}

/**
 * The interests/facets section: a display-ordered list of facet tiles, or a
 * compact empty state when there are no facets.
 */
export function InterestsSection({
  facets,
  testID,
}: InterestsSectionProps): JSX.Element {
  if (facets.length === 0) {
    return (
      <EmptyState
        icon="sparkles-outline"
        title="No interests yet"
        body="Complete a few experiences to see which kinds you explore most."
        {...(testID !== undefined ? { testID } : {})}
      />
    );
  }

  const ordered = sortFacetsForDisplay(facets);
  return (
    <View style={styles.list} testID={testID}>
      {ordered.map((facet, index) => (
        <FacetCoverageTile
          key={facet.key}
          facet={facet}
          color={FACET_PALETTE[index % FACET_PALETTE.length] ?? theme.color.primary}
          testID={`facet-tile-${facet.key}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: theme.spacing.sm,
  },
});
