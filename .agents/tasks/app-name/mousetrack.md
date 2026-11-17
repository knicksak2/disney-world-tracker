# Mousetrack clearance and Mouse-flavoured variants
Read-only. No repo source or .env file touched. Scratch scripts and CSVs are in `%TEMP%\mt`. Not legal advice. Evidence is labelled **[V]** verified (seen in a fetched page or API response) or **[I]** inferred. "No brand found" means not surfaced in the top results (the web tool is not exact-phrase).

## 1. Verdict on Mousetrack: **No-go**
1. **Same-niche exact-name site exists [V].** `mousetrack.co.uk` is live. Its page title is "Mousetrack.co.uk: Find Disney World holiday prices, deals and discounts" and its og:site_name is "Mousetrack". It tracks Disney World hotel, flight and ticket prices. `mousetrack.net` redirects to it. A third-party directory entry (dataforseo) describes it the same way. This is filter F1: a Disney-fan tool with the identical name. It targets UK holidaymakers and does price tracking, not planning, but a Disney World app named Mousetrack would sit next to it in search and in confusion claims.
2. **Disney owns a title with the plural form [V].** "Mickey's Mouse Tracks" (also called "Mouse Tracks") was a Disney Channel anthology series (Wikipedia: 1992-1995; a Disney Channel archive wiki says to 2000). That is filter F2 for "Mouse Tracks" and "MouseTracks". Two fan items use it too: the "Disney Mouse Tracks" podcast on Apple Podcasts and the blog `mousetracks16.blogspot.com`.
3. **App Store is clean, so it hides the problem [V].** Nine query forms (US iTunes API, limit 100) returned zero apps named Mousetrack, Mouse Track(s), MouseTrack(er). The only near hits were computer-mouse utilities (WiFi Mouse, Tracepad) and Gym Mouse. The web, not the store, is where the collision is.
4. **Generic meaning clutter [V].** "MouseTracker" is a free research software package (`mousetracker.org`). A "MouseTrack" Android accessibility app (for people with limited movement) is on Google Play per a mirror page. "Mouse tracking" is a UX-analytics category (Hotjar, Mouseflow, Clarity). A GitHub project `uittorio/mousetrack` exists. Search for the name returns computing pages, not your app.
5. **Domains [V via RDAP].** `mousetrack.com` is registered (a direct fetch returned 403). `mousetrack.app` is unregistered, but the owner of `.com` and `.co.uk` is the Disney tracker. `mousetrackapp.com/.app` and `getmousetrack.com/.app` are unregistered.
- The other strikes against it are minor: it is read as "computer mouse" first, and "track" reads as a ride track. See section 5.

## 2. Quick verdicts on the spellings
| Spelling | App Store (US) | Web | .com / .app | Verdict |
|---|---|---|---|---|
| Mousetrack / Mouse Track | 0 exact | mousetrack.co.uk Disney tracker [V] | reg / free | No-go (F1) |
| Mouse Tracks / MouseTracks | 0 exact | Disney Channel "Mouse Tracks" [V]; podcast; blog | reg / reg | No-go (F2 + F1-ish) |
| MouseTracker / Mouse Tracker | 0 exact (Gym Mouse - Workout Tracker only) | mousetracker.org research tool [V]; near-identical to Mousetrack | reg / free | No-go (near-identical to the F1 brand; reads as a PC tool) |
| Mousetracker app / getmousetrack | 0 exact | nothing extra | free / free | Domain only, does not fix the name |
- The App Store does carry Disney "mouse" apps [V], which corrects the earlier note that mouse names are empty there: MouseWait for Disneyland / Disney World (audio rush, 6,899 ratings), MagicTable and DreamTable "Mouse Watcher", Mouse Times, Mouse Life: Disney Checklist, Mouse Memo Trip Organizer, Countdown To The Mouse, Mouse Bound, and Mousing Around (a Disney park journal). Mouse + Disney is a busy lane. None uses "track".

