import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  EXPENSE_AMOUNT_MAX_CENTS,
  extractMenuPriceOffers,
  normalizeTierName,
  type MenuDTO,
  type MenuPriceOffer,
} from '@dwt/shared';

import { makeStyles } from '../theme/makeStyles';
import { usePalette } from '../theme/useAppTheme';
import { MENU_ITEM_PICKER } from './MenuItemPicker.palette';
import {
  buildPickerRows,
  selectionSubtotalCents,
  type PickerItemRow,
  type PickerItemVariant,
  type PickerSelection,
  type SelectedItemState,
} from './menuItemPicker.pure';

export function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const str = `$${dollars}.${remainder < 10 ? '0' : ''}${remainder}`;
  return cents < 0 ? `-${str}` : str;
}

export function parseDollarInputToCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const dollars = parseInt(parts[0] || '0', 10);
  let centsPart = 0;
  if (parts.length === 2) {
    const rawCents = (parts[1] + '00').slice(0, 2);
    centsPart = parseInt(rawCents, 10);
  }
  const total = dollars * 100 + centsPart;
  if (isNaN(total) || total <= 0 || total > EXPENSE_AMOUNT_MAX_CENTS) return null;
  return total;
}

export interface MenuItemPickerProps {
  readonly visible?: boolean;
  readonly menus: readonly MenuDTO[];
  readonly onConfirm: (selection: PickerSelection) => void;
  readonly onCancel: () => void;
  readonly initialSelection?: PickerSelection;
  readonly testID?: string;
}

interface ItemEntryState {
  readonly selected: boolean;
  readonly name: string;
  readonly chosenVariant: PickerItemVariant | null;
  readonly typedPriceText: string;
  readonly quantity: number;
  readonly isAlcohol: boolean;
}

