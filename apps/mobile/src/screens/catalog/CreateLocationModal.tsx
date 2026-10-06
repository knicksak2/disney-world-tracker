// Feature: food-item-logging, Task 7.6 — Create User-Submitted Location Modal
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  PARKS,
  type LocationSuggestionDTO,
  type Park,
  type UserSubmittedLocationDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

export interface CreateLocationModalProps {
  /** The currently-selected park for the location (optional, defaults to 'Magic Kingdom'). */
  readonly park?: Park;
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without creating. */
  readonly onClose: () => void;
  /** Called when a location is selected (either picked from suggestions or newly created). */
  readonly onLocationSelected: (location: UserSubmittedLocationDTO) => void;
}

const DEBOUNCE_MS = 300;

export default function CreateLocationModal({
  park = 'Magic Kingdom',
  visible,
  onClose,
  onLocationSelected,
}: CreateLocationModalProps): JSX.Element | null {
  const [selectedPark, setSelectedPark] = useState<Park>(park);
  const [name, setName] = useState<string>('');
  const [suggestions, setSuggestions] = useState<readonly LocationSuggestionDTO[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (park) {
      setSelectedPark(park);
    }
  }, [park]);

  // Debounce query GET /locations/suggest (Requirement 6.2, 7.2)
  useEffect(() => {
    if (!visible) {
      setName('');
      setSuggestions([]);
      setError(null);
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);
    const timer = setTimeout(async () => {
      try {
        const results = await apiRequest<
          | { readonly suggestions: readonly LocationSuggestionDTO[] }
          | readonly LocationSuggestionDTO[]
        >(
          'GET',
          `/locations/suggest?park=${encodeURIComponent(selectedPark)}&name=${encodeURIComponent(trimmed)}`,
        );
        const list = Array.isArray(results)
          ? results
          : ('suggestions' in results
            ? (results.suggestions ?? [])
            : []);
        setSuggestions(list);
      } catch {
        // Advisory suggest query failure should not block user
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [name, selectedPark, visible]);

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render (e.g. each debounced suggestion refetch), which `FlatList` treats
  // as a changed render function and forces the whole visible window to
  // re-render/re-measure. Same fix as `DestinationScreen`'s search-results
  // `renderRow`.
  const renderSuggestion = useCallback(
    ({ item }: { item: LocationSuggestionDTO }) => (
      <Pressable
        onPress={() => handleSelectSuggestion(item)}
        accessibilityRole="button"
        accessibilityLabel={`Select existing location ${item.name}`}
        style={({ pressed }) => [
          styles.suggestionRow,
          pressed && styles.suggestionRowPressed,
        ]}
        testID={`location-suggestion-${item.id}`}
      >
        <Ionicons name="location-outline" size={18} color={theme.color.primary} />
        <View style={styles.suggestionTextWrap}>
          <Text style={styles.suggestionName}>{item.name}</Text>
          <Text style={styles.suggestionPark}>{park}</Text>
        </View>
        <Text style={styles.matchScore}>
          {Math.round(item.similarity * 100)}% match
        </Text>
      </Pressable>
    ),
    [handleSelectSuggestion, park],
  );

  if (!visible) {
    return null;
  }

  function handleClose(): void {
    if (isCreating) return;
    setName('');
    setSuggestions([]);
    setError(null);
    onClose();
  }

  // Requirement 7.3: Selecting an existing suggested location routes directly
  // into picker without calling POST /locations
  function handleSelectSuggestion(suggestion: LocationSuggestionDTO): void {
    onLocationSelected({
      id: suggestion.id,
      name: suggestion.name,
      park,
    });
    handleClose();
  }

  // Requirement 7.4: Choosing Create calls POST /locations immediately
  async function handleCreateLocation(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a location name');
      return;
    }
    if (trimmed.length > 200) {
      setError('Location name must be 200 characters or fewer');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const created = await apiRequest<UserSubmittedLocationDTO>('POST', '/locations', {
        name: trimmed,
        park: selectedPark,
      });
      onLocationSelected(created);
      handleClose();
    } catch (err) {
      // Requirement 6.4: On exact duplicate, collapse to existing location
      if (err instanceof ApiError && err.code === 'location_duplicate') {
        const existingId = err.details?.['existingId'] as string | undefined;
        if (existingId) {
          onLocationSelected({
            id: existingId,
            name: trimmed,
            park: selectedPark,
          });
          handleClose();
          return;
        }
      }
      setError('Could not create location. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }

  const trimmedName = name.trim();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      testID="create-location-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Add Food Spot</Text>
              <Text style={styles.subtitle}>
                Can&apos;t find a snack cart or stand in {selectedPark}? Add it here.
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close create location modal"
              style={styles.closeBtn}
              testID="close-create-location-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Park Selection Chips */}
          <View style={styles.parkSection}>
            <Text style={styles.inputLabel}>Park</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.parkChipsContent}
              style={styles.parkChipsScroll}
            >
              {PARKS.map((p) => {
                const isSelected = p === selectedPark;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setSelectedPark(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select park ${p}`}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.parkChip, isSelected && styles.parkChipSelected]}
                    testID={`create-location-park-chip-${p.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Text style={[styles.parkChipText, isSelected && styles.parkChipTextSelected]}>
                      {p}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Form input */}
          <View style={styles.formSection}>
            <Text style={styles.inputLabel}>Location or Cart Name</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  if (error) setError(null);
                }}
                placeholder="e.g. Spring Roll Snack Cart"
                placeholderTextColor={theme.color.textSecondary}
                style={styles.textInput}
                maxLength={200}
                autoFocus
                testID="create-location-name-input"
              />
              {isLoadingSuggestions && (
                <ActivityIndicator
                  size="small"
                  color={theme.color.primary}
                  style={styles.loadingIcon}
                  testID="location-suggestions-loading"
                />
              )}
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>

          {/* Suggestions List (Requirement 6.2, 7.2) */}
          <View style={styles.suggestionsSection}>
            {suggestions.length > 0 && (
              <Text style={styles.suggestionsHeader}>
                Similar places already added (tap to use):
              </Text>
            )}

            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.id}
              renderItem={renderSuggestion}
              contentContainerStyle={styles.suggestionsList}
            />
          </View>

          {/* Create Action (Requirement 6.3, 7.4) */}
          <View style={styles.actionsRow}>
            <View style={styles.actionBtn}>
              <SecondaryButton label="Cancel" onPress={handleClose} disabled={isCreating} />
            </View>
            <View style={styles.actionBtn}>
              <PrimaryButton
                label={isCreating ? 'Creating...' : `Create "${trimmedName || 'New Location'}"`}
                onPress={() => void handleCreateLocation()}
                disabled={isCreating || !trimmedName}
                testID="create-location-submit-btn"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  formSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  parkSection: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  parkChipsScroll: {
    marginTop: 8,
  },
  parkChipsContent: {
    gap: 8,
    paddingRight: 8,
  },
  parkChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  parkChipSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  parkChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  parkChipTextSelected: {
    color: '#ffffff',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: 12,
    height: 44,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  loadingIcon: {
    marginLeft: 8,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
    marginTop: 6,
  },
  suggestionsSection: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  suggestionsHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textSecondary,
    marginBottom: 8,
  },
  suggestionsList: {
    paddingBottom: 12,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    marginBottom: 8,
    gap: 10,
  },
  suggestionRowPressed: {
    opacity: 0.7,
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  suggestionPark: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 1,
  },
  matchScore: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.accent,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
  },
});
