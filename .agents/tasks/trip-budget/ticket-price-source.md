# Ticket Price Source: Second-Pass Investigation

Date of investigation: 2026-10-25 (machine clock). Read-only. No source, migration, spec, lockfile or package.json was modified. The only file written inside the repo is this report.

Legend: **[V]** verified (I ran it, read it, or fetched it myself). **[A]** assumed or inferred, not verified.

Method, in one paragraph: I installed `playwright-core` in `%TEMP%\tp-probe` (outside the repo) and drove the locally installed Google Chrome 155 (no browser download was needed). I captured the network traffic of Disney's ticket pages, then replayed the discovered calls with plain `curl.exe` and with Node's `fetch` (no browser, no cookies). I read Disney's Terms of Use and `robots.txt`, re-checked ThemeParks.wiki, and cross-checked prices against Disney's own rendered page and editorial price reports.

---

## 0. Executive summary

**Verdict: technically GO. Legally it is your decision, and you should make it knowingly.**

1. **A real, structured, date-based price source exists and it is Disney's own.** [V] The ticket pages are a client-rendered SPA (`tickets-spa 1.36.19`). Behind it is a JSON service, `lexicon-view-assembler-service`. One call returns every date in Disney's bookable window (today through 2027-12-31, 433 days, rolling forward) for a ticket length, including:
   - adult (10+) and child (3-9);
   - base ticket, Park Hopper, Park Hopper Plus, and Water Parks & Sports Option;
   - per-park pricing for 1-day tickets (MK, EPCOT, DHS, AK);
   - the same set for **Florida Residents** (`discountGroup=fl-resident`).
2. **It works over plain HTTPS from a script.** [V] No cookies and no JS challenge. It needs only a `Bearer` token that Disney hands to any anonymous caller from `GET /profile-api/authentication/get-client-token/` (30-minute lifetime). Verified with `curl.exe` and with Node `fetch`, including with an honest custom `User-Agent`.
3. **Cost to cache everything is tiny in requests, modest in bytes.** [V] `GET .../product-types/theme-parks/prices?numDays=N` returns all four ticket options for that length across the whole window. Ten calls (`numDays` 1 to 10) plus one token call cover the whole **All Guests** price book. That is about 12 MB of JSON and about 36,000 price rows. Florida Resident is ten more calls (but see 4.5, only `numDays=4` was verified for Florida residents on this endpoint). One refresh run is about 12 to 22 requests, and one run per day is plenty.
4. **Accuracy checks pass.** [V] 8 of 8 date-and-park peak prices match an independent editorial report published after Disney's 2026-10-06 price release. All nine "From $X per day" figures on Disney's rendered page match the lowest per-day value in the API (rounded up to the dollar). The API's peak 1-day Park Hopper ($301) and the global maximums ($229 MK/EPCOT, $214 DHS, $189 AK) agree with press reports. One editorial minimum (AllEars, Magic Kingdom $154) disagrees with the API ($139 on five Aug/Sep 2027 dates). See section 5.
5. **The Terms of Use clearly restrict this.** [V] Disney's Terms of Use (last updated 2024-05-24) prohibit accessing or extracting Disney products with a script or other automated means, and prohibit compiling a data set or database from them. They also limit use to personal, non-commercial purposes. A server-side job caching price JSON falls inside the literal wording, regardless of volume. `robots.txt` does not disallow the `/api/` paths used. `robots.txt` is a separate matter and not permission. Practical enforcement is most likely an IP/WAF block; a legal demand is possible but unlikely for a small app. **This is not legal advice** (see section 2).
6. **Akamai from a Render IP is untested.** [V that I cannot test it] I only have a residential IP. Everything above was run from it. Section 6.4 gives a safe post-deploy diagnostic.

**Recommendation:** Build it, but behind a kill switch that **defaults to off in production** until the post-deploy diagnostic passes and you have accepted the ToS risk. Use an honest `User-Agent`, run about 12 to 22 requests per day from a dedicated cron, cache in Postgres, and always show the `as_of` date. Fall back to the last known price, then to a labeled estimate, then to a user-entered price. No admin price table. If you are not willing to accept the ToS exposure, there is **no** legitimate machine-readable alternative (section 3), so the only compliant option is user-entered prices.

---

## 1. The real data source

### 1.1 How I found it [V]

- Plain `web_fetch` and headless Chrome both fail: headless Chrome gets `net::ERR_HTTP2_PROTOCOL_ERROR` on `https://disneyworld.disney.go.com/admission/tickets/` (bot detection against headless browsers). **Headed** Chrome loads it normally (HTTP 200). The earlier "co-browse stub" came from the fetch tool, not from Disney's page.
- Pages loaded: `/admission/tickets/`, `/admission/tickets/theme-parks/`, `/admission/tickets/theme-parks-with-park-hopper/`, `/admission/tickets/theme-parks-with-park-hopper-plus/`, `/passes/`, `/admission/tickets/water-parks/`.
- The calendar is a `wdat-calendar` web component inside the SPA. Clicking the "4 days" button fires the pricing-calendar call (section 1.3).

### 1.2 Endpoints [V]

All on `https://disneyworld.disney.go.com`.

| # | Method and path | Purpose | Auth |
|---|---|---|---|
| T | `GET /profile-api/authentication/get-client-token/` | Anonymous client token. Response: `{"access_token":"<32 hex>","expires_in":1800}`. | none |
| L | `GET /api/lexicon-view-assembler-service/wdw/tickets/product-listing?storeId=wdw&affiliations=STD_GST` | "Starting from" cards for the four product groups. 263 KB. | `Authorization: BEARER <token>` |
| A | `GET /api/lexicon-view-assembler-service/affiliation-ids?category=tickets&marketable=true&destinationId=wdw&storeId=wdw` | Which discount groups are sold. Returned only `FL_RESIDENT` and `STD_GST`. | token |
| P | **`GET /api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices`** | **The per-date, per-length price calendar for all options.** Used by the SPA when a day count is clicked. | token |
| C | `GET /api/lexicon-view-assembler-service/wdw/tickets/product-types/{productType}?storeId=wdw&addOn` | Full product definition plus `pricingCalendar` for one option. 2.8 to 3.8 MB. The SPA adds `excludePricingCalendar=true` to skip the calendar on first paint. | token |

