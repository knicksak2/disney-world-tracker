/**
 * Receipt-Scan Review Screen/Modal (Tasks 14.4, 15.3).
 *
 * Implements:
 * - Review and edit every draft Expense_Item and Charge_Line before submission (Req 9.3).
 * - Detected subtotal displayed as context only (Req 9.6).
 * - Pre-checked editable isAlcohol suggestion per item (Req 9.8).
 * - Friendly fallback when zero items are detected (Req 9.5).
 * - Menu item name cross-check suggestion against cached restaurant menu (Req 9.9).
 * - Multi-photo scanning, append, and per-photo discard controls (Req 9.10, 9.11, 9.12).
 * - Item merge, split, delete, and assignee assignment (Req 9.3).
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TripGuestDTO, TripMemberDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import {
  type DraftReceiptItem,
  type DraftReceiptChargeLine,
  type ScannedPhotoReceipt,
  createScannedPhotoReceipt,
  matchMenuItemName,
} from './receiptScan.pure';
import {
  scanReceiptPhoto,
  isNativeOcrAvailable,
  type ReceiptImageSource,
} from './receiptScan.native';

export interface ReceiptReviewItem extends DraftReceiptItem {
  id: string;
  userEditedName?: boolean | undefined;
  sourcePhotoId?: string | undefined;
}

export interface ReceiptReviewChargeLine extends DraftReceiptChargeLine {
  id: string;
  sourcePhotoId?: string | undefined;
}

export interface ReceiptReviewModalProps {
  readonly visible: boolean;
  readonly members: readonly TripMemberDTO[];
  readonly guests: readonly TripGuestDTO[];
  readonly callerId: string;
  readonly initialPhotos?: readonly ScannedPhotoReceipt[] | undefined;
  readonly initialRawText?: string | undefined;
  readonly restaurantMenuNames?: readonly string[] | undefined;
  readonly onConfirm: (items: ReceiptReviewItem[], chargeLines: ReceiptReviewChargeLine[]) => void;
  readonly onFallbackToManual: () => void;
  readonly onClose: () => void;
}

export function ReceiptReviewModal({
  visible,
  members,
  guests,
  callerId,
  initialPhotos,
  initialRawText,
  restaurantMenuNames = [],
  onConfirm,
  onFallbackToManual,
  onClose,
}: ReceiptReviewModalProps): JSX.Element {
  const isOcrSupported = typeof isNativeOcrAvailable === 'function' ? isNativeOcrAvailable() : true;

  // All participants (members + guests) for assignee chips
  const allParticipants = useMemo(() => {
    const list: { id: string; name: string }[] = members.map((m) => ({
      id: m.userId,
      name: m.displayName,
    }));
    for (const g of guests) {
      const sponsor = members.find((m) => m.userId === g.sponsorMemberId);
      const sponsorName = sponsor?.displayName || 'Member';
      list.push({
        id: g.id,
        name: `${sponsorName} — ${g.name}`,
      });
    }
    return list;
  }, [members, guests]);

  // Scanned photos list (Req 9.10)
  const [photos, setPhotos] = useState<ScannedPhotoReceipt[]>(() => {
    if (initialPhotos && initialPhotos.length > 0) {
      return [...initialPhotos];
    }
    if (initialRawText !== undefined) {
      return [createScannedPhotoReceipt('photo-1', initialRawText)];
    }
    return [];
  });

  // Items and charge lines in review
  const [items, setItems] = useState<ReceiptReviewItem[]>(() => {
    const res: ReceiptReviewItem[] = [];
    const sourcePhotos = initialPhotos && initialPhotos.length > 0
      ? initialPhotos
      : initialRawText !== undefined
      ? [createScannedPhotoReceipt('photo-1', initialRawText)]
      : [];

    for (const photo of sourcePhotos) {
      for (const it of photo.items) {
        res.push({
          id: it.id || `item-${Math.random().toString(36).slice(2, 9)}`,
          name: it.name,
          priceCents: it.priceCents,
          isAlcohol: it.isAlcohol,
          assigneeIds: it.assigneeIds && it.assigneeIds.length > 0 ? [...it.assigneeIds] : [callerId],
          sourcePhotoId: photo.id,
        });
      }
    }
    return res;
  });

  const [chargeLines, setChargeLines] = useState<ReceiptReviewChargeLine[]>(() => {
    const res: ReceiptReviewChargeLine[] = [];
    const sourcePhotos = initialPhotos && initialPhotos.length > 0
      ? initialPhotos
      : initialRawText !== undefined
      ? [createScannedPhotoReceipt('photo-1', initialRawText)]
      : [];

    for (const photo of sourcePhotos) {
      for (const cl of photo.chargeLines) {
        res.push({
          id: cl.id || `cl-${Math.random().toString(36).slice(2, 9)}`,
          kind: cl.kind,
          amountCents: cl.amountCents,
          excludeAlcohol: cl.excludeAlcohol ?? false,
          sourcePhotoId: photo.id,
        });
      }
    }
    return res;
  });

  // Selected items for merging
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Subtotals detected across photos (Req 9.6, 9.11)
  const detectedSubtotals = useMemo(() => {
    return photos
      .map((p) => p.subtotalCents)
      .filter((s): s is number => s !== null && s > 0);
  }, [photos]);

  // Handler to scan an additional photo (Req 9.10)
  const handleScanAdditionalPhoto = async (source: ReceiptImageSource = 'camera') => {
    setScanError(null);
    try {
      const rawText = await scanReceiptPhoto(source);
      if (rawText === null) return; // User cancelled

      const newPhotoId = `photo-${Date.now()}`;
      const newPhoto = createScannedPhotoReceipt(newPhotoId, rawText);

      setPhotos((prev) => [...prev, newPhoto]);

      // Append new photo's parsed items and charge lines (Req 9.10)
      const newItems: ReceiptReviewItem[] = newPhoto.items.map((it) => ({
        id: it.id || `item-${Math.random().toString(36).slice(2, 9)}`,
        name: it.name,
        priceCents: it.priceCents,
        isAlcohol: it.isAlcohol,
        assigneeIds: [callerId],
        sourcePhotoId: newPhotoId,
      }));

      const newChargeLines: ReceiptReviewChargeLine[] = newPhoto.chargeLines.map((cl) => ({
        id: cl.id || `cl-${Math.random().toString(36).slice(2, 9)}`,
        kind: cl.kind,
        amountCents: cl.amountCents,
        excludeAlcohol: cl.excludeAlcohol ?? false,
        sourcePhotoId: newPhotoId,
      }));

      setItems((prev) => [...prev, ...newItems]);
      setChargeLines((prev) => [...prev, ...newChargeLines]);
    } catch (err: any) {
      setScanError(err.message || 'Failed to scan receipt photo.');
    }
  };

  // Handler to discard a specific photo's contribution (Req 9.12)
  const handleDiscardPhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setItems((prev) => prev.filter((it) => it.sourcePhotoId !== photoId));
    setChargeLines((prev) => prev.filter((cl) => cl.sourcePhotoId !== photoId));
    setSelectedForMerge((prev) => prev.filter((id) => !items.find((it) => it.id === id && it.sourcePhotoId === photoId)));
  };

  // Split an item into two equal parts (Req 9.3)
  const handleSplitItem = (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;

    const half1 = Math.floor(item.priceCents / 2);
    const half2 = item.priceCents - half1;

    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === itemId);
      if (idx === -1) return prev;
      const copy = [...prev];
      const part1: ReceiptReviewItem = {
        ...item,
        id: `${item.id}-1`,
        name: `${item.name} (Part 1)`,
        priceCents: half1,
      };
      const part2: ReceiptReviewItem = {
        ...item,
        id: `${item.id}-2`,
        name: `${item.name} (Part 2)`,
        priceCents: half2,
      };
      copy.splice(idx, 1, part1, part2);
      return copy;
    });
  };

  // Merge selected items (Req 9.3)
  const handleMergeSelected = () => {
    if (selectedForMerge.length < 2) return;
    const selectedItems = items.filter((it) => selectedForMerge.includes(it.id));
    const mergedName = selectedItems.map((it) => it.name).join(' + ');
    const mergedPrice = selectedItems.reduce((acc, it) => acc + it.priceCents, 0);
    const mergedAlcohol = selectedItems.some((it) => it.isAlcohol);
    const mergedAssignees = Array.from(new Set(selectedItems.flatMap((it) => it.assigneeIds || [])));

    const mergedItem: ReceiptReviewItem = {
      id: `merged-${Date.now()}`,
      name: mergedName,
      priceCents: mergedPrice,
      isAlcohol: mergedAlcohol,
      assigneeIds: mergedAssignees.length > 0 ? mergedAssignees : [callerId],
      userEditedName: true,
    };

    setItems((prev) => [...prev.filter((it) => !selectedForMerge.includes(it.id)), mergedItem]);
    setSelectedForMerge([]);
  };

  // If zero items detected from scans, show friendly fallback (Req 9.5)
  const zeroItems = items.length === 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent} testID="receipt-review-modal">
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Review Receipt Scan</Text>
            <Pressable onPress={onClose} testID="close-receipt-review-button" hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {scanError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          ) : null}

          {!isOcrSupported ? (
            <View style={styles.demoNoticeBanner} testID="receipt-demo-notice">
              <Ionicons name="sparkles" size={16} color="#7c3aed" />
              <Text style={styles.demoNoticeText}>
                Demo mode (Expo Go): Sample Disney dining receipt loaded. Live camera OCR is available in development builds.
              </Text>
            </View>
          ) : null}

          {/* Subtotal detected banner (Req 9.6 - Context only) */}
          {detectedSubtotals.length > 0 ? (
            <View style={styles.subtotalBanner} testID="receipt-detected-subtotal">
              <Ionicons name="information-circle-outline" size={18} color={theme.color.primary} />
              <Text style={styles.subtotalBannerText}>
                Detected Subtotal: ${detectedSubtotals.map((s) => (s / 100).toFixed(2)).join(', $')}{' '}
                (Reference only, not billed)
              </Text>
            </View>
          ) : null}

          {/* Photos Management Strip (Req 9.10, 9.12) */}
          {photos.length > 0 ? (
            <View style={styles.photosBar}>
              <Text style={styles.photosBarLabel}>Scanned Photos ({photos.length}):</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosList}>
                {photos.map((p, idx) => (
                  <View key={p.id} style={styles.photoChip}>
                    <Text style={styles.photoChipText}>Photo {idx + 1}</Text>
                    <Pressable
                      onPress={() => handleDiscardPhoto(p.id)}
                      hitSlop={6}
                      testID={`discard-photo-${p.id}`}
                    >
                      <Ionicons name="close-circle" size={16} color={theme.color.danger} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <ScrollView style={styles.scrollBody} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Zero items fallback (Req 9.5) */}
            {zeroItems ? (
              <Card style={styles.fallbackCard}>
                <Ionicons name="receipt-outline" size={48} color={theme.color.textSecondary} />
                <Text style={styles.fallbackTitle} testID="receipt-no-items-message">
                  No items detected
                </Text>
                <Text style={styles.fallbackBody}>
                  We could not find any items on this receipt. You can take another photo or switch to manual entry.
                </Text>
                <View style={styles.fallbackActions}>
                  <SecondaryButton
                    label="📷 Try Another Photo"
                    onPress={() => handleScanAdditionalPhoto('camera')}
                    testID="receipt-review-scan-again"
                  />
                  <PrimaryButton
                    label="Enter Manually"
                    onPress={onFallbackToManual}
                    testID="receipt-review-manual-fallback"
                  />
                </View>
              </Card>
            ) : (
              <>
                {/* Actions: Scan another photo & Merge */}
                <View style={styles.topActionsRow}>
                  <Pressable
                    style={styles.scanMoreBtn}
                    onPress={() => handleScanAdditionalPhoto('camera')}
                    testID="scan-another-photo-button"
                  >
                    <Ionicons name="camera-outline" size={16} color={theme.color.primary} />
                    <Text style={styles.scanMoreBtnText}>+ Add Photo</Text>
                  </Pressable>

                  {selectedForMerge.length >= 2 ? (
                    <Pressable
                      style={styles.mergeBtn}
                      onPress={handleMergeSelected}
                      testID="receipt-merge-items-btn"
                    >
                      <Ionicons name="git-merge-outline" size={16} color="#ffffff" />
                      <Text style={styles.mergeBtnText}>Merge ({selectedForMerge.length})</Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Items Section */}
                <SectionLabel>DRAFT ITEMS ({items.length})</SectionLabel>
                {items.map((item) => {
                  const isSelectedForMerge = selectedForMerge.includes(item.id);
                  // Menu name cross-check suggestion (Req 9.9)
                  const menuMatch = !item.userEditedName
                    ? matchMenuItemName(item.name, restaurantMenuNames)
                    : null;
                  const showMenuSuggestion = menuMatch && menuMatch !== item.name;

                  return (
                    <Card key={item.id} style={styles.itemCard} testID={`receipt-item-card-${item.id}`}>
                      {/* Selection checkbox + Name + Price */}
                      <View style={styles.itemMainRow}>
                        <Pressable
                          style={[styles.checkbox, isSelectedForMerge && styles.checkboxSelected]}
                          onPress={() => {
                            setSelectedForMerge((prev) =>
                              prev.includes(item.id)
                                ? prev.filter((id) => id !== item.id)
                                : [...prev, item.id]
                            );
                          }}
                          testID={`receipt-select-merge-${item.id}`}
                        >
                          {isSelectedForMerge ? (
                            <Ionicons name="checkmark" size={14} color="#ffffff" />
                          ) : null}
                        </Pressable>

                        <TextInput
                          style={[styles.input, styles.itemNameInput]}
                          value={item.name}
                          onChangeText={(v) => {
                            setItems((prev) =>
                              prev.map((it) =>
                                it.id === item.id ? { ...it, name: v, userEditedName: true } : it
                              )
                            );
                          }}
                          placeholder="Item name"
                          testID={`receipt-item-name-${item.id}`}
                        />

                        <TextInput
                          style={[styles.input, styles.itemPriceInput]}
                          value={(item.priceCents / 100).toFixed(2)}
                          keyboardType="decimal-pad"
                          onChangeText={(v) => {
                            const cents = Math.round((parseFloat(v) || 0) * 100);
                            setItems((prev) =>
                              prev.map((it) =>
                                it.id === item.id ? { ...it, priceCents: cents } : it
                              )
                            );
                          }}
                          placeholder="0.00"
                          testID={`receipt-item-price-${item.id}`}
                        />
                      </View>

                      {/* Menu Match Suggestion (Req 9.9) */}
                      {showMenuSuggestion ? (
                        <Pressable
                          style={styles.menuSuggestionChip}
                          onPress={() => {
                            setItems((prev) =>
                              prev.map((it) =>
                                it.id === item.id
                                  ? { ...it, name: menuMatch, userEditedName: true }
                                  : it
                              )
                            );
                          }}
                          testID={`receipt-suggested-name-${item.id}`}
                        >
                          <Ionicons name="sparkles" size={14} color={theme.color.primary} />
                          <Text style={styles.menuSuggestionText}>
                            Did you mean: <Text style={{ fontWeight: '700' }}>{menuMatch}</Text>? (Tap to use)
                          </Text>
                        </Pressable>
                      ) : null}

                      {/* Alcohol toggle (Req 9.8) */}
                      <View style={styles.alcoholRow}>
                        <View style={styles.alcoholLabelRow}>
                          <Ionicons
                            name="wine-outline"
                            size={16}
                            color={item.isAlcohol ? '#d97706' : theme.color.textSecondary}
                          />
                          <Text style={styles.alcoholLabel}>Alcoholic Beverage</Text>
                        </View>
                        <Switch
                          value={item.isAlcohol}
                          onValueChange={(val) => {
                            setItems((prev) =>
                              prev.map((it) => (it.id === item.id ? { ...it, isAlcohol: val } : it))
                            );
                          }}
                          testID={`receipt-item-alcohol-${item.id}`}
                        />
                      </View>

                      {/* Assignees chips (Req 9.3) */}
                      <View style={styles.assigneesWrap}>
                        <Text style={styles.assigneesTitle}>Assigned to:</Text>
                        <View style={styles.assigneeChipsRow}>
                          {allParticipants.map((p) => {
                            const isAssigned = item.assigneeIds?.includes(p.id);
                            return (
                              <Pressable
                                key={p.id}
                                style={[styles.assigneeChip, isAssigned && styles.assigneeChipActive]}
                                onPress={() => {
                                  setItems((prev) =>
                                    prev.map((it) => {
                                      if (it.id !== item.id) return it;
                                      const current = it.assigneeIds || [];
                                      const next = current.includes(p.id)
                                        ? current.filter((id) => id !== p.id)
                                        : [...current, p.id];
                                      return { ...it, assigneeIds: next };
                                    })
                                  );
                                }}
                                testID={`receipt-item-assignee-${item.id}-${p.id}`}
                              >
                                <Text
                                  style={[
                                    styles.assigneeChipText,
                                    isAssigned && styles.assigneeChipTextActive,
                                  ]}
                                >
                                  {p.name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>

                      {/* Item controls: Split / Delete */}
                      <View style={styles.itemFooterRow}>
                        <Pressable
                          style={styles.splitBtn}
                          onPress={() => handleSplitItem(item.id)}
                          testID={`receipt-split-item-${item.id}`}
                        >
                          <Ionicons name="git-branch-outline" size={14} color={theme.color.primary} />
                          <Text style={styles.splitBtnText}>Split</Text>
                        </Pressable>

                        <Pressable
                          style={styles.deleteBtn}
                          onPress={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                          testID={`receipt-delete-item-${item.id}`}
                        >
                          <Ionicons name="trash-outline" size={14} color={theme.color.danger} />
                          <Text style={styles.deleteBtnText}>Delete</Text>
                        </Pressable>
                      </View>
                    </Card>
                  );
                })}

                {/* Charge Lines Section */}
                <SectionLabel>CHARGE LINES ({chargeLines.length})</SectionLabel>
                {chargeLines.map((cl) => (
                  <Card key={cl.id} style={styles.chargeCard} testID={`receipt-charge-card-${cl.id}`}>
                    <View style={styles.chargeMainRow}>
                      <Badge
                        label={cl.kind.toUpperCase()}
                        color={
                          cl.kind === 'discount'
                            ? '#10b981'
                            : cl.kind === 'tax'
                            ? '#6366f1'
                            : '#f59e0b'
                        }
                      />
                      <TextInput
                        style={[styles.input, styles.chargePriceInput]}
                        value={(cl.amountCents / 100).toFixed(2)}
                        keyboardType="decimal-pad"
                        onChangeText={(v) => {
                          const cents = Math.round((parseFloat(v) || 0) * 100);
                          setChargeLines((prev) =>
                            prev.map((c) => (c.id === cl.id ? { ...c, amountCents: cents } : c))
                          );
                        }}
                        placeholder="0.00"
                        testID={`receipt-charge-amount-${cl.id}`}
                      />
                      <Pressable
                        style={styles.deleteBtn}
                        onPress={() => setChargeLines((prev) => prev.filter((c) => c.id !== cl.id))}
                        testID={`receipt-delete-charge-${cl.id}`}
                      >
                        <Ionicons name="trash-outline" size={16} color={theme.color.danger} />
                      </Pressable>
                    </View>

                    {cl.kind === 'discount' ? (
                      <View style={styles.alcoholRow}>
                        <Text style={styles.alcoholLabel}>Exclude alcohol items</Text>
                        <Switch
                          value={Boolean(cl.excludeAlcohol)}
                          onValueChange={(val) => {
                            setChargeLines((prev) =>
                              prev.map((c) => (c.id === cl.id ? { ...c, excludeAlcohol: val } : c))
                            );
                          }}
                          testID={`receipt-charge-exclude-alcohol-${cl.id}`}
                        />
                      </View>
                    ) : null}
                  </Card>
                ))}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          {!zeroItems ? (
            <View style={styles.footerRow}>
              <PrimaryButton
                label="Confirm & Use Items"
                onPress={() => onConfirm(items, chargeLines)}
                testID="confirm-receipt-review-button"
              />
            </View>
          ) : null}
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
    maxHeight: '92%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.color.textPrimary,
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
  subtotalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  subtotalBannerText: {
    fontSize: 13,
    color: theme.color.textPrimary,
    flex: 1,
  },
  photosBar: {
    marginBottom: 12,
  },
  photosBarLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
    marginBottom: 6,
  },
  photosList: {
    flexDirection: 'row',
    gap: 8,
  },
  photoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.color.background,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  photoChipText: {
    fontSize: 12,
    color: theme.color.textPrimary,
  },
  scrollBody: {
    maxHeight: '75%',
  },
  fallbackCard: {
    alignItems: 'center',
    padding: 24,
    marginVertical: 20,
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
    marginTop: 12,
    marginBottom: 6,
  },
  fallbackBody: {
    fontSize: 14,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  fallbackActions: {
    width: '100%',
    gap: 10,
  },
  topActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  scanMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.color.primary,
  },
  scanMoreBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.primary,
  },
  mergeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.color.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  mergeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  itemCard: {
    padding: 12,
    marginBottom: 10,
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  input: {
    backgroundColor: theme.color.background,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: theme.color.textPrimary,
    fontSize: 14,
  },
  itemNameInput: {
    flex: 2,
  },
  itemPriceInput: {
    flex: 1,
  },
  menuSuggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  menuSuggestionText: {
    fontSize: 12,
    color: theme.color.textPrimary,
    flex: 1,
  },
  alcoholRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 6,
  },
  alcoholLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alcoholLabel: {
    fontSize: 13,
    color: theme.color.textSecondary,
  },
  assigneesWrap: {
    marginTop: 4,
    marginBottom: 8,
  },
  assigneesTitle: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  assigneeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  assigneeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  assigneeChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: theme.color.primary,
  },
  assigneeChipText: {
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  assigneeChipTextActive: {
    color: theme.color.primary,
    fontWeight: '600',
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: 8,
    marginTop: 4,
  },
  splitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  splitBtnText: {
    fontSize: 12,
    color: theme.color.primary,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deleteBtnText: {
    fontSize: 12,
    color: theme.color.danger,
  },
  chargeCard: {
    padding: 12,
    marginBottom: 8,
  },
  chargeMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chargePriceInput: {
    flex: 1,
  },
  footerRow: {
    marginTop: 12,
  },
  demoNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  demoNoticeText: {
    flex: 1,
    fontSize: 11,
    color: '#6d28d9',
    lineHeight: 15,
  },
});
