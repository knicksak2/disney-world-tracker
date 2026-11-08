import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { ExperienceDTO, MickeyZone, MickeyDifficulty } from '@dwt/shared';
import {
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
  MICKEY_CLUE1_MIN,
  MICKEY_CLUE1_MAX,
  MICKEY_CLUE2_MIN,
  MICKEY_CLUE2_MAX,
  MICKEY_REVEAL_MIN,
  MICKEY_REVEAL_MAX,
} from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useMickeyList, useSubmitMickey } from './api';
import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SubmitMickey'>;
type ScreenRouteProp = RouteProp<RootStackParamList, 'SubmitMickey'>;

export default function SubmitMickeyScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const styles = useStyles();
  const t = useAppTheme();

  const [experienceSearch, setExperienceSearch] = useState('');
  const [selectedExperience, setSelectedExperience] = useState<{ id: string; name: string } | null>(null);

  const [selectedZone, setSelectedZone] = useState<MickeyZone>('queue');
  const [selectedDifficulty, setSelectedDifficulty] = useState<MickeyDifficulty>('medium');

  const [clue1, setClue1] = useState('');
  const [clue2, setClue2] = useState('');
  const [reveal, setReveal] = useState('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submitMutation = useSubmitMickey();

  // If experienceId was passed in route params, resolve experience details
  const routeExperienceId = route.params?.experienceId;
  const initialExpQuery = useQuery({
    queryKey: ['catalog', 'experience', routeExperienceId],
    queryFn: () => apiRequest<ExperienceDTO>('GET', `/catalog/${encodeURIComponent(routeExperienceId!)}`),
    enabled: Boolean(routeExperienceId),
  });

  useEffect(() => {
    if (initialExpQuery.data && !selectedExperience) {
      setSelectedExperience({
        id: initialExpQuery.data.id,
        name: initialExpQuery.data.name,
      });
    }
  }, [initialExpQuery.data, selectedExperience]);

  // Catalog experience search query
  const searchResultsQuery = useQuery({
    queryKey: ['catalog', 'search', experienceSearch],
    queryFn: () => apiRequest<readonly ExperienceDTO[]>('GET', `/catalog?q=${encodeURIComponent(experienceSearch)}`),
    enabled: experienceSearch.trim().length >= 2 && !selectedExperience,
  });

  // Duplicate prevention: fetch existing Mickeys for the chosen experience (Requirement 6.9)
  const existingMickeysQuery = useMickeyList(
    selectedExperience ? { experienceId: selectedExperience.id, limit: 10 } : {},
    Boolean(selectedExperience),
  );

  const isFormValid =
    Boolean(selectedExperience) &&
    clue1.length >= MICKEY_CLUE1_MIN &&
    clue1.length <= MICKEY_CLUE1_MAX &&
    clue2.length >= MICKEY_CLUE2_MIN &&
    clue2.length <= MICKEY_CLUE2_MAX &&
    reveal.length >= MICKEY_REVEAL_MIN &&
    reveal.length <= MICKEY_REVEAL_MAX;

  const handleSubmit = async () => {
    if (!selectedExperience) return;
    setErrorMessage(null);

    try {
      await submitMutation.mutateAsync({
        experienceId: selectedExperience.id,
        zone: selectedZone,
        difficulty: selectedDifficulty,
        clue1: clue1.trim(),
        clue2: clue2.trim(),
        reveal: reveal.trim(),
      });

      Alert.alert(
        'Submission Received',
        'Thank you! Your Hidden Mickey submission has been recorded.',
        [
          {
            text: 'View My Submissions',
            onPress: () => {
              navigation.replace('MySubmissions');
            },
          },
        ],
      );
    } catch (err: any) {
      if (err.code === 'mickey_text_rejected') {
        setErrorMessage('Text rejected: links, email addresses, and flagged content are strictly forbidden.');
      } else if (err.code === 'mickey_submission_limit') {
        setErrorMessage('Daily submission limit reached (5 submissions per day). Please try again tomorrow.');
      } else if (err.code === 'mickey_submissions_banned') {
        setErrorMessage('Your account is currently restricted from submitting Hidden Mickeys.');
      } else {
        setErrorMessage(err.message || 'Failed to submit Hidden Mickey. Please check your inputs and try again.');
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="close" size={24} color={t.color.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Submit a Mickey</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Guidelines Banner (Requirement 15.5 & 6.2) */}
        <View style={styles.guidelineCard}>
          <View style={styles.guidelineRow}>
            <Ionicons name="information-circle" size={18} color={t.color.primaryFg} />
            <Text style={styles.guidelineTitle}>Submission Guidelines</Text>
          </View>
          <Text style={styles.guidelineText}>
            • Guest areas only: Hidden Mickeys must be located in areas open to all guests (no backstage or restricted locations).
          </Text>
          <Text style={styles.guidelineText}>
            • No links or contact info: URLs and emails are rejected automatically.
          </Text>
        </View>

        {/* Experience Selector */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>EXPERIENCE / ATTRACTION</Text>
          {selectedExperience ? (
            <View style={styles.selectedExpRow}>
              <View style={styles.selectedExpInfo}>
                <Ionicons name="sparkles" size={18} color={t.color.primaryFg} />
                <Text style={styles.selectedExpName}>{selectedExperience.name}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change selected experience"
                onPress={() => {
                  setSelectedExperience(null);
                  setExperienceSearch('');
                }}
                style={styles.changeExpBtn}
              >
                <Text style={styles.changeExpBtnText}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <View style={styles.searchInputWrap}>
                <Ionicons name="search" size={16} color={t.color.textSecondary} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.expSearchInput}
                  placeholder="Search attraction or location..."
                  placeholderTextColor={t.color.textSecondary}
                  value={experienceSearch}
                  onChangeText={setExperienceSearch}
                  accessibilityLabel="Search attraction or location"
                />
              </View>

              {searchResultsQuery.isLoading && (
                <ActivityIndicator size="small" color={t.color.primary} style={{ marginTop: 8 }} />
              )}

              {searchResultsQuery.data && searchResultsQuery.data.length > 0 && (
                <View style={styles.searchResultsDropdown}>
                  {searchResultsQuery.data.slice(0, 6).map((exp) => (
                    <Pressable
                      key={exp.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${exp.name}`}
                      style={styles.searchResultItem}
                      onPress={() => {
                        setSelectedExperience({ id: exp.id, name: exp.name });
                        setExperienceSearch('');
                      }}
                    >
                      <Text style={styles.searchResultName}>{exp.name}</Text>
                      <Text style={styles.searchResultPark}>{exp.park ?? 'Resort'}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Duplicate Prevention List (Requirement 6.9) */}
        {selectedExperience && (
          <View style={styles.duplicateSection}>
            <Text style={styles.duplicateSectionTitle}>
              Existing Mickeys for {selectedExperience.name}:
            </Text>
            {existingMickeysQuery.isLoading ? (
              <ActivityIndicator size="small" color={t.color.primary} />
            ) : existingMickeysQuery.data && existingMickeysQuery.data.items.length > 0 ? (
              <View style={styles.duplicateList}>
                {existingMickeysQuery.data.items.map((item) => (
                  <View key={item.id} style={styles.duplicateCard}>
                    <Text style={styles.duplicateClue} numberOfLines={2}>
                      • {item.clue1}
                    </Text>
                    <Text style={styles.duplicateMeta}>
                      Zone: {item.zone.replace('_', ' ')} | Difficulty: {item.difficulty}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noDuplicatesText}>No existing Mickeys recorded here yet. Be the first!</Text>
            )}
          </View>
        )}

        {/* Zone Selector */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>ZONE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
            {MICKEY_ZONES.map((zone) => {
              const isSelected = selectedZone === zone;
              return (
                <Pressable
                  key={zone}
                  accessibilityRole="button"
                  accessibilityLabel={`Select zone ${zone}`}
                  style={[styles.pill, isSelected && styles.pillActive]}
                  onPress={() => setSelectedZone(zone)}
                >
                  <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                    {zone.replace('_', ' ')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Difficulty Selector */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>DIFFICULTY</Text>
          <View style={styles.difficultyRow}>
            {MICKEY_DIFFICULTIES.map((diff) => {
              const isSelected = selectedDifficulty === diff;
              return (
                <Pressable
                  key={diff}
                  accessibilityRole="button"
                  accessibilityLabel={`Select difficulty ${diff}`}
                  style={[styles.difficultyBtn, isSelected && styles.difficultyBtnActive]}
                  onPress={() => setSelectedDifficulty(diff)}
                >
                  <Text style={[styles.difficultyBtnText, isSelected && styles.difficultyBtnTextActive]}>
                    {diff.charAt(0).toUpperCase() + diff.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Clue 1 Field */}
        <View style={styles.sectionCard}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.sectionLabel}>CLUE 1 (PRIMARY HINT)</Text>
            <Text
              style={[
                styles.charCounter,
                (clue1.length < MICKEY_CLUE1_MIN || clue1.length > MICKEY_CLUE1_MAX) &&
                  clue1.length > 0 &&
                  styles.charCounterWarn,
              ]}
            >
              {clue1.length} / {MICKEY_CLUE1_MAX}
            </Text>
          </View>
          <TextInput
            style={styles.textAreaInput}
            placeholder="A subtle general clue (10-140 characters)..."
            placeholderTextColor={t.color.textSecondary}
            value={clue1}
            onChangeText={setClue1}
            maxLength={MICKEY_CLUE1_MAX}
            multiline
            accessibilityLabel="Clue 1 text"
          />
        </View>

        {/* Clue 2 Field */}
        <View style={styles.sectionCard}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.sectionLabel}>CLUE 2 (HELPFUL HINT)</Text>
            <Text
              style={[
                styles.charCounter,
                (clue2.length < MICKEY_CLUE2_MIN || clue2.length > MICKEY_CLUE2_MAX) &&
                  clue2.length > 0 &&
                  styles.charCounterWarn,
              ]}
            >
              {clue2.length} / {MICKEY_CLUE2_MAX}
            </Text>
          </View>
          <TextInput
            style={styles.textAreaInput}
            placeholder="A more specific hint directing attention (10-300 characters)..."
            placeholderTextColor={t.color.textSecondary}
            value={clue2}
            onChangeText={setClue2}
            maxLength={MICKEY_CLUE2_MAX}
            multiline
            accessibilityLabel="Clue 2 text"
          />
        </View>

        {/* Reveal Field */}
        <View style={styles.sectionCard}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.sectionLabel}>REVEAL (EXACT LOCATION)</Text>
            <Text
              style={[
                styles.charCounter,
                (reveal.length < MICKEY_REVEAL_MIN || reveal.length > MICKEY_REVEAL_MAX) &&
                  reveal.length > 0 &&
                  styles.charCounterWarn,
              ]}
            >
              {reveal.length} / {MICKEY_REVEAL_MAX}
            </Text>
          </View>
          <TextInput
            style={styles.textAreaInputLarge}
            placeholder="Detailed description of where and how to spot it (10-500 characters)..."
            placeholderTextColor={t.color.textSecondary}
            value={reveal}
            onChangeText={setReveal}
            maxLength={MICKEY_REVEAL_MAX}
            multiline
            accessibilityLabel="Reveal text"
          />
        </View>

        {/* Error message banner */}
        {errorMessage && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Ionicons name="alert-circle" size={18} color={t.color.danger} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        {/* Submit Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Submit Hidden Mickey"
          style={[styles.submitButton, (!isFormValid || submitMutation.isPending) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!isFormValid || submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator size="small" color={t.color.textOnPrimary} />
          ) : (
            <Text style={styles.submitButtonText}>Submit Hidden Mickey</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
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
  },
  scrollContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  guidelineCard: {
    backgroundColor: t.color.surfaceAlt,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    gap: 4,
  },
  guidelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  guidelineTitle: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  guidelineText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.xs,
  },
  sectionLabel: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  selectedExpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  selectedExpInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  selectedExpName: {
    ...theme.typography.body,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  changeExpBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  changeExpBtnText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  expSearchInput: {
    flex: 1,
    paddingVertical: 8,
    color: t.color.textPrimary,
    ...theme.typography.body,
  },
  searchResultsDropdown: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    marginTop: 6,
    overflow: 'hidden',
  },
  searchResultItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  searchResultName: {
    ...theme.typography.body,
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  searchResultPark: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  duplicateSection: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: 6,
  },
  duplicateSectionTitle: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    fontWeight: '700',
  },
  duplicateList: {
    gap: 6,
    marginTop: 4,
  },
  duplicateCard: {
    backgroundColor: t.color.surfaceAlt,
    padding: 8,
    borderRadius: theme.radius.sm,
    gap: 2,
  },
  duplicateClue: {
    ...theme.typography.body,
    fontSize: 13,
    color: t.color.textPrimary,
  },
  duplicateMeta: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  noDuplicatesText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  pillsScroll: {
    gap: 6,
    paddingVertical: 4,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: t.color.surfaceAlt,
  },
  pillActive: {
    backgroundColor: t.color.primary,
  },
  pillText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  pillTextActive: {
    color: t.color.textOnPrimary,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: 4,
  },
  difficultyBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surfaceAlt,
  },
  difficultyBtnActive: {
    backgroundColor: t.color.primary,
  },
  difficultyBtnText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '700',
  },
  difficultyBtnTextActive: {
    color: t.color.textOnPrimary,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCounter: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 11,
  },
  charCounterWarn: {
    color: t.color.warning,
  },
  textAreaInput: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 10,
    height: 70,
    color: t.color.textPrimary,
    ...theme.typography.body,
    textAlignVertical: 'top',
  },
  textAreaInputLarge: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 10,
    height: 100,
    color: t.color.textPrimary,
    ...theme.typography.body,
    textAlignVertical: 'top',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.color.surfaceAlt,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: t.color.danger,
  },
  errorBannerText: {
    ...theme.typography.meta,
    color: t.color.danger,
    fontWeight: '600',
    flex: 1,
  },
  submitButton: {
    backgroundColor: t.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    ...theme.typography.body,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
}));
