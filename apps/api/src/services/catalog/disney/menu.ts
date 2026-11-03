/**
 * Pure projection of the Disney `Menu_Service` payload into the shared
 * `MenuDTO` shape (design.md → "7. Menu retrieval and projection").
 *
 * `Facilities_Client.getMenus(enterpriseId)` fetches a restaurant's raw menus
 * from the undocumented, reverse-engineered Menu_Service; `projectMenus` is the
 * pure core that converts those raw menus into the persisted/served DTO,
 * preserving per menu the menu type and cuisine type and, per group, the
 * group's name, its item names, and its item price strings (R8.2).
 *
 * Because the Menu_Service is undocumented, `RawMenu` is modeled the same
 * tolerant way as the other Disney raw shapes (`facilityDoc.ts`): every field
 * is optional and every array entry may be absent, so a partial or unexpected
 * payload still projects whatever it can rather than throwing. This mirrors the
 * defensive discipline used across the Disney projection cores.
 *
 * Purity note: `projectMenus` is pure, total, and deterministic — it depends
 * only on its argument, performs no I/O, and never throws for any input,
 * including menus with missing types, missing groups, or missing items. Price
 * strings are carried through verbatim (never trimmed or reformatted) so the
 * value the App sees is exactly the upstream string (R8.2).
 *
 * Validates: Requirements 8.2, 10.5, 10.6
 */

import type { MenuDTO, MenuGroupDTO, MenuItemDTO, MenuPriceEntry } from '@dwt/shared';

/**
 * A single price variant entry in a raw menu item.
 */
export interface RawMenuPriceItem {
  readonly cents?: number | null | undefined;
  readonly label?: string | null | undefined;
  readonly withoutTax?: number | null | undefined;
  readonly type?: string | null | undefined;
  readonly currency?: string | null | undefined;
}

/**
 * A single raw menu item as returned by the Menu_Service.
 * `price` is carried verbatim when present.
 */
export interface RawMenuItem {
  /** Item display name. */
  readonly name?: string | null | undefined;
  /** Item price string, carried verbatim from upstream (R8.2). */
  readonly price?: string | null | undefined;
  /** Structured price entries when present (R10.5). */
  readonly prices?: readonly (RawMenuPriceItem | null | undefined)[] | null | undefined;
  /** Single resolved price in integer cents (R10.5). */
  readonly priceCents?: number | null | undefined;
}

/**
 * A single raw menu group (course/section) as returned by the Menu_Service.
 */
export interface RawMenuGroup {
  /** Group name (e.g. `"Appetizers"`). */
  readonly name?: string | null | undefined;
  /** Group classification (e.g. `"Alcoholic Beverage"`, `"Entree"`) (R10.5). */
  readonly type?: string | null | undefined;
  /** Items in the group; entries may be absent in a partial payload. */
  readonly items?: readonly (RawMenuItem | null | undefined)[] | null | undefined;
}

/**
 * A single raw menu as returned by the Menu_Service (one element of the array
 * produced by `Facilities_Client.getMenus`). Every field is optional so a
 * partial or unexpected payload still projects (design "source-of-truth" note).
 */
export interface RawMenu {
  /** Menu_Type label (e.g. `"Dinner"`, `"All Day"`). */
  readonly menuType?: string | null | undefined;
  /** Cuisine type when present upstream. */
  readonly cuisineType?: string | null | undefined;
  /** Service style when present (e.g. `"buffet"`, `"table service"`) (R10.5). */
  readonly serviceStyle?: string | null | undefined;
  /** Dining experience descriptor (e.g. `"Character Dining"`) (R10.5). */
  readonly experience?: string | null | undefined;
  /** Menu groups; entries may be absent in a partial payload. */
  readonly groups?: readonly (RawMenuGroup | null | undefined)[] | null | undefined;
}

/**
 * Return `value` when it is a string, otherwise `undefined`. Used to defend
 * against non-string values sneaking through the untyped JSON boundary.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Return `value` when it is a non-empty string, otherwise `undefined`.
 */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Project a single raw menu item into the DTO item shape. A missing/non-string
 * name becomes an empty string so the group's item structure is preserved; a
 * missing/non-string price becomes `null`. The price string is carried
 * verbatim (R8.2). Structured prices are carried over only when valid USD (R10.5).
 */
