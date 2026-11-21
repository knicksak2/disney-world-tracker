# Crew / group names and collector names: screening report
Read-only. No repo source and no .env file was touched. Scratch scripts and CSVs are in `%TEMP%\cc` (screen.ps1, screen4.ps1, dom.ps1, part1.csv, part2.csv, s_app.csv, s_join.csv, f_dis.csv, f_pin.csv, dom.csv). Not legal advice. **[V]** = seen in an API response or search result this session. **[I]** = my inference. "No brand found" means "not surfaced in top results". The web tool is not exact-phrase and returns mostly noise, so web evidence is weak. Web content was paraphrased, not quoted.
Step 0: all 18 earlier reports were read (collection-and-verb-names.md and track-family.md in full; the other 16 were checked by a normalized text match against every candidate). 43 names that already appear in them were skipped (e.g. Merry Crew, Lantern Crew, Wonder Crew, Penny Crew, Standby Crew, Pin Trader, Cork and Co).

## 1. Summary answer
- **"Crew" is a good direction for this app. "Collector" is a weak one.** The app itself calls the travel group a crew, so `<Flavor> Crew` names say the main feature in the user's own word, they are warm, and they sound like the user's taste anchors (Park Pal, Rope Drop, Front Row). A collector word says "pins only" (the Vault), sounds like a hobbyist or an adult shop, and the fan niche already uses it heavily: pincollector.com, the quarterly PinTradingCollector.com magazine, Digital Pin Club and Pin Insiders all exist [V]. "Lanyard Collector" and "Stub Collector" are also plain product words on Etsy and Amazon [V], so nothing is ownable.
- **Flavor words that work (short, common, Disney-fan wink, no Disney mark):** Rope (rope drop and the 6 AM window), Lanyard, Churro, Stroller, Stub, Pocket, Merry. Flavors that failed: Pin (Pin Club, Pin Pals, PinPal, Pin Parade all exist), Penny, Snack (Disney apparel uses "Snacks Crew"), Happy, Lucky (generic app names), Monorail, Early Bird.
- **App Store (iTunes API, US, top 100) is not the filter here.** Only 101 of 936 names had an exact hit (11%). The real filter is the web: Disney-owned product names (Lanyard Lane, Pin Club) and same-niche brands. The API under-reports (earlier reports found it missed real apps), so 0 means "not surfaced".
- **Counts:** 936 names tried (Part 1: 367 crew/group, Part 2: 569 collector). 43 already seen in earlier reports. 101 exact hits (Part 1: 36, Part 2: 65). 804 first-pass survivors (zero exact, not previously seen). 128 shortlisted by voice and given `<name> app` and joined-form queries (0 new exact hits; only SwapDay joined). 52 finalists got `<name> Disney` and `<name> pin` queries (0 exact hits; contains: Trade Day 1, Rope Squad 1). About 30 web searches covered about 30 names. 128 RDAP pairs.
- **Best survivors:** Rope Crew, Lanyard Crew, Churro Gang, Stroller Crew, Pocket Magpie, Merry Magpie, Lanyard Pals, Lanyard Days, The Churro Society.
- **Honest caution:** these are common phrases. Clean on the App Store means "nobody uses this exact title", not "ownable". A crew-style name needs a distinctive icon and a subtitle ("Disney trip planner") to be findable.

