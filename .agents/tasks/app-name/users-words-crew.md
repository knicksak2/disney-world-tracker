# The user's own words + crew/group/hangout nouns: 1,110 names screened

Read-only. No repo source or .env file was read or changed. Scratch scripts and CSVs are in `%TEMP%\uw` (gen.ps1, screen.ps1, rdap.ps1, cands.csv, s1.csv, s_join.csv, s_dis.csv, s_app.csv, rdap.csv, short.txt). Not legal advice. Searches ran 21 Nov 2026. **[V]** = seen in an API response or search result this session. **[I]** = my inference. "No brand found" means "not surfaced in top results". The web tool is not exact-phrase and returns mostly noise, so web evidence is weak.
Step 0: all 21 earlier reports were read (crew-and-collector.md and clubhouse.md in full; park-pioneer, rerank-and-evocative, parkpanion and collection-and-verb-names in their summaries; the rest by a normalized text match). 115 generated names already appeared in them (e.g. Park Pals, Magic Crew, Wish Crew, Rope Crew, Pioneer Crew). I re-screened those only so the per-word counts are complete; they are marked "seen" and not ranked as new suggestions. No food word and none of your earlier favourites was used.

## 1. Summary answer
- **Your word with the most open room is Headliner.** 48 Headliner combinations tried: 0 exact App Store hits, 1 web conflict (Headliner Club, a Portland venue with its own app), and 11 of the 12 I carried through to domains have both `.com` and `.app` free. Front Row, Finale, Queue, Parade, Explorer, Pioneer and Rope are next (about 6-8 shortlisted names each with both domains free).
- **Best on evidence: Headliner Crew, Headliner Pals, Front Row Pals** (22/25 each), then Headliner Troop, Front Row Troop, Explorer Crew and Headliner Lodge (21). All are clean on four App Store query forms with both domains unregistered, and none had a same-niche brand in the web checks I ran.
- **Your words that are mostly closed:** Magic (0 of 6 shortlisted have a free `.com`; Magic Pin, Magic Track and MagicDay are same-niche apps), Track (0 of 4), Park (11 of 38 already screened earlier, rest crowded), Pin, Show.
- **Counts:** 1,110 names screened on the iTunes API (US, top 100): 995 new + 115 seen before. 50 of the 995 new names had an exact App Store title or 2+ contains (5%), so 945 survived. 192 were shortlisted for three second forms (`<name> app`, joined, `<name> Disney`): 576 queries, 0 new exact hits and 4 single contains hits (Pioneer Club, Ticket Pals, Park Lodge, Fantasy Club). 192 RDAP pairs: `.com` free 95 (49%), `.app` free 182 (95%). 26 web searches covered 24 names.
- **The App Store is not the filter, as before.** Short crew phrases are rarely app titles. The real blocks are same-niche web brands (Mouse Pals podcast, Front Row Crew community, Headliner Club) and `.com` registrations.
- **Caution on scope.** I web-checked 24 names, not the ~80 asked for. The web checks that I could run were slow and mostly noise, and scripted search (DuckDuckGo, Bing) returned bot challenges or unrelated results, so I stopped at the names that ranked. Every ranked row marked "Not web-checked" has Clearance capped at 3.
- **Disney echoes (stated once, you count these as a plus):** Explorer Troop echoes Disney's Wilderness Explorers "troop leaders"; Parade Crew is a Disney cast-member term printed on cast jackets; Lodge echoes Disney resort lodges; The Mouse Society echoes the Mickey Mouse Club. None is an exact Disney mark that I found. Pioneer names sit next to the taken parkpioneer.com in sound.

