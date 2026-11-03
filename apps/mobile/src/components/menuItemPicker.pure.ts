/**
 * Pure functions for MenuItemPicker (Task 17.3, Property 27).
 *
 * Implements:
 * - isAlcoholicGroupType: checks group type against "Alcoholic Beverage" (case-insensitive, Requirement 9.5)
 * - buildPickerRows: transforms MenuDTO[] into structured picker rows/sections
 * - selectionToExpenseItems: converts picker selection to array of ExpenseItemInput rows (Property 27)
 * - selectionSubtotalCents: sums up selection cents
 * - selectionToBudgetPriceRef: produces MenuPriceRef payload for Budget line allocations
 */

import {
  normalizeMenuName,
  normalizeTierName,
  parseMenuPriceString,
  type ExpenseItemInput,
  type MenuDTO,
  type MenuPriceOffer,
  type MenuPriceRef,
} from '@dwt/shared';

export function isAlcoholicGroupType(type?: string | null): boolean {
  if (!type) return false;
  return type.trim().toLowerCase() === 'alcoholic beverage';
}

export interface PickerItemVariant {
  readonly cents: number;
  readonly label: string | null;
}

export interface PickerItemRow {
  readonly id: string;
  readonly menuType: string;
  readonly groupName: string;
  readonly groupType: string | null;
  readonly name: string;
  readonly priceDisplay: string | null;
  readonly variants: readonly PickerItemVariant[];
  readonly defaultPriceCents: number | null;
  readonly isPriceless: boolean;
  readonly isAlcohol: boolean;
}

export interface PickerSection {
  readonly menuType: string;
  readonly groupName: string;
  readonly groupType: string | null;
  readonly items: readonly PickerItemRow[];
}

export interface SelectedItemState {
  readonly name: string;
  readonly priceCents: number;
  readonly priceLabel?: string | null;
  readonly quantity: number;
  readonly isAlcohol?: boolean;
}

export interface SelectedTierState {
  readonly name: string;
  readonly priceCents: number;
  readonly quantity?: number;
}

export interface PickerSelection {
  readonly items?: readonly SelectedItemState[];
  readonly tier?: SelectedTierState | MenuPriceOffer | null;
  readonly tiers?: readonly SelectedTierState[];
}

/**
 * Builds display sections and item rows from cached MenuDTO array.
 */
export function buildPickerRows(
  menus: readonly MenuDTO[] | null | undefined
): PickerSection[] {
  if (!menus || menus.length === 0) return [];

  const sections: PickerSection[] = [];

  for (let mIdx = 0; mIdx < menus.length; mIdx++) {
    const menu = menus[mIdx]!;
    const menuType = menu.menuType || 'Menu';

    for (let gIdx = 0; gIdx < (menu.groups ?? []).length; gIdx++) {
      const group = menu.groups[gIdx]!;
      const groupName = group.name || 'Items';
      const groupType = group.type ?? null;
      const isAlcohol = isAlcoholicGroupType(groupType);

      const items: PickerItemRow[] = [];

      for (let iIdx = 0; iIdx < (group.items ?? []).length; iIdx++) {
        const item = group.items[iIdx]!;
        const rawName = item.name;
        if (!rawName || rawName.trim().length === 0) continue;

        const variants: PickerItemVariant[] = [];

        if (item.prices && item.prices.length > 0) {
          for (const p of item.prices) {
            if (typeof p.cents === 'number' && p.cents > 0) {
              variants.push({ cents: p.cents, label: p.label ?? null });
            }
          }
        } else if (typeof item.priceCents === 'number' && item.priceCents > 0) {
          variants.push({ cents: item.priceCents, label: null });
        } else if (item.price) {
          const parsed = parseMenuPriceString(item.price);
          for (const c of parsed) {
            if (c > 0) {
              variants.push({ cents: c, label: null });
            }
          }
        }

        const isPriceless = variants.length === 0;
        const defaultPriceCents = variants.length === 1 ? variants[0]!.cents : null;

        items.push({
          id: `${mIdx}-${gIdx}-${iIdx}-${rawName}`,
          menuType,
          groupName,
          groupType,
          name: rawName,
          priceDisplay: item.price ?? null,
          variants,
          defaultPriceCents,
          isPriceless,
          isAlcohol,
        });
      }

      if (items.length > 0) {
        sections.push({
          menuType,
          groupName,
          groupType,
          items,
        });
      }
    }
  }

  return sections;
}

