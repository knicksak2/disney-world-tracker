# Pin Motif Provenance

Every motif used on a pin must have a row here before it ships. This file is the
audit trail for the CC BY attribution obligation and for the "we own or are
licensed for every asset" claim.

## Attribution required in-app

The app must show an **Art credits** row (Profile → Art credits) listing every line below.
CC BY obliges us to name the **author**, not just the library, so each author is listed:

> Icons by Lorc, Delapouite, Skoll and Cathelineau — game-icons.net — CC BY 3.0
>
> Icon by Atisa — Boxicons — CC BY 4.0
>
> Icon by JoyPixels / EmojiOne — emojione.com — CC BY 4.0
>
> Icon by Font Awesome — fontawesome.com — CC BY 4.0
>
> Icons from Temaki by Bryan Housel & OpenStreetMap contributors — CC0 1.0
>
> Icons by Google — Material Symbols — Apache 2.0
>
> Emoji by Twitter — Twemoji — CC BY 4.0
>
> Icon by Kenan Gündoğan — Fontisto — MIT

CC BY 3.0 and 4.0 require attribution only — there is **no** share-alike obligation, so the
application itself remains proprietary. CC0 1.0 is a public-domain dedication and obliges
nothing; the Temaki line is courtesy, not a requirement. Motifs marked *Project Original* are
ours outright and owe no attribution.

`verify/provenance.js` asserts this block names every author, source and licence **version**
carried by a motif the catalogue actually renders. An earlier version of that check only looked
for the token "CC BY" — which "CC BY 3.0" satisfied, while a Boxicons asset under CC BY 4.0 sat
uncredited and three game-icons co-authors went unnamed.

## Files