## 2. Per-word summary (28 of your words; all names screened with the 8 required forms plus extras)
Tried = all names screened. Seen = already in an earlier report. Taken = new names with an exact App Store title, 2+ contains, or a web brand (Headliner Club, Mouse Pals, Front Row Crew, Pixie Crew added). Open = new names with no such block. Both free = shortlisted names with `.com` and `.app` both unregistered / names shortlisted. "Best nouns" are the ones that were both free and read naturally.
| Word | Tried | Seen | Taken | Open | Both free | Best nouns |
|---|---|---|---|---|---|---|
| Headliner | 48 | 0 | 1 | 47 | 11/12 | Crew, Pals, Troop, Lodge |
| Front Row | 48 | 0 | 2 | 46 | 7/11 | Pals, Troop, Lodge (Crew has a web brand; Club `.com` taken) |
| Explorer | 48 | 3 | 0 | 45 | 4/10 | Crew, Troop, Gang, Porch |
| Finale | 47 | 2 | 0 | 45 | 7/8 | Pals, Gang, Troop, Lodge |
| Queue | 47 | 3 | 0 | 44 | 7/10 | Pals, Troop, Gang, Lodge |
| Parade | 36 | 0 | 0 | 36 | 7/9 | Crew, Troop, Gang, Lodge |
| Pioneer | 38 | 4 | 1 | 33 | 6/9 | Troop, Pals, Gang (Park Pioneer adjacency) |
| Rope | 48 | 22 | 0 | 26 | 8/11 | Pals, Circle, Posse, League (Rope Crew was clean earlier) |
| Main Attraction | 25 | 0 | 0 | 25 | 5/5 | Crew, Pals, Troop (long: 15-19 characters) |
| Main | 48 | 2 | 1 | 45 | 3/11 | Troop, The Main Society, Hangout |
| Mouse | 48 | 11 | 1 | 36 | 4/8 | The Mouse Society, Collective, Porch (Pals is a podcast) |
| Pixie | 48 | 1 | 2 | 45 | 3/9 | Troop, The Pixie Society (Pixie Pals app, Pixie Crew toys) |
| Wish | 47 | 6 | 1 | 40 | 1/10 | Troop, Lodge, Porch (`.com` taken for most; `.app` free) |
| Park | 38 | 11 | 2 | 25 | 3/10 | Troop, Posse, Hangout |
| Fantasy | 38 | 3 | 4 | 31 | 1/5 | Troop |
| Gate | 36 | 2 | 2 | 32 | 3/6 | Troop, Pals, Porch |
| Ticket | 36 | 3 | 0 | 33 | 1/7 | The Ticket Society |
| Vault | 36 | 2 | 4 | 30 | 2/6 | Troop, Porch (The Vault Society and Team Vault are apps) |
| Day | 36 | 4 | 8 | 24 | 2/5 | Troop, The Day Society |
| Pin | 36 | 7 | 1 | 28 | 2/5 | Troop, Porch (Pin Circle app) |
| Memo | 36 | 3 | 2 | 31 | 2/3 | Pals, Porch |
| Folio | 26 | 0 | 0 | 26 | 1/3 | Pals |
| Dex | 26 | 0 | 2 | 24 | 1/2 | Pals |
| Percent | 26 | 0 | 1 | 25 | 1/2 | Crew |
| Show | 36 | 0 | 4 | 32 | 1/3 | Troop |
| Track | 36 | 2 | 5 | 29 | 0/4 | none free (`.com` taken on all four) |
| Magic | 48 | 12 | 6 | 30 | 0/6 | none free (Magic Troop: `.app` only) |
| Pal | 24 | 1 | 3 | 20 | 2/2 | Troop, Lodge (reads silly) |
| Crew (as first word, or the noun) | 20 | 11 | 1 | 8 | n/a | mostly covered earlier |
- **Two-word names (both words yours):** 134 names (14 lead words x 13 second words, e.g. Explorer Day, Wish Parade, Front Row Gate, Headliner Parade) plus every `<word> Crew`/`<word> Pals` name. Only 5 of the 134 were App Store blocked (Magic Gate, Magic Wish, Magic Show, Fantasy Pin, Main Track). The other 129 are open on the App Store, but they read as phrases, not groups, and I did not web-check them.
- **Your own examples:** Headliner Pals open; Explorer Troop open (Disney troop-leader echo); Front Row Crew has a real community brand; Main Crew is clean on the App Store, `.com` taken, web noise only; Mouse Pals is a Disney World podcast (taken); Pioneer Pals is a kids' program at CSU East Bay (minor, not same-niche); Queue Club is clean, both domains taken; Wish Crew was in an earlier report.

