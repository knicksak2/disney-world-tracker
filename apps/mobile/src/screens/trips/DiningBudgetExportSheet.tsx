// Feature: dining-plan-calculator — "Add to Trip Budget" (Requirement 26.12; design.md "Budget export / Mobile").
//
// On open the sheet asks the server for a preview (`preview: true`, nothing written) and lists each line with its
// description, Budget category and pre-tax amount, under a checkbox per group (plan cost, out of pocket, tips). Confirm
// sends the same request with `preview: false` and the checked groups as `include`; an unchecked group's earlier line
// is removed by the server. The replace-in-place note and any warning are stated in words. On success the sheet shows
// the created, updated and removed counts and an "Open Budget" action. A refused export is shown and the sheet stays.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { DINING_EXPORT_GROUPS, type DiningBudgetExportResultDTO, type DiningExportGroup } from '@dwt/shared';

import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { CheckRow, Notice, SheetHeader } from './diningPlanControls';
import { useExportDiningToBudget } from './diningPlanApi';
import {
  EXPORT_GROUP_LABEL,
  EXPORT_PRE_TAX_NOTE,
  EXPORT_REPLACE_NOTE,
  exportCategoryLabel,
  exportGroupOf,
  exportResultText,
  exportWarningText,
  money,
} from './diningPlanView';

function messageOf(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : 'The Budget could not be updated. Please try again.';
}

export function DiningBudgetExportSheet({
  tripId,
  onClose,
  onOpenBudget,
}: {
  readonly tripId: string;
  readonly onClose: () => void;
  readonly onOpenBudget: () => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const exportMutation = useExportDiningToBudget(tripId);
  const [preview, setPreview] = useState<DiningBudgetExportResultDTO | null>(null);
  const [done, setDone] = useState<DiningBudgetExportResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [include, setInclude] = useState<ReadonlySet<DiningExportGroup>>(new Set(DINING_EXPORT_GROUPS));

  const { mutateAsync } = exportMutation;
  useEffect(() => {
    let live = true;
    mutateAsync({ include: [...DINING_EXPORT_GROUPS], preview: true }).then(
      (r) => {
        if (!live) return;
        setPreview(r);
        setLoadingPreview(false);
      },
      (err: unknown) => {
        if (!live) return;
        setError(messageOf(err));
        setLoadingPreview(false);
      },
    );
    return () => {
      live = false;
    };
  }, [mutateAsync]);

  function toggle(group: DiningExportGroup): void {
    setInclude((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  async function confirm(): Promise<void> {
    setError(null);
    try {
      // Keep the canonical group order so the request is the same however the boxes were ticked.
      const r = await mutateAsync({ include: DINING_EXPORT_GROUPS.filter((g) => include.has(g)), preview: false });
      setDone(r);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const busy = exportMutation.isPending;
  const canConfirm = preview !== null && include.size > 0 && !busy;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} testID="dining-export-sheet">
      <View style={styles.container}>
        <SheetHeader title="Add to Trip Budget" onClose={onClose} testIDPrefix="dining-export" />
        <ScrollView contentContainerStyle={styles.body}>
          {error !== null ? <Notice tone="error" text={error} testID="dining-export-error" /> : null}

          {done !== null ? (
            <View testID="dining-export-done">
              <Notice tone="info" text={exportResultText(done)} testID="dining-export-result" />
              {done.warnings.map((w) => (
                <Notice key={w.code} tone="warning" text={exportWarningText(w)} />
              ))}
              <PrimaryButton label="Open Budget" icon="wallet-outline" onPress={onOpenBudget} testID="dining-export-open-budget" style={styles.action} />
              <SecondaryButton label="Done" onPress={onClose} testID="dining-export-finish" style={styles.action} />
            </View>
          ) : loadingPreview ? (
            <View style={styles.center} testID="dining-export-loading">
              <ActivityIndicator color={t.color.primaryFg} accessibilityLabel="Loading the Budget lines" />
            </View>
          ) : preview !== null ? (
            <View testID="dining-export-preview">
              <Text style={styles.intro}>These lines will be added to the Trip Budget for the option shown as the result.</Text>
              <Notice tone="info" text={EXPORT_REPLACE_NOTE} testID="dining-export-replace-note" />
              {preview.warnings.map((w) => (
                <Notice key={w.code} tone="warning" text={exportWarningText(w)} testID={`dining-export-warning-${w.code}`} />
              ))}
              {DINING_EXPORT_GROUPS.map((group) => {
                const lines = preview.lines.filter((l) => exportGroupOf(l.key) === group);
                return (
                  <View key={group} style={styles.group} testID={`dining-export-group-${group}`}>
                    <CheckRow
                      label={EXPORT_GROUP_LABEL[group]}
                      hint={lines.length === 0 ? 'Nothing to add' : include.has(group) ? 'Will be added' : 'Will be left out, and removed if added before'}
                      checked={include.has(group)}
                      onToggle={() => toggle(group)}
                      testID={`dining-export-include-${group}`}
                    />
                    {lines.map((l) => (
                      <View
                        key={l.key}
                        style={styles.line}
                        testID={`dining-export-line-${l.key}`}
                        accessible
                        accessibilityLabel={`${l.description}, ${exportCategoryLabel(l.category)}, ${money(l.subtotalCents)} before tax`}
                      >
                        <Text style={styles.lineText}>{l.description}</Text>
                        <Text style={styles.lineMeta}>{exportCategoryLabel(l.category)}</Text>
                        <Text style={styles.lineAmount}>{money(l.subtotalCents)}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
              <Text style={styles.lineMeta}>{EXPORT_PRE_TAX_NOTE}</Text>
              <PrimaryButton
                label="Add to Budget"
                icon="add-circle-outline"
                onPress={() => void confirm()}
                disabled={!canConfirm}
                loading={busy}
                testID="dining-export-confirm"
                style={styles.action}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.color.background },
  body: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl * 2 },
  center: { padding: theme.spacing.xl, alignItems: 'center' },
  intro: { ...theme.typography.body, color: t.color.textPrimary, marginBottom: theme.spacing.md },
  group: { marginBottom: theme.spacing.md },
  line: {
    marginLeft: theme.spacing.xl,
    paddingVertical: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  lineText: { ...theme.typography.body, color: t.color.textPrimary },
  lineMeta: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400' },
  lineAmount: { ...theme.typography.subtitle, color: t.color.textPrimary },
  action: { marginTop: theme.spacing.md },
}));