| File | Author | Source | Licence | Used for |
|---|---|---|---|---|
| `disney-guidemap.path` | Project Original (Disney App Team) | disney-app | Proprietary | The Legendary Disney Guide (prism_legendary_guide) — 3-panel accordion Walt Disney World park guidemap with Cinderella Castle crest and Mickey location marker |
| `castle.svg` | Lorc | game-icons.net | CC BY 3.0 | Park conquest (generic fairy-tale castle) |
| `carouselHorse.svg` | JoyPixels / EmojiOne | emojione.com | CC BY 4.0 | Gentle Soul (leaping carousel horse on brass pole) |
| `crown.svg` | Lorc | game-icons.net | CC BY 3.0 | Mythic / all-parks completion |
| `cut-diamond.svg` | Lorc | game-icons.net | CC BY 3.0 | Collection-count gem |
| `flat-star.svg` | Lorc | game-icons.net | CC BY 3.0 | Interest mastery |
| `trophy.svg` | Lorc | game-icons.net | CC BY 3.0 | Leaderboard / social |
| `compass.svg` | Lorc | game-icons.net | CC BY 3.0 | Explorer |
| `stopwatch.svg` | Lorc | game-icons.net | CC BY 3.0 | Rope drop / streaks |
| `high-five.svg` | Lorc | game-icons.net | CC BY 3.0 | Friends |
| `roast-chicken.svg` | Lorc | game-icons.net | CC BY 3.0 | Snacks & dining |
| `firework-rocket.svg` | Lorc | game-icons.net | CC BY 3.0 | Nighttime spectaculars |
| `magic-lamp.svg` | Lorc | game-icons.net | CC BY 3.0 | Fantasyland / Aladdin / Wishes |
| `fairy-wand.svg` | Lorc | game-icons.net | CC BY 3.0 | Fantasyland Starter / Magic |
| `fairy-wand-halo.path` | Lorc | game-icons.net `fairy-wand.svg` — **derived**: 2 of 7 cells dropped (2 sparkles 30-36px from the star at render size, too far for any reasonable weld to bridge), keeping the shaft+star+4 near sparkles, welded into one real outline stroked at an 8px halo rim (vs the gold-tier 6.2px default) via `renderColorDieCut`; the outline is its own single continuous subpath (no connectivity ambiguity) and its bbox spans the full motif, confirmed to wrap all 5 kept cells rather than a sub-region | CC BY 3.0 | Fantasyland 100% (v2, `gold_land_fantasyland`) |
| `scroll-unfurled.svg` | Lorc | game-icons.net | CC BY 3.0 | Liberty Square / Historic Scroll |
| `locked-chest.svg` | Lorc | game-icons.net | CC BY 3.0 | Adventureland / Pirates Dead Man's Chest |
| `anchor.svg` | Lorc | game-icons.net | CC BY 3.0 | Adventureland / Nautical |
| `ghost.svg` | Lorc | game-icons.net | CC BY 3.0 | Haunted Mansion / Dark Rides |
| `tombstone.svg` | Lorc | game-icons.net | CC BY 3.0 | Spooky / Historic Dark Rides |
| `lantern-flame.svg` | Lorc | game-icons.net | CC BY 3.0 | Tangled / Rapunzel Lanterns |
| `volcano.svg` | Lorc | game-icons.net | CC BY 3.0 | Mount Everest Expedition / Forbidden Mountain |
| `steam-locomotive.svg` | Delapouite | game-icons.net | CC BY 3.0 | Frontierland Starter / WDW Railroad |
| `pirate-flag.svg` | Delapouite | game-icons.net | CC BY 3.0 | Adventureland Starter / Pirates |
| `subway.svg` | Delapouite | game-icons.net | CC BY 3.0 | Rail & Transit Enthusiast / Monorail |
| `windmill.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Showcase / Norway / UK |
| `pagoda.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Showcase / Japan / China |
| `mayan-pyramid.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Showcase / Mexico Pavilion |
| `coliseum.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Showcase / Italy Pavilion |
| `trumpet-flag.svg` | Delapouite | game-icons.net | CC BY 3.0 | Parade Watcher (fanfare trumpet with heraldic pennant; adapted to continuous pipe & flush banner for 1-piece die-cut) |
| `trumpet-flag.path` | Delapouite / Project Derived | game-icons.net | CC BY 3.0 | Parade Watcher (single-piece die-cut fanfare trumpet & flush pennant) |
| `theater-curtains-stage.path` | Delapouite / Project Derived | game-icons.net | CC BY 3.0 | Show Devotee (grand stage proscenium with recessed solo spotlight) |
| `plant-seed.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Nature / Journey of Water |
| `submarine.svg` | Delapouite | game-icons.net | CC BY 3.0 | The Seas with Nemo & Friends |
| `aquarium.svg` | Delapouite | game-icons.net | CC BY 3.0 | The Seas Pavilion |
| `ray-gun.svg` | Lorc | game-icons.net | CC BY 3.0 | Buzz Lightyear Space Ranger Spin / Target Blaster |
| `laser-sparks.svg` | Lorc | game-icons.net | CC BY 3.0 | Star Wars Blasters / Galaxy's Edge 100% |
| `alien-stare.svg` | Lorc | game-icons.net | CC BY 3.0 | Toy Story Land 100% / Little Green Men |
| `dinosaur-rex.svg` | Lorc | game-icons.net | CC BY 3.0 | DinoLand 100% / DINOSAUR T-Rex |
| `dinosaur-bones.svg` | Lorc | game-icons.net | CC BY 3.0 | The Boneyard Fossil Dig |
| `dinosaur-egg.svg` | Lorc | game-icons.net | CC BY 3.0 | Dino Starter / Dinosaur Hatchling |
| `lion.svg` | Lorc | game-icons.net | CC BY 3.0 | Africa 100% / Festival of the Lion King |
| `monkey.svg` | Lorc | game-icons.net | CC BY 3.0 | Africa Safari Scout / Gorilla Falls Primates |
| `ice-cream-cone.svg` | Delapouite | game-icons.net | CC BY 3.0 | Disney Snacks / Character Dining Treats |
| `pizza-slice.svg` | Delapouite | game-icons.net | CC BY 3.0 | Quick Service Dining / Pizza Ponte |
| `hot-dog.svg` | Delapouite | game-icons.net | CC BY 3.0 | Casey's Corner / First Disney Meal |
| `pretzel.svg` | Delapouite | game-icons.net | CC BY 3.0 | Mickey Pretzels / Culinary Traveler |
| `cupcake.svg` | Delapouite | game-icons.net | CC BY 3.0 | Disney Bakery Specialties |
| `coffee-cup.svg` | Delapouite | game-icons.net | CC BY 3.0 | Joffrey's Coffee / Character Dining Trio |
| `beer-bottle.svg` | Delapouite | game-icons.net | CC BY 3.0 | Oga's Cantina / World Showcase Drinks |
| `fork-knife-spoon.svg` | Delapouite | game-icons.net | CC BY 3.0 | Table Service Dining Connoisseur |
| `chef-toque.svg` | Delapouite | game-icons.net | CC BY 3.0 | Signature Dining / Executive Chef |
| `placemat-meal.path` | Delapouite / Project Derived | game-icons.net | CC BY 3.0 | Character Dining Trio (rounded placemat with plate, knife, and fork) |
| `glass-celebration.path` | Delapouite / Project Derived | game-icons.net | CC BY 3.0 | Signature Connoisseur (crystal toast celebration flutes) |
| `balloons.svg` | Lorc | game-icons.net | CC BY 3.0 | Squad Companion (15 Group Rides) |
| `bus.svg` | Delapouite | game-icons.net | CC BY 3.0 | Two Parks in One Day |
| `compass-rose.svg` | Lorc | game-icons.net | CC BY 3.0 | All 20 Lands Explorer |
| `direction-signs.svg` | Delapouite | game-icons.net | CC BY 3.0 | Trip Coordinator (3 Trips) |
| `domino-mask.svg` | Lorc | game-icons.net | CC BY 3.0 | Character Trio (3 Meets) |
| `film-spool.svg` | Delapouite | game-icons.net | CC BY 3.0 | Circle-Vision 360 Explorer |
| `flamingo.svg` | Delapouite | game-icons.net | CC BY 3.0 | Discovery Island Complete (+2 more) |
| `hourglass.svg` | Lorc | game-icons.net | CC BY 3.0 | 12-Ride Single Day Challenge |
| `megaphone.svg` | Delapouite | game-icons.net | CC BY 3.0 | Active Reviewer (25 Reviews) |
| `microphone.svg` | Delapouite | game-icons.net | CC BY 3.0 | Comedy & Laughs |
| `padlock.svg` | Lorc | game-icons.net | CC BY 3.0 | Locked state indicator |
| `bell-concierge.svg` | Font Awesome | fontawesome.com | CC BY 4.0 | Resort Voyager (12 Resorts) |
| `grand-deluxe-seal.svg` | Project Original | disney-app — original vector art | Project Original | Grand Deluxe Seal (`pearl_deluxe_royalty`) |
| `passport.svg` | Delapouite | game-icons.net | CC BY 3.0 | The Global Ambassador |
| `peaks.svg` | Lorc | game-icons.net | CC BY 3.0 | Triple Mountain Conqueror |
| `pocket-watch.svg` | Skoll | game-icons.net | CC BY 3.0 | 1971 Heritage Club |
| `queen-crown.svg` | Lorc | game-icons.net | CC BY 3.0 | All Princesses (imperial royal crown) |
| `quill.svg` | Lorc | game-icons.net | CC BY 3.0 | The Ultimate Critic |
| `galleon.svg` | Lorc | game-icons.net | CC BY 3.0 | Dark Ride Master (Peter Pan's Flight / Pirates full-rigged galleon) |
| `the-living-storybook.path` | Project Original | disney-app — original vector art | Project Original | Character Royalty (culmination of 5-stage character meet progression) |
| `teacup.path` | Project Original (AI-authored) | disney-app — hand-authored `renderColorDieCut` branch | Project Original | Spin Cycle (Mad Tea Party cloisonné teacup — pedestal saucer, swirling flutes) |
| `magic-carpet.path` | Project Original (AI-authored) | disney-app — hand-authored `renderColorDieCut` branch | Project Original | Dizzy Devotee (Adventureland magic-carpet aerial spinner) |
| `monorail-scene.path` | Twitter / Twemoji | twemoji (github.com/twitter/twemoji) — **derived: edited** (roof clutter removed, redrawn as a WDW Mark VI monorail on an elevated beam; art authored in the `renderColorDieCut` branch) | CC BY 4.0 | Monorail Loop (`silver_monorail_loop`) |
| `hot-air-balloon.path` | Kenan Gündoğan / Fontisto | fontisto.com (`hot-air-balloon`) | MIT | Trip Commander (`amethyst_organizer_10`) |
| `riverboat-cruise.svg` | Lorc | game-icons.net | CC BY 3.0 | Legendary Waterway Voyage |
| `sailboat.svg` | Delapouite | game-icons.net | CC BY 3.0 | Making Waves (`amethyst_water_rides_all`) |
| `lighthouse.svg` | Delapouite | game-icons.net | CC BY 3.0 | Crescent Lake (`silver_crescent_lake`) |
| `spaceship.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Discovery Complete (+2 more) |
| `sprint.svg` | Lorc | game-icons.net | CC BY 3.0 | 10-Ride Single Day Sprint |
| `star-struck.svg` | Delapouite | game-icons.net | CC BY 3.0 | Character Hunter (10 Meets) |
| `sunrise.svg` | Lorc | game-icons.net | CC BY 3.0 | Rope Drop to Fireworks Marathon |
| `ticket.svg` | Delapouite | game-icons.net | CC BY 3.0 | First Attraction Logged / The Whole Catalog (`mythic_whole_catalog` Mythic Capstone) |
| `treasure-map.svg` | Lorc | game-icons.net | CC BY 3.0 | Adventureland Complete (+2 more) |
| `water-splash.svg` | Lorc | game-icons.net | CC BY 3.0 | Typhoon Lagoon Wave Master (+1 more) |
| `water-splash-lagoon.path` | Lorc | game-icons.net `water-splash.svg` — **derived**: 3 detached droplet accent cells dropped (still separate pieces even at 3x the die-cut rim, no union reaches them per docs/pin-art-direction.md §5), keeping only the already-connected crown/wave/base group | CC BY 3.0 | Typhoon Lagoon 100% (v2, `silver_typhoon_lagoon`) |
| `roller-coaster.svg` | Bryan Housel & OSM contributors | Temaki (temaki icons) | CC0 1.0 | Source asset for `coaster-loop.path` — kept for the audit trail |
| `coaster-loop.path` | Bryan Housel & OSM contributors | Temaki `roller_coaster.svg` — **derived**: union of both source paths, rescaled from the 15-unit grid to 512 | CC0 1.0 | Coaster Royalty |
| `director-chair.svg` | Delapouite | game-icons.net — **welded variant**, derived | CC BY 3.0 | Source asset for `director-chair.path` |
| `director-chair.path` | Delapouite | game-icons.net (delapouite/director-chair.svg) — **derived: welded variant** | CC BY 3.0 | Hollywood Boulevard land progression (3 pins) |
| `film-projector.svg` | Delapouite | game-icons.net — **welded variant**, derived | CC BY 3.0 | Source asset for `film-projector.path` |
| `film-projector.path` | Delapouite | game-icons.net (delapouite/film-projector.svg) — **derived: welded variant** | CC BY 3.0 | Animation Courtyard land progression (3 pins) |
| `fedora.svg` | Lorc | game-icons.net | CC BY 3.0 | Echo Lake Complete (+2 more) |
| `key.svg` | Lorc | game-icons.net | CC BY 3.0 | Resort Explorer (15 Resorts) |
| `turtle.svg` | Lorc | game-icons.net | CC BY 3.0 | World Nature Complete (+2 more) |
| `tiara.svg` | Delapouite | game-icons.net | CC BY 3.0 | Royal Banquet Grand Slam |
| `wine-glass.svg` | Lorc | game-icons.net | CC BY 3.0 | Fine Dining Critic |
| `space-satellite.svg` | Lorc | game-icons.net | CC BY 3.0 | Interstellar Pilot |
| `waterfall-flume.svg` | Delapouite | game-icons.net | CC BY 3.0 | Water Ride Splasher |
| `party-popper.svg` | Delapouite | game-icons.net | CC BY 3.0 | Squad Leader (20 Group Rides) |
| `soarin-glider-wings.svg` | Skoll | game-icons.net | CC BY 3.0 | Flight Simulator Ace |
| `steam-train.svg` | Delapouite | game-icons.net (delapouite/steam-locomotive.svg) | CC BY 3.0 | Rail & Transit Enthusiast |
| `autograph-quill.svg` | Delapouite | game-icons.net (delapouite/scroll-quill.svg) | CC BY 3.0 | Character Collector (15 Meets) |
| `princess-tiara.svg` | Lorc | game-icons.net (lorc/sharp-crown.svg) | CC BY 3.0 | Princess Royal Court |
| `clapperboard.svg` | Delapouite | game-icons.net | CC BY 3.0 | Hollywood Studios (+2 more) |
| `drama-masks.svg` | Lorc | game-icons.net | CC BY 3.0 | Theater & Stage Enthusiast |
| `elephant.svg` | Delapouite | game-icons.net | CC BY 3.0 | Animal Kingdom Starter (+2 more) |
| `film-strip.svg` | Delapouite | game-icons.net | CC BY 3.0 | Circle-Vision 360 (+2 more) |
| `film-strip.path` | Delapouite | game-icons.net (delapouite/film-strip.svg) — **derived: welded variant** | CC BY 3.0 | Film / Media pins |
| `globe.svg` | Lorc | game-icons.net | CC BY 3.0 | World Explorer |
| `holy-oak.svg` | Cathelineau | game-icons.net | CC BY 3.0 | Animal Kingdom (Tree of Life) |
| `mine-wagon.path` | Delapouite | game-icons.net (delapouite/mine-wagon.svg) — **derived: extracted path** | CC BY 3.0 | Frontierland Complete (+2 more) |
| `rocket.svg` | Lorc | game-icons.net | CC BY 3.0 | Space / Tomorrowland |
| `speedometer.path` | Skoll | game-icons.net (skoll/speedometer.svg) — **derived: extracted path** | CC BY 3.0 | 6-Ride Morning Sprint |
| `theater.svg` | Delapouite | game-icons.net | CC BY 3.0 | Hollywood Studios / Sunset Boulevard |
| `tiger.svg` | Delapouite | game-icons.net | CC BY 3.0 | Maharajah Jungle Trek |
| `wireframe-globe.svg` | Delapouite | game-icons.net | CC BY 3.0 | EPCOT (Spaceship Earth) |
| `world.svg` | Lorc | game-icons.net | CC BY 3.0 | Global Ambassador (+2 more) |
| `wyvern.path` | Lorc | game-icons.net (lorc/wyvern.svg) — **derived: extracted path** | CC BY 3.0 | Pandora - The World of Avatar (+2 more) |
| `snowflake.svg` | Delapouite | game-icons.net (delapouite/snowflake-2.svg) | CC BY 3.0 | Blizzard Beach Summit Master (+1 more) |
| `magic-lantern.svg` | Atisa (atisawd) | Boxicons (bxs-magic-wand.svg) — **derived: unified die-cut variant** (stars positioned to weld continuously with wand rim into a single-piece contour) | CC BY 4.0 | Dark Ride Connoisseur / Dark Ride Fan |
| `water-tower.svg` | Project Original (Gemini / Antigravity) | Original vector authored for Disney Springs Water Tower | Proprietary / Original (no attribution owed) | Disney Springs progression (3 pins) |
| `train-station.svg` | Project Original (Gemini / Antigravity) | Original vector authored for Main Street Train Station | Proprietary / Original (no attribution owed) | Main Street, U.S.A. progression (3 pins) |
| `skyliner.svg` | Project Original (Gemini / Antigravity) | Original vector authored for Disney Skyliner Gondola (Doppelmayr D-Line) | Proprietary / Original (no attribution owed) | Three Parks in One Day (gold) |
| `skyliner-cabin.svg` | Google | Material Symbols | Apache 2.0 | Skyliner Tour (4 Resorts) (silver) |
| `enchanted-rose.path` | Lorc | game-icons.net (lorc/blooming-rose.svg) — **derived: extracted path** | CC BY 3.0 | Princess Royal Court (`silver_princess_court`) |
| `photo-camera.path` | Delapouite | game-icons.net (delapouite/photo-camera.svg) — **derived: extracted path** | CC BY 3.0 | Character Hunter (10 Meets) (`silver_character_hunter_10`) |
| `tiki-macaw.path` | Lorc | game-icons.net (lorc/parrot-head.svg) — **derived: extracted path** | CC BY 3.0 | Audio-Animatronics Fan (`silver_animatronics_veteran`) & Admirer (`bronze_animatronics_fan`) |
| `autograph-book.path` | Lorc | game-icons.net (lorc/book-cover.svg) — **derived: extracted path** | CC BY 3.0 | Character Friend (5 Meets) (`bronze_character_friend_5`) |
| `celebration-cheers.path` | Delapouite | game-icons.net (delapouite/champagne-toasting.svg) — **derived: extracted path** | CC BY 3.0 | Squad Ally (10 Group Rides) (`silver_squad_10`) |
| `deluxe-chandelier.path` | Delapouite | game-icons.net (delapouite/chandelier.svg) — **derived: extracted path** | CC BY 3.0 | Deluxe Resort Royalty (`pearl_deluxe_royalty`) |
| `grand-hotel-estate.path` | Delapouite | game-icons.net (delapouite/mansion.svg) — **derived: extracted path** | CC BY 3.0 | Grand Floridian / Resort progression |
| `monorail.path` | Delapouite | game-icons.net (delapouite/subway.svg) — **derived: extracted path** | CC BY 3.0 | Rail & Transit Enthusiast / Monorail |
| `monorail-beam.path` | Delapouite | game-icons.net (delapouite/subway.svg) — **derived: extracted path** | CC BY 3.0 | Monorail Crawl (3 Resorts) (`bronze_monorail_resorts`) |
| `monorail-rush.svg` / `monorail-rush.path` | Antigravity / Disney App Team | Original Artwork | CC BY 3.0 / Dedicated | Four Parks Grand Slam (`prism_grand_slam`) |
| `vintage-suitcase.path` | Delapouite | game-icons.net (delapouite/suitcase.svg) — **derived: extracted path** | CC BY 3.0 | Resort & Travel progression |
| `earth-africa-europe.svg` | Delapouite | game-icons.net | CC BY 3.0 | World Showcase Master (`pearl_ws_master`) |