/**
 * Calculates total subtotal cents from a picker selection.
 */
export function selectionSubtotalCents(selection: PickerSelection): number {
  let total = 0;
  if (selection.tiers && selection.tiers.length > 0) {
    for (const t of selection.tiers) {
      const qty = typeof t.quantity === 'number' ? t.quantity : 1;
      total += t.priceCents * qty;
    }
  } else if (selection.tier) {
    const qty =
      'quantity' in selection.tier && typeof selection.tier.quantity === 'number'
        ? selection.tier.quantity
        : 1;
    total += selection.tier.priceCents * qty;
  }
  if (selection.items && selection.items.length > 0) {
    total += selection.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  }
  return total;
}

/**
 * Converts picker selection into ExpenseItemInput rows for ExpenseForm.
 * Repeats items quantity times, ensures isAlcohol matches group type,
 * truncates names to EXPENSE_ITEM_NAME_MAX, and attaches assignees.
 */
export function selectionToExpenseItems(
  selection: PickerSelection,
  assigneeIds: readonly string[]
): ExpenseItemInput[] {
  if (!assigneeIds || assigneeIds.length === 0) {
    throw new Error('assigneeIds must contain at least one assignee');
  }

  const result: ExpenseItemInput[] = [];

  if (selection.tiers && selection.tiers.length > 0) {
    for (const t of selection.tiers) {
      const name = normalizeTierName(t.name);
      const qty = typeof t.quantity === 'number' ? Math.max(1, t.quantity) : 1;
      for (let i = 0; i < qty; i++) {
        result.push({
          name,
          priceCents: t.priceCents,
          assigneeIds: [...assigneeIds],
          isAlcohol: false,
        });
      }
    }
  } else if (selection.tier) {
    const rawLabel = 'label' in selection.tier ? selection.tier.label : selection.tier.name;
    const name = normalizeTierName(rawLabel);
    const qty =
      'quantity' in selection.tier && typeof selection.tier.quantity === 'number'
        ? selection.tier.quantity
        : 1;

    for (let i = 0; i < qty; i++) {
      result.push({
        name,
        priceCents: selection.tier.priceCents,
        assigneeIds: [...assigneeIds],
        isAlcohol: false,
      });
    }
    if (!selection.items || selection.items.length === 0) {
      return result;
    }
  }

  for (const item of selection.items ?? []) {
    const name = normalizeMenuName(item.name);
    const qty = Math.max(1, item.quantity);

    for (let i = 0; i < qty; i++) {
      result.push({
        name,
        priceCents: item.priceCents,
        assigneeIds: [...assigneeIds],
        isAlcohol: Boolean(item.isAlcohol),
      });
    }
  }

  return result;
}

/**
 * Converts picker selection into MenuPriceRef for Budget line allocations.
 */
export function selectionToBudgetPriceRef(selection: PickerSelection): MenuPriceRef {
  if (selection.tiers && selection.tiers.length > 1) {
    const tierItems = selection.tiers.map((t) => ({
      name: normalizeMenuName(t.name),
      priceCents: t.priceCents,
      priceLabel: null,
      quantity: typeof t.quantity === 'number' ? Math.max(1, t.quantity) : 1,
    }));
    const regularItems = (selection.items ?? []).map((item) => ({
      name: normalizeMenuName(item.name),
      priceCents: item.priceCents,
      priceLabel: item.priceLabel ? item.priceLabel.slice(0, 60) : null,
      quantity: item.quantity,
      ...(item.isAlcohol ? { isAlcohol: true } : {}),
    }));
    return {
      kind: 'menu',
      items: [...tierItems, ...regularItems],
    };
  }

  if (selection.tier) {
    const rawLabel = 'label' in selection.tier ? selection.tier.label : selection.tier.name;
    return {
      kind: 'menu',
      tier: {
        name: normalizeTierName(rawLabel),
        priceCents: selection.tier.priceCents,
      },
    };
  }

  const items = (selection.items ?? []).map((item) => ({
    name: normalizeMenuName(item.name),
    priceCents: item.priceCents,
    priceLabel: item.priceLabel ? item.priceLabel.slice(0, 60) : null,
    quantity: item.quantity,
    ...(item.isAlcohol ? { isAlcohol: true } : {}),
  }));

  return {
    kind: 'menu',
    items,
  };
}

