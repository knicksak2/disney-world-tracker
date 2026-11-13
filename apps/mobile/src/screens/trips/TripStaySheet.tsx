/**
 * The Stay sheet (trip-lodging-stays task 8.2, Requirement 7.5): lodging kind, the Disney Resort (single choice from
 * the shared `ResortPicker`) or a place name, check-in and check-out with the same date control as the Trip dates,
 * and "Who's staying" (Everyone, or a checklist of the Trip's members and guests).
 *
 * The sheet only edits a draft. `onSave` persists it (the edit screen PUTs the whole list); while it runs the sheet
 * shows "Saving…", and when it rejects the sheet stays open with the error so nothing typed is lost.
 *
 * Validates: Requirements 7.5, 7.6, 7.8, 6.4
 */

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TRIP_STAY_PLACE_NAME_MAX, type ResortDTO } from '@dwt/shared';

import { DatePickerField } from '../../components/DatePickerField';
import { ResortPicker } from '../../components/ResortPicker';
import { PrimaryButton, SecondaryButton, SectionLabel } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { TRIP_STAY_SHEET } from './TripStaySheet.palette';
import {
  STAY_KIND_LABEL,
  STAY_KIND_ORDER,
  validateStayDraft,
  type StayDraft,
  type StayPerson,
} from './tripStaysView';

export interface TripStaySheetProps {
  readonly visible: boolean;
  /** The Stay being edited, or a new-stay draft (see `newStayDraft`). */
  readonly initialDraft: StayDraft | null;
  readonly resorts: readonly ResortDTO[];
  /** The Trip's current members and guests, for "Who's staying". */
  readonly people: readonly StayPerson[];
  /** Persist the draft. Reject with an Error whose message is shown to keep the sheet open. */
  readonly onSave: (draft: StayDraft) => Promise<void>;
  readonly onClose: () => void;
}