`{productType}` values that return 200: `theme-parks`, `theme-parks-with-park-hopper`, `theme-parks-with-park-hopper-plus`, `theme-parks-with-water-parks-sports`, `theme-parks-for-fl-resident`, `theme-parks-with-park-hopper-for-fl-resident`. `water-parks` and `disney-weekday-magic-for-fl-resident` return 404.

The SPA bundle (saved copy, `tickets-spa.html`, 1.9 MB) confirms the client method `getPricingCalendar({category, productType, discountGroup, addOn, startDate, endDate, numDays, productSubsetId, fpAvailability})`, which builds endpoint P. [V]

### 1.3 Endpoint P: request

Captured from the browser when the 4-day button was clicked:

```
GET /api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices
    ?discountGroup=std-gst&startDate=2026-10-25&storeId=wdw&endDate=2027-12-31
    &numDays=4&fpAvailability=false&storeBasedPearlEnabled=true
Authorization: BEARER 63e2cbf2...   (from endpoint T; value shortened)
Accept: application/json
```

Parameters I verified by replaying with `curl.exe`:

| Param | Values and behavior |
|---|---|
| `storeId` | `wdw` |
| `discountGroup` | `std-gst` (All Guests) and `fl-resident` work. `passholder` returns 404 with the message that the affiliation is not enabled for this store. `dvc` and `canada-resident` return 404 ("No PIBI Found"). |
| `numDays` | 1 to 10. `11` returns 404 "No PIBI Found". |
| `startDate`, `endDate` | `YYYY-MM-DD`. `startDate` earlier than today returns 400 (the validation message is misleading). `endDate` beyond the bookable horizon (tested `2028-01-31`) returns 500. The horizon is returned in every response as `maxPricingCalendarDate` (currently `2027-12-31`). |
| `addOn` | Not needed. Omitting it returns **all four options** (see 1.5). |
| `fpAvailability`, `storeBasedPearlEnabled` | Sent by the SPA. Not required (my calls omitted them and succeeded). |

Required headers: only `Authorization: BEARER <token>`. Without it: `401 {"errors":[{"typeId":"UNAUTHORIZED","message":"Authorization header missing",...}]}`. **No cookie is needed.** The token endpoint does send a `Set-Cookie`, which my calls ignored.

### 1.4 Endpoint P: response shape (trimmed)

`numDays=4`, `startDate=2026-11-15`, `endDate=2026-11-15` (2,930 bytes):

```json
{
  "storeId": "progenstr",
  "destinationId": "WDW",
  "startDate": "2026-11-15",
  "endDate": "2026-11-15",
  "maxPricingCalendarDate": "2027-12-31",
  "pricingCalendar": [
    {
      "numDays": "4",
      "dates": [
        {
          "date": "2026-11-15",
          "validityStartDate": "2026-11-15",
          "validityEndDate": "2026-11-21",
          "bufferDays": 3,
          "currency": "USD",
          "pricing": [
            {
              "id": "theme-park_4_A_0_0_RF_AF_SOF_progenstr",
              "ageGroup": "adult",
              "pricePerDay": "174.34",
              "subtotal": "697.36",
              "tax": "45.33",
              "commission": "0.00",
              "taxInclusiveIndicator": true,
              "validityStartDate": "2026-11-15",
              "validityEndDate": "2026-11-21",
              "stopSale": false,
              "availability": true,
              "enabled": true,
              "priceFromDPE": true
            }
          ]
        }
      ]
    }
  ]
}
```

(The real `pricing` array has 8 entries for multi-day. Values above are the real ones for 2026-11-15.)

Field meaning:

| Field | Meaning | Units and notes |
|---|---|---|
| `date` | Ticket **start date**. | WDW local calendar date, no time zone. Store as `DATE`. |
| `pricing[].subtotal` | **Total ticket price for that length**, before tax. | Decimal **dollars** as a string, for example `"697.36"`. Parse to integer cents. **Use this, not `pricePerDay`.** |
| `pricing[].pricePerDay` | `subtotal / numDays`, rounded to cents. | Re-multiplying drifts by up to $0.09 (I measured 14,340 of 44,166 rows off by more than $0.02, max $0.09). Display only. |
| `pricing[].tax` | Sales tax on the subtotal. | Dollars. Ratio to `subtotal` was **0.065 in every sampled row** [V]. So prices are pre-tax and tax is 6.5%. |
| `taxInclusiveIndicator` | Always `true` in my samples. | Do not interpret as "subtotal includes tax": `subtotal * 0.065 == tax`, so `subtotal` is pre-tax. |
| `ageGroup` | `adult` (10+) or `child` (3-9). | Under-3 needs no ticket (page text). |
| `validityStartDate`, `validityEndDate`, `bufferDays` | The window in which the multi-day ticket must be used. | For example 4 days: 7-day window. `bufferDays` is window length minus ticket days. |
| `stopSale`, `availability`, `enabled` | Sales flags. | All `false`/`true`/`true` in the data I pulled (0 stop-sale rows). |
| `id` | Product-instance id. Encodes the option. | See 1.5. |

### 1.5 The `id` mapping [V]

Pattern: `theme-park_{numDays}_{A|C}_{opt}_{res}_RF_AF_SOF_progenstr[_{park}]`

