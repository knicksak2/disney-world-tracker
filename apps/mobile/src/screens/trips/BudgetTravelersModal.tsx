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
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/client';
import {
  AGE_BRACKETS,
  TICKET_OPTIONS,
  TICKET_DISCOUNT_GROUPS,
  TRAVELER_PASS_TYPES,
  type AgeBracket,
  type TicketOption,
  type TicketDiscountGroup,
  type TravelerPassType,
  type TravelerProfileDTO,
  type TravelerProfileInput,
} from '@dwt/shared';

import { DatePickerField } from '../../components/DatePickerField';
import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { BUDGET_TRAVELERS_MODAL } from './BudgetTravelersModal.palette';
import {
  usePutTravelerProfile,
  useDeleteTravelerProfile,
} from './budgetApi';

export interface TravelerOption {
  readonly id: string;
  readonly name: string;
  readonly isGuest?: boolean;
}

export interface BudgetTravelersModalProps {
  readonly visible: boolean;
  readonly tripId: string;
  readonly travelers?: readonly TravelerProfileDTO[] | undefined;
  readonly tripStart?: string | null | undefined;
  readonly members?: readonly TravelerOption[] | undefined;
  readonly guests?: readonly TravelerOption[] | undefined;
  readonly onClose: () => void;
  readonly testID?: string | undefined;
}

const AGE_BRACKET_LABELS: Record<AgeBracket, string> = {
  adult: 'Adult (10+)',
  child: 'Child (3–9)',
  under3: 'Under 3 (Free)',
};

const PASS_TYPE_LABELS: Record<TravelerPassType, string> = {
  none: 'Regular Ticket',
  annual_pass: 'Annual Pass',
  dvc: 'DVC Member',
  other_discount: 'Military / Other Pass',
};

const DISCOUNT_GROUP_LABELS: Record<TicketDiscountGroup, string> = {
  'std-gst': 'Standard',
  'fl-resident': 'FL Resident',
};

const TICKET_OPTION_LABELS: Record<TicketOption, string> = {
  base: '1-Park Base',
  park_hopper: 'Park Hopper',
  park_hopper_plus: 'Park Hopper Plus',
  water_parks_sports: 'Water Parks & Sports',
};