The two rows above are **derived works**, not the pristine licensed files. The `.svg` in this
folder is Delapouite's original, but the catalogue renders a *welded* variant — the multi-part
icon enclosed in a single closed outline so the sealed gaps become enamel, per "Third pass —
welding" below. CC BY 3.0 permits derivatives with attribution; the row has to admit the
modification, otherwise the table claims we ship the untouched original. The variant lives in
the inline `MOTIFS` block of `pin-catalog-mockup.html`, which is why `all.js` byte-asserting
the `.svg` does not describe what renders.

## Original work — ours outright, no attribution owed

These are not licensed assets. They are geometric silhouettes authored in this
repo, defined inline in `pin-frame-sample.html` under `SCENES`.

| Name | What it is | Why it exists |
|---|---|---|
| `SCENES.castle` | Generic fairy-tale castle: wall, two side towers with overhanging spires, tall centre tower, arched gate, five windows, one pennant. Single continuous outline plus `evenodd` holes. | The licensed `castle.svg` carries its own circular border, which fights the arch plate. A scene pin also needs a motif drawn to a **baseline** so it can stand on the well's lower edge rather than float centred. |
| `SCENES.ferris` | Ferris wheel: A-frame legs, base bar, open rim (opposite arc sweeps), four spoke diameters, hub, eight cabins. Union of subpaths under `nonzero`. | Proves the ground anchor and die-cut mode are not castle-specific. |
| `STAGES.1` – `STAGES.6` | The growing castle: one turret → two turrets → turrets and wall → gate towers and battlements → the full castle → the castle under fireworks. Stages 5–6 reuse `SCENES.castle` verbatim. | The completion ladder needs one repeated silhouette so the rungs read as a family. This is the role Mickey ears would have played, which is not available to us — the tri-circle is Disney's most heavily protected mark and there is no safe near-miss. |

