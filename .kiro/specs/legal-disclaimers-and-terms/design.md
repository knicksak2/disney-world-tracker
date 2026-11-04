# Design Document: Legal Disclaimers & Terms of Service

## Architecture Overview

This design implements the legal disclaimers, Terms of Service (EULA), and attribution requirements across the backend (`apps/api`) and mobile client (`apps/mobile`), reusing existing patterns established by the `account-deletion` feature.

```
                      +---------------------------------------+
                      |       Mobile App (apps/mobile)        |
                      |                                       |
                      |  YouAndCrewScreen:                    |
                      |   - Terms of Service Card             |
                      |   - Privacy Policy Card               |
                      |   - In-app Legal Disclaimer text      |
                      +-------------------+-------------------+
                                          |
                        Linking.openURL() | (opens browser)
                                          v
                      +---------------------------------------+
                      |           API (apps/api)              |
                      |                                       |
                      |  GET /terms    GET /privacy           |
                      |       \             /                 |
                      |      webPages.ts (shared styling)     |
                      |   - HTML security headers             |
                      |   - Escape helper                     |
                      |   - Terms & Privacy templates         |
                      +---------------------------------------+
```

## Components and Interfaces

### 1. Web Page Renderer (`apps/api/src/services/accountDeletion/webPages.ts`)

Extend the existing server-side HTML rendering module (or a dedicated legal web page helper) to render `GET /terms`:

```typescript
export interface RenderTermsOfServiceOptions {
  readonly supportEmail: string;
}

export function renderTermsOfServiceHtml(opts: RenderTermsOfServiceOptions): string;
```

The HTML layout shares the existing CSS palette and styles in `webPages.ts`:
- Responsive max-width 720px card layout
- Clean typography and system fonts
- Anti-framing security headers:
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: frame-ancestors 'none'`
  - `Content-Type: text/html; charset=utf-8`

### 2. Route Registration (`apps/api/src/services/accountDeletion/routes.ts`)

Register `GET /terms` (or `TERMS_PATH = '/terms'`) alongside `/privacy` and `/account-deletion`:
- Unauthenticated public GET endpoint
- Resolves `app.config.support.email` and passes it to `renderTermsOfServiceHtml`
- Returns status `200` with security headers and HTML content.

### 3. Canonical Markdown Document (`docs/terms-of-service.md`)

A canonical Markdown version of the Terms of Service stored in `docs/terms-of-service.md`, mirroring the structure of `docs/privacy-policy.md`.

### 4. Mobile Client Integration (`apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx`)

1. **Terms of Service Card**:
   - Placed in the Settings section directly above or beside the Privacy Policy card.
   - Pressing the card calls `Linking.openURL(TERMS_OF_SERVICE_URL || `${resolveBaseUrl()}/terms`)`.
   - Accessibility properties: `accessibilityRole="link"`, `accessibilityLabel="Terms of Service"`, `testID="terms-of-service-entry-button"`.
   - Card container has `testID="you-and-crew-terms-of-service-card"`.

2. **In-App Legal Disclaimer Section**:
   - Rendered concisely in the Settings/About area of `YouAndCrewScreen`:
     *"Disney World Tracker is an independent, unofficial fan application and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company. All Disney trademarks, service marks, and trade names are property of their respective owners. Wait times and park schedules are estimates for personal planning purposes."*
   - Styled with secondary typography (`t.color.textSecondary`) and accessible test ID `testID="you-and-crew-legal-disclaimer"`.

3. **Constants & Configuration**:
   - `apps/mobile/src/photos/constants.ts` (or `apps/mobile/src/constants/legal.ts`):
     `export const TERMS_OF_SERVICE_URL = process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL ?? '';`
   - `apps/mobile/eas.json`: Configure `"EXPO_PUBLIC_TERMS_OF_SERVICE_URL": "https://dwt-api.onrender.com/terms"` in `development`, `preview`, and `production`.
   - `apps/mobile/.env.example`: Document the variable.

## Configuration & Constants

| Name | Location | Default / Example | Purpose |
|---|---|---|---|
| `TERMS_PATH` | `apps/api/src/services/accountDeletion/routes.ts` | `'/terms'` | Public HTTP route path |
| `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` | `apps/mobile/eas.json`, `.env.example` | `'https://dwt-api.onrender.com/terms'` | External URL for Terms of Service |
| `SUPPORT_EMAIL` | `apps/api` config | Configured email | Contact address for legal / support inquiries |

## Correctness Properties

### Property 1: Terms HTML Rendering and Escaping
*For any valid or hostile email string passed to `renderTermsOfServiceHtml`, the rendered HTML contains the Disney non-affiliation disclaimer, ThemeParks.wiki credit, link to `/privacy`, and the escaped email address inside a valid `mailto:` link without unescaped HTML characters (`<`, `>`, `&`, `"`).*
**Validates:** Requirements 1.1, 1.2, 1.3, 1.4, 2.3, 2.4, 3.1, 3.2, 3.3