| Token | Value | Meaning |
|---|---|---|
| `A` / `C` | | adult 10+ / child 3-9 (also in `ageGroup`) |
| `opt` | `0` | base ticket, one park per day |
| `opt` | `P` | Park Hopper |
| `opt` | `PHP` | Park Hopper Plus |
| `opt` | `WPS` | Water Parks & Sports Option (only offered for 2 or more days) |
| `res` | `0` | All Guests (`std-gst`) |
| `res` | `2` | Florida Resident (`fl-resident`) |
| `_mk` `_ep` `_hs` `_ak` | suffix | Park. **Present only on 1-day base tickets.** Hopper and other options are not park-specific. |

Counts per `numDays` per date: 1-day = 12 entries (4 parks × 2 ages for base, plus 2 each for P and PHP; WPS is not sold for 1 day), 2 to 10 days = 8 entries. [V]

Consistency check: for `numDays=4`, the 3,464 rows from endpoint P equal the union of the four per-option `product-types` calendars (endpoint C): 0 missing, 0 value mismatches. [V]

### 1.6 Everything else priced

| Item | Source found | Status |
|---|---|---|
| Admission 1-10 days, adult/child, 4 options, per-park for 1-day | Endpoint P | [V] |
| Florida Resident discount | Endpoint P with `discountGroup=fl-resident` | [V] for `numDays=4` on P. Endpoint C listed Florida lengths 1, 3 and 4 only. [V] Other lengths not tested on P. |
| Passholder ticket discount | `discountGroup=passholder` is rejected as not enabled for this store. | [V] not available. |
| DVC / Canadian / military / other discounts | `dvc` and `canada-resident` return no products. Military offers are special-offer pages, not the pricing API. | [V] not available. |
| Annual Pass prices (4 products) | Server-rendered HTML at `/passes/` (no XHR; I saw `$1,749.00` for the Incredi-Pass, matching an editorial chart). | [V] exists, but HTML-only. No JSON found. Out of scope for the budget MVP; the four prices change about once a year and are low value. |
| Water Park single-day tickets | `/admission/tickets/water-parks/` only called the `product-listing` endpoint, which lists the four theme-park groups. No single-day water-park product found. | [V] not found, [A] sold through a different flow. |
| Lightning Lane | ThemeParks.wiki (first investigation, section 4). | See 3.2 for one correction. |

---

## 2. Terms and legal

**This is a technical reading, not legal advice.** Ask a lawyer if the app becomes commercial.

### 2.1 What I read [V]

- Disney Terms of Use, United States, "Last Updated: May 24, 2024", at `https://disneytermsofuse.com/english/`. The WDW site footer links its "Terms" entry to `http://disneytermsofuse.com/`. I fetched the full text (48,939 characters) with `curl.exe` and read the relevant sections.
- `https://disneyworld.disney.go.com/robots.txt` (4,826 bytes, `Last-Modified: 2026-09-02`).
- `https://disneyworld.disney.go.com/legal/terms-of-use/` and `/legal/` return 404 ("Someone Ate the Page!"). I found no separate "Disney Parks Online" supplemental terms on the WDW site. Treat the general Terms of Use as the governing text. [A] there may be other supplemental terms I did not find.

### 2.2 What the Terms of Use say (paraphrased)

Section 2 (License Grant and Restrictions) and Section 3 (Usage Rules):

- The license to use Disney products is limited to **personal, non-commercial** use in the United States.
- Users may not use Disney products for any commercial or business-related use, or build a business using them, whether or not for profit. A separate clause is titled "Commercial, Marketing, or Branding Use Prohibited".
- Users may not access, monitor, copy or extract Disney products using a **robot, spider, script, or other automated means**. The text says this explicitly covers AI training, **data mining, web scraping, and compiling any collection of data, data set or database**. The only carve-out is for public search-engine spiders that respect `robots.txt` and NOINDEX/NOFOLLOW.
- Users may not bypass, modify, defeat, tamper with or circumvent protections, and may not damage, disable, overburden or impair the products.

### 2.3 `robots.txt` [V]

- Disallows: search pages, checkout, reservations, `/calendars/...` park-hours pages, and any URL whose query string contains `price` (pattern `/*?*price`).
- **Not disallowed:** `/api/...` and `/profile-api/...`, which are the paths used here.
- My request URLs do not match `/*?*price`. The word "prices" is in the path before the `?`, and the query keys (`discountGroup`, `startDate`, `storeId`, `endDate`, `numDays`) do not contain "price".
- `robots.txt` is a convention. The Terms of Use apply independently of it, and the Terms point to it only for the search-engine carve-out.

### 2.4 Would a few hundred cached requests per day "clearly violate" the Terms?

- **Honest answer: it falls within the literal wording** (script, automated means, compiling a database). Low volume and caching reduce harm and the chance of enforcement. They do not change what the text says.
- The "personal, non-commercial" limit also matters: if the app is ever monetized, that clause is directly in play. [A] I do not know whether this app is or will be commercial.
- Counterpoints that are not a defense but are facts: the endpoint is the one Disney's own public page calls for every anonymous visitor; the token is issued to anyone with no login; no bot challenge, CAPTCHA or authentication is bypassed; the repo already calls Disney's dining-menu API and Sync Gateway under the same Terms (`apps/api/src/services/catalog/disney/diningMenuClient.ts`, `facilitiesClient.ts`). I would treat the new risk as the same category the project already carries, not a new one.

### 2.5 Risk level and mitigations

