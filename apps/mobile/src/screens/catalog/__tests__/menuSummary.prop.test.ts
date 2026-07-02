// Feature: restaurant-menu-display, Property 6: The summary card reflects the available menus
//
// Property test for the pure summary derivation core (`summarizeMenus`) that
// feeds the Menu_Summary_Card (design.md → "4. summarizeMenus pure helper").
//
//   - Property 6 — The summary card reflects the available menus.
//       Validates: Requirements 4.1
//
// Over arbitrary NON-EMPTY menu lists, the derived summary must report a `count`
// equal to the number of menus and a `menuTypes` list that names every menu's
// `menuType`, in the provided order. The shared `MenuDTO[]` arbitrary spans the
// feature's edge cases (empty/whitespace/unicode menu types, missing cuisine,
// empty/missing prices) so the ordering + count guarantee is exercised across
// the whole input space rather than a happy-path example.

import fc from 'fast-check';

import { summarizeMenus } from '../menuSummary';
import { nonEmptyMenuListArb } from '../__testSupport__/menuArbitraries';

const NUM_RUNS = 100;

describe('Property 6: summarizeMenus reflects the available menus', () => {
  it('reports count === number of menus and menuTypes === every menu type in order', () => {
    fc.assert(
      fc.property(nonEmptyMenuListArb, (menus) => {
        const summary = summarizeMenus(menus);

        // R4.1 — the card reports how many menus are available.
        expect(summary.count).toBe(menus.length);

        // R4.1 — the card lists every menu's menu type, in the provided order.
        expect(summary.menuTypes).toEqual(menus.map((menu) => menu.menuType));

        // Redundant with the array equality above, but pins the "in order"
        // guarantee element-by-element for a clearer counterexample on failure.
        expect(summary.menuTypes).toHaveLength(menus.length);
        menus.forEach((menu, index) => {
          expect(summary.menuTypes[index]).toBe(menu.menuType);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
