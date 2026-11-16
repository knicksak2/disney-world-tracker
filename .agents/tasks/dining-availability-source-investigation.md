# Dining reservation availability: source investigation

Read-only investigation. No code changed. Probing was a handful of unauthenticated GETs from a developer machine, spaced apart. I stopped when Disney's availability endpoint returned its bot-challenge status.

## Verdict: viable only with a hard caveat. Not viable as an unattended server-side poll on Render's free tier.

- **Source of bookable slots:** one source exists: Disney's own `dine-res` availability API, the one the disneyworld.disney.go.com "Check Availability" page calls.
- **Access:** it needs a signed-in MyDisney session, headers minted by Disney's page JavaScript, and it sits behind Akamai bot protection. An unauthenticated request got **HTTP 428** (verified). The only open-source WDW tool I found, [alechemy/dine-at-disney](https://github.com/alechemy/dine-at-disney), drives a real, headed Chromium with a saved login session to get around this. Per its README, Akamai "blocks direct API calls".
- **Nothing in our stack gives slots:** nothing we already have exposes bookable slots. ThemeParks.wiki returns only restaurant open/closed status for WDW restaurants (verified). Our retired Disney live path reads Disney's walk-up channel, not reservations.
- **What this means for the feature:** a legitimate, token-less poll from Render is not possible today. The feature needs one of the options in "Options" below. Option A (user-side checking) or Option D (curated links, no alerts) can ship without defeating bot protection. Option B needs a sanctioned data source we don't have.

## Verified by a real request vs only read

| Claim | Status |
|---|---|
| `GET /dine-res/api/availability/2/<date>,<date>/00:00:00,23:59:59?...` with no cookies or auth returns **428** | **Verified** (1 request, from a residential/dev IP, not a datacenter IP) |
| ThemeParks.wiki exposes no reservation slots for WDW restaurants | **Verified** (see Q2) |
| Disney public restaurant list endpoint is open JSON, 411 entries, 117 flagged `reservations-accepted` | **Verified** (see Q6/Q7) |
| Availability endpoint path, params, headers, response shape | **Read** in dine-at-disney source. Not reproduced, because that needs a login. |
| Akamai 428 challenge, login requirement, session expiry | **Read** (dine-at-disney README and code). The 428 itself is verified. |
| Deep link `https://disneyworld.disney.go.com/dine-res/restaurant/{id}` | **Read** (dine-at-disney). My own probe of it was interrupted by a tooling fault, so it is **not verified**. |
| How MouseDining, MouseWatcher, etc. obtain data | **Not documented** by them (see Q5) |

I was not able to test reachability from a Render/datacenter IP. I did not try, because the only way past the 428 is the browser-plus-login route the brief rules out.

## Q1. What existing code already provides

**No bookable slots anywhere in the repo. Only walk-up/wait data and a static "reservations accepted" flag.**

- `apps/api/src/services/live/themeParksLiveClient.ts`: `ThemeParksDiningAvailabilityEntry { partySize?, waitTime?, id? }` (lines ~120-126). Each entry carries a party size and an estimated wait. It carries no date, no time and no offer id.
- `apps/api/src/services/live/themeParksLiveProject.ts`: `projectDiningAvailability` maps these to `DiningAvailabilityEntry { status?, partySize?, estimatedWaitMinutes? }` (shared: `packages/shared/src/dto/LiveDetail.ts`, `schemas/LiveDetail.ts`). Walk-up only.
- Retired Disney path, `apps/api/src/services/catalog/disney/`:
  - `liveClient.ts` reads the Sync Gateway channel `wdw.diningfacilitystatus.1_0`, described in code as "walk-up dining availability docs".
  - `liveProject.ts` projects per-party-size `{status, partySize, waitTime}`. That is the same walk-up shape.
  - `transport.ts` and `facilitiesClient.ts` carry the Akamai handling (WAF-403 vs auth-403 classification, rate limiter, UA headers). Disney's Walk-Up is a separate Disney feature ("Mobile Dine Walk-Up Availability", a waitlist you join in the app on site). It is not a reservation slot.