### How to source a die-cut silhouette

**Preferred — cut an existing library icon.** No new geometry, so none of the hand-authoring
defects below are possible. Use `mode:'diecut', dieFit:'box'`; the renderer computes the
icon's real bounding box and fits its longer axis to 126px, so wide and tall icons carry the
same visual weight. Only icons with their own border ring are unusable this way —
`castle.svg` is the one that misled an earlier revision into thinking the whole library was.

**There is no validated screening rule yet.** An earlier revision claimed one — "compact,
closed and chunky", with `water-splash`, `flat-star`, `treasure-map` and `high-five` marked
unusable. Those labels were **not based on looking at anything**; they were inferred from
geometry and presented as verdicts on rendered output. When the properties behind them were
finally measured, all four sat inside every range, and the specific claim that `water-splash`
was "wide and thin" was false — its aspect ratio is 1.02, essentially square.

Measured properties are recorded in the sample's metrics table (aspect ratio, fill density,
enamel cell count, enamel share). They do not separate the silhouettes that were praised from
the ones that were condemned. Until someone looks at rendered pins and judges them, treat
every library icon as a candidate.

One real constraint *was* found by measuring: `high-five` is a **single-cell** path, so it
cannot take multi-colour enamel. Cell counts for the 13 held icons range from 1 to 14;
10 of 13 support multi-colour.

