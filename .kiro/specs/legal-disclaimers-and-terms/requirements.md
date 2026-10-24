# Requirements Document

## Introduction

Disney World Tracker is an unofficial companion application for Walt Disney World Resort visitors. To comply with Apple App Store Review Guidelines (Guideline 1.2 for User-Generated Content, Guideline 5.1.1 for Privacy, and Guideline 5.2 for Intellectual Property / Trademarks) and Google Play Developer Policies (Impersonation, User-Generated Content, and Privacy), the application requires explicit legal disclaimers, a Terms of Service (EULA), and third-party data attribution.

This feature implements the lean, in-place legal compliance architecture (Option 1):
1. **Disney Trademark & Legal Disclaimer**: A clear nominative fair use statement, explicit declaration of non-affiliation with The Walt Disney Company, trademark ownership notices, and an operational data accuracy disclaimer.
2. **Terms of Service (`GET /terms`)**: A public web endpoint serving the formal User Agreement / Terms of Service (EULA), covering user conduct, acceptable use, reporting/blocking rules, limitation of liability, and links to `/privacy` and `/account-deletion`.
3. **Data Source & Third-Party Attribution**: Formal attribution for ThemeParks.wiki (which powers real-time wait times and park schedules) and cross-referencing open-source art credits.
4. **Mobile Settings & Disclaimers Integration**: An in-app "Terms of Service" card in `YouAndCrewScreen` (linking to `/terms` or `EXPO_PUBLIC_TERMS_OF_SERVICE_URL`) and an in-app legal disclaimer section presenting the Disney non-affiliation notice directly in the settings view.
5. **Privacy Policy Synchronization**: Updating the public `/privacy` page (`webPages.ts` and `docs/privacy-policy.md`) to cross-link to `/terms` and include the trademark disclaimer.

## Decisions Already Made

- **D1. In-place Settings integration**: The mobile entry points reside directly in `YouAndCrewScreen.tsx` within the settings section, adjacent to the existing Privacy Policy and Delete Account cards. We do not introduce a complex new navigation stack or move existing pin credits.
- **D2. Single-engine web rendering**: The public `GET /terms` page uses Fastify in `apps/api` and shares the existing CSS stylesheet, anti-framing security headers, and layout helpers in `webPages.ts` used by `/privacy` and `/account-deletion`.
- **D3. Configurable support and URLs**: `GET /terms` uses the existing required `config.support.email` for inquiries. The mobile app resolves the Terms URL via `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` with fallback to `${resolveBaseUrl()}/terms`.
- **D4. Keep Pin Art Credits in place**: The pin art attribution screen (`AttributionScreen.tsx`) remains on `PinBoardScreen` where it satisfies CC BY 3.0 requirements. The new Terms and Legal pages cross-reference it rather than moving it.

## Assumptions

- **A1. English-only legal texts**: The initial legal texts (Disclaimer, Terms of Service) are authored in English.
- **A2. Standard online terms**: The Terms of Service constitute an electronic agreement governing use of the app, disclaiming warranties, limiting liability, and establishing user obligations under applicable US law.

## Glossary

- **Disclaimer**: The legal statement clarifying that the App is unofficial, not affiliated with Disney, and that wait times are approximations.
- **Terms_Of_Service**: The End User License Agreement (EULA) and terms governing acceptable use, accounts, content, and liability.
- **ThemeParks_Wiki**: The community API source powering live operational data (wait times, park hours, showtimes).
- **Nominative_Fair_Use**: The legal doctrine permitting non-owner use of a trademark to identify or describe the genuine goods or services (such as naming Walt Disney World attractions).

---

## Requirements

### Requirement 1: Disney Trademark & Non-Affiliation Disclaimer

**User Story:** As an app user and platform reviewer, I want a clear legal disclaimer explaining that the app is unofficial and independent, so that there is no confusion regarding official Disney endorsement or affiliation.

#### Acceptance Criteria

1. THE Disclaimer SHALL explicitly state that the application is independent, unofficial, and not affiliated with, authorized by, endorsed by, or in any way officially connected with The Walt Disney Company, Disney Enterprises, Inc., or any of their subsidiaries or affiliates.
2. THE Disclaimer SHALL state that all Disney-related marks, logos, character names, park names, and attraction names are registered trademarks or copyrights of their respective owners.
3. THE Disclaimer SHALL state that any references to Disney trademarks or copyrighted material are used strictly for identification and nominative fair use purposes.
4. THE Disclaimer SHALL state that wait times, park schedules, and operational data are approximations provided for personal planning purposes only, and that official Disney apps and in-park cast members are the authoritative source.
5. THE Disclaimer SHALL be published on the web at `GET /terms`, on `GET /privacy`, and within the mobile application settings surface.

### Requirement 2: Public Terms of Service Endpoint (`GET /terms`)

**User Story:** As an app store reviewer and user, I want a publicly accessible Terms of Service page on the web, so that I can review the terms of use, content policies, and user obligations from any browser.

