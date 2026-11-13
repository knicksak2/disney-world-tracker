// Feature: dining-plan-calculator — the meal-slot sheet (Requirements 4.1 to 4.5, 4.8, 19.3, 19.4, 22.1, 22.2).
//
// For one date and meal period the user picks a restaurant (the shared `ExperiencePicker`, restricted to Restaurants),
// a typical quick-service or table-service meal, or "skip", and ticks who is eating. Save hands the entry to `onSave`
// (the Trip screen sends it to the entry route; the standalone calculator keeps it locally); Clear removes the slot.
// A failure is shown in words and the sheet stays open.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiningEntryDTO, DiningMealLineDTO, DiningMealPeriod, DiningPartyPersonDTO, ExperienceDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { DINING_PALETTE } from './diningPlan.palette';
import { ExperiencePicker } from './ExperiencePicker';
import type { DiningEntryInput } from './diningPlanApi';
import { Notice, OptionGroup, SheetHeader } from './diningPlanControls';
import { actionLabel, lineBadges, mealPeriodLabel, money, shortDate } from './diningPlanView';

type Choice = 'restaurant' | 'table_service' | 'quick_service' | 'skip';

const CHOICES: readonly { value: Choice; label: string; shortLabel: string; hint: string }[] = [
  { value: 'restaurant', label: 'A restaurant', shortLabel: 'A restaurant', hint: 'Search by name' },
  { value: 'table_service', label: 'A typical table-service meal', shortLabel: 'Typical table-service', hint: 'Not picked yet' },
  { value: 'quick_service', label: 'A typical quick-service meal', shortLabel: 'Typical quick-service', hint: 'Counter service' },
  { value: 'skip', label: 'Skip this meal', shortLabel: 'Skip this meal', hint: 'Not counted' },
];

export interface DiningSlotSheetProps {
  readonly visible: boolean;
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly entry: DiningEntryDTO | undefined;
  /** Optional server calculation breakdown for this slot (credit/cash action, uncovered reason, badges). */
  readonly mealLine?: DiningMealLineDTO | undefined;
  /** Optional hotel name covering this slot's credits (split-stay). */
  readonly coveredByHotelLabel?: string | null | undefined;
  /** The Party; only people aged 3 and over are listed as diners. */
  readonly party: readonly DiningPartyPersonDTO[];
  /**
   * `entry` is the request body; `display` carries the chosen restaurant's name for a caller that keeps entries
   * locally (the standalone calculator) and is never part of the body.
   */
  readonly onSave: (entry: DiningEntryInput, display: { readonly experienceName: string | null }) => Promise<unknown>;
  /** Omitted when the slot is empty. */
  readonly onClear?: () => Promise<unknown>;
  readonly onClose: () => void;
}

function choiceOf(entry: DiningEntryDTO | undefined): Choice {
  if (entry === undefined || entry.kind === 'restaurant') return 'restaurant';
  if (entry.kind === 'skip') return 'skip';
  return entry.placeholderKind === 'quick_service' ? 'quick_service' : 'table_service';
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'Something went wrong. Please try again.';
}