### Property 2: Public Route Security and Framing Headers
*When `GET /terms` is invoked on the API server, the response returns HTTP status 200, Content-Type `text/html; charset=utf-8`, and contains the anti-framing headers `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.*
**Validates:** Requirements 2.1, 2.2

### Property 3: Mobile Terms URL Resolution
*When `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` is set, the mobile app opens that URL; when it is unset or empty, the app falls back to `${resolveBaseUrl()}/terms`.*
**Validates:** Requirements 4.2, 5.1, 5.2

### Property 4: Mobile Settings & Disclaimer UI Presence
*The `YouAndCrewScreen` renders the Terms of Service card and the in-app Disney non-affiliation disclaimer text with appropriate testIDs and accessibility labels.*
**Validates:** Requirements 1.5, 4.1, 4.3, 4.4, 4.5

### Property 5: App Store Packaging Assets and Expo Configuration
*The assets `apps/mobile/assets/icon.png` (1024×1024 opaque RGB), `apps/mobile/assets/adaptive-icon.png` (1024×1024 RGBA), and `apps/mobile/assets/splash.png` exist on disk with valid PNG headers and dimensions, and `apps/mobile/app.config.ts` declares `icon`, `backgroundColor`, `web.splash`, and `android.adaptiveIcon` pointing to them.*
**Validates:** Requirements 6.1, 6.2, 6.3, 6.4

### Property 6: Price data sources are credited and not exposed in bulk

Added by the `trip-budget` spec. For the rendered `GET /terms` HTML and the mobile legal notice, the text credits ThemeParks.wiki for Lightning Lane prices with the link `https://themeparks.wiki`, names Disney's website as the source of ticket and menu prices, states they are before tax and may differ at checkout, and states that discounted, military, reseller and special-offer prices are not covered; all added text is HTML-escaped (Property 1). For every screen that renders a Lightning Lane price, the text "Powered by ThemeParks.wiki" is present and links to the same URL. No registered route returns raw ticket or Lightning Lane price rows as a list; prices are returned only as the resolved price of a requested key or inside a Trip's own Budget lines.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 7: Minimum age 13 attestation

*For any registration body, `registerInputSchema` accepts it only if `ageConfirmed === true` (and the existing email, display name and password rules hold); a missing, `false`, string or numeric `ageConfirmed` is rejected with the first issue path `ageConfirmed`. `POST /auth/register` with such a body returns `400 validation_failed` with `field: 'ageConfirmed'` and issues no `INSERT INTO users`. In the mobile `RegisterScreen`, pressing "Create account" with the checkbox unchecked makes no API call and shows "You must be 13 or older to create an account."; with it checked the request body carries `ageConfirmed: true`. The rendered Terms and Privacy HTML each contain their age statement (Requirement 8.1, 8.2) and stay in sync with the Markdown docs.*
**Validates:** Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8

## Age Requirement Design (Requirement 8)

- **Shared contract:** `packages/shared/src/schemas/User.ts` adds `ageConfirmed: z.literal(true)` to `registerInputSchema` (still `.strict()`). The API route and the mobile client both parse with this schema, so they cannot drift. `RegisterInput` becomes `{ email, displayName, password, ageConfirmed: true }`.
- **No persistence, no migration:** the flag is validated and dropped. `handleRegister` is unchanged.
- **Docs:** Terms gain a "Minimum Age" bullet in section 3 (Accounts & Security). Privacy gains an "Age Requirement (13+)" subsection under section 1. Section numbers do not change. `Last Updated` dates are bumped in both Markdown and HTML.
- **Mobile:** `RegisterScreen.tsx` adds a checkbox `Pressable` row between the password field and the form error. State `ageConfirmed` (default `false`). On submit the screen passes it to `registerInputSchema.safeParse`; a failure on path `ageConfirmed` maps to `FIELD_COPY.ageConfirmed` = "You must be 13 or older to create an account." The server `validation_failed` with `field: 'ageConfirmed'` maps to the same copy.
- **Rollout note:** an installed build that predates this change cannot register (the server now requires the field). Existing accounts and login are unaffected.

## Error Handling

- **Browser Link Failures**: If `Linking.openURL` fails (e.g. no browser installed), the error is caught and logged gracefully without crashing the app.
- **Missing or Invalid Configuration**: `SUPPORT_EMAIL` is already validated at startup by `apps/api/src/config.ts` (the server refuses to start without a valid email).

## Testing Strategy

1. **Unit & Property Tests (Fastify / Pure Web Page Renderer)**:
   - `apps/api/src/services/accountDeletion/__tests__/webPages.prop.test.ts`: Test `renderTermsOfServiceHtml` across random email strings (including injection characters `<script>`, `"`, `&`), verifying correct HTML escaping and required disclaimer strings.
   - `apps/api/src/services/accountDeletion/__tests__/routes.test.ts`: Integration test verifying `GET /terms` returns 200, anti-framing headers, and rendered content.
2. **Mobile Component & Interaction Tests (Jest / RNTL)**:
   - `apps/mobile/src/screens/youAndCrew/__tests__/DeleteAccountFlow.test.tsx` (or a dedicated `LegalDisclaimers.test.tsx`):
     - Assert `terms-of-service-entry-button` renders and pressing it calls `Linking.openURL` with the expected URL.
     - Assert `you-and-crew-legal-disclaimer` renders the Disney non-affiliation text.
3. **Age requirement (Property 7)**:
   - `apps/api/src/services/auth/__tests__/registration.prop.test.ts`: schema accepts valid triples only with `ageConfirmed: true`; rejects missing / `false` / non-boolean with path `ageConfirmed`.
   - `apps/api/src/services/auth/__tests__/routes.test.ts`: `POST /auth/register` without `ageConfirmed: true` returns 400 `validation_failed`, `field: 'ageConfirmed'`, and no `INSERT INTO users` is issued.
   - `webPages.prop.test.ts`: Terms and Privacy HTML contain the age statements; the existing Markdown sync tests cover the new headings.
   - `apps/mobile/src/screens/__tests__/authScreens.accountDeletion.test.tsx` (RegisterScreen block): unchecked submit makes no `apiRequest` call and shows `register-age-error`; checking the box clears it and the POST body includes `ageConfirmed: true`.