## 3. Natural combinations that are TAKEN (38; what uses each)
App Store entries are exact titles from the iTunes API [V]. Web entries are search results [V].
| Name | What uses it |
|---|---|
| Mouse Pals | "Mouse Pals", a Disney World podcast by Andrew and Jeff (Apple Podcasts) [web]. F1 |
| Headliner Club | The Headliners Club (Portland venue) plus its "The Headliner Club" iOS and Android member app [web] |
| Front Row Crew | frontrowcrew.com forum and community, plus a Facebook group "Front Row Crew (Global)" [web] |
| Pixie Crew | Toy, stationery and backpack brand sold on Toys R Us, Amazon and wholesale sites [web] |
| Pixie Pals | Pixie Pals (Games, Steven Griswold) |
| Park Pals | ParkPals (Social Networking, Aleksandr Titov) |
| Park Club | Park Club (Lifestyle); Park Club (Social Networking) |
| Park Pioneer | parkpioneer.com, a live WDW fan site (earlier report) |
| Pin Pals | Pinpals - Places & Memories (Travel); PinPals Golf |
| Magic Pin | MagicPin: Disney Pin Collector (Entertainment) |
| Magic Track | Magic Track: Theme Park Log (Travel) |
| Magic Day | MagicDay: Disney Park Planner (same niche); Magic Day (period tracker) |
| Magic Club | Magic Club (Education) |
| Magic Wish | Magic Wish (Lifestyle) |
| Magic Show | Magic Show! (Games) |
| Magic League | Magic League (Productivity) |
| Mouse Memo | Mouse Memo Trip Organizer; Mouse Memo Food & Wine |
| Ticket Club | Ticket Club - No Fee Tickets (Entertainment) |
| Ticket Squad | TicketSquad (Entertainment) |
| Gate Crew | GateCrew (Social Networking) |
| Gate Squad | Gate Squad: Army Run (Games) |
| Day Pals | Daypals (Social Networking) |
| Day Crew | DayCrew (Social Networking) |
| Crew Day | CrewDay (two apps) |
| Rope Gang | Rope Gang (Games) |
| Rope Squad | Rope Squad Run (game); a USA Network series (earlier report) |
| Show Club | Show Club (Sports) |
| Crew Show | Crew Show (Utilities) |
| Track Club | TrackClub (Sports) |
| Dex Club | DexClub - TCG Collection (Utilities) |
| The Vault Society | The Vault Society (Games) |
| Team Vault | Team Vault - Gallery Sync (Productivity) |
| Team Pal | TeamPal (Business) |
| Fantasy Squad | Fantasy Squad - FS (Games) |
| Fantasy League | Fantasy League (Sports) |
| Front Row HQ | Front Row HQ (Business) |
| Wish Den | Wishden (Lifestyle) |
| Pin Circle | Pin Circle (Games) |
| Pioneer Camp | PIONEER CAMP (Shopping) |