## 3. Variants: method
51 variants went through the plain App Store query; every zero-exact one then got three more forms (`<name> app`, joined, `<name> Disney`). RDAP was run for `.com` (Verisign) and `.app` (Google registry). 15 got a web check. Three queries returned `ERR` (Crumbtrail, Mouse Steps, Tiptoe Mouse second form), so those are single-form results. Skipped because an earlier report already has them: Mousetrail, Mouse Trail, Mousepath, Mousemap, Mousekin, Mouseling, Mouseversary, Mousecapade, Mouse Squad. Dropped on evidence:
- **Mousetale / Mouse Tale(s):** Mouse Tales Travel (a registered Disney travel agent, "Mouse Tales®") plus David Koenig's "Mouse Tales" books [V]. F1.
- **Mousestep / Mouse Steps:** Mousesteps, a Disney blog and YouTube show since 2007 (mousesteps.com) [V]. F1.
- **Mousepath, Mousehole:** exact App Store games. **Tiny Tracks:** 3 exact apps. **Crumbtrail, Cheese Trail:** both domains registered.
- **Tracks & Tales:** tracksandtales.co is an active listening-bar guide [V]. No mouse flavour either.
- **Mouselog:** Microsoft's `mouselog` GitHub project and mouselog.jp [V]. Dropped.