**Fallback — draw it in a vector editor.** Figma or Inkscape, both free: drag shapes with
snapping on, Union, copy the `d`. No artistic skill and no coordinate arithmetic.

**Not sanctioned — hand-computing coordinates.** Every defect in this feature's history came
from it: stage 2 shorter than stage 1, the inconsistent spire overhang, stale `dieTop`
values. It is not slow, it is *unreliable*, which is why the invariants below are asserted.

**Not sanctioned — composing from the rectangle/triangle primitives.** `box`, `wall`,
`tower`, `spire`, `turret`, `battlements` remain in the sample because the six ladder stages
use them, but they can only produce fortress-like shapes and should not be used for new pins.
The parts rebuild standardised every turret's spire overhang at `w/2 + 12`; hand-typed stage 1
had used `w/2 + 14`, and correcting that is the one place the geometry intentionally differs
from the original.

> A note on cost. An earlier revision claimed each hand-authored silhouette cost "30–60
> minutes". That figure was fabricated — nothing measured it. The real cost of hand-authored
> geometry is **defect risk**, paid down in the assertions below, which amortise across every
> silhouette rather than scaling with the set.

### Invariants these must hold

Asserted in the verification pass, because nothing else would catch a drift:

- Authored in the 512 space, **centred on x=256**, standing on the **y=480 baseline**.
- Each declares its own `top` (topmost y). Die-cut fitting reads that value rather than
  a hand-copied literal — an earlier revision hardcoded `dieTop` per pin and the numbers
  went stale the moment the stage geometry changed.
- Stage `top` values decrease **monotonically** (300 → 260 → 220 → 170 → 40 → 40). This is
  the ladder's climb. An earlier revision had stage 2 shorter than stage 1, which made
  rung 2 look like a step backwards.
- Stages 1–4 use `nonzero` (no interior holes); stages 5–6 use `evenodd` so the gate and
  windows appear. Detail arriving late is intentional.
