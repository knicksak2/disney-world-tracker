# ParkHQ / Park HQ: clearance and 223 "HQ / base" variants
Read-only. No repo source or .env file was read or changed. Scratch scripts and CSVs are in `%TEMP%\hq` (lib.ps1, s1.ps1, s2.ps1, rdap2.ps1, cands.txt, sc.csv, s2.csv, r1.csv, r2.csv). Not legal advice. Run date 23-24 Nov 2026. **[V]** = seen in an API response, RDAP record or fetched page this session. **[I]** = my inference. "No brand found" means "not surfaced in top results". The search tool is not exact-phrase and `OR` queries return nothing, so web evidence is weak. Step 0: all 22 earlier reports in this folder were checked; every candidate was normalised and text-matched against them (7 already seen: Crew HQ, Crew Hub, Crew Base, Rope Hub, Front Row HQ, The Hub, HQ). Nothing here repeats an earlier favourite.

## 1. Verdict on ParkHQ: **Caution** (leaning away)
The App Store itself is open. The problem is that the name is already used by three live businesses and you could not own either main domain.
1. **App Store (US) is clear [V].** `ParkHQ`, `Park HQ`, `ParkHQ app`, `Park HQ Disney`, `Park Headquarters`, `ParkHQ travel`, `Parks HQ`, `The Park HQ`: 0 exact titles in all 8 queries (74-92 results each). One contains hit: **MParkHQ** (Stockland Corporation, Business, 0 ratings, updated 2026-11-19), a building-amenities app for an Australian office park. Near neighbours: **ParkingHQ US** (ilogs, Navigation, 0 ratings), HqO Park (Business), Park's Tae Kwon Do - HQ. F3 does not trigger. The results page is almost all parking apps (ParkWhiz, ParkNYC, Parkmobile). A Disney user typing "ParkHQ" lands in that.
2. **The `.app` is taken by a live business [V].** `parkhq.app` (registered 2026-05-21, Cloudflare) sells **"ParkHQ: the platform for referral brokerages"** (a real-estate SaaS with an AI chatbot called "Parker"; a Richmond VA agency, sighthoundlabs.co, lists it). Same exact name, different industry, new and small.
3. **The `.com` is a for-sale parked domain [V].** `parkhq.com` was registered 2006-09-30, expires 2027-09-30, nameservers NameBright; it 302-redirects to HugeDomains (their page returned 403 to me, so I have no price). Wayback snapshots 2013-2022 show only a blank "Resources and Information" parked page. It was never a site, so the "construction website" you remember is **not** this domain. `parkshq.com` is also taken and parked at NameBright. `theparkhq.com` is registered (GoDaddy DNS, empty cookie-banner page). `getparkhq.com` and `parkhqapp.com` are free (.com and .app). `parkhq.co` has no DNS records, but I could not run a `.co` RDAP check.
4. **Another ParkHQ is long established, in parking software [V].** **Park Assist launched a "ParkHQ Software Suite" for parking operators in May 2016** (parking.net). Park Assist is part of TKH Group (Euronext-listed, about $1.6B per that release). TKH release notes still mention a "ParkHQ client" [V]. Alongside that, **ParkingHQ®** (parkinghq.com, with a registered-mark symbol) is a parking app and web service. That is two parking brands one letter apart.
5. **Construction: I could not find it.** Searches for "ParkHQ construction" surfaced no brand of that name. The closest are a Park City home-builders app and general construction software, all noise [V]. Your recollection may be a different spelling. The real same-name businesses I found are real-estate (parkhq.app) and parking (Park Assist).
6. **"Park HQ" is generic [V].** It is ordinary English for a park's headquarters (Texas Parks and Wildlife layer names, recreation.gov, trail guides, national park reports). **State Park HQ** (stateparkhq.com) is a live Pennsylvania state-park maps site, and **Theme Park HQ** is a YouTube channel and Instagram account about theme parks (a creator; not Disney-specific) [V, weak]. That second one is a same-niche brand one word away from "Park HQ".

