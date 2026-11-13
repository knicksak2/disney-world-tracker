import React, { useMemo, useState } from 'react';
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
  EXPENSE_AMOUNT_MAX_CENTS,
  extractMenuPriceOffers,
  normalizeTierName,
  type MenuDTO,
  type MenuPriceOffer,
} from '@dwt/shared';

import { makeStyles } from '../theme/makeStyles';
import { useAppTheme, usePalette } from '../theme/useAppTheme';
import { MENU_ITEM_PICKER } from './MenuItemPicker.palette';
import {
  buildPickerRows,
  isAlcoholicGroupType,
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
  const t = useAppTheme();
  const palette = usePalette(MENU_ITEM_PICKER);

  const availableMeals = useMemo(() => {
    const list: string[] = [];
    for (const m of menus) {
      if (m.menuType && !list.includes(m.menuType)) {
        list.push(m.menuType);
      }
    }
    return list;
  }, [menus]);

  const [selectedMeal, setSelectedMeal] = useState<string>(() => {
    return availableMeals.length > 0 ? availableMeals[0]! : 'all';
  });

  const handleSelectMeal = (meal: string) => {
    setSelectedMeal(meal);
    if (activeFilter === 'feast') {
      setActiveFilter('all');
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'priced' | 'drinks' | 'tiers' | 'feast'>('all');

  const offers = useMemo(() => extractMenuPriceOffers(menus), [menus]);
  const sections = useMemo(() => buildPickerRows(menus), [menus]);

  const hasFeastItems = useMemo(() => {
    return sections.some((s) => s.items.some((it) => it.isFeastItem));
  }, [sections]);

  const getOfferKey = (offer: MenuPriceOffer): string => {
    return offer.menuType ? `${offer.menuType} — ${offer.label}` : offer.label;
  };

  // Map of selected fixed-price / buffet tier quantities keyed by getOfferKey(offer) or offer.label
  const [tierQuantities, setTierQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    if (initialSelection?.tiers && initialSelection.tiers.length > 0) {
      for (const t of initialSelection.tiers) {
        const match = offers.find(
          (o) =>
            o.label === t.name ||
            normalizeTierName(o.label) === t.name ||
            getOfferKey(o) === t.name ||
            normalizeTierName(`${o.menuType} ${o.label}`) === t.name
        );
        const key = match ? getOfferKey(match) : t.name;
        init[key] = typeof t.quantity === 'number' ? Math.max(1, t.quantity) : 1;
      }
      return init;
    }
    if (initialSelection?.tier) {
      const tierName =
        'label' in initialSelection.tier ? initialSelection.tier.label : initialSelection.tier.name;
      const match = offers.find(
        (o) =>
          o.label === tierName ||
          normalizeTierName(o.label) === tierName ||
          getOfferKey(o) === tierName ||
          normalizeTierName(`${o.menuType} ${o.label}`) === tierName
      );
      const key = match ? getOfferKey(match) : tierName;
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
      const nextQty = cur.quantity + delta;
      if (nextQty <= 0) {
        // Decreasing to 0 deselects the item cleanly
        return {
          ...prev,
          [itemId]: { ...cur, selected: false, quantity: 1 },
        };
      }
      return {
        ...prev,
        [itemId]: { ...cur, quantity: nextQty },
      };
    });
  };

  const clearAllSelections = () => {
    setTierQuantities({});
    setItemStates((prev) => {
      const next: Record<string, ItemEntryState> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, selected: false, quantity: 1 };
      }
      return next;
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
    const key = getOfferKey(offer);
    setTierQuantities((prev) => {
      const currentQty = prev[key] ?? prev[offer.label] ?? 0;
      const next = { ...prev };
      if (currentQty > 0) {
        delete next[key];
        delete next[offer.label];
      } else {
        next[key] = 1;
      }
      return next;
    });
  };

  const updateTierQuantity = (offer: MenuPriceOffer, delta: number) => {
    const key = getOfferKey(offer);
    setTierQuantities((prev) => {
      const currentQty = prev[key] ?? prev[offer.label] ?? 0;
      const nextQty = currentQty + delta;
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[key];
        delete next[offer.label];
      } else {
        next[key] = nextQty;
      }
      return next;
    });
  };

  // Compile current selection
  const currentSelection: PickerSelection = useMemo(() => {
    const activeTiers = offers
      .filter((o) => (tierQuantities[getOfferKey(o)] ?? tierQuantities[o.label] ?? 0) > 0)
      .map((o) => {
        const qty = tierQuantities[getOfferKey(o)] ?? tierQuantities[o.label]!;
        const name = normalizeTierName(
          availableMeals.length > 1 && o.menuType ? `${o.menuType} ${o.label}` : o.label
        );
        return {
          name,
          priceCents: o.priceCents,
          quantity: qty,
        };
      });

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

    return {
      ...(activeTiers.length > 0
        ? {
            tier: activeTiers[0]!,
            tiers: activeTiers,
          }
        : {}),
      ...(items.length > 0 ? { items } : {}),
    };
  }, [offers, tierQuantities, itemStates, sections, availableMeals.length]);

  const selectedItemsCount = useMemo(() => {
    let count = 0;
    for (const v of Object.values(tierQuantities)) {
      count += v;
    }
    for (const s of Object.values(itemStates)) {
      if (s.selected) {
        count += s.quantity;
      }
    }
    return count;
  }, [tierQuantities, itemStates]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredOffers = useMemo(() => {
    if (activeFilter === 'drinks' || activeFilter === 'priced' || activeFilter === 'feast') {
      return [];
    }
    let res = offers;
    if (selectedMeal !== 'all') {
      res = res.filter((o) => !o.menuType || o.menuType.toLowerCase() === selectedMeal.toLowerCase());
    }
    if (normalizedQuery) {
      res = res.filter(
        (o) =>
          o.label.toLowerCase().includes(normalizedQuery) ||
          (o.menuType && o.menuType.toLowerCase().includes(normalizedQuery))
      );
    }
    return res;
  }, [offers, activeFilter, selectedMeal, normalizedQuery]);

  const filteredSections = useMemo(() => {
    if (activeFilter === 'tiers') {
      return [];
    }
    return sections
      .filter((sec) => {
        if (selectedMeal === 'all') return true;
        return sec.menuType.toLowerCase() === selectedMeal.toLowerCase();
      })
      .map((sec) => {
        let items = sec.items;

        if (activeFilter === 'priced') {
          items = items.filter((it) => !it.isPriceless);
        } else if (activeFilter === 'drinks') {
          items = items.filter((it) => it.isAlcohol || isAlcoholicGroupType(sec.groupType));
        } else if (activeFilter === 'feast') {
          items = items.filter((it) => it.isFeastItem);
        } else if (activeFilter === 'all') {
          // By default, hide unpriced feast items on 'all' so they don't clutter the picker!
          // Users can view them via the "Feast Items (Included)" filter chip.
          items = items.filter((it) => !it.isFeastItem);
        }

        if (normalizedQuery) {
          items = items.filter(
            (it) =>
              it.name.toLowerCase().includes(normalizedQuery) ||
              sec.groupName.toLowerCase().includes(normalizedQuery) ||
              sec.menuType.toLowerCase().includes(normalizedQuery)
          );
        }

        return {
          ...sec,
          items,
        };
      })
      .filter((sec) => sec.items.length > 0);
  }, [sections, activeFilter, selectedMeal, normalizedQuery]);

  // Validation: can confirm only if at least one item or tier is selected and all selected priceless items have valid prices
  const canConfirm = useMemo(() => {
    const hasTiers = Boolean(
      (currentSelection.tiers && currentSelection.tiers.length > 0) || currentSelection.tier
    );
    const items = currentSelection.items ?? [];
    const hasItems = items.length > 0;

    if (!hasTiers && !hasItems) return false;

    if (currentSelection.tiers && currentSelection.tiers.length > 0) {
      const allTiersValid = currentSelection.tiers.every(
        (t) => t.priceCents > 0 && (t.quantity ?? 1) >= 1
      );
      if (!allTiersValid) return false;
    } else if (currentSelection.tier) {
      const qty =
        'quantity' in currentSelection.tier && typeof currentSelection.tier.quantity === 'number'
          ? currentSelection.tier.quantity
          : 1;
      if (currentSelection.tier.priceCents <= 0 || qty < 1) return false;
    }

    if (hasItems) {
      for (const it of items) {
        if (it.priceCents <= 0) return false;
      }
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
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

        {/* Meal Selection Tabs (When multiple meals exist, e.g. Breakfast vs Dinner) */}
        {availableMeals.length > 1 && (
          <View style={styles.mealTabsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mealTabsScroll}>
              {availableMeals.map((meal) => {
                const isActive = selectedMeal === meal;
                return (
                  <Pressable
                    key={meal}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by ${meal} menu`}
                    onPress={() => handleSelectMeal(meal)}
                    style={[styles.mealTab, isActive && styles.mealTabActive]}
                  >
                    <Text style={[styles.mealTabText, isActive && styles.mealTabTextActive]}>
                      {meal}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter by All meals"
                onPress={() => handleSelectMeal('all')}
                style={[styles.mealTab, selectedMeal === 'all' && styles.mealTabActive]}
              >
                <Text style={[styles.mealTabText, selectedMeal === 'all' && styles.mealTabTextActive]}>
                  All Meals
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        )}

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={t.color.textSecondary} style={styles.searchIcon} />
            <TextInput
              testID="menu-search-input"
              accessibilityLabel="Search menu items"
              placeholder="Search menu items..."
              placeholderTextColor={t.color.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => setSearchQuery('')}
                style={styles.clearSearchButton}
              >
                <Ionicons name="close-circle" size={18} color={t.color.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Filter Chips Bar */}
        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter all items"
              onPress={() => setActiveFilter('all')}
              style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
                All
              </Text>
            </Pressable>

            {offers.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter buffet and prix fixe"
                onPress={() => setActiveFilter('tiers')}
                style={[styles.filterChip, activeFilter === 'tiers' && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, activeFilter === 'tiers' && styles.filterChipTextActive]}>
                  Buffet Rates 🎟️
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter priced items only"
              onPress={() => setActiveFilter('priced')}
              style={[styles.filterChip, activeFilter === 'priced' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, activeFilter === 'priced' && styles.filterChipTextActive]}>
                Priced Items ($)
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter drinks and cocktails"
              onPress={() => setActiveFilter('drinks')}
              style={[styles.filterChip, activeFilter === 'drinks' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, activeFilter === 'drinks' && styles.filterChipTextActive]}>
                Drinks & Cocktails 🍸
              </Text>
            </Pressable>

            {hasFeastItems && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter included feast items"
                onPress={() => setActiveFilter(activeFilter === 'feast' ? 'all' : 'feast')}
                style={[styles.filterChip, activeFilter === 'feast' && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, activeFilter === 'feast' && styles.filterChipTextActive]}>
                  Feast Items (Included)
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        <ScrollView style={styles.scroll}>
          {/* Prix Fixe / Buffet Offers Section */}
          {filteredOffers.length > 0 && (
            <View style={styles.section}>
              <View
                style={[styles.sectionHeader, { backgroundColor: palette.sectionHeaderBg }]}
              >
                <Text
                  style={[styles.sectionHeaderText, { color: palette.sectionHeaderText }]}
                >
                  Prix Fixe & Buffet Pricing{selectedMeal !== 'all' ? ` — ${selectedMeal}` : ''}
                </Text>
              </View>
              {filteredOffers.map((offer) => {
                const key = getOfferKey(offer);
                const qty = tierQuantities[key] ?? tierQuantities[offer.label] ?? 0;
                const isSelected = qty > 0;
                const displayOfferTitle =
                  selectedMeal === 'all' && offer.menuType
                    ? `${offer.menuType} — ${offer.label}`
                    : offer.label;

                return (
                  <Pressable
                    key={`${offer.menuType}-${offer.label}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayOfferTitle}: ${formatDollars(offer.priceCents)}`}
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
                      <View style={styles.tierHeaderRow}>
                        <Ionicons
                          name={isSelected ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={isSelected ? palette.tierText : t.color.textSecondary}
                          style={styles.checkboxIcon}
                        />
                        <Text
                          style={[
                            styles.tierTitle,
                            { color: isSelected ? palette.tierText : palette.sectionHeaderText },
                          ]}
                        >
                          {displayOfferTitle}
                        </Text>
                      </View>
                      <Text style={[styles.tierPrice, { color: palette.tierText }]}>
                        {formatDollars(offer.priceCents)}
                      </Text>
                    </View>
                    {isSelected && (
                      <View style={styles.stepper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${displayOfferTitle}`}
                          onPress={() => updateTierQuantity(offer, -qty)}
                          style={styles.removeButton}
                        >
                          <Text style={styles.removeButtonText}>Remove</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease quantity for ${displayOfferTitle}`}
                          onPress={() => updateTierQuantity(offer, -1)}
                          style={styles.stepButton}
                        >
                          <Text style={styles.stepButtonText}>-</Text>
                        </Pressable>
                        <Text style={styles.stepQty}>{qty}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase quantity for ${displayOfferTitle}`}
                          onPress={() => updateTierQuantity(offer, 1)}
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
          {filteredSections.map((section, sIdx) => {
            const isAllFeast = offers.length > 0 && section.items.every((it) => it.isFeastItem || it.isPriceless);
            const sectionDisplayName =
              selectedMeal === 'all'
                ? `${section.menuType} — ${section.groupName}`
                : section.groupName;

            return (
              <View key={`${section.menuType}-${section.groupName}-${sIdx}`} style={styles.section}>
                <View
                  style={[styles.sectionHeader, { backgroundColor: palette.sectionHeaderBg }]}
                >
                  <Text
                    style={[styles.sectionHeaderText, { color: palette.sectionHeaderText }]}
                  >
                    {sectionDisplayName}
                  </Text>
                  {isAllFeast && (
                    <View style={styles.feastBadge}>
                      <Text style={styles.feastBadgeText}>Included in Feast</Text>
                    </View>
                  )}
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
                          <Ionicons
                            name={isSelected ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={isSelected ? palette.tierText : t.color.textSecondary}
                            style={styles.checkboxIcon}
                          />
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
                        {item.isFeastItem && !isSelected && (
                          <Text style={[styles.itemPrice, { color: t.color.textSecondary, fontSize: 12 }]}>
                            Included
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
                            onChangeText={(text) => updateTypedPrice(item.id, text)}
                            style={styles.priceInput}
                          />
                        </View>
                      )}

                      {/* Stepper & Remove when selected */}
                      {isSelected && (
                        <View style={styles.itemFooterRow}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${item.name}`}
                            onPress={() => toggleItem(item)}
                            style={styles.removeButton}
                          >
                            <Text style={styles.removeButtonText}>Remove</Text>
                          </Pressable>
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
            );
          })}

          {/* Empty search/filter state */}
          {filteredOffers.length === 0 && filteredSections.length === 0 && (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={36} color={t.color.textSecondary} />
              <Text style={styles.emptyTitle}>No menu items found</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery ? `No results for "${searchQuery}"` : 'No items match the selected meal or filter.'}
              </Text>
              {(searchQuery.length > 0 || activeFilter !== 'all' || selectedMeal !== 'all') && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset filters and search"
                  onPress={() => {
                    setSearchQuery('');
                    setActiveFilter('all');
                    setSelectedMeal(availableMeals.length > 0 ? availableMeals[0]! : 'all');
                  }}
                  style={styles.resetFilterButton}
                >
                  <Text style={styles.resetFilterButtonText}>Reset Filters</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerInfoRow}>
            <Text style={styles.selectedCountText}>
              {selectedItemsCount} {selectedItemsCount === 1 ? 'item' : 'items'} selected
            </Text>
            <Text style={styles.subtotalText}>
              Subtotal: {formatDollars(subtotalCents)}
            </Text>
          </View>
          {selectedItemsCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all selections"
              onPress={clearAllSelections}
              style={styles.clearAllButton}
            >
              <Text style={styles.clearAllText}>Clear All</Text>
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
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
    paddingTop: t.spacing.sm,
    paddingBottom: 4,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 16,
  },
  mealTabsBar: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: 4,
    paddingBottom: t.spacing.xs,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  mealTabsScroll: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  mealTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
  },
  mealTabActive: {
    backgroundColor: t.color.primary,
  },
  mealTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  mealTabTextActive: {
    color: t.color.textOnPrimary,
  },
  searchContainer: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    height: 38,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: t.color.textPrimary,
    paddingVertical: 4,
  },
  clearSearchButton: {
    padding: 4,
  },
  filterBar: {
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    paddingBottom: t.spacing.xs,
  },
  filterScroll: {
    paddingHorizontal: t.spacing.lg,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  filterChipActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: t.color.textPrimary,
  },
  filterChipTextActive: {
    color: t.color.textOnPrimary,
    fontWeight: '600',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  feastBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  feastBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: t.color.textSecondary,
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
  tierHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  checkboxIcon: {
    marginRight: 8,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  removeButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: t.color.surfaceAlt,
  },
  removeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.danger,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: t.spacing.xl,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  resetFilterButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  resetFilterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.primary,
  },
  footer: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.color.surface,
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerInfoRow: {
    flex: 1,
    gap: 2,
  },
  selectedCountText: {
    fontSize: 12,
    fontWeight: '500',
    color: t.color.textSecondary,
  },
  subtotalText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  clearAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: t.color.surfaceAlt,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.danger,
  },
}));