## 2. Taken or conflicted natural names (what uses each)
Exact App Store titles are from the iTunes API [V]. Web entries are from search results [V].
| Name | What uses it |
|---|---|
| Pin Collector | pincollector.com, "a home for pin collectors" [V] |
| Pin Trading Collector | PinTradingCollector.com, a quarterly pin magazine, $18.99 per issue [V] |
| Pin Club | pinclub.shop (licensed enamel pin brand, sold at Target); also Disney's Millennium Pin Club and "Mickey Mouse Pin Club" pin [V] (F1 and F2) |
| Lanyard Lane | Disney "Trade City" pin named "Lanyard Lane Spotlight" [V] (F2) |
| Monorail Club | echoes Disney's Monorail Club Car lounge at the Contemporary [V] (F2 echo) |
| Swap Shop | Netflix series about collectors, named Swap Shop [V] (adjacent F1) |
| Early Bird Club | earlybird.club (Android news site) and Earlybirds Club (dance parties) [V] |
| Rope Squad | USA Network series, and an iOS game "Rope Squad Run" [V] |
| Snack Crew | Disney "Snacks Crew" sweatshirts at Kohl's [V] (Disney merchandise echo) |
| Pass Holder / Passholder Club | Disney's own Annual Passholder program wording [V] (F2 echo) |
| Pack Up | Packup - Trip Planning; PackUp - Trip Packing List (same niche) |
| Crew Up | Crew Up and CrewUp apps |
| Crewed Up | one letter from Crew Up (near-identical, dropped) |
| Our Crew, My Crew | Our Crew; MyCrew |
| Whole Crew, Good Crew | Whole Crew; The Good Crew |
| Spirit Crew, First Crew | Spirit Crew; The First Crew (dance studio) |
| Popcorn Crew, Rally Crew | PopcornCrew; RallyCrew |
| Crew Plan | CrewPlan: Group Organizer (same niche) |
| Crew Day / Crew Days | CrewDay (daily report log); Crew Days: SED & Schengen |
| Crew Call, Crewing | Crew Call; CrewCall: Skilled Trades; Crewing |
| Crew Pin | CrewPin: Crew Time Clock |
| Team Up, Gang Up, Huddle Up | TeamUp; Gang Up!; Huddle Up: Ultimate Group Fun |
| Squad Goals, The Fam, Fam Jam | Squad-Goals; TheFam; Famjam |
| Snack Pack, Happy Pack | SnackPack; Happy Pack |
| Pin Parade | PinParade |
| Ticket Club, Ticket Squad | Ticket Club - No Fee Tickets; TicketSquad |
| Happy Club, Lucky Club | Happy Club; Lucky Club |
| Carousel Club | Carousel Club; Carousel Club: Vinyl Companion |
| Rope Gang | Rope Gang |
| Ticket Collector, Sticker Collector | Ticket Collector; Sticker Collector |
| Collectors Club | three apps with that title |
| Magpie | Magpie App, Magpie: Save Now. Work Later. and others (Magpie alone is gone) |
| Penny Hoarder | The Penny Hoarder (large personal-finance brand) |
| Stub Keeper, Ticket Keeper | StubKeeper: Receipt & Warranty; Ticketkeeper |
| Day Keeper, Joy Keeper, Badge Keeper | DayKeeper; JoyKeeper - Mood Diary; BadgeKeeper |
| Pin Seeker | Pin Seeker (exact) |
| Pin Trove, Day Trove, Tiny Trove | PinTrove: Favorite Places Map; DayTrove; TinyTrove: Private Diary |
| Pocket Curio | Pocket Curio: Souvenir Journal (souvenir niche) |
| Badge Box, Button Box, Stamp Club | BadgeBox; Button Box; Stamp Club |
| Sticker Stash, Memento Jar, Trinket Shelf | each an exact title |
| Find & Keep, Lucky Finds, Little Finds | each an exact title |
| Treasure Trail, Gathered Days | Treasure Trail; Gathered Days: Journal & Notes |
| Collect & Keep, Collect Joy, Collect Moments | each an exact title |
| Stamp Days, Stamp Log | Stamp Days: Country Tracker; StampLog |
| Lantern Company, Snack Society | Lantern Company: Roguelike; Snack Society: Cozy Match 3 |
| Token Swap, Swap Meet, Swap Spot | TokenSwap; The Swap Meet App; SwapSpot |