**Legal-style read (once, not advice).** A formal dispute is unlikely: your app is a consumer travel app, theirs are B2B parking and real-estate tools, and no App Store title is identical. Weak spot: all three would sit in class 9 "downloadable software", and ParkHQ in parking is long-standing and owned by a listed group. Trademarkia returned 0 results for "parkhq" [V], but that page may not render USPTO data, so treat it as unverified. What would actually happen: someone searching "ParkHQ" sees parking apps and a real-estate site, you cannot get `parkhq.com` or `parkhq.app`, and you would need a prefixed web address and handle (getparkhq, parkhqapp). The downside is brand and search weakness more than a lawsuit.

## 2. Sound and tone
- "We planned the whole trip on ParkHQ." Works. "Join my ParkHQ." Works for the crew idea. "Meet me at Park HQ." Works, but it reads as a physical place (the park's office, or Disney Parks HQ in the news).
- Label: ParkHQ is 6 characters, "Park HQ" is 7, so no truncation. Park-agnostic: yes, a Universal sibling fits.
- "HQ" says home base and command centre: crew, plan, Vault. It reads a little corporate (a team-dashboard feel like Crew HQ and Front Row HQ, both Business apps) and mildly gaming-clan. It has no Disney warmth on its own. Spelling "ParkHQ" versus "Park HQ" makes no difference to App Store matching (I normalise both to `parkhq`).
- Alternatives that keep the HQ idea but fix the availability: see section 3.

## 3. Variants: what I did
223 names built from your words (Headliner, Rope, Queue, Gate, Explorer, Pioneer, Magic, Main, Mouse, Pal, Day, Crew, Front Row, Park, Wish, Finale, Parade, Pin, Vault, Trip, Castle, Lanyard, Ticket, Pass, Fastpass, Dreamer, Showtime) × 7 forms (`X HQ`, `X Headquarters`, `X Base Camp`, `X Home Base`, `X Command Post`, `X Hub`, `The X HQ`) plus 48 extras. No food words. Space and no-space spellings are the same after normalisation.
- **App Store (iTunes API, US, top 100):** 223 queries run. 23 names had an exact title or contains hit, 200 were clean (5 of those returned zero results). Taken or crowded: Crew HQ, Crew Hub, Crew Base, Front Row HQ (all Business, known), Park HQ (MParkHQ), Park Hub (ParkHub), Pal Hub, Pal Base, Pass Hub, Vault HQ, Vault Hub, Trip HQ, Trip Hub, Ticket Hub, Pass HQ, Day Hub, Day Base, Explorer Hub, Park Base, plus generic HQ, Home Base, Base Camp, The Hub.
- **Second forms** (`<name> app`, joined, `<name> Disney`) on 45 survivors: 135 queries, 1 hit (WishHub, Social Networking, 0 ratings, against Wish Hub). The other 44 are clean on all four forms.
- **RDAP** on 46 domain stems: `.com` free for 18, `.app` free for 39. `.app` taken for gatehq, pioneerhq, dayhq, castlehq, queuehub, magichub, wishhub. Parked stubs (114 bytes) on queuehq.com, palhq.com, pinhq.com, dreamerhq.com [V].
- **Web:** about 20 searches. Conflicts found are below. Things I did not check at all: Instagram/TikTok/X handle availability, Etsy, Google Play search results.
- **Not recommended despite a clean App Store:** **Magic HQ** (magichq.com is a live business platform, "Orlando Magic HQ" is a podcast in the same city), **Wish HQ** (wishhq.com is a live shop, the Wish.com company calls its office "Wish HQ", and Wish is a Disney ship name), **Pioneer HQ** (`.com` and `.app` both taken), **Gate HQ** (an event-accreditation product in Finland), **Castle HQ** and **Day HQ** (both domains taken), **Parade HQ** (parade-committee site owns the .com), **Fastpass HQ** (Disney-owned former product name), **Showtime HQ** (network name), **Vault HQ** (3 contains hits).

### Ranked best 20 (my judgement, not a score)
Clean = 0 exact / 0 contains on the plain query, `<name> app`, joined and `<name> Disney` unless noted. Web = what surfaced; "no brand" means not surfaced.
| # | Name | What it says | App Store | Web | .com / .app | Len | Caution |
|---|---|---|---|---|---|---|---|
| 1 | Rope HQ | Command centre for the early-morning plan | Clean | Noise only (texture packs, rope makers) | free / free | 7 | "Rope" also pulls climbing and rope-art results; earlier report saw this with Rope + social-room words |
| 2 | Park Pal HQ | The crew's park base | Clean | 0 results | free / free | 11 | ParkPals (Social Networking) is a different title, one word away |
| 3 | Park Crew HQ | Crew base for park days | Clean | 0 results | free / free | 12 | "Crew" reads as staff; HQ + Crew sits beside Crew HQ (Business) |
| 4 | Headliner HQ | Star of the show, home base | Clean | Headliner magazine (headlinerhub.com, UK music) says "Headliner HQ" about its office | taken (308 redirect, not followed) / free | 12 | Different niche; `.com` taken |
| 5 | Front Row Hub | Best seats, crew meeting place | Clean | No brand | free / free | 13 | Front Row HQ is a Business title, so near |
| 6 | Pal HQ | Friends' base | Clean | Pora Pal HQ (kids' games), a "The Pal HQ" Discord server | taken (parked) / free | 6 | Very generic, hard to own |
| 7 | Park Day HQ | Where the day is planned | Clean | Not web-checked | free / free | 11 | Park Day is a crowded phrase (earlier reports) |
| 8 | Queue HQ | Wait times and lines | Clean | Noise only | taken (parked) / free | 8 | Generic; `.com` for sale |
| 9 | Mouse House HQ | Press nickname for Disney's offices | Clean | Press uses "Mouse House HQ" for Disney corporate | free / free | 14 | Strong fan wink, but it is a Disney-corporate nickname, so it echoes their brand (F2 risk is low, it is slang) |
| 10 | Mouse HQ | Same, shorter | Clean | mouse.org, a New York education non-profit, uses "Mouse HQ" for its office | taken (site returns 500) / free | 8 | Same Disney echo |
| 11 | Park Base Camp | Starting point for the trip | Clean | Not web-checked | free / free | 14 | Reads outdoorsy |
| 12 | Explorer HQ | Explorer's home | Clean | Explorer HQ, a kids-outdoors company (Wellfound) and a coworking space | taken (404) / free | 11 | Name used by a family-oriented company |
| 13 | Day Trip HQ | One day, one plan | Clean | Not web-checked | taken / free | 11 | Plain phrase, search-heavy |
| 14 | Main Gate HQ | Entrance, home base | Clean | Not web-checked | free / free | 12 | "Main Gate" is a Disney-fan term; close in feel to a name you already rejected |
| 15 | Pin Vault HQ | Where the collection lives | Clean | Not web-checked | free / free | 12 | Only describes the pin feature |
| 16 | Dreamer HQ | Wish and plan | Clean | Not web-checked | taken (parked) / free | 10 | Vague |
| 17 | Main HQ | The main place | Clean | Not web-checked | taken (403) / free | 7 | Too generic |
| 18 | Park Command Post | Crew command point | Clean | Not web-checked | free / free | 17 | Long; truncates on the home screen |
| 19 | Headliner Home Base | Show-stopper's base | Clean | Not web-checked | free / free | 19 | Long |
| 20 | Parade HQ | Parade of the day | Clean | Parade Committee site owns the `.com` | taken / free | 9 | Taken `.com` |