export function BudgetTravelersModal({
  visible,
  tripId,
  travelers = [],
  tripStart = null,
  members = [],
  guests = [],
  onClose,
  testID = 'budget-travelers-modal',
}: BudgetTravelersModalProps) {
  const styles = useStyles();
  const palette = usePalette(BUDGET_TRAVELERS_MODAL);
  const queryClient = useQueryClient();

  const putMutation = usePutTravelerProfile(tripId);
  const deleteMutation = useDeleteTravelerProfile(tripId);

  // Guest addition on the fly
  const [newGuestName, setNewGuestName] = useState<string>('');
  const [isAddingGuest, setIsAddingGuest] = useState<boolean>(false);

  const handleAddGuest = async () => {
    const trimmed = newGuestName.trim();
    if (!trimmed) return;
    setIsAddingGuest(true);
    try {
      await apiRequest('POST', `/trips/${tripId}/guests`, { name: trimmed });
      await queryClient.invalidateQueries({ queryKey: ['trip-guests', tripId] });
      await queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      await queryClient.invalidateQueries({ queryKey: ['trip-travelers', tripId] });
      setNewGuestName('');
    } catch (err) {
      console.error('[BudgetTravelersModal] Failed to add guest:', err);
    } finally {
      setIsAddingGuest(false);
    }
  };

  // Active editing state
  const [editingPersonKey, setEditingPersonKey] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingIsGuest, setEditingIsGuest] = useState<boolean>(false);
  const [editingLabel, setEditingLabel] = useState<string>('');

  // Form field states
  const [ageBracket, setAgeBracket] = useState<AgeBracket>('adult');
  const [passType, setPassType] = useState<TravelerPassType>('none');
  const [discountGroup, setDiscountGroup] = useState<TicketDiscountGroup>('std-gst');
  const [ticketOption, setTicketOption] = useState<TicketOption>('base');
  const [ticketDays, setTicketDays] = useState<number>(1);
  const [ticketStartDate, setTicketStartDate] = useState<string | null>(tripStart);

  const startEdit = (profile: TravelerProfileDTO) => {
    const personKey = profile.memberId ?? profile.guestId ?? profile.id;
    setEditingPersonKey(personKey);
    setEditingProfileId(profile.id);
    setEditingIsGuest(Boolean(profile.guestId));
    setEditingLabel(profile.label);
    setAgeBracket(profile.ageBracket);
    setPassType(profile.passType);
    setDiscountGroup(profile.discountGroup);
    setTicketOption(profile.ticketOption ?? 'base');
    setTicketDays(profile.ticketDays ?? 1);
    setTicketStartDate(profile.ticketStartDate ?? tripStart);
  };

  const startAddForPerson = (person: TravelerOption) => {
    setEditingPersonKey(person.id);
    setEditingProfileId(null);
    setEditingIsGuest(Boolean(person.isGuest));
    setEditingLabel(person.name);
    setAgeBracket('adult');
    setPassType('none');
    setDiscountGroup('std-gst');
    setTicketOption('base');
    setTicketDays(1);
    setTicketStartDate(tripStart);
  };

  const cancelEdit = () => {
    setEditingPersonKey(null);
    setEditingProfileId(null);
  };

  const handleSave = async () => {
    if (!editingPersonKey) return;
    const input: TravelerProfileInput = {
      ...(editingIsGuest
        ? { guestId: editingPersonKey }
        : { memberId: editingPersonKey }),
      ageBracket,
      ticketOption: ageBracket === 'under3' ? null : ticketOption,
      ticketDays: ageBracket === 'under3' ? null : ticketDays,
      ticketStartDate: ageBracket === 'under3' ? null : ticketStartDate,
      discountGroup,
      passType,
    };

    try {
      await putMutation.mutateAsync(input);
      cancelEdit();
    } catch {
      // mutation error handled by hook
    }
  };

  const handleDelete = async (profileId: string) => {
    try {
      await deleteMutation.mutateAsync(profileId);
      if (editingProfileId === profileId) {
        cancelEdit();
      }
    } catch {
      // mutation error handled by hook
    }
  };

  // Find people on the trip who don't yet have a profile
  const existingPersonKeys = new Set(
    travelers.map((t) => t.memberId ?? t.guestId ?? '')
  );
  const unconfiguredPeople: TravelerOption[] = [
    ...members.filter((m) => !existingPersonKeys.has(m.id)),
    ...guests.filter((g) => !existingPersonKeys.has(g.id)),
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} testID={testID}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
          <Text style={styles.title}>Traveler Profiles</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.scroll}>
          {/* Active Edit Form */}
          {editingPersonKey && (
            <View style={styles.editorCard}>
              <View style={styles.editorHeaderRow}>
                <Ionicons name="person-circle-outline" size={20} color={palette.noteText} />
                <Text style={styles.editorTitle}>Edit Profile: {editingLabel}</Text>
              </View>

              {/* Age Bracket */}
              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Age Group</Text>
                <View style={styles.chipRow}>
                  {AGE_BRACKETS.map((ab) => {
                    const isSelected = ageBracket === ab;
                    return (
                      <Pressable
                        key={ab}
                        accessibilityRole="button"
                        accessibilityLabel={`Age ${ab}`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => setAgeBracket(ab)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected
                              ? palette.chipActiveBg
                              : palette.chipInactiveBg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color: isSelected
                                ? palette.chipActiveText
                                : palette.chipInactiveText,
                            },
                          ]}
                        >
                          {AGE_BRACKET_LABELS[ab]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {/* Note when under3 */}
                {ageBracket === 'under3' && (
                  <Text
                    style={[styles.noteText, { color: palette.noteText }]}
                    accessibilityLabel="No ticket needed"
                  >
                    No ticket needed
                  </Text>
                )}
              </View>

              {/* Pass Type */}
              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Pass / Admission Type</Text>
                <View style={styles.chipRow}>
                  {TRAVELER_PASS_TYPES.map((pt) => {
                    const isSelected = passType === pt;
                    return (
                      <Pressable
                        key={pt}
                        accessibilityRole="button"
                        accessibilityLabel={`Pass type ${pt}`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => setPassType(pt)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected
                              ? palette.chipActiveBg
                              : palette.chipInactiveBg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color: isSelected
                                ? palette.chipActiveText
                                : palette.chipInactiveText,
                            },
                          ]}
                        >
                          {PASS_TYPE_LABELS[pt]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {/* Note when passType is not none */}
                {passType !== 'none' && (
                  <Text
                    style={[styles.noteText, { color: palette.noteText }]}
                    accessibilityLabel="Enter your price"
                  >
                    Enter your price
                  </Text>
                )}
              </View>

              {/* Ticket details if not under3 */}
              {ageBracket !== 'under3' && (
                <>
                  {/* Discount Group */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldLabel}>Pricing Tier</Text>
                    <View style={styles.chipRow}>
                      {TICKET_DISCOUNT_GROUPS.map((dg) => {
                        const isSelected = discountGroup === dg;
                        return (
                          <Pressable
                            key={dg}
                            accessibilityRole="button"
                            accessibilityLabel={`Discount group ${dg}`}
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setDiscountGroup(dg)}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isSelected
                                  ? palette.chipActiveBg
                                  : palette.chipInactiveBg,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: isSelected
                                    ? palette.chipActiveText
                                    : palette.chipInactiveText,
                                },
                              ]}
                            >
                              {DISCOUNT_GROUP_LABELS[dg]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Ticket Option */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldLabel}>Ticket Option</Text>
                    <View style={styles.chipRow}>
                      {TICKET_OPTIONS.map((opt) => {
                        const isSelected = ticketOption === opt;
                        return (
                          <Pressable
                            key={opt}
                            accessibilityRole="button"
                            accessibilityLabel={`Ticket option ${opt}`}
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setTicketOption(opt)}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isSelected
                                  ? palette.chipActiveBg
                                  : palette.chipInactiveBg,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: isSelected
                                    ? palette.chipActiveText
                                    : palette.chipInactiveText,
                                },
                              ]}
                            >
                              {TICKET_OPTION_LABELS[opt]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Ticket Days */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldLabel}>Ticket Days (1–10)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => {
                        const isSelected = ticketDays === d;
                        return (
                          <Pressable
                            key={d}
                            accessibilityRole="button"
                            accessibilityLabel={`${d} days`}
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setTicketDays(d)}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isSelected
                                  ? palette.chipActiveBg
                                  : palette.chipInactiveBg,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: isSelected
                                    ? palette.chipActiveText
                                    : palette.chipInactiveText,
                                },
                              ]}
                            >
                              {d}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Start Date */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldLabel}>Ticket Start Date</Text>
                    <DatePickerField
                      accessibilityLabel="Ticket start date"
                      value={ticketStartDate ?? ''}
                      onChange={setTicketStartDate}
                    />
                  </View>
                </>
              )}

              {/* Form Actions */}
              <View style={styles.formActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel edit"
                  onPress={cancelEdit}
                  style={styles.formCancelBtn}
                >
                  <Text style={styles.formCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save profile"
                  onPress={handleSave}
                  style={styles.formSaveBtn}
                >
                  <Text style={styles.formSaveText}>Save Profile</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* List of configured traveler profiles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Configured Travelers</Text>
            <Text style={styles.sectionSubtitle}>
              Age brackets determine automatic ticket pricing and buffet quotes.
            </Text>
            {travelers.length === 0 ? (
              <Text style={styles.emptyText}>No traveler profiles configured yet.</Text>
            ) : (
              travelers.map((t) => (
                <View key={t.id} style={styles.travelerCard}>
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.travelerNameGroup}>
                      <View style={[styles.avatarCircle, { backgroundColor: palette.avatarBg }]}>
                        <Text style={[styles.avatarText, { color: palette.avatarText }]}>
                          {t.label.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.travelerName}>{t.label}</Text>
                        <Text style={styles.bracketRoleTag}>
                          {AGE_BRACKET_LABELS[t.ageBracket] ?? t.ageBracket} · {t.guestId ? 'Guest' : 'Member'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.btnRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit profile for ${t.label}`}
                        onPress={() => startEdit(t)}
                        style={styles.cardActionBtn}
                      >
                        <Text style={styles.cardActionText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete profile for ${t.label}`}
                        onPress={() => handleDelete(t.id)}
                        style={styles.cardDeleteBtn}
                      >
                        <Text style={[styles.cardDeleteText, { color: palette.deleteBtnText }]}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.cardDetails}>
                    <Text style={styles.detailLine}>
                      Age: {AGE_BRACKET_LABELS[t.ageBracket] ?? t.ageBracket}
                    </Text>
                    {t.ageBracket === 'under3' ? (
                      <Text
                        style={[styles.noteText, { color: palette.noteText }]}
                        accessibilityLabel="No ticket needed"
                      >
                        No ticket needed
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.detailLine}>
                          {t.ticketDays ?? 1}-Day{' '}
                          {TICKET_OPTION_LABELS[t.ticketOption ?? 'base'] ?? t.ticketOption} ·{' '}
                          {DISCOUNT_GROUP_LABELS[t.discountGroup] ?? t.discountGroup}
                        </Text>
                        {t.ticketStartDate && (
                          <Text style={styles.detailLine}>Starts: {t.ticketStartDate}</Text>
                        )}
                        {t.passType !== 'none' && (
                          <Text
                            style={[styles.noteText, { color: palette.noteText }]}
                            accessibilityLabel="Enter your price"
                          >
                            Pass: {PASS_TYPE_LABELS[t.passType] ?? t.passType} — Enter your price
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Unconfigured travelers from trip members / guests */}
          {unconfiguredPeople.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Add Profile for Traveler</Text>
              {unconfiguredPeople.map((person, idx) => {
                const itemKey = person.id
                  ? `${person.isGuest ? 'guest' : 'member'}-${person.id}`
                  : `unconf-${idx}`;
                return (
                  <View key={itemKey} style={styles.unconfiguredRow}>
                    <View style={styles.travelerNameGroup}>
                      <View style={[styles.avatarCircle, { backgroundColor: palette.avatarBg }]}>
                        <Text style={[styles.avatarText, { color: palette.avatarText }]}>
                          {person.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.unconfiguredName}>
                          {person.name}
                        </Text>
                        <Text style={styles.bracketRoleTag}>
                          {person.isGuest ? 'Guest' : 'Member'} · Needs Profile
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add profile for ${person.name}`}
                      onPress={() => startAddForPerson(person)}
                      style={styles.cardActionBtn}
                    >
                      <Text style={styles.cardActionText}>Add Profile</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {/* Direct Guest Addition inline form (Mockup Feature) */}
          <View style={styles.addGuestSection}>
            <Text style={styles.addGuestSectionTitle}>+ Add Traveler to Crew</Text>
            <Text style={styles.sectionSubtitle}>
              Add family members, partners, or friends to split expenses and tickets.
            </Text>
            <View style={styles.addGuestRow}>
              <TextInput
                style={styles.addGuestInput}
                placeholder="Traveler name (e.g. Wife, Kid)..."
                placeholderTextColor={palette.hintText}
                value={newGuestName}
                onChangeText={setNewGuestName}
              />
              <Pressable
                onPress={handleAddGuest}
                disabled={isAddingGuest || !newGuestName.trim()}
                style={[
                  styles.addGuestBtn,
                  { backgroundColor: palette.addBtnBg },
                  (!newGuestName.trim() || isAddingGuest) && { opacity: 0.6 },
                ]}
              >
                {isAddingGuest ? (
                  <ActivityIndicator size="small" color={palette.addBtnText} />
                ) : (
                  <Text style={[styles.addGuestBtnText, { color: palette.addBtnText }]}>+ Add</Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.color.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border,
    },
    closeBtn: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.sm,
    },
    closeText: {
      fontSize: 16,
      fontWeight: '600',
      color: t.color.primaryFg,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    headerSpacer: {
      width: 48,
    },
    scroll: {
      flex: 1,
      padding: t.spacing.md,
    },
    section: {
      marginBottom: t.spacing.lg,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: t.color.textPrimary,
      marginBottom: 2,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: t.color.textSecondary,
      marginBottom: t.spacing.sm,
    },
    emptyText: {
      fontSize: 14,
      color: t.color.textSecondary,
      fontStyle: 'italic',
    },
    travelerCard: {
      padding: t.spacing.md,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      marginBottom: t.spacing.sm,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: t.spacing.xs,
    },
    travelerNameGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    travelerName: {
      fontSize: 16,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    btnRow: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    cardActionBtn: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.sm,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.primary,
    },
    cardActionText: {
      color: t.color.textOnPrimary,
      fontWeight: '600',
      fontSize: 12,
    },
    cardDeleteBtn: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.sm,
      borderRadius: t.radius.sm,
    },
    cardDeleteText: {
      fontWeight: '600',
      fontSize: 12,
    },
    cardDetails: {
      marginTop: t.spacing.xs,
      gap: 2,
    },
    detailLine: {
      fontSize: 13,
      color: t.color.textSecondary,
    },
    noteText: {
      fontSize: 13,
      fontWeight: '600',
      marginTop: t.spacing.xs,
    },
    editorCard: {
      padding: t.spacing.md,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.primary,
      marginBottom: t.spacing.lg,
    },
    editorHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: t.spacing.md,
    },
    editorTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: t.color.textPrimary,
    },
    fieldSection: {
      marginBottom: t.spacing.md,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: t.color.textSecondary,
      marginBottom: t.spacing.xs,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.xs,
    },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: t.radius.pill,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
    },
    formActionsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: t.spacing.sm,
      marginTop: t.spacing.md,
    },
    formCancelBtn: {
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radius.sm,
    },
    formCancelText: {
      fontSize: 14,
      fontWeight: '600',
      color: t.color.textSecondary,
    },
    formSaveBtn: {
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.primary,
    },
    formSaveText: {
      fontSize: 14,
      fontWeight: '600',
      color: t.color.textOnPrimary,
    },
    unconfiguredRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border,
    },
    unconfiguredName: {
      fontSize: 15,
      color: t.color.textPrimary,
    },
    avatarCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 14,
      fontWeight: '700',
    },
    bracketRoleTag: {
      fontSize: 11,
      color: t.color.textSecondary,
      marginTop: 2,
    },
    addGuestSection: {
      marginTop: t.spacing.lg,
      padding: t.spacing.md,
      backgroundColor: t.color.surfaceAlt,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      marginBottom: t.spacing.xl,
    },
    addGuestSectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: t.color.textPrimary,
      marginBottom: 2,
    },
    addGuestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
    },
    addGuestInput: {
      flex: 1,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: t.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 13,
      color: t.color.textPrimary,
    },
    addGuestBtn: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addGuestBtnText: {
      fontSize: 13,
      fontWeight: '700',
    },
  })
);