export function DiningSlotSheet({ visible, date, mealPeriod, entry, mealLine, coveredByHotelLabel, party, onSave, onClear, onClose }: DiningSlotSheetProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(DINING_PALETTE);
  const initialRestaurant =
    entry?.kind === 'restaurant' && entry.experienceId !== null ? { id: entry.experienceId, name: entry.experienceName ?? 'A restaurant' } : null;
  const [choice, setChoice] = useState<Choice>(choiceOf(entry));
  const [restaurant, setRestaurant] = useState<{ id: string; name: string } | null>(initialRestaurant);
  const [fullPicker, setFullPicker] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set(entry?.excludedKeys ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new slot opened in the same sheet starts from that slot's entry.
  useEffect(() => {
    const nextRest =
      entry?.kind === 'restaurant' && entry.experienceId !== null ? { id: entry.experienceId, name: entry.experienceName ?? 'A restaurant' } : null;
    setChoice(choiceOf(entry));
    setRestaurant(nextRest);
    setFullPicker(false);
    setExcluded(new Set(entry?.excludedKeys ?? []));
    setError(null);
  }, [entry, date, mealPeriod]);

  const diners = party.filter((p) => p.ageBracket !== 'under3');
  const canSave = !busy && (choice !== 'restaurant' || restaurant !== null);
  const title = `${mealPeriodLabel(mealPeriod)} · ${shortDate(date)}`;
  const lineAction = mealLine !== undefined ? actionLabel(mealLine) : null;
  const badges = mealLine !== undefined ? lineBadges(mealLine) : [];
  const coveredNote =
    mealLine !== undefined && mealLine.coverage === 'partial' ? `${mealLine.coveredDinerCount} of ${mealLine.dinerCount} diners covered` : null;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function save(): void {
    if (!canSave) return;
    const excludedKeys = choice === 'skip' ? [] : [...excluded];
    const body: DiningEntryInput =
      choice === 'restaurant'
        ? { kind: 'restaurant', experienceId: restaurant!.id, placeholderKind: null, excludedKeys }
        : choice === 'skip'
          ? { kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys }
          : { kind: 'placeholder', experienceId: null, placeholderKind: choice, excludedKeys };
    void run(() => onSave(body, { experienceName: choice === 'restaurant' ? restaurant!.name : null }));
  }

  function toggle(key: string): void {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID="dining-slot-sheet">
      <View style={[styles.backdrop, { backgroundColor: pal.sheetBackdrop }]}>
        <View style={[styles.sheet, fullPicker && styles.sheetFull]}>
          <View style={styles.handle} />
          {fullPicker ? (
            <>
              <View style={styles.pickerHeader}>
                <Pressable
                  onPress={() => setFullPicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to meal details"
                  testID="dining-slot-picker-back"
                  style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                >
                  <Ionicons name="arrow-back" size={18} color={t.color.primaryFg} />
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
                <Text style={styles.pickerTitle} numberOfLines={1}>
                  Choose a restaurant
                </Text>
                <View style={styles.pickerHeaderSpacer} />
              </View>
              <View style={styles.fullPickerBody}>
                <ExperiencePicker
                  enabled={visible && choice === 'restaurant'}
                  showTabs={false}
                  showParkFilter
                  defaultTab="dining"
                  fillContainer
                  onSelect={(exp: ExperienceDTO) => {
                    setRestaurant({ id: exp.id, name: exp.name });
                    setFullPicker(false);
                  }}
                  testIDPrefix="dining-slot-picker"
                />
              </View>
            </>
          ) : (
            <>
              <SheetHeader title={title} onClose={onClose} actionLabel="Save" onAction={save} actionDisabled={!canSave} testIDPrefix="dining-slot" />
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {error !== null ? <Notice tone="error" text={error} testID="dining-slot-error" /> : null}
                {mealLine !== undefined && lineAction !== null ? (
                  <View style={styles.statusCard} testID="dining-slot-credit-status">
                    <Text style={styles.statusTitle}>
                      {lineAction.text} · You pay {money(mealLine.outOfPocketCents)}
                      {mealLine.savingsCents > 0 ? ` (plan covers ${money(mealLine.savingsCents)})` : ''}
                    </Text>
                    {lineAction.reason !== null ? <Text style={styles.statusNote}>{lineAction.reason}</Text> : null}
                    {coveredNote !== null ? <Text style={styles.statusNote}>{coveredNote}</Text> : null}
                    {coveredByHotelLabel != null ? <Text style={styles.statusNote}>Uses {coveredByHotelLabel} credits</Text> : null}
                    {badges.length > 0 ? (
                      <View style={styles.badgeRow}>
                        {badges.map((b) => (
                          <View key={b} style={styles.badgeChip}>
                            <Text style={styles.badgeText}>{b}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <OptionGroup label="What is this meal?" options={CHOICES} value={choice} layout="grid-2" onChange={setChoice} testIDPrefix="dining-slot-choice" />

                {choice === 'restaurant' ? (
                  <View style={styles.section}>
                    <View style={styles.chosenCard}>
                      <Ionicons name="restaurant-outline" size={16} color={restaurant !== null ? t.color.primaryFg : t.color.textSecondary} />
                      <Text style={styles.selected} testID="dining-slot-selected" accessibilityLiveRegion="polite" numberOfLines={2}>
                        {restaurant === null ? 'No restaurant chosen yet.' : `Chosen: ${restaurant.name}`}
                      </Text>
                      <Pressable
                        onPress={() => setFullPicker(true)}
                        accessibilityRole="button"
                        accessibilityLabel={restaurant === null ? 'Choose restaurant' : 'Change restaurant'}
                        testID="dining-slot-change-restaurant"
                        style={({ pressed }) => [styles.changeBtn, restaurant === null && styles.chooseBtn, pressed && styles.pressed]}
                      >
                        <Text style={[styles.changeBtnText, restaurant === null && styles.chooseBtnText]}>
                          {restaurant === null ? 'Choose' : 'Change'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {choice !== 'skip' && diners.length > 0 ? (
                  <View style={styles.section} accessibilityLabel="Who is eating">
                    <Text style={styles.sectionTitle}>Who is eating</Text>
                    <View style={styles.dinerChips}>
                      {diners.map((p) => {
                        const checked = !excluded.has(p.key);
                        return (
                          <Pressable
                            key={p.key}
                            onPress={() => toggle(p.key)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked }}
                            accessibilityLabel={`${p.label}, ${p.ageBracket === 'child' ? 'Child' : 'Adult'}`}
                            testID={`dining-slot-diner-${p.key}`}
                            style={({ pressed }) => [styles.dinerChip, checked && styles.dinerChipSelected, pressed && styles.pressed]}
                          >
                            <Ionicons
                              name={checked ? 'checkbox' : 'square-outline'}
                              size={16}
                              color={checked ? t.color.primaryFg : t.color.textSecondary}
                            />
                            <Text style={[styles.dinerLabel, checked && styles.dinerLabelSelected]}>{p.label}</Text>
                            {p.ageBracket === 'child' ? <Text style={styles.dinerMeta}>Child</Text> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.footer}>
                {onClear !== undefined ? (
                  <SecondaryButton label="Clear this slot" tone="danger" icon="trash-outline" onPress={() => void run(onClear)} disabled={busy} testID="dining-slot-clear" style={styles.actionBtn} />
                ) : null}
                <PrimaryButton label="Save meal" onPress={save} disabled={!canSave} loading={busy} testID="dining-slot-save" style={styles.actionBtn} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: t.color.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetFull: {
    height: '90%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 64 },
  backText: { fontSize: 15, fontWeight: '600', color: t.color.primaryFg },
  pickerTitle: { ...theme.typography.subtitle, color: t.color.textPrimary, fontWeight: '700', textAlign: 'center', flex: 1 },
  pickerHeaderSpacer: { minWidth: 64 },
  fullPickerBody: { flex: 1, paddingHorizontal: theme.spacing.sm, paddingTop: theme.spacing.xs },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.color.borderStrong,
    alignSelf: 'center',
    marginTop: 8,
  },
  body: { padding: theme.spacing.md, paddingBottom: theme.spacing.md },
  statusCard: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    marginBottom: theme.spacing.md,
  },
  statusTitle: { ...theme.typography.subtitle, color: t.color.textPrimary },
  statusNote: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400', marginTop: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: t.color.primaryFg },
  section: { marginBottom: theme.spacing.md },
  chosenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
  },
  selected: { flex: 1, fontSize: 13.5, fontWeight: '700', color: t.color.textPrimary },
  changeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  changeBtnText: { fontSize: 12, fontWeight: '700', color: t.color.primaryFg },
  chooseBtn: { backgroundColor: t.color.primary, borderColor: t.color.primary },
  chooseBtnText: { color: t.color.textOnPrimary },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: t.color.textSecondary, marginBottom: theme.spacing.xs },
  dinerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  dinerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  dinerChipSelected: { borderColor: t.color.primaryFg, backgroundColor: t.color.surfaceAlt },
  dinerLabel: { fontSize: 13, fontWeight: '600', color: t.color.textSecondary },
  dinerLabelSelected: { color: t.color.textPrimary },
  dinerMeta: { fontSize: 11, fontWeight: '600', color: t.color.textSecondary },
  footer: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm + 2,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    backgroundColor: t.color.background,
  },
  actionBtn: { flex: 1 },
  pressed: { opacity: 0.75 },
}));
