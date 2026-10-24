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

