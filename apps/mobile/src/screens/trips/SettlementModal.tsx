/**
 * Record / Edit Settlement Modal (Tasks 12.3, 12.4).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.7
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SettlementDTO, TripMemberDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import {
  createSettlement,
  editSettlement,
  tripExpenseKeys,
} from './tripExpenseApi';

interface Props {
  readonly visible: boolean;
  readonly tripId: string;
  readonly members: readonly TripMemberDTO[];
  readonly initialSettlement?: SettlementDTO | null | undefined;
  readonly prefillPayerId?: string | undefined;
  readonly prefillRecipientId?: string | undefined;
  readonly prefillAmountCents?: number | undefined;
  readonly onClose: () => void;
}

export function SettlementModal({
  visible,
  tripId,
  members,
  initialSettlement,
  prefillPayerId,
  prefillRecipientId,
  prefillAmountCents,
  onClose,
}: Props): JSX.Element {
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialSettlement);

  const [payerId, setPayerId] = useState(
    initialSettlement?.payerId ?? prefillPayerId ?? members[0]?.userId ?? '',
  );
  const [recipientId, setRecipientId] = useState(
    initialSettlement?.recipientId ?? prefillRecipientId ?? members[1]?.userId ?? '',
  );
  const [amountDollars, setAmountDollars] = useState(
    initialSettlement?.amountCents
      ? (initialSettlement.amountCents / 100).toFixed(2)
      : prefillAmountCents
      ? (prefillAmountCents / 100).toFixed(2)
      : '',
  );
  const [date, setDate] = useState(
    initialSettlement?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (initialSettlement) {
      setPayerId(initialSettlement.payerId);
      setRecipientId(initialSettlement.recipientId);
      setAmountDollars((initialSettlement.amountCents / 100).toFixed(2));
      setDate(initialSettlement.date);
    } else {
      if (prefillPayerId) setPayerId(prefillPayerId);
      if (prefillRecipientId) setRecipientId(prefillRecipientId);
      if (prefillAmountCents) setAmountDollars((prefillAmountCents / 100).toFixed(2));
      setDate(new Date().toISOString().slice(0, 10));
    }
    setErrorMessage(null);
  }, [visible, initialSettlement, prefillPayerId, prefillRecipientId, prefillAmountCents]);

  const settlementMutation = useMutation({
    mutationFn: () => {
      const cents = Math.round((parseFloat(amountDollars) || 0) * 100);
      if (cents <= 0) {
        throw new Error('Settlement amount must be greater than zero');
      }
      if (payerId === recipientId) {
        throw new Error('Payer and recipient must be distinct members');
      }

      const input = {
        payerId,
        recipientId,
        amountCents: cents,
        date,
      };

      return isEditing
        ? editSettlement(tripId, initialSettlement!.id, input)
        : createSettlement(tripId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.list(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
      onClose();
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save settlement');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent} testID="settlement-modal">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>
              {isEditing ? 'Edit Settlement' : 'Record a Settlement'}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-settlement-modal"
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color={theme.color.textPrimary} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Record payment directly between two members (e.g. via Venmo, Zelle, cash).
          </Text>

          {errorMessage ? (
            <View style={styles.errorBox} testID="settlement-error-box">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Who Paid */}
          <SectionLabel>WHO PAID (PAYER)?</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {members.map((m) => {
              const isSelected = m.userId === payerId;
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.memberChip, isSelected && styles.memberChipSelected]}
                  onPress={() => setPayerId(m.userId)}
                  testID={`settlement-payer-chip-${m.userId}`}
                >
                  <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
                    {m.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Who Received */}
          <SectionLabel>WHO RECEIVED (RECIPIENT)?</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {members.map((m) => {
              const isSelected = m.userId === recipientId;
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.memberChip, isSelected && styles.memberChipSelected]}
                  onPress={() => setRecipientId(m.userId)}
                  testID={`settlement-recipient-chip-${m.userId}`}
                >
                  <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
                    {m.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <SectionLabel>AMOUNT ($)</SectionLabel>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={theme.color.textSecondary}
            keyboardType="decimal-pad"
            value={amountDollars}
            onChangeText={setAmountDollars}
            testID="settlement-amount-input"
          />

          <SectionLabel>SETTLED DATE (YYYY-MM-DD)</SectionLabel>
          <TextInput
            style={styles.input}
            placeholder="2026-10-04"
            placeholderTextColor={theme.color.textSecondary}
            value={date}
            onChangeText={setDate}
            testID="settlement-date-input"
          />

          <View style={styles.footerRow}>
            <SecondaryButton label="Cancel" onPress={onClose} />
            <PrimaryButton
              label={isEditing ? 'Save Changes' : 'Record Settlement'}
              onPress={() => settlementMutation.mutate()}
              loading={settlementMutation.isPending}
              testID="submit-settlement-button"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(232, 80, 91, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  memberChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: theme.color.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  memberChipSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  memberChipText: {
    fontSize: 13,
    color: theme.color.textPrimary,
  },
  memberChipTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.color.textPrimary,
    marginBottom: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
});
