# Implementation Plan

## Tasks

- [ ] 1. Migration and Shared Challenge Catalog
  - [ ] 1.1 Create migration `apps/api/migrations/0035_pins_and_challenges.sql` creating `user_pins` table and indexes
  - [ ] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0035.test.ts`
  - [ ] 1.3 Define `PinDTO`, `PinCategory`, `PinTier`, and criteria schemas in `packages/shared/src/schemas/Pin.ts`
  - [ ] 1.4 Implement the static 162-pin challenge definitions and explicit attraction/dining/resort sets in `packages/shared/src/pins/catalog.ts`
  - [ ] 1.5 Export new schemas, constants, and catalog in `packages/shared/src/index.ts` and add catalog unit tests

- [ ] 2. Pure Challenge Evaluation Engine
  - [ ] 2.1 Implement pure challenge evaluators in `apps/api/src/services/pins/evaluator.ts` for all challenge kinds (lifetime counts, land completion, single-day grouping, coasters, dining, resorts, social)
  - [ ] 2.2 Write comprehensive property tests `apps/api/src/services/pins/__tests__/evaluator.prop.test.ts` with `fast-check` validating Properties 1, 2, 3, and 4
  - [ ] 2.3 Write evaluator unit tests `apps/api/src/services/pins/__tests__/evaluator.test.ts` covering all 162 challenge definitions

- [ ] 3. Pin Service Repository and Fastify Routes
  - [ ] 3.1 Implement `PinRepo` in `apps/api/src/services/pins/repo.ts` handling pin querying, progress calculation, and atomic award inserts
  - [ ] 3.2 Implement `GET /me/pins` route in `apps/api/src/services/pins/routes.ts`
  - [ ] 3.3 Hook synchronous challenge evaluation into `ExperienceLogRepo.addLog` (Req 2.1) returning `newlyAwardedPinIds: string[]`
  - [ ] 3.4 Hook challenge evaluation into rating/note update routes (Req 2.2) and `confirmRodeWithTag` in trips repo (Req 2.3)
  - [ ] 3.5 Add route integration tests `apps/api/src/services/pins/__tests__/routes.test.ts` with `server.inject` covering auth gates, progress querying, and pin retrieval
  - [ ] 3.6 Wire `PinService` into `composeServices.ts`

- [ ] 4. Checkpoint — Backend Verification Gate
  - [ ] 4.1 Run `npm run verify:api` and `npm run verify:shared` to ensure backend and shared packages pass all tests and typechecks

- [ ] 5. Parametric SVG Pin Renderer (Mobile)
  - [ ] 5.1 Implement `PinView.tsx` in `apps/mobile/src/components/pins/` rendering contained and die-cut pins with metallic rims (`RIM_BY_TIER`), multi-stop `METALS` ramps, Royal enamel fills, and intra-tier ornament progression
  - [ ] 5.2 Add `motifPaths.ts` asset dictionary in `apps/mobile/src/components/pins/` generated from `.kiro/specs/pin-collection/motifs/`
  - [ ] 5.3 Write property and component tests in `apps/mobile/src/components/pins/__tests__/PinView.test.tsx` verifying Properties 5, 6, and 7

- [ ] 6. Mobile Pin Board UI & Attribution Screen
  - [ ] 6.1 Implement `PinBoardScreen.tsx` in `apps/mobile/src/screens/profile/` with tier filters (All, Bronze, Silver, Gold, Amethyst, Pearl, Prism), category tabs, and collection progress summary
  - [ ] 6.2 Implement `PinDetailModal.tsx` displaying high-res SVG art, lore description, criteria progress, and unlock date
  - [ ] 6.3 Implement `PinCelebrationModal.tsx` displaying celebratory unlock animations when `newlyAwardedPinIds` are returned
  - [ ] 6.4 Implement `AttributionScreen.tsx` in `apps/mobile/src/screens/profile/` displaying CC BY 3.0 credits matching `motifs/CREDITS.md`
  - [ ] 6.5 Add build gate test `apps/mobile/src/components/pins/__tests__/creditsGate.test.ts` asserting that every motif referenced in pin catalog has a corresponding entry in `CREDITS.md` (Req 6.2)
  - [ ] 6.6 Add navigation routes to `ProfileStack` for `PinBoardScreen` and `AttributionScreen`
  - [ ] 6.7 Write React Native UI tests in `apps/mobile/src/screens/profile/__tests__/PinBoardScreen.test.tsx`

- [ ] 7. Final End-to-End Verification Gate
  - [ ] 7.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

## Task Dependency Graph

```
1.1-1.5 (Migration & Shared Catalog)
          │
          ▼
2.1-2.3 (Pure Evaluation Engine & Property Tests)
          │
          ▼
3.1-3.6 (Pin Repository, Fastify Routes, Evaluation Hooks & Wiring)
          │
          ▼
4.1 (Checkpoint: Backend Verification Gate)
          │
          ▼
5.1-5.3 (Mobile Parametric SVG PinView Renderer & Property Tests)
          │
          ▼
6.1-6.7 (Mobile PinBoardScreen, Modals, Attribution Screen & Credits Gate)
          │
          ▼
7.1 (Final Verification Gate: npm run verify)
```

## Notes

- **Cross-Spec Dependency:** Depends on `experience-activity-logging` for single-day event grouping (`visited_on`).
- **Synchronous Delivery:** Newly awarded pins are evaluated and returned synchronously in `POST /me/experiences/:id/logs`, eliminating race conditions on free-tier Render.
- **Idempotency:** Award inserts use `ON CONFLICT (user_id, pin_id) DO NOTHING` to guarantee monotonic awards.
- **Attribution Obligation:** All motif art sourced from game-icons.net is credited under CC BY 3.0 in `AttributionScreen.tsx` matching `CREDITS.md` and validated via automated build gate.