## 4. Best 15 variants (ranked by fit, then clearance)
App Store = exact/contains over all four query forms (0/0 unless noted). `.com/.app`: RDAP, "free" means 404 (suggests, does not prove, availability). Label = characters including spaces.
| # | Name | Idea | App Store | Web (top results) | .com / .app | Label | Caution |
|---|---|---|---|---|---|---|---|
| 1 | Mouse Whispers | Park tips shared in confidence; "mouse" for Disney | 0/0 | No brand found; Guardian 2019 uses "mouse whisperers" for Disney influencers (descriptive use) | free / free | 14 | Truncates under a home-screen icon; hint of "Horse Whisperer" |
| 2 | Mouse Diary | The visit and food log | 0/0 | No brand found; only Disney journal merchandise | free / free (as `mousediary`) | 11 | Plain; diary sits near Mousing Around [V] (Disney park journal app) |
| 3 | Mousetrot | Brisk walk between rides; playful | 0/0 | No brand found; French nursery rhyme "Dame souris trotte" [V] | free / free | 9 | "Trot" can read as horse or a fitness trot |
| 4 | Tiptoe Mouse | Sneaking in early, quiet feet; the 6 AM reminder | 0/0 | Ty "Tiptoe" mouse Beanie Baby (1999) [V]; no app or travel brand | free / free | 11 | Collectible-toy name nearby (Ty product) |
| 5 | Mousewhisker | Small, whimsical, coined | 0/0 | No brand found | free / free | 12 | Says nothing about trips |
| 6 | Mouse Keepsakes | The Vault and the souvenir log | 0/0 | No brand found | free / free | 15 | Long; narrow fit |
| 7 | Mouse Pawprint | Footprints you leave in the parks | 0/0 | No brand found | free / free | 14 | "Pawprint" reads as a pet product |
| 8 | Mouserail | Monorail plus Mouse | 0/0 | No app found; Disney's "Mickey's Mouseorail" was a street-legal Disney vehicle [V] | free / free | 9 | Disney-vehicle near-miss; ride-only reading |
| 9 | Whisker Trail | Mouse whiskers on a trail; plain "trail" in place of "track" | 0/0 | No brand found | reg / free | 12 | `.com` registered |
| 10 | Mouse Footprints | Same idea as Pawprint, longer | 0/0 | Etsy baby-footprint keepsakes only | free / free (as `mousefootprints`) | 16 | Baby-keepsake tone; truncates |
| 11 | Mousetrek | Trek through the parks | 0/0 | "Mouse Trek" 1967 Bakshi cartoon [V]; no travel brand | reg / free | 10 | Star Trek parody title; `.com` registered |
| 12 | Mousetally | Counting rides and spend | 0/0 | No brand found | reg / free | 10 | "Tally" read cold in earlier taste notes |
| 13 | Mouseprint | Fan twist on "fine print" | 0/0 | No Disney brand found | reg / free | 10 | "Fine print" has a legal tone |
| 14 | Mouse Almanac | Facts and calendar | 0/0 | Not individually searched | free / free | 13 | Earlier reports note "Almanac" scored cold with this user |
| 15 | Mousetune | Park music, Main Street tune | 0/0 | "Mouse Tunes" is used as a Disney news and podcast name on WDWMagic [V]; "Mouseketunes" is a Disney album | free / free | 9 | Closest to F1/F2 of the list |
- **Also checked, parked:** Mousetrax (MouseTraX Mac software, a children's book "Mouse Trax", a DJ; `.com` registered), Mousetrace (`.com` registered, computing meaning), Mousemark, Mousenote (MouseNotes app), Whiskerwise (Whisker Wise Pet Planner), Mouselogbook, Mousefoot, Mousetoes, Little Mouse Trail (17 chars).
- **Honest read:** none keeps the "track" idea and is clean. Mouse Whispers, Mouse Diary and Mousetrot are the only ones that I would call usable. None beats the earlier favourites on warmth.

## 5. Fit of "Mousetrack" itself
- **Length and sound:** 10 letters, two syllables stress on "MOUSE-track". Easy to say and spell once heard. The compound reads as one word.
- **Meaning:** "track" suits logging rides, pins, food and visits, and also reads as a ride track. The fan-slang "Mouse" says Disney immediately, which you prefer.
- **Risk of misreading:** "mouse + track" reads as a PC mouse tracker or pest control "mousetrap" to a new user [I]. The App Store search results for the term are PC mouse utilities [V].
- **Universal later:** it would not work. "Mouse" ties the name to Disney. That conflicts with your plan to add other parks.
- **Official look:** "Mouse Tracks" (Disney Channel) and "Mouseketeer/Mouse Ears/Mickey" are Disney marks or titles. The fan word "mouse" alone is common in fan brands, so it is not blocked in itself.

## 6. Comparison with Magic Explorer and Moseybug
Scores come from earlier reports (Magic Explorer: rerank-and-evocative.md; Moseybug: roots-and-invented.md). Mousetrack and Mouse Whispers are scored here on the same four axes, 1 to 5.
| Name | Sound | Fit | Disney feeling | Clearance | Notes |
|---|---|---|---|---|---|
| Magic Explorer | 4 | 3 | 4 | 3 | No exact brand; crowded "Magic ___" prefix (Magic Navigator, Magic Atlas); 14 chars; `.com` resale |
| Moseybug | 4 | 4 | 4 | 5 | 0 App Store hits; only one web search; `.com`/`.app` free; "bug" review jokes; works for Universal |
| Mousetrack | 4 | 4 | 5 | 1 | Strongest Disney tie; exact same-niche site plus a Disney Channel title; No-go |
| Mouse Whispers (best variant) | 3 | 3 | 4 | 4 | Free domains; 14 chars; Disney-only; no strong fit to features |
- **Moseybug is still clearly ahead of every Mouse variant** for clearance and for adding Universal later. Mousetrack wins only on instant Disney feeling.

## 7. What I could not verify
- **USPTO and state trademarks:** not searched. Check classes 9, 39, 41, 42, for whichever variant you move forward with.
- **Google Play directly:** web search only. One "MouseTrack" Android accessibility listing was seen via a mirror page.
- **Registrar status:** RDAP only. `mousetrack.com` returned 403 on a direct fetch, so its live content is unseen; its owner and whether `mousetrack.co.uk` is related to it are not known.
- **mousetrack.co.uk content:** the page is JavaScript-rendered. I read its title and meta tags, not its full text.
- **App Store API under-reports:** all "0 exact" results are weak evidence. Three queries errored (see section 3).
- **Social handles, Etsy shops, agents:** only what surfaced in top results.

## 8. Recommendation
- Drop Mousetrack in all spellings. The cleanest answer for the user is: no, it collides with a live Disney World price tracker called Mousetrack (and the plural with a Disney Channel show).
- If the user wants to stay in the Mouse lane, test **Mouse Whispers** or **Mouse Diary**, and keep **Moseybug** as the Universal-safe option. Run a USPTO search on whichever is chosen before paying for the developer account.
- Nothing was implemented.
