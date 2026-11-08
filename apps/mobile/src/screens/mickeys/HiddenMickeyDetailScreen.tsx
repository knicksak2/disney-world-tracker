import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type {
  LogTripRef,
  MickeyDifficulty,
  MickeyReportReason,
  TripDTO,
  TripStatus,
} from '@dwt/shared';
import {
  MICKEY_REPORT_REASON_LABELS,
  MICKEY_REPORT_REASONS,
  preselectTripId,
} from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  useMickeyDetail,
  useMickeyFind,
  useMickeyHint,
  useMickeyReport,
  useMickeyUndoFind,
  useMickeyVote,
} from './api';
import {
  DIFFICULTY_DOTS_MAP,
  ZONE_ICON_MAP,
  formatAreaSubtitle,
  stepProgressLabel,
} from './mickeyViewModel';
import { apiRequest } from '../../api/client';
import { theme, withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'HiddenMickeyDetail'>;
type ScreenRouteProp = RouteProp<RootStackParamList, 'HiddenMickeyDetail'>;

type TripsListResponse = readonly {
  status: TripStatus;
  trips: readonly TripDTO[];
}[];

function activeTripsOf(data: TripsListResponse | undefined): readonly LogTripRef[] {
  if (!Array.isArray(data)) return [];
  const active: readonly TripDTO[] = data.find((g) => g.status === 'active')?.trips ?? [];
  return active.map(
    (t: TripDTO): LogTripRef => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
    }),
  );
}