**My pick if you want HQ:** **Rope HQ** has the best availability (both domains free, no brand surfaced, 7 characters) but says only "morning plan". **Park Pal HQ** or **Park Crew HQ** say crew + park and are open everywhere checked, but both are long for a label. None of them beat last round's Headliner Crew, Headliner Pals and Front Row Pals on sound; the HQ forms are more corporate.

## 4. What I could not verify
- **USPTO.** No direct search. Trademarkia returned 0 for "parkhq", which may not reflect real USPTO data. Park Assist's and ilogs' marks (ParkHQ, ParkingHQ®) should be checked in TESS/TSDR before any use.
- **Google Play.** Direct store search was not possible; web search for "ParkHQ" Google Play returned nothing relevant.
- **The price of parkhq.com** (HugeDomains blocked me with 403) and who owns `headlinerhq.com` (it 308-redirects; I did not follow it). Also `.co` and other TLDs beyond `.com` / `.app`.
- **Social handles** (Instagram, TikTok, X, YouTube): fetches returned no readable content, so I know nothing about @parkhq. Etsy and podcasts: not directly searched.
- **The "construction website".** Not found; I may be missing it because search is not exact-phrase.
- **Web checks** for 12 of the top 20 were not run (marked "Not web-checked"). Treat their clearance as untested.
