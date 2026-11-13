// Feature: dining-plan-calculator — the eating-style settings form & modal sheet (Requirements 3.3, 6.1–6.4, 19.6, 22.1, 22.2, 27.8).
//
// Exposes all Requirement 6 settings inline inside the Settings tab (`DiningSettingsForm`) or wrapped in a Modal
// (`DiningSettingsSheet` for backwards-compatible tests/callers). Server validation errors render in words cleanly.

import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import type { DiningBeverage, DiningOrderStyle, DiningPartyPersonDTO, DiningPlanSettings, DiningStayType } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { CheckRow, Notice, OptionGroup, SheetHeader, Stepper } from './diningPlanControls';

const TAX_MAX_BPS = 2_500;
const TIP_MAX_BPS = 5_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const STAY_TYPES: readonly { value: DiningStayType; label: string; shortLabel: string; hint: string }[] = [
  { value: 'disney_resort_package', label: 'Disney Resort hotel, booked as a package', shortLabel: 'Package', hint: 'Kids Eat Free can apply' },
  { value: 'dvc_or_passholder_resort', label: 'Disney Resort hotel, as DVC or an Annual Passholder', shortLabel: 'DVC / AP', hint: 'No Kids Eat Free' },
  { value: 'not_disney_resort', label: 'Not a Disney Resort hotel', shortLabel: 'Off-site', hint: 'Dining plans cannot be bought' },
];
const ORDER_STYLES: readonly { value: DiningOrderStyle; label: string; hint: string }[] = [
  { value: 'budget', label: 'Budget', hint: 'Lower-priced dishes' },
  { value: 'typical', label: 'Typical', hint: 'Middle of the menu' },
  { value: 'splurge', label: 'Splurge', hint: 'Higher-priced dishes' },
  { value: 'max_value', label: 'Most expensive', hint: 'The priciest dish every time' },
];
const BEVERAGES: readonly { value: DiningBeverage; label: string; hint?: string; icon: 'water-outline' | 'cafe-outline' | 'wine-outline' }[] = [
  { value: 'water', label: 'Water', icon: 'water-outline' },
  { value: 'soft_drink', label: 'Soft drink', icon: 'cafe-outline' },
  { value: 'specialty', label: 'Specialty drink', hint: 'Shakes, specialty sodas', icon: 'wine-outline' },
];

export interface DiningSettingsFormProps {
  readonly settings: DiningPlanSettings;
  readonly party: readonly DiningPartyPersonDTO[];
  readonly defaultTaxBps: number;
  readonly defaultTipBps: number;
  readonly showStay?: boolean;
  readonly onSave: (settings: DiningPlanSettings) => Promise<unknown>;
  readonly onAfterSave?: () => void;
  readonly onReset?: () => Promise<unknown>;
  /** Set true when rendered inside Modal sheet to allow Reset when settings change cleanly. */
  readonly resetSyncKey?: boolean;
}

export interface DiningSettingsSheetProps {
  readonly visible: boolean;
  readonly settings: DiningPlanSettings;
  readonly party: readonly DiningPartyPersonDTO[];
  readonly defaultTaxBps: number;
  readonly defaultTipBps: number;
  readonly showStay?: boolean;
  readonly onSave: (settings: DiningPlanSettings) => Promise<unknown>;
  readonly onClose: () => void;
}

function bpsText(bps: number | null): string {
  return bps === null ? '' : (bps / 100).toString();
}

