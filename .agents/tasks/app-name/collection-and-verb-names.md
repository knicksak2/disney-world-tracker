# Collection-word names (instead of "folio") and "Verb the Noun" names (like "Track the Magic")
Read-only. No repo source or .env file touched. Scratch scripts and CSVs are in `%TEMP%\cv` (gen.ps1, screen.ps1, screen2.ps1, dom.ps1, p1.csv, p2.csv, words.csv, forms.csv, dom.csv). Dated Nov 2026. Not legal advice. **[V]** = seen in an API response or search result this session. **[I]** = my inference. "No brand found" = not surfaced in top results (the web tool is not exact-phrase and is swamped by Disney pages, so it is weak evidence).
Step 0: all 16 earlier reports in this folder were read. Every generated name was also checked against a normalized copy of their full text; 9 collection names and 2 verb names that already appeared there were dropped before screening (e.g. Penny Vault, Pin Vault, Crew Keepsake, Memory Keeper, Keep the Day).

## 1. Summary answer
- **Both ideas work as naming forms, but neither produces a clear winner on the App Store.** Of 599 names screened, 549 had zero exact App Store hits (50 had one or more). The real filter is the web and idiom: command phrases are common English, and several have a same-name business (Chase the Glow is a spray-tan LLC).
- **Best collection-word names:** Churro Journal, Crew Yearbook, Twilight Trunk, Pin Trunk, Lanyard Keeper. They are clean (0/0 across four App Store query forms, both domains free) but each says only the "log/collect" half of the app, not waits or crowds.
- **Best "Verb the Noun" names:** Seize the Rope and Catch the Rope. "Rope" is the Disney-fan word for the early-arrival plan (your 6 AM reminders), and the verb gives the "Track the Magic" feel without "Magic" or "Track". Both are clean on the App Store (4 forms) and both domains are free.
- **Seize the Rope is the one new name that edges past the earlier leaders on my scale (17 vs Rope Track 16, Memo on Main 15, Keepsake Days 15, Pocket & Pip 15, Magic Explorer 14).** It is a narrow call that rests on my scores, and it has two honest weaknesses: 14 characters, and the nearby Rope Drop Guide app (section 4).
- Collection words beat "folio" on one count: "folio" compounds had 22 exact hits in 151 (15%); here only 41 of 377 (11%) hit, and the strong words (album, trunk, yearbook, scrapbook, storybook, memento, keepsake) had **zero** compound hits.