#### Acceptance Criteria

1. WHEN a client issues `GET /terms`, THE API SHALL respond with `200 OK` and `Content-Type: text/html; charset=utf-8`.
2. THE `GET /terms` response SHALL include security headers preventing framing: `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.
3. THE `GET /terms` page SHALL render:
   - The effective date and last updated date;
   - Acceptance of terms upon accessing or using the App;
   - The Disney Trademark & Non-Affiliation Disclaimer (Requirement 1);
   - Third-Party Data Attribution (Requirement 3);
   - User conduct rules and Objectionable Content Policy (forbidding abusive, hateful, infringing, or obscene submissions);
   - Account termination and suspension terms;
   - Limitation of liability and "as-is" disclaimer of warranties;
   - Clickable links to `/privacy` and `/account-deletion`;
   - A clickable `mailto:` link using the configured `SUPPORT_EMAIL`.
4. IF `SUPPORT_EMAIL` contains special characters, THE `GET /terms` renderer SHALL escape HTML entities to prevent injection.
5. THE repository SHALL maintain a canonical Markdown copy of the Terms of Service at `docs/terms-of-service.md`, and the HTML renderer SHALL mirror its content.

### Requirement 3: Third-Party Data Source & Art Attribution

**User Story:** As an open-source consumer and API integrator, I want clear attribution for third-party data providers, so that data provenance is transparent and downstream community obligations are honored.

#### Acceptance Criteria

1. THE `GET /terms` page and mobile legal notices SHALL explicitly acknowledge and credit **ThemeParks.wiki** as the provider of real-time wait times, park operating hours, and live attraction status data.
2. THE attribution SHALL include a link to the ThemeParks.wiki project (`https://themeparks.wiki`).
3. THE attribution SHALL reference open-source pin motif and icon libraries, noting that individual icon licenses and author credits are accessible in-app via the Vault collection art credits surface.

### Requirement 4: Mobile Settings & Disclaimers UI

**User Story:** As a mobile user, I want direct access to the Terms of Service and legal disclaimers from the You & Crew settings, so that I can review them at any time inside the app.

#### Acceptance Criteria

1. THE `YouAndCrewScreen` SHALL display a "Terms of Service" settings card adjacent to the "Privacy Policy" card.
2. WHEN the user presses the "Terms of Service" row, THE App SHALL open the configured Terms of Service URL in the system browser via `Linking.openURL`.
3. THE `YouAndCrewScreen` SHALL display an in-app legal disclaimer section containing the concise Disney non-affiliation notice and nominative fair use statement.
4. THE "Terms of Service" row SHALL expose accessibility attributes: `accessibilityRole="link"`, `accessibilityLabel="Terms of Service"`, and `testID="terms-of-service-entry-button"`.
5. THE settings card SHALL expose `testID="you-and-crew-terms-of-service-card"`.

### Requirement 5: Configuration & Build Profiles

**User Story:** As an operator, I want the Terms of Service URL configurable per deployment environment, so that local dev, staging, and production builds link to the correct host.

#### Acceptance Criteria

1. THE mobile app SHALL support `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` in `apps/mobile/eas.json` across `development`, `preview`, and `production` profiles, defaulting to `https://dwt-api.onrender.com/terms` in production.
2. WHEN `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` is absent or empty at runtime, THE mobile client SHALL fall back to `${resolveBaseUrl()}/terms`.
3. THE repository SHALL document `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` in `apps/mobile/.env.example`.

### Requirement 6: App Store Branding & Packaging Assets

**User Story:** As a mobile operator preparing for App Store and Google Play submission, I want production-grade app icon, adaptive icon, and splash screen assets wired into the Expo configuration, so that store builds do not fail review for placeholder assets.

#### Acceptance Criteria

1. THE repository SHALL include a 1024×1024 opaque PNG app icon at `apps/mobile/assets/icon.png` featuring the white `sparkles` motif centered over the full-bleed royal twilight gradient (`#7e57c2` -> `#5b2a86` -> `#3d1c5c`).
2. THE repository SHALL include a 1024×1024 transparent PNG Android adaptive icon foreground at `apps/mobile/assets/adaptive-icon.png` featuring the white `sparkles` motif sized within the inner 66% safe zone.
3. THE repository SHALL include a PNG splash screen image at `apps/mobile/assets/splash.png` featuring the `sparkles` badge centered on a deep twilight background (`#3d1c5c`).
4. THE `apps/mobile/app.config.ts` configuration SHALL reference `./assets/icon.png` in `icon`, set `backgroundColor: '#3d1c5c'`, configure `web.splash` with `image: './assets/splash.png'`, `resizeMode: 'contain'`, and `backgroundColor: '#3d1c5c'`, and configure `android.adaptiveIcon` with `foregroundImage: './assets/adaptive-icon.png'` and `backgroundColor: '#5b2a86'`.


