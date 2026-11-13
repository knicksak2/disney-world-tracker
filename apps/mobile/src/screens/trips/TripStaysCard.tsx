/**
 * "Where you're staying" (trip-lodging-stays tasks 8.2 and 8.3, Requirement 7):
 *
 * - `mode="read"` (the Trip hub, inside `heroCard` above the Crew row): renders a compact, collapsible 2-line stay
 *   summary header showing a date-aware eyebrow (`STAYING AT`, `TONIGHT`, `CHECK-IN TODAY`, `CHECK-OUT TODAY`) with
 *   `(<index> of <total> stays)` when there are multiple stays, the active stay's name (with any leading `"Disney's "`
 *   stripped), a warning count badge when `stayWarnings` is non-empty, and a compact date range pill (`Dec 15–16 ▾`).
 *   Tapping the header toggles the expanded list of Stays in order (dates, nights, kind badge, "N of M people",
 *   "Add dates" for an Organizer on an undated Stay, and each warning sentence).
 * - `mode="edit"` (the Trip edit screen): renders the full editable card with Edit and Remove on each Stay and an
 *   "Add a stay" action.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.7, 7.8
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TripStayDTO, TripStayWarningDTO } from '@dwt/shared';

import { Badge, Card, SectionLabel } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { withAlpha } from '../../theme/theme';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  STAY_KIND_LABEL,
  compactStayCaption,
  hubStaySummary,
  nightsLabel,
  partyLabel,
  shortStayDatesAndNights,
  shortStayName,
  stayDatesLabel,
  stayWarningText,
  type StayPerson,
} from './tripStaysView';

export interface TripStaysCardProps {
  readonly mode: 'read' | 'edit';
  readonly stays: readonly TripStayDTO[];
  readonly stayWarnings: readonly TripStayWarningDTO[];
  /** The Trip's current members and guests; used for "N of M people". */
  readonly people: readonly StayPerson[];
  /** Current WDW calendar date (`YYYY-MM-DD`) for resolving the active stay in `mode="read"`. */
  readonly today?: string;
  readonly onAdd?: () => void;
  readonly onEdit?: (stay: TripStayDTO) => void;
  readonly onRemove?: (stay: TripStayDTO) => void;
  /** Read mode, Organizer only: the "Add dates" action on an undated Stay. */
  readonly onAddDates?: (stay: TripStayDTO) => void;
  readonly disabled?: boolean;
  /** An error from the last save, shown in words. */
  readonly error?: string | null;
}

