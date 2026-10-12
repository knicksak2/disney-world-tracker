/**
 * Resort Picker Modal for Trip Expenses (Requirement 11.2, 11.3, Task 15.1).
 *
 * Allows selecting a Catalog Resort when Expense Category is 'hotel'.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { theme } from '../../theme/theme';
import { apiRequest } from '../../api/client';

export interface ResortItem {
  readonly id: string;
  readonly name: string;
}

interface Props {
  readonly visible: boolean;
  readonly selectedResortId?: string | null | undefined;
  readonly onSelect: (resort: ResortItem) => void;
  readonly onClose: () => void;
}

export function ResortPickerModal({
  visible,
  selectedResortId,
  onSelect,
  onClose,
}: Props): JSX.Element {
  const [search, setSearch] = useState('');

  const resortsQuery = useQuery<{ resorts: readonly ResortItem[] }>({
    queryKey: ['resorts', 'active'],
    queryFn: () => apiRequest<{ resorts: readonly ResortItem[] }>('GET', '/resorts'),
    enabled: visible,
  });

  const allResorts = resortsQuery.data?.resorts ?? [];
  const filtered = search.trim()
    ? allResorts.filter((r) => r.name.toLowerCase().includes(search.toLowerCase().trim()))
    : allResorts;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content} testID="resort-picker-modal">
          <View style={styles.header}>
            <Text style={styles.title}>Select Resort Hotel</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-resort-picker"
            >
              <Ionicons name="close" size={24} color={theme.color.textPrimary} />
            </Pressable>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search Disney resorts..."
            placeholderTextColor={theme.color.textSecondary}
            value={search}
            onChangeText={setSearch}
            testID="resort-search-input"
          />

          {resortsQuery.isLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.color.primary} />
          ) : (
            <ScrollView style={styles.list}>
              {filtered.length === 0 ? (
                <Text style={styles.emptyText}>No matching resorts found.</Text>
              ) : (
                filtered.map((resort) => {
                  const isSelected = resort.id === selectedResortId;
                  return (
                    <Pressable
                      key={resort.id}
                      style={[styles.resortRow, isSelected && styles.resortRowSelected]}
                      onPress={() => {
                        onSelect(resort);
                        onClose();
                      }}
                      testID={`resort-option-${resort.id}`}
                    >
                      <Ionicons
                        name="bed-outline"
                        size={18}
                        color={isSelected ? theme.color.primary : theme.color.textSecondary}
                      />
                      <Text style={[styles.resortName, isSelected && styles.resortNameSelected]}>
                        {resort.name}
                      </Text>
                      {isSelected ? (
                        <Ionicons name="checkmark" size={18} color={theme.color.primary} />
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  searchInput: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.color.textPrimary,
    marginBottom: 12,
  },
  list: {
    maxHeight: 350,
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 20,
  },
  resortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  resortRowSelected: {
    backgroundColor: 'rgba(91, 42, 134, 0.08)',
    borderRadius: 8,
  },
  resortName: {
    flex: 1,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  resortNameSelected: {
    fontWeight: '600',
    color: theme.color.primary,
  },
});