export default function HiddenMickeyDetailScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const { mickeyId } = route.params;
  const styles = useStyles();
  const t = useAppTheme();

  const { data: mickey, isLoading, isError } = useMickeyDetail(mickeyId);
  const hintMutation = useMickeyHint();
  const findMutation = useMickeyFind();
  const undoMutation = useMickeyUndoFind();
  const voteMutation = useMickeyVote();
  const reportMutation = useMickeyReport();

  // Trips for trip chip
  const tripsQuery = useQuery<TripsListResponse>({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
  });

  const activeTrips = useMemo(() => activeTripsOf(tripsQuery.data), [tripsQuery.data]);

  // Today in WDW America/New_York
  const todayWdw = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }, []);

  const defaultTripId = useMemo(() => {
    return preselectTripId(activeTrips, todayWdw);
  }, [activeTrips, todayWdw]);

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [hasChangedTrip, setHasChangedTrip] = useState(false);

  // Active trip ID in state or defaulted
  const activeTripSelection = hasChangedTrip
    ? selectedTripId
    : (mickey?.tripId ?? defaultTripId);

  // Report modal state
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [selectedReportReason, setSelectedReportReason] =
    useState<MickeyReportReason>('not_a_mickey');
  const [reportNote, setReportNote] = useState('');

  // Optimistic vote state
  const [optimisticVote, setOptimisticVote] = useState<'there' | 'gone' | null>(null);

  useEffect(() => {
    if (mickey?.userVote !== undefined) {
      setOptimisticVote(mickey.userVote);
    }
  }, [mickey?.userVote]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={t.color.primary} />
      </View>
    );
  }

  if (isError || !mickey) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Hidden Mickey not found</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.backBtnPill}
        >
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const currentVote = optimisticVote !== null ? optimisticVote : (mickey.userVote ?? null);
  const heroAccentColor =
    mickey.park && t.parkAccent[mickey.park] ? t.parkAccent[mickey.park] : t.resortVisual.tint;
  const zoneIconName = (ZONE_ICON_MAP[mickey.zone] ?? 'location-outline') as keyof typeof Ionicons.glyphMap;

  const difficultyTone = (difficulty: MickeyDifficulty) => {
    if (difficulty === 'easy') {
      return { bg: withAlpha(t.color.success, 0.15), fg: t.color.success };
    }
    if (difficulty === 'hard') {
      return { bg: withAlpha(t.color.danger, 0.15), fg: t.color.danger };
    }
    return { bg: t.color.warningSurface, fg: t.color.warningText };
  };
  const diffColors = difficultyTone(mickey.difficulty);

  const step2Unlocked = Boolean(mickey.clue2) || mickey.hintLevel >= 2 || mickey.found;
  const step3Unlocked = Boolean(mickey.reveal) || mickey.hintLevel >= 3 || mickey.found;
  const trailStatusText = stepProgressLabel(mickey);

  const handleRequestHint = async (level: 2 | 3) => {
    try {
      await hintMutation.mutateAsync({ mickeyId: mickey.id, level });
    } catch {
      Alert.alert('Error', 'Failed to retrieve hint. Please try again.');
    }
  };

  const handleFind = async () => {
    try {
      await findMutation.mutateAsync({
        mickeyId: mickey.id,
        tripId: activeTripSelection ?? undefined,
      });
    } catch {
      Alert.alert('Error', 'Failed to record find. Please try again.');
    }
  };

  const handleUndo = async () => {
    try {
      await undoMutation.mutateAsync({ mickeyId: mickey.id });
    } catch {
      Alert.alert('Error', 'Failed to undo find. Please try again.');
    }
  };

  const handleVote = async (vote: 'there' | 'gone') => {
    setOptimisticVote(vote);
    try {
      await voteMutation.mutateAsync({ mickeyId: mickey.id, vote });
    } catch {
      setOptimisticVote(mickey.userVote ?? null);
      Alert.alert('Error', 'Failed to record vote. Please try again.');
    }
  };

  const executeSubmitReport = async () => {
    try {
      await reportMutation.mutateAsync({
        mickeyId: mickey.id,
        reason: selectedReportReason,
        note: reportNote.trim() ? reportNote.trim() : undefined,
      });
      setReportModalVisible(false);
      Alert.alert('Report Submitted', 'Thank you. The report has been received.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    }
  };

  const handleSubmitReport = () => {
    Alert.alert(
      'Report & Hide Mickey?',
      'Are you sure? This entry will be submitted for review and permanently removed from your hunt.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report & Hide',
          style: 'destructive',
          onPress: () => void executeSubmitReport(),
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={t.color.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {mickey.experienceName}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report Hidden Mickey"
          onPress={() => setReportModalVisible(true)}
          style={styles.reportIconBtn}
        >
          <Ionicons name="flag-outline" size={20} color={t.color.danger} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero Experience & Location Card */}
        <View style={styles.sectionCard}>
          <View style={[styles.heroAccentBar, { backgroundColor: heroAccentColor }]} />

          <View style={styles.heroTopRow}>
            <Text style={styles.cardParkText}>{formatAreaSubtitle(mickey)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View venue details"
              testID="view-venue-button"
              style={styles.viewVenueLink}
              onPress={() =>
                navigation.navigate('ExperienceDetail', { experienceId: mickey.experienceId })
              }
            >
              <Text style={styles.viewVenueLinkText}>View Venue</Text>
              <Ionicons name="arrow-forward" size={12} color={t.color.primaryFg} />
            </Pressable>
          </View>

          <Text style={styles.heroVenueTitle}>{mickey.experienceName}</Text>

          {/* Badges Row */}
          <View style={styles.badgesRow}>
            <View style={styles.badgePill}>
              <Ionicons name={zoneIconName} size={11} color={t.color.textSecondary} />
              <Text style={styles.badgePillText}>{mickey.zone.replace('_', ' ')}</Text>
            </View>
            <View style={[styles.badgePill, { backgroundColor: diffColors.bg }]}>
              <Text style={[styles.difficultyDots, { color: diffColors.fg }]}>
                {DIFFICULTY_DOTS_MAP[mickey.difficulty]}
              </Text>
              <Text style={[styles.badgePillText, { color: diffColors.fg, fontWeight: '700' }]}>
                {mickey.difficulty}
              </Text>
            </View>
            {!mickey.official && (
              <View style={styles.communityBadge}>
                <Ionicons name="people" size={12} color={t.color.textSecondary} />
                <Text style={styles.communityBadgeText}>Community</Text>
              </View>
            )}
            {mickey.communityVerified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={12} color={t.color.primaryFg} />
                <Text style={styles.verifiedBadgeText}>Community verified</Text>
              </View>
            )}
            <View
              style={[
                styles.confidenceBadge,
                mickey.confidenceLabel === 'possibly_removed' && styles.confidenceBadgeWarning,
              ]}
              accessibilityLabel={`Confidence: ${mickey.confidenceLabel}`}
            >
              {mickey.confidenceLabel === 'possibly_removed' ? (
                <Ionicons name="warning" size={12} color={t.color.warningText} />
              ) : (
                <Ionicons name="checkmark-circle" size={12} color={t.color.success} />
              )}
              <Text
                style={[
                  styles.confidenceText,
                  mickey.confidenceLabel === 'possibly_removed' && styles.confidenceTextWarning,
                ]}
              >
                {mickey.confidenceLabel === 'possibly_removed'
                  ? 'Possibly removed'
                  : mickey.confidenceLabel === 'uncertain'
                    ? 'Uncertain'
                    : 'Confirmed'}
              </Text>
            </View>
          </View>

          {mickey.friendsFoundCount > 0 && (
            <View style={styles.friendsFoundRow}>
              <Ionicons name="people-circle" size={16} color={t.color.primaryFg} />
              <Text style={styles.friendsFoundText}>
                {mickey.friendsFoundCount}{' '}
                {mickey.friendsFoundCount === 1 ? 'friend found' : 'friends found'} this!
              </Text>
            </View>
          )}
        </View>

        {/* Connected 3-Step Progressive Hint Trail */}
        <View style={styles.trailCard} testID="progressive-hint-trail">
          <View style={styles.trailHeaderRow}>
            <Text style={styles.trailTitle}>PROGRESSIVE HINT TRAIL</Text>
            <View style={styles.trailBadgePill}>
              <Text style={styles.trailBadgeText}>{trailStatusText}</Text>
            </View>
          </View>

          {/* Step 1: Clue 1 */}
          <View style={styles.trailStepRow}>
            <View style={styles.trailRailCol}>
              <View style={[styles.stepNode, styles.stepNodeUnlocked]}>
                <Text style={styles.stepNodeTextActive}>1</Text>
              </View>
              <View
                style={[styles.stepConnector, step2Unlocked && styles.stepConnectorUnlocked]}
              />
            </View>
            <View style={styles.stepContentBox}>
              <Text style={styles.cardLabel}>STEP 1 • WHERE TO LOOK</Text>
              <Text style={styles.clueBodyText}>{mickey.clue1}</Text>
            </View>
          </View>

          {/* Step 2: Clue 2 (Closer Hint) */}
          <View style={styles.trailStepRow}>
            <View style={styles.trailRailCol}>
              <View style={[styles.stepNode, step2Unlocked && styles.stepNodeUnlocked]}>
                <Text style={step2Unlocked ? styles.stepNodeTextActive : styles.stepNodeText}>
                  2
                </Text>
              </View>
              <View
                style={[styles.stepConnector, step3Unlocked && styles.stepConnectorUnlocked]}
              />
            </View>
            <View style={styles.stepContentBox}>
              <Text style={styles.cardLabel}>STEP 2 • CLOSER HINT</Text>
              {mickey.clue2 ? (
                <Text style={styles.clueBodyText}>{mickey.clue2}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Need a hint?"
                  style={styles.hintButton}
                  onPress={() => handleRequestHint(2)}
                  disabled={hintMutation.isPending}
                >
                  <Ionicons name="bulb-outline" size={18} color={t.color.primaryFg} />
                  <Text style={styles.hintButtonText}>Need a hint?</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Step 3: Exact Location (Reveal) */}
          <View style={styles.trailStepRowLast}>
            <View style={styles.trailRailCol}>
              <View style={[styles.stepNode, step3Unlocked && styles.stepNodeRevealed]}>
                <Text style={step3Unlocked ? styles.stepNodeTextRevealed : styles.stepNodeText}>
                  3
                </Text>
              </View>
            </View>
            <View style={styles.stepContentBox}>
              <Text style={styles.cardLabel}>STEP 3 • EXACT LOCATION (REVEAL)</Text>
              {mickey.reveal ? (
                <Text style={styles.clueBodyText}>{mickey.reveal}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show me"
                  style={styles.hintButton}
                  onPress={() => handleRequestHint(3)}
                  disabled={hintMutation.isPending}
                >
                  <Ionicons name="eye-outline" size={18} color={t.color.primaryFg} />
                  <Text style={styles.hintButtonText}>Show me</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Find & Trip Link Section */}
        <View style={[styles.actionCard, mickey.found && styles.actionCardFound]}>
          <Text style={styles.actionCardTitle}>Have you spotted this Mickey?</Text>

          {/* Trip Chip Picker */}
          {activeTrips.length > 0 && (
            <View style={styles.tripChipContainer}>
              <Text style={styles.tripChipLabel}>Link to Trip:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tripChipsScroll}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="No trip linked"
                  style={[styles.tripChip, activeTripSelection === null && styles.tripChipActive]}
                  onPress={() => {
                    setSelectedTripId(null);
                    setHasChangedTrip(true);
                  }}
                >
                  <Text
                    style={[
                      styles.tripChipText,
                      activeTripSelection === null && styles.tripChipTextActive,
                    ]}
                  >
                    No trip
                  </Text>
                </Pressable>
                {activeTrips.map((trip) => {
                  const isSelected = activeTripSelection === trip.id;
                  return (
                    <Pressable
                      key={trip.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Link to trip ${trip.name}`}
                      style={[styles.tripChip, isSelected && styles.tripChipActive]}
                      onPress={() => {
                        setSelectedTripId(trip.id);
                        setHasChangedTrip(true);
                      }}
                    >
                      <Ionicons
                        name="airplane"
                        size={12}
                        color={isSelected ? t.color.textOnPrimary : t.color.textSecondary}
                      />
                      <Text style={[styles.tripChipText, isSelected && styles.tripChipTextActive]}>
                        {trip.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Found / Undo Buttons */}
          {mickey.found ? (
            <View style={styles.foundActionsRow}>
              <View style={styles.foundSuccessBadge} accessibilityLabel="Marked as found">
                <Ionicons name="checkmark-circle" size={20} color={t.color.success} />
                <Text style={styles.foundSuccessText}>You found it!</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo find"
                style={styles.undoBtn}
                onPress={handleUndo}
                disabled={undoMutation.isPending}
              >
                <Text style={styles.undoBtnText}>Undo</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I found it"
              style={styles.findButton}
              onPress={handleFind}
              disabled={findMutation.isPending}
            >
              <Ionicons name="sparkles" size={18} color={t.color.textOnPrimary} />
              <Text style={styles.findButtonText}>I found it!</Text>
            </Pressable>
          )}
        </View>

        {/* Still There Voting Section */}
        <View style={styles.actionCard}>
          <Text style={styles.actionCardTitle}>Still there?</Text>
          <Text style={styles.actionCardSubtext}>
            Help keep the hunt accurate for other guests.
          </Text>
          <View style={styles.voteBtnRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Vote still there"
              style={[styles.voteBtn, currentVote === 'there' && styles.voteBtnActiveThere]}
              onPress={() => handleVote('there')}
              disabled={voteMutation.isPending}
            >
              <Ionicons
                name={currentVote === 'there' ? 'thumbs-up' : 'thumbs-up-outline'}
                size={18}
                color={t.color.primaryFg}
              />
              <Text
                style={[
                  styles.voteBtnText,
                  currentVote === 'there' && styles.voteBtnTextActiveThere,
                ]}
              >
                Still there
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Vote couldn't find it"
              style={[styles.voteBtn, currentVote === 'gone' && styles.voteBtnActiveGone]}
              onPress={() => handleVote('gone')}
              disabled={voteMutation.isPending}
            >
              <Ionicons
                name={currentVote === 'gone' ? 'thumbs-down' : 'thumbs-down-outline'}
                size={18}
                color={currentVote === 'gone' ? t.color.danger : t.color.textSecondary}
              />
              <Text
                style={[
                  styles.voteBtnText,
                  currentVote === 'gone' && styles.voteBtnTextActiveGone,
                ]}
              >
                Couldn't find it
              </Text>
            </Pressable>
          </View>
          {currentVote && (
            <View style={styles.voteFeedbackRow}>
              <Ionicons name="checkmark-circle" size={14} color={t.color.success} />
              <Text style={styles.voteFeedbackText}>
                Vote recorded: {currentVote === 'there' ? 'Still there' : "Couldn't find it"}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Report Modal */}
      <Modal visible={reportModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report Hidden Mickey</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close report dialog"
                onPress={() => setReportModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={22} color={t.color.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.reportWarningBox}>
              <Ionicons name="warning-outline" size={16} color={t.color.warningText} />
              <Text style={styles.reportWarningText}>
                Reporting permanently hides this Mickey from your hunt. If it's just missing in person, use &quot;Couldn&apos;t find it&quot; instead.
              </Text>
            </View>

            <Text style={styles.modalSubtext}>Select why this entry should be reviewed:</Text>

            <View style={styles.reasonList}>
              {MICKEY_REPORT_REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  accessibilityRole="button"
                  accessibilityLabel={`Reason: ${MICKEY_REPORT_REASON_LABELS[reason]}`}
                  style={[
                    styles.reasonItem,
                    selectedReportReason === reason && styles.reasonItemActive,
                  ]}
                  onPress={() => setSelectedReportReason(reason)}
                >
                  <Ionicons
                    name={
                      selectedReportReason === reason ? 'radio-button-on' : 'radio-button-off'
                    }
                    size={18}
                    color={
                      selectedReportReason === reason ? t.color.primaryFg : t.color.textSecondary
                    }
                  />
                  <Text style={styles.reasonText}>{MICKEY_REPORT_REASON_LABELS[reason]}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.reportTextInput}
              placeholder="Optional details (up to 300 characters)..."
              placeholderTextColor={t.color.textSecondary}
              value={reportNote}
              onChangeText={setReportNote}
              maxLength={300}
              multiline
              accessibilityLabel="Report details note"
            />

            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel report"
                style={styles.cancelBtn}
                onPress={() => setReportModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                style={styles.submitReportBtn}
                onPress={handleSubmitReport}
                disabled={reportMutation.isPending}
              >
                <Text style={styles.submitReportBtnText}>Report &amp; Hide</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.background,
    gap: theme.spacing.md,
  },
  errorText: {
    ...theme.typography.heading,
    color: t.color.textPrimary,
  },
  backBtnPill: {
    backgroundColor: t.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  backBtnText: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerTitle: {
    ...theme.typography.heading,
    fontSize: 17,
    fontWeight: '700',
    color: t.color.textPrimary,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: theme.spacing.sm,
  },
  reportIconBtn: {
    padding: theme.spacing.xs,
  },
  scrollContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  sectionCard: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    paddingTop: theme.spacing.md + 4,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.xs,
    overflow: 'hidden',
    position: 'relative',
  },
  heroAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
  },
  cardParkText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  viewVenueLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
  },
  viewVenueLinkText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  heroVenueTitle: {
    ...theme.typography.heading,
    color: t.color.textPrimary,
    fontWeight: '800',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  difficultyDots: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgePillText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
    textTransform: 'capitalize',
  },
  communityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  communityBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  confidenceBadgeWarning: {
    backgroundColor: t.color.warningSurface,
  },
  confidenceText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.success,
    fontWeight: '700',
  },
  confidenceTextWarning: {
    color: t.color.warningText,
  },
  friendsFoundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  friendsFoundText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  trailCard: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  trailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  trailTitle: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  trailBadgePill: {
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  trailBadgeText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  trailStepRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  trailStepRowLast: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  trailRailCol: {
    width: 24,
    alignItems: 'center',
  },
  stepNode: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1.5,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNodeUnlocked: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  stepNodeRevealed: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  },
  stepNodeText: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '800',
    color: t.color.textSecondary,
  },
  stepNodeTextActive: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
  stepNodeTextRevealed: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '800',
    color: t.color.textOnAccent,
  },
  stepConnector: {
    flex: 1,
    width: 2,
    backgroundColor: t.color.border,
    marginTop: 4,
    marginBottom: -8,
  },
  stepConnectorUnlocked: {
    backgroundColor: t.color.primary,
  },
  stepContentBox: {
    flex: 1,
    backgroundColor: t.color.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: theme.spacing.sm,
    gap: 4,
  },
  cardLabel: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  clueBodyText: {
    ...theme.typography.body,
    color: t.color.textPrimary,
    lineHeight: 22,
  },
  hintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    marginTop: 4,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
  },
  hintButtonText: {
    ...theme.typography.body,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  actionCard: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.sm,
  },
  actionCardFound: {
    borderColor: withAlpha(t.color.success, 0.55),
  },
  actionCardTitle: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  actionCardSubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  tripChipContainer: {
    gap: 4,
    marginTop: 4,
  },
  tripChipLabel: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  tripChipsScroll: {
    gap: 6,
    paddingVertical: 4,
  },
  tripChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
  },
  tripChipActive: {
    backgroundColor: t.color.primary,
  },
  tripChipText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  tripChipTextActive: {
    color: t.color.textOnPrimary,
  },
  findButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.color.primary,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
  },
  findButtonText: {
    ...theme.typography.body,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  foundActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foundSuccessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  foundSuccessText: {
    ...theme.typography.body,
    fontWeight: '700',
    color: t.color.success,
  },
  undoBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.surfaceAlt,
  },
  undoBtnText: {
    ...theme.typography.meta,
    color: t.color.danger,
    fontWeight: '700',
  },
  voteBtnRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  voteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
  },
  voteBtnText: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  voteBtnActiveThere: {
    backgroundColor: withAlpha(t.color.primary, 0.18),
    borderColor: t.color.primary,
    borderWidth: 1.5,
  },
  voteBtnTextActiveThere: {
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  voteBtnActiveGone: {
    backgroundColor: withAlpha(t.color.danger, 0.18),
    borderColor: t.color.danger,
    borderWidth: 1.5,
  },
  voteBtnTextActiveGone: {
    color: t.color.danger,
    fontWeight: '700',
  },
  voteFeedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  voteFeedbackText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: withAlpha(t.color.textPrimary, 0.5),
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  modalCard: {
    width: '100%',
    backgroundColor: t.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    ...theme.typography.heading,
    color: t.color.textPrimary,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: 4,
  },
  reportWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: t.color.warningSurface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  reportWarningText: {
    ...theme.typography.meta,
    color: t.color.warningText,
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
  modalSubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  reasonList: {
    gap: 6,
    marginVertical: 4,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.sm,
    backgroundColor: t.color.surfaceAlt,
  },
  reasonItemActive: {
    backgroundColor: t.color.border,
  },
  reasonText: {
    ...theme.typography.body,
    fontSize: 13,
    color: t.color.textPrimary,
  },
  reportTextInput: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 10,
    height: 80,
    color: t.color.textPrimary,
    ...theme.typography.body,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.radius.sm,
  },
  cancelBtnText: {
    ...theme.typography.body,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  submitReportBtn: {
    backgroundColor: t.color.danger,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.radius.sm,
  },
  submitReportBtnText: {
    ...theme.typography.body,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
}));