export function TripStaysCard({
  mode,
  stays,
  stayWarnings,
  people,
  today,
  onAdd,
  onEdit,
  onRemove,
  onAddDates,
  disabled = false,
  error = null,
}: TripStaysCardProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const editing = mode === 'edit';
  const [expanded, setExpanded] = useState(false);

  const summary = !editing ? hubStaySummary(stays, today) : null;

  const renderHubStayRows = (activeStayId: string | null) =>
    stays.map((s) => {
      const undated = s.checkIn === null || s.checkOut === null;
      const isCurrent = activeStayId !== null && s.id === activeStayId;
      const caption = compactStayCaption(s, people);
      return (
        <View
          key={s.id}
          style={[styles.hubRow, isCurrent && styles.hubRowCurrent]}
          testID={`trip-stay-row-${s.id}`}
        >
          <View style={styles.hubRowLeft}>
            <View style={styles.hubRowTitleWrap}>
              <Text style={styles.hubRowName} numberOfLines={1}>
                {shortStayName(s.displayName)}
              </Text>
              {isCurrent ? (
                <View style={styles.tonightPill} testID={`trip-stay-tonight-${s.id}`}>
                  <Text style={styles.tonightPillText}>Tonight</Text>
                </View>
              ) : null}
            </View>
            {caption !== null ? (
              <Text style={styles.hubRowCaption} numberOfLines={1} testID={`trip-stay-caption-${s.id}`}>
                {caption}
              </Text>
            ) : null}
          </View>
          <View style={styles.hubRowRight}>
            <Text style={styles.hubRowDates} testID={`trip-stay-dates-${s.id}`}>
              {shortStayDatesAndNights(s)}
            </Text>
            {undated && onAddDates !== undefined ? (
              <Pressable
                onPress={() => onAddDates(s)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Add dates for ${shortStayName(s.displayName)}`}
                testID={`trip-stay-add-dates-${s.id}`}
              >
                <Text style={styles.link}>Add dates</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    });

  const renderEditStayRows = () =>
    stays.map((s, index) => {
      const nights = nightsLabel(s.nights);
      const party = partyLabel(s.partyKeys, people);
      const isLast = index === stays.length - 1;
      return (
        <View
          key={s.id}
          style={[styles.row, !isLast && styles.rowDivider]}
          testID={`trip-stay-row-${s.id}`}
        >
          <View style={styles.rowMain}>
            <View style={styles.rowTitleWrap}>
              <Text style={styles.name} numberOfLines={2}>
                {shortStayName(s.displayName)}
              </Text>
            </View>
            <Text style={styles.meta}>
              {stayDatesLabel(s)}
              {nights !== null ? ` \u00b7 ${nights}` : ''}
            </Text>
            <View style={styles.badges}>
              <Badge label={STAY_KIND_LABEL[s.lodgingKind]} testID={`trip-stay-kind-badge-${s.id}`} />
              {party !== null ? <Text style={styles.meta}>{party}</Text> : null}
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => onEdit?.(s)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${shortStayName(s.displayName)}`}
              hitSlop={8}
              testID={`trip-stay-edit-${s.id}`}
            >
              <Ionicons name="create-outline" size={20} color={t.color.primaryFg} />
            </Pressable>
            <Pressable
              onPress={() => onRemove?.(s)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${shortStayName(s.displayName)}`}
              hitSlop={8}
              testID={`trip-stay-remove-${s.id}`}
            >
              <Ionicons name="trash-outline" size={20} color={t.color.danger} />
            </Pressable>
          </View>
        </View>
      );
    });

  const renderWarnings = () =>
    stayWarnings.map((w, i) => (
      <View key={`${w.code}-${w.stayId ?? w.from ?? i}`} style={styles.warning} testID={`trip-stay-warning-${i}`}>
        <Ionicons name="alert-circle-outline" size={16} color={t.color.textSecondary} />
        <Text style={styles.warningText}>{stayWarningText(w, stays)}</Text>
      </View>
    ));

  if (!editing) {
    if (summary === null) {
      return <View testID="trip-stays-card" />;
    }
    const alertLabel =
      stayWarnings.length === 1 ? '1 alert' : `${stayWarnings.length} alerts`;
    return (
      <View style={styles.hubContainer} testID="trip-stays-card">
        <Pressable
          style={styles.hubSummaryRow}
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${summary.eyebrow}${summary.countText ? ` ${summary.countText}` : ''}: ${summary.title}, ${summary.datesPill}`}
          testID="trip-stays-toggle"
        >
          <View style={styles.hubLeft}>
            <View style={styles.hubIconWrap}>
              <Ionicons name="bed-outline" size={16} color={t.color.primaryFg} />
            </View>
            <View style={styles.hubTextCol}>
              <View style={styles.hubEyebrowRow}>
                <Text style={styles.hubEyebrow} testID="trip-stays-summary-eyebrow">
                  {summary.eyebrow}
                </Text>
                {summary.countText !== null ? (
                  <Text style={styles.hubCount} testID="trip-stays-summary-count">
                    {summary.countText}
                  </Text>
                ) : null}
                {stayWarnings.length > 0 ? (
                  <View style={styles.hubAlertPill} testID="trip-stays-warning-badge">
                    <Text style={styles.hubAlertPillText}>{alertLabel}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.hubTitle} numberOfLines={1} testID="trip-stays-summary-title">
                {summary.title}
              </Text>
            </View>
          </View>
          <View style={styles.hubDatePill}>
            <Text style={styles.hubDatePillText} testID="trip-stays-summary-dates">
              {summary.datesPill}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={t.color.primaryFg}
            />
          </View>
        </Pressable>

        {expanded ? (
          <View style={styles.hubExpanded} testID="trip-stays-expanded">
            {renderHubStayRows(summary.isCurrentToday ? summary.stay.id : null)}
            {renderWarnings()}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Card style={styles.card} testID="trip-stays-card">
      <SectionLabel>WHERE YOU&apos;RE STAYING</SectionLabel>

      {stays.length === 0 ? (
        <Text style={styles.empty} testID="trip-stays-empty">
          No lodging recorded yet.
        </Text>
      ) : (
        renderEditStayRows()
      )}

      {renderWarnings()}

      {error !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID="trip-stays-error">
          {error}
        </Text>
      ) : null}

      {onAdd !== undefined ? (
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add a stay"
          style={styles.addRow}
          testID="trip-stays-add"
        >
          <Ionicons name="add-circle-outline" size={20} color={t.color.primaryFg} />
          <Text style={styles.link}>Add a stay</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing.sm,
  },
  hubContainer: {
    gap: t.spacing.xs,
  },
  hubSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
  },
  hubLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  hubIconWrap: {
    width: 30,
    height: 30,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  hubTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  hubEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  hubEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
  },
  hubCount: {
    fontSize: 10,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  hubAlertPill: {
    backgroundColor: withAlpha(t.color.accent, 0.18),
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  hubAlertPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: t.color.accent,
  },
  hubTitle: {
    ...t.typography.subtitle,
    fontSize: 13.5,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  hubDatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexShrink: 0,
  },
  hubDatePillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  hubExpanded: {
    marginTop: 4,
    paddingTop: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    gap: 4,
  },
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: t.radius.sm,
  },
  hubRowCurrent: {
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: withAlpha(t.color.primary, 0.4),
  },
  hubRowLeft: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  hubRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hubRowName: {
    fontSize: 12.5,
    fontWeight: '600',
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  hubRowCaption: {
    fontSize: 10.5,
    color: t.color.textSecondary,
  },
  hubRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  hubRowDates: {
    fontSize: 11.5,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  empty: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  rowMain: {
    flex: 1,
    gap: 3,
  },
  rowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing.xs,
  },
  name: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
  },
  tonightPill: {
    backgroundColor: withAlpha(t.color.primary, 0.22),
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  tonightPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.color.primaryFg,
    textTransform: 'uppercase',
  },
  meta: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing.md,
    paddingTop: t.spacing.xs,
  },
  link: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.xs,
  },
  warningText: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    flex: 1,
  },
  error: {
    ...t.typography.meta,
    color: t.color.danger,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    paddingTop: t.spacing.xs,
  },
}));
