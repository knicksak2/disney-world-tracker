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
 *     driven by `useViewMode(['Overview','Coverage','Experiences','Compare'])`
 *     (R1.1, R1.3, R1.4, R1.5). The selector stays usable even while a
 *     non-forbidden read is in error, and switching modes never re-issues a
 *     read (the panes read from the already-cached query data) (R6.5, R7.6).
 *
 * Per-mode data dependencies and scoped states (R7.1, R7.3, R7.5):
 *
 *   - **Overview** — Profile read (name, avatar/placeholder), followed once the
 *     Stats read is ready by the redesigned overall-completion hero
 *     (`OverallHeroCard` over `stats.coverage.overall`, R2.*) and the Friend's
 *     ratings story rendered with the SAME shared `RatingsSection` as the
 *     Own_Surface, gated on the Friend's own `ratings.sufficient` and showing
 *     the neutral "Not enough ratings yet" copy when insufficient (R11.1,
 *     R11.2, R11.3). The percentile banner and the interests/facets section are
 *     omitted for the Friend_Surface (R10.6, R11.4).
 *   - **Coverage** — a segmented Lens_Switcher (Parks / Categories / Areas /
 *     Lands / Resorts) over the shared `CoverageSection`, driven purely by
 *     `stats.coverage` (R2.*, R3.*, R4.*).
 *   - **Experiences** — Completions, via the shared `ExperiencesList` (R5.*).
 *   - **Compare** — the Progress_Comparison: the viewer's and the Friend's
 *     overall / per-Park / per-Category percentages side by side, derived
 *     purely from the already-retrieved stats (R12.*).
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
 * Phase 3 foundation (task 23.1): alongside the three friend reads the screen
 * also mounts the viewer's OWN reads — `GET /me/stats` (via `useOwnStatsQuery`)
 * and the owner-path `GET /users/:ownId/completions` (via
 * `useOwnCompletionsQuery`). These warm the cache so the forthcoming
 * `Progress_Comparison` (task 24) and `Completion_Diff` (task 25) derive from
 * already-retrieved data rather than issuing fresh reads (R12.4, R13.5).
 *
 * Progress_Comparison (task 24.1): the Compare pane pairs the viewer's own
 * stats (`useOwnStatsQuery`) with the Friend's (`useFriendStatsQuery`) and
 * renders the overall, per-Park, and per-Category percentages side by side,
 * each labeled by owner and to one decimal in `[0.0, 100.0]` (R12.1–R12.3),
 * via the pure `deriveProgressComparison` helper (R12.4). It shows a loading
 * indication under 30 s (R12.5) and a comparison-unavailable message on
 * failure or timeout while the tab bar and other panes remain reachable, so
 * the rest of the profile stays visible (R12.6).
 *
 * Completion_Diff (task 25.1): below the comparison, the Compare pane renders
 * the Completion_Diff — the Friend-minus-viewer set difference by Experience
 * identity (the Experiences the Friend has completed that the viewer has not),
 * derived purely from the completions already retrieved on this screen
 * (`useOwnCompletionsQuery` + `useFriendCompletionsQuery`) via the
 * `deriveCompletionDiff` helper (R13.1, R13.5). Each entry shows name/Park/
 * Experience_Category and navigates to `ExperienceDetail` on selection (R13.2,
 * R13.3); it shows an empty-state when the diff is empty (R13.4), a loading
 * indication while the completions load (R13.6), a diff-unavailable message on
 * a failed read while keeping the rest of the profile visible (R13.7), and an
 * Experience-unavailable message for a diff entry whose Experience cannot be
 * retrieved (R13.8).
 *
 * The server already does the percentage math (rounding to one decimal,
 * capping at 100.0, zero-safe denominators); `formatComparisonPercent`
 * re-applies `toFixed(1)` purely so a whole-number percent still shows its
 * trailing decimal.
 *
 * Deep-link to Compare (task 26.1): the Friend_Profile_View accepts an optional
 * `initialSection: 'comparison'` navigation param. When a `Progress_Share` tap
 * in the Inbox passes it, the screen seeds `useViewMode` with a `['Compare']`
 * selection so it opens on the Compare pane (the Progress_Comparison) instead
 * of the default Overview (R14.1); when the param is absent the screen opens on
 * Overview as before. The view opens on Compare regardless of whether the
 * comparison data resolves, so ComparisonMode's own unavailable indication is
 * what surfaces when it cannot be retrieved (R14.4).
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2,
 * 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3,
 * 5.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5,
 * 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.1, 13.2, 13.3, 13.4, 13.6, 13.7, 13.8,
 * 14.1, 14.4, 14.6, 14.7
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import {
  type AvatarPresetId,
  type CompletionEntryDTO,
  type ProfileDTO,
} from '@dwt/shared';