function parsePercent(text: string): number | null {
  const s = text.trim().replace(/%$/u, '');
  if (s === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/u.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

function pct(bps: number): string {
  return `${(bps / 100).toString()}%`;
}

export function DiningSettingsForm({
  settings,
  party,
  defaultTaxBps,
  defaultTipBps,
  showStay = true,
  onSave,
  onAfterSave,
  onReset,
  resetSyncKey = true,
}: DiningSettingsFormProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const [draft, setDraft] = useState<DiningPlanSettings>(settings);
  const [customDates, setCustomDates] = useState(settings.stay !== null);
  const [checkIn, setCheckIn] = useState(settings.stay?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(settings.stay?.checkOut ?? '');
  const [taxText, setTaxText] = useState(bpsText(settings.taxBps));
  const [tipText, setTipText] = useState(bpsText(settings.tipBps));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    if (!resetSyncKey) return;
    setDraft(settings);
    setCustomDates(settings.stay !== null);
    setCheckIn(settings.stay?.checkIn ?? '');
    setCheckOut(settings.stay?.checkOut ?? '');
    setTaxText(bpsText(settings.taxBps));
    setTipText(bpsText(settings.tipBps));
    setErrors([]);
  }, [resetSyncKey, settings]);

  const adults = party.filter((p) => p.ageBracket === 'adult');
  const eligible = party.filter((p) => p.ageBracket !== 'under3').length;
  const set = <K extends keyof DiningPlanSettings>(key: K, value: DiningPlanSettings[K]) => {
    setSavedNote(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  function toggleDrinker(key: string): void {
    setSavedNote(false);
    setDraft((d) => ({
      ...d,
      alcoholDrinkerKeys: d.alcoholDrinkerKeys.includes(key) ? d.alcoholDrinkerKeys.filter((k) => k !== key) : [...d.alcoholDrinkerKeys, key],
    }));
  }

  async function save(): Promise<void> {
    const problems: string[] = [];
    const taxBps = parsePercent(taxText);
    const tipBps = parsePercent(tipText);
    if (taxBps !== null && (Number.isNaN(taxBps) || taxBps > TAX_MAX_BPS)) problems.push(`Tax must be a rate from 0% to ${pct(TAX_MAX_BPS)}, or blank for the default.`);
    if (tipBps !== null && (Number.isNaN(tipBps) || tipBps > TIP_MAX_BPS)) problems.push(`Tip must be a rate from 0% to ${pct(TIP_MAX_BPS)}, or blank for the default.`);
    let stay: DiningPlanSettings['stay'] = null;
    if (showStay && customDates) {
      if (!DATE.test(checkIn) || !DATE.test(checkOut)) problems.push('Enter both dates as YYYY-MM-DD.');
      else if (checkOut < checkIn) problems.push('Check-out must not be before check-in.');
      else stay = { checkIn, checkOut };
    } else if (!showStay) {
      stay = draft.stay;
    }
    if (draft.mugsWanted > eligible) problems.push(`At most ${eligible} refillable mugs (one per person aged 3 or over).`);
    setErrors(problems);
    if (problems.length > 0) return;
    setBusy(true);
    setSavedNote(false);
    try {
      await onSave({ ...draft, stay, taxBps, tipBps, alcoholDrinkerKeys: draft.alcoholDrinkerKeys.filter((k) => adults.some((a) => a.key === k)) });
      setSavedNote(true);
      onAfterSave?.();
    } catch (err) {
      setErrors([err instanceof Error && err.message.length > 0 ? err.message : 'The settings could not be saved. Please try again.']);
    } finally {
      setBusy(false);
    }
  }

  const input = (value: string, onChange: (v: string) => void, label: string, testID: string, placeholder: string) => (
    <TextInput
      value={value}
      onChangeText={(v) => {
        setSavedNote(false);
        onChange(v);
      }}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor={t.color.textSecondary}
      keyboardAppearance={t.scheme}
      autoCapitalize="none"
      style={styles.input}
      testID={testID}
    />
  );

  return (
    <View testID="dining-settings-form">
      {errors.map((e) => (
        <Notice key={e} tone="error" text={e} testID="dining-settings-error" />
      ))}
      {savedNote ? <Notice tone="info" text="Settings updated." testID="dining-settings-saved" /> : null}

      {showStay ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stay</Text>
          <CheckRow
            label="Use custom dates"
            hint="Applies when the trip has no dated hotel stays"
            checked={customDates}
            compact
            onToggle={() => {
              setSavedNote(false);
              setCustomDates((v) => !v);
            }}
            testID="dining-settings-custom-dates"
          />
          {customDates ? (
            <View style={styles.dates}>
              {input(checkIn, setCheckIn, 'Check-in date', 'dining-settings-check-in', 'Check-in YYYY-MM-DD')}
              {input(checkOut, setCheckOut, 'Check-out date', 'dining-settings-check-out', 'Check-out YYYY-MM-DD')}
            </View>
          ) : null}
          <OptionGroup label="Where are you staying?" options={STAY_TYPES} value={draft.stayType} layout="row" onChange={(v) => set('stayType', v)} testIDPrefix="dining-settings-stay-type" />
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.cardHeader}>HOW YOU ORDER &amp; DRINK</Text>
        <OptionGroup label="How do you order?" options={ORDER_STYLES} value={draft.orderStyle} layout="grid-2" onChange={(v) => set('orderStyle', v)} testIDPrefix="dining-settings-order" />
        <OptionGroup label="Usual drink" options={BEVERAGES} value={draft.beverage} layout="row" onChange={(v) => set('beverage', v)} testIDPrefix="dining-settings-beverage" />

        {adults.length > 0 ? (
          <View style={styles.subGroup}>
            <Text style={styles.subLabel}>Who orders alcohol (adults only)</Text>
            {adults.map((a) => (
              <CheckRow key={a.key} label={a.label} checked={draft.alcoholDrinkerKeys.includes(a.key)} frameless onToggle={() => toggleDrinker(a.key)} testID={`dining-settings-alcohol-${a.key}`} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.cardHeader}>EXTRAS &amp; PROMOTIONS</Text>
        <CheckRow label="Order dessert at table-service meals" checked={draft.orderDessert} frameless onToggle={() => set('orderDessert', !draft.orderDessert)} testID="dining-settings-dessert" />
        <Stepper label="Appetizers per table" value={draft.appetizersPerTable} min={0} max={4} compact onChange={(v) => set('appetizersPerTable', v)} testIDPrefix="dining-settings-appetizers" />
        <Stepper label="Snacks per person per day" value={draft.snacksPerPersonPerDay} min={0} max={4} compact onChange={(v) => set('snacksPerPersonPerDay', v)} testIDPrefix="dining-settings-snacks" />
        <Stepper label="Refillable mugs wanted" value={draft.mugsWanted} min={0} max={Math.max(0, eligible)} compact onChange={(v) => set('mugsWanted', v)} testIDPrefix="dining-settings-mugs" />
        <CheckRow label="Kids Eat Free promotion" hint="Applies only to a package booking when Disney offers it" checked={draft.kidsEatFree} frameless onToggle={() => set('kidsEatFree', !draft.kidsEatFree)} testID="dining-settings-kids-eat-free" />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.cardHeader}>TAX &amp; TIP (LEAVE BLANK FOR DEFAULT)</Text>
        <View style={styles.taxRow}>
          <Text style={styles.taxLabel}>Sales tax (%), default {pct(defaultTaxBps)}</Text>
          <View style={styles.taxInputWrap}>
            {input(taxText, setTaxText, `Sales tax percent, default ${pct(defaultTaxBps)}`, 'dining-settings-tax', `${(defaultTaxBps / 100).toString()}`)}
          </View>
        </View>
        <View style={styles.taxRow}>
          <Text style={styles.taxLabel}>Table-service tip (%), default {pct(defaultTipBps)}</Text>
          <View style={styles.taxInputWrap}>
            {input(tipText, setTipText, `Tip percent, default ${pct(defaultTipBps)}`, 'dining-settings-tip', `${(defaultTipBps / 100).toString()}`)}
          </View>
        </View>
      </View>

      <PrimaryButton label="Save settings" onPress={() => void save()} loading={busy} testID="dining-settings-save" />
      {onReset !== undefined ? (
        <SecondaryButton
          label="Reset settings to defaults"
          icon="refresh-outline"
          onPress={() => void onReset()}
          disabled={busy}
          testID="dining-settings-reset"
          style={styles.resetBtn}
        />
      ) : null}
    </View>
  );
}

export function DiningSettingsSheet({ visible, settings, party, defaultTaxBps, defaultTipBps, showStay = true, onSave, onClose }: DiningSettingsSheetProps): JSX.Element {
  const styles = useStyles();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="dining-settings-sheet">
      <View style={styles.container}>
        <SheetHeader title="How you eat" onClose={onClose} testIDPrefix="dining-settings" />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <DiningSettingsForm
            settings={settings}
            party={party}
            defaultTaxBps={defaultTaxBps}
            defaultTipBps={defaultTipBps}
            showStay={showStay}
            onSave={onSave}
            onAfterSave={onClose}
            resetSyncKey={visible}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.color.background },
  body: { padding: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  section: { marginBottom: theme.spacing.md },
  sectionCard: {
    padding: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.sm + 2,
  },
  cardHeader: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: t.color.textSecondary, marginBottom: theme.spacing.sm },
  subGroup: { marginTop: 2 },
  subLabel: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '700', marginBottom: 6 },
  sectionTitle: { ...theme.typography.subtitle, color: t.color.textPrimary, marginBottom: theme.spacing.sm },
  taxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingVertical: 5 },
  taxLabel: { fontSize: 13, color: t.color.textPrimary, flex: 1 },
  taxInputWrap: { width: 108 },
  dates: { gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  input: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: t.color.surfaceAlt,
    textAlign: 'right',
  },
  resetBtn: { marginTop: theme.spacing.sm },
}));
