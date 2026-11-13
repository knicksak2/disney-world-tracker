// Feature: dining-plan-calculator — "Your stays": one row per Plan_Stay with its plan setting (Requirements 25.2,
// 25.3, 25.13, 25.15, 22.1, 22.2; design.md "Multi-Stay Extension / Mobile").
//
// Each row states the hotel, its dates and nights, and offers Compare plans, I already have a plan (with a plan
// picker) or No plan, and the booking channel for a Disney Resort stay. A stay that cannot have a plan (partner or
// off-site hotel) shows the reason in words and no controls. A change is sent at once through `onChange` with the
// whole `stayPlans` map; "I already have a plan" is sent only once a plan is picked, because the setting needs one.

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DINING_PLAN_CODES,
  type DiningPlanCode,
  type DiningPlanSettings,
  type DiningPlanStayResultDTO,
  type DiningStayChannel,
  type DiningStayPlanStatus,
  type StayPlanSetting,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { Notice, OptionGroup } from './diningPlanControls';
import { isSynthesizedStay, NO_LODGING_TEXT, PLAN_NAME, stayRangeText, unavailableReasonText } from './diningPlanView';

const STATUS_OPTIONS: readonly { value: DiningStayPlanStatus; label: string; hint: string }[] = [
  { value: 'compare', label: 'Compare plans', hint: 'Work out whether a plan is worth it here' },
  { value: 'have_plan', label: 'I already have a plan', hint: 'Booked with this hotel' },
  { value: 'no_plan', label: 'No plan', hint: 'Pay for every meal here' },
];

const CHANNEL_OPTIONS: readonly { value: DiningStayChannel; label: string; hint: string }[] = [
  { value: 'package', label: 'Booked as a package', hint: 'Kids Eat Free can apply' },
  { value: 'dvc_or_passholder', label: 'DVC or Annual Passholder booking', hint: 'No Kids Eat Free' },
];

const PLAN_OPTIONS = DINING_PLAN_CODES.map((code) => ({ value: code, label: PLAN_NAME[code] }));

function messageOf(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'That change could not be saved. Please try again.';
}

function settingOf(stay: DiningPlanStayResultDTO): StayPlanSetting {
  return { status: stay.status, heldPlan: stay.heldPlan, channel: stay.channel };
}

function StayRow({
  stay,
  isOrganizer,
  onEditStays,
  onSave,
  busy,
}: {
  readonly stay: DiningPlanStayResultDTO;
  readonly isOrganizer: boolean;
  readonly onEditStays: () => void;
  readonly onSave: (key: string, setting: StayPlanSetting) => void;
  readonly busy: boolean;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  // "I already have a plan" chosen but no plan picked yet: shown locally, not sent.
  const [choosingHeld, setChoosingHeld] = useState(false);
  const current = settingOf(stay);
  const status: DiningStayPlanStatus = choosingHeld ? 'have_plan' : current.status;
  const canHavePlan = stay.unavailableReason !== 'not_disney_resort';
  const id = `dining-stay-${stay.key}`;

  function pickStatus(next: DiningStayPlanStatus): void {
    if (busy) return;
    if (next === 'have_plan') {
      if (current.status !== 'have_plan') setChoosingHeld(true);
      return;
    }
    setChoosingHeld(false);
    if (next !== current.status) onSave(stay.key, { status: next, heldPlan: null, channel: current.channel });
  }

  function pickPlan(plan: DiningPlanCode): void {
    if (busy) return;
    setChoosingHeld(false);
    onSave(stay.key, { status: 'have_plan', heldPlan: plan, channel: current.channel });
  }

  function pickChannel(channel: DiningStayChannel): void {
    if (busy || channel === current.channel) return;
    onSave(stay.key, { ...current, channel });
  }

  return (
    <View style={styles.row} testID={id}>
      <Text style={styles.name} accessibilityRole="header">
        {stay.label}
      </Text>
      <Text style={styles.meta}>
        {stayRangeText(stay.checkIn, stay.checkOut)}, {stay.nights} {stay.nights === 1 ? 'night' : 'nights'}, {stay.partyCount}{' '}
        {stay.partyCount === 1 ? 'person' : 'people'}
      </Text>

      {isSynthesizedStay(stay) ? (
        <View style={styles.inline} testID={`${id}-no-lodging`}>
          <Ionicons name="information-circle-outline" size={16} color={t.color.textSecondary} />
          <Text style={styles.note}>{NO_LODGING_TEXT}</Text>
          {isOrganizer ? (
            <Pressable onPress={onEditStays} accessibilityRole="link" accessibilityLabel="Edit stays in trip settings" testID={`${id}-edit-stays`}>
              <Text style={styles.link}>Edit stays</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!stay.available ? (
        <View style={styles.inline} testID={`${id}-unavailable`}>
          <Ionicons name="remove-circle-outline" size={16} color={t.color.textSecondary} />
          <Text style={styles.note}>{unavailableReasonText(stay.unavailableReason)}</Text>
        </View>
      ) : null}

      {canHavePlan ? (
        <View style={styles.controls}>
          <OptionGroup label={`Dining plan at ${stay.label}`} options={STATUS_OPTIONS} value={status} onChange={pickStatus} testIDPrefix={`${id}-status`} />
          {status === 'have_plan' ? (
            <OptionGroup label="Which plan do you have?" options={PLAN_OPTIONS} value={choosingHeld ? null : current.heldPlan} onChange={pickPlan} testIDPrefix={`${id}-plan`} />
          ) : null}
          {status !== 'no_plan' ? (
            <OptionGroup label="How is this hotel booked?" options={CHANNEL_OPTIONS} value={current.channel} onChange={pickChannel} testIDPrefix={`${id}-channel`} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function DiningStaysSection({
  stays,
  settings,
  isOrganizer,
  onEditStays,
  onSaveSettings,
}: {
  readonly stays: readonly DiningPlanStayResultDTO[];
  readonly settings: DiningPlanSettings;
  readonly isOrganizer: boolean;
  readonly onEditStays: () => void;
  /** Sends the whole settings with the updated `stayPlans` (the existing settings route). */
  readonly onSaveSettings: (settings: DiningPlanSettings) => Promise<unknown>;
}): JSX.Element | null {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (stays.length === 0) return null;

  function save(key: string, setting: StayPlanSetting): void {
    setBusy(true);
    setError(null);
    onSaveSettings({ ...settings, stayPlans: { ...settings.stayPlans, [key]: setting } }).then(
      () => setBusy(false),
      (err: unknown) => {
        setError(messageOf(err));
        setBusy(false);
      },
    );
  }

  return (
    <View style={styles.section} testID="dining-stays">
      <Text style={styles.title} accessibilityRole="header">
        {stays.length === 1 ? 'Your stay' : 'Your stays'}
      </Text>
      {error !== null ? <Notice tone="error" text={error} testID="dining-stays-error" /> : null}
      {stays.map((s) => (
        <StayRow key={s.key} stay={s} isOrganizer={isOrganizer} onEditStays={onEditStays} onSave={save} busy={busy} />
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { marginBottom: theme.spacing.lg },
  title: { ...theme.typography.heading, color: t.color.textPrimary, marginBottom: theme.spacing.sm },
  row: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.sm,
  },
  name: { ...theme.typography.subtitle, color: t.color.textPrimary },
  meta: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400' },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.xs },
  note: { ...theme.typography.body, color: t.color.textSecondary, flexShrink: 1 },
  link: { ...theme.typography.body, color: t.color.primaryFg, fontWeight: '700', textDecorationLine: 'underline' },
  controls: { marginTop: theme.spacing.sm },
}));
