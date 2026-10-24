# Implementation Plan

## Tasks

- [x] 1. Legal Documentation & Disclaimers
  - [x] 1.1 Create `docs/terms-of-service.md`
    - Author canonical Terms of Service document in Markdown, including:
      - Effective date and acceptance of terms;
      - Disney Trademark & Non-Affiliation Disclaimer (Requirement 1);
      - ThemeParks.wiki data attribution (Requirement 3);
      - User Conduct & Objectionable Content Policy (Apple 1.2 compliance);
      - Account deletion references (linking to `/account-deletion` and `/privacy`);
      - Limitation of liability, warranty disclaimers, and support contact link.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5, 3.1, 3.2, 3.3_
  - [x] 1.2 Update `docs/privacy-policy.md` and `renderPrivacyPolicyHtml`
    - Add the Disney Trademark & Non-Affiliation Disclaimer and cross-link to `/terms` within `docs/privacy-policy.md` and `renderPrivacyPolicyHtml` in `apps/api/src/services/accountDeletion/webPages.ts`.
    - _Requirements: 1.5, 2.3_

- [x] 2. Backend HTML Renderer & Route (`GET /terms`)
  - [x] 2.1 Implement `renderTermsOfServiceHtml` in `apps/api/src/services/accountDeletion/webPages.ts`
    - Add `RenderTermsOfServiceOptions` (`{ supportEmail: string }`) and `renderTermsOfServiceHtml(opts: RenderTermsOfServiceOptions): string`.
    - Render standard responsive HTML page with header, Disney disclaimer, ThemeParks.wiki credit, user conduct rules, links to `/privacy` and `/account-deletion`, and escaped `mailto:` support email link.
    - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.2_
  - [x] 2.2 Wire `GET /terms` in `apps/api/src/services/accountDeletion/routes.ts`
    - Register `TERMS_PATH = '/terms'`.
    - Add `app.get(TERMS_PATH, async (_request, reply) => { ... })` with `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, rendering `renderTermsOfServiceHtml({ supportEmail: app.config.support.email })`.
    - _Requirements: 2.1, 2.2_
  - [x] 2.3 Backend unit and property tests
    - In `apps/api/src/services/accountDeletion/__tests__/webPages.prop.test.ts`: add property test for `renderTermsOfServiceHtml` verifying required disclaimer strings, ThemeParks.wiki credit, and hostile-string email escaping (Property 1).
    - In `apps/api/src/services/accountDeletion/__tests__/routes.test.ts`: test `GET /terms` returns 200, anti-framing headers, rendered disclaimer, and email link (Property 2). Update route path list assertion if needed.
    - _Requirements: 2.1, 2.2, 2.4_

- [x] 3. Checkpoint: Backend verification
  - Run `npm run verify:api`. Must exit with code 0.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Mobile Configuration & Constants
  - [x] 4.1 Declare `TERMS_OF_SERVICE_URL` in mobile constants
    - In `apps/mobile/src/photos/constants.ts` (or `apps/mobile/src/constants/legal.ts`), export `TERMS_OF_SERVICE_URL = process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL ?? ''`.
    - In `apps/mobile/eas.json`, add `"EXPO_PUBLIC_TERMS_OF_SERVICE_URL": "https://dwt-api.onrender.com/terms"` to `development`, `preview`, and `production` build profiles.
    - Document `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` in `apps/mobile/.env.example`.
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Mobile UI & Interaction Tests
  - [x] 5.1 Add Terms of Service card and in-app Disclaimer in `YouAndCrewScreen.tsx`
    - In `apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx`:
      - Add a "Terms of Service" card (`testID="you-and-crew-terms-of-service-card"`, button `testID="terms-of-service-entry-button"`, `accessibilityRole="link"`, `accessibilityLabel="Terms of Service"`) that invokes `Linking.openURL(TERMS_OF_SERVICE_URL || `${resolveBaseUrl()}/terms`)`.
      - Add an in-app legal disclaimer footer block (`testID="you-and-crew-legal-disclaimer"`) concisely displaying the Disney non-affiliation statement.
    - _Requirements: 1.5, 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 5.2 Mobile interaction and render tests
    - In `apps/mobile/src/screens/youAndCrew/__tests__/DeleteAccountFlow.test.tsx`:
      - Add test asserting pressing `terms-of-service-entry-button` calls `Linking.openURL` with the resolved Terms URL.
      - Add test asserting the in-app Disney non-affiliation disclaimer is rendered.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Checkpoint: Full Verification Gate
  - Run `npm run verify`. Full workspace typecheck and test suites must exit 0.
  - Inspect git diff and produce behavior-to-test map.

- [x] 7. App Store Packaging Assets & Configuration
  - [x] 7.1 Generate `icon.png`, `adaptive-icon.png`, and `splash.png` in `apps/mobile/assets/`
    - Render `apps/mobile/assets/icon.png` (1024×1024 opaque RGB) with the exact Ionicons `sparkles` vector motif centered over the full-bleed royal twilight gradient (`#7e57c2` -> `#5b2a86` -> `#3d1c5c`).
    - Render `apps/mobile/assets/adaptive-icon.png` (1024×1024 transparent RGBA) with the white `sparkles` motif centered inside the 66% safe zone.
    - Render `apps/mobile/assets/splash.png` (1024×1024) with the circular `MagicFab` `sparkles` emblem centered on the `#3d1c5c` twilight background.
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 7.2 Wire `icon`, `backgroundColor`, `web.splash`, and `android.adaptiveIcon` in `apps/mobile/app.config.ts` and add verification tests
    - Configure `icon: './assets/icon.png'`, `backgroundColor: '#3d1c5c'`, `web.splash: { image: './assets/splash.png', resizeMode: 'contain', backgroundColor: '#3d1c5c' }`, and `android.adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#5b2a86' }` in `apps/mobile/app.config.ts`.
    - Add unit assertions in `apps/mobile/__tests__/appConfigApiBaseUrl.test.ts` verifying the PNG files exist, have valid dimensions/color types (1024×1024 RGB for `icon.png`, 1024×1024 RGBA for `adaptive-icon.png`), and are wired in `app.config.ts`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

## Notes

- **Authority.** `requirements.md` and `design.md` in this folder are authoritative.
- **Verification tiers.** Run file-level tests (`vitest` in API, `jest` in mobile) while iterating, scoped verify at checkpoints, and `npm run verify` once before declaring done.
- **Pin gate not involved.** No catalogue or pin SVG files are modified.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "4.1", "7.1"] },
    { "id": 1, "tasks": ["2.1", "7.2"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["3"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["6"] }
  ]
}
```

