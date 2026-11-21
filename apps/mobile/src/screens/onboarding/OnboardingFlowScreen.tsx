import React, { useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ONBOARDING_INTENTS,
  ONBOARDING_PARKS,
  QUICK_COMPLETIONS_MAX,
  tripCreateSchema,
  type ExperienceDTO,
  type OnboardingIntent,
  type OnboardingPark,
  type ParkLiveSnapshotDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { PrimaryButton, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { DESTINATION_VISUALS } from '../catalog/destinationVisuals';
import { calculateParkWaitAverage } from '../home/pulseCalculations';
import { tripsListKeys } from '../trips/TripsListScreen';
import { ONBOARDING_FLOW } from './OnboardingFlowScreen.palette';
import {
  onboardingKeys,
  useQuickCompletions,
  useUpdateOnboarding,
} from './onboardingApi';
import { useOnboardingPreviewStore } from './onboardingPreviewStore';
import { selectStarterRides } from './starterRides';

type Props = NativeStackScreenProps<RootStackParamList, 'OnboardingFlow'>;

const INTENT_META: Readonly<
  Record<
    OnboardingIntent,
    {
      readonly title: string;
      readonly subtitle: string;
      readonly icon: keyof typeof Ionicons.glyphMap;
    }
  >
> = {
  plan: {
    title: 'Plan a future trip',
    subtitle: 'Build park days, track booking windows & coordinate with crew',
    icon: 'calendar-outline',
  },
  in_park: {
    title: 'In the parks today',
    subtitle: 'Check live standby waits & log rides fast as you go',
    icon: 'flash-outline',
  },
  track_history: {
    title: 'Track past visits & pins',
    subtitle: 'Check off classic attractions, unlock Bronze pins & view stats',
    icon: 'ribbon-outline',
  },
  explore: {
    title: 'Just exploring',
    subtitle: 'Browse rides, menus, crowd calendars & Hidden Mickeys',
    icon: 'compass-outline',
  },
};

const PARK_SHORT_CODE: Readonly<Record<OnboardingPark, string>> = {
  'Magic Kingdom': 'MK',
  EPCOT: 'EP',
  'Hollywood Studios': 'HS',
  'Animal Kingdom': 'AK',
};

function addDaysYmd(daysFromNow: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function resolveUserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

interface TabMapRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly isFab?: boolean;
}

const TAB_MAP_ROWS: readonly TabMapRow[] = [
  {
    id: 'home',
    name: 'Home',
    role: 'Today\u2019s context, live park pulse & your favorite waits',
    icon: 'home-outline',
  },
  {
    id: 'explore',
    name: 'Explore',
    role: 'All parks, live wait times, crowd calendar, resorts & menus',
    icon: 'compass-outline',
  },
  {
    id: 'fab',
    name: 'Quick Actions',
    role: 'One-tap shortcut from any tab to log a ride, snack, or note',
    icon: 'sparkles',
    isFab: true,
  },
  {
    id: 'trips',
    name: 'Trips',
    role: 'Shared itineraries, budgets, dining plan math & reservations',
    icon: 'map-outline',
  },
  {
    id: 'you',
    name: 'You',
    role: 'Collectible pins showcase, food passport, lists & park stats',
    icon: 'person-outline',
  },
];

export default function OnboardingFlowScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const mode = route.params?.mode ?? 'firstRun';
  const isPreview = mode === 'preview';
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(ONBOARDING_FLOW);
  const insets = useContext(SafeAreaInsetsContext);
  const queryClient = useQueryClient();

  const updateOnboarding = useUpdateOnboarding();
  const quickCompletions = useQuickCompletions();
  const enableStarterChecklistPreview = useOnboardingPreviewStore(
    (s) => s.enableStarterChecklistPreview,
  );

  const [step, setStep] = useState<1 | 2 | 3>(mode === 'replay' ? 3 : 1);
  const [selectedIntent, setSelectedIntent] = useState<OnboardingIntent | null>(null);
  const [selectedPark, setSelectedPark] = useState<OnboardingPark | null>(null);

  // Step 2: `plan` Quick Trip Starter state
  const [tripName, setTripName] = useState('');
  const [startDate, setStartDate] = useState(() => addDaysYmd(30));
  const [endDate, setEndDate] = useState(() => addDaysYmd(34));
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
  const [previewCreatedTrip, setPreviewCreatedTrip] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);

  // Step 2: `track_history` / `explore` starter rides state
  const [selectedRideIds, setSelectedRideIds] = useState<readonly string[]>([]);
  const [awardedPinCount, setAwardedPinCount] = useState(0);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 2 live park pulse queries for `in_park`
  const inParkStepActive =
    mode !== 'replay' && step === 2 && selectedIntent === 'in_park';
  const mkLive = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Magic Kingdom'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Magic%20Kingdom/live'),
    enabled: inParkStepActive,
    staleTime: 60_000,
  });
  const epLive = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'EPCOT'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/EPCOT/live'),
    enabled: inParkStepActive,
    staleTime: 60_000,
  });
  const hsLive = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Hollywood Studios'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Hollywood%20Studios/live'),
    enabled: inParkStepActive,
    staleTime: 60_000,
  });
  const akLive = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', 'Animal Kingdom'],
    queryFn: () => apiRequest<ParkLiveSnapshotDTO>('GET', '/parks/Animal%20Kingdom/live'),
    enabled: inParkStepActive,
    staleTime: 60_000,
  });

  const avgWaitByPark: Readonly<Record<OnboardingPark, number | null>> = useMemo(
    () => ({
      'Magic Kingdom': mkLive.data?.entries
        ? calculateParkWaitAverage(mkLive.data.entries)
        : null,
      EPCOT: epLive.data?.entries
        ? calculateParkWaitAverage(epLive.data.entries)
        : null,
      'Hollywood Studios': hsLive.data?.entries
        ? calculateParkWaitAverage(hsLive.data.entries)
        : null,
      'Animal Kingdom': akLive.data?.entries
        ? calculateParkWaitAverage(akLive.data.entries)
        : null,
    }),
    [mkLive.data, epLive.data, hsLive.data, akLive.data],
  );

  // Step 2 catalog query for `track_history` / `explore`
  const ridesStepActive =
    mode !== 'replay' &&
    step === 2 &&
    (selectedIntent === 'track_history' || selectedIntent === 'explore');
  const catalogQuery = useQuery<{ readonly experiences: readonly ExperienceDTO[] }>({
    queryKey: ['catalog', 'all'],
    queryFn: () => apiRequest<{ readonly experiences: readonly ExperienceDTO[] }>('GET', '/catalog'),
    enabled: ridesStepActive,
    staleTime: 3600 * 1000,
  });

  const starterRides = useMemo(
    () => selectStarterRides(catalogQuery.data?.experiences ?? []),
    [catalogQuery.data?.experiences],
  );

  const toggleRide = (id: string) => {
    setStep2Error(null);
    setSelectedRideIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= QUICK_COMPLETIONS_MAX) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSkip = async () => {
    if (isPreview) {
      enableStarterChecklistPreview({
        loggedFirstExperience: selectedRideIds.length > 0,
        hasTrip: previewCreatedTrip,
      });
      navigation.navigate('MainTabs', { screen: 'Home' });
      return;
    }
    try {
      await updateOnboarding.mutateAsync({
        skip: true,
        ...(selectedIntent ? { initialIntent: selectedIntent } : {}),
      });
    } catch {
      // Best-effort skip persistence; still let the user into the app.
    }
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  const handleStep1Continue = () => {
    if (!selectedIntent) return;
    setStep2Error(null);
    setStep(2);
  };

  const handleStep2Continue = async () => {
    setStep2Error(null);
    if (selectedIntent === 'plan') {
      const parsed = tripCreateSchema.safeParse({
        name: tripName,
        startDate: startDate.trim(),
        endDate: endDate.trim(),
      });
      if (!parsed.success) {
        setStep2Error(
          'Enter a trip name and valid YYYY-MM-DD dates (end on or after start).',
        );
        return;
      }
      if (isPreview) {
        setPreviewCreatedTrip(true);
        setStep(3);
        return;
      }
      setCreatingTrip(true);
      try {
        const created = await apiRequest<{ readonly id: string }>(
          'POST',
          '/me/trips',
          parsed.data,
        );
        setCreatedTripId(created.id);
        void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
        void queryClient.invalidateQueries({ queryKey: onboardingKeys.me });
        setStep(3);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Could not create trip. You can also create one later.';
        setStep2Error(msg);
      } finally {
        setCreatingTrip(false);
      }
      return;
    }

    if (selectedIntent === 'in_park') {
      if (!selectedPark) return;
      setStep(3);
      return;
    }

    if (selectedRideIds.length > 0) {
      if (isPreview) {
        setAwardedPinCount(1);
        setStep(3);
        return;
      }
      try {
        const result = await quickCompletions.mutateAsync({
          experienceIds: [...selectedRideIds],
          userTz: resolveUserTimeZone(),
        });
        setAwardedPinCount(result.newlyAwardedPinIds.length);
        setStep(3);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Could not save starter rides. Try again or continue.';
        setStep2Error(msg);
      }
      return;
    }

    setStep(3);
  };

  const handleStep2SkipTrip = () => {
    setStep2Error(null);
    setCreatedTripId(null);
    setPreviewCreatedTrip(false);
    setStep(3);
  };

  const handleFinish = async () => {
    if (isPreview) {
      enableStarterChecklistPreview({
        loggedFirstExperience: selectedRideIds.length > 0,
        hasTrip: previewCreatedTrip,
      });
      navigation.navigate('MainTabs', { screen: 'Home' });
      return;
    }
    try {
      await updateOnboarding.mutateAsync({
        complete: true,
        ...(selectedIntent ? { initialIntent: selectedIntent } : {}),
        ...(selectedPark ? { selectedPark } : {}),
      });
    } catch {
      // Never trap the user on finish.
    }

    if (selectedIntent === 'plan') {
      if (createdTripId) {
        navigation.navigate('MainTabs', {
          screen: 'Trips',
          params: { screen: 'TripDetail', params: { tripId: createdTripId } },
        });
        return;
      }
      navigation.navigate('MainTabs', {
        screen: 'Trips',
        params: { screen: 'TripsList' },
      });
      return;
    }

    if (selectedIntent === 'in_park') {
      navigation.navigate('MainTabs', {
        screen: 'Explore',
        params: {
          screen: 'LiveWaits',
          ...(selectedPark ? { params: { park: selectedPark } } : {}),
        },
      });
      return;
    }

    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  const finishLabel = useMemo(() => {
    if (isPreview) {
      return 'Finish Preview (Show Home Card)';
    }
    if (selectedIntent === 'plan') {
      return createdTripId ? 'Open My Trip' : 'Go to Trips';
    }
    if (selectedIntent === 'in_park' && selectedPark) {
      return `See ${selectedPark} Live Waits`;
    }
    return 'Go to Home';
  }, [isPreview, selectedIntent, createdTripId, selectedPark]);

  const topPad =
    Math.max(
      insets?.top ?? 0,
      Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0,
      t.spacing.lg,
    ) + t.spacing.sm;
  const bottomPad = Math.max(insets?.bottom ?? 0, t.spacing.lg);
  const isBusy =
    updateOnboarding.isPending || quickCompletions.isPending || creatingTrip;

  const renderTabMap = () => (
    <View style={styles.mapList} testID="onboarding-tab-map">
      {TAB_MAP_ROWS.map((row) => (
        <View
          key={row.id}
          style={[styles.mapCard, row.isFab && styles.mapCardFab]}
          testID={`onboarding-map-row-${row.id}`}
        >
          {row.isFab ? (
            <View style={styles.fabHalo} testID="onboarding-fab-badge">
              <LinearGradient
                colors={t.gradient.fab}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.fabGradientCircle}
              >
                <Ionicons
                  name={row.icon}
                  size={18}
                  color={t.color.textOnPrimary}
                  testID="onboarding-fab-icon"
                />
              </LinearGradient>
            </View>
          ) : (
            <View style={styles.mapIconWrap}>
              <Ionicons
                name={row.icon}
                size={20}
                color={t.color.primaryFg}
              />
            </View>
          )}
          <View style={styles.mapTextCol}>
            <Text style={styles.mapTitle}>{row.name}</Text>
            <Text style={styles.mapRole}>{row.role}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  // Read-only replay mode renders Step 3 Tab Map only and performs zero API mutations.
  if (mode === 'replay') {
    return (
      <ScreenContainer style={styles.container} testID="onboarding-flow-screen">
        <View style={[styles.headerRow, { paddingTop: topPad }]}>
          <Text style={styles.replayEyebrow}>QUICK GUIDE</Text>
        </View>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.heading}>{"Here\u2019s where things live"}</Text>
          <Text style={styles.subheading}>
            Four focused tabs plus one center sparkles button keep everything 1 tap away.
          </Text>

          {renderTabMap()}

          <View style={styles.footerBlock}>
            <PrimaryButton
              label="Got it"
              onPress={() => navigation.goBack()}
              testID="onboarding-replay-done-btn"
            />
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container} testID="onboarding-flow-screen">
      <View style={[styles.headerRow, { paddingTop: topPad }]}>
        <View style={styles.stepPillGroup}>
          <Text style={styles.stepLabel} testID="onboarding-step-indicator">
            Step {step} of 3
          </Text>
          <View style={styles.stepDots}>
            {[1, 2, 3].map((dot) => (
              <View
                key={dot}
                style={[
                  styles.stepDot,
                  dot === step && styles.stepDotActive,
                  dot < step && styles.stepDotCompleted,
                ]}
              />
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => void handleSkip()}
          disabled={isBusy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
          testID="onboarding-skip-btn"
          style={styles.skipBtn}
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isPreview ? (
          <View style={styles.previewBanner} testID="onboarding-preview-banner">
            <Ionicons name="eye-outline" size={16} color={t.color.primaryFg} />
            <Text style={styles.previewBannerText}>
              Preview mode — nothing you enter will be saved to your account.
            </Text>
            {step > 1 ? (
              <Pressable
                onPress={() => {
                  setStep2Error(null);
                  setStep((prev) => (prev === 3 ? 2 : 1));
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back to previous onboarding step"
                testID="onboarding-preview-back-btn"
              >
                <Text style={styles.previewBackText}>Back</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {step === 1 && (
          <View style={styles.stepBlock} testID="onboarding-step-1">
            <Text style={styles.heading}>What brings you here?</Text>
            <Text style={styles.subheading}>
              {"Pick one to tailor your first 20 seconds \u2014 nothing is locked behind it."}
            </Text>

            <View style={styles.cardsColumn}>
              {ONBOARDING_INTENTS.map((intent) => {
                const meta = INTENT_META[intent];
                const selected = selectedIntent === intent;
                return (
                  <Pressable
                    key={intent}
                    style={[styles.choiceCard, selected && styles.choiceCardSelected]}
                    onPress={() => setSelectedIntent(intent)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`onboarding-intent-${intent}`}
                  >
                    <View style={styles.choiceIconWrap}>
                      <Ionicons
                        name={meta.icon}
                        size={20}
                        color={t.color.primaryFg}
                      />
                    </View>
                    <View style={styles.choiceTextCol}>
                      <Text style={styles.choiceTitle}>{meta.title}</Text>
                      <Text style={styles.choiceSub}>{meta.subtitle}</Text>
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? t.color.primaryFg : t.color.textSecondary}
                    />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footerBlock}>
              <PrimaryButton
                label="Continue"
                onPress={handleStep1Continue}
                disabled={selectedIntent === null}
                testID="onboarding-step1-continue"
              />
            </View>
          </View>
        )}

        {step === 2 && selectedIntent === 'plan' && (
          <View style={styles.stepBlock} testID="onboarding-step-2-plan">
            <Text style={styles.heading}>Start your first trip</Text>
            <Text style={styles.subheading}>
              Name your getaway and target dates. You can add crew, resorts, and park days later.
            </Text>

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>Trip name</Text>
              <TextInput
                style={styles.input}
                value={tripName}
                onChangeText={(text) => {
                  setStep2Error(null);
                  setTripName(text);
                }}
                placeholder="e.g. Fall Magic 2026"
                placeholderTextColor={t.color.textSecondary}
                autoCapitalize="words"
                testID="onboarding-trip-name-input"
              />

              <View style={styles.datesRow}>
                <View style={styles.dateCol}>
                  <Text style={styles.fieldLabel}>Start date</Text>
                  <TextInput
                    style={styles.input}
                    value={startDate}
                    onChangeText={(text) => {
                      setStep2Error(null);
                      setStartDate(text);
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={t.color.textSecondary}
                    testID="onboarding-trip-start-input"
                  />
                </View>
                <View style={styles.dateCol}>
                  <Text style={styles.fieldLabel}>End date</Text>
                  <TextInput
                    style={styles.input}
                    value={endDate}
                    onChangeText={(text) => {
                      setStep2Error(null);
                      setEndDate(text);
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={t.color.textSecondary}
                    testID="onboarding-trip-end-input"
                  />
                </View>
              </View>
            </View>

            {step2Error ? (
              <View style={styles.errorBox} testID="onboarding-step2-error">
                <Text style={styles.errorText}>{step2Error}</Text>
              </View>
            ) : null}

            <View style={styles.footerBlock}>
              <PrimaryButton
                label={creatingTrip ? 'Creating trip\u2026' : 'Continue'}
                onPress={() => void handleStep2Continue()}
                disabled={isBusy}
                loading={creatingTrip}
                testID="onboarding-step2-continue"
              />
              <Pressable
                onPress={handleStep2SkipTrip}
                disabled={isBusy}
                style={styles.secondaryLinkBtn}
                accessibilityRole="button"
                testID="onboarding-trip-skip-btn"
              >
                <Text style={styles.secondaryLinkText}>{"I\u2019ll create a trip later"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step === 2 && selectedIntent === 'in_park' && (
          <View style={styles.stepBlock} testID="onboarding-step-2-in-park">
            <Text style={styles.heading}>Which park are you at today?</Text>
            <Text style={styles.subheading}>
              {"We\u2019ll point you straight to live standby waits and shortcuts for that park."}
            </Text>

            <View style={styles.parkGrid}>
              {ONBOARDING_PARKS.map((park) => {
                const selected = selectedPark === park;
                const avgWait = avgWaitByPark[park];
                const visual = DESTINATION_VISUALS[park];
                return (
                  <Pressable
                    key={park}
                    style={[styles.parkCard, selected && styles.parkCardSelected]}
                    onPress={() => setSelectedPark(park)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`onboarding-park-${park}`}
                  >
                    <Text style={styles.parkEmoji}>{visual?.icon ?? '🏰'}</Text>
                    <Text style={styles.parkName}>{park}</Text>
                    <Text style={styles.parkWaitLabel}>
                      {avgWait !== null ? `${avgWait}m avg wait` : 'Live waits ready'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footerBlock}>
              <PrimaryButton
                label="Continue"
                onPress={() => void handleStep2Continue()}
                disabled={selectedPark === null || isBusy}
                testID="onboarding-step2-continue"
              />
            </View>
          </View>
        )}

        {step === 2 &&
          (selectedIntent === 'track_history' || selectedIntent === 'explore') && (
            <View style={styles.stepBlock} testID="onboarding-step-2-rides">
              <Text style={styles.heading}>Which classics have you ridden?</Text>
              <Text style={styles.subheading}>
                {"Tap any rides you\u2019ve already done to pre-fill stats and unlock your first collectible pin."}
              </Text>

              <View style={styles.counterRow}>
                <Text style={styles.counterText} testID="onboarding-rides-count">
                  {selectedRideIds.length} selected
                </Text>
              </View>

              {selectedRideIds.length >= 1 && (
                <View style={styles.pinBanner} testID="onboarding-first-pin-banner">
                  <View style={styles.pinBannerIcon}>
                    <Ionicons name="ribbon" size={18} color={pal.bannerText} />
                  </View>
                  <View style={styles.pinBannerCopy}>
                    <Text style={styles.pinBannerTitle}>First Pin Ready!</Text>
                    <Text style={styles.pinBannerSub}>
                      Logging 1 ride qualifies you for your first Park or Land Starter Bronze Pin.
                    </Text>
                  </View>
                </View>
              )}

              {catalogQuery.isLoading && starterRides.length === 0 ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={t.color.primaryFg} />
                </View>
              ) : (
                <View style={styles.ridesGrid}>
                  {starterRides.map((exp) => {
                    const selected = selectedRideIds.includes(exp.id);
                    const parkCode =
                      exp.park && exp.park in PARK_SHORT_CODE
                        ? PARK_SHORT_CODE[exp.park as OnboardingPark]
                        : 'WDW';
                    return (
                      <Pressable
                        key={exp.id}
                        style={[styles.rideChip, selected && styles.rideChipSelected]}
                        onPress={() => toggleRide(exp.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        testID={`onboarding-ride-${exp.id}`}
                      >
                        <View style={styles.rideChipTop}>
                          <Text style={styles.rideParkCode}>{parkCode}</Text>
                          <Ionicons
                            name={selected ? 'checkmark-circle' : 'add-circle-outline'}
                            size={16}
                            color={selected ? t.color.primaryFg : t.color.textSecondary}
                          />
                        </View>
                        <Text style={styles.rideName} numberOfLines={2}>
                          {exp.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {step2Error ? (
                <View style={styles.errorBox} testID="onboarding-step2-error">
                  <Text style={styles.errorText}>{step2Error}</Text>
                </View>
              ) : null}

              <View style={styles.footerBlock}>
                <PrimaryButton
                  label={
                    quickCompletions.isPending
                      ? 'Saving rides\u2026'
                      : selectedRideIds.length > 0
                        ? `Save ${selectedRideIds.length} & Continue`
                        : 'Continue'
                  }
                  onPress={() => void handleStep2Continue()}
                  disabled={isBusy}
                  loading={quickCompletions.isPending}
                  testID="onboarding-step2-continue"
                />
              </View>
            </View>
          )}

        {step === 3 && (
          <View style={styles.stepBlock} testID="onboarding-step-3">
            <Text style={styles.heading}>{"Here\u2019s where things live"}</Text>
            <Text style={styles.subheading}>
              Everything stays in its own home across 4 tabs and the center sparkles button.
            </Text>

            {awardedPinCount > 0 ? (
              <View style={styles.pinBanner} testID="onboarding-step3-pin-awarded">
                <View style={styles.pinBannerIcon}>
                  <Ionicons name="sparkles" size={18} color={pal.bannerText} />
                </View>
                <View style={styles.pinBannerCopy}>
                  <Text style={styles.pinBannerTitle}>
                    {awardedPinCount} Collectible Pin{awardedPinCount === 1 ? '' : 's'} Unlocked!
                  </Text>
                  <Text style={styles.pinBannerSub}>
                    {"Open the You tab whenever you\u2019re ready to claim it."}
                  </Text>
                </View>
              </View>
            ) : null}

            {renderTabMap()}

            <View style={styles.footerBlock}>
              <PrimaryButton
                label={finishLabel}
                onPress={() => void handleFinish()}
                disabled={isBusy}
                loading={updateOnboarding.isPending}
                testID="onboarding-finish-btn"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
  stepPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  stepLabel: {
    ...t.typography.meta,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stepDot: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: ONBOARDING_FLOW[t.scheme].stepInactive,
  },
  stepDotActive: {
    width: 26,
    backgroundColor: t.color.primary,
  },
  stepDotCompleted: {
    backgroundColor: ONBOARDING_FLOW[t.scheme].stepCompleted,
  },
  skipBtn: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 6,
  },
  skipBtnText: {
    ...t.typography.button,
    fontSize: 14,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  replayEyebrow: {
    ...t.typography.meta,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: t.color.primaryFg,
  },
  scrollContent: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
    gap: t.spacing.md,
  },
  stepBlock: {
    gap: t.spacing.md,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.md,
  },
  previewBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  previewBackText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  heading: {
    ...t.typography.heading,
    fontSize: 24,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  subheading: {
    fontSize: 14.5,
    lineHeight: 20,
    color: t.color.textSecondary,
  },
  cardsColumn: {
    gap: t.spacing.sm,
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.color.surface,
    borderWidth: 1.5,
    borderColor: t.color.border,
  },
  choiceCardSelected: {
    backgroundColor: ONBOARDING_FLOW[t.scheme].selectedCardBg,
    borderColor: t.color.primary,
  },
  choiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTextCol: {
    flex: 1,
    gap: 2,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  choiceSub: {
    fontSize: 12.5,
    lineHeight: 17,
    color: t.color.textSecondary,
  },
  formCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  fieldLabel: {
    ...t.typography.meta,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  input: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 10,
    fontSize: 15,
    color: t.color.textPrimary,
  },
  datesRow: {
    flexDirection: 'row',
    gap: t.spacing.sm,
  },
  dateCol: {
    flex: 1,
    gap: 4,
  },
  parkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  parkCard: {
    width: '48%',
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    borderColor: t.color.border,
    padding: t.spacing.md,
    gap: 6,
  },
  parkCardSelected: {
    backgroundColor: ONBOARDING_FLOW[t.scheme].selectedCardBg,
    borderColor: t.color.primary,
  },
  parkEmoji: {
    fontSize: 22,
    ...t.textDefault,
  },
  parkName: {
    fontSize: 15,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  parkWaitLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: ONBOARDING_FLOW[t.scheme].bannerBg,
    borderWidth: 1,
    borderColor: ONBOARDING_FLOW[t.scheme].bannerBorder,
  },
  pinBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: ONBOARDING_FLOW[t.scheme].bannerIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBannerCopy: {
    flex: 1,
    gap: 1,
  },
  pinBannerTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: ONBOARDING_FLOW[t.scheme].bannerText,
  },
  pinBannerSub: {
    fontSize: 12,
    lineHeight: 16,
    color: ONBOARDING_FLOW[t.scheme].bannerText,
  },
  loadingWrap: {
    paddingVertical: t.spacing.xl,
    alignItems: 'center',
  },
  ridesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.xs,
  },
  rideChip: {
    width: '48.5%',
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    borderColor: t.color.border,
    padding: t.spacing.sm,
    gap: 6,
  },
  rideChipSelected: {
    backgroundColor: ONBOARDING_FLOW[t.scheme].selectedCardBg,
    borderColor: t.color.primary,
  },
  rideChipTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rideParkCode: {
    fontSize: 10.5,
    fontWeight: '800',
    color: t.color.textSecondary,
  },
  rideName: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
    color: t.color.textPrimary,
  },
  mapList: {
    gap: t.spacing.sm,
  },
  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  mapCardFab: {
    backgroundColor: ONBOARDING_FLOW[t.scheme].fabRowBg,
    borderColor: ONBOARDING_FLOW[t.scheme].fabRowBorder,
  },
  mapIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabHalo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.color.surface,
    padding: 2.5,
    ...t.shadow.card,
    ...t.outline.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGradientCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapTextCol: {
    flex: 1,
    gap: 2,
  },
  mapTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  mapRole: {
    fontSize: 12.5,
    lineHeight: 17,
    color: t.color.textSecondary,
  },
  errorBox: {
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: ONBOARDING_FLOW[t.scheme].errorBg,
    borderWidth: 1,
    borderColor: ONBOARDING_FLOW[t.scheme].errorBorder,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.danger,
  },
  footerBlock: {
    gap: t.spacing.sm,
    marginTop: t.spacing.xs,
  },
  secondaryLinkBtn: {
    alignItems: 'center',
    paddingVertical: t.spacing.xs,
  },
  secondaryLinkText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
}));
