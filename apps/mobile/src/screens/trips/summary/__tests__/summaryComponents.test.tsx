/**
 * The presentational pieces shared by TripSummaryScreen and TripRecapScreen
 * (photo-uploads task 22.7, Requirement 15.23). Rendered directly: no network.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, screen, within } from '@testing-library/react-native';

import { lightTheme } from '../../../../theme/theme';
import { SUMMARY_MEDAL } from '../../TripSummaryScreen.palette';
import { SummaryAwardCard, awardIconName } from '../SummaryAwardCard';
import { SummaryHeroCard } from '../SummaryHeroCard';
import { SummarySectionHeader } from '../SummarySectionHeader';
import { SummaryStatTiles } from '../SummaryStatTiles';
import { ExperienceThumb, TopRatedMomentRow } from '../TopRatedMomentRow';
import {
  formatMeanRating,
  isItineraryComplete,
  itineraryPercent,
  ratingCountLabel,
} from '../summaryFormat';

const flat = (node: ReactTestInstance): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

function paintedAncestor(node: ReactTestInstance): ReactTestInstance {
  let current: ReactTestInstance | null = node.parent;
  while (current !== null && flat(current).backgroundColor === undefined) {
    current = current.parent;
  }
  if (current === null) throw new Error('no painted ancestor');
  return current;
}

describe('summaryFormat', () => {
  test('itineraryPercent rounds, clamps to 100 and reads 100 for an empty plan', () => {
    expect(itineraryPercent(3, 4)).toBe(75);
    expect(itineraryPercent(7, 9)).toBe(78);
    expect(itineraryPercent(12, 9)).toBe(100);
    expect(itineraryPercent(0, 0)).toBe(100);
  });

  test('isItineraryComplete needs a non-empty, fully completed plan', () => {
    expect(isItineraryComplete(4, 4)).toBe(true);
    expect(isItineraryComplete(3, 4)).toBe(false);
    expect(isItineraryComplete(0, 0)).toBe(false);
  });

  test('formatMeanRating shows at most one decimal and an em dash when not finite', () => {
    expect(formatMeanRating(9.5)).toBe('9.5');
    expect(formatMeanRating(9)).toBe('9');
    expect(formatMeanRating(7.25)).toBe('7.3');
    expect(formatMeanRating(Number.NaN)).toBe('—');
    expect(formatMeanRating(Number.POSITIVE_INFINITY)).toBe('—');
  });

  test('ratingCountLabel is singular for one', () => {
    expect(ratingCountLabel(1)).toBe('1 rating');
    expect(ratingCountLabel(0)).toBe('0 ratings');
    expect(ratingCountLabel(4)).toBe('4 ratings');
  });
});

describe('SummaryHeroCard', () => {
  const ids = {
    testID: 'hero',
    plannedTestID: 'hero-planned',
    plannedCountTestID: 'hero-planned-count',
  };

  test('partial plan: ring with the right label and "N of M"', () => {
    render(
      <SummaryHeroCard title="Title" badgeLabel="Badge" plannedCompletedCount={3} plannedTotalCount={4} {...ids} />,
    );
    expect(screen.getByLabelText('75% of planned experiences completed')).toBeTruthy();
    expect(screen.getByTestId('hero-planned-count')).toHaveTextContent('3 of 4');
    expect(screen.getByText('planned Experiences completed')).toBeTruthy();
    expect(screen.queryByText('100% Itinerary Completed! 🎉')).toBeNull();
  });

  test('completed plan shows the congratulations pill', () => {
    render(
      <SummaryHeroCard title="Title" badgeLabel="Badge" plannedCompletedCount={4} plannedTotalCount={4} {...ids} />,
    );
    expect(screen.getByLabelText('100% of planned experiences completed')).toBeTruthy();
    expect(screen.getByText('100% Itinerary Completed! 🎉')).toBeTruthy();
  });

  test('empty plan without a custom line keeps the Summary "0 of 0"', () => {
    render(
      <SummaryHeroCard title="Title" badgeLabel="Badge" plannedCompletedCount={0} plannedTotalCount={0} {...ids} />,
    );
    expect(screen.getByTestId('hero-planned-count')).toHaveTextContent('0 of 0');
    expect(screen.getByText('planned Experiences completed')).toBeTruthy();
  });

  test('empty plan with a custom line shows it instead of a ring or "N of M"', () => {
    render(
      <SummaryHeroCard
        title="Title"
        badgeLabel="Badge"
        plannedCompletedCount={0}
        plannedTotalCount={0}
        emptyPlannedLine="Nothing planned"
        {...ids}
      />,
    );
    expect(screen.getByText('Nothing planned')).toBeTruthy();
    expect(screen.queryByLabelText(/of planned experiences completed/)).toBeNull();
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
    expect(screen.queryByText('planned Experiences completed')).toBeNull();
  });

  test('badge label, optional subtitle and header-role title', () => {
    render(
      <SummaryHeroCard
        title="My Trip"
        titleIsHeader
        titleTestID="hero-title"
        badgeLabel="Shared by Pat"
        badgeIcon="people"
        subtitle="Some subtitle"
        plannedCompletedCount={1}
        plannedTotalCount={2}
        {...ids}
      />,
    );
    expect(screen.getByText('Shared by Pat')).toBeTruthy();
    expect(screen.getByText('Some subtitle')).toBeTruthy();
    expect(screen.getByTestId('hero-title').props.accessibilityRole).toBe('header');
  });

  test('without titleIsHeader the title carries no header role and no subtitle renders', () => {
    render(
      <SummaryHeroCard
        title="My Trip"
        titleTestID="hero-title"
        badgeLabel="Badge"
        plannedCompletedCount={1}
        plannedTotalCount={2}
        {...ids}
      />,
    );
    expect(screen.getByTestId('hero-title').props.accessibilityRole).toBeUndefined();
  });
});

describe('SummaryStatTiles', () => {
  test('four tiles with their labels, prefixed ids and bound values', () => {
    render(
      <SummaryStatTiles
        distinctExperienceCount={5}
        totalCompletionsCount={6}
        totalRatingsCount={7}
        parksExploredCount={8}
        testIDPrefix="p"
        testID="p-grid"
      />,
    );
    expect(screen.getByTestId('p-grid')).toBeTruthy();
    expect(within(screen.getByTestId('p-distinct')).getByText('Distinct Rides & Shows')).toBeTruthy();
    expect(screen.getByTestId('p-distinct-count')).toHaveTextContent('5');
    expect(within(screen.getByTestId('p-total-completions')).getByText('Total Logged Rides')).toBeTruthy();
    expect(screen.getByTestId('p-total-completions-count')).toHaveTextContent('6');
    expect(within(screen.getByTestId('p-total-ratings')).getByText('Ratings Given')).toBeTruthy();
    expect(screen.getByTestId('p-total-ratings-count')).toHaveTextContent('7');
    expect(within(screen.getByTestId('p-parks-explored')).getByText('Parks Explored')).toBeTruthy();
    expect(screen.getByTestId('p-parks-explored-count')).toHaveTextContent('8');
  });

  test('exactly one distinct experience reads "Distinct Ride"', () => {
    render(
      <SummaryStatTiles
        distinctExperienceCount={1}
        totalCompletionsCount={0}
        totalRatingsCount={0}
        parksExploredCount={0}
        testIDPrefix="p"
      />,
    );
    expect(screen.getByText('Distinct Ride')).toBeTruthy();
  });
});

describe('SummarySectionHeader', () => {
  test('renders the title as a header next to its icon', () => {
    render(<SummarySectionHeader icon="star" iconColor="#123456" title="Top-Rated Moments" testID="hdr" />);
    const title = screen.getByText('Top-Rated Moments');
    expect(title.props.accessibilityRole).toBe('header');
    expect(flat(title).color).toBe(lightTheme.color.textPrimary);
    const icon = screen.getByTestId('hdr').findAll((n) => (n.type as unknown) === 'Icon');
    expect(icon).toHaveLength(1);
    expect(icon[0]!.props.color).toBe('#123456');
  });
});

describe('SummaryAwardCard', () => {
  test('maps the known icon keys and falls back to ribbon', () => {
    expect(awardIconName('trophy')).toBe('trophy');
    expect(awardIconName('compass')).toBe('compass');
    expect(awardIconName('people')).toBe('people');
    expect(awardIconName('star')).toBe('star');
    expect(awardIconName('sparkles')).toBe('sparkles');
    expect(awardIconName('map')).toBe('map');
    expect(awardIconName('coaster')).toBe('ribbon');
  });

  test('winner falls back member name, then experience name, then "The Group"; value pill only when present', () => {
    const base = { id: 'a', title: 'T', description: 'D', icon: 'star' };
    const { rerender } = render(
      <SummaryAwardCard
        award={{ ...base, memberDisplayName: 'Pat', experienceName: 'Dumbo', value: 3 }}
        testID="award"
      />,
    );
    expect(within(screen.getByTestId('award')).getByText('Pat')).toBeTruthy();
    expect(within(screen.getByTestId('award')).getByText('3')).toBeTruthy();

    rerender(<SummaryAwardCard award={{ ...base, experienceName: 'Dumbo' }} testID="award" />);
    expect(within(screen.getByTestId('award')).getByText('Dumbo')).toBeTruthy();

    rerender(<SummaryAwardCard award={base} testID="award" />);
    expect(within(screen.getByTestId('award')).getByText('The Group')).toBeTruthy();
    expect(within(screen.getByTestId('award')).queryByText('3')).toBeNull();
  });
});

describe('TopRatedMomentRow', () => {
  test('rank medals: gold, silver, bronze, then the neutral surface', () => {
    const expected = [
      SUMMARY_MEDAL.light.gold,
      SUMMARY_MEDAL.light.silver,
      SUMMARY_MEDAL.light.bronze,
      lightTheme.color.surfaceAlt,
    ];
    expected.forEach((fill, rank) => {
      const { unmount } = render(
        <TopRatedMomentRow rank={rank} name={`Row ${rank}`} meanRating={8} ratingCount={2} testID={`row-${rank}`} />,
      );
      const badge = paintedAncestor(screen.getByText(`#${rank + 1}`));
      expect(flat(badge).backgroundColor).toBe(fill);
      unmount();
    });
  });

  test('non-finite mean rating reads as an em dash in the pill and its spoken label', () => {
    render(<TopRatedMomentRow rank={0} name="X" meanRating={Number.NaN} ratingCount={1} testID="row" />);
    expect(within(screen.getByTestId('row')).getByText('—')).toBeTruthy();
    expect(screen.getByLabelText('Average rating — out of 10')).toBeTruthy();
    expect(screen.getByText('1 rating')).toBeTruthy();
  });

  test('a park outside the theme accents still renders its badge', () => {
    render(
      <TopRatedMomentRow rank={0} name="X" meanRating={8} ratingCount={2} park="Unlisted Park" testID="row" />,
    );
    expect(within(screen.getByTestId('row')).getByText('Unlisted Park')).toBeTruthy();
  });
});

describe('ExperienceThumb', () => {
  test('an unknown category uses the neutral placeholder with the sparkles glyph', () => {
    render(<ExperienceThumb imageUrl={null} category="NoSuchCategory" />);
    const glyph = screen.UNSAFE_root.findAll((n) => (n.type as unknown) === 'Icon');
    expect(glyph).toHaveLength(1);
    expect(glyph[0]!.props.name).toBe('sparkles');
    expect(flat(paintedAncestor(glyph[0]!)).backgroundColor).toBe(lightTheme.color.surfaceAlt);
  });

  test('an empty image url is treated as no image', () => {
    render(<ExperienceThumb imageUrl="" category="Ride" />);
    expect(screen.UNSAFE_root.findAll((n) => (n.type as unknown) === 'Icon')).toHaveLength(1);
  });
});
