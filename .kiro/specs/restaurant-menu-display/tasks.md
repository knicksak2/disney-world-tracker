# Implementation Plan: Restaurant Menu Display

## Overview

The retrieval seam, cache, projection, transport, and `MenuDTO` already exist. This plan
wires the lazy `createMenuRetrieval` seam into the running server, gates the menu read to
restaurants on the detail route, and builds the mobile experience (summary card + dedicated
menu screen + navigation). Work proceeds backend-first (wiring → gate), then mobile
(pure helper → detail DTO → summary card → menu screen → navigation), with property-based
tests (fast-check, min 100 runs, tagged per property) and example/integration tests placed
close to the code they validate.

## Tasks

- [x] 1. Wire demand-driven menu retrieval at the composition root
  - [x] 1.1 Construct `createMenuRetrieval` and route the catalog `getMenusFor` port through it
    - In `apps/api/src/composeServices.ts`, import `createMenuRetrieval` from `./services/catalog/menuRetrieval.js`
    - After `facilitiesClient` is built, construct the seam with `{ repo: catalogRepo, client: facilitiesClient, freshnessMs: config.disney.menuFreshnessMs }`
    - Change the catalog wiring from `getMenusFor: (id) => catalogRepo.getMenusFor(id)` to `getMenusFor: (id) => menuRetrieval.getMenuForRestaurant(id)`
    - Rely on the seam's default injected `logger`/`now` (no new transport, cache, or limiter)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3_

  - [x] 1.2 Write integration/wiring test for transport + budget routing
    - Assert the retrieval seam is wired to the composed `facilitiesClient` so every Menu_Service call flows through the shared `Disney_Transport` and the Redis-backed `Rate_Limiter`, and no path reaches the Menu_Service without the transport
    - Extend the existing Disney sourcing smoke coverage
    - _Requirements: 2.1, 2.3_

- [x] 2. Gate the catalog detail route menu read to restaurants
  - [x] 2.1 Add the `category === 'Restaurant'` guard on the detail handler
    - In `apps/api/src/services/catalog/routes.ts`, in the `GET /catalog/:experienceId` handler, only call `options.getMenusFor(experienceId)` when `options.getMenusFor` is present AND `experience.category === 'Restaurant'`; otherwise use `[]`
    - Leave `toDetailResponse` unchanged so `menus` is attached only when non-empty and omitted otherwise
    - Keep the `getMenusFor` port signature `(experienceId) => Promise<readonly MenuDTO[]>` unchanged
    - _Requirements: 1.4, 3.1, 3.2_

  - [x] 2.2 Write property test for lazy retrieval behavior
    - **Property 1: Lazy retrieval serves fresh, fetches on miss/stale, and degrades on failure**
    - **Validates: Requirements 1.1, 1.2, 1.3, 3.3, 3.4, 3.5**
    - Extend `menuRetrieval.prop.test.ts` with faked repo/client; fast-check, min 100 runs, tagged `// Feature: restaurant-menu-display, Property 1: ...`

  - [x] 2.3 Write property test for the non-restaurant gate
    - **Property 2: Non-restaurant experiences never contact the Menu_Service and omit menus**
    - **Validates: Requirements 1.4**
    - Exercise the detail route handler with a spy menu port; assert no invocation and `menus` omitted; fast-check, min 100 runs, tagged per property

  - [x] 2.4 Write property test for at-most-one Menu_Service request
    - **Property 3: A single detail read issues at most one Menu_Service request**
    - **Validates: Requirements 2.2**
    - Drive the retrieval seam with a call-counting `getMenus` over restaurants with arbitrary menu/meal-period counts; fast-check, min 100 runs, tagged per property

  - [x] 2.5 Write property test for menu include/omit rule
    - **Property 4: The response includes menus exactly when non-empty and omits them otherwise**
    - **Validates: Requirements 3.1, 3.2**
    - Exercise `toDetailResponse` / handler over arbitrary served lists; fast-check, min 100 runs, tagged per property

  - [x] 2.6 Write property test for projection preservation
    - **Property 5: Menu projection preserves structure, order, and field values verbatim**
    - **Validates: Requirements 3.6**
    - Extend the existing `projectMenus` tests over arbitrary raw Menu_Service payloads; fast-check, min 100 runs, tagged per property

  - [x] 2.7 Write example test for failure logging
    - Confirm `logger.warn` is invoked on a Menu_Service failure (non-propagation is covered by Property 1)
    - _Requirements: 3.5_

- [x] 3. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add the mobile menu summary derivation and detail DTO
  - [x] 4.1 Implement the `summarizeMenus` pure helper
    - Create `apps/mobile/src/screens/catalog/menuSummary.ts` exporting `MenuSummary { count, menuTypes }` and `summarizeMenus(menus: readonly MenuDTO[]): MenuSummary`
    - Total/pure: map the menu list to its count and the ordered list of `menuType` labels
    - Import `MenuDTO` from `@dwt/shared`
    - _Requirements: 4.1_

  - [x] 4.2 Write property test for the summary derivation
    - **Property 6: The summary card reflects the available menus**
    - **Validates: Requirements 4.1**
    - Over arbitrary non-empty menu lists assert `count` equals the number of menus and `menuTypes` lists every menu type in order; fast-check, min 100 runs, tagged per property

  - [x] 4.3 Add the `menus` field to the mobile detail DTO
    - In `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`, add `readonly menus?: readonly MenuDTO[]` to `ExperienceDetailDTO` mirroring the backend `ExperienceDetailResponse`
    - Import `MenuDTO` from `@dwt/shared`
    - _Requirements: 3.1_