## 2. Collection words: which are strongest
Method: 47 words screened alone (plain US iTunes query, limit 100). 377 `<flavor> <word>` compounds screened (exact = title before ":" / " - " / "|", non-alphanumerics removed, lowercase, "&" = "and"; contains = other titles including it). "Alone" = number of apps whose whole title is the word, within the top 100 results [V]. "Compounds" = flavor compounds with at least one exact hit / compounds tested [V]. The API under-reports (earlier reports found it missed real apps), so treat 0 as "not surfaced".
| Word | What it says | Alone (exact) | Compounds hit | Read |
|---|---|---|---|---|
| Album | Photos, a collection of moments | 0 | 0/25 | Open in the store. Web noise is music albums. Reads photos-only |
| Yearbook | A crew's year together, signed by friends | 1 | 0/11 | Best match to the crew feature. Warm, nostalgic |
| Keepsake | A souvenir you hold onto | 15 | 0/19 | Alone it is crowded; compounds are clean. Most on-brand with Vault and pressed pennies |
| Trunk | Steamer trunk, attic box of keepsakes | 0 | 0/17 | Open. Matches the cork-board Vault better than "album". Nostalgic |
| Journal | Written daily log | 2 | 3/19 | Compounds hit often (Glow, Crew, Dusk Journal exist). Few survive |
| Scrapbook | Pasted-together trip memories | 4 | 0/11 | Clean in the store; Etsy and Amazon are full of "Disney scrapbook" products [V] |
| Storybook | Fairy-tale book | 6 | 0/10 | **Disney uses it:** Storybook Treats (Magic Kingdom venue) and Storybook Circus (land) [V], and Disney travel agents use Storybook names [V] |
| Memento | Small remembered thing | 23 | 0/12 | Clean as compounds, but a crowded single word and a thin brand sound |
| Keeper | Someone who keeps it for you | 4 | 3/11 | Penny Keeper, Lantern Keeper, Crew Keeper exist. Only Lanyard, Tale, Wonder, Glow survive |
| Ledger | Costs, receipts | 4 | 2/10 | Fits expenses only; dry |
| Locket | Tiny keepsake worn close | 4 | 0/12 | Clean in the store, but Locket Widget is a large photo app [V] |
| Register | Guest register, signed log | 2 | 1/7 | Guest Register exists. Fits crew sign-in, weak elsewhere |
| Logbook, Codex, Chronicle, Memoir | Record words | 4 / 5 / 7 / 10 | 0/10, 0/8, 1/7, 0/8 | Clean but flat; "Memoir" reads adult |
| Vault, Box, Jar | Containers | 4 / 1 / 3 | 3/6, 7/18, 3/16 | Crowded. Vault is already your feature name |
| Stash, Trove, Curio, Gallery, Museum, Binder | Hoard words | 20 / 26 / 19 / 17 / 1 / 7 | 1/11, 2/8, 0/7, 0/6, 2/6, 1/5 | Alone they are crowded; "Pocket ___" is dead (4 of 6 compounds exist) |
| Compendium, Anthology, Treasury, Cabinet, Hoard, Relic, Chest, Cache | Rarer words | 0-5 | 0 of 3-7 each | Clean but formal; they do not sound like friends |
Flavor words, compounds with an exact hit / tested [V]: Merry 0/38, Churro 0/25, Rope 0/12, Lantern 1/32, Twilight 1/14, Hello 0/8, Stroll 0/11, Lanyard 0/6, Pin 2/29, Wonder 3/35, Glow 3/12, Crew 4/24, Penny 6/35, Pocket 4/6. Merry, Churro and Rope are the most open flavors; Penny and Crew are the most worn.
**Read:** Yearbook, Trunk and Keepsake are the best words. "Storybook" and "Locket" look clean in the store but carry a Disney-venue or large-app echo.

