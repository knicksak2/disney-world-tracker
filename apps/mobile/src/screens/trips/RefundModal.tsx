/**
 * Refund Modal (Requirement 12.1, 12.4, 12.5, Task 10.7).
 *
 * Allows recording a partial or full refund against an existing Expense.
 * Shows running refund total and resulting effective net amount.
 *
 * Validates: Requirements 12.1, 12.4, 12.5
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExpenseDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import {
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import { createRefund, tripExpenseKeys } from './tripExpenseApi';

interface Props {
  readonly visible: boolean;
  readonly tripId: string;
  readonly expense: ExpenseDTO;
  readonly onClose: () => void;
}

export function RefundModal({
  visible,
  tripId,
  expense,
  onClose,
}: Props): JSX.Element {
  const queryClient = useQueryClient();
  const [amountDollars, setAmountDollars] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const existingRefundsCents = expense.refunds.reduce(
    (sum, r) => sum + r.amountCents,
    0,
  );
  const currentNetCents = Math.max(0, expense.amountCents - existingRefundsCents);

  const newRefundCents = Math.round((parseFloat(amountDollars) || 0) * 100);
  const projectedNetCents = Math.max(0, currentNetCents - newRefundCents);

  const refundMutation = useMutation({
    mutationFn: () => {
      if (newRefundCents <= 0) {
        throw new Error('Refund amount must be greater than zero');
      }
      if (existingRefundsCents + newRefundCents > expense.amountCents) {
        throw new Error('Total refunds cannot exceed the original expense amount');
      }
      return createRefund(tripId, expense.id, {
        amountCents: newRefundCents,
        date,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.list(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
      onClose();
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to record refund');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent} testID="refund-modal">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Record a Refund</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-refund-modal"
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color={theme.color.textPrimary} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Refund against: <Text style={{ fontWeight: '600' }}>{expense.description}</Text>
          </Text>

          {errorMessage ? (
            <View style={styles.errorBox} testID="refund-error-box">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Running totals context (Req 12.4 presentation) */}
          <View style={styles.contextCard} testID="refund-context-card">
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Original Expense:</Text>
              <Text style={styles.contextValue}>
                ${(expense.amountCents / 100).toFixed(2)}
              </Text>
            </View>
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Already Refunded:</Text>
              <Text style={styles.contextValue}>
                ${(existingRefundsCents / 100).toFixed(2)}
              </Text>
            </View>
            <View style={[styles.contextRow, styles.contextRowHighlight]}>
              <Text style={styles.contextLabelBold}>Current Net Amount:</Text>
              <Text style={styles.contextValueBold}>
                ${(currentNetCents / 100).toFixed(2)}
              </Text>
            </View>
          </View>

          <SectionLabel>REFUND AMOUNT ($)</SectionLabel>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={theme.color.textSecondary}
            keyboardType="decimal-pad"
            value={amountDollars}
            onChangeText={setAmountDollars}
            testID="refund-amount-input"
          />

          <SectionLabel>REFUND DATE (YYYY-MM-DD)</SectionLabel>
          <TextInput
            style={styles.input}
            placeholder="2026-10-04"
            placeholderTextColor={theme.color.textSecondary}
            value={date}
            onChangeText={setDate}
            testID="refund-date-input"
          />

          {newRefundCents > 0 ? (
            <View style={styles.projectedBox}>
              <Text style={styles.projectedText}>
                Projected Net: ${(projectedNetCents / 100).toFixed(2)}
              </Text>
            </View>
          ) : null}

          <View style={styles.footerRow}>
            <SecondaryButton label="Cancel" onPress={onClose} />
            <PrimaryButton
              label="Save Refund"
              onPress={() => refundMutation.mutate()}
              loading={refundMutation.isPending}
              testID="submit-refund-button"
            />
          </View>
        </View>
      </KeyboardAvoidingView>
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
    fontSize: 14,
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
  contextCard: {
    backgroundColor: theme.color.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginBottom: 16,
  },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  contextRowHighlight: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: 6,
    marginTop: 4,
    marginBottom: 0,
  },
  contextLabel: {
    fontSize: 13,
    color: theme.color.textSecondary,
  },
  contextValue: {
    fontSize: 13,
    color: theme.color.textPrimary,
  },
  contextLabelBold: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  contextValueBold: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.color.primary,
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
  projectedBox: {
    backgroundColor: 'rgba(91, 42, 134, 0.08)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  projectedText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.primary,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
});