- [x] 5. Build the Menu_Summary_Card on the detail screen
  - [x] 5.1 Implement `MenuSummaryCard` with all render states and navigation
    - Add the themed card (in `ExperienceDetailScreen.tsx` or a sibling module) rendered inside the detail scroll view, driven by detail query state + category
    - Non-restaurant → render nothing; loading → `ActivityIndicator`, no card content; error → nothing (top-level error indicator handles it); menus present → `Card` with `SectionLabel` "Menus", the menu count, and a `Badge` per menu type, `onPress` → `navigation.navigate('Menu', { experienceId })`; no menus → `EmptyState` "No menu available" with no press target
    - Use the shared Magical / Whimsical theme components (Card, SectionLabel, Badge)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.2 Write example tests for summary card interactions and states
    - Navigation on tap, loading indicator, no-menu empty state, detail error state, non-restaurant no-card case
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 5.3 Write structure test for summary card theme usage
    - Assert the shared `Card`, `SectionLabel`, and `Badge` primitives are used
    - _Requirements: 4.7_

- [x] 6. Build the dedicated Menu_Screen
  - [x] 6.1 Implement `MenuScreen` rendering the full menus
    - Create `apps/mobile/src/screens/catalog/MenuScreen.tsx`, reading the cached detail via `useQuery(['experience', experienceId], …)` (same key/fn as the detail screen)
    - Render a `GradientHeader` with the restaurant name and an `onBack` control invoking `navigation.goBack`; one `Card` block per menu with the menu type as `SectionLabel`/`Badge` and the cuisine type alongside when present; each group with its name and items in index order; each item as name plus verbatim non-empty price, name alone when price absent/empty
    - Include a loading/error/empty fallback for an unpopulated `['experience', id]` query (deep-link defensive path)
    - Use the shared Magical / Whimsical theme components (Card, SectionLabel, Badge, GradientHeader)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 6.2 Write property test for Menu_Screen completeness and order
    - **Property 7: The Menu_Screen renders every menu, group, and item in order**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - Over arbitrary menu lists assert every menu (labelled by type), group, and item renders preserving provided order; fast-check, min 100 runs, tagged per property

  - [x] 6.3 Write property test for conditional cuisine rendering
    - **Property 8: Cuisine type is rendered exactly when present**
    - **Validates: Requirements 5.4, 5.5**
    - Assert cuisine rendered alongside menu type iff non-null, else menu type alone; fast-check, min 100 runs, tagged per property

  - [x] 6.4 Write property test for conditional price rendering
    - **Property 9: Item price is rendered verbatim exactly when non-empty**
    - **Validates: Requirements 5.6, 5.7**
    - Assert price rendered verbatim with the name iff the price string is non-empty, else name alone; fast-check, min 100 runs, tagged per property

  - [x] 6.5 Write example test for the Menu_Screen back control and theme usage
    - Confirm a back control exists and invokes `navigation.goBack`; assert shared `GradientHeader`/`Card`/`SectionLabel`/`Badge` primitives are used
    - _Requirements: 5.8, 5.9_

- [x] 7. Register Menu_Screen navigation and wire the card entry point
  - [x] 7.1 Register the Menu route on the root stack
    - In `RootNavigator.tsx`, add `Menu: { experienceId: string }` to `RootStackParamList` and register `<RootStack.Screen name="Menu" component={MenuScreen} options={{ headerShown: false }} />` as a sibling of `ExperienceDetail`
    - Ensure the `MenuSummaryCard` `navigation.navigate('Menu', { experienceId })` call resolves against the registered route
    - _Requirements: 4.2, 5.8_

  - [x] 7.2 Write integration test for the end-to-end restaurant read
    - Hit `GET /catalog/:experienceId` for a restaurant with a stubbed Menu_Service; assert the cache is populated and the response carries `menus`, and that a second read within the freshness window serves from cache without a further Menu_Service call
    - _Requirements: 1.1, 1.3, 3.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests (fast-check, min 100 runs, tagged `// Feature: restaurant-menu-display, Property {n}: ...`) validate the 9 universal correctness properties; there is exactly one property test per property
- Unit/example and integration tests cover the architectural (R2.1, R2.3), styling (R4.7, R5.9), and interaction criteria that are not universally-quantified properties
- The backend retrieval seam, cache, projection, transport, and `MenuDTO` are reused unchanged; this plan only wires and gates them and adds the mobile UI

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.2", "4.3", "6.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.6", "2.7", "5.1", "6.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "5.2", "6.4", "7.1"] },
    { "id": 4, "tasks": ["5.3", "6.5", "7.2"] }
  ]
}
```
