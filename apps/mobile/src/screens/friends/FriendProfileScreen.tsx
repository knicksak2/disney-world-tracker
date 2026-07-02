/**
 * FriendProfileScreen — the Friend_Profile_View (task 8.1).
 *
 * Reorganizes a selected Friend's Profile summary, completion statistics, and
 * Completions behind a tabbed View_Selector instead of one long scroll. The
 * three backend reads are still issued as three independent React Query hooks
 * (task 7.1: `useFriendProfileQuery`, `useFriendStatsQuery`,
 * `useFriendCompletionsQuery`), each keyed by `friendId`, with their retry
 * policy unchanged — so each read owns its own loading / error / retry state
 * and a failure in one read never discards data already loaded for the others
 * (R7.1, R7.3, R7.6).
 *
 * Navigation (R1.*):
 *
 *   - The screen renders the `View_Selector` (`TabSelector` +
 *     `FRIEND_PROFILE_TABS`) and exactly one Profile_View_Mode pane at a time,
 *     driven by `useViewMode(['Overview','Parks','Categories','Experiences'])`
 *     (R1.1, R1.3, R1.4, R1.5). The selector stays usable even while a
 *     non-forbidden read is in error, and switching modes never re-issues a
 *     read (the panes read from the already-cached query data) (R6.5, R7.6).
 *
 * Per-mode data dependencies and scoped states (R7.1, R7.3, R7.5):
 *
 *   - **Overview** — Profile read (name, avatar/placeholder, overall percent)
 *     plus the Stats read's overall `completed` count (R2.*).
 *   - **Parks** — Stats `byPark` headers + Completions grouped by Park (R3.*).
 *   - **Categories** — Stats `byCategory` headers + Completions grouped by
 *     Category (R4.*).
 *   - **Experiences** — Completions, via the shared `ExperiencesList` (R5.*).
 *
 *   Each pane shows its own loading indicator while a read whose data it
 *   displays is in flight with no prior data, and its own error + retry when
 *   such a read fails (including the synthetic 30-second timeout surfaced by
 *   `api/friendProfile.ts`); retry re-issues only the failed read (R7.1, R7.3,
 *   R7.4, R7.5).
 *
 * Authorization (R7.2):
 *
 *   - All three reads share one owner-or-friend gate, so a `profile_forbidden`
 *     on any of them means the Friend's data is unavailable. The screen then
 *     withholds the View_Selector and all four modes and shows a single
 *     unavailable message.
 *
 * The server already does the percentage math (rounding to one decimal,
 * capping at 100.0, zero-safe denominators); `formatPercent` re-applies
 * `toFixed(1)` purely so a whole-number percent still shows its trailing
 * decimal.
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2,
 * 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3,
 * 5.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import React from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
  type ProfileDTO,
} from '@dwt/shared';

import { ApiError } from '../../api/client';
import type {
  FriendStatsBreakdown,
  FriendStatsResponse,
} from '../../api/friendProfile';
import {
  useFriendCompletionsQuery,
  useFriendProfileQuery,
  useFriendStatsQuery,
} from '../../hooks/useFriendProfile';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { CompactEmptyState } from '../navigation/CompactEmptyState';
import { CompletionRow } from '../navigation/CompletionRow';
import { ExperiencesList } from '../navigation/ExperiencesList';
import { GroupSection } from '../navigation/GroupSection';
import { useOpenExperience } from '../navigation/experienceNavigation';
import { groupByCategory, groupByPark } from '../navigation/grouping';
import {
  FRIEND_PROFILE_TABS,
  TabSelector,
  type ProfileViewMode,
} from '../navigation/TabSelector';
import { useGroupSections } from '../navigation/useGroupSections';
import { useViewMode } from '../navigation/useViewMode';

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

/**
 * Navigation params for the Friend_Profile_View. The friends list passes the
 * selected Friend's `friendId` (used to key all three reads) and
 * `displayName` (rendered immediately in the header so the screen has a
 * title before the Profile read resolves).
 */