export function MenuItemPicker({
  visible = true,
  menus,
  onConfirm,
  onCancel,
  initialSelection,
  testID = 'menu-item-picker',
}: MenuItemPickerProps): React.JSX.Element {
  const styles = useStyles();
  const palette = usePalette(MENU_ITEM_PICKER);

  const offers = useMemo(() => extractMenuPriceOffers(menus), [menus]);
  const sections = useMemo(() => buildPickerRows(menus), [menus]);

  // Map of selected fixed-price / buffet tier quantities keyed by offer.label
  const [tierQuantities, setTierQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    if (initialSelection?.tiers && initialSelection.tiers.length > 0) {
      for (const t of initialSelection.tiers) {
        const match = offers.find(
          (o) => o.label === t.name || normalizeTierName(o.label) === t.name
        );
        const key = match ? match.label : t.name;
        init[key] = typeof t.quantity === 'number' ? Math.max(1, t.quantity) : 1;
      }
      return init;
    }
    if (initialSelection?.tier) {
      const tierName =
        'label' in initialSelection.tier ? initialSelection.tier.label : initialSelection.tier.name;
      const match = offers.find(
        (o) => o.label === tierName || normalizeTierName(o.label) === tierName
      );
      const key = match ? match.label : tierName;
      const qty =
        'quantity' in initialSelection.tier &&
        typeof initialSelection.tier.quantity === 'number'
          ? initialSelection.tier.quantity
          : 1;
      init[key] = Math.max(1, qty);
    }
    return init;
  });

  // State map for items: keyed by item.id
  const [itemStates, setItemStates] = useState<Record<string, ItemEntryState>>(() => {
    const init: Record<string, ItemEntryState> = {};
    const initialItems = initialSelection?.items ?? [];

    for (const sec of sections) {
      for (const item of sec.items) {
        const found = initialItems.find((it) => it.name === item.name);
        const hasVariants = item.variants.length > 0;
        const initialVariant = hasVariants ? item.variants[0]! : null;

        init[item.id] = {
          selected: Boolean(found),
          name: item.name,
          chosenVariant: initialVariant,
          typedPriceText: found?.priceCents ? (found.priceCents / 100).toFixed(2) : '',
          quantity: found?.quantity ?? 1,
          isAlcohol: found?.isAlcohol ?? item.isAlcohol,
        };
      }
    }
    return init;
  });

  const toggleItem = (item: PickerItemRow) => {
    // Toggling an individual item deselects fixed-price tiers
    setTierQuantities({});

    setItemStates((prev) => {
      const cur = prev[item.id];
      const isSelected = cur ? cur.selected : false;
      return {
        ...prev,
        [item.id]: {
          selected: !isSelected,
          name: item.name,
          chosenVariant: cur?.chosenVariant ?? (item.variants.length > 0 ? item.variants[0]! : null),
          typedPriceText: cur?.typedPriceText ?? '',
          quantity: cur?.quantity ?? 1,
          isAlcohol: cur?.isAlcohol ?? item.isAlcohol,
        },
      };
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setItemStates((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      const nextQty = Math.max(1, cur.quantity + delta);
      return {
        ...prev,
        [itemId]: { ...cur, quantity: nextQty },
      };
    });
  };

  const updateVariant = (itemId: string, variant: PickerItemVariant) => {
    setItemStates((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return {
        ...prev,
        [itemId]: { ...cur, chosenVariant: variant },
      };
    });
  };

  const updateTypedPrice = (itemId: string, text: string) => {
    setItemStates((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return {
        ...prev,
        [itemId]: { ...cur, typedPriceText: text },
      };
    });
  };

  const toggleItemAlcohol = (itemId: string) => {
    setItemStates((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return {
        ...prev,
        [itemId]: { ...cur, isAlcohol: !cur.isAlcohol },
      };
    });
  };

  const selectOffer = (offer: MenuPriceOffer) => {
    setTierQuantities((prev) => {
      const currentQty = prev[offer.label] ?? 0;
      const next = { ...prev };
      if (currentQty > 0) {
        delete next[offer.label];
      } else {
        next[offer.label] = 1;
      }
      return next;
    });
    // Clear individual item selections when selecting a fixed-price tier
    setItemStates((prev) => {
      const next: Record<string, ItemEntryState> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, selected: false };
      }
      return next;
    });
  };

  const updateTierQuantity = (label: string, delta: number) => {
    setTierQuantities((prev) => {
      const currentQty = prev[label] ?? 0;
      const nextQty = currentQty + delta;
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[label];
      } else {
        next[label] = nextQty;
      }
      return next;
    });
  };

  // Compile current selection
  const currentSelection: PickerSelection = useMemo(() => {
    const activeTiers = offers
      .filter((o) => (tierQuantities[o.label] ?? 0) > 0)
      .map((o) => ({
        name: normalizeTierName(o.label),
        priceCents: o.priceCents,
        quantity: tierQuantities[o.label]!,
      }));

    if (activeTiers.length === 1) {
      return {
        tier: activeTiers[0]!,
      };
    }
    if (activeTiers.length > 1) {
      return {
        tier: activeTiers[0]!,
        tiers: activeTiers,
      };
    }

    const items: SelectedItemState[] = [];
    for (const sec of sections) {
      for (const item of sec.items) {
        const state = itemStates[item.id];
        if (state && state.selected) {
          let priceCents = 0;
          let priceLabel: string | null = null;

          if (item.isPriceless) {
            const parsed = parseDollarInputToCents(state.typedPriceText);
            priceCents = parsed ?? 0;
          } else if (state.chosenVariant) {
            priceCents = state.chosenVariant.cents;
            priceLabel = state.chosenVariant.label;
          } else if (item.defaultPriceCents) {
            priceCents = item.defaultPriceCents;
          }

          items.push({
            name: item.name,
            priceCents,
            priceLabel,
            quantity: state.quantity,
            isAlcohol: state.isAlcohol,
          });
        }
      }
    }

    return { items };
  }, [offers, tierQuantities, itemStates, sections]);

  // Validation: can confirm only if at least one item or tier is selected and all selected priceless items have valid prices
  const canConfirm = useMemo(() => {
    if (currentSelection.tiers && currentSelection.tiers.length > 0) {
      return currentSelection.tiers.every((t) => t.priceCents > 0 && (t.quantity ?? 1) >= 1);
    }
    if (currentSelection.tier) {
      const qty =
        'quantity' in currentSelection.tier && typeof currentSelection.tier.quantity === 'number'
          ? currentSelection.tier.quantity
          : 1;
      return currentSelection.tier.priceCents > 0 && qty >= 1;
    }
    const items = currentSelection.items ?? [];
    if (items.length === 0) return false;
    for (const it of items) {
      if (it.priceCents <= 0) return false;
    }
    return true;
  }, [currentSelection]);

  const subtotalCents = useMemo(
    () => selectionSubtotalCents(currentSelection),
    [currentSelection]
  );

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(currentSelection);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} testID={testID}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Pick from Menu</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm selection"
            onPress={handleConfirm}
            disabled={!canConfirm}
            style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
          >
            <Text style={[styles.confirmText, !canConfirm && styles.confirmTextDisabled]}>
              Confirm
            </Text>
          </Pressable>
        </View>

        {/* Note on tax and gratuity (Requirement 9.8) */}
        <View style={styles.noteContainer}>
          <Text
            style={[styles.noteText, { color: palette.noteText }]}
            accessibilityLabel="Menu prices are before tax and gratuity."
          >
            Menu prices are before tax and gratuity.
          </Text>
        </View>

        <ScrollView style={styles.scroll}>
          {/* Prix Fixe / Buffet Offers Section */}
          {offers.length > 0 && (
            <View style={styles.section}>
              <View
                style={[styles.sectionHeader, { backgroundColor: palette.sectionHeaderBg }]}
              >
                <Text
                  style={[styles.sectionHeaderText, { color: palette.sectionHeaderText }]}
                >
                  Prix Fixe & Buffet Pricing
                </Text>
              </View>
              {offers.map((offer) => {
                const qty = tierQuantities[offer.label] ?? 0;
                const isSelected = qty > 0;
                return (
                  <Pressable
                    key={offer.label}
                    accessibilityRole="button"
                    accessibilityLabel={`${offer.label}: ${formatDollars(offer.priceCents)}`}
                    onPress={() => selectOffer(offer)}
                    style={[
                      styles.tierCard,
                      {
                        backgroundColor: isSelected ? palette.tierBg : palette.bg,
                        borderColor: isSelected ? palette.tierBorder : palette.itemBorder,
                      },
                    ]}
                  >
                    <View style={styles.tierInfo}>
                      <Text
                        style={[
                          styles.tierTitle,
                          { color: isSelected ? palette.tierText : palette.sectionHeaderText },
                        ]}
                      >
                        {offer.label}
                      </Text>
                      <Text style={[styles.tierPrice, { color: palette.tierText }]}>
                        {formatDollars(offer.priceCents)}
                      </Text>
                    </View>
                    {isSelected && (
                      <View style={styles.stepper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease quantity for ${offer.label}`}
                          onPress={() => updateTierQuantity(offer.label, -1)}
                          style={styles.stepButton}
                        >
                          <Text style={styles.stepButtonText}>-</Text>
                        </Pressable>
                        <Text style={styles.stepQty}>{qty}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase quantity for ${offer.label}`}
                          onPress={() => updateTierQuantity(offer.label, 1)}
                          style={styles.stepButton}
                        >
                          <Text style={styles.stepButtonText}>+</Text>
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Menu Sections & Items */}
          {sections.map((section, sIdx) => (
            <View key={`${section.menuType}-${section.groupName}-${sIdx}`} style={styles.section}>
              <View
                style={[styles.sectionHeader, { backgroundColor: palette.sectionHeaderBg }]}
              >
                <Text
                  style={[styles.sectionHeaderText, { color: palette.sectionHeaderText }]}
                >
                  {section.menuType} — {section.groupName}
                </Text>
              </View>

              {section.items.map((item) => {
                const state = itemStates[item.id] || {
                  selected: false,
                  name: item.name,
                  chosenVariant: item.variants[0] || null,
                  typedPriceText: '',
                  quantity: 1,
                  isAlcohol: item.isAlcohol,
                };
                const isSelected = state.selected;

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRow,
                      {
                        backgroundColor: isSelected ? palette.selectedBg : palette.bg,
                        borderColor: palette.itemBorder,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={item.name}
                      accessibilityState={{ checked: isSelected, selected: isSelected }}
                      onPress={() => toggleItem(item)}
                      style={styles.itemHeaderRow}
                    >
                      <View style={styles.itemMain}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {item.isAlcohol && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Alcohol toggle for ${item.name}`}
                            onPress={() => toggleItemAlcohol(item.id)}
                            style={[
                              styles.alcoholTag,
                              { backgroundColor: palette.alcoholTagBg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.alcoholTagText,
                                { color: palette.alcoholTagText },
                              ]}
                            >
                              Alcohol
                            </Text>
                          </Pressable>
                        )}
                      </View>

                      {/* Display price when single price exists */}
                      {!item.isPriceless && item.variants.length <= 1 && (
                        <Text style={styles.itemPrice}>
                          {item.defaultPriceCents ? formatDollars(item.defaultPriceCents) : ''}
                        </Text>
                      )}
                    </Pressable>

                    {/* Variant picker when item has multiple size variants */}
                    {isSelected && item.variants.length > 1 && (
                      <View style={styles.variantRow}>
                        {item.variants.map((v, vIdx) => {
                          const isActive =
                            state.chosenVariant?.cents === v.cents &&
                            state.chosenVariant?.label === v.label;
                          return (
                            <Pressable
                              key={`${v.cents}-${v.label}-${vIdx}`}
                              accessibilityRole="button"
                              accessibilityLabel={`${v.label ?? 'Option'}: ${formatDollars(v.cents)}`}
                              onPress={() => updateVariant(item.id, v)}
                              style={[
                                styles.variantChip,
                                {
                                  backgroundColor: isActive
                                    ? palette.variantActiveBg
                                    : palette.variantInactiveBg,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.variantChipText,
                                  {
                                    color: isActive
                                      ? palette.variantActiveText
                                      : palette.variantInactiveText,
                                  },
                                ]}
                              >
                                {v.label ? `${v.label} ` : ''}
                                {formatDollars(v.cents)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}

                    {/* Priceless typed input */}
                    {isSelected && item.isPriceless && (
                      <View style={styles.typedPriceRow}>
                        <Text style={styles.typedPriceLabel}>Price ($):</Text>
                        <TextInput
                          accessibilityLabel={`Price for ${item.name}`}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          value={state.typedPriceText}
                          onChangeText={(t) => updateTypedPrice(item.id, t)}
                          style={styles.priceInput}
                        />
                      </View>
                    )}

                    {/* Stepper when selected */}
                    {isSelected && (
                      <View style={styles.itemFooterRow}>
                        <View style={styles.stepper}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Decrease quantity for ${item.name}`}
                            onPress={() => updateQuantity(item.id, -1)}
                            style={styles.stepButton}
                          >
                            <Text style={styles.stepButtonText}>-</Text>
                          </Pressable>
                          <Text style={styles.stepQty}>{state.quantity}</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Increase quantity for ${item.name}`}
                            onPress={() => updateQuantity(item.id, 1)}
                            style={styles.stepButton}
                          >
                            <Text style={styles.stepButtonText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.subtotalText}>
            Subtotal: {formatDollars(subtotalCents)}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  cancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 15,
    color: t.color.textSecondary,
  },
  confirmButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: t.color.primary,
    borderRadius: t.radius.sm,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
  confirmTextDisabled: {},
  noteContainer: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 16,
  },
  scroll: {
    flex: 1,
  },
  section: {
    marginBottom: t.spacing.md,
  },
  sectionHeader: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
  },
  tierInfo: {
    flex: 1,
    gap: 2,
  },
  tierTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  tierPrice: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemRow: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: t.color.textPrimary,
  },
  alcoholTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alcoholTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  variantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  variantChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  variantChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  typedPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  typedPriceLabel: {
    fontSize: 13,
    color: t.color.textSecondary,
  },
  priceInput: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    minWidth: 80,
    backgroundColor: t.color.surface,
    color: t.color.textPrimary,
  },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: t.color.textPrimary,
    lineHeight: 20,
  },
  stepQty: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
    minWidth: 16,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    backgroundColor: t.color.surface,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    alignItems: 'center',
  },
  subtotalText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
}));