## 4. Ranked 30 survivors
Scores 1-5 (mine), total /25. V = Voice (like your own words), S = Sound (say-aloud), W = Warmth and nostalgia, F = Fit (crew + planning + Vault + keeping the day), C = Clearance from recorded evidence only (capped at 3 if not web-checked). App Store = plain exact/contains; then `<name> app`, joined, `<name> Disney`, each exact/contains ("0/0" for all four means clean). `.com/.app` = RDAP (free = 404 = unregistered, not a price). Len = characters including spaces; iOS truncates a home-screen label near 11-12. Totals within 1-2 points are not meaningfully different.
| # | Name | V/S/W/F/C | Tot | App Store | Web | .com/.app | Len | Caution |
|---|---|---|---|---|---|---|---|---|
| 1 | Headliner Crew | 5/5/4/4/4 | 22 | 0/0 x4 | No brand; only "headline crew" sweatshirts | free/free | 14 | Plain "Headliner" is a taken app title (earlier report) |
| 2 | Headliner Pals | 5/4/5/4/4 | 22 | 0/0 x4 | No brand (noise) | free/free | 14 | Reads like fans of a performer |
| 3 | Front Row Pals | 5/4/5/4/4 | 22 | 0/0 x4 | No brand (noise) | free/free | 14 | Plain "Front Row" is a taken app title |
| 4 | Headliner Troop | 5/4/4/4/4 | 21 | 0/0 x4 | No brand (military noise) | free/free | 15 | Troop reads Scouts |
| 5 | Front Row Troop | 5/4/4/4/4 | 21 | 0/0 x4 | No brand (game and karate noise) | free/free | 15 | Same |
| 6 | Explorer Crew | 5/5/4/4/3 | 21 | 0/0 x4 | No brand; generic fan-wiki phrase | free/free | 13 | Generic phrase, hard to own |
| 7 | Headliner Lodge | 5/4/4/4/4 | 21 | 0/0 x4 | No brand (noise) | free/free | 15 | Lodge echoes Disney resort lodges |
| 8 | Wish Troop | 4/4/4/4/4 | 20 | 0/0 x4 | No brand (military noise) | taken/free | 10 | `.com` taken; "Wish" is also the Disney cruise ship |
| 9 | Parade Crew | 4/5/4/4/3 | 20 | 0/0 x4 | Disney cast "Parade Crew" jackets and shirts on collector sites | free/free | 11 | Disney cast-member term (fan wink, not a brand) |
| 10 | Queue Pals | 4/5/4/3/4 | 20 | 0/0 x4 | A tiny Steam group named Queue Pals | free/free | 10 | Plain English "queue pal" |
| 11 | Explorer Troop | 4/4/4/4/3 | 19 | 0/0 x4 | Disney Wilderness Explorers use "troop leaders" | free/free | 14 | Disney program echo, not the exact name |
| 12 | Pioneer Troop | 4/4/4/4/3 | 19 | 0/0 x4 | Fictional troop on Disney Channel's Austin & Ally | free/free | 13 | Sounds next to taken parkpioneer.com |
| 13 | Queue Troop | 4/4/3/4/4 | 19 | 0/0 x4 | Strategy-game "queue troop" noise only | free/free | 11 | Reads as a military-game phrase |
| 14 | Finale Pals | 4/4/4/3/4 | 19 | 0/0 x4 | No brand (noise) | free/free | 11 | "Pal" also means a video standard in search |
| 15 | Wish Lodge | 4/4/4/3/4 | 19 | 0/0 x4 | No brand (a game item) | taken/free | 10 | `.com` taken |
| 16 | Wish Porch | 4/4/5/3/3 | 19 | 0/0 x4 | Not web-checked | free/free | 10 | A place, not a group |
| 17 | Front Row Lodge | 5/4/4/3/3 | 19 | 0/0 x4 | Not web-checked | free/free | 15 | |
| 18 | Rope Pals | 4/4/4/3/3 | 18 | 0/0 x4 | WakeFX sells a "Rope Pal" wakeboard tool | free/free | 9 | Close to that product name |
| 19 | The Headliner Society | 4/3/4/4/3 | 18 | 0/0 x4 | Not web-checked | free/free | 21 | Long; formal |
| 20 | Pixie Troop | 4/4/4/3/3 | 18 | 0/0 x4 | Not web-checked | free/free | 11 | Pixie Crew is a toy brand next door |
| 21 | Headliner Gang | 4/4/4/3/3 | 18 | 0/0 x4 | Not web-checked | free/free | 14 | |
| 22 | Pioneer Pals | 4/4/4/3/3 | 18 | 0/0 x4 | A kids' social-skills program at CSU East Bay | free/free | 12 | Same Pioneer crowd as Park Pioneer |
| 23 | Finale Gang | 4/4/3/3/3 | 17 | 0/0 x4 | Not web-checked | free/free | 11 | |
| 24 | The Mouse Society | 4/3/4/3/3 | 17 | 0/0 x4 | Not web-checked | free/free | 17 | Mickey Mouse Club echo |
| 25 | Main Troop | 3/4/3/4/3 | 17 | 0/0 x4 | Not web-checked | free/free | 10 | "Main" alone is vague |
| 26 | Park Troop | 4/4/3/3/3 | 17 | 0/0 x4 | Not web-checked | free/free | 10 | Park is the most crowded word |
| 27 | Folio Pals | 3/4/3/4/3 | 17 | 0/0 x4 | Not web-checked | free/free | 10 | |
| 28 | Queue Gang | 4/4/3/3/3 | 17 | 0/0 x4 | Not web-checked | free/free | 10 | |
| 29 | Headliner & Co | 4/4/3/3/3 | 17 | 0/0 x4 | Not web-checked | free/free | 14 | Shop-style |
| 30 | Mouse Collective | 3/3/3/3/3 | 15 | 0/0 x4 | Not web-checked | free/free | 16 | Formal |
Dropped after evidence: Mouse Pals (podcast), Headliner Club (venue and app), Pixie Crew (toy brand), Pixie Pals (app), Front Row Crew (community; 22-point voice but a real brand, so C=2 and I did not rank it). Rope Crew stays a reference only (clean earlier; Rope Pals is the only new Rope-plus-group name that survived with both domains free and a natural sound).

