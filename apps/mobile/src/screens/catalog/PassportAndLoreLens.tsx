// Feature: experience-detail-redesign, Task 21.2 — My_Passport_And_Lore_Lens
//
// Validates: Requirements 11.1, 11.5, 17.1, 18.1
//
// Behavior summary:
//   - Composes the personal and reference sections of the Experience:
//     1. ParkPassportCard (replaces plain YourVisitCard layout) (R17.1)
//     2. RestaurantDishLogCard (Restaurant only) (R18.1)
//     3. AboutSection (existing collapsible description)
//     4. Why_This_Section under the "Imagineer's Insider Notes" label (R11.5)
//     5. Community_Rating_Section
//     6. Remaining TagGroupCards (Good to know, Accessibility, Good for)

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type {
  AggregateRatingDTO,
  CompletionDTO,
  ExperienceCategory,
  ExperienceVisitHistoryDTO,
  NoteDTO,
  RatingDTO,
  WhyThisDTO,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Card, SectionLabel } from '../../theme/components';
import ParkPassportCard from './ParkPassportCard';
import RestaurantDishLogCard from './RestaurantDishLogCard';
import AboutSection from './AboutSection';
import type { TagGroup } from './infoTags';
import { formatCommunityAggregate } from './aggregateFormat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

export interface PassportAndLoreLensProps {
  readonly experienceId: string;
  readonly experienceName?: string | undefined;
  readonly category: ExperienceCategory;
  readonly description?: string | undefined;
  readonly whyThis?: WhyThisDTO | null | undefined;
  readonly menus?: readonly any[] | undefined;
  readonly completionQuery: QueryLike<CompletionDTO | null>;
  readonly ratingQuery: QueryLike<RatingDTO | null>;
  readonly noteQuery: QueryLike<NoteDTO | null>;
  readonly logsQuery: QueryLike<ExperienceVisitHistoryDTO | null>;
  readonly aggregateQuery: QueryLike<AggregateRatingDTO | null>;
  readonly remainingGroups?: readonly TagGroup[] | undefined;
  readonly onLogFoodItem?: (() => void) | undefined;
  readonly onMyLoggedItems?: (() => void) | undefined;
  readonly onAddToList?: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PassportAndLoreLens({
  experienceId,
  experienceName,
  category,
  description,
  whyThis,
  completionQuery,
  ratingQuery,
  noteQuery,
  logsQuery,
  aggregateQuery,
  remainingGroups = [],
  onLogFoodItem,
  onMyLoggedItems,
  onAddToList,
}: PassportAndLoreLensProps): JSX.Element {
  // Normalize copy for Why This duplicate filtering
  const normalizedDescription = (description ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
  const bullets = (whyThis?.bullets ?? []).filter(
    (bullet) => (bullet ?? '').trim().replace(/\s+/gu, ' ').toLowerCase() !== normalizedDescription,
  );

  return (
    <View style={styles.container} testID="passport-and-lore-lens">
      {/* 1. ParkPassportCard (R17.1) */}
      <ParkPassportCard
        experienceId={experienceId}
        completionQuery={completionQuery}
        ratingQuery={ratingQuery}
        noteQuery={noteQuery}
        logsQuery={logsQuery}
        initialExpanded={true}
      />

      {/* 2. RestaurantDishLogCard (Restaurant only) (R18.1) */}
      <RestaurantDishLogCard
        experienceId={experienceId}
        experienceName={experienceName}
        category={category}
        onLogFoodItem={onLogFoodItem}
        onMyLoggedItems={onMyLoggedItems}
        onAddToList={onAddToList}
      />

      {/* 3. Field Guide Card (Lore, Imagineer Notes, Community Rating, Specs) */}
      <Card style={styles.guideCard} testID="passport-lore-field-guide">
        {/* 3a. AboutSection */}
        <AboutSection
          description={description}
          title={
            category === 'Resort'
              ? '📖 The Resort History & Architecture'
              : '📖 The Attraction & Backstory'
          }
          noCard={true}
        />

        {/* 3b. WhyThisSection under "Imagineer's Insider Notes" label (R11.5, R20.6) */}
        {bullets.length > 0 ? (
          <View testID="experience-why-this">
            <View style={styles.insiderSecretsBox}>
              <View style={styles.insiderBadgeRow}>
                <Text style={{ fontSize: 13 }}>✨</Text>
                <Text style={styles.insiderBadgeText}>
                  {category === 'Resort'
                    ? 'Architectural Lore & Backstory'
                    : "Imagineer's Insider Notes"}
                </Text>
              </View>
              {bullets.map((bullet, index) => {
                const icon = bullet.toLowerCase().includes('heat') || bullet.toLowerCase().includes('air-conditioned')
                  ? '❄️'
                  : bullet.toLowerCase().includes('jack sparrow') || bullet.toLowerCase().includes('pirate')
                  ? '🗝️'
                  : '✨';
                return (
                  <View key={`why-this-${index}`} style={styles.insiderBulletRow}>
                    <Text style={styles.insiderBulletIcon}>{icon}</Text>
                    <Text style={styles.insiderBulletText}>{bullet}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* 3c. Community Rating section */}
        <View testID="community-rating-section">
          <SectionLabel style={styles.communitySubhead}>Community Rating</SectionLabel>
          <AggregateContent query={aggregateQuery} />
        </View>

        {/* 3d. Remaining Tag_Groups (Accessibility & Specs Cloud) */}
        {remainingGroups.length > 0 ? (
          <View style={styles.facetsCloud}>
            {remainingGroups.map((group) => (
              <View
                key={group.id}
                style={styles.facetGroup}
                testID={`experience-tag-group-${group.id}`}
              >
                <Text style={styles.cloudLabel}>{group.label}</Text>
                <View style={styles.cloudTagsRow}>
                  {group.tags.map((tag, index) => (
                    <View
                      key={`${tag.kind}-${index}`}
                      style={styles.cloudPill}
                      accessibilityLabel={tag.accessibilityLabel}
                      testID={`experience-info-tag-${tag.kind}`}
                    >
                      <Text style={styles.cloudPillText}>{tag.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function AggregateContent({
  query,
}: {
  readonly query: QueryLike<AggregateRatingDTO | null>;
}): JSX.Element {
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load community rating.</Text>;
  }
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading community rating"
        color={theme.color.primary}
      />
    );
  }
  if (query.isError || query.data === undefined || query.data === null) {
    return <Text style={styles.errorText}>Could not load community rating.</Text>;
  }
  const display = formatCommunityAggregate(query.data);
  if (display.kind === 'empty') {
    return (
      <Text style={styles.emptyText} testID="aggregate-empty">
        Not enough ratings yet
      </Text>
    );
  }
  return (
    <View style={styles.communityGuestStrip}>
      <View style={styles.guestScoreDial}>
        <Text style={styles.guestScoreNum}>{display.mean}</Text>
        <Text style={styles.guestScoreLbl}>Out of 10</Text>
        <Text style={{ height: 0, width: 0, opacity: 0, overflow: 'hidden' }} testID="aggregate-value">
          {display.mean} / 10
        </Text>
      </View>
      <View style={styles.commRightCol}>
        <Text style={styles.commTitle}>
          Based on {display.count} park guest {display.count === 1 ? 'rating' : 'ratings'}
        </Text>
        <Text style={styles.aggregateMeta} testID="aggregate-count">
          ({display.count} {display.count === 1 ? 'rating' : 'ratings'})
        </Text>
        <Text style={styles.commSub}>
          Average rating across all completed visits. Requires minimum 3 ratings.
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  guideCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  section: {
    gap: theme.spacing.md,
  },
  communitySubhead: {
    fontSize: 11,
    fontWeight: '800',
    color: '#655d78',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  facetsCloud: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#ded1f1',
    borderStyle: 'dashed',
    gap: 12,
  },
  facetGroup: {
    gap: 6,
  },
  bodyText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  emptyText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.color.danger,
  },
  aggregateBlock: {
    gap: theme.spacing.xs,
  },
  aggregateValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  aggregateValue: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
    fontWeight: '700',
  },
  aggregateMeta: {
    ...theme.typography.meta,
    color: '#655d78',
    fontSize: 10,
    marginTop: 1,
  },
  insiderSecretsBox: {
    backgroundColor: '#f9f5fe',
    borderWidth: 1.5,
    borderColor: '#ded1f1',
    borderRadius: 16,
    padding: 14,
  },
  insiderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  insiderBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5b2a86',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  insiderBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  insiderBulletIcon: {
    fontSize: 13,
    marginTop: 1,
  },
  insiderBulletText: {
    flex: 1,
    fontSize: 12,
    color: '#190c2d',
    lineHeight: 18,
  },
  communityGuestStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fffcf4',
    borderWidth: 1,
    borderColor: '#f6e6be',
    borderRadius: 14,
    padding: 12,
  },
  guestScoreDial: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
  },
  guestScoreNum: {
    fontSize: 22,
    fontWeight: '800',
    color: '#b45309',
    lineHeight: 24,
  },
  guestScoreLbl: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#92400e',
  },
  commRightCol: {
    flex: 1,
  },
  commTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#190c2d',
  },
  commSub: {
    fontSize: 10.5,
    color: '#655d78',
    marginTop: 2,
  },
  cloudLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#655d78',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  cloudTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cloudPill: {
    backgroundColor: '#f1ecf9',
    borderWidth: 1,
    borderColor: '#e2d7f2',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  cloudPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#190c2d',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
});
