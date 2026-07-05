/**
 * Component tests for the interests / hero / highlight / percentile building
 * blocks (stats-experience-redesign task 6.6).
 *
 * Validates: Requirements 1.2, 9.1, 9.3, 10.3, 15.2
 *
 * Coverage:
 *   - `InterestsSection` renders one `FacetCoverageTile` per facet (R9.1) in the
 *     `sortFacetsForDisplay` order (percent desc, total desc, case-insensitive
 *     label asc — R9.2), and falls back to a compact empty state when there are
 *     no facets (R9.3).
 *   - `OverallHeroCard` switches to the celebratory "complete" treatment (the
 *     `CompleteBadge` + a ring label conveying "Complete") exactly WHERE the
 *     overall cell's `completeBadge` is true, and omits it otherwise (R1.2).
 *   - `PercentileBanner` is shown iff `percentileRank` is a number (R10.3) and
 *     renders nothing when the rank is absent or `percentileUnavailable` (R10.4).
 *   - `HighlightCard` exposes itself as an `accessibilityRole="button"` whose
 *     spoken label conveys both the highlight's story and its action, and
 *     invokes `onPress` when activated (R15.2).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  HighlightCard,
  InterestsSection,
  OverallHeroCard,
  PercentileBanner,
} from '../index';
import {
  COMPLETE_CELL,
  PARTIAL_CELL,
  makeByPark,
  makeCell,
  makeCoverageResponse,
  makeInsufficientRatings,
  makeStatsResponse,
} from '../../__testSupport__/statsFixture';
import type { FacetCoverage } from '../../../../api/statsTypes';
import {
  pickCoverageHighlight,
  pickRatingsHighlight,
  phrasePercentile,
} from '../../statsView';

// ---------------------------------------------------------------------------
// InterestsSection — facet ordering + empty state (R9.1, R9.2, R9.3)
// ---------------------------------------------------------------------------

describe('InterestsSection (Requirements 9.1, 9.2, 9.3)', () => {
  it('renders one tile per facet in display order (percent desc, total desc, label asc)', () => {
    // Deliberately out of display order on the wire.
    const facets: readonly FacetCoverage[] = [
      { key: 'water', label: 'Water Rides', cell: makeCell(0, 5) }, // 0%
      { key: 'dark-ride', label: 'Dark Rides', cell: makeCell(10, 10) }, // 100%
      { key: 'thrill', label: 'Thrill Rides', cell: makeCell(6, 15) }, // 40%
    ];

    render(<InterestsSection facets={facets} />);

    const tiles = screen.getAllByTestId(/^facet-tile-/);
    // One tile per facet (R9.1)...
    expect(tiles).toHaveLength(3);
    // ...ordered percent desc (R9.2): dark-ride (100) → thrill (40) → water (0).
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'facet-tile-dark-ride',
      'facet-tile-thrill',
      'facet-tile-water',
    ]);
  });

  it('breaks percent ties by total desc, then case-insensitive label asc', () => {
    const facets: readonly FacetCoverage[] = [
      // All 50% — tie on percent.
      { key: 'beta', label: 'beta', cell: makeCell(2, 4) }, // total 4
      { key: 'alpha', label: 'Alpha', cell: makeCell(4, 8) }, // total 8
      { key: 'gamma', label: 'Gamma', cell: makeCell(2, 4) }, // total 4
    ];

    render(<InterestsSection facets={facets} />);

    const tiles = screen.getAllByTestId(/^facet-tile-/);
    // Alpha first (largest total 8); then the two total-4 facets by
    // case-insensitive label asc: "beta" < "Gamma".
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'facet-tile-alpha',
      'facet-tile-beta',
      'facet-tile-gamma',
    ]);
  });

  it('renders the compact empty state when there are no facets (R9.3)', () => {
    render(<InterestsSection facets={[]} testID="interests-section" />);

    expect(screen.getByText('No interests yet')).toBeTruthy();
    // No facet tiles are rendered in the empty branch.
    expect(screen.queryAllByTestId(/^facet-tile-/)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OverallHeroCard — celebratory "complete" treatment (R1.2)
// ---------------------------------------------------------------------------

describe('OverallHeroCard (Requirement 1.2)', () => {
  it('shows the celebratory complete treatment when overall.completeBadge is true', () => {
    render(<OverallHeroCard overall={COMPLETE_CELL} />);

    // The celebratory CompleteBadge is mounted...
    expect(screen.getByTestId('overall-hero-complete-badge')).toBeTruthy();
    // ...and the hero ring announces its "Complete" state beyond color (R15.3).
    const ring = screen.getByTestId('overall-hero-ring');
    expect(ring.props.accessibilityLabel).toContain('Complete');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
  });

  it('omits the complete treatment for a partial overall cell', () => {
    render(<OverallHeroCard overall={PARTIAL_CELL} />);

    expect(screen.queryByTestId('overall-hero-complete-badge')).toBeNull();
    const ring = screen.getByTestId('overall-hero-ring');
    expect(ring.props.accessibilityLabel).not.toContain('Complete');
  });
});

// ---------------------------------------------------------------------------
// PercentileBanner — shown / hidden (R10.3, R10.4)
// ---------------------------------------------------------------------------

describe('PercentileBanner (Requirements 10.3, 10.4)', () => {
  it('renders the banner when percentileRank is a number (R10.3)', () => {
    const stats = makeStatsResponse({ percentileRank: 87.5 });

    render(<PercentileBanner stats={stats} testID="percentile-banner" />);

    const banner = screen.getByTestId('percentile-banner');
    expect(banner.props.accessibilityLabel).toBe(phrasePercentile(87.5));
    expect(screen.getByText(phrasePercentile(87.5))).toBeTruthy();
  });

  it('renders nothing when percentileRank is absent (R10.4)', () => {
    const stats = makeStatsResponse();

    render(<PercentileBanner stats={stats} testID="percentile-banner" />);

    expect(screen.queryByTestId('percentile-banner')).toBeNull();
  });

  it('renders nothing when the percentile is unavailable (R10.4)', () => {
    const stats = makeStatsResponse({ percentileUnavailable: true });

    render(<PercentileBanner stats={stats} testID="percentile-banner" />);

    expect(screen.queryByTestId('percentile-banner')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HighlightCard — button role + story/action label (R15.2)
// ---------------------------------------------------------------------------

describe('HighlightCard (Requirement 15.2)', () => {
  it('exposes a button whose label conveys both story and action, and fires onPress', () => {
    // A completed-park coverage highlight (complete: true, target CoverageDetail).
    const highlight = pickCoverageHighlight(
      makeCoverageResponse({
        byPark: makeByPark(PARTIAL_CELL, { 'Magic Kingdom': COMPLETE_CELL }),
      }),
    );
    const onPress = jest.fn();

    render(
      <HighlightCard
        highlight={highlight}
        onPress={onPress}
        testID="highlight-card"
      />,
    );

    const card = screen.getByTestId('highlight-card');
    // Exposed as a button (R15.2).
    expect(card.props.accessibilityRole).toBe('button');
    // The spoken label conveys the story (title + headline + complete state)...
    const label = card.props.accessibilityLabel as string;
    expect(label).toContain('Coverage');
    expect(label).toContain(highlight.headline);
    expect(label).toContain('Complete');
    // ...and the action / destination (R15.2).
    expect(label).toContain('Opens coverage details');

    // Activating the card invokes the handler exactly once.
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('conveys the locked state and ratings destination for the unlock tease', () => {
    const highlight = pickRatingsHighlight(makeInsufficientRatings(1));
    const onPress = jest.fn();

    render(
      <HighlightCard highlight={highlight} onPress={onPress} testID="highlight-card" />,
    );

    const card = screen.getByTestId('highlight-card');
    expect(card.props.accessibilityRole).toBe('button');
    const label = card.props.accessibilityLabel as string;
    expect(label).toContain('Ratings');
    expect(label).toContain('Unlock ratings (1/3)');
    expect(label).toContain('Locked');
    expect(label).toContain('Opens ratings details');
  });
});