## 5. Top 12: how they sound
"Join my ___" suits group nouns. "Meet me at ___" is only given for the place noun (Lodge).
| # | Name | Say it | We planned the whole trip on ___ | Join my ___ | Meet me at ___ |
|---|---|---|---|---|---|
| 1 | Headliner Crew | HED-lye-ner KROO | We planned the whole trip on Headliner Crew. | Join my Headliner Crew. (natural) | n/a |
| 2 | Headliner Pals | HED-lye-ner PALZ | We planned the whole trip on Headliner Pals. | Join my Headliner Pals. (fine) | n/a |
| 3 | Front Row Pals | FRUNT ROH PALZ | We planned the whole trip on Front Row Pals. | Join my Front Row Pals. (fine) | n/a |
| 4 | Headliner Troop | HED-lye-ner TROOP | We planned the whole trip on Headliner Troop. | Join my Headliner Troop. (natural) | n/a |
| 5 | Front Row Troop | FRUNT ROH TROOP | We planned the whole trip on Front Row Troop. | Join my Front Row Troop. (natural) | n/a |
| 6 | Explorer Crew | ek-SPLOR-er KROO | We planned the whole trip on Explorer Crew. | Join my Explorer Crew. (natural) | n/a |
| 7 | Headliner Lodge | HED-lye-ner LOJ | We planned the whole trip on Headliner Lodge. | Join my Headliner Lodge. (fine) | Meet me at Headliner Lodge. (natural) |
| 8 | Wish Troop | WISH TROOP | We planned the whole trip on Wish Troop. | Join my Wish Troop. (natural) | n/a |
| 9 | Parade Crew | puh-RAYD KROO | We planned the whole trip on Parade Crew. | Join my Parade Crew. (natural) | n/a |
| 10 | Queue Pals | KYOO PALZ | We planned the whole trip on Queue Pals. | Join my Queue Pals. (fine) | n/a |
| 11 | Explorer Troop | ek-SPLOR-er TROOP | We planned the whole trip on Explorer Troop. | Join my Explorer Troop. (natural) | n/a |
| 12 | Pioneer Troop | py-uh-NEER TROOP | We planned the whole trip on Pioneer Troop. | Join my Pioneer Troop. (natural) | n/a |
- **Read:** every group noun (Crew, Troop, Pals) passes "Join my ___". Crew and Troop sound like a tour group; Pals sounds like friends and is the warmest. "Headliner" is the strongest single word you gave me: a crew named after the main act reads as "we are the main event", which suits a family trip.
- **Best single pick on evidence: Headliner Crew** (22/25). It is the shortest of the three leaders that keeps the app's own word "crew", and it says the product (the travel group) in the name. Its one weakness is that plain "Headliner" is a taken app title, so a subtitle ("Disney trip planner") must carry findability.
- **If you want warmth over structure:** Headliner Pals or Front Row Pals. **If you want a place feeling:** Headliner Lodge.
- **Universal later:** the Headliner and Front Row families are park-neutral, so a Universal app needs no rename.

## 6. What I could not verify
- **USPTO, EUIPO, UKIPO:** not searched. Every ranked name needs a federal search in classes 9, 39, 41 and 42 (and 25 for apparel; "Headliner" and "Crew" are common in apparel). "Front Row", "Headliner" and "Pals" are used widely as marks.
- **Google Play directly:** not searched (no public search API). The Headliner Club Android app surfaced only because a web result listed it.
- **Web coverage:** 24 of 192 shortlisted names were web-checked, mostly with `"<name>" Disney` (not the `travel agent`, `podcast` or social-handle forms). 26 searches; 2 multi-name OR queries returned nothing useful and were discarded. Scripted search was blocked (DuckDuckGo HTTP 202 challenge; Bing returned unrelated results). Names marked "Not web-checked" have C capped at 3, and "No brand found" is weak evidence because the tool is not exact-phrase and is dominated by noise.
- **Registrar status and price, and social handles:** RDAP 404 means unregistered, not available at standard price. Taken `.com` names were not checked for sale. Handles (Instagram, TikTok, X, YouTube) were not looked up.
- **iTunes API:** US only, top 100 results, and it under-reports (earlier reports found real apps it missed). Plain-phrase 0 means "not surfaced". The run slowed for several minutes (apparent throttling) but every query succeeded after retries: 0 errors in all four App Store passes.
- **Scores, "natural" ratings and the Disney-echo calls** (Explorer Troop, Parade Crew, Lodge, The Mouse Society) are mine. Only the App Store results, RDAP results and the named web hits are recorded evidence.
- Nothing was implemented.