export interface FriendProfileParams {
  readonly friendId: string;
  readonly displayName: string;
}

interface FriendProfileScreenProps {
  readonly route: { readonly params: FriendProfileParams };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * The Profile_View_Modes in their fixed order; `modes[0]` (Overview) is the
 * canonical default selected on first display (R1.1, R1.3). A module constant
 * so the reference is stable across renders (keeps `useViewMode`'s `select`
 * callback identity stable).
 */
const FRIEND_MODES = [
  'Overview',
  'Parks',
  'Categories',
  'Experiences',
] as const satisfies readonly ProfileViewMode[];

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const UNAVAILABLE_TITLE = 'Profile unavailable';
const UNAVAILABLE_BODY =
  'This friend\u2019s profile is no longer available to view.';
const ERROR_BODY = 'We couldn\u2019t load this. Please try again.';

// ---------------------------------------------------------------------------
// Read-state helper
// ---------------------------------------------------------------------------

type ReadState = 'loading' | 'error' | 'ready';

/**
 * Reduce a React Query result to the three states a mode pane cares about:
 *
 *   - `ready`   — data is available (even if a *subsequent* fetch later
 *     errored, the already-loaded data is retained and rendered, R7.6).
 *   - `loading` — no data yet and a request is in flight (initial load or a
 *     re-issued retry, R7.1, R7.5).
 *   - `error`   — no data and the request failed with a non-`profile_forbidden`
 *     error, including the synthetic 30-second timeout (R7.3, R7.4).
 */
function readState(query: {
  readonly data: unknown;
  readonly isFetching: boolean;
  readonly isError: boolean;
}): ReadState {
  if (query.data !== undefined) return 'ready';
  if (query.isFetching) return 'loading';
  if (query.isError) return 'error';
  return 'loading';
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FriendProfileScreen({
  route,
}: FriendProfileScreenProps): JSX.Element {
  const { friendId, displayName } = route.params;

  const navigation = useNavigation();

  const profileQuery = useFriendProfileQuery(friendId);
  const statsQuery = useFriendStatsQuery(friendId);
  const completionsQuery = useFriendCompletionsQuery(friendId);

  const { mode, select } = useViewMode(FRIEND_MODES);

  // R10.2: a single per-Screen_Session Group_Section state instance backs both
  // the Parks and Categories grouped modes, so each section's Expanded/Collapsed
  // state survives switching between modes. Keys are namespaced per mode
  // (`parks:<name>`, `categories:<name>`) so same-named groups never collide.
  // Mounting the hook here means the state resets to all-Collapsed when the
  // screen is presented anew (R8.1, R10.3).
  const groupSections = useGroupSections();

  // R2.1/R2.2: a single per-Screen_Session navigation handler threaded to every
  // Completed_Experience_Row across Parks, Categories, and Experiences modes so
  // tapping any of the Friend's completed Experiences opens that Experience's
  // ExperienceDetail. The repeat-tap guard lives inside the hook (R5.1).
  const openExperience = useOpenExperience();

  // R7.2: the three reads share one owner-or-friend gate, so a
  // `profile_forbidden` on any of them means the Friend's data is
  // unavailable. Withhold the View_Selector and every mode, and surface a
  // single unavailable message.
  const forbidden =
    isForbidden(profileQuery.error) ||
    isForbidden(statsQuery.error) ||
    isForbidden(completionsQuery.error);

  if (forbidden) {
    return (
      <ScreenContainer>
        <GradientHeader
          title={displayName}
          icon="person"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.center} testID="friend-profile-unavailable">
          <EmptyState
            icon="lock-closed-outline"
            title={UNAVAILABLE_TITLE}
            body={UNAVAILABLE_BODY}
          />
        </View>
      </ScreenContainer>
    );
  }

  const onRetryProfile = (): void => {
    void profileQuery.refetch();
  };
  const onRetryStats = (): void => {
    void statsQuery.refetch();
  };
  const onRetryCompletions = (): void => {
    void completionsQuery.refetch();
  };

  return (
    <ScreenContainer>
      <GradientHeader
        title={displayName}
        icon="person"
        compact
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="friend-profile-screen"
      >
        <TabSelector
          tabs={FRIEND_PROFILE_TABS}
          active={mode}
          onSelect={select}
        />

        {mode === 'Overview' ? (
          <OverviewMode
            fallbackName={displayName}
            profileState={readState(profileQuery)}
            statsState={readState(statsQuery)}
            profile={profileQuery.data}
            stats={statsQuery.data}
            onRetryProfile={onRetryProfile}
            onRetryStats={onRetryStats}
          />
        ) : null}

        {mode === 'Parks' ? (
          <ParksMode
            statsState={readState(statsQuery)}
            completionsState={readState(completionsQuery)}
            stats={statsQuery.data}
            entries={completionsQuery.data?.entries}
            onRetryStats={onRetryStats}
            onRetryCompletions={onRetryCompletions}
            isExpanded={groupSections.isExpanded}
            toggle={groupSections.toggle}
            onOpenExperience={openExperience}
          />
        ) : null}

        {mode === 'Categories' ? (
          <CategoriesMode
            statsState={readState(statsQuery)}
            completionsState={readState(completionsQuery)}
            stats={statsQuery.data}
            entries={completionsQuery.data?.entries}
            onRetryStats={onRetryStats}
            onRetryCompletions={onRetryCompletions}
            isExpanded={groupSections.isExpanded}
            toggle={groupSections.toggle}
            onOpenExperience={openExperience}
          />
        ) : null}

        {mode === 'Experiences' ? (
          <ExperiencesMode
            completionsState={readState(completionsQuery)}
            entries={completionsQuery.data?.entries}
            onRetryCompletions={onRetryCompletions}
            onOpenExperience={openExperience}
          />
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Overview mode (R2.*)
// ---------------------------------------------------------------------------

function OverviewMode({
  fallbackName,
  profileState,
  statsState,
  profile,
  stats,
  onRetryProfile,
  onRetryStats,
}: {
  readonly fallbackName: string;
  readonly profileState: ReadState;
  readonly statsState: ReadState;
  readonly profile: ProfileDTO | undefined;
  readonly stats: FriendStatsResponse | undefined;
  readonly onRetryProfile: () => void;
  readonly onRetryStats: () => void;
}): JSX.Element {
  return (
    <View testID="friend-mode-overview">
      {profileState === 'loading' ? (
        <ModeLoader testID="friend-profile-loading" />
      ) : profileState === 'error' || profile === undefined ? (
        <SectionError testID="friend-profile-error" onRetry={onRetryProfile} />
      ) : (
        <Card style={styles.profileCard} testID="friend-profile-summary">
          {profile.avatarUrl !== null ? (
            <AvatarImage uri={profile.avatarUrl} />
          ) : (
            <AvatarPlaceholder />
          )}
          <Text style={styles.profileName}>
            {profile.displayName || fallbackName}
          </Text>
          <Text style={styles.profileLabel}>Overall completion</Text>
          <Text style={styles.profilePercent}>
            {formatPercent(profile.overallCompletionPercent)}
          </Text>

          {/* R2.4: total count of completed Active Experiences, sourced from
              the Stats read's overall `completed`. Scoped to the Stats read so
              the rest of the card still renders if Stats is slow or failed. */}
          {statsState === 'loading' ? (
            <ActivityIndicator
              color={theme.color.primary}
              testID="friend-stats-loading"
            />
          ) : statsState === 'error' || stats === undefined ? (
            <View testID="friend-overview-count-error">
              <PrimaryButton
                label="Retry"
                icon="refresh-outline"
                onPress={onRetryStats}
                testID="friend-stats-error-retry"
                style={styles.retryBtn}
              />
            </View>
          ) : (
            <Text style={styles.profileCount} testID="friend-overview-count">
              {`${stats.overall.completed} experiences completed`}
            </Text>
          )}
        </Card>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Parks mode (R3.*)
// ---------------------------------------------------------------------------

function ParksMode(props: ParksModeProps): JSX.Element {
  const {
    statsState,
    completionsState,
    stats,
    entries,
    onRetryStats,
    onRetryCompletions,
    isExpanded,
    toggle,
    onOpenExperience,
  } = props;

  const blocking = renderBlockingState({
    testIDContainer: 'friend-mode-parks',
    reads: [
      {
        state: statsState,
        loadingTestID: 'friend-stats-loading',
        errorTestID: 'friend-stats-error',
        onRetry: onRetryStats,
      },
      {
        state: completionsState,
        loadingTestID: 'friend-completions-loading',
        errorTestID: 'friend-completions-error',
        onRetry: onRetryCompletions,
      },
    ],
  });
  if (blocking !== null) return blocking;

  // Both reads ready.
  const readyStats = stats as FriendStatsResponse;
  const groups = groupByPark(entries ?? [], PARKS);

  return (
    <View testID="friend-mode-parks">
      {groups.map((group) => {
        // R7.2 / R8.2: render a Group_Section for every Park, including
        // zero-count Parks (none omitted). Key namespaced per mode (R10.2).
        const sectionKey = `parks:${group.park}`;
        return (
          <GroupSection
            key={group.park}
            sectionKey={sectionKey}
            expanded={isExpanded(sectionKey)}
            onToggle={toggle}
            accessibilityLabel={group.park}
            header={
              <StatHeader
                title={group.park}
                breakdown={readyStats.byPark[group.park]}
                accentColor={theme.parkAccent[group.park]}
                testID={`friend-stats-park-${group.park}`}
              />
            }
            testID={`friend-park-group-${group.park}`}
          >
            {group.entries.length === 0 ? (
              // R11.2: Expanded body of an empty group shows a Compact_Empty_State.
              <CompactEmptyState
                message={'This friend hasn\u2019t completed anything in this park yet.'}
                testID={`friend-park-empty-${group.park}`}
              />
            ) : (
              // R11.1: Expanded body shows the group's Completed_Experience_Rows.
              group.entries.map((entry, index) => (
                <CompletionRow
                  key={`${entry.experienceName}-${entry.completedOn}-${index}`}
                  entry={entry}
                  fields="parks"
                  onOpenExperience={onOpenExperience}
                  testID={`friend-park-${group.park}-row-${index}`}
                />
              ))
            )}
          </GroupSection>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Categories mode (R4.*)
// ---------------------------------------------------------------------------

function CategoriesMode(props: CategoriesModeProps): JSX.Element {
  const {
    statsState,
    completionsState,
    stats,
    entries,
    onRetryStats,
    onRetryCompletions,
    isExpanded,
    toggle,
    onOpenExperience,
  } = props;

  const blocking = renderBlockingState({
    testIDContainer: 'friend-mode-categories',
    reads: [
      {
        state: statsState,
        loadingTestID: 'friend-stats-loading',
        errorTestID: 'friend-stats-error',
        onRetry: onRetryStats,
      },
      {
        state: completionsState,
        loadingTestID: 'friend-completions-loading',
        errorTestID: 'friend-completions-error',
        onRetry: onRetryCompletions,
      },
    ],
  });
  if (blocking !== null) return blocking;

  const readyStats = stats as FriendStatsResponse;
  const groups = groupByCategory(entries ?? [], EXPERIENCE_CATEGORIES);

  return (
    <View testID="friend-mode-categories">
      {groups.map((group) => {
        const visual = theme.categoryVisual[group.category];
        const isEmpty = group.entries.length === 0;
        // R7.2 / R8.2: a Group_Section for every Category, including empties.
        const sectionKey = `categories:${group.category}`;

        // R9.2: preserve the underlying mode's figure suppression — an empty
        // Category_Group's header shows the name and an empty indication with
        // the percentage and counts suppressed; a non-empty group's header is
        // the full StatHeader (name + percent + completed/total).
        const header = isEmpty ? (
          <Card
            style={styles.card}
            testID={`friend-stats-category-${group.category}`}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleWrap}>
                <Ionicons
                  name={visual.glyph as keyof typeof Ionicons.glyphMap}
                  size={16}
                  color={visual.tint}
                  style={styles.cardIcon}
                />
                <Text style={styles.cardTitle}>{visual.label}</Text>
              </View>
            </View>
            <Text style={styles.cardCounts}>No completed Experiences yet</Text>
          </Card>
        ) : (
          <StatHeader
            title={visual.label}
            breakdown={readyStats.byCategory[group.category]}
            accentColor={visual.tint}
            icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            testID={`friend-stats-category-${group.category}`}
          />
        );

        return (
          <GroupSection
            key={group.category}
            sectionKey={sectionKey}
            expanded={isExpanded(sectionKey)}
            onToggle={toggle}
            accessibilityLabel={visual.label}
            header={header}
            testID={`friend-category-group-${group.category}`}
          >
            {isEmpty ? (
              // R11.2: Expanded body of an empty group shows a Compact_Empty_State.
              <CompactEmptyState
                message={'This friend hasn\u2019t completed anything in this category yet.'}
                testID={`friend-category-empty-${group.category}`}
              />
            ) : (
              // R11.1: Expanded body shows the group's Completed_Experience_Rows.
              group.entries.map((entry, index) => (
                <CompletionRow
                  key={`${entry.experienceName}-${entry.completedOn}-${index}`}
                  entry={entry}
                  fields="categories"
                  onOpenExperience={onOpenExperience}
                  testID={`friend-category-${group.category}-row-${index}`}
                />
              ))
            )}
          </GroupSection>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Experiences mode (R5.*)
// ---------------------------------------------------------------------------

function ExperiencesMode({
  completionsState,
  entries,
  onRetryCompletions,
  onOpenExperience,
}: {
  readonly completionsState: ReadState;
  readonly entries: readonly CompletionEntryDTO[] | undefined;
  readonly onRetryCompletions: () => void;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  if (completionsState === 'loading') {
    return (
      <View testID="friend-mode-experiences">
        <ModeLoader testID="friend-completions-loading" />
      </View>
    );
  }
  if (completionsState === 'error' || entries === undefined) {
    return (
      <View testID="friend-mode-experiences">
        <SectionError
          testID="friend-completions-error"
          onRetry={onRetryCompletions}
        />
      </View>
    );
  }
  return (
    <View testID="friend-mode-experiences">
      <ExperiencesList
        entries={entries}
        testIDPrefix="friend"
        onOpenExperience={onOpenExperience}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Mode prop types (shared between Parks and Categories)
// ---------------------------------------------------------------------------

interface ParksModeProps {
  readonly statsState: ReadState;
  readonly completionsState: ReadState;
  readonly stats: FriendStatsResponse | undefined;
  readonly entries: readonly CompletionEntryDTO[] | undefined;
  readonly onRetryStats: () => void;
  readonly onRetryCompletions: () => void;
  readonly isExpanded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
  readonly onOpenExperience: (experienceId: string) => void;
}

type CategoriesModeProps = ParksModeProps;

// ---------------------------------------------------------------------------
// Blocking-state helper (loading / error gate for multi-read modes)
// ---------------------------------------------------------------------------

interface ModeRead {
  readonly state: ReadState;
  readonly loadingTestID: string;
  readonly errorTestID: string;
  readonly onRetry: () => void;
}

/**
 * For a mode that displays more than one read, render the union of the
 * not-ready reads' loading indicators and error+retry controls scoped to
 * exactly those reads (R7.1, R7.3, R7.5). Returns `null` when every read is
 * ready, so the caller renders the mode content. A read that is `ready`
 * (i.e. has data) is omitted even if a later fetch failed, so other modes'
 * loaded data is retained and the selector stays usable (R7.6).
 */
function renderBlockingState({
  testIDContainer,
  reads,
}: {
  readonly testIDContainer: string;
  readonly reads: readonly ModeRead[];
}): JSX.Element | null {
  const pending = reads.filter((read) => read.state !== 'ready');
  if (pending.length === 0) return null;

  return (
    <View testID={testIDContainer}>
      {pending.map((read, index) =>
        read.state === 'loading' ? (
          <ModeLoader key={`${read.loadingTestID}-${index}`} testID={read.loadingTestID} />
        ) : (
          <SectionError
            key={`${read.errorTestID}-${index}`}
            testID={read.errorTestID}
            onRetry={read.onRetry}
          />
        ),
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stat header (per-Park / per-Category) (R3.2, R4.2)
// ---------------------------------------------------------------------------

function StatHeader({
  title,
  breakdown,
  accentColor,
  icon,
  testID,
}: {
  readonly title: string;
  readonly breakdown: FriendStatsBreakdown;
  readonly accentColor?: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
}): JSX.Element {
  return (
    <Card
      {...(accentColor !== undefined ? { accentColor } : {})}
      {...(testID !== undefined ? { testID } : {})}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          {icon !== undefined ? (
            <Ionicons
              name={icon}
              size={16}
              color={accentColor ?? theme.color.primary}
              style={styles.cardIcon}
            />
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <Badge
          label={formatPercent(breakdown.percent)}
          color={accentColor ?? theme.color.primary}
        />
      </View>
      <Text style={styles.cardCounts}>
        {`${breakdown.completed} of ${breakdown.total}`}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Avatar (R2.2, R2.3, R2.5)
// ---------------------------------------------------------------------------

/**
 * The Friend's avatar image. On a load failure it swaps to the default
 * placeholder (R2.5).
 */
function AvatarImage({ uri }: { readonly uri: string }): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <AvatarPlaceholder />;
  return (
    <Image
      source={{ uri }}
      style={styles.avatar}
      testID="friend-avatar-image"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

function AvatarPlaceholder(): JSX.Element {
  return (
    <View style={styles.avatarPlaceholder} testID="friend-avatar-placeholder">
      <Ionicons name="person" size={36} color={theme.color.primary} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared loader + error + retry controls
// ---------------------------------------------------------------------------

function ModeLoader({ testID }: { readonly testID: string }): JSX.Element {
  return (
    <Card style={styles.card} testID={testID}>
      <ActivityIndicator color={theme.color.primary} />
    </Card>
  );
}

function SectionError({
  testID,
  onRetry,
}: {
  readonly testID: string;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.errorWrap}>
        <Ionicons
          name="cloud-offline-outline"
          size={22}
          color={theme.color.textSecondary}
        />
        <Text style={styles.errorText}>{ERROR_BODY}</Text>
        <PrimaryButton
          label="Retry"
          icon="refresh-outline"
          onPress={onRetry}
          testID={`${testID}-retry`}
          style={styles.retryBtn}
        />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the query failed with the owner-or-friend `profile_forbidden` denial. */
function isForbidden(error: ApiError | null): boolean {
  return error instanceof ApiError && error.code === 'profile_forbidden';
}

/**
 * Render a percent with exactly one decimal place (R2.1, R3.2, R4.2). The
 * server already rounds/caps; `toFixed(1)` is display-only so an integer
 * percent still shows its trailing decimal. Non-finite values fall back to
 * "0.0%".
 */
function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  profileName: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
    textAlign: 'center',
  },
  profileLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  profilePercent: {
    ...theme.typography.display,
    fontSize: 40,
    color: theme.color.primary,
  },
  profileCount: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingRight: theme.spacing.sm,
  },
  cardIcon: {
    marginRight: theme.spacing.sm,
  },
  cardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  cardCounts: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  errorWrap: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
    marginTop: theme.spacing.xs,
  },
});
