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
 * Validates: Requirements 8.2
 */

import type { MenuDTO } from '@dwt/shared';

/**
 * A single raw menu item as returned by the Menu_Service. Both fields are
 * optional; `price` is carried verbatim when present.
 */
export interface RawMenuItem {
  /** Item display name. */
  readonly name?: string | null;
  /** Item price string, carried verbatim from upstream (R8.2). */
  readonly price?: string | null;
}

/**
 * A single raw menu group (course/section) as returned by the Menu_Service.
 */
export interface RawMenuGroup {
  /** Group name (e.g. `"Appetizers"`). */
  readonly name?: string | null;
  /** Items in the group; entries may be absent in a partial payload. */
  readonly items?: readonly (RawMenuItem | null | undefined)[] | null;
}

/**
 * A single raw menu as returned by the Menu_Service (one element of the array
 * produced by `Facilities_Client.getMenus`). Every field is optional so a
 * partial or unexpected payload still projects (design "source-of-truth" note).
 */
export interface RawMenu {
  /** Menu_Type label (e.g. `"Dinner"`, `"All Day"`). */
  readonly menuType?: string | null;
  /** Cuisine type when present upstream. */
  readonly cuisineType?: string | null;
  /** Menu groups; entries may be absent in a partial payload. */
  readonly groups?: readonly (RawMenuGroup | null | undefined)[] | null;
}

/**
 * Return `value` when it is a string, otherwise `undefined`. Used to defend
 * against non-string values sneaking through the untyped JSON boundary.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Project a single raw menu item into the DTO item shape. A missing/non-string
 * name becomes an empty string so the group's item structure is preserved; a
 * missing/non-string price becomes `null`. The price string is carried
 * verbatim (R8.2).
 */
function projectItem(raw: RawMenuItem): { readonly name: string; readonly price: string | null } {
  return {
    name: asString(raw.name) ?? '',
    price: asString(raw.price) ?? null,
  };
}

/**
 * Project a single raw menu group into the DTO group shape, dropping any absent
 * item entries while preserving the order of the remaining items.
 */
function projectGroup(
  raw: RawMenuGroup,
): { readonly name: string; readonly items: readonly { readonly name: string; readonly price: string | null }[] } {
  const rawItems = raw.items ?? [];
  const items = rawItems
    .filter((item): item is RawMenuItem => item !== null && item !== undefined)
    .map(projectItem);

  return {
    name: asString(raw.name) ?? '',
    items,
  };
}

/**
 * Convert the raw Menu_Service menus for one restaurant into `MenuDTO[]`,
 * preserving each menu's type and cuisine type and, per group, the group name,
 * item names, and item price strings (R8.2).
 *
 * Pure, total, and deterministic: absent menus, groups, or items are dropped
 * defensively, missing string fields default to an empty string (`menuType`,
 * group/item `name`) or `null` (`cuisineType`, item `price`), and the function
 * never throws. An empty input yields an empty array (supporting the "no menus
 * → persist none" orchestrator behavior, R8.3).
 *
 * @param raw - The raw menus returned by `Facilities_Client.getMenus`.
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

      return {
        menuType: asString(menu.menuType) ?? '',
        cuisineType: asString(menu.cuisineType) ?? null,
        groups,
      };
    });
}