import { ApiError } from '../../api/client';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import type { StatsResponse } from '../../api/friendProfile';
import {
  useFriendCompletionsQuery,
  useFriendProfileQuery,
  useFriendStatsQuery,
} from '../../hooks/useFriendProfile';
import { useOwnCompletionsQuery } from '../../hooks/useOwnCompletions';
import { useOwnStatsQuery } from '../../hooks/useOwnStats';
import {
  deriveProgressComparison,
  formatComparisonPercent,
} from './progressComparison';
import { deriveCompletionDiff } from './completionDiff';
import { theme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import {
  CoverageSection,
  OverallHeroCard,
  RatingsSection,
  type CoverageLens,
} from '../stats/components';
import { CompletionRow } from '../navigation/CompletionRow';
import { ExperiencesList } from '../navigation/ExperiencesList';
import {
  resolveExperienceTarget,
  useOpenExperience,
} from '../navigation/experienceNavigation';
import {
  FRIEND_PROFILE_TABS,
  TabSelector,
  type ProfileViewMode,
} from '../navigation/TabSelector';
import { useViewMode } from '../navigation/useViewMode';

// ---------------------------------------------------------------------------
// Coverage lens switcher config (mirrors CoverageDetailScreen, R5.1)
// ---------------------------------------------------------------------------

/** The five coverage lenses offered by the Coverage pane, in fixed order. */
const COVERAGE_LENSES: readonly CoverageLens[] = [
  'parks',
  'categories',
  'areas',
  'lands',
  'resorts',
];

const COVERAGE_LENS_LABELS: { readonly [lens in CoverageLens]: string } = {
  parks: 'Parks',
  categories: 'Categories',
  areas: 'Areas',
  lands: 'Lands',
  resorts: 'Resorts',
};

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

/**
 * Navigation params for the Friend_Profile_View. The friends list passes the
 * selected Friend's `friendId` (used to key all three reads) and
 * `displayName` (rendered immediately in the header so the screen has a
 * title before the Profile read resolves).
 *
 * `initialSection` (R14.1): an optional deep-link hint for the section that
 * should be initially visible. A `Progress_Share` tap in the Inbox passes
 * `'comparison'` so the screen opens on the Compare pane (the
 * Progress_Comparison) instead of the default Overview; when absent the screen
 * opens on Overview as before.
 */
export interface FriendProfileParams {
  readonly friendId: string;
  readonly displayName: string;
  readonly initialSection?: 'comparison';
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
  'Coverage',
  'Experiences',
  'Compare',
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
  const { friendId, displayName, initialSection } = route.params;

  const navigation = useNavigation();

  const profileQuery = useFriendProfileQuery(friendId);
  const statsQuery = useFriendStatsQuery(friendId);
  const completionsQuery = useFriendCompletionsQuery(friendId);

  // Phase 3 foundation (task 23.1): read the viewer's OWN stats and completions
  // alongside the friend reads above, so the Progress_Comparison (task 24) and
  // Completion_Diff (task 25) derive from data already retrieved on this
  // screen rather than issuing fresh reads at render time (R12.4, R13.5).
  //
  // `GET /me/stats` (own overall/per-Park/per-Category roll-up) and the
  // owner-path `GET /users/:ownId/completions` (own Completion_Entries) are
  // mounted here so both are in flight/cached alongside the friend reads. The
  // comparison and diff panes consume them via these same hooks — React Query
  // dedupes by key, so re-calling the hooks in those panes reads this warmed
  // cache instead of re-fetching. The Compare pane (task 24.1) consumes
  // `ownStatsQuery`; the Completion_Diff (task 25) will consume the completions.
  const ownStatsQuery = useOwnStatsQuery();
  const ownCompletionsQuery = useOwnCompletionsQuery();

  // R14.1: a `Progress_Share` tap in the Inbox deep-links here with
  // `initialSection: 'comparison'`, so the screen opens on the Compare pane
  // (the Progress_Comparison) instead of the default Overview. The seed is a
  // singleton `['Compare']` selection routed through `useViewMode`'s resolver,
  // which falls back to the default when the param is absent. Even if the
  // comparison data cannot be retrieved, the view still opens on Compare and
  // ComparisonMode surfaces its own unavailable indication (R14.4).
  const initialModes: readonly ProfileViewMode[] =
    initialSection === 'comparison' ? ['Compare'] : [];
  const { mode, select } = useViewMode(FRIEND_MODES, initialModes);

  // The active coverage lens for the Coverage pane. Hoisted to the screen so
  // the chosen lens persists across tab switches (a mode switch is a pure
  // re-render that unmounts the pane, so the state must live above it).
  const [coverageLens, setCoverageLens] =
    React.useState<CoverageLens>('parks');

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
            onOpenExperience={openExperience}
          />
        ) : null}

        {mode === 'Coverage' ? (
          <CoverageMode
            statsState={readState(statsQuery)}
            stats={statsQuery.data}
            onRetryStats={onRetryStats}
            lens={coverageLens}
            onSelectLens={setCoverageLens}
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

        {mode === 'Compare' ? (
          <>
            <ComparisonMode
              friendName={profileQuery.data?.displayName || displayName}
              viewerStats={ownStatsQuery.data}
              friendStats={statsQuery.data}
              viewerFailed={
                ownStatsQuery.isError && ownStatsQuery.data === undefined
              }
              friendFailed={statsQuery.isError && statsQuery.data === undefined}
            />
            <CompletionDiffSection
              friendName={profileQuery.data?.displayName || displayName}
              viewerState={readState(ownCompletionsQuery)}
              friendState={readState(completionsQuery)}
              viewerEntries={ownCompletionsQuery.data?.entries}
              friendEntries={completionsQuery.data?.entries}
              onOpenExperience={openExperience}
            />
          </>
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
  onOpenExperience,
}: {
  readonly fallbackName: string;
  readonly profileState: ReadState;
  readonly statsState: ReadState;
  readonly profile: ProfileDTO | undefined;
  readonly stats: StatsResponse | undefined;
  readonly onRetryProfile: () => void;
  readonly onRetryStats: () => void;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  return (
    <View testID="friend-mode-overview">
      {profileState === 'loading' ? (
        <ModeLoader testID="friend-profile-loading" />
      ) : profileState === 'error' || profile === undefined ? (
        <SectionError testID="friend-profile-error" onRetry={onRetryProfile} />
      ) : (
        <Card style={styles.profileCard} testID="friend-profile-summary">
          {profile.avatarPreset !== null ? (
            <AvatarPresetBadge preset={profile.avatarPreset} />
          ) : (
            <AvatarPlaceholder />
          )}
          <Text style={styles.profileName}>
            {profile.displayName || fallbackName}
          </Text>
        </Card>
      )}

      {/* Below the profile card: the redesigned hero + ratings, rendered with
          the SAME shared components as the Own_Surface once the Stats read is
          ready. Scoped to the Stats read so a slow/failed Stats read never
          blanks the profile card above (R14.7). The hero ring conveys overall
          completion (R2.*), so the old separate "overall count" text is gone.
          R11.1/R11.2/R11.3: the Friend's ratings story is gated internally on
          the Friend's own `ratings.sufficient`; when insufficient it shows the
          neutral "Not enough ratings yet" message (`emptyVariant="neutral"`)
          rather than the self-directed unlock call-to-action. The percentile
          banner and interests/facets section are deliberately omitted for the
          Friend_Surface (R10.6, R11.4). */}
      {statsState === 'loading' ? (
        <ModeLoader testID="friend-stats-loading" />
      ) : statsState === 'error' || stats === undefined ? (
        <SectionError testID="friend-stats-error" onRetry={onRetryStats} />
      ) : (
        <View style={styles.heroWrap} testID="friend-overview-stats">
          <OverallHeroCard overall={stats.coverage.overall} />
          <View style={styles.ratingsWrap} testID="friend-ratings">
            <RatingsSection
              ratings={stats.ratings}
              emptyVariant="neutral"
              onOpenExperience={onOpenExperience}
              testID="friend-ratings-section"
            />
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Coverage mode (replaces Parks + Categories) — the shared lens-driven
// `CoverageSection` behind a segmented Lens_Switcher (R2.*, R3.*, R4.*)
// ---------------------------------------------------------------------------

function CoverageMode({
  statsState,
  stats,
  onRetryStats,
  lens,
  onSelectLens,
}: {
  readonly statsState: ReadState;
  readonly stats: StatsResponse | undefined;
  readonly onRetryStats: () => void;
  readonly lens: CoverageLens;
  readonly onSelectLens: (lens: CoverageLens) => void;
}): JSX.Element {
  // Scope the pane to the Stats read: its own loading / error + retry, same as
  // the Overview stats block (R7.1, R7.3, R7.5).
  if (statsState === 'loading') {
    return (
      <View testID="friend-mode-coverage">
        <ModeLoader testID="friend-stats-loading" />
      </View>
    );
  }
  if (statsState === 'error' || stats === undefined) {
    return (
      <View testID="friend-mode-coverage">
        <SectionError testID="friend-stats-error" onRetry={onRetryStats} />
      </View>
    );
  }

  return (
    <View testID="friend-mode-coverage">
      {/* Lens_Switcher: a single segmented control styled identically to the
          Own_Surface Coverage detail screen — exactly one active, Parks
          default. */}
      <View style={styles.seg} testID="friend-coverage-lens-switcher">
        {COVERAGE_LENSES.map((option) => {
          const selected = lens === option;
          return (
            <Pressable
              key={option}
              onPress={() => onSelectLens(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`friend-coverage-lens-${option}`}
              style={[styles.segItem, selected && styles.segItemActive]}
            >
              <Text
                style={[styles.segText, selected && styles.segTextActive]}
                numberOfLines={1}
              >
                {COVERAGE_LENS_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Only the active lens is rendered, via the SHARED CoverageSection. */}
      <Card style={styles.lensCard}>
        <CoverageSection
          coverage={stats.coverage}
          lens={lens}
          testID={`friend-coverage-${lens}`}
        />
      </Card>
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
// Compare mode — Progress_Comparison (R12.*)
// ---------------------------------------------------------------------------

/**
 * The maximum time the Progress_Comparison waits for both parties' stats
 * before declaring the comparison unavailable (R12.5, R12.6). Measured from
 * when the Compare pane first mounts with data still outstanding.
 */
const COMPARISON_TIMEOUT_MS = 30_000;

/** The viewer's owner label in the side-by-side comparison (R12.1–R12.3). */
const VIEWER_OWNER_LABEL = 'You';

const COMPARISON_UNAVAILABLE_TITLE = 'Comparison unavailable';
const COMPARISON_UNAVAILABLE_BODY =
  'We couldn\u2019t load the completion comparison right now. The rest of this profile is still available.';

// ---------------------------------------------------------------------------
// Completion_Diff copy (R13.*)
// ---------------------------------------------------------------------------

/** Heading over the Completion_Diff section inside the Compare pane. */
const DIFF_HEADING = 'They\u2019ve done, you haven\u2019t';

const DIFF_EMPTY_TITLE = 'All caught up';
/** Trailing copy appended after the Friend's name in the empty state (R13.4). */
const DIFF_EMPTY_SUFFIX =
  ' \u2014 you\u2019ve completed every Experience they have.';

const DIFF_UNAVAILABLE_TITLE = 'List unavailable';
const DIFF_UNAVAILABLE_BODY =
  'We couldn\u2019t load the list of Experiences this friend has completed. The rest of this profile is still available.';

/** Per-entry fallback when a diff entry\u2019s Experience cannot be retrieved (R13.8). */
const DIFF_ENTRY_UNAVAILABLE = 'This experience is unavailable.';

/**
 * The Progress_Comparison pane (R12.1–R12.6). Renders the viewer's and the
 * Friend's overall, per-Park, and per-Experience_Category completion
 * percentages side by side, each labeled by owner and shown to one decimal in
 * `[0.0, 100.0]` (R12.1, R12.2, R12.3), derived purely from the stats already
 * retrieved on this screen (R12.4).
 *
 * States:
 *   - Both roll-ups ready → the derived side-by-side rows.
 *   - Either read failed, or neither resolved within
 *     `COMPARISON_TIMEOUT_MS` → a comparison-unavailable message; the tab bar
 *     and every other pane remain reachable, keeping the rest of the profile
 *     content visible (R12.6).
 *   - Otherwise (still loading, under the 30 s window) → a loading indication
 *     (R12.5).
 */
function ComparisonMode({
  friendName,
  viewerStats,
  friendStats,
  viewerFailed,
  friendFailed,
}: {
  readonly friendName: string;
  readonly viewerStats: StatsResponse | undefined;
  readonly friendStats: StatsResponse | undefined;
  readonly viewerFailed: boolean;
  readonly friendFailed: boolean;
}): JSX.Element {
  const bothReady = viewerStats !== undefined && friendStats !== undefined;
  const failed = viewerFailed || friendFailed;

  // R12.5/R12.6: cap the loading window at 30 s. The timer is only armed while
  // the comparison is genuinely pending (neither ready nor already failed), and
  // is cleared on resolution or unmount so it never fires after the pane leaves.
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (bothReady || failed) return undefined;
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, COMPARISON_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [bothReady, failed]);

  if (!bothReady) {
    // R12.6: failure or a >30 s wait surfaces the unavailable message while the
    // selector and other panes stay mounted (remaining content stays visible).
    if (failed || timedOut) {
      return (
        <View testID="friend-mode-compare">
          <Card style={styles.card} testID="friend-comparison-unavailable">
            <View style={styles.errorWrap}>
              <Ionicons
                name="cloud-offline-outline"
                size={22}
                color={theme.color.textSecondary}
              />
              <Text style={styles.comparisonUnavailableTitle}>
                {COMPARISON_UNAVAILABLE_TITLE}
              </Text>
              <Text style={styles.errorText}>{COMPARISON_UNAVAILABLE_BODY}</Text>
            </View>
          </Card>
        </View>
      );
    }
    // R12.5: still within the 30 s window with data outstanding.
    return (
      <View testID="friend-mode-compare">
        <ModeLoader testID="friend-comparison-loading" />
      </View>
    );
  }

  const comparison = deriveProgressComparison(viewerStats, friendStats);

  return (
    <View testID="friend-mode-compare">
      <ComparisonRowCard
        title="Overall"
        row={comparison.overall}
        friendName={friendName}
        testID="friend-comparison-overall"
      />

      <Text style={styles.comparisonGroupHeading}>By park</Text>
      {comparison.byPark.map((row) => (
        <ComparisonRowCard
          key={row.key}
          title={row.key}
          row={row}
          friendName={friendName}
          testID={`friend-comparison-park-${row.key}`}
        />
      ))}

      <Text style={styles.comparisonGroupHeading}>By category</Text>
      {comparison.byCategory.map((row) => (
        <ComparisonRowCard
          key={row.key}
          title={categoryLabel(row.key)}
          row={row}
          friendName={friendName}
          testID={`friend-comparison-category-${row.key}`}
        />
      ))}
    </View>
  );
}

/**
 * A single comparison dimension: the dimension label plus the viewer's and the
 * Friend's percentage side by side, each labeled by owner and rendered to one
 * decimal place (R12.1–R12.3).
 */
function ComparisonRowCard({
  title,
  row,
  friendName,
  testID,
}: {
  readonly title: string;
  readonly row: { readonly viewerPercent: number; readonly friendPercent: number };
  readonly friendName: string;
  readonly testID: string;
}): JSX.Element {
  return (
    <Card style={styles.card} testID={testID}>
      <Text style={styles.comparisonTitle}>{title}</Text>
      <View style={styles.comparisonRow}>
        <View style={styles.comparisonCell} testID={`${testID}-viewer`}>
          <Text style={styles.comparisonOwner}>{VIEWER_OWNER_LABEL}</Text>
          <Text style={styles.comparisonPercent}>
            {formatComparisonPercent(row.viewerPercent)}
          </Text>
        </View>
        <View style={styles.comparisonCell} testID={`${testID}-friend`}>
          <Text style={styles.comparisonOwner} numberOfLines={1}>
            {friendName}
          </Text>
          <Text style={styles.comparisonPercent}>
            {formatComparisonPercent(row.friendPercent)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/**
 * Map an `ExperienceCategory` key to its human display label, reusing the
 * theme's category visuals so the Compare pane matches the Categories pane.
 * Falls back to the raw key for any value without a visual.
 */
function categoryLabel(key: string): string {
  const visual = theme.categoryVisual[key as keyof typeof theme.categoryVisual];
  return visual?.label ?? key;
}

// ---------------------------------------------------------------------------
// Completion_Diff section (R13.*)
// ---------------------------------------------------------------------------

/**
 * The Completion_Diff section of the Compare pane (R13.1–R13.8). Renders the
 * Friend-minus-viewer set difference by Experience identity — the Experiences
 * the Friend has completed that the viewing User has not — derived purely from
 * the completions already retrieved on this screen (R13.5) via
 * `deriveCompletionDiff`.
 *
 * Each diff entry shows the Experience's name, Park, and Experience_Category
 * through the shared `CompletionRow` (with `fields="experiences"` so both Park
 * and Category appear) and navigates to `ExperienceDetail` on selection via the
 * screen's shared `openExperience` handler (R13.2, R13.3). A diff entry whose
 * Experience cannot be retrieved — i.e. it carries no usable navigation target
 * (`resolveExperienceTarget` returns `null`) — renders an
 * Experience-unavailable message instead of a dead, tappable row, keeping the
 * remaining entries visible (R13.8).
 *
 * States, each scoped to the two completions reads the diff derives from:
 *   - Either read still loading with no data → a loading indication (R13.6).
 *   - Either read failed with no data → a diff-unavailable message while the
 *     tab bar and other panes stay reachable (R13.7).
 *   - Both ready and the diff is empty → an empty-state indicating the viewer
 *     has completed every Experience the Friend has (R13.4).
 *   - Both ready and the diff is non-empty → the list of entries (R13.1).
 */
function CompletionDiffSection({
  friendName,
  viewerState,
  friendState,
  viewerEntries,
  friendEntries,
  onOpenExperience,
}: {
  readonly friendName: string;
  readonly viewerState: ReadState;
  readonly friendState: ReadState;
  readonly viewerEntries: readonly CompletionEntryDTO[] | undefined;
  readonly friendEntries: readonly CompletionEntryDTO[] | undefined;
  readonly onOpenExperience: (experienceId: string) => void;
}): JSX.Element {
  // R13.7: either completions read failed with no data → the diff is
  // unavailable. Checked before loading so a failed read never spins forever.
  if (viewerState === 'error' || friendState === 'error') {
    return (
      <View testID="friend-diff">
        <Text style={styles.comparisonGroupHeading}>{DIFF_HEADING}</Text>
        <Card style={styles.card} testID="friend-diff-unavailable">
          <View style={styles.errorWrap}>
            <Ionicons
              name="cloud-offline-outline"
              size={22}
              color={theme.color.textSecondary}
            />
            <Text style={styles.comparisonUnavailableTitle}>
              {DIFF_UNAVAILABLE_TITLE}
            </Text>
            <Text style={styles.errorText}>{DIFF_UNAVAILABLE_BODY}</Text>
          </View>
        </Card>
      </View>
    );
  }

  // R13.6: still resolving one or both completions reads.
  if (
    viewerState !== 'ready' ||
    friendState !== 'ready' ||
    viewerEntries === undefined ||
    friendEntries === undefined
  ) {
    return (
      <View testID="friend-diff">
        <Text style={styles.comparisonGroupHeading}>{DIFF_HEADING}</Text>
        <ModeLoader testID="friend-diff-loading" />
      </View>
    );
  }

  // R13.1/R13.5: pure Friend-minus-viewer set difference by Experience identity.
  const diff = deriveCompletionDiff(viewerEntries, friendEntries);

  // R13.4: empty diff → the viewer has completed everything the Friend has.
  if (diff.length === 0) {
    return (
      <View testID="friend-diff">
        <Text style={styles.comparisonGroupHeading}>{DIFF_HEADING}</Text>
        <View testID="friend-diff-empty">
          <EmptyState
            icon="checkmark-done-outline"
            title={DIFF_EMPTY_TITLE}
            body={`${friendName}${DIFF_EMPTY_SUFFIX}`}
          />
        </View>
      </View>
    );
  }

  // R13.2/R13.3/R13.8: each entry shows name/Park/Category and navigates to
  // ExperienceDetail; an entry with no retrievable Experience shows the
  // Experience-unavailable message instead of a dead, tappable row.
  return (
    <View testID="friend-diff">
      <Text style={styles.comparisonGroupHeading}>{DIFF_HEADING}</Text>
      {diff.map((entry, index) =>
        resolveExperienceTarget(entry) === null ? (
          <Card
            key={`diff-unavailable-${index}`}
            style={styles.card}
            testID={`friend-diff-entry-unavailable-${index}`}
          >
            <Text style={styles.cardTitle}>{entry.experienceName}</Text>
            <Text style={styles.errorText}>{DIFF_ENTRY_UNAVAILABLE}</Text>
          </Card>
        ) : (
          <CompletionRow
            key={`${entry.experienceId}-${index}`}
            entry={entry}
            fields="experiences"
            onOpenExperience={onOpenExperience}
            testID={`friend-diff-row-${index}`}
          />
        ),
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar (R2.2, R2.3, R2.5)
// ---------------------------------------------------------------------------

/**
 * The Friend's avatar, rendered from their chosen preset id. Falls back to the
 * placeholder if the id is unknown (e.g. a preset removed after they chose it),
 * so a stale reference degrades gracefully rather than crashing (R2.5).
 */
function AvatarPresetBadge({
  preset,
}: {
  readonly preset: AvatarPresetId;
}): JSX.Element {
  const art = renderAvatarPreset(preset, 80);
  if (art === null) return <AvatarPlaceholder />;
  return (
    <View style={styles.avatar} testID="friend-avatar-image">
      {art}
    </View>
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
  heroWrap: {
    gap: theme.spacing.md,
  },
  ratingsWrap: {
    marginTop: theme.spacing.md,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  cardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  // Coverage Lens_Switcher — mirrors CoverageDetailScreen's segmented control.
  seg: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 4,
    gap: 2,
    marginBottom: theme.spacing.md,
  },
  segItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: theme.radius.sm,
  },
  segItemActive: {
    backgroundColor: theme.color.surface,
    ...theme.shadow.card,
  },
  segText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  segTextActive: {
    color: theme.color.primary,
  },
  lensCard: {
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
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
  // Compare mode (Progress_Comparison, R12.*)
  comparisonGroupHeading: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  comparisonTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  comparisonRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  comparisonCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  comparisonOwner: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  comparisonPercent: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  comparisonUnavailableTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    textAlign: 'center',
  },
});
