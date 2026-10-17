/**
 * Packing Item Form Modal (Task 11.6).
 * Supports adding and editing packing items.
 *
 * Validates: Requirements 13.6, 13.7, 13.12
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
import {
  PACKING_CATEGORIES,
  type PackingCategory,
  type PackingItemCreateInput,
} from '@dwt/shared';

import { PrimaryButton, SecondaryButton, SectionLabel } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { PACKING_ITEM_FORM_MODAL } from './PackingItemFormModal.palette';
import { validatePackingForm } from './packingListView';

export interface PackingItemFormModalProps {
  readonly visible: boolean;
  readonly mode?: 'add' | 'edit';
  readonly initialItem?: {
    readonly id?: string;
    readonly name: string;
    readonly category: PackingCategory;
    readonly quantity: number;
    readonly assigneeId: string | null;
  } | null;
  readonly members: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly onSubmit: (values: PackingItemCreateInput) => void;
  readonly onClose: () => void;
  readonly onCancel?: () => void;
}

const CATEGORY_LABELS: Record<PackingCategory, string> = {
  documents: 'Documents',
  clothing: 'Clothing',
  toiletries: 'Toiletries',
  health: 'Health',
  tech: 'Tech',
  park_gear: 'Park Gear',
  kids: 'Kids',
  other: 'Other',
};

export function PackingItemFormModal({
  visible,
  mode = 'add',
  initialItem,
  members,
  onSubmit,
  onClose,
  onCancel,
}: PackingItemFormModalProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(PACKING_ITEM_FORM_MODAL);

  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<PackingCategory>(PACKING_CATEGORIES[0]);
  const [quantity, setQuantity] = useState<string>('1');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClose = onCancel ?? onClose;

  useEffect(() => {
    if (visible) {
      setName(initialItem?.name ?? '');
      setCategory(initialItem?.category ?? PACKING_CATEGORIES[0]);
      setQuantity(initialItem ? String(initialItem.quantity) : '1');
      setAssigneeId(initialItem?.assigneeId ?? null);
      setErrorMessage(null);
    }
  }, [visible, initialItem]);

  const handleSubmit = () => {
    const trimmedQty = quantity.trim();
    const numQty = trimmedQty === '' ? 1 : Number(trimmedQty);

    const validation = validatePackingForm({
      name,
      category,
      quantity: numQty,
      assigneeId: assigneeId ?? null,
    });

    if (!validation.ok) {
      setErrorMessage(
        validation.field === 'name'
          ? 'Invalid name: must be 1 to 80 characters'
          : validation.field === 'quantity'
            ? 'Invalid quantity: must be an integer between 1 and 99'
            : `Invalid ${validation.field}: ${validation.message}`,
      );
      return;
    }

    setErrorMessage(null);
    onSubmit(validation.data);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.modalOverlay, { backgroundColor: pal.overlayBg }]}
      >
        <View style={styles.modalContent} testID="packing-item-form-modal">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>
              {mode === 'edit' ? 'Edit Packing Item' : 'Add Packing Item'}
            </Text>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              testID="close-packing-item-modal"
            >
              <Ionicons name="close" size={24} color={t.color.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} keyboardShouldPersistTaps="handled">
            {errorMessage ? (
              <View
                style={[styles.errorBox, { backgroundColor: pal.errorBg }]}
                testID="packing-form-error"
              >
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Name Input */}
            <View style={styles.section}>
              <SectionLabel>ITEM NAME</SectionLabel>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={(val) => {
                  setName(val);
                  setErrorMessage(null);
                }}
                placeholder="e.g. Sunscreen, MagicBand"
                placeholderTextColor={t.color.textSecondary}
                accessibilityLabel="Item name"
                testID="packing-item-name-input"
                maxLength={100}
              />
            </View>

            {/* Quantity Input */}
            <View style={styles.section}>
              <SectionLabel>QUANTITY</SectionLabel>
              <TextInput
                style={styles.textInput}
                value={quantity}
                onChangeText={(val) => {
                  setQuantity(val);
                  setErrorMessage(null);
                }}
                keyboardType="numeric"
                placeholder="1"
                placeholderTextColor={t.color.textSecondary}
                accessibilityLabel="Quantity"
                testID="packing-item-quantity-input"
              />
            </View>

            {/* Category Chips */}
            <View style={styles.section}>
              <SectionLabel>CATEGORY</SectionLabel>
              <View style={styles.chipGrid}>
                {PACKING_CATEGORIES.map((cat) => {
                  const isSelected = category === cat;
                  const label = CATEGORY_LABELS[cat];
                  return (
                    <Pressable
                      key={cat}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={label}
                      onPress={() => {
                        setCategory(cat);
                        setErrorMessage(null);
                      }}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      testID={`category-chip-${cat}`}
                    >
                      <Text
                        style={[styles.chipText, isSelected && styles.chipTextSelected]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Assignee Chips */}
            <View style={styles.section}>
              <SectionLabel>ASSIGN TO</SectionLabel>
              <View style={styles.chipGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: assigneeId === null }}
                  accessibilityLabel="No one"
                  onPress={() => {
                    setAssigneeId(null);
                    setErrorMessage(null);
                  }}
                  style={[styles.chip, assigneeId === null && styles.chipSelected]}
                  testID="assignee-chip-none"
                >
                  <Text
                    style={[
                      styles.chipText,
                      assigneeId === null && styles.chipTextSelected,
                    ]}
                  >
                    No one
                  </Text>
                </Pressable>
                {members.map((member) => {
                  const isSelected = assigneeId === member.id;
                  return (
                    <Pressable
                      key={member.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={member.displayName}
                      onPress={() => {
                        setAssigneeId(member.id);
                        setErrorMessage(null);
                      }}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      testID={`assignee-chip-${member.id}`}
                    >
                      <Text
                        style={[styles.chipText, isSelected && styles.chipTextSelected]}
                      >
                        {member.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footerRow}>
            <View style={styles.buttonHalf}>
              <SecondaryButton
                label="Cancel"
                onPress={handleClose}
                testID="cancel-packing-item-btn"
              />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton
                label={mode === 'edit' ? 'Save Changes' : 'Add Item'}
                onPress={handleSubmit}
                testID="submit-packing-item-btn"
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  headerTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  section: {
    marginBottom: 18,
  },
  textInput: {
    ...t.typography.body,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
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
    fontWeight: '500',
  },
  chipTextSelected: {
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
  errorBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
  },
  footerRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  buttonHalf: {
    flex: 1,
  },
}));