## 3. Method and counts
- **Part 1:** 397 generated (386 unique, 9 already in earlier reports), 377 screened: 41 exact hits, 8 contains-only, 328 clean. Forms: `<flavor> <word>`, joined (Pennybook), possessive (Penny's Album), natural phrases (Memory Trunk).
- **Part 2:** 224 generated, 222 screened: 9 exact hits, 29 contains-only, 184 clean. Verbs: track, catch, chase, find, keep, collect, savor, steal, seize, save, hold, gather, plan, mark, stamp, log, pin, stash, hoard, count, chart, map, bottle, frame, hug, hunt, plus 25 "Track/Plan/Find/Keep/Save Your ___" names.
- **Shortlist of 58** (best of both parts) got three more App Store forms (`<name> app`, joined, `<name> Disney`) and RDAP for `.com` (Verisign) and `.app` (Google): all 58 are 0/0 on every second form except Lantern Keeper (2 exact) and Tale Keeper (1 contains); 39 of 58 have both domains free. 22 web searches covered about 35 names.
- A sequential 2-second pace produced 0 API errors this run.
- **Exact hits worth knowing (dropped, F3):** Keep the Joy (KeepJoy), Collect the Joy, Save the Joy, Plan the Day (PlanDay), Plan the Joy, Frame the Joy, Count the Days, Save Your Day, Hold the Rope; Glow Journal, Crew Journal, Dusk Journal, Penny Ledger, Crew Ledger, Penny Jar, Memory Box, Memory Jar, Penny Box, Pin Box, Wonder Box, Kid Box, Pinbook, Pennybook, Wonderbook, Glowbook, Pennykeep, Pinkeep, Lanternkeep, Sparkjar, Guest Register, Penny Keeper, Lantern Keeper, Crew Keeper, Wonder Vault, Crew Vault, Pocket Vault/Stash/Museum/Binder.

## 4. Ranked 30 survivors
Scores 1-5 (5 best), total /20 on the same four-axis scale as `track-family.md`. S = sound and spelling; Fit = fit for the whole app; D = Disney-fan feeling with no Disney mark; C = clearance from recorded evidence only. `w:n` = no web search run for that name, so C is capped at 3. App Store = plain exact/contains, then the three second forms (0/0 x3 means all clean). `.com/.app` from RDAP (free = 404 = unregistered, not a price). Len = characters including spaces; iOS truncates a home-screen label near 11-12.
| # | Name | Idea | S/Fit/D/C | Tot | App Store | Web | .com/.app | Len | Caution |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Seize the Rope | "Seize the day" for rope drop and the 6 AM window | 4/4/5/4 | 17 | 0/0, 0/0 x3 | Only rope-drop articles and TikTok guides | free/free | 14 | Rope Drop Guide (Disney planner app) and @ropedroplife exist; 14 chars; "Seize" is an idiom |
| 2 | Churro Journal | The food, visit and spending diary | 4/4/4/4 | 16 | 0/0, 0/0 x3 | No brand; results were churro news and Etsy merch | free/free | 13 | Food-first read; "Journal" is generic |
| 3 | Crew Yearbook | The trip crew's year, signed by everyone | 4/5/3/4 | 16 | 0/0, 0/0 x3 | A ship's crew yearbook, ouryearbook.app (group yearbooks), no Disney use | free/free | 13 | Generic; "Crew Journal" and "Crew Keeper" exist as apps |
| 4 | Catch the Rope | Be there at rope drop; catch the booking window | 4/4/5/3 | 16 | 0/0, 0/0 x3 | w:n (sibling Seize the Rope searched) | free/free | 14 | w:n; same Rope Drop Guide proximity |
| 5 | Gather the Crew | Crew feature, plus a call-to-action | 4/5/3/3 | 15 | 0/0, 0/0 x3 | Weak; combined query only | **taken**/free | 15 | Common phrase, `.com` taken, 15 chars |
| 6 | Twilight Trunk | The Vault plus the Twilight theme | 4/4/3/4 | 15 | 0/0, 0/0 x3 | Ancora swim "Twilight Trunk", a paint-and-sip class title; nothing in Disney or apps | free/free | 13 | Swimwear and Twilight-saga noise |
| 7 | Hunt the Pins | Pin trading and the Vault | 3/3/5/4 | 15 | 0/0, 0/0 x3 | Only pin-hunt news and TikToks | free/free | 13 | Pins only; "hunt" can read scavenger game |
| 8 | Savor the Churro | Slow down and eat | 4/2/5/4 | 15 | 0/0, 0/0 x3 | Churro news only | free/free | 16 | Food-only; 16 chars |
| 9 | Lanyard Keeper | Keeps the pins and the days | 3/3/5/4 | 15 | 0/0, 0/0 x3 | Lanyard merch on Etsy and Amazon; no brand | free/free | 13 | Pins-narrow; Pinfolio-style merch listings nearby |
| 10 | Pin Trunk | Collection box for pins and days | 4/3/4/4 | 15 | 0/0, 0/0 x3 | No brand; pin-trading news and merch | free/free | 9 | Pins-narrow |
| 11 | Churro Keepsake | Souvenir of the snack and day | 3/3/4/4 | 14 | 0/0, 0/0 x3 | No brand | free/free | 14 | Long; "Keepsake" also in Keepsake Days |
| 12 | Penny Keepsake | Pressed pennies | 3/4/4/3 | 14 | 0/0, 0/0 x3 | Etsy sells "pressed penny souvenir book/album" as a product [V] | free/free | 14 | Descriptive of a product; penny is a worn flavor |
| 13 | Churro Ledger | Food and spending record | 3/3/4/4 | 14 | 0/0, 0/0 x3 | No brand | free/free | 13 | Fits expenses only |
| 14 | Chase the Twilight | Fireworks and the dark theme | 4/3/3/4 | 14 | 0/0, 0/0 x3 | Only Twilight-saga results | free/free | 18 | Long; saga noise |
| 15 | Catch the Finale | The nightly fireworks | 3/3/4/4 | 14 | 0/0, 0/0 x3 | No brand (combined query) | free/free | 16 | Long |
| 16 | Rope Journal | Rope-drop day log | 4/3/4/3 | 14 | 0/0, 0/0 x3 | The Team Roping Journal (rodeo magazine app); Rope Drop Guide nearby | **taken**/free | 12 | `.com` taken; sits in the "Rope" family |
| 17 | Bottle the Twilight | Keep a dusk | 4/3/3/4 | 14 | 0/0, 0/0 x3 | Water-bottle products only | free/free | 19 | Long |
| 18 | Lantern Album | Photos by lantern light | 4/3/3/3 | 13 | 0/0, 0/0 x3 | Music albums named Lantern swamp the search | free/free | 13 | Search noise; Lantern Keeper exists as an app |
| 19 | Twilight Storybook | Dark-theme storybook | 3/3/4/3 | 13 | 0/0, 0/0 x3 | Twilight Tales, Twilight Chronicle apps; no exact brand | free/free | 18 | "Storybook" is Disney venue wording [V]; long |
| 20 | Merry Storybook | Cheerful storybook | 3/3/4/3 | 13 | 0/0, 0/0 x3 | Disney agents named Storybook ___ (Vacation Planning, World Travel) [V] | free/free | 14 | Same niche word as travel agents |
| 21 | Stamp the Day | Date-stamp every day | 3/3/3/4 | 13 | 0/0, 0/0 x3 | No brand | free/free | 13 | "Stamp" read as postage |
| 22 | Penny Album | Pressed-penny album | 3/3/4/3 | 13 | 0/0, 0/0 x3 | w:n; Etsy lists pressed-penny albums as products | free/free | 11 | w:n |
| 23 | Catch the Glow | Fireworks and lit-up castle nights | 4/3/3/3 | 13 | 0/0, 0/0 x3 | Disney H2O Glow (event) and "The Glow" Disney song [V] | **taken**/free | 14 | `.com` taken; "Glow" is used in Disney event names |
| 24 | Rope Register | Sign-in log for the early crowd | 3/3/4/3 | 13 | 0/0, 0/0 x3 | No brand (combined query) | free/free | 13 | "Register" reads as a cash register |
| 25 | Bottle the Glow | Keep the light | 3/3/3/3 | 12 | 0/0, 0/0 x3 | BottleGlow (lighting product) | free/free | 15 | Product name next door |
| 26 | Keep the Wonder | Keep it going | 3/3/3/3 | 12 | 0/0, 0/0 x3 | Disney research and press use "wonder" widely | **taken**/free | 15 | `.com` taken |
| 27 | Chase the Glow | The glow of a day | 4/3/3/2 | 12 | 0/0, 0/0 x3 | **Chase the Glow, LLC (mobile spray-tan business)** [V] | free/free | 14 | Exact-name business, different field |
| 28 | Stroll Journal | Stroll through the park | 3/3/3/3 | 12 | 0/0, 0/0 x3 | StrollMemo (journal app) and several Stroll apps [V] | free/free | 13 | Crowded Stroll lane |
| 29 | Crew Scrapbook | Crew memories | 3/4/2/3 | 12 | 0/0, 0/0 x3 | w:n | free/free | 14 | w:n |
| 30 | Glow Locket | Locket keepsake | 3/3/3/3 | 12 | 0/0, 0/0 x3 | Locket Widget and Locket Camera are large apps [V] | free/free | 11 | "Locket" belongs to a big app |
Also screened and clean, not ranked: Lantern Scrapbook, Twilight Yearbook, Stroll Memoir, Churro Scrapbook, Stash the Churro, Hoard the Pins, Gather the Pins, Hold the Glow, Pin the Wonder, Catch the Sparkle, Track the Glow, Keep the Finale (all 0/0 x3; the last six have no web check).

## 5. Honest top 10 and comparison with the earlier leaders
1. **Seize the Rope** (17). Strongest new pairing of fan wink and feature fit; the "Seize the Day" echo is instantly readable.
2. **Churro Journal** (16). Friendliest name; clean on every check; covers food, visits and spending.
3. **Crew Yearbook** (16). Best fit to the crew feature; generic enough that it needs a strong icon.
4. **Catch the Rope** (16, capped by no web check). Softer verb than Seize; same Rope Drop Guide caution.
5. **Twilight Trunk** (15). Ties the Vault to the dark theme; has no verb or crew meaning.
6. **Gather the Crew** (15). Great fit but `.com` is taken and the phrase is common.
7. **Hunt the Pins** (15). The most Disney-fan wink of the pin names; narrow.
8. **Pin Trunk** (15). Short (9 chars), clean, pin-narrow.
9. **Lanyard Keeper** (15). Fan wink, clean; narrow.
10. **Savor the Churro** (15). Charming; food-only.
**Against your earlier favorites (same scale, scores from `track-family.md`):**
| Name | S/Fit/D/C | Tot | Does a new name beat it? |
|---|---|---|---|
| Rope Track | 4/4/5/3 | 16 | **Seize the Rope** beats it by one point: same fan feeling, no "Track" descriptor next to Magic Track, both domains free (Rope Track `.com` is taken) |
| Memo on Main | 4/3/4/4 | 15 | Seize the Rope and Churro Journal beat it on Fit and Disney feeling; Memo on Main keeps the shorter label (12) |
| Keepsake Days | 4/4/2/5 | 15 | Churro Journal and Crew Yearbook tie or edge it on warmth; Keepsake Days stays cleaner (C 5) |
| Pocket & Pip | 4/4/2/5 | 15 | No new name is cleaner or friendlier; Pocket & Pip stays ahead on persona |
| Magic Explorer | 4/3/4/3 | 14 | Seize the Rope, Churro Journal and Crew Yearbook beat it, and none shares the crowded "Magic ___" lane |
**Reading:** nothing here beats all five by a wide margin. The command form gives the "Track the Magic" feel cleanly, but it makes you choose a word (Rope) that means only the early-morning plan. If you want a name that carries the whole app, Churro Journal and Crew Yearbook are the safest fits from this round. The scores are my judgment; only the App Store, RDAP and the named web hits are recorded evidence.
**Answer to "other words instead of folio":** yearbook, trunk, keepsake and journal. They are real words fans already use, and compounds with Churro, Crew, Twilight and Pin are open on the App Store.
**Answer to "Track the Magic":** "Track the ___" with another noun is clean in the store (Track the Glow, Wonder, Joy, Sparkle, Lights, Fireworks, Finale all 0/0) but it stays in the same format and verb as Magic Track: Theme Park Log (earlier reports). Catch, Chase, Seize and Savor avoid that overlap.

## 6. Rejected names and the conflict
- **F3 (exact name in the store):** the 50 names listed in section 3, e.g. Plan the Day (PlanDay), Hold the Rope (Hold the Rope), Count the Days (Count the Days), Save Your Day (Save Your Day), Penny Keeper, Lantern Keeper (also "Lantern Keeper: Light Puzzle"), Guest Register, Glow Journal, Crew Journal, Dusk Journal, Wonder Vault, Pinbook, Wonderbook, Glowbook.
- **F1-style (same name, other fields) or near niche:** Chase the Glow (Chase the Glow, LLC, spray tan); Merry/Twilight Storybook lean toward Disney travel agencies named Storybook ___; Stroll Journal (StrollMemo, Stroll walking apps); Glow/Lantern Locket (Locket Widget); Bottle the Glow (BottleGlow).
- **F2 (Disney-owned word):** no Disney-owned whole-name hit surfaced. Close echoes, not exact: "Storybook Treats" and "Storybook Circus" (Disney venue and land); Glow event names (H2O Glow, Glow Fest) and a Disney Princess song titled "The Glow" [V]; Lantern echoes Tangled [I].
- **Common-phrase drops (generic idioms, unownable, left unscreened further):** Seize the Day, Save the Day, Seize the Moment, Savor the Moment, Catch the Moment, Count the Days.
- **Short list of crowded flavors:** Penny, Crew, Pocket (4 of 6 compounds exist), Wonder, Glow.

## 7. What I could not verify
- **USPTO, EUIPO and UKIPO:** not searched. Every shortlisted name needs a federal search in classes 9, 39, 41 and 42, plus "Rope Drop Guide" for conflict with any Rope-lead name.
- **Google Play directly:** web snippets only. The Play hits seen were Team Roping Journal, Sea Sparkle, crewcrew.
- **Registrar status and price:** RDAP 404 means unregistered, not available at standard price. Taken `.com` names were not checked for for-sale status.
- **iTunes API:** US only, top 100 results, under-reports (earlier reports found it missed real apps); the single-word counts "alone" are limited to 100 results. Exact matching ignores "the" for Part 2 only as a second key (e.g. "Chase Glow"), and "Plan the Trip" and "Track Your Day" had many contains hits that I did not inspect further.
- **Web:** 22 searches covered about 35 of the 58 shortlisted names, so the other 23 (marked w:n or combined queries) have only the App Store and RDAP behind them.
- **Name rules and scores:** Apple's name-collision rules were not re-tested in App Store Connect. Scores and Disney-mark judgments are mine.
- Nothing was implemented.