- Why the Disney live path was retired (`.kiro/specs/disney-source-resilience/requirements.md`, Introduction): an unthrottled catalog sync (~6,195-doc `_changes`, ~62 `_bulk_get` batches, up to ~576 menu calls) tripped Akamai. Akamai answered 403 "Access Denied" and then rate/IP-blocked every later request. The same spec records that the gateway "gates per-guest data behind per-guest authentication (403)", citing Lightning Lane price and boarding groups.
- `diningMenuClient.ts` documents that the older `explorer-service/public/finder/dining-menus` API rejected the app's anonymous token with `403 Client does not have one of the required scopes`. Only Disney's website-facing `dinemenu/api/menu` works anonymously. This is a precedent: Disney's anonymous tokens are scoped narrowly, and anything guest-specific needs a real guest token.
- **Useful data we already have:**
  - `experiences.upstream_entity_id` (e.g. `90002464;entityType=restaurant`).
  - `experiences.grouped_facets.tableService`, including a `reservations-accepted` facet. Used by `listDiningLinkEligibleRestaurants` in `catalog/repo.ts`.
  - `experiences.dining_url`, a curated restaurant page URL such as `https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins/`, seeded from `apps/api/seed-data/dining/dining-links.json` (~100 entries by line count; not an exact count).
- Hosting constraints (`.kiro/steering/tech-conventions.md`): Render sleeps after ~15 min idle, no always-on worker, cron every ~10 min (~7 AM-1 AM ET) hitting an endpoint that returns 202, Neon ~1 GB, Upstash ~500k commands/month. Any polling design must live inside that.

## Q2. ThemeParks.wiki and other public APIs

**Verified: no slot data for WDW.**