- Stage 6's fireworks sit clear of the spire tips (burst max y 122 < apex y 150). If they
  overlapped, `evenodd` would punch holes in the towers instead of drawing bursts.

Scene silhouettes are authored in the same 512 space as the licensed motifs, but
**drawn to a baseline at y=480** and **centred on x=256**. Both properties are
asserted, because nothing else would catch a drifted baseline.

**Deliberately generic.** Turrets and a pennant, never Cinderella Castle's actual
profile. Every future scene pin should be original geometry for this reason — it
sidesteps trade dress entirely and we end up owning the most visible art in the set.

Licence text: https://creativecommons.org/licenses/by/3.0/
Source project licence: https://github.com/game-icons/icons/blob/master/license.txt

## Source file shape

Each file is a 512 × 512 viewBox containing two paths: a black background square
(discarded) and a white silhouette path (the motif). Only the second path is used.

## Rules for adding a motif

1. Prefer permissive licences: CC BY (attribution), CC0, MIT, ISC.
2. Never add a motif that depicts a protected character, or the specific trade
   dress of a real landmark. Generic objects only.
3. Commissioned motifs require a work-for-hire contract assigning copyright, plus
   a warranty that no third-party stock assets are embedded. Record the contract
   reference in the Licence column.
4. Add the row here in the same change that adds the file.

## Geometry tooling — validated, after three defects

The sample computes real measurements over path geometry (fill density, metal/enamel share,
bounding boxes for die-cut fitting). Three defects made earlier versions of those numbers
worthless, and all three produced *plausible* output, which is why they survived:

1. **The flattener ignored every curve command.** The library icons are almost entirely cubic
   béziers, so the point-in-path tests returned false nearly everywhere. A solid `trophy` was
   reported as **0% filled**. Fixed by walking the full command set — `M m L l H h V v C c
   S s Q q T t A a Z z` — and subdividing curves and arcs into line segments.
2. **Bounding boxes came from raw command endpoints.** A circle drawn as two arcs collapsed to
   zero height (both endpoints share a `y`), and control points inflated the box for every
   curved icon, so die-cut library pins rendered smaller than intended. Fixed by deriving the
   box from the flattened geometry.
3. **Arc subdivision was a fixed 12 segments.** A near-360° arc became a 12-gon and
   under-reported its area by 4.4%. Fixed by subdividing on sweep angle — one segment per 7.5°.

**Do not trust a geometric measurement here without an analytic check.** The suite validates
against shapes whose areas are known in closed form:

| shape | measured fraction of bbox | analytic |
|---|---|---|
| square | 1.000 | 1 |
| circle from arcs | 0.783 | π/4 = 0.785 |
| semicircle, single arc | 0.783 | π/4 |
| cubic quarter-round | 0.783 | π/4 |
| quadratic arch | 0.662 | 2/3 |
| even-odd annulus | 7500 area | 7500 |

Also asserted: relative and absolute cubics trace the same shape; cell splitting preserves
total area; a stroked square's metal share matches its analytic ring area.

## Multi-colour enamel

Die-cut pins accept an **array** of enamel colours, poured one per cell (subpath). Subpath 0 is
the body; later subpaths draw on top, which is how a real multi-colour pin is built.

### Interior cells need a thinner rim

Cells are two different things and must be stroked differently:

- **Outer parts** — a separate piece of the silhouette (a footprint's toes). Full rim.
- **Interior detail** — a region sitting inside another cell (a treasure map's X and mountains,
  a castle's windows). Thin divider, `0.32 ×` the outer rim.

Stroking both at the full rim is a bug that hid detail rather than framing it: at ~6px the rim
covers a small interior shape entirely, so its enamel never shows and it renders as a solid
metal blob. This was **found by looking at a screenshot**, not by any measurement — the metrics
reported `treasure-map` as 3 cells with a healthy 62% enamel share while two of those cells
were being painted over by their own rim.

Classification is geometric: a cell is interior when its centroid falls inside cell 0. Measured
across the held icons — `treasure-map` 3 cells / 2 interior, `flat-star` 6/5, `trophy` 4/3,
`compass` 4/3, castle 7/6; `crown`, `stopwatch`, `firework`, `water-splash`, `footprint` and
`cut-diamond` have none (all their cells are separate outer parts).

Pass `innerRim: 1` to reproduce the old equal-rim rendering for comparison.

Cell splitting must handle **relative movetos** — `game-icons` starts most later subpaths with
`m`, not `M`. An earlier version split only on uppercase `M`, so multi-colour silently did
nothing on `treasure-map` and `flat-star`. Each cell is now re-emitted with an absolute `M`.

## Winding direction is load-bearing

Under the `nonzero` fill rule, subpaths that overlap **cancel** if they wind oppositely and
**unite** if they wind the same way. Two separate defects in the ferris wheel came from getting
this wrong, and neither was visible to a test that only inspected the path string:

1. **A near-360° arc has two possible centres**, and the sweep flag picks between them. The rim
   annulus was written as an outer circle starting at the top with `sweep=1` and an inner circle
   *also* starting at the top with `sweep=0`. That put the inner circle's centre at **(256, 36)**
   instead of (256, 256) — a stray 110-radius disc floating above the wheel. Fixed by starting
   the inner circle at the **bottom** (256, 366) with `sweep=0`, which yields the correct centre
   *and* the opposite winding. An earlier assertion checked only that the two sweep flags
   differed, which is true of both the broken and the correct version.
2. **The two diagonal spokes wound opposite to the axis-aligned ones and to the hub**, so they
   cancelled where they overlapped rather than uniting — punching gaps through the hub wherever
   a diagonal crossed it. Fixed by reversing their vertex order.

Rule: **every solid subpath in a silhouette must wind the same direction.** Only a subpath whose
job is to cut a hole may run against them.

### `noSplit`

A silhouette that relies on winding cancellation cannot be split into per-cell paths for
multi-colour enamel — splitting removes the cancellation, and the ferris wheel rendered as a
solid disc. Such silhouettes are marked `noSplit: true` and rendered as one path using their
declared fill rule. They forgo multi-colour; that is the trade.

Verified by ring sampling rather than by reading the path: hub solid at r≤25, the band between
hub and rim open apart from the four spoke diameters (measured 27–47% against a spoke-geometry
prediction of 18–45%), rim band solid at r=124, and nothing at all in the region the stray
circle used to occupy.

## Colour separation

Two defects were visible in a screenshot while every test passed. Both come from the same
mistake: treating *distinct hex values* as *distinguishable colour*.

1. **A gold metal motif on amber enamel was invisible.** 12° of hue apart at a 2.86:1 luminance
   ratio — technically "contrasting", perceptually one colour at two brightnesses. The Medallion
   and Turkey Leg pins now use `crimson`.
2. **Bronze pins read as gold.** The old bronze mid tone sat 18° from gold's hue with a 1.55
   contrast ratio and a 0.02 saturation difference. The ramp is now darker and redder
   (`#c97f4a` mid), separating on lightness at 2.33:1.

Two rules, both audited in the sample:

- **Metal motif on enamel** needs hue distance ≥ 40° **or** contrast ≥ 3.5:1.
- **Two tiers are confusable** if hue < 30° **and** contrast < 1.25 **and** saturation < 0.25
  apart. No pair may be confusable.

The pre-existing tier test asserted six distinct hex values and six distinct ramps. Both were
true while two tiers were indistinguishable on screen.

## Original geometry — ours outright, no attribution obligation

These are **not** library icons. They are generated in `pin-frame-sample.html` from named
parameters (see `treeParts`, `sphereParts`, `clapperParts`), so there is no third-party
asset and no CC BY row is required for them. They exist because none of the three was
available in the licensed set and there is no vector editor in the toolchain.

| Emblem | Generator | Used for | Deliberately NOT |
|---|---|---|---|
| `tree` | `treeParts` — canopy blob count/spread, trunk taper, root count | Animal Kingdom | The real park tree: **no carved animals**, which is that tree's distinctive feature |
| `sphere` | `sphereParts` — radius, side count, facet size | EPCOT | The real structure: sits on a plain plinth, not the three-legged support. A faceted sphere is a generic geometric form |
| `clapper` | `clapperParts` — slate size, bar angle, tooth count | Hollywood Studios | Any building. Avoids the theatre (a real, protected building) and the ears tower |

Measured at their tier rims: one connected piece each, aspect 0.78–1.05, enamel surviving
38–70%, circularity 0.48–0.55 (a plain disc would be 1.00). All asserted in the verifier.

**If any of these is later replaced by a library icon, it needs a row in the table above
instead, and the in-app Art credits row must be checked to still cover it.**

## Park emblem candidates — added after screening 4239 library icons

`game-icons.net` carries 4239 icons; the first pass here had downloaded 15, so "nothing in
the library matches" was a statement about this folder, not about the library. All of the
below are **CC BY 3.0**, covered by the same in-app Art credits row.

| File | Author | Used for | Gate result |
|---|---|---|---|
| `elephant.svg` | Delapouite | **Animal Kingdom (chosen)** | passes at silver 5.2px, 1 piece |
| `oak.svg` | Lorc | Animal Kingdom alternate | passes |
| `tiger.svg` | Delapouite | rejected | starved — 9% enamel behind a rim |
| `earth-africa-europe.svg` | Delapouite | **EPCOT (chosen)** | passes at all three rims, the only one that does |
| `observatory.svg` | Delapouite | EPCOT alternate | passes at 7.2px; 9 pieces at 4.2px |
| `wireframe-globe.svg` | Delapouite | rejected | medallion (0.99) and 1% enamel |
| `globe.svg` | Lorc | rejected | starved — 18% |
| `world.svg` | Lorc | rejected | medallion and 3 pieces |
| `base-dome.svg` | Delapouite | rejected | starved — 13% |
| `habitat-dome.svg` | Delapouite | rejected | starved — 11% |
| `rocket.svg` | Lorc | rejected | 2 pieces |
| `theater-curtains.svg` | Delapouite | **Hollywood Studios (chosen)** | passes at bronze 4.2px |
| `drama-masks.svg` | Lorc | rejected | 2 pieces at bronze's narrower rim |
| `clapperboard.svg` | Delapouite | rejected | 4 separate pieces |
| `theater.svg` | Delapouite | rejected | 2 pieces |
| `film-strip.svg` | Delapouite | rejected | starved — 7% |

### Two things to know before adding more

**The medallion trap.** Every game-icons SVG has a full-canvas background rect as
`path[0]`, and some icons are drawn *inside a circle* — `castle.svg` is a 240-radius circle
containing a castle, so its die-cut silhouette is a plain disc. It measured 0.99 on
disc-likeness. Magic Kingdom therefore uses our own castle silhouette (0.33), not this file.

**Rim width changes the answer.** A narrow rim leaves more enamel but welds less, so
multi-part icons come apart; a wide rim welds everything but eats the colour. `elephant` is
2 pieces at 4.2px and 1 at 5.2px; `theater-curtains` holds 45% at 4.2px and 19% at 9.2px.
Screen every candidate at the rim of the tier it will actually be assigned.

`motif-paths.js` in this folder is **generated** from these files and is asserted by the
verifier to still match `path[1]` of each one byte for byte.

## Second screening pass — 43 candidates total

The first pass picked an elephant for Animal Kingdom on the reasoning that an animal reads
better at small sizes. That ignored the obvious: **the tree is the park's own symbol.** Round
two screened trees properly, plus fresh subjects for the other two parks. All CC BY 3.0,
covered by the same in-app Art credits row.

### Chosen

| File | Author | Park | Why it won |
|---|---|---|---|
| `baobab.svg` | Delapouite | **Animal Kingdom** | A tree, as it should be. Massive broad trunk — the right family without being the specific tree. 51% enamel, 0.17 outline, the least disc-like of any tree |
| `stone-sphere.svg` | Lorc | **EPCOT** | The cleanest solid sphere that survives a rim. Every wireframe globe starves at 1–3% |
| `light-projector.svg` | Delapouite | **Hollywood Studios** | Best-measuring candidate of anything screened for any park: one piece, **71% enamel**, 0.28 outline |

### Alternates that also pass, wired up for a one-word swap

`tree-roots.svg` · `fruit-tree.svg` · `oak.svg` (Animal Kingdom) — `observatory.svg` ·
`triorb.svg` · `earth-africa-europe.svg` (EPCOT) — `star-struck.svg` · `popcorn.svg` ·
`theater-curtains.svg` (Hollywood Studios)

### Rejected, with the reason

`holy-oak` starved 20% · `willow-tree` 2 pieces · `tiger` 9% · `holosphere` 5 pieces ·
`atom` 2 pieces · `molecule` 3% · `nested-hexagons` 0% · `wireframe-globe` medallion +1% ·
`globe` 18% · `world` medallion +3 pieces · `base-dome` 13% · `habitat-dome` 11% ·
`rocket` 2 pieces · `domino-mask` aspect 1.90 · `carnival-mask` 5 pieces ·
`megaphone` 7 pieces · `old-microphone` 5 pieces · `director-chair` 7 pieces ·
`film-projector` 6 pieces + medallion · `film-spool` 2 pieces + medallion ·
`clapperboard` 4 pieces · `theater` 2 pieces · `film-strip` 7% · `drama-masks` 2 pieces

### The rule this pass established

**The one-piece requirement systematically eliminates *assembled* objects** — anything with
legs, arms, a stand or separate hardware — and favours single solid masses. Trees, animals,
spheres and popcorn are solid; megaphones, chairs, microphones and projector rigs are
assemblies. Showbiz iconography is mostly assemblies, which is why Hollywood Studios had by
far the thinnest menu: 19 candidates screened, 4 survivors.

**When searching for a future emblem, search for solid subjects.** And screen with
`verify/screen.js <rimPx> <keys...>` at the rim of the tier the pin will actually use, before
designing anything around it.

## Third pass — after two metric bugs were fixed, and welding

Two bugs in the screening had been rejecting valid icons. The piece count ran nonzero winding
across the whole path when `renderDieCut` fills each cell separately, so mixed-wound subpaths
read as holes that split the shape; and the enamel figure charged interior detail at the full
rim instead of the 0.32× divider the renderer uses. Together they rejected the clapperboard
(counted as 4 pieces, actually 1) and `holy-oak` (measured 20% enamel, actually 55%).

**Welding** — enclosing a multi-part icon in a single closed outline so the sealed gaps become
enamel, the way a real cloisonné pin works — rescues 16 of 17 previously-rejected icons.

### Chosen after this pass

| File | Author | Park | Note |
|---|---|---|---|
| `holy-oak.svg` | Cathelineau | **Animal Kingdom** | Chosen by eye from six passing trees. Had been wrongly rejected at 20% enamel; it is 55% |
| `wireframe-globe.svg` | Delapouite | **EPCOT** | A latitude-and-longitude globe, 37 facet cells. Chosen by eye over `soccer-ball`, which reads as a football. Needs a **declared exception** to the medallion rule: a globe is round because it is a globe, so the circle is the object rather than a frame around one |
| `clapperboard.svg` | Delapouite | **Hollywood Studios** | Chosen by eye. Had been wrongly rejected as 4 pieces; it is 1 |

`castle` for Magic Kingdom remains our own silhouette, not the licensed medallion.

### Added this pass

`soccer-ball` · `mesh-ball` · `crystal-ball` · `glass-ball` · `honeycomb` · `space-needle` ·
`telescope` · `satellite` · `spaceship` · `carousel` (EPCOT search) — plus `baobab`,
`tree-roots`, `fruit-tree`, `holy-oak`, `willow-tree`, `domino-mask`, `carnival-mask`,
`star-struck`, `light-projector`, `old-microphone`, `film-spool`, `director-chair`,
`megaphone`, `popcorn`, `ticket`, `film-projector` from the earlier passes.

**Alternates passing the gate:** Animal Kingdom — `baobab`, `tree-roots`, `fruit-tree`, `oak`.
EPCOT — `honeycomb`, `atom`, `stone-sphere`, `nested-hexagons`, `observatory`,
`earth-africa-europe`. Hollywood Studios — welded `old-microphone`, welded `director-chair`,
`light-projector`, `ticket`.

**Still rejected for real reasons:** `mesh-ball` 18% · `space-needle` 2% · `telescope` 4% ·
`satellite` 9% · `carousel` 5% · `spaceship` 19% (all too thin to hold colour behind a rim) ·
`crystal-ball` and `glass-ball` (medallions) · `willow-tree` (27%, and its thin fronds fall
outside the simplified weld outline).