function projectItem(raw: RawMenuItem): MenuItemDTO {
  const name = asString(raw.name) ?? '';
  const price = asString(raw.price) ?? null;

  let validPrices: MenuPriceEntry[] | undefined;
  if (Array.isArray(raw.prices)) {
    const collected: MenuPriceEntry[] = [];
    for (const p of raw.prices) {
      if (typeof p !== 'object' || p === null) continue;
      if (p.currency !== undefined && p.currency !== null && p.currency !== 'USD') {
        continue;
      }
      let cents: number | undefined;
      if (typeof p.cents === 'number' && Number.isSafeInteger(p.cents) && p.cents > 0) {
        cents = Math.round(p.cents);
      } else if (typeof p.withoutTax === 'number' && Number.isFinite(p.withoutTax) && p.withoutTax > 0) {
        const computed = Math.round(p.withoutTax * 100);
        if (Number.isSafeInteger(computed) && computed > 0) {
          cents = computed;
        }
      }
      if (cents === undefined || cents <= 0 || !Number.isSafeInteger(cents)) continue;
      const label = asNonEmptyString(p.label) ?? asNonEmptyString(p.type) ?? null;
      collected.push({ cents, label });
    }
    if (collected.length > 0) {
      validPrices = collected;
    }
  }

  const result: {
    name: string;
    price: string | null;
    prices?: readonly MenuPriceEntry[];
    priceCents?: number | null;
  } = {
    name,
    price,
  };

  if (validPrices) {
    result.prices = validPrices;
    if (validPrices.length === 1 && validPrices[0]) {
      result.priceCents = validPrices[0].cents;
    }
  } else if (typeof raw.priceCents === 'number' && Number.isSafeInteger(raw.priceCents) && raw.priceCents > 0) {
    result.priceCents = Math.round(raw.priceCents);
  }

  return result;
}

/**
 * Project a single raw menu group into the DTO group shape, dropping any absent
 * item entries while preserving the order of the remaining items.
 */
function projectGroup(raw: RawMenuGroup): MenuGroupDTO {
  const rawItems = raw.items ?? [];
  const items = rawItems
    .filter((item): item is RawMenuItem => item !== null && item !== undefined)
    .map(projectItem);

  const type = asNonEmptyString(raw.type);

  return {
    name: asString(raw.name) ?? '',
    items,
    ...(type !== undefined ? { type } : {}),
  };
}

/**
 * Convert the raw Menu_Service menus for one restaurant into `MenuDTO[]`,
 * preserving each menu's type and cuisine type and, per group, the group name,
 * item names, and item price strings (R8.2). Structured fields are carried
 * through additively only when present and valid (R10.5, R10.6).
 *
 * Pure, total, and deterministic: absent menus, groups, or items are dropped
 * defensively, missing string fields default to an empty string (`menuType`,
 * group/item `name`) or `null` (`cuisineType`, item `price`), and the function
 * never throws. An empty input yields an empty array.
 *
 * @param raw - The raw menus returned by `Facilities_Client.getMenus` or `diningMenuClient`.
 * @returns The projected menus in upstream order.
 */
export function projectMenus(raw: readonly RawMenu[]): readonly MenuDTO[] {
  return raw
    .filter((menu): menu is RawMenu => menu !== null && menu !== undefined)
    .map((menu): MenuDTO => {
      const rawGroups = menu.groups ?? [];
      const groups = rawGroups
        .filter((group): group is RawMenuGroup => group !== null && group !== undefined)
        .map(projectGroup);

      const serviceStyle = asNonEmptyString(menu.serviceStyle);
      const experience = asNonEmptyString(menu.experience);

      return {
        menuType: asString(menu.menuType) ?? '',
        cuisineType: asString(menu.cuisineType) ?? null,
        groups,
        ...(serviceStyle !== undefined ? { serviceStyle } : {}),
        ...(experience !== undefined ? { experience } : {}),
      };
    });
}
