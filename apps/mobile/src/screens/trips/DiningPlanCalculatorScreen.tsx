// Feature: dining-plan-calculator — the standalone calculator (Requirements 1.2, 20.1–20.5, 27).
//
// No Trip: party counts, dates, pass holder flag, eating style and meals live in local state and are never saved.
// Shares the same 4-tab Resort Chapters UI as `TripDiningPlanScreen` once dates are chosen, with `Who is going` and
// `Your stay` editable directly inside `Settings` (and shown upfront when dates have not been entered yet).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  DINING_CONFIG_DEFAULTS,
  DINING_STANDALONE_DEBOUNCE_MS,
  type DiningEntryDTO,
  type DiningMealPeriod,
  type DiningPlanResultDTO,
  type DiningPlanStayResultDTO,
  type DiningScenarioCode,
  type DiningStayType,
} from '@dwt/shared';

import { DatePickerField } from '../../components/DatePickerField';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { GradientHeader, PrimaryButton, ScreenContainer } from '../../theme/components';
import { theme, withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { DiningCompareCard } from './DiningCompareCard';
import { DiningCreditSummary, shownScenario } from './DiningMealList';
import { DiningResortChapters } from './DiningResortChapters';
import {
  DiningAboutFigures,
  DiningSensitivityTable,
  DiningTabBar,
  DiningVerdictCard,
  type DiningTabKey,
} from './DiningResultParts';
import { DiningSettingsForm } from './DiningSettingsSheet';
import { DiningSlotSheet } from './DiningSlotSheet';
import { CheckRow, Notice, OptionGroup, Stepper } from './diningPlanControls';
import { calculateDining, type DiningSlot } from './diningPlanApi';
import {
  buildCalculateBody,
  CALCULATOR_DEFAULT_COUNTS,
  CALCULATOR_DEFAULT_SETTINGS,
  countMax,
  datesProblem,
  datesProblemText,
  standaloneParty,
  type CalculatorCounts,
} from './diningCalculatorBody';
import { bestScenario, headerMetaSummary, settingsChipLabel, stayDates, type DiningCalFilter } from './diningPlanView';

type Props = NativeStackScreenProps<TripsStackParamList, 'DiningPlanCalculator'>;

export const NOT_SAVED_TEXT = 'Your entries are not saved. They stay on this screen only and are not added to any trip.';

const STAY_TYPES: readonly { value: DiningStayType; label: string; shortLabel: string; hint: string }[] = [
  { value: 'disney_resort_package', label: 'Disney Resort hotel, booked as a package', shortLabel: 'Package', hint: 'Kids Eat Free can apply' },
  { value: 'dvc_or_passholder_resort', label: 'Disney Resort hotel, as DVC or an Annual Passholder', shortLabel: 'DVC / AP', hint: 'No Kids Eat Free' },
  { value: 'not_disney_resort', label: 'Not a Disney Resort hotel', shortLabel: 'Off-site', hint: 'Dining plans cannot be bought' },
];

function messageOf(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'The comparison could not be calculated. Please try again.';
}

export default function DiningPlanCalculatorScreen({ navigation }: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  const [counts, setCounts] = useState<CalculatorCounts>(CALCULATOR_DEFAULT_COUNTS);
  const [passHolder, setPassHolder] = useState(false);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [settings, setSettings] = useState(CALCULATOR_DEFAULT_SETTINGS);
  const [entries, setEntries] = useState<readonly DiningEntryDTO[]>([]);

  const [activeTab, setActiveTab] = useState<DiningTabKey>('meals');
  const [calFilter, setCalFilter] = useState<DiningCalFilter>('all');
  const [result, setResult] = useState<DiningPlanResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [openSlot, setOpenSlot] = useState<DiningSlot | null>(null);
  const [listCode, setListCode] = useState<DiningScenarioCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  const party = useMemo(() => standaloneParty(counts, passHolder), [counts, passHolder]);
  const body = useMemo(
    () => buildCalculateBody({ counts, passHolder, checkIn, checkOut, settings, entries }),
    [counts, passHolder, checkIn, checkOut, settings, entries],
  );
  const problem = datesProblem(checkIn, checkOut);

  useEffect(() => {
    if (body === null) {
      latest.current += 1;
      setPending(false);
      return undefined;
    }
    setPending(true);
    const timer = setTimeout(() => {
      const seq = ++latest.current;
      calculateDining(body).then(
        (r) => {
          if (seq !== latest.current) return;
          setResult(r);
          setError(null);
          setPending(false);
        },
        (err: unknown) => {
          if (seq !== latest.current) return;
          setError(messageOf(err));
          setPending(false);
        },
      );
    }, DINING_STANDALONE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body, attempt]);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const setCount = (kind: keyof CalculatorCounts) => (value: number) => setCounts((c) => ({ ...c, [kind]: value }));

  function saveEntry(slot: DiningSlot, input: Parameters<React.ComponentProps<typeof DiningSlotSheet>['onSave']>[0], experienceName: string | null): Promise<void> {
    const entry: DiningEntryDTO = {
      date: slot.date,
      mealPeriod: slot.mealPeriod,
      kind: input.kind,
      experienceId: input.experienceId ?? null,
      experienceName,
      placeholderKind: input.placeholderKind ?? null,
      plannedItemId: null,
      excludedKeys: [...(input.excludedKeys ?? [])],
    };
    setEntries((list) => [...list.filter((e) => e.date !== slot.date || e.mealPeriod !== slot.mealPeriod), entry]);
    return Promise.resolve();
  }

  function clearEntry(slot: DiningSlot): Promise<void> {
    setEntries((list) => list.filter((e) => e.date !== slot.date || e.mealPeriod !== slot.mealPeriod));
    return Promise.resolve();
  }

  const slotEntry = openSlot === null ? undefined : entries.find((e) => e.date === openSlot.date && e.mealPeriod === openSlot.mealPeriod);
  const shown = result === null ? undefined : shownScenario(result, listCode);
  const slotLine = openSlot === null ? undefined : shown?.meals.find((m) => m.date === openSlot.date && m.mealPeriod === openSlot.mealPeriod);
  const creditScenario = result === null ? null : shown?.credits != null ? shown : bestScenario(result);
  const a = result?.assumptions;
  const daysCount = problem === null ? stayDates(checkIn, checkOut).length : 0;
  const chipLabel = settingsChipLabel(settings, a?.tipIsDefault === true ? a.tipBps : DINING_CONFIG_DEFAULTS.tipBps);

  const standaloneStayChapter: readonly DiningPlanStayResultDTO[] =
    problem === null
      ? result?.stays ?? [
          {
            key: 'stay',
            label: 'Your stay',
            lodgingKind: settings.stayType === 'not_disney_resort' ? 'offsite' : 'resort',
            checkIn,
            checkOut,
            nights: Math.max(0, daysCount - 1),
            partyCount: party.length,
            status: 'compare',
            heldPlan: null,
            channel: settings.stayType === 'dvc_or_passholder_resort' ? 'dvc_or_passholder' : 'package',
            source: 'stay',
            available: result?.verdict !== 'plan_unavailable',
            unavailableReason: null,
            recommendedPlan: result?.bestPlan ?? 'none',
            planCostCents: 0,
            credits: null,
            contributionCents: 0,
          },
        ]
      : [];

  const partyAndStaySection = (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Who is going
        </Text>
        <Stepper label="Adults (10 and over)" value={counts.adults} min={0} max={countMax(counts, 'adults')} compact onChange={setCount('adults')} testIDPrefix="dining-calc-adults" />
        <Stepper label="Children (3 to 9)" value={counts.children} min={0} max={countMax(counts, 'children')} compact onChange={setCount('children')} testIDPrefix="dining-calc-children" />
        <Stepper label="Children under 3" value={counts.under3} min={0} max={countMax(counts, 'under3')} compact onChange={setCount('under3')} testIDPrefix="dining-calc-under3" />
        <CheckRow
          label="Someone has an Annual Pass or is a DVC member"
          hint="A discount on many meals"
          checked={passHolder}
          compact
          onToggle={() => setPassHolder((v) => !v)}
          testID="dining-calc-pass-holder"
        />
        {party.length === 0 ? <Notice tone="warning" text="Add at least one person." testID="dining-calc-no-party" /> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Your stay
        </Text>
        <Text style={styles.label}>Check-in</Text>
        <DatePickerField value={checkIn} onChange={setCheckIn} placeholder="Choose check-in" accessibilityLabel="Check-in date" testID="dining-calc-check-in" />
        <Text style={styles.label}>Check-out</Text>
        <DatePickerField
          value={checkOut}
          onChange={setCheckOut}
          placeholder="Choose check-out"
          {...(checkIn !== '' ? { minimumDate: checkIn } : {})}
          accessibilityLabel="Check-out date"
          testID="dining-calc-check-out"
        />
        <View style={styles.gap} />
        <OptionGroup
          label="Where are you staying?"
          options={STAY_TYPES}
          value={settings.stayType}
          layout="row"
          onChange={(v) => setSettings((s) => ({ ...s, stayType: v }))}
          testIDPrefix="dining-calc-stay-type"
        />
      </View>
    </>
  );

  const calcSubtitle = headerMetaSummary(
    party.length,
    problem === null ? { checkIn, checkOut, nights: Math.max(0, daysCount - 1) } : null,
  );
  const calcRight = (
    <Pressable
      onPress={() => setActiveTab('settings')}
      accessibilityRole="button"
      accessibilityLabel={`How you eat and other settings: ${chipLabel}`}
      testID="dining-calc-open-settings"
      style={({ pressed }) => [
        styles.settingsChip,
        { backgroundColor: withAlpha(t.color.textOnPrimary, 0.14), borderColor: withAlpha(t.color.textOnPrimary, 0.28) },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.settingsChipText, { color: t.color.textOnPrimary }]} numberOfLines={1}>
        {chipLabel}
      </Text>
      <Ionicons name="settings-outline" size={12} color={t.color.textOnPrimary} />
    </Pressable>
  );

  return (
    <ScreenContainer>
      <GradientHeader title="Dining Plan calculator" icon="restaurant-outline" subtitle={calcSubtitle} right={calcRight} compact onBack={handleBack} />

      <View style={styles.stickyTop} testID="dining-calc-screen">
        {result !== null && body !== null && error === null ? <DiningVerdictCard result={result} /> : null}
        <View style={styles.tabWrap}>
          <DiningTabBar activeTab={activeTab} onSelectTab={setActiveTab} daysCount={daysCount} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Notice tone="info" text={NOT_SAVED_TEXT} testID="dining-calc-not-saved" />

        {pending ? (
          <View style={styles.inline} testID="dining-calc-pending">
            <ActivityIndicator color={t.color.primaryFg} accessibilityLabel="Calculating" />
            <Text style={styles.hint}>Calculating…</Text>
          </View>
        ) : null}
        {error !== null ? (
          <View testID="dining-calc-error">
            <Notice tone="error" text={error} />
            <PrimaryButton label="Try again" icon="refresh-outline" onPress={() => setAttempt((n) => n + 1)} testID="dining-calc-retry" style={styles.retry} />
          </View>
        ) : null}

        {activeTab === 'meals' ? (
          <View>
            {problem !== null ? (
              <>
                <Notice tone={problem === 'missing' ? 'info' : 'error'} text={datesProblemText(problem)} testID="dining-calc-dates-problem" />
                {partyAndStaySection}
              </>
            ) : (
              <DiningResortChapters
                stays={standaloneStayChapter}
                entries={entries}
                mealLines={shown?.meals ?? []}
                filter={calFilter}
                onChangeFilter={setCalFilter}
                onPressSlot={(date: string, mealPeriod: DiningMealPeriod) => setOpenSlot({ date, mealPeriod })}
                result={result}
              />
            )}
          </View>
        ) : null}

        {activeTab === 'compare' ? (
          result !== null && body !== null && error === null ? (
            <View testID="dining-calc-result">
              <DiningCompareCard result={result} />
            </View>
          ) : (
            <Notice tone="info" text="Enter your trip dates and party to compare plans." />
          )
        ) : null}

        {activeTab === 'credits' ? (
          result !== null && body !== null && error === null ? (
            <View>
              <DiningCreditSummary
                scenario={creditScenario}
                result={result}
                onSelectScenario={setListCode}
                onViewCreditMealsOnCalendar={() => {
                  setCalFilter('credits');
                  setActiveTab('meals');
                }}
              />
              <DiningSensitivityTable result={result} orderStyle={settings.orderStyle} />
              <DiningAboutFigures result={result} collapsible defaultExpanded={false} />
            </View>
          ) : (
            <Notice tone="info" text="Enter your trip dates and party to inspect credits." />
          )
        ) : null}

        {activeTab === 'settings' ? (
          <View>
            {partyAndStaySection}
            <DiningSettingsForm
              settings={settings}
              party={party}
              defaultTaxBps={a?.taxIsDefault === true ? a.taxBps : DINING_CONFIG_DEFAULTS.taxBps}
              defaultTipBps={a?.tipIsDefault === true ? a.tipBps : DINING_CONFIG_DEFAULTS.tipBps}
              showStay={false}
              onSave={async (next) => {
                setSettings(next);
              }}
              onAfterSave={() => setActiveTab('meals')}
            />
          </View>
        ) : null}
      </ScrollView>

      {openSlot !== null ? (
        <DiningSlotSheet
          visible
          date={openSlot.date}
          mealPeriod={openSlot.mealPeriod}
          entry={slotEntry}
          mealLine={slotLine}
          party={party}
          onSave={(input, display) => saveEntry(openSlot, input, display.experienceName)}
          {...(slotEntry === undefined ? {} : { onClear: () => clearEntry(openSlot) })}
          onClose={() => setOpenSlot(null)}
        />
      ) : null}
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  stickyTop: {},
  tabWrap: { paddingHorizontal: theme.spacing.md, paddingTop: 6, paddingBottom: 2 },
  settingsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  settingsChipText: { fontSize: 11.5, fontWeight: '700' },
  body: { paddingHorizontal: theme.spacing.md, paddingTop: 4, paddingBottom: theme.spacing.xl * 2 },
  section: { marginBottom: theme.spacing.lg },
  sectionTitle: { ...theme.typography.heading, color: t.color.textPrimary, marginBottom: theme.spacing.sm },
  label: { ...theme.typography.meta, color: t.color.textSecondary, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs },
  hint: { ...theme.typography.body, color: t.color.textSecondary, marginBottom: theme.spacing.sm },
  gap: { height: theme.spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  retry: { marginBottom: theme.spacing.md },
  pressed: { opacity: 0.8 },
}));
