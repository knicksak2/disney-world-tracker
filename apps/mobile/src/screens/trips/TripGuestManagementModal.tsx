/**
 * Trip Guest Management Modal (Task 11.1).
 *
 * Allows adding, renaming, and removing Trip_Guests for a Trip.
 * Displays friendly message when removal is blocked due to active references (Req 2.9).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.9, 2.10
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
import type { TripGuestDTO, TripMemberDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import {
  addTripGuest,
  renameTripGuest,
  removeTripGuest,
  tripExpenseKeys,
} from './tripExpenseApi';
import { ApiError } from '../../api/client';

interface Props {
  readonly visible: boolean;
  readonly tripId: string;
  readonly guests: readonly TripGuestDTO[];
  readonly members: readonly TripMemberDTO[];
  readonly callerId: string;
  readonly isOrganizer: boolean;
  readonly onClose: () => void;
}

export function TripGuestManagementModal({
  visible,
  tripId,
  guests: initialGuests,
  members,
  callerId,
  isOrganizer,
  onClose,
}: Props): JSX.Element {
  const queryClient = useQueryClient();
  const [newGuestName, setNewGuestName] = useState('');
  const [addSponsorId, setAddSponsorId] = useState<string>(callerId);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [editSponsorId, setEditSponsorId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [guestList, setGuestList] = useState<readonly TripGuestDTO[]>(initialGuests);
  useEffect(() => {
    setGuestList(initialGuests);
  }, [initialGuests]);

  useEffect(() => {
    setAddSponsorId(callerId);
  }, [callerId, visible]);

  const memberNameMap = new Map(members.map((m) => [m.userId, m.displayName]));

  const addMutation = useMutation({
    mutationFn: ({ name, sponsorMemberId }: { name: string; sponsorMemberId: string }) =>
      addTripGuest(tripId, { name, sponsorMemberId }),
    onSuccess: (createdGuest) => {
      setNewGuestName('');
      setAddSponsorId(callerId);
      setErrorMessage(null);
      setGuestList((prev) => [...prev, createdGuest]);
      queryClient.setQueryData<readonly TripGuestDTO[]>(
        tripExpenseKeys.guests(tripId),
        (old = []) => [...old, createdGuest],
      );
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.guests(tripId) });
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to add guest');
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({
      guestId,
      name,
      sponsorMemberId,
    }: {
      guestId: string;
      name: string;
      sponsorMemberId?: string | null;
    }) =>
      renameTripGuest(tripId, guestId, {
        name,
        ...(sponsorMemberId ? { sponsorMemberId } : {}),
      }),
    onSuccess: (updatedGuest) => {
      setEditingGuestId(null);
      setRenameText('');
      setEditSponsorId(null);
      setErrorMessage(null);
      setGuestList((prev) =>
        prev.map((g) => (g.id === updatedGuest.id ? updatedGuest : g)),
      );
      queryClient.setQueryData<readonly TripGuestDTO[]>(
        tripExpenseKeys.guests(tripId),
        (old = []) => old.map((g) => (g.id === updatedGuest.id ? updatedGuest : g)),
      );
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.guests(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.list(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to rename guest');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (guestId: string) => removeTripGuest(tripId, guestId),
    onSuccess: (_, guestId) => {
      setErrorMessage(null);
      setGuestList((prev) => prev.filter((g) => g.id !== guestId));
      queryClient.setQueryData<readonly TripGuestDTO[]>(
        tripExpenseKeys.guests(tripId),
        (old = []) => old.filter((g) => g.id !== guestId),
      );
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.guests(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.list(tripId) });
      queryClient.invalidateQueries({ queryKey: tripExpenseKeys.balances(tripId) });
    },
    onError: (err: unknown) => {
      const isValidationError =
        (err instanceof ApiError && err.code === 'trip_validation_failed') ||
        (err != null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: unknown }).code === 'trip_validation_failed');

      if (isValidationError) {
        setErrorMessage(
          'This guest cannot be removed because they are referenced by one or more expenses.',
        );
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to remove guest');
      }
    },
  });

  const handleAdd = () => {
    const trimmed = newGuestName.trim();
    if (!trimmed) return;
    addMutation.mutate({ name: trimmed, sponsorMemberId: addSponsorId });
  };

  const handleStartRename = (guest: TripGuestDTO) => {
    setEditingGuestId(guest.id);
    setRenameText(guest.name);
    setEditSponsorId(guest.sponsorMemberId);
    setErrorMessage(null);
  };

  const handleSaveRename = (guestId: string) => {
    const trimmed = renameText.trim();
    if (!trimmed) return;
    renameMutation.mutate({
      guestId,
      name: trimmed,
      sponsorMemberId: editSponsorId,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent} testID="trip-guest-management-modal">
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Manage Trip Guests</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-guest-modal"
              hitSlop={12}
            >
              <Ionicons name="close" size={24} color={theme.color.textPrimary} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Guests represent party members (such as kids or partners) without a Disney World Tracker account. Their expenses are sponsored by a trip member.
          </Text>

          {errorMessage ? (
            <View style={styles.errorBox} testID="guest-management-error">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Add Guest Form */}
          <View style={styles.addSection}>
            <SectionLabel>ADD A NEW GUEST</SectionLabel>
            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                placeholder="Guest name (e.g. Little Timmy)"
                placeholderTextColor={theme.color.textSecondary}
                value={newGuestName}
                onChangeText={setNewGuestName}
                testID="add-guest-name-input"
              />
              <PrimaryButton
                label="Add"
                onPress={handleAdd}
                loading={addMutation.isPending}
                testID="add-guest-button"
              />
            </View>

            {members.length > 0 ? (
              <View style={styles.sponsorSelectContainer}>
                <Text style={styles.sponsorSelectLabel}>Tied to (Sponsored by):</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {members.map((m) => {
                    const isSelected = m.userId === addSponsorId;
                    return (
                      <Pressable
                        key={m.userId}
                        style={[styles.sponsorChip, isSelected && styles.sponsorChipSelected]}
                        onPress={() => setAddSponsorId(m.userId)}
                        accessibilityRole="button"
                        testID={`add-guest-sponsor-${m.userId}`}
                      >
                        <Text
                          style={[
                            styles.sponsorChipText,
                            isSelected && styles.sponsorChipTextSelected,
                          ]}
                        >
                          {m.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>

          {/* Guest Roster */}
          <SectionLabel>{`ROSTER (${guestList.length})`}</SectionLabel>
          <ScrollView style={styles.guestList}>
            {guestList.length === 0 ? (
              <Text style={styles.emptyText}>No guests added yet for this trip.</Text>
            ) : (
              guestList.map((g) => {
                const sponsorName = memberNameMap.get(g.sponsorMemberId) ?? 'Member';
                const canManage = isOrganizer || g.sponsorMemberId === callerId;
                const isEditing = editingGuestId === g.id;

                return (
                  <Card key={g.id} style={styles.guestCard} testID={`guest-card-${g.id}`}>
                    {isEditing ? (
                      <View style={styles.editSection}>
                        <View style={styles.renameRow}>
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={renameText}
                            onChangeText={setRenameText}
                            testID={`rename-guest-input-${g.id}`}
                          />
                          <PrimaryButton
                            label="Save"
                            onPress={() => handleSaveRename(g.id)}
                            loading={renameMutation.isPending}
                            testID={`save-rename-guest-${g.id}`}
                          />
                          <SecondaryButton
                            label="Cancel"
                            onPress={() => {
                              setEditingGuestId(null);
                              setEditSponsorId(null);
                            }}
                          />
                        </View>
                        {members.length > 0 ? (
                          <View style={styles.editSponsorContainer}>
                            <Text style={styles.sponsorSelectLabel}>Tied to (Sponsored by):</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                              {members.map((m) => {
                                const isSelected = m.userId === editSponsorId;
                                return (
                                  <Pressable
                                    key={m.userId}
                                    style={[styles.sponsorChip, isSelected && styles.sponsorChipSelected]}
                                    onPress={() => setEditSponsorId(m.userId)}
                                    accessibilityRole="button"
                                    testID={`edit-guest-sponsor-${g.id}-${m.userId}`}
                                  >
                                    <Text
                                      style={[
                                        styles.sponsorChipText,
                                        isSelected && styles.sponsorChipTextSelected,
                                      ]}
                                    >
                                      {m.displayName}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.guestRow}>
                        <View style={styles.guestInfo}>
                          <Text style={styles.guestName} testID={`guest-name-${g.id}`}>
                            {g.name}
                          </Text>
                          <Text style={styles.guestSponsor}>
                            Sponsored by {sponsorName}
                          </Text>
                        </View>
                        {canManage ? (
                          <View style={styles.actionRow}>
                            <Pressable
                              style={styles.iconBtn}
                              onPress={() => handleStartRename(g)}
                              accessibilityRole="button"
                              accessibilityLabel={`Rename ${g.name}`}
                              testID={`rename-guest-btn-${g.id}`}
                            >
                              <Ionicons name="pencil-outline" size={18} color={theme.color.primary} />
                            </Pressable>
                            <Pressable
                              style={styles.iconBtn}
                              onPress={() => removeMutation.mutate(g.id)}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${g.name}`}
                              testID={`remove-guest-btn-${g.id}`}
                            >
                              <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    )}
                  </Card>
                );
              })
            )}
          </ScrollView>
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
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
    lineHeight: 18,
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
  addSection: {
    marginBottom: 16,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  input: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  guestList: {
    maxHeight: 300,
    marginTop: 8,
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 16,
  },
  guestCard: {
    marginBottom: 8,
    padding: 12,
  },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  guestInfo: {
    flex: 1,
  },
  guestName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  guestSponsor: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  iconBtn: {
    padding: 6,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editSection: {
    width: '100%',
  },
  sponsorSelectContainer: {
    marginTop: 10,
  },
  editSponsorContainer: {
    marginTop: 10,
  },
  sponsorSelectLabel: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginBottom: 6,
    fontWeight: '500',
  },
  chipScroll: {
    marginBottom: 4,
  },
  sponsorChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.color.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  sponsorChipSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  sponsorChipText: {
    fontSize: 13,
    color: theme.color.textPrimary,
  },
  sponsorChipTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
});

export default TripGuestManagementModal;
