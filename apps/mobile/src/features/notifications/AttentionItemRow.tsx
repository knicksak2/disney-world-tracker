/**
 * AttentionItemRow — one row of the Notification_Center's Attention_Feed
 * (task 13.1).
 *
 * A single presentational row that renders one {@link AttentionItem}: its
 * domain type label, the human-readable summary, and a compact relative
 * timestamp, plus the Inline_Action controls appropriate to the item's domain
 * (R2.1):
 *
 *   friendRequest → Accept / Decline
 *   tripInvite    → Accept / Decline
 *   rodeWithTag   → Confirm (with an optional rating input) / Decline
 *   share         → Mark read, plus an "Open" control when the Share
 *                   references a Share_Destination (R2.3)
 *
 * The row is deliberately dependency-light and stateless with respect to the
 * mutations: every action is a callback prop the screen (task 13.3) wires to
 * `useAttentionActions` (accept/decline/confirm/markRead) and, for the Share
 * "Open" control, to the Inbox screen's destination-verify + cross-navigate
 * logic (reused via the `onOpenDestination` callback). The only local state is
 * the optional rode-with rating the user types before confirming.
 *
 * A per-row {@link AttentionActionError} (from `useAttentionActions`) renders
 * inline beneath the controls so one row's failed action surfaces on that row
 * alone and never blocks or hides the other rows (R2.6, R2.7, R2.8). While an
 * action is in flight the `pending` flag disables the row's controls and shows
 * a spinner on the primary action.
 *
 * Validates: Requirements 2.1, 2.3
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { AttentionDomain, AttentionItem } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Badge, Card, PrimaryButton, SecondaryButton } from '../../theme/components';
import type { AttentionActionError } from './useAttentionActions';

// ---------------------------------------------------------------------------
// Domain presentation
// ---------------------------------------------------------------------------

/**
 * User-facing label + leading glyph/tint per domain type, so each row reads its
 * origin at a glance (R1.3). Keyed by the closed {@link AttentionDomain} union
 * so it cannot drift from the domains the feed aggregates.
 */
const DOMAIN_META: Readonly<
  Record<
    AttentionDomain,
    { readonly label: string; readonly icon: keyof typeof Ionicons.glyphMap; readonly tint: string }
  >
> = {
  friendRequest: { label: 'Friend request', icon: 'person-add', tint: theme.color.primary },
  tripInvite: { label: 'Trip invite', icon: 'airplane', tint: theme.color.accentDark },
  rodeWithTag: { label: 'Rode-with tag', icon: 'people', tint: theme.color.success },
  share: { label: 'Share', icon: 'mail', tint: theme.color.primaryLight },
};

/**
 * Compact "time ago" for a source timestamp: "just now", "5m ago", "2h ago",
 * "3d ago" for recent items, then an absolute local date once older than a
 * week. Kept dependency-free (mirrors the trip feed's helper) and falls back to
 * the raw string when the timestamp cannot be parsed.
 */
function formatRelativeTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The inline-action callbacks this row invokes. Each maps 1:1 onto a
 * `useAttentionActions` trigger (the screen in task 13.3 wires them straight
 * through); `onOpenDestination` is wired to the Inbox screen's destination
 * verify + cross-navigate logic for a Share that references a Share_Destination
 * (R2.3). The row stays presentational — it never calls an endpoint itself.
 */
export interface AttentionItemRowProps {
  readonly item: AttentionItem;
  /** True while an inline action for this item is in flight (disables controls). */
  readonly pending?: boolean;
  /** A per-row inline-action error to surface beneath the controls (R2.6–R2.8). */
  readonly error?: AttentionActionError | null;
  /**
   * True when this row is the Attention_Item a tapped push notification asked
   * the Notification_Center to surface, so its Inline_Action is easy to find
   * while still pending (R13.2). Renders a visual focus/highlight on the row
   * and exposes an accessibility `selected` state for assertion.
   */
  readonly highlighted?: boolean;

  readonly onAcceptFriendRequest: (item: AttentionItem) => void;
  readonly onDeclineFriendRequest: (item: AttentionItem) => void;
  readonly onAcceptTripInvite: (item: AttentionItem) => void;
  readonly onDeclineTripInvite: (item: AttentionItem) => void;
  readonly onConfirmRodeWithTag: (
    item: AttentionItem,
    rating?: number | null,
  ) => void;
  readonly onDeclineRodeWithTag: (item: AttentionItem) => void;
  readonly onMarkShareRead: (item: AttentionItem) => void;
  /** Open a Share's Share_Destination (present only when `item.ref.destination` is set). */
  readonly onOpenDestination: (item: AttentionItem) => void;
}

const KEYBOARD_NUMERIC: KeyboardTypeOptions = 'number-pad';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render one Attention_Item with its domain-appropriate Inline_Action controls
 * (R2.1) and, for a Share with a Share_Destination, an "Open" control (R2.3).
 */