| Risk | Level | Notes |
|---|---|---|
| IP / WAF block from Disney's edge | **Medium** | Most likely consequence. The repo already classifies Akamai blocks (`classify.ts` `waf_block`) and the earlier 576-call menu bulk-fetch triggered one (`menuRetrieval.ts` header). This design makes about 12 to 22 calls per day, spread over a minute. |
| Contract / cease-and-desist | **Low** for a small hobby app, **higher** if monetized or widely distributed | Terms are explicit. |
| Data accuracy / misleading users | Low | Show `as_of`; label estimates; prices are what Disney displays today. |

Mitigations, all cheap:

- Fetch at most once per day from one dedicated cron; never per user request.
- Identify honestly: send a descriptive `User-Agent`. [V] An honest UA (`DwtTripBudget/1.0 (+contact: ...)`) and the Node default UA both returned 200 for the token and price calls from this machine. Caveat: `DisneyTransport` forces `DISNEY_WEB_USER_AGENT` (a Chrome/126 string, `facilitiesClient.ts` line 94). Spoofing a browser looks worse than identifying yourself. The spec should decide whether this client gets its own UA.
- Respect the existing request budget (`DISNEY_MAX_RPS` default 5, `DISNEY_MAX_CONCURRENCY` default 4 in `config.ts`). Use 1 request per 1.5 seconds for this job.
- Stop on any 403/429/WAF marker (circuit breaker with a cooldown); do not retry-hammer.
- Kill switch `TICKET_PRICES_ENABLED`; read path keeps working from cache.
- Do not redistribute: expose prices only inside a user's own trip budget. No bulk export, no public price endpoint.
- Show a neutral source line ("Prices from Disney's website, as of <date>; final price at checkout may differ").
- Do not call `/passes/` HTML or other pages. Only endpoints T and P.

---

## 3. Alternative legitimate sources

I found **no** official or licensed machine-readable feed for admission prices. Summary:

| Source | URL | Access | Date-based admission prices? | Terms / notes |
|---|---|---|---|---|
| Disney lexicon-view-assembler | section 1 | anonymous token + HTTPS | **Yes, complete** | ToS restricts automated access (section 2). |
| ThemeParks.wiki | `https://api.themeparks.wiki/v1` | public, free | **No admission data.** [V] | See 3.2. |
| Disney Parks Blog / press releases | `disneyparks.com/blog` | HTML articles | Announcements and ranges only, no API | Editorial; not structured. [A] not fetched this pass; search results showed press coverage but no feed. |
| Disney affiliate / travel-agent program | n/a | agent portals (login) | Not public | [A] Not publicly documented; I found nothing public. |
| Authorized Ticket Sellers (Undercover Tourist, Get Away Today, Costco/Sam's) | `undercovertourist.com` | Affiliate programs (Undercover Tourist runs through CJ Affiliate per a third-party article) | Their own discounted prices, not Disney's list price | [A] A CJ product feed may exist but is for affiliate deep links and would give seller prices that differ from Disney's. Not verified. Not a substitute. |
| TouringPlans ticket calculator | `touringplans.com/walt-disney-world/ticket-calculator` | Web tool | Compares sellers | No public API found (first report). |
| Editorial charts (AllEars, WDWInfo, WDW Magic, Disney Tourist Blog) | various | HTML articles | Ranges, some date lists | Copyright. They update by hand and lag (WDWInfo's chart was visibly stale: its max 1-day price is $184 against $229 now). Not suitable as data. Useful only as a cross-check. |
| Wikipedia / open data | n/a | n/a | No | [A] None found. |

### 3.2 ThemeParks.wiki re-check [V]

I fetched `/v1/destinations`, then `/entity/{id}`, `/children`, `/live` and `/schedule` for the WDW destination and each of the six parks, and scanned the raw responses for any key or value containing ticket, admission, hopper, annual or price.

- The only price-like keys are `price` and `purchases` in `/live` and `/schedule`. The purchases are Lightning Lane (`PACKAGE` Multi Pass and Premier Pass, `ATTRACTION` Single Pass). Strings containing "ticket" are only `TICKETED_EVENT` / "Special Ticketed Event" schedule types.
- **Admission ticket prices are not present anywhere.** The first report's conclusion holds.
- **Correction to the first report:** it said the destination entity's schedule is empty. That is true only of the top-level `schedule` array. `GET /entity/e957da41-3552-4cf6-b636-5babc5cbc4e5/schedule` (the WDW destination) returns a `parks[]` array with all six parks' schedules and their `purchases[]`. Lightning Lane prices for all parks can therefore come from **one** call. Shape: `{id, name, entityType, timezone, schedule: [], parks: [{id, name, schedule: [{date, type, purchases: [...]}]}]}`. Use it instead of six park calls when the LL work is built.

---

## 4. Coverage and storage model

### 4.1 Measured sizes and request counts [V]

| Call | Response size | Time (this machine) |
|---|---|---|
| Token (T) | 69 bytes | about 150 ms |
| P, `numDays=1`, full window (all parks) | 1.74 MB, 5,196 rows | about 2.1 s |
| P, `numDays=2..10`, full window | about 1.19 MB each, 3,464 rows each | about 1.7 s |
| P, one month, `numDays=4` | 83 KB | about 0.7 s |
| P, one date | 2.9 KB | about 0.6 s |
| C (per option, all lengths) | 2.8 to 3.8 MB | 2.4 to 3.5 s |

Cheapest strategy: **P with `discountGroup=std-gst`, one call per `numDays` 1 to 10, covering `startDate=<today in WDW>` to `endDate=<maxPricingCalendarDate>`.** P returns every option in one response, so adding Park Hopper, Park Hopper Plus and Water Parks & Sports costs **zero** extra calls. Endpoint C would need six calls of 3 MB each (about 15 MB) and returns the same numbers.

Per refresh run:

| Scope | Requests | Bytes (approx.) | Rows |
|---|---|---|---|
| All Guests, 433-day window | 1 token + 1 horizon probe + 10 = **12** | about 12.4 MB | 5,196 + 9 × 3,464 = **36,372** |
| Plus Florida Resident | + 10 (or fewer, see 4.5) | + about 12 MB | + up to 36,372 |

Smaller alternative: fetch only dates covered by existing trips (a trip needs `numDays` ≤ trip length × a few start dates). This is more code and more calls over time. I do not recommend it; one daily full refresh is simpler and cheaper than per-trip logic.

### 4.2 Proposed schema

Normalized, one row per price. Money in integer cents.

```sql
-- apps/api/migrations/NNNN_ticket_prices.sql  (illustrative; do not apply)
BEGIN;

CREATE TABLE IF NOT EXISTS ticket_prices (
  discount_group TEXT     NOT NULL CHECK (discount_group IN ('std-gst', 'fl-resident')),
  num_days       SMALLINT NOT NULL CHECK (num_days BETWEEN 1 AND 10),
  age_group      TEXT     NOT NULL CHECK (age_group IN ('adult', 'child')),
  option_code    TEXT     NOT NULL CHECK (option_code IN ('base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports')),
  park           TEXT     NOT NULL DEFAULT 'any' CHECK (park IN ('any', 'mk', 'ep', 'hs', 'ak')),
  start_date     DATE     NOT NULL,                 -- WDW local date
  price_cents    INTEGER  NOT NULL CHECK (price_cents > 0),   -- pre-tax subtotal
  tax_cents      INTEGER  NOT NULL CHECK (tax_cents >= 0),
  valid_end_date DATE     NOT NULL,                 -- last day the ticket can be used
  product_id     TEXT     NOT NULL,                 -- Disney "id", for debugging
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discount_group, num_days, age_group, option_code, park, start_date)
);

-- One row per (discount_group, num_days): freshness and failure state.
CREATE TABLE IF NOT EXISTS ticket_price_sets (
  discount_group  TEXT     NOT NULL,
  num_days        SMALLINT NOT NULL,
  as_of           TIMESTAMPTZ,                      -- last successful full fetch
  horizon_date    DATE,                             -- maxPricingCalendarDate seen
  row_count       INTEGER,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  blocked_until   TIMESTAMPTZ,                      -- WAF circuit breaker
  PRIMARY KEY (discount_group, num_days)
);

COMMIT;
```

Conventions followed: sequential migration, `BEGIN/COMMIT`, `IF NOT EXISTS`, `TIMESTAMPTZ`, `CHECK` constraints, integer cents. There is no user FK, so `accountDeletion/dispositions.ts` needs no entry. [A] Confirm with the registry test before adding.

Design notes:

- **Why `as_of` lives on the set table, not each row:** rewriting 36,000 rows every day just to bump a timestamp is write churn on Neon (WAL and dead tuples). Rows are touched only when a price changes, via the upsert below. `as_of` for a row = its set's `as_of`.
- **Upsert (dedupe first):** Postgres raises error `21000` if one `INSERT ... ON CONFLICT DO UPDATE` statement hits the same key twice. Within one response each key is unique by construction, but dedupe by the 6-column primary key in a `Map` before building the statement anyway (the execution-discipline rule). Insert in chunks of about 2,000 rows using `unnest(...)` arrays. Use `ON CONFLICT (...) DO UPDATE SET price_cents = EXCLUDED.price_cents, tax_cents = EXCLUDED.tax_cents, valid_end_date = EXCLUDED.valid_end_date, product_id = EXCLUDED.product_id, changed_at = now() WHERE (ticket_prices.price_cents, ticket_prices.tax_cents, ticket_prices.valid_end_date) IS DISTINCT FROM (EXCLUDED.price_cents, EXCLUDED.tax_cents, EXCLUDED.valid_end_date)`.
- **Retention:** each run ends with `DELETE FROM ticket_prices WHERE start_date < <wdwToday>`. The window never exceeds about 433 rows per key, so the table is bounded. No history is kept (add a tiny yearly aggregate only if you later want year-over-year estimates).
- **Size:** about 36,372 rows per discount group at roughly 150 bytes each including the primary-key index is about 5 MB; both groups about 11 MB, roughly 1% of Neon's 1 GB. [A] estimate, not measured in Postgres.
- **If you prefer fewer rows:** one row per `(discount_group, num_days, start_date)` with a small JSONB map of the 8 to 12 prices gives about 4,330 rows per group. Cheaper in rows, harder to query and to constrain. I recommend the normalized table.
- Price lookup for a trip: `SELECT ... WHERE discount_group = $1 AND num_days = $2 AND start_date = $3`, one indexed read, no Redis.

### 4.3 Refresh cadence and cron fit

**Correction to the brief:** `.kiro/steering/tech-conventions.md` says to drive scheduled work from the existing keep-alive cron. `docs/hosting.md` is more specific and says the opposite for database work. The keep-alive pinger hits `/health` and touches no database. It must never call a DB-backed endpoint, because waking Neon every 10 minutes would use about 580 CU-hours against a roughly 400 CU-hour free allowance. Every other scheduled job (Reminder_Cron, Photo_Cron, Purge_Cron) is a **dedicated** cron-job.org job with its own secret and a few runs per day. Follow that pattern:

- Endpoint: `POST` or `HEAD /internal/ticket-prices/refresh/run`. Header `x-cron-secret: <TICKET_PRICES_CRON_SECRET>` (dedicated; refuse to boot if equal to another cron secret, as Purge_Cron does). Missing or wrong secret returns `401`. Returns `202` immediately; the work runs after the response. Single-flight guard returning `{status:'skipped',reason:'in_flight'}`.
- Schedule (America/New_York): `50 7,19 * * *` (07:50 and 19:50 ET). Two runs per day gives a retry window if the first fails. These slots avoid Photo_Cron (`5 7,13,19,0`), Reminder_Cron (minutes 0/10/20 of hours 6, 7, 9, 20) and Purge_Cron (`35 8,20`), and both fall inside the keep-alive window. [A] Verify against the live cron-job.org config.
- Skip a set if its `as_of` is younger than `TICKET_PRICES_MIN_REFRESH_HOURS` (default 10). Two runs 12 hours apart both refresh when healthy; a run that follows a failure retries only the failed sets.
- Per-run request budget: 12 for All Guests, up to 22 with Florida Residents. Run them sequentially with `TICKET_PRICES_REQUEST_SPACING_MS=1500` between calls. Total elapsed about 20 to 40 s, well inside a Render request that already returned 202.
- Daily total: 24 calls across two runs for All Guests only, 44 with Florida Residents, so at most about 1,320 per month. Well under "a few hundred per day".
- No Redis commands at all.
- **Staleness check to decide cadence [A]:** I did not observe how often Disney changes prices; press coverage shows two public releases in 2026 (April for Jan-Oct 2027, October for Nov-Dec 2027). Daily is generous.

### 4.4 Stale data, failure and fallback behavior

Read path labels, computed from `ticket_price_sets.as_of`:

| Condition | Label shown | Value |
|---|---|---|
| `as_of` within `TICKET_PRICES_FRESH_DAYS` (default 2) | "Disney price, as of <date>" | exact row |
| older than 2 days, up to `TICKET_PRICES_ESTIMATE_AFTER_DAYS` (default 14) | "Disney price as of <date> (may have changed)" | exact row |
| older than 14 days | "Estimate" | exact row if present, else nearest |
| requested start date past `horizon_date` (Disney has not released those dates) | "Estimate" | price of the nearest earlier date of the same weekday in the same park and option, [A] simple v1 rule |
| no row and no cache at all | "Add your price" | none; user enters manually |
| user-entered override | "Your price" | user value; never overwritten by refresh |

Failure handling:

- A failed fetch for one `numDays` leaves the old rows untouched (the set `as_of` is not advanced) and records `last_error`.
- Any 403/429 or Akamai/edge marker (reuse `classify.ts` WAF detection) stops the run and sets `blocked_until = now() + TICKET_PRICES_BLOCK_COOLDOWN_MINUTES` (default 360) on all sets. The next run skips while blocked.
- 401 on the price call: refetch the token once and retry once. Tokens last 1,800 s, so cache the token in memory for the run only.
- A response with zero rows, a non-numeric `subtotal`, or `price_cents <= 0` is rejected (Disney's own 500 text for bad windows says prices must be positive). The old rows stay.
- Sanity guard before replacing: reject a set if its row count drops by more than 50% compared with the previous run. [A] reasonable default, tune later.

### 4.5 Configuration and kill switch

| Env var | Default | Purpose |
|---|---|---|
| `TICKET_PRICES_ENABLED` | `false` in production until diagnostic passes | Kill switch. When false the cron endpoint returns `202 {status:'disabled'}` and makes no outbound call. Reads still serve cached rows. |
| `TICKET_PRICES_CRON_SECRET` | none, required when enabled | Cron auth. |
| `TICKET_PRICES_BASE_URL` | `https://disneyworld.disney.go.com` | |
| `TICKET_PRICES_GROUPS` | `std-gst` | Comma list. Add `fl-resident` only after verifying lengths (below). |
| `TICKET_PRICES_REQUEST_SPACING_MS` | `1500` | |
| `TICKET_PRICES_MIN_REFRESH_HOURS` | `10` | |
| `TICKET_PRICES_FRESH_DAYS` / `_ESTIMATE_AFTER_DAYS` | `2` / `14` | Label thresholds. |
| `TICKET_PRICES_BLOCK_COOLDOWN_MINUTES` | `360` | WAF cooldown. |
| `TICKET_PRICES_TAX_RATE` | `0.065` | Only for display when `tax_cents` is not used. Observed ratio 0.065. |
| `TICKET_PRICES_USER_AGENT` | `DwtTripBudget/1.0 (+<contact url>)` | Honest UA. |

Open item for Florida Residents [V partially]: endpoint P returned 200 for `fl-resident` with `numDays=4` and the same 8 product shapes, while endpoint C listed only 1, 3 and 4 day Florida products. Before enabling `fl-resident`, the spec should have the coder probe `numDays` 1 to 10 and store only the lengths that return 200.

---

## 5. Validation

### 5.1 Method

Because the source is Disney's own service, "independent" means checking (a) that the data matches what Disney's rendered page shows users, and (b) that it matches third-party reports compiled from the website by humans.

### 5.2 Results

**Check A: Disney's rendered page vs the API [V], 9 of 9 match.** On `/admission/tickets/theme-parks/` Disney shows "From $X per day" under each day count (screenshot taken, kept only in the temp folder, then deleted). The API's lowest `pricePerDay` for adult base tickets across the 433-day calendar, rounded up to the next dollar, equals every figure on the page:

| Days | Page shows | API min per day | Round up |
|---|---|---|---|
| 2 | $130 | 129.03 | 130 ✓ |
| 3 | $127 | 126.96 | 127 ✓ |
| 4 | $124 | 123.96 | 124 ✓ |
| 5 | $103 | 102.52 | 103 ✓ |
| 6 | $90 | 89.46 | 90 ✓ |
| 7 | $82 | 81.06 | 82 ✓ |
| 8 | $75 | 74.23 | 75 ✓ |
| 9 | $69 | 68.08 | 69 ✓ |
| 10 | $64 | 63.47 | 64 ✓ |

Note: the page rounds up, and `product-types` `ticketDays[].startingFromPrice.pricePerDay` is also rounded (for 2 days it says `"130.00"`). The calendar data is the unrounded source.

**Check B: single-day peak prices vs an editorial report [V], 8 of 8 match.** WDW Magic's article of 2026-10-06 ("Walt Disney World Single Day Ticket Prices Increase for 2027") lists peak dates per park. The API gives:

| Claim | API values |
|---|---|
| MK Dec 2026 peak $209 (Dec 19, 22-31) | 209 on 12-19, 12-22, 12-23, 12-28, 12-31 ✓ |
| MK Dec 2027 peak $229 (Dec 25, 31) | 229, 229 ✓ |
| EPCOT Dec 2026 peak $209 (Dec 31) | 209 ✓ |
| EPCOT Dec 2027 peak $229 (Dec 31) | 229 ✓ |
| DHS Dec 2026 peak $204 (Dec 19-31) | 204 ×3 ✓ |
| DHS Dec 2027 peak $214 (Dec 24-31) | 214 ×3 ✓ |
| AK Dec 2026 peak $184 (Dec 19-31) | 184 ×3 ✓ |
| AK Dec 2027 peak $189 (Dec 24-31) | 189 ×2 ✓ |

Also: the API's maximum 1-day Park Hopper adult price is **$301 on 2027-12-31**, matching WDWNT's reported 2027 peak of $301. The child price is exactly $5 less than adult on every sampled 1-day date.

**Check C: sample prices the brief asked for [V for the API values].**

1-day Magic Kingdom, adult, three dates (API `subtotal`):

| Date | MK adult | MK child | Independent evidence |
|---|---|---|---|
| 2026-11-15 | $199 | $194 | none found for this exact date |
| 2026-12-26 | $209 | $204 | matches WDW Magic Dec 2026 peak ($209) ✓ |
| 2027-01-12 | $189 | $184 | none found for this exact date |
| 2027-06-15 | $199 | $194 | none found for this exact date |

4-day tickets (adult, start date 2026-11-15): base **$697.36**, Park Hopper **$797.36** (add-on = **$100.00**), Park Hopper Plus **$816.36** (add-on = **$119.00**), Water Parks & Sports **$767.36** (add-on = **$70.00**). On 2026-12-26 the same four are $725.93, $830.93, $848.43, $795.93. Florida Resident 4-day base on 2026-11-15 is **$418.42**. [V] I found no editorial source quoting these exact multi-day totals for these dates, so I cannot independently confirm them beyond Check A (which does validate the multi-day minimums on Disney's own page) and the internal consistency check in 1.5. [A] Disney also publishes a plandisney.disney.go.com Q&A with a 4-day Park Hopper quote ($492.10 adult, $478.00 child, start Sept 1), but it refers to an earlier season and I could not match it to a date in the current window, so I did not count it.

**Discrepancies [V]:**

1. **AllEars (updated 2026-10-08) lists Magic Kingdom's 1-day adult range as $154-$229, EPCOT as $144-$229, DHS as $149-$214.** The API shows lower minimums: MK $139, EPCOT $129, DHS $139. Animal Kingdom's minimum ($119) and all four maximums agree. For MK only five dates are below $154 (2027-08-24, 08-27, 08-31, 09-07, 09-14). Likely explanation: AllEars' minimums omit a few late-summer 2027 dates, or they are stale. I cannot say which source Disney's checkout agrees with for those five dates, because I did not drive the 1-day calendar UI for them. The API is Disney's own data, so I give it precedence, but the spec's acceptance test should compare one of those dates in the live UI.
2. WDWInfo's chart is stale (its 1-day maximum is $184, now $229). It is not a usable cross-check.
3. The Disney 2-day figure on the page ($130) equals the API minimum rounded up, not the exact value. Always store and use `subtotal`, not the rounded "From" value.

---

## 6. Recommendation

### 6.1 Go / no-go

- **Technical: GO.** Endpoint P is stable-looking, structured, cheap, matches Disney's own display, and fits every hosting limit.
- **Legal / policy: decision for you.** The Terms of Use prohibit scripted access. I can't tell you it is safe. I can tell you the realistic worst case is that Disney's edge blocks the egress IP (which would also hurt the existing menu fetches) or sends a notice, and that every mitigation in 2.5 reduces exposure.
- **If you decline the risk,** there is no compliant machine-readable replacement (section 3). Use user-entered prices with an explicit "enter your quoted price" field and static helper text, and still store the user's price per line. Do not build an admin table; you ruled that out.

### 6.2 Recommended primary source and fallback chain

1. **Primary:** Disney endpoint P (`discountGroup=std-gst`, plus `fl-resident` after verifying lengths), cached in `ticket_prices`, refreshed twice a day.
2. **Fallback 1:** last cached row for the exact key, labeled with `as_of` (and "may have changed" after 2 days).
3. **Fallback 2:** labeled **Estimate** from the nearest same-weekday cached date, or for dates beyond Disney's horizon.
4. **Fallback 3:** **user-entered price** ("Your price"), always allowed as an override.
5. Not used: scraping editorial sites, scraping HTML pages, ThemeParks.wiki for admission (it has none).

### 6.3 What the spec's External Interfaces section must contain

- Base URL, the two endpoints (T and P), method, required header `Authorization: BEARER <access_token>`, token lifetime 1,800 s, and that no cookies are needed.
- Query parameters from the table in 1.3, including the clamp rules: `startDate` is today in WDW time (`wdwClock.wdwToday`); `endDate` is `maxPricingCalendarDate` from the horizon probe (a call with `startDate=endDate=today` returns it in about 3 KB). Calls beyond the horizon return 500; calls before today return 400.
- The response fields relied on: `maxPricingCalendarDate`, `pricingCalendar[].numDays`, `dates[].date`, `dates[].validityEndDate`, `pricing[].id`, `ageGroup`, `subtotal`, `tax`, `stopSale`, `availability`, `enabled`.
- The id-to-column mapping table from 1.5 (option token to `option_code`, resident token to `discount_group`, park suffix to `park`, `park='any'` otherwise).
- Units: dollar strings to integer cents; use `subtotal`, never `pricePerDay`; prices are pre-tax; tax observed at 6.5%.
- Known edge cases: `numDays=1` has 12 rows per date, others 8; Water Parks & Sports exists only for `numDays >= 2`; `numDays` 11 is 404; Florida lengths still to be probed; `passholder`, `dvc`, `canada-resident` are not served.
- Dedupe-by-key rule for the upsert; pruning rule; staleness labels; kill switch and cooldown variables; dedicated cron (not the keep-alive).
- The cross-spec dependencies: `wdwClock` for dates, `DisneyTransport` (target `web`) for rate limiting and WAF classification (see note below), the trip budget feature for consumers, `dispositions.ts` check (no user FK).
- An explicit statement of the ToS position and who accepted it.
- **Transport note:** `DisneyTransport` adds the `web` User-Agent itself and passes caller `Authorization` headers through untouched (`transport.ts` header comment). Whether it enforces a response-size limit for 1.7 MB bodies was not checked. [A] Verify before wiring. If the transport's UA override conflicts with an honest UA, the spec must pick one.
- **Do not** wire any of this into `composeServices.ts` in a way that revives the retired Disney live path; the `retirement.smoke.test.ts` pins that. This is a new, separate, static-data client, not a live-data module.

### 6.4 Akamai from a Render server IP: untested, and how to test

I cannot test this. All traffic here came from a residential address. Things I did observe that bear on it:

- Headless Chrome is rejected at the HTTP/2 layer. A plain HTTPS client is not. [V]
- `curl.exe` with its default `curl/8.x` User-Agent hung and then reset (exit 56 after about 19 s), while Node's default `fetch` User-Agent and a custom UA both succeeded. [V] So the edge reacts to specific client signatures; a non-browser but identifiable UA is accepted from this IP. Whether datacenter IPs are treated differently is unknown. [A]
- The repo's own history shows a real Akamai block caused by 576 back-to-back menu calls (`menuRetrieval.ts` header) and `hosting.md` calls out that Disney's edge can throttle the shared egress IP. [V from the docs]

Safe post-deploy test (build this as the first slice and gate everything else on it):

1. Add `POST /internal/ticket-prices/diagnose` behind the same `x-cron-secret`, or as a button in the existing basic-auth admin panel (`apps/api/src/services/admin/routes.ts`). It must write nothing.
2. It performs exactly two calls from the Render process: (a) the token call, (b) one `P` call with `numDays=1`, `startDate=endDate=<today in WDW>`, which returns about 8 KB.
3. It returns JSON: HTTP status of each call, bytes, elapsed ms, whether a WAF marker was found (reuse `classify.ts`), the `maxPricingCalendarDate`, and the adult MK 1-day price. Never return the token.
4. Run it 3 times at different times of day over a few days, from the cold-start window and from a warm instance. If all pass, set `TICKET_PRICES_ENABLED=true` and add the cron. If any returns 403/429 or a WAF page, leave it off, keep the user-entered path, and do not retry from the same IP.

### 6.5 Risks you must decide on

1. **ToS exposure** (section 2). Decide whether you accept it, and whether the app is or will be commercial.
2. **Block risk from Render's IP.** Mitigated by the diagnostic and the circuit breaker. A block could also affect the existing menu fetches because they share an egress IP.
3. **Undocumented endpoint.** Disney can change or remove it without notice (the SPA is versioned, 1.36.19 today). Mitigate with a schema validator on the response (Zod in `packages/shared`), a row-count sanity guard, and the user-entered fallback. A contract test that runs the parser against a saved real fixture catches parsing drift in CI.
4. **Honest user-agent vs the shared transport.** Decide whether to carve out an honest UA for this client.
5. **Accuracy promise.** Prices are Disney's published list prices before tax. Discounted tickets from authorized sellers, military, and special offers are not covered. Say so in the UI.
6. **Scope:** Annual Pass prices (HTML only, 4 values) and single-day water-park tickets are not in this source. Treat them as user-entered for now.

---

## 7. Clean-up confirmation

Created outside the repo, in `C:\Users\knick\AppData\Local\Temp\tp-probe\`: `playwright-core` (npm, local to that folder), about 30 throwaway `.mjs`/`.ps1` scripts, saved JSON responses (about 25 MB), screenshots, the saved ToS and `robots.txt` text, the SPA bundle, a token file, and `curl` output. **Removed:** every loose file in that folder (all scripts, saved JSON responses, screenshots, the saved ToS/`robots.txt` text, the SPA bundle, the `curl` output, and `tok.txt`, which held an anonymous 30-minute token that has also expired).

**Left behind, outside the repo:** the empty shell `C:\Users\knick\AppData\Local\Temp\tp-probe\node_modules\` (just `playwright-core`, a few MB). My recursive delete was blocked by your `permissions.yaml` rule on `Remove-Item -Recurse`, and I did not work around it. It is safe to delete by hand: `Remove-Item -Recurse -Force "$env:TEMP\tp-probe"`.

No dependency was added to any `package.json` or lockfile (`git diff --stat` on the root, `apps/api`, `apps/mobile` and `packages/shared` manifests is empty), nothing was installed globally, and no browser was downloaded (the system Chrome was used). Chrome windows opened by the probe were closed by the scripts.

Repo state after cleanup: `git status` shows the same 9 modified mobile files that were already dirty before I started (I did not touch them) plus the untracked `.agents/tasks/trip-budget/` folder, which contains only `investigation.md` (first pass) and this report.