- `GET https://api.themeparks.wiki/v1/entity/e957da41-3552-4cf6-b636-5babc5cbc4e5/live` (WDW destination): HTTP 200, 280 `liveData` entries, 64 `RESTAURANT`. **Zero** entries had a `diningAvailability` field. Restaurant entries contain only `id, name, entityType, parkId, externalId, status, lastUpdated`. `status` was OPERATING for 63 and CLOSED for 1.
- Per-entity live for Cinderella's Royal Table (`55bdcccc-...`) and Be Our Guest (`e847a8bd-...`): same shape, status only.
- The OpenAPI spec (`https://api.themeparks.wiki/docs/v1.yaml`, 94 KB) has **0 matches** for `dining`, `reservation`, `availab`, `partySize`. `diningAvailability` is not in the documented schema at all.
- Their API page describes `RESTAURANT` as "Dining, sometimes with a wait or a booking window" (https://www.themeparks.wiki/api). That is not a reservation slot list. I did not find any WDW restaurant where it appears.
- Their terms (https://www.themeparks.wiki/terms) forbid passing the data on as a feed for other software. That matters only if we ever did use it for something.
- Other public/documented sources: none found. Searches turned up only scrapers and the Disney site itself.

## Q3. How Disney's own site gets availability

All read from [alechemy/dine-at-disney](https://github.com/alechemy/dine-at-disney) (`src/disney-api/playwright-utils.ts`, `parse.ts`, `model/response.ts`, `resort-config.ts`, `extensions/cli-extension.ts`). The tool targets the current WDW `dine-res` Angular app. The older tools I read use obsolete flows (2013-2021 form-post, Selenium, and an old `/finder/dining-availability/` POST), which are the ones that "stopped working" per their READMEs (Jmandarino: "having to log in to see reservations"; dreardon: deprecated).

**Availability request** (as replayed by dine-at-disney in-page):

```
GET https://disneyworld.disney.go.com/dine-res/api/availability/{partySize}/{date},{date}/{HH:mm:ss},{HH:mm:ss}
    ?trim=facets,media,webLinks,mediaGalleries,sortProductName&trimExclude=dining-events,diningEvent
```

- Example path: `/dine-res/api/availability/2/2026-12-05,2026-12-05/00:00:00,23:59:59`.
- **No restaurant id in the URL.** The request returns every restaurant that has an offer for that party size, date and time window.
- Headers the tool captures from the page's own call and replays: `authorization`, `x-correlation-id`, `x-conversation-id`, `x-function-name`, `x-disney-internal-dine-vas-365`, `x-disney-internal-dine-vas-eks`, `accept`. Requests also use `credentials: 'include'` (session cookies).
- **Auth:** needs a logged-in MyDisney session. The tool's README: "You need a MyDisney account", with a first-run interactive login and a saved Playwright `storageState`. The `authorization` bearer is minted by Disney's page JavaScript. I could not find a documented way to obtain it without a login.
- **Response shape** (`model/response.ts`):

```
{ statusCode,
  restaurant: { "<id>": { id, name, urlFriendlyId, priceRange, experienceType,
                          primaryCuisineType, ancestorLocationParkResort, ancestorLocationLandArea,
                          offers: { "<YYYY-MM-DD>": [ {
                              enterpriseMealPeriodId, mealPeriodType, mealPeriodName,
                              startTime, endTime, cuisine, serviceStyle, experienceType,
                              offersByAccessibility: [ { accessibilityLevel,
                                  offers: [ { offerId, time, label } ] } ] } ] } } },
  diningEvent: { "<id;entityType=...>": { name, id,
                  eventTimes: [ { eventProductId, eventLabel, eventFacilityId, restaurant: {...} } ] } } }
```

- A "slot" is `offers[date][].offersByAccessibility[].offers[]`, giving `{offerId, time, label}`. `label` is the display time (e.g. "5:30 PM"). Dining events nest restaurants under `eventTimes[]`.
- **No per-slot booking URL appears in this payload** as the tool models it. The tool builds its own link (Q8). `offerId` is what Disney's booking flow presumably consumes, but the booking call itself is not documented.
- **UI flow:** the tool uses the page form (party size, date, "All Day" time, location Done) and intercepts the response at `/dine-res/api/availability/`. For repeats it replays the captured headers via in-page `fetch`.
- **Public restaurant list** (no auth, verified, Q6):
  `GET https://disneyworld.disney.go.com/finder/api/v1/explorer-service/list-ancestor-entities/wdw/80007798;entityType=destination/{YYYY-MM-DD}/dining`.

## Q4. Reachability from a datacenter host

- **Verified:** unauthenticated `GET /dine-res/api/availability/2/2026-12-05,2026-12-05/00:00:00,23:59:59?...` returned **428** (Precondition Required). I did not capture response headers, because my probe script only surfaced the status. I stopped probing that endpoint after this.
- **Read (dine-at-disney):** 428 is Akamai's bot challenge. The tool's own code treats 428 as "Akamai is blocking us" and responds by navigating to the form and running a full UI search to refresh sensor state and headers. The page also shows an Akamai "Processing Request" overlay (`#sec-overlay`) that the tool waits out. Its README: "Disney's reservation site uses Akamai bot detection, which blocks direct API calls." It launches Chromium headed, and minimizes it via CDP rather than running headless.
- **Read:** sessions expire. The tool detects an expired session and forces a re-login (`Saved session has expired`).
- **My inference (not verified):** a Render datacenter IP, with no cookies, no JS sensor execution and no login, would at best get the same 428. It would risk the IP-level block this project already hit on the Sync Gateway. The only route in is the headed-browser-plus-login approach, which the brief rules out for us (and it cannot run on a free 512 MB web service that sleeps).
- **Rate limits:** nothing public. The community tool polls every 60 s for a single party size and date. The Disneyland Paris tracker [Romitou/DisneyTables](https://github.com/Romitou/DisneyTables) defaults to 5 requests/minute and rotates OAuth tokens every 6 hours, but that is a different Disney API (Disneyland Paris mobile app API with a mobile API key), not WDW.

## Q5. How the existing finder services get data

**Not documented by any of them.** What each says publicly:

- **MouseDining** (https://blog.mousedining.com/how-does-mousedining-work/): "monitors the availability" and alerts you. No source or method stated.
- **TouringPlans Reservation Finder** (https://touringplans.com/blog/reservation-finder-returns-locate-disney-dining-availability/): users create searches (max two at once per a 2022 third-party guide), it notifies on a match. A 2021 forum post says it "searches only every 60 minutes". It is a search-and-notify tool with no stated method.
- **MouseWatcher** (https://mousewatcher.com/how): "searching around the clock". **MouseNotifier** (https://mousenotifier.com/faq): sends the available time and "a link for booking". No method stated. MouseSeats: I did not find documentation. Their method is a guess; I'm not guessing.

## Q6. Restaurant id mapping

- **Verified, public list endpoint:** 411 results for WDW dining (380 `entityType=restaurant`, 29 `Dining-Event`, 1 `Dinner-Show`, 1 `Event`). Ids look like `17736025;entityType=Dining-Event` and, for restaurants, `<number>;entityType=restaurant`. Each result also has a numeric `facilityId`. That is the same id family as ours (`experiences.upstream_entity_id` = `362428;entityType=restaurant`, and the ThemeParks `externalId` `90002464;entityType=restaurant`, matching Cinderella's Royal Table).
- **Read:** dine-at-disney's `list` command prints `String(r.facilityId)` as the restaurant ID, and its monitor matches that against the availability response's `restaurant` map keys (`--ids 19013078`). So the availability response is keyed by the **numeric facility id**. For dining events, the response key carries `;entityType=...` and the tool strips it with `eventId.split(';')[0]`.
- **Not verified:** whether the live response keys carry the `;entityType=restaurant` suffix. I could not call the endpoint. My attempt to confirm `id` vs `facilityId` equality across all 411 results was interrupted by a tooling fault, so that equality is **unverified**. The conclusion is that splitting our `upstream_entity_id` on `;` and using the numeric prefix is very likely the correct join. It must be confirmed against a real response before relying on it.

## Q7. Which restaurants support reservations, and can we tell from data we have?

**Mostly yes.** Verified from the public list (411 results):

- `facets.tableService` includes `reservations-accepted` on **117** entries. It also includes `reservations-strongly-recommended` on 21, `character-dining` on 14, `dine-events` on 29, `dinner-show` on 1, and `lounges` on 75 (not exclusive of the others).
- 116 entries carry a `remyCheckAvailCta` field and 116 carry a `facets.checkAvailability` facet (counted separately). I did not confirm these two sets match the 117. That is a possible cross-check for "has an availability button".
- This is what our own code keys off (`hasReservationsAcceptedFacet` in `catalog/repo.ts`, `diningLinkCandidates.ts`). The seeded `dining-links.json` has fewer entries than 117; the existing `listDiningLinkEligibleRestaurants` reports the gap.
- **Dining events and dinner shows** (Candlelight dining packages, Hoop-Dee-Doo, etc.) are separate entity types. They appear in the availability response under `diningEvent` and are nested differently. They need their own handling.
- Walk-up only (Mobile Dine waitlist) is a separate Disney feature, not shown in this list. Do not treat walk-up restaurants as reservable.
- Whether the facet always reflects bookability on a given date (closures, "reservations accepted" but fully blocked) is not knowable from catalog data. Only the live availability call tells you.

## Q8. Deep link into Disney's site/app

- **Read (dine-at-disney):** `https://disneyworld.disney.go.com/dine-res/restaurant/{facilityId}` (built in `cli-extension.ts` as `${baseUrl}/dine-res/restaurant/${id}`). This is a restaurant-level link. It does not carry date, time or party size.
- **Not verified:** my own check of that URL was interrupted by a tooling fault. I do not know whether it accepts date/party/time query parameters, nor whether it opens the My Disney Experience app on mobile.
- **Verified in our repo:** the curated `experiences.dining_url`, e.g. `https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins/`. It is already stored per restaurant, and the mobile app already surfaces it (`routes.ts` includes `diningUrl` for restaurants). A 2021 repo (erikpoole) used `<restaurant page>/availability-modal`; it is a legacy pattern and unverified today.
- **Recommendation:** use `dining_url` today. Treat `/dine-res/restaurant/{id}` as a candidate to verify manually in a browser before relying on it. The alert body should state the date, time and party size itself, since the link will not carry them.

## Q9. Cost and volume

Based on the read request shape:

- **One request covers an entire day and every restaurant** for one party size (`00:00:00,23:59:59`, no id). So upstream cost per poll is O(distinct party sizes x distinct dates), not O(restaurants) and not O(users).
- The URL accepts `{date},{date}`, which suggests a date range is allowed (the parser keys offers by date). I **did not test** a multi-day range, so a single request for several dates is an unverified inference. The tool itself always sends one date.
- **Sharing identical checks:** alerts can be grouped by (party size, date). Time window and restaurant filtering happens locally on the response. Users with the same party size and date share one upstream call.
- Illustrative load, not measured: 50 users x 2 alerts, spread over say 15 distinct (party, date) pairs, polled every 10 minutes during 18 active hours = 15 x 6 x 18 = 1,620 requests/day. That would fit Neon and Upstash easily (state is a small set of rows per alert). The binding constraint is access, not volume.
- Booking windows (Disney FAQ, via search snippets): 60 days ahead for day-visitors; resort guests can book their whole stay (up to 10 nights) 60 days ahead. Dates beyond that have no availability, so alerts should be limited to dates inside roughly the next 60+10 days.
- Cadence: community tools poll every 60 s; TouringPlans (2021 forum post) every 60 min. A 10-minute cron cadence is plausible for utility, but cancellations get re-booked fast, so a 10-minute alert is slower than the paid services.

## Options

**A. Client-assisted check (no server polling).** The mobile app opens Disney's own availability page for the user's restaurant/date/party, or the user runs the check in their own Disney session. We still store the user's search and remind them. Data never touches our server. *Pros:* legitimate, no token, no bot-protection fight, zero hosting load. *Cons:* the app cannot detect a slot itself, so there is no true automatic alert; it is a reminder and a link. This is the only fully clean option I can recommend today.

**B. Server polling of Disney's `dine-res` API with a service account.** Needs a MyDisney login held by us, a real browser, and Akamai sensor state. *Cons:* needs a headed Chromium, a persistent session and a real account's credentials (explicitly out of bounds per the brief), cannot run on free Render (sleeping, memory), and risks account and IP blocks. **Not recommended.**

**C. A separate always-on self-hosted worker with a browser and a dedicated Disney login** (the dine-at-disney model, run on a home machine or small VPS) that POSTs found slots to our API. *Pros:* matches how the one working open-source tool operates. *Cons:* needs a login, so it needs your approval and sits outside the free-tier hosting model. It scales poorly and is fragile to Disney's UI changes (the tool's selectors are UI-bound). Treat as a possible later experiment, not a spec basis.

**D. Link-and-curate only (cheapest).** Ship a "Reservation helper" that stores the user's target (restaurant, date, time window, party size), shows the booking window opening date (60-day rule) as a reminder, and deep-links to Disney using `dining_url`. No availability detection. *Pros:* fully within the stack, useful on its own (the 60-day-open reminder is often the highest-value alert). *Cons:* no cancellation alerts.

**E. Wait for a sanctioned source.** Watch ThemeParks.wiki (`booking window` language in their docs) and ask their maintainers whether slot data is planned. Low cost, unknown payoff.

**Recommended path:** D now (it is within the stack and reuses `dining_url` and the catalog's reservation facet), keep A as the "check now" button, and treat B/C as out of scope unless you decide to accept the login-and-browser approach with its risks.

## Unknowns still to check

1. Whether `/dine-res/restaurant/{facilityId}` is the right WDW link, and whether it accepts date/time/party query parameters or opens the app (verify manually in a browser).
2. Whether the availability response keys include the `;entityType=restaurant` suffix, and whether `id` always equals the numeric prefix of `facilityId` (needs one real response, which needs a login).
3. Whether `{date},{date}` accepts a multi-day range (needs a real response).
4. What Akamai returns to a datacenter IP with no session (I only tested from a developer IP; not tested from Render).
5. Whether any official partner or licensed feed for Disney dining availability exists. I found none.
6. A tooling fault interrupted several of my later probes (large list responses, deep-link status). The 428 and the list/ThemeParks results above were all obtained before that, and I did not re-run anything.

## Sources

- dine-at-disney: https://github.com/alechemy/dine-at-disney (README; `src/disney-api/playwright-utils.ts`, `parse.ts`, `model/response.ts`, `resort-config.ts`; `src/extensions/cli-extension.ts`)
- Other community checkers (older flows): https://github.com/Jmandarino/Disney-Reservation-Checker, https://github.com/dreardon/disneyReservations, https://github.com/erikpoole/Disney-Reservation-Checker, https://gist.github.com/tierneykev/1399346774d25bee9e5a2783e419b1e5, https://github.com/jparkerweb/wdw-adr-checker
- Disneyland Paris analogue: https://github.com/Romitou/DisneyTables
- ThemeParks.wiki: https://api.themeparks.wiki/docs/v1.yaml, https://www.themeparks.wiki/api, https://www.themeparks.wiki/terms
- Finder services: https://blog.mousedining.com/how-does-mousedining-work/, https://touringplans.com/blog/reservation-finder-returns-locate-disney-dining-availability/, https://mousewatcher.com/how, https://mousenotifier.com/faq
- Disney Mobile Dine walk-up page: https://disneyworld.disney.go.com/guest-services/mobile-dine-walk-up-availability/
- Repo: `apps/api/src/services/live/themeParksLive{Client,Project,Service}.ts`; `apps/api/src/services/catalog/disney/{transport,liveClient,liveProject,diningMenuClient,facilitiesClient}.ts`; `apps/api/src/services/catalog/{repo,diningLinkCandidates}.ts`; `apps/api/seed-data/dining/dining-links.json`; `.kiro/specs/disney-source-resilience/requirements.md`; `.kiro/steering/tech-conventions.md`

Content from external pages was paraphrased for compliance with licensing restrictions.