## 3. Ranked 40 survivors
Scores 1-5 (5 best), total /25. V = Voice (short, common, concrete, friendly, like the user's own ideas). S = Sound (say-aloud ease). W = Warmth and nostalgia. F = Fit (crew, pin collecting and the whole app). C = Clearance from recorded evidence only, capped at 3 if not web-checked (`w:n`). App Store = plain exact/contains, then `app`, joined, `Disney`, `pin` forms ("0/0 x5" means plain, `app`, joined, `Disney` and `pin` forms all clean; a smaller x means only that many forms were run or completed, so x2 = plain and `app`/joined only). Rows are ordered by judgment, with the first 15 roughly by total; totals within 1-2 points are not meaningfully different. `.com/.app` from RDAP (free = 404 = unregistered, not a price). Len = characters including spaces; iOS truncates a home-screen label near 11-12.
| # | Name | What it says | V/S/W/F/C | Tot | App Store | Web | .com/.app | Len | Caution |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Rope Crew | Early-arrival crew (rope drop, 6 AM window) | 5/5/4/4/4 | 22 | 0/0 x5 | No brand; only rope-supply job ads | free/free | 9 | "Rope" also industrial; matches Rope Drop wording used by every Disney blog |
| 2 | Lanyard Crew | Crew plus pin trading | 4/4/4/5/3 | 20 | 0/0 x5 | TikTok greeting "lanyard crew" and a Motorworld merch line; no brand | taken/free | 12 | `.com` taken; pin-leaning |
| 3 | Churro Gang | Friendly food-fan crew | 4/5/5/3/3 | 20 | 0/0 x4 | A Twitch streamer "President of the Churro Gang"; churrosgang.com (French apparel) | free/free | 11 | Apparel brand one letter away (Churros Gang) |
| 4 | Stroller Crew | The family trip crew | 4/5/4/3/3 | 19 | 0/0 x4 | A Greek skate crew called Stroller; a hiking-for-caregivers flyer | free/free | 13 | Reads as parents only |
| 5 | Pocket Magpie | Little collector of trip treasures | 3/4/4/4/4 | 19 | 0/0 x4 | w:n | free/free | 13 | "Magpie" is a literary-ish word; Magpie app titles exist alone |
| 6 | Merry Magpie | Cheerful collector | 4/4/4/4/3 | 19 | 0/0 x5 | No brand; a forum user and a 1940 comic [V] | taken/free | 12 | `.com` taken; Magpie alone is a taken app title |
| 7 | Lanyard Pals | Friends who trade pins | 4/4/4/4/3 | 19 | 0/0 x4 | No brand; eBay lanyard lots | free/free | 12 | Close to Pin Pals (taken) in feel |
| 8 | Lanyard Days | Days kept on a lanyard | 4/4/4/4/3 | 19 | 0/0 x5 | No brand | free/free | 12 | Pin-leaning; "Lanyard Lane" is Disney |
| 9 | The Churro Society | A club of snack fans | 4/3/5/3/4 | 19 | 0/0 x4 | No brand (Pancho's "Anti-Churro Churro Club" is a bakery) | free/free | 17 | Long; "Society" is formal |
| 10 | Magpie Days | Collected days | 3/4/4/4/3 | 18 | 0/0 x5 | No brand in niche; an essay and game trophy text | taken/free | 11 | `.com` taken |
| 11 | Stub Crew | Ticket-stub keeping crew | 3/4/3/3/4 | 17 | 0/0 x5 | No brand found | free/free | 9 | Ticket-stub niche is small |
| 12 | Crew Along | "Come along" for the crew | 3/4/3/3/4 | 17 | 0/0 x4 | w:n | free/free | 10 | Verb phrase; sounds like a prompt |
| 13 | Magpie Pins | Pin collector | 3/4/3/3/4 | 17 | 0/0 x2 | w:n | free/free | 10 | Pins only |
| 14 | The Rope Society | Early-bird club | 4/3/3/3/4 | 17 | 0/0 x4 | No brand | free/free | 16 | Long; formal |
| 15 | Team Churro | Snack team | 3/4/4/3/3 | 17 | 0/0 x4 | w:n | free/free | 11 | Sports-team feel |
| 16 | Churro & Co | Friendly shop-style brand | 4/4/4/3/3 | 18 | 0/0 x4 | w:n | taken/free | 10 | `.com` taken; "& Co" suggests a shop |
| 17 | Treasure Days | Collected days | 3/4/4/3/3 | 17 | 0/0 x3 | w:n | taken/free | 13 | Generic |
| 18 | Rope Club | Early-bird club | 4/5/3/3/3 | 18 | 0/0 x3 | w:n | taken/free | 9 | `.com` taken; generic |
| 19 | Pin Curator | Collector curating pins | 3/4/3/4/3 | 17 | 0/0 x3 | w:n | taken/free | 11 | Pin-only |
| 20 | Souvenir Keeper | Keeps your souvenirs | 3/3/3/4/3 | 16 | 0/0 x4 | w:n | free/free | 15 | Souvenir niche (Pocket Curio) |
| 21 | Moment Keeper | Keeps your moments | 3/4/3/4/3 | 17 | 0/0 x3 | w:n | taken/free | 13 | Generic; Joy/Day Keeper exist |
| 22 | Cork Keeper | Cork-board Vault | 3/4/3/4/3 | 17 | 0/0 x3 | w:n | taken/free | 11 | Reads as a cork product |
| 23 | Lanyard Trove | Hoard of pins | 3/3/3/4/3 | 16 | 0/0 x3 | w:n | free/free | 13 | Pin Trove, Tiny Trove, Day Trove exist |
| 24 | Tiny Collectors | Small collectors | 3/4/3/4/3 | 17 | 0/0 x3 | w:n | free/free | 15 | Reads as kids' toys |
| 25 | Little Collectors | Small collectors | 3/4/3/4/2 | 16 | 0/0 x3 | Little People "Collector" toy lines [V] | taken/free | 17 | Toy-line noise; long |
| 26 | Collect the Days | Collect each day | 3/4/3/4/3 | 17 | 0/1 (contains), 0/0 x3 | w:n | free/free | 16 | Long; command phrase |
| 27 | Collect Days | Same | 3/4/3/3/3 | 16 | 0/0 x4 | w:n | free/free | 12 | Vague |
| 28 | Swap and Keep | Trade and hold | 3/3/3/4/3 | 16 | 0/0 x3 | w:n | free/free | 13 | Command phrase |
| 29 | Trade and Keep | Same | 3/3/3/4/3 | 16 | 0/0 x4 | w:n | taken/free | 14 | Same |
| 30 | Pin Swapper | Pin trader | 3/3/3/4/3 | 16 | 0/0 x3 | w:n | taken/free | 11 | Narrow |
| 31 | Queue Crew | Waiting-line crew | 3/4/3/3/3 | 16 | 0/0 x3 | w:n | taken/free | 10 | Queue Crew vs "queue" apps |
| 32 | Trolley Club | Nostalgic transport club | 3/4/4/3/3 | 17 | 0/0 x3, Disney form errored | w:n | taken/free | 12 | Disney trolley echo [I] |
| 33 | Day Haul | Today's finds | 3/4/3/3/3 | 16 | 0/0 x4 | w:n | taken/taken | 8 | Shopping-haul reading |
| 34 | Todays Haul | Same | 3/4/3/3/3 | 16 | 0/0 x2 | w:n | taken/free | 10 | Same |
| 35 | Magpie Club | Collector club | 3/4/3/3/3 | 16 | 0/0 x2 | w:n | taken/free | 10 | `.com` taken |
| 36 | Magpie & Co | Shop-style | 3/3/3/3/3 | 15 | 0/0 x2 | w:n | taken/free | 11 | Disney form errored |
| 37 | Lucky Magpie | Collector with luck | 3/4/3/3/3 | 16 | 0/0 x2 | w:n | taken/free | 12 | Generic lucky wording |
| 38 | Lantern & Co | Soft shop-style | 3/3/3/2/3 | 14 | 0/0 x4 | Noise only | taken/free | 12 | Tangled echo [I]; not on Fit |
| 39 | Stub & Co | Ticket shop-style | 3/3/3/3/3 | 15 | 0/0 x2 | w:n | taken/free | 9 | `.com` taken |
| 40 | Pin & Co | Pin shop-style | 3/4/3/3/3 | 16 | 0/0 x2 | w:n | taken/free | 8 | Pin crowd |

Dropped after web or API evidence (not in the table): Pin Club, Lanyard Lane, Monorail Club, Swap Shop, Snack Crew, Rope Squad, Pins and Pals (too close to Pin Pals), Passholder Club, Crewed Up, Early Bird Club, Swap Day (`.com` and `.app` both taken, and Swap Day is also a retail promotion name [V]).

## 4. Top 12: how they sound
Phonetic guide in capitals. The two sentences are the test the user asked for.
| # | Name | Say it | "We planned the whole trip on ___" | "Join my ___" |
|---|---|---|---|---|
| 1 | Rope Crew | ROHP KROO | We planned the whole trip on Rope Crew. | Join my Rope Crew. |
| 2 | Lanyard Crew | LAN-yerd KROO | We planned the whole trip on Lanyard Crew. | Join my Lanyard Crew. |
| 3 | Churro Gang | CHUR-oh GANG | We planned the whole trip on Churro Gang. | Join my Churro Gang. |
| 4 | Stroller Crew | STROH-ler KROO | We planned the whole trip on Stroller Crew. | Join my Stroller Crew. |
| 5 | Pocket Magpie | POCK-it MAG-pie | We planned the whole trip on Pocket Magpie. | Add you to my Pocket Magpie. (awkward) |
| 6 | Merry Magpie | MEH-ree MAG-pie | We planned the whole trip on Merry Magpie. | Add you to my Merry Magpie. (awkward) |
| 7 | Lanyard Pals | LAN-yerd PALZ | We planned the whole trip on Lanyard Pals. | Join my Lanyard Pals. |
| 8 | Lanyard Days | LAN-yerd DAYZ | We planned the whole trip on Lanyard Days. | Add you to my Lanyard Days. (awkward) |
| 9 | The Churro Society | thuh CHUR-oh suh-SY-uh-tee | We planned the whole trip on The Churro Society. | Join my Churro Society. |
| 10 | Magpie Days | MAG-pie DAYZ | We planned the whole trip on Magpie Days. | Add you to my Magpie Days. (awkward) |
| 11 | Stub Crew | STUB KROO | We planned the whole trip on Stub Crew. | Join my Stub Crew. |
| 12 | Crew Along | KROO uh-LONG | We planned the whole trip on Crew Along. | Come Crew Along with me. ("Join my" does not fit) |
- **Read:** the "Crew" and "Gang" names pass both sentences cleanly ("Join my Rope Crew" is a real invitation). The Magpie names pass the first sentence but fail the second, because a magpie is a collector, not a group. That is the structural reason crew names beat collector names for an app whose main verb is "join".

## 5. What this does and does not say
- **Best single pick on evidence:** Rope Crew (22/25). It is clean on every App Store form and both domains, no brand surfaced, and it keeps the Disney-fan wink (rope drop) in the user's own "crew" word. Its weakness is genericness. Rope Crew alone says "early-risers" and carries no pins or food hint, so the icon and subtitle must carry that.
- **Lanyard Crew and Lanyard Pals** are the best names that cover pins and the crew together, but "Lanyard" leans toward pin trading, and `Lanyard Crew .com` is taken.
- **If the user wants a collector word anyway:** Pocket Magpie or Merry Magpie are the only ones that read as friendly and survive the checks, but both fail "Join my ___" and "Magpie" is the sort of literary word the user said felt off-voice. I would not lead with them.
- **Churro Gang** has the strongest warmth and sound, but it sits one letter from an apparel brand (churrosgang.com).

## 6. What I could not verify
- **USPTO, EUIPO, UKIPO:** not searched. Every name in section 3 needs a federal search in classes 9, 39, 41 and 42 (and 25 for apparel, given Churro Gang and Snack Crew).
- **Google Play directly:** not searched; web snippets only.
- **Registrar status and price:** RDAP 404 means unregistered, not available at standard price. Taken `.com` names were not checked for for-sale status.
- **Web checks:** about 30 searches covered about 30 names. Most are marked `w:n` (C capped at 3). The search tool is not exact-phrase and returned heavy noise for short common phrases, so "no brand found" is weak evidence.
- **iTunes API:** US only, top 100 results, under-reports, and throttled me with 403 errors in several runs. Not completed after one retry: `Trolley Club Disney`, `Magpie and Co Disney`, `Swap Day Disney`, `Rope and Co pin`, `Little Collectors pin`. Everything else in the table has a clean (non-error) result for each form shown.
- **Scores and Disney-mark judgments** (Trolley Club, Lantern & Co, Snack Crew) are mine. Only the App Store results, RDAP results and the named web hits are recorded evidence.
- Nothing was implemented.
