/**
 * Barrel for the shared stats section components
 * (stats-experience-redesign task 6).
 *
 * Re-exports the interests, hero, highlight, and percentile building blocks
 * (task 6.5), the ratings building blocks (task 6.3), and coverage building
 * blocks (task 6.1, as it lands) consumed by the Overview hub, the detail
 * screens, and the Friend surface.
 */

export { CompletionStatTile } from './CompletionStatTile';
export type { CompletionStatTileProps } from './CompletionStatTile';

export { CoverageStatGrid } from './CoverageStatGrid';
export type { CoverageStatGridProps } from './CoverageStatGrid';

export { LabeledCellList } from './LabeledCellList';
export type { LabeledCellListProps, LabeledCellRow } from './LabeledCellList';

export { CoverageSection } from './CoverageSection';
export type { CoverageSectionProps, CoverageLens } from './CoverageSection';

export { FacetCoverageTile } from './FacetCoverageTile';
export type { FacetCoverageTileProps } from './FacetCoverageTile';

export { InterestsSection } from './InterestsSection';
export type { InterestsSectionProps } from './InterestsSection';

export { OverallHeroCard } from './OverallHeroCard';
export type { OverallHeroCardProps } from './OverallHeroCard';

export { PercentileBanner } from './PercentileBanner';
export type { PercentileBannerProps } from './PercentileBanner';

export { HighlightCard } from './HighlightCard';
export type { HighlightCardProps } from './HighlightCard';

export {
  RatingsSection,
  RatingDial,
  RatingHistogram,
  HighLowHeroCards,
  RatingAveragesGrid,
  RatingsUnlockEmptyState,
} from './RatingsSection';
export type {
  RatingsSectionProps,
  RatingDialProps,
  RatingHistogramProps,
  HighLowHeroCardsProps,
  RatingAveragesGridProps,
  RatingsUnlockEmptyStateProps,
  RatingsEmptyVariant,
} from './RatingsSection';