export function AttentionItemRow({
  item,
  pending = false,
  error = null,
  highlighted = false,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onAcceptTripInvite,
  onDeclineTripInvite,
  onConfirmRodeWithTag,
  onDeclineRodeWithTag,
  onMarkShareRead,
  onOpenDestination,
}: AttentionItemRowProps): JSX.Element {
  const meta = DOMAIN_META[item.domain];

  // Local, optional rode-with rating the user types before confirming. Parsed
  // to a number on confirm; left empty means "confirm with no rating".
  const [ratingText, setRatingText] = React.useState('');

  const parsedRating = ((): number | null => {
    const trimmed = ratingText.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  })();

  return (
    <Card
      accentColor={meta.tint}
      style={[styles.row, highlighted ? styles.rowHighlighted : null]}
      testID={`attention-row-${item.id}`}
    >
      {/* Push-focus highlight marker (R13.2): present only when this row is the
          Attention_Item a tapped push asked the center to surface, so tests can
          assert the focused row without depending on styling. */}
      {highlighted ? (
        <View
          testID={`attention-row-highlighted-${item.id}`}
          accessibilityState={{ selected: true }}
        />
      ) : null}

      {/* Header: domain badge + relative timestamp */}
      <View style={styles.headerRow}>
        <Badge label={meta.label} color={meta.tint} icon={meta.icon} />
        <Text style={styles.timestamp} testID={`attention-timestamp-${item.id}`}>
          {formatRelativeTime(item.sourceTimestamp)}
        </Text>
      </View>

      {/* Summary */}
      <Text
        style={styles.summary}
        testID={`attention-summary-${item.id}`}
      >
        {item.summary}
      </Text>

      {/* Per-domain inline controls (R2.1) */}
      {renderControls()}

      {/* Per-row inline-action error (R2.6, R2.7, R2.8) */}
      {error !== null ? (
        <View style={styles.errorRow} testID={`attention-error-${item.id}`}>
          <Ionicons
            name="alert-circle-outline"
            size={14}
            color={theme.color.danger}
            style={styles.errorIcon}
          />
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      ) : null}
    </Card>
  );

  function renderControls(): JSX.Element | null {
    switch (item.domain) {
      case 'friendRequest':
        return (
          <View style={styles.actionsRow}>
            <PrimaryButton
              label="Accept"
              icon="checkmark"
              loading={pending}
              disabled={pending}
              onPress={() => onAcceptFriendRequest(item)}
              testID={`attention-accept-${item.id}`}
              style={styles.actionBtn}
            />
            <SecondaryButton
              label="Decline"
              icon="close"
              tone="danger"
              disabled={pending}
              onPress={() => onDeclineFriendRequest(item)}
              testID={`attention-decline-${item.id}`}
              style={styles.actionBtn}
            />
          </View>
        );

      case 'tripInvite':
        return (
          <View style={styles.actionsRow}>
            <PrimaryButton
              label="Accept"
              icon="checkmark"
              loading={pending}
              disabled={pending}
              onPress={() => onAcceptTripInvite(item)}
              testID={`attention-accept-${item.id}`}
              style={styles.actionBtn}
            />
            <SecondaryButton
              label="Decline"
              icon="close"
              tone="danger"
              disabled={pending}
              onPress={() => onDeclineTripInvite(item)}
              testID={`attention-decline-${item.id}`}
              style={styles.actionBtn}
            />
          </View>
        );

      case 'rodeWithTag':
        return (
          <View>
            <View style={styles.ratingRow}>
              <Text style={styles.ratingLabel}>Rating (optional)</Text>
              <TextInput
                value={ratingText}
                onChangeText={setRatingText}
                editable={!pending}
                keyboardType={KEYBOARD_NUMERIC}
                placeholder="—"
                placeholderTextColor={theme.color.textSecondary}
                maxLength={2}
                style={styles.ratingInput}
                testID={`attention-rating-${item.id}`}
                accessibilityLabel="Optional rating out of ten"
              />
              <Text style={styles.ratingSuffix}>/10</Text>
            </View>
            <View style={styles.actionsRow}>
              <PrimaryButton
                label="Confirm"
                icon="checkmark"
                loading={pending}
                disabled={pending}
                onPress={() => onConfirmRodeWithTag(item, parsedRating)}
                testID={`attention-confirm-${item.id}`}
                style={styles.actionBtn}
              />
              <SecondaryButton
                label="Decline"
                icon="close"
                tone="danger"
                disabled={pending}
                onPress={() => onDeclineRodeWithTag(item)}
                testID={`attention-decline-${item.id}`}
                style={styles.actionBtn}
              />
            </View>
          </View>
        );

      case 'share':
        return (
          <View style={styles.actionsRow}>
            <PrimaryButton
              label="Mark read"
              icon="checkmark-done"
              loading={pending}
              disabled={pending}
              onPress={() => onMarkShareRead(item)}
              testID={`attention-markread-${item.id}`}
              style={styles.actionBtn}
            />
            {item.ref.destination !== undefined ? (
              <SecondaryButton
                label="Open"
                icon="open-outline"
                disabled={pending}
                onPress={() => onOpenDestination(item)}
                testID={`attention-open-${item.id}`}
                style={styles.actionBtn}
              />
            ) : null}
          </View>
        );

      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rowHighlighted: {
    borderWidth: 2,
    borderColor: theme.color.primary,
    backgroundColor: theme.color.surfaceAlt,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  timestamp: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  summary: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  actionBtn: {
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  ratingLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  ratingInput: {
    minWidth: 48,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceAlt,
    color: theme.color.textPrimary,
    textAlign: 'center',
    ...theme.typography.subtitle,
  },
  ratingSuffix: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  errorIcon: {
    marginRight: 2,
  },
  errorText: {
    ...theme.typography.meta,
    color: theme.color.danger,
    flexShrink: 1,
  },
});
