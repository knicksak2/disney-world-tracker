// Feature: trips, Task 17.11 — Planned_List section
//
// Validates: Requirements 18.1, 18.6, 9.1, 9.6, 9.7, 9.9
//
// Behavior summary:
//   - This is the Planned_List section of the Trip_Detail_View hub (the
//     `TripPlannedList` route, R18.1/R18.6). It reads
//     `GET /trips/:id/planned-items` (returning `PlannedItemDTO[]`) and renders
//     each entry with its referenced Experience name, the Experience's Park,
//     and the display name of the Trip_Member who added it (R9.9). Membership
//     is enforced server-side; a non-member / missing Trip collapses to the
//     same `trip_forbidden` response, surfaced as an error with Retry (R15.2).
//   - Any Trip_Member can add an Experience to the Planned_List (R9.1) via
//     `POST /trips/:id/planned-items` with `{ experienceId }`, validated by the
//     shared `plannedItemAddSchema` before it is sent. The server enforces
//     Catalog existence, the no-duplicate rule, and the 500-item limit
//     (R9.3–R9.5), so those are surfaced as friendly copy.
//   - A remove control is offered on each item via
//     `DELETE /trips/:id/planned-items/:itemId`. Removal is authorized
//     server-side to the adder or any Organizer (R9.6–R9.8); the DTO does not
//     carry the adder's id, so the control is shown on every item and an
//     unauthorized attempt is surfaced as a friendly `trip_forbidden` message
//     rather than hidden — the server is the authority.
//
// Styling follows the shared "Magical / Whimsical" theme, mirroring the
// Trip_Activity feed (compact gradient header, themed cards/inputs/buttons).

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import {
  completedExperienceIdsFromFeed,
  derivePlannedListPresentation,
  plannedItemAddSchema,
  type ExperienceDTO,
  type PlannedItemDTO,
  type PlannedItemView,
  type TripFeedItemDTO,
  type TripMemberDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { ExperiencePicker } from './ExperiencePicker';
import {
  LogComposerModal,
  tripFeedKeys,
  type PickedExperience,
} from './TripFeedScreen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripPlannedList'>;

/** Wire shape of `GET /trips/:id/planned-items`: the Planned_List (R9.9). */
type PlannedItemsResponse = readonly PlannedItemDTO[];

/** Wire shape of `GET /trips/:id/feed`: the Trip_Activity feed items. */
type TripFeedResponse = readonly TripFeedItemDTO[];

/** Wire shape of `GET /me`: the caller's identity (to exclude self, R10.5). */
interface MeResponse {
  readonly user: { readonly id: string };
}

/** Wire shape of `GET /trips/:id/members`: the Trip's current Members. */
type TripMembersResponse = readonly TripMemberDTO[];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for the Planned_List read; scoped per Trip. */
export const tripPlannedListKeys = {
  items: (tripId: string) => ['trips', 'planned-items', tripId] as const,
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripPlannedListScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const itemsQuery = useQuery<PlannedItemsResponse, ApiError>({
    queryKey: tripPlannedListKeys.items(tripId),
    queryFn: () =>
      apiRequest<PlannedItemsResponse>('GET', `/trips/${tripId}/planned-items`),
  });

  // The Trip_Activity feed drives the derived completion state. It shares the
  // `Trip_Activity` query key, so a completion logged from either surface warms
  // the same cache and both refresh together (R2.4, R2.5, R6.3). A failed/not
  // yet loaded feed yields `null` below, so completion fails safe to `not_done`
  // with a non-blocking indication rather than ever showing `done` from
  // unavailable data (R2.7).
  const feedQuery = useQuery<TripFeedResponse, ApiError>({
    queryKey: tripFeedKeys.feed(tripId),
    queryFn: () =>
      apiRequest<TripFeedResponse>('GET', `/trips/${tripId}/feed`),
    retry: false,
  });

  // The caller's own id (to exclude the logging Member from the rode-with
  // picker, R10.5) and the Trip's current Members (the only Users the picker
  // may tag, R10.4), so the reused Log_Composer behaves exactly as it does on
  // the Trip_Activity surface.
  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });
  const membersQuery = useQuery<TripMembersResponse, ApiError>({
    queryKey: tripFeedKeys.members(tripId),
    queryFn: () =>
      apiRequest<TripMembersResponse>('GET', `/trips/${tripId}/members`),
  });

  const [composerVisible, setComposerVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The Planned_Item whose Log_Composer is open, or `null` when closed. Opening
  // it pre-fills that item's Experience (R1.2); it is available on every item,
  // done or not (R1.5).
  const [loggingItem, setLoggingItem] = useState<PlannedItemView | null>(null);

  const ownUserId = meQuery.data?.user.id ?? null;
  const candidates = useMemo<readonly TripMemberDTO[]>(() => {
    const members = membersQuery.data ?? [];
    return members.filter((m) => m.userId !== ownUserId);
  }, [membersQuery.data, ownUserId]);

  const invalidateItems = (): void => {
    void queryClient.invalidateQueries({
      queryKey: tripPlannedListKeys.items(tripId),
    });
  };

  // After logging from a Planned_Item, refresh both the planned list and the
  // Trip_Activity feed so the derived completion state re-computes and the item
  // moves into the Done_Section on the next render (R2.4).
  const invalidateActivity = (): void => {
    invalidateItems();
    void queryClient.invalidateQueries({
      queryKey: tripFeedKeys.feed(tripId),
    });
  };

  const removeMutation = useMutation<void, ApiError, string>({
    mutationFn: async (itemId) => {
      await apiRequest<void>(
        'DELETE',
        `/trips/${tripId}/planned-items/${itemId}`,
      );
    },
    onSuccess: () => {
      setActionError(null);
      invalidateItems();
    },
    onError: (err) => {
      setActionError(removeErrorMessage(err));
    },
  });

  const backToHub = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripDetail', { tripId });
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (itemsQuery.isLoading && itemsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <PlannedHeader onBack={backToHub} />
        <View style={styles.center} testID="planned-list-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Load error (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (itemsQuery.isError && itemsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <PlannedHeader onBack={backToHub} />
        <View style={styles.center} testID="planned-list-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load the planned list"
            body={readErrorMessage(itemsQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void itemsQuery.refetch();
            }}
            testID="planned-list-retry"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const items = itemsQuery.data ?? [];

  // Derive completion state, the Done / not-done partition, and progress purely
  // from the two already-loaded collections (R2, R3, R4, R6.3). A feed that
  // failed or has not loaded yields a `null` completed set, so every item is
  // `not_done` and `completionAvailable === false` — never a `done` badge from
  // unavailable data (R2.7).
  const completedExperienceIds = completedExperienceIdsFromFeed(
    feedQuery.data ?? null,
  );
  const presentation = derivePlannedListPresentation(
    items,
    completedExperienceIds,
  );
  const { doneSection, notDoneSection, progress, completionAvailable } =
    presentation;

  // Map each completed Experience to its most recent completion feed item so a
  // Completed_Planned_Item can show that completion's live canonical Rating —
  // referenced, never copied (R6.5). The feed is reverse-chronological, so the
  // first match wins.
  const completionByExperience = new Map<string, TripFeedItemDTO>();
  for (const feedItem of feedQuery.data ?? []) {
    if (feedItem.type !== 'completion_logged') continue;
    const experienceId = feedItem.metadata['experienceId'];
    if (typeof experienceId === 'string' && !completionByExperience.has(experienceId)) {
      completionByExperience.set(experienceId, feedItem);
    }
  }

  const openLogComposer = (item: PlannedItemView): void => {
    setActionError(null);
    setLoggingItem(item);
  };

  const onRemove = (item: PlannedItemView): void => {
    if (removeMutation.isPending) return;
    setActionError(null);
    removeMutation.mutate(item.id);
  };

  const prefill: PickedExperience | null =
    loggingItem !== null
      ? {
          id: loggingItem.experienceId,
          name: loggingItem.experienceName,
          park: loggingItem.park,
        }
      : null;

  return (
    <ScreenContainer>
      <PlannedHeader
        onBack={backToHub}
        right={
          <PrimaryButton
            label="Add"
            icon="add-outline"
            onPress={() => {
              setActionError(null);
              setComposerVisible(true);
            }}
            testID="planned-list-add-open"
          />
        }
      />

      {/* Planned_List_Progress: completed-of-total, `0 of 0` for an empty list
          (R4.1, R4.4). */}
      <View style={styles.progressRow}>
        <View style={styles.progressBadge} testID="planned-list-progress">
          <Ionicons
            name="checkmark-done-outline"
            size={16}
            color={theme.color.primary}
          />
          <Text style={styles.progressText}>
            {progress.completed} of {progress.total} completed
          </Text>
        </View>
      </View>

      {/* Feed unavailable: completion could not be determined. Every item stays
          `not_done` (no `done` badge) and we offer a retry (R2.7). */}
      {!completionAvailable ? (
        <View style={styles.undetermined} testID="planned-list-completion-undetermined">
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={theme.color.warningText}
          />
          <Text style={styles.undeterminedText}>
            We couldn't determine what's been completed yet.
          </Text>
          <SecondaryButton
            label="Retry"
            onPress={() => {
              void feedQuery.refetch();
            }}
            testID="planned-list-completion-retry"
          />
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.center} testID="planned-list-empty">
          <EmptyState
            icon="list-outline"
            title="Nothing planned yet"
            body="Add the Experiences your group wants to do together and they'll show up here."
          />
          <PrimaryButton
            label="Add an experience"
            icon="add-circle-outline"
            onPress={() => {
              setActionError(null);
              setComposerVisible(true);
            }}
            testID="planned-list-empty-add"
            style={styles.actionBtn}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} testID="planned-list">
          {actionError !== null ? (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              testID="planned-list-action-error"
            >
              {actionError}
            </Text>
          ) : null}

          {/* not_done items, outside the Done_Section (R3.2). */}
          {notDoneSection.map((item) => (
            <PlannedItemCard
              key={item.id}
              item={item}
              rating={null}
              onLog={openLogComposer}
              onRemove={onRemove}
            />
          ))}

          {/* Done_Section: the Completed_Planned_Items (R3.1, R3.2). */}
          {doneSection.length > 0 ? (
            <View style={styles.doneSection} testID="planned-list-done-section">
              <Text style={styles.doneHeading}>
                Done ({doneSection.length})
              </Text>
              {doneSection.map((item) => (
                <PlannedItemCard
                  key={item.id}
                  item={item}
                  rating={ratingFor(
                    completionByExperience.get(item.experienceId),
                  )}
                  onLog={openLogComposer}
                  onRemove={onRemove}
                />
              ))}
            </View>
          ) : null}

          {removeMutation.isPending ? (
            <ActivityIndicator
              color={theme.color.primary}
              style={styles.busy}
              testID="planned-list-busy"
            />
          ) : null}
        </ScrollView>
      )}

      <AddItemModal
        visible={composerVisible}
        tripId={tripId}
        onClose={() => {
          setComposerVisible(false);
        }}
        onAdded={() => {
          setComposerVisible(false);
          invalidateItems();
        }}
      />

      {/* The Planned_Item_Log_Control opens the SAME composer hosted in
          TripFeedScreen, pre-filled with the item's Experience, submitting the
          unchanged `POST /trips/:id/log-entries` (R1.2, R1.3, R1.4). Keyed by
          Experience so switching items opens a fresh, correctly pre-filled
          composer. */}
      <LogComposerModal
        key={loggingItem?.id ?? 'none'}
        visible={loggingItem !== null}
        tripId={tripId}
        candidates={candidates}
        initialExperience={prefill}
        onClose={() => {
          setLoggingItem(null);
        }}
        onLogged={() => {
          setLoggingItem(null);
          invalidateActivity();
        }}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Planned_Item card — completed indicator, attribution, log + remove controls
// ---------------------------------------------------------------------------

/**
 * One Planned_Item row. A `done` item carries a visually distinct completed
 * indicator and its live canonical Rating (R3.1, R6.5–R6.6); every item — done
 * or not — offers the Planned_Item_Log_Control (R1.1, R1.5) and the existing
 * remove control. The adder attribution falls back to an "unavailable" label
 * rather than being omitted when the display name can't be resolved (R3.4).
 */
function PlannedItemCard({
  item,
  rating,
  onLog,
  onRemove,
}: {
  readonly item: PlannedItemView;
  readonly rating: number | null;
  readonly onLog: (item: PlannedItemView) => void;
  readonly onRemove: (item: PlannedItemView) => void;
}): JSX.Element {
  const done = item.completionState === 'done';
  const adderName = item.addedByDisplayName.trim();
  const attribution =
    adderName.length > 0
      ? `Added by ${adderName}`
      : 'Added by a member who is no longer available (unavailable)';

  return (
    <Card
      style={[styles.itemCard, done && styles.itemCardDone]}
      testID={`planned-item-${item.id}`}
    >
      <View style={styles.itemRow}>
        <View style={styles.itemText}>
          {done ? (
            <View
              style={styles.completedIndicator}
              testID={`planned-item-completed-${item.id}`}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={theme.color.success}
              />
              <Text style={styles.completedText}>Completed</Text>
            </View>
          ) : null}
          <Text style={styles.itemName} numberOfLines={2}>
            {item.experienceName}
          </Text>
          <Badge label={item.park} color={theme.color.primary} />
          <Text style={styles.itemMeta}>{attribution}</Text>
          {done ? (
            rating !== null ? (
              <View
                style={styles.ratingPill}
                testID={`planned-item-rating-${item.id}`}
              >
                <Ionicons name="star" size={12} color={theme.color.accentDark} />
                <Text style={styles.ratingText}>{rating}/10</Text>
              </View>
            ) : (
              <Text
                style={styles.itemMeta}
                testID={`planned-item-unrated-${item.id}`}
              >
                Not rated
              </Text>
            )
          ) : null}
        </View>

        <View style={styles.itemActions}>
          <Ionicons
            name="add-circle-outline"
            size={22}
            color={theme.color.primary}
            onPress={() => onLog(item)}
            accessibilityRole="button"
            accessibilityLabel={`Log a completion for ${item.experienceName}`}
            testID={`planned-item-log-${item.id}`}
          />
          <Ionicons
            name="trash-outline"
            size={20}
            color={theme.color.danger}
            onPress={() => onRemove(item)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.experienceName}`}
            testID={`planned-item-remove-${item.id}`}
          />
        </View>
      </View>
    </Card>
  );
}

/**
 * Read the live canonical Rating folded into a completion feed item's metadata,
 * or `null` when absent/unresolved — no placeholder Rating is substituted
 * (R6.6).
 */
function ratingFor(feedItem: TripFeedItemDTO | undefined): number | null {
  if (feedItem === undefined) return null;
  const value = feedItem.metadata['rating'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Add-item modal
// ---------------------------------------------------------------------------

function AddItemModal({
  visible,
  tripId,
  onClose,
  onAdded,
}: {
  readonly visible: boolean;
  readonly tripId: string;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  // The Experience currently being added, so the picker can show a per-row
  // spinner and block a second tap while the POST is in flight.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const resetForm = (): void => {
    setError(null);
    setPendingId(null);
  };

  const addMutation = useMutation<void, ApiError, ExperienceDTO>({
    mutationFn: async (experience) => {
      // The id comes from the tapped row, so it always satisfies the shared
      // schema; validating keeps the client and server contract in lock-step.
      // Catalog existence, duplicates, and the 500-item limit stay server-side
      // authoritative (R9.3–R9.5).
      const parsed = plannedItemAddSchema.safeParse({
        experienceId: experience.id,
      });
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: 'trip_validation_failed',
          status: 400,
        });
      }
      await apiRequest<void>(
        'POST',
        `/trips/${tripId}/planned-items`,
        parsed.data,
      );
    },
    onSuccess: () => {
      resetForm();
      onAdded();
    },
    onError: (err) => {
      setPendingId(null);
      setError(addErrorMessage(err));
    },
  });

  const busy = addMutation.isPending;

  const closeAndReset = (): void => {
    if (busy) return;
    resetForm();
    onClose();
  };

  const onSelect = (experience: ExperienceDTO): void => {
    // An Experience may be added to the Planned_List more than once (R9.3), so
    // there is no already-planned guard here; the server accepts the duplicate.
    if (busy) return;
    setError(null);
    setPendingId(experience.id);
    addMutation.mutate(experience);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeAndReset}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="planned-list-composer">
          <Text style={styles.modalTitle}>Add to the planned list</Text>
          <Text style={styles.label}>Search experiences</Text>

          {error !== null ? (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              testID="planned-list-composer-error"
            >
              {error}
            </Text>
          ) : null}

          <ExperiencePicker
            enabled={visible}
            onSelect={onSelect}
            pendingId={pendingId}
            busy={busy}
            testIDPrefix="planned-list"
          />

          <SecondaryButton
            label="Cancel"
            onPress={closeAndReset}
            disabled={busy}
            testID="planned-list-cancel"
            style={styles.cancelBtn}
          />
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Shared compact header for every state of the Planned_List screen. */
function PlannedHeader({
  onBack,
  right,
}: {
  readonly onBack: () => void;
  readonly right?: React.ReactNode;
}): JSX.Element {
  return (
    <GradientHeader
      title="Planned List"
      subtitle="Experiences the group wants to do together."
      icon="list"
      compact
      onBack={onBack}
      right={right}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a read error to user-facing copy (non-disclosure, R15.2). */
function readErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map an add error to user-facing copy. */
function addErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'trip_validation_failed':
      return 'That Experience is invalid, already planned, or the list is full (max 500).';
    case 'trip_forbidden':
      return 'You need to be on this trip to add to its planned list.';
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map a remove error to user-facing copy. */
function removeErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'trip_forbidden':
      return 'Only the person who added it or an organizer can remove it.';
    case 'trip_not_found':
      return 'That item is no longer on the planned list.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
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
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  actionBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  itemCard: {
    marginBottom: 0,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  itemText: {
    flexShrink: 1,
    flexGrow: 1,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  itemName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  itemMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  itemActions: {
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  itemCardDone: {
    backgroundColor: 'rgba(46, 158, 107, 0.08)',
    borderColor: theme.color.success,
    borderWidth: 1,
  },
  completedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  completedText: {
    ...theme.typography.meta,
    color: theme.color.success,
    fontWeight: '700',
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    ...theme.typography.meta,
    color: theme.color.accentDark,
    fontWeight: '600',
  },
  progressRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    alignItems: 'flex-start',
  },
  progressBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  progressText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '600',
  },
  undetermined: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.warningSurface,
  },
  undeterminedText: {
    ...theme.typography.meta,
    color: theme.color.warningText,
    flexShrink: 1,
    flexGrow: 1,
  },
  doneSection: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  doneHeading: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
  },
  busy: {
    alignSelf: 'center',
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    ...theme.shadow.floating,
  },
  modalTitle: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  cancelBtn: {
    marginTop: theme.spacing.md,
  },
});