export function TripStaySheet({
  visible,
  initialDraft,
  resorts,
  people,
  onSave,
  onClose,
}: TripStaySheetProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(TRIP_STAY_SHEET);

  const [draft, setDraft] = useState<StayDraft | null>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft(initialDraft);
      setError(null);
      setSaving(false);
    }
  }, [visible, initialDraft]);

  if (!visible || draft === null) return null;

  const update = (patch: Partial<StayDraft>): void => {
    setDraft((d) => (d === null ? d : { ...d, ...patch }));
    setError(null);
  };

  const togglePerson = (key: string): void => {
    const current = draft.partyKeys ?? [];
    update({ partyKeys: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] });
  };

  const handleSave = async (): Promise<void> => {
    const problem = validateStayDraft(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error && err.message.length > 0 ? err.message : 'We could not save this stay. Please try again.');
      setSaving(false);
    }
  };

  const isNew = draft.id === undefined;
  const everyone = draft.partyKeys === null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.overlay, { backgroundColor: pal.overlayBg }]}
      >
        <View style={styles.sheet} testID="trip-stay-sheet">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle} accessibilityRole="header">
              {isNew ? 'Add a stay' : 'Edit stay'}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              disabled={saving}
              testID="trip-stay-sheet-close"
            >
              <Ionicons name="close" size={24} color={t.color.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {error !== null ? (
              <Text style={styles.error} accessibilityRole="alert" testID="trip-stay-sheet-error">
                {error}
              </Text>
            ) : null}

            <View style={styles.section}>
              <SectionLabel>WHERE</SectionLabel>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {STAY_KIND_ORDER.map((kind) => {
                  const selected = draft.lodgingKind === kind;
                  return (
                    <Pressable
                      key={kind}
                      onPress={() => update({ lodgingKind: kind })}
                      disabled={saving}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={STAY_KIND_LABEL[kind]}
                      style={[styles.chip, selected ? styles.chipSelected : null]}
                      testID={`trip-stay-kind-${kind}`}
                    >
                      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                        {STAY_KIND_LABEL[kind]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {draft.lodgingKind === 'resort' ? (
              <View style={styles.section}>
                <SectionLabel>DISNEY RESORT</SectionLabel>
                <ResortPicker
                  resorts={resorts}
                  selectedIds={draft.resortId === null ? [] : [draft.resortId]}
                  // Single choice: picking a resort replaces the previous one; picking it again clears it.
                  onToggle={(id) => update({ resortId: draft.resortId === id ? null : id })}
                  disabled={saving}
                  testIDPrefix="trip-stay"
                />
              </View>
            ) : (
              <View style={styles.section}>
                <SectionLabel>{draft.lodgingKind === 'partner_hotel' ? 'HOTEL NAME' : 'PLACE NAME'}</SectionLabel>
                <TextInput
                  value={draft.placeName}
                  onChangeText={(value) => update({ placeName: value })}
                  placeholder={draft.lodgingKind === 'partner_hotel' ? 'e.g. Swan Reserve' : "e.g. Grandma's house"}
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
                  maxLength={TRIP_STAY_PLACE_NAME_MAX}
                  editable={!saving}
                  style={styles.input}
                  accessibilityLabel="Place name"
                  testID="trip-stay-place-name"
                />
              </View>
            )}

            <View style={styles.section}>
              <SectionLabel>CHECK-IN</SectionLabel>
              <DatePickerField
                value={draft.checkIn}
                onChange={(value) => update({ checkIn: value })}
                placeholder="Not set"
                disabled={saving}
                accessibilityLabel="Check-in date"
                testID="trip-stay-check-in"
              />
              <SectionLabel>CHECK-OUT</SectionLabel>
              <DatePickerField
                value={draft.checkOut}
                onChange={(value) => update({ checkOut: value })}
                placeholder="Not set"
                disabled={saving}
                {...(draft.checkIn !== '' ? { minimumDate: draft.checkIn } : {})}
                accessibilityLabel="Check-out date"
                testID="trip-stay-check-out"
              />
              {draft.checkIn !== '' || draft.checkOut !== '' ? (
                <Pressable
                  onPress={() => update({ checkIn: '', checkOut: '' })}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the dates"
                  testID="trip-stay-clear-dates"
                >
                  <Text style={styles.link}>Clear the dates</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.section}>
              <SectionLabel>WHO&apos;S STAYING</SectionLabel>
              <Pressable
                onPress={() => update({ partyKeys: everyone ? people.map((p) => p.key) : null })}
                disabled={saving}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: everyone }}
                accessibilityLabel="Everyone"
                style={styles.row}
                testID="trip-stay-everyone"
              >
                <Ionicons
                  name={everyone ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={everyone ? t.color.primaryFg : t.color.textSecondary}
                />
                <Text style={styles.rowText}>Everyone</Text>
              </Pressable>
              {!everyone
                ? people.map((p) => {
                    const on = draft.partyKeys?.includes(p.key) ?? false;
                    return (
                      <Pressable
                        key={p.key}
                        onPress={() => togglePerson(p.key)}
                        disabled={saving}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={p.name}
                        style={[styles.row, styles.rowIndented]}
                        testID={`trip-stay-person-${p.key}`}
                      >
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={on ? t.color.primaryFg : t.color.textSecondary}
                        />
                        <Text style={styles.rowText}>{p.name}</Text>
                      </Pressable>
                    );
                  })
                : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <SecondaryButton label="Cancel" onPress={onClose} disabled={saving} testID="trip-stay-cancel" style={styles.flex} />
            <PrimaryButton
              label={saving ? 'Saving\u2026' : isNew ? 'Add stay' : 'Save stay'}
              onPress={() => {
                void handleSave();
              }}
              disabled={saving}
              testID="trip-stay-save"
              style={styles.flex}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    maxHeight: '92%',
    paddingBottom: t.spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  headerTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  body: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.md,
  },
  section: {
    marginBottom: t.spacing.lg,
    gap: t.spacing.xs,
  },
  error: {
    ...t.typography.meta,
    color: t.color.danger,
    marginBottom: t.spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  chip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  chipSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  chipText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  chipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    ...t.typography.body,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
  },
  link: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    paddingVertical: t.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.sm,
  },
  rowIndented: {
    paddingLeft: t.spacing.lg,
  },
  rowText: {
    ...t.typography.body,
    color: t.color.textPrimary,
  },
  footer: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
  },
  flex: {
    flex: 1,
  },
}));
