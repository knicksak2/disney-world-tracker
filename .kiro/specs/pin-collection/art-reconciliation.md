# Pin Art Reconciliation Map — v2 roster (174) vs v1 catalogue (167)

Read-only analysis. Maps every pin in the **authoritative v2 roster** — the `PINS` array in
`packages/shared/src/pins/catalog.ts` (174 pins, incl. the generated 20 land + 7 park starters) —
to its best-by-meaning ancestor in the **v1 release catalogue** — the `const PINS = [ … ]` array in
`.kiro/specs/pin-collection/pin-catalog-mockup.html` (167 pins with finished art recipes, lines
~1360–1600). Matching is by meaning (id + name + criteria), not literal id.

**No source files were modified.** This is the art worklist for materialising the v2 catalogue
(spec task 6).

---

## Summary

| Metric | Count |
|---|---|
| **Total v2 pins** | **174** |
| REUSE (v1 recipe copies over as-is) | **84** |
| TWEAK (v1 motif/scene reusable, something must change) | **41** |
| NEW (no reasonable v1 equivalent — design from scratch) | **48** |
| RESOLVED (art already finalised) | **1** |

Notes on the shape of the work:

- **Places dominate the REUSE column.** The 20 land starters + 7 park starters (27) map 1:1 onto
  v1's bronze starter discs, and the silver/gold land-and-park completion die-cuts (trainStation,
  rocket, fairyWand, tiger, elephant, castle, etc.) carry straight over. Park progressions
  (starter → master → sovereign) legitimately reuse one park emblem across tiers — the dedup
  exemption in `docs/pin-art-direction.md` §5.
- **TWEAKs are mostly tier shifts.** A v1 motif exists but the v2 pin sits at a different tier
  (different rim width + metal ramp), or the threshold/banner number changed. The whole Centurion
  ladder is a TWEAK because both the banner and the firework composition-stage must be re-spread
  across 12 rungs (v2) instead of 20 (v1).
- **NEW is concentrated in genuinely new v2 tracks:** the restaurant-count ladder (Diner/Foodie/
  Gourmand/Connoisseur/Epicure), the entire Festival-Foodie and Snacks/Lounges tracks, spinners,
  gentle rides, parades, franchise sets (Star Wars / Pixar / Classic Characters), and the low
  bronze rungs of ladders that v1 started higher up.

---

## Full reconciliation table

Grouped by v2 track/section (pin order preserved). Recipe column is abbreviated as
`mode · motif|scene · key enamel/scale`; `contained` pins list their `shape`. Full change notes for
TWEAK/NEW rows are in the worklists that follow.

### Attractions ladder — Centurion (firework B4 ladder, contained arch, sky night)

The v2 thresholds (5·15·30·50·75·100·130·160·190·215·235 + All Attractions) differ from v1's
(10→400 across `b4fire1`–`b4fire20`). Per the special-case rule, every rung is a TWEAK: reuse the
firework B4 scene system, change the **banner** number, and reassign the **composition stage** so
the additive climb spreads smoothly over 12 rungs rather than 20. `motifEnamel = B4_STAGES[n].cols`,
`motifScale 1.4`, `shape arch`, `sky night` throughout.

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_centurion_5 | bronze | Centurion 5 | TWEAK | bronze_centurion_10 | contained arch · scene b4fire1 · banner 10 | banner 10→5; lowest stage |
| bronze_centurion_15 | bronze | Centurion 15 | TWEAK | bronze_centurion_15 | contained arch · scene b4fire2 · banner 15 | banner already 15 & tier bronze — near-REUSE; keep early stage |
| bronze_centurion_30 | bronze | Centurion 30 | TWEAK | bronze_centurion_30 | contained arch · scene b4fire5 · banner 30 | banner 30 same; reassign stage → ~b4fire3 (3rd of 12) |
| silver_centurion_50 | silver | Centurion 50 | TWEAK | silver_centurion_50 | contained arch · scene b4fire8 · banner 50 | banner 50 same, tier silver same; reassign stage → ~b4fire4/5 |
| silver_centurion_75 | silver | Centurion 75 | TWEAK | gold_centurion_70 | contained arch · scene b4fire10 · banner 70 | nearest threshold 70 (tie w/ 80); banner→75; tier gold→silver |
| gold_centurion_100 | gold | Centurion 100 | TWEAK | gold_centurion_100 | contained arch · scene b4fire12 · banner 100 | banner 100 same, tier gold same; reassign stage |
| gold_centurion_130 | gold | Centurion 130 | TWEAK | gold_centurion_125 | contained arch · scene b4fire13 · banner 125 | banner 125→130 |
| amethyst_centurion_160 | amethyst | Centurion 160 | TWEAK | amethyst_centurion_150 | contained arch · scene b4fire14 · banner 150 | banner 150→160 |
| amethyst_centurion_190 | amethyst | Centurion 190 | TWEAK | amethyst_centurion_200 | contained arch · scene b4fire16 · banner 200 | banner 200→190 |
| pearl_centurion_215 | pearl | Centurion 215 | TWEAK | amethyst_centurion_200 | contained arch · scene b4fire16/17 · banner 200/250 | banner→215; **tier amethyst→pearl** (rim 7.2→8.2px, pearl metal + glow) |
| pearl_centurion_235 | pearl | Centurion 235 | TWEAK | amethyst_centurion_250 | contained arch · scene b4fire17 · banner 250 | banner→235; **tier amethyst→pearl** |
| prism_all_attractions | prism | All Attractions | TWEAK | prism_grand_master | contained arch · scene b4fire20 · banner 400 | ladder capstone; banner 400→"ALL"/100%; **must differ from mythic**, which took the finalised b4fire20 art |

### Dining · Restaurants ladder

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_diner_3 | bronze | Diner 3 | TWEAK | bronze_diner_1 | contained crest · motif hotDog · brown/amber/crimson/cream | add count banner "3" |
| bronze_diner_10 | bronze | Diner 10 | NEW | — | — | restaurant-count rung |
| bronze_diner_20 | bronze | Diner 20 | NEW | — | — | restaurant-count rung |
| bronze_diner_30 | bronze | Diner 30 | NEW | — | — | restaurant-count rung |
| silver_foodie_45 | silver | Foodie 45 | NEW | — | — | restaurant-count rung |
| silver_foodie_60 | silver | Foodie 60 | NEW | — | — | restaurant-count rung |
| gold_gourmand_80 | gold | Gourmand 80 | NEW | — | — | restaurant-count rung |
| gold_gourmand_100 | gold | Gourmand 100 | NEW | — | — | restaurant-count rung |
| amethyst_connoisseur_120 | amethyst | Connoisseur 120 | NEW | — | — | restaurant-count rung |
| amethyst_connoisseur_145 | amethyst | Connoisseur 145 | NEW | — | — | restaurant-count rung |
| pearl_epicure_170 | pearl | Epicure 170 | NEW | — | — | restaurant-count rung |
| prism_culinary_legend | prism | Culinary Legend | NEW | — | — | dine every real restaurant — pinnacle |

### Dining · Festival Foodie (no v1 equivalent — v1 had zero festival pins)

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_festival_first | bronze | First Booth | NEW | — | — | festival-booth ladder |
| bronze_festival_5 | bronze | Booth Sampler | NEW | — | — | festival-booth ladder |
| bronze_festival_10 | bronze | Booth Explorer | NEW | — | — | festival-booth ladder |
| silver_festival_20 | silver | Booth Enthusiast | NEW | — | — | festival-booth ladder |
| gold_festival_30 | gold | Festival Feast | NEW | — | — | festival-booth ladder |

### Dining · Snacks & Lounges (no v1 equivalent)

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_snacker_5 | bronze | Snacker 5 | NEW | — | — | snack-count ladder |
| bronze_snacker_15 | bronze | Snacker 15 | NEW | — | — | snack-count ladder |
| bronze_snacker_30 | bronze | Snacker 30 | NEW | — | — | snack-count ladder |
| silver_snacker_50 | silver | Snacker 50 | NEW | — | — | snack-count ladder |
| gold_snacker_75 | gold | Snacker 75 | NEW | — | — | snack-count ladder |
| bronze_coffee_crawl | bronze | Coffee Crawl | NEW | — | — | coffee-cup motif |
| silver_pool_bar_hopper | silver | Pool Bar Hopper | NEW | — | — | tiki/cocktail motif |

### Dining · Fine Dining

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_signature_4 | silver | Signature Gourmet | REUSE | silver_signature_4 | diecut · cutDiamond · ice/sky/white/slate | exact (silver, 4 signature) |
| gold_signature_10 | gold | Signature Connoisseur | NEW | — | diecut · glassCelebration · champagne/highlight/crimson | Milestone toast flutes clinking, no banner, 6.2px gold rim |
| amethyst_signature_all | amethyst | Signature Master | TWEAK | amethyst_fine_dining_critic | diecut · wineGlass · wine/slate/amber | repurpose (reviews→dine-all); tier amethyst same |
| silver_character_dining_3 | silver | Character Dining Trio | NEW | — | diecut · placematMeal · crimson/white/cream | rounded dining placemat framing cutlery & plate |
| gold_character_dining_all | gold | Character Dining Master | NEW | — | diecut · chefToque · white/crimson/amber | master character chef toque |
| gold_royal_banquet | gold | Royal Banquet | TWEAK | pearl_royal_banquet_grand_slam | diecut · tiara · amber/crimson | tier pearl→gold; same 4 royal banquets |

### Places · Land Starters (20) — all REUSE from v1 bronze land-starter discs

All bronze, `shape disc`, single-word enamel. Same land, same tier, same achievement (first log in
land) → recipe copies over verbatim.

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe |
|---|---|---|---|---|---|
| bronze_land_starter_main_street_usa | bronze | Main Street, U.S.A. Starter | REUSE | bronze_main_street_starter | disc · motif trainStation · crimson |
| bronze_land_starter_adventureland | bronze | Adventureland Starter | REUSE | bronze_adventureland_starter | disc · motif treasureMap · forest |
| bronze_land_starter_frontierland | bronze | Frontierland Starter | REUSE | bronze_frontierland_starter | disc · motif mineWagon · crimson |
| bronze_land_starter_liberty_square | bronze | Liberty Square Starter | REUSE | bronze_liberty_square_starter | disc · scene libertyBell · crimson |
| bronze_land_starter_fantasyland | bronze | Fantasyland Starter | REUSE | bronze_fantasyland_starter | disc · motif fairyWand · royal |
| bronze_land_starter_tomorrowland | bronze | Tomorrowland Starter | REUSE | bronze_tomorrowland_starter | disc · motif rocket · royal |
| bronze_land_starter_world_celebration | bronze | World Celebration Starter | REUSE | bronze_world_celebration | disc · motif globe · royal |
| bronze_land_starter_world_discovery | bronze | World Discovery Starter | REUSE | bronze_world_discovery | disc · motif spaceship · royal |
| bronze_land_starter_world_nature | bronze | World Nature Starter | REUSE | bronze_world_nature | disc · motif turtle · teal |
| bronze_land_starter_world_showcase | bronze | World Showcase Starter | REUSE | bronze_world_showcase_starter | disc · motif world · teal |
| bronze_land_starter_hollywood_boulevard | bronze | Hollywood Boulevard Starter | REUSE | bronze_hollywood_blvd_starter | disc · motif directorChair · crimson |
| bronze_land_starter_echo_lake | bronze | Echo Lake Starter | REUSE | bronze_echo_lake_starter | disc · motif fedora · crimson |
| bronze_land_starter_animation_courtyard | bronze | Animation Courtyard Starter | REUSE | bronze_animation_courtyard_starter | disc · motif filmProjector · crimson |
| bronze_land_starter_sunset_boulevard | bronze | Sunset Boulevard Starter | REUSE | bronze_sunset_blvd_starter | disc · scene drumKit · crimson |
| bronze_land_starter_toy_story_land | bronze | Toy Story Land Starter | REUSE | bronze_toy_story_starter | disc · scene sheriffBadge · crimson |
| bronze_land_starter_star_wars_galaxys_edge | bronze | Star Wars: Galaxy's Edge Starter | REUSE | bronze_galaxys_edge_starter | disc · scene crossedLightsabers · royal |
| bronze_land_starter_discovery_island | bronze | Discovery Island Starter | REUSE | bronze_discovery_island_starter | disc · motif flamingo · forest |
| bronze_land_starter_pandora_the_world_of_avatar | bronze | Pandora – The World of Avatar Starter | REUSE | bronze_pandora_starter | disc · motif wyvern · forest |
| bronze_land_starter_africa | bronze | Africa Starter | REUSE | bronze_africa_starter | disc · motif elephant · forest |
| bronze_land_starter_asia | bronze | Asia Starter | REUSE | bronze_asia_starter | disc · motif tiger · forest |

### Places · Park Starters (7) — all REUSE from v1 bronze park-starter discs

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe |
|---|---|---|---|---|---|
| bronze_park_starter_magic_kingdom | bronze | Magic Kingdom Starter | REUSE | bronze_mk_starter | disc · scene castle · sky |
| bronze_park_starter_epcot | bronze | EPCOT Starter | REUSE | bronze_epcot_starter | disc · motif wireframeGlobe · teal |
| bronze_park_starter_hollywood_studios | bronze | Hollywood Studios Starter | REUSE | bronze_hs_starter | disc · motif clapperboard · crimson |
| bronze_park_starter_animal_kingdom | bronze | Animal Kingdom Starter | REUSE | bronze_ak_starter | disc · motif holyOak · forest |
| bronze_park_starter_typhoon_lagoon | bronze | Typhoon Lagoon Starter | REUSE | bronze_typhoon_lagoon | disc · motif waterSplash · teal |
| bronze_park_starter_blizzard_beach | bronze | Blizzard Beach Starter | REUSE | bronze_blizzard_beach | disc · motif snowflake · sky |
| bronze_park_starter_disney_springs | bronze | Disney Springs Starter | REUSE | bronze_disney_springs | disc · motif waterTower · teal |

### Places · Silver completions

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_land_adventureland | silver | Adventureland 100% | REUSE | silver_adventureland_100 | diecut · treasureMap · crimson-heavy | exact |
| silver_land_discovery_island | silver | Discovery Island 100% | REUSE | silver_discovery_island_100 | diecut · flamingo · pink/rose | exact |
| silver_land_animation_courtyard | silver | Animation Courtyard 100% | REUSE | silver_animation_courtyard_100 | diecut · filmProjector · slate/amber/crimson/white | exact |
| silver_land_frontierland | silver | Frontierland 100% | REUSE | silver_frontierland_100 | diecut · mineWagon · brown/amber/slate | exact |
| silver_land_asia | silver | Asia 100% | REUSE | silver_asia_100 | diecut · tiger · orange/white/ink | exact |
| silver_land_world_discovery | silver | World Discovery 100% | REUSE | silver_world_discovery_100 | diecut · spaceship · scale 1.35 | exact |
| silver_boulevards | silver | The Boulevards | TWEAK | silver_hollywood_blvd_100 | diecut · directorChair · slate/white/crimson/amber | **new combined pin** (Hollywood + Sunset); pick one Studios motif (directorChair or drumKit) |
| silver_immersive_lands | silver | Immersive Lands | TWEAK | silver_galaxys_edge_100 | diecut · scene crossedLightsabers | **new combined pin** (Toy Story + Galaxy's Edge); reuse crossedLightsabers or sheriffBadge |
| silver_typhoon_lagoon | silver | Typhoon Lagoon 100% | REUSE | silver_typhoon_lagoon_master | diecut · waterSplash · cyan/navy/white/amber | exact |
| silver_blizzard_beach | silver | Blizzard Beach 100% | REUSE | silver_blizzard_beach_master | diecut · snowflake · sky/blue | exact |

### Places · Gold completions

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| gold_land_fantasyland | gold | Fantasyland 100% | REUSE | gold_fantasyland_complete | diecut · fairyWand · purple/amber/white/pink/sky | exact |
| gold_land_main_street | gold | Main Street, U.S.A. 100% | REUSE | gold_main_street_complete | diecut · trainStation · crimson/amber/slate | exact |
| gold_land_tomorrowland | gold | Tomorrowland 100% | REUSE | gold_tomorrowland_complete | diecut · rocket · blue/white/amber/navy/red | exact |
| gold_land_world_nature | gold | World Nature 100% | REUSE | gold_world_nature_complete | diecut · turtle · blue/green/cream/teal | exact |
| gold_land_world_celebration | gold | World Celebration 100% | REUSE | gold_world_celebration_complete | diecut · globe · blue/green/sky | exact |
| gold_land_africa | gold | Africa 100% | REUSE | gold_africa_complete | diecut · elephant · slate/white | exact |
| gold_disney_springs | gold | Disney Springs 100% | REUSE | gold_disney_springs_master | diecut · waterTower · teal/brown/slate/amber | exact |
| gold_all_lands | gold | All Lands Explorer | TWEAK | pearl_all_lands_starter | diecut · compassRose · amber/crimson/white/ink | tier pearl→gold (rim 8.2→6.2px, gold metal) |

### Places · Amethyst mastery

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| amethyst_world_showcase | amethyst | World Showcase 100% | TWEAK | pearl_ws_master | diecut · earthAfricaEurope · sky/forest/teal/royal · scale 1.15 | tier pearl→amethyst (rim 8.2→7.2px, amethyst metal) |
| amethyst_mk_master | amethyst | Magic Kingdom Master | REUSE | amethyst_magic_kingdom_complete | diecut · scene castle · sky/slate/amethyst | art identical at amethyst; v1 pin was scope "everything", v2 is attractions — art unchanged |
| amethyst_epcot_master | amethyst | EPCOT Master | REUSE | amethyst_epcot_complete | diecut · wireframeGlobe · teal/slate/amethyst | as above |
| amethyst_hs_master | amethyst | Hollywood Studios Master | REUSE | amethyst_hollywood_complete | diecut · clapperboard · crimson/slate/amethyst | as above |
| amethyst_ak_master | amethyst | Animal Kingdom Master | REUSE | amethyst_animal_kingdom_complete | diecut · holyOak · forest/slate/amethyst | as above |

### Places · Pearl sovereigns

Each reuses its park emblem one tier up (park progression exemption). "Everything" scope moved to
pearl in v2; art is the same emblem, tier bumped amethyst→pearl.

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| pearl_mk_sovereign | pearl | Magic Kingdom Sovereign | TWEAK | amethyst_magic_kingdom_complete | diecut · scene castle · sky/slate/amethyst | tier amethyst→pearl; pearl enamel + glow |
| pearl_epcot_sovereign | pearl | EPCOT Sovereign | TWEAK | amethyst_epcot_complete | diecut · wireframeGlobe | tier amethyst→pearl |
| pearl_hs_sovereign | pearl | Hollywood Studios Sovereign | TWEAK | amethyst_hollywood_complete | diecut · clapperboard | tier amethyst→pearl |
| pearl_ak_sovereign | pearl | Animal Kingdom Sovereign | TWEAK | amethyst_animal_kingdom_complete | diecut · holyOak | tier amethyst→pearl |
| pearl_four_parks_master | pearl | Four Parks Master | REUSE | pearl_four_parks_master | contained crest · scene fourParksMaster | exact id + tier |

### Places · Mythic capstone

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| mythic_whole_catalog | mythic | The Whole Catalog | RESOLVED | prism_grand_master (ancestor) | Golden Sovereign E-Ticket (`mythic-pin.html`) | Option 4 locked in: Vintage E-Ticket pass die-cut in Aurora-Gold and Royal crimson velvet enamel (#a8323f) with centered minted 100% seal and Polaris accent stars |

### Social · Squad

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_squad_1 | bronze | First Ride Together | NEW | — | — | no bronze squad art in v1 |
| bronze_squad_5 | bronze | Squad 5 | NEW | — | — | no bronze squad art in v1 |
| silver_squad_10 | silver | Squad 10 | REUSE | silver_squad_10 | diecut · celebrationCheers · amber/pink/sky | exact |
| silver_squad_15 | silver | Squad 15 | REUSE | silver_squad_15 | diecut · balloons · crimson | exact |
| gold_squad_25 | gold | Squad 25 | TWEAK | amethyst_squad_20 | diecut · partyPopper · teal/amber/pink/sky/white | tier amethyst→gold; banner→25 |
| amethyst_squad_40 | amethyst | Squad 40 | TWEAK | pearl_squad_master | diecut · highFive · royal | tier pearl→amethyst; banner→40 (note highFive is enamel-starved — screen at amethyst 7.2px, scale up if needed) |

### Social · Critic

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_critic_1 | bronze | First Review | NEW | — | — | no bronze critic art in v1 |
| bronze_critic_5 | bronze | Reviewer 5 | NEW | — | — | no bronze critic art in v1 |
| silver_critic_10 | silver | Reviewer 10 | REUSE | silver_critic_10 | diecut · filmStrip · ink/amber/white | exact |
| silver_critic_25 | silver | Reviewer 25 | REUSE | silver_critic_25 | diecut · megaphone · crimson/cream/amber/sky | exact |
| gold_critic_50 | gold | Reviewer 50 | TWEAK | amethyst_critic_50 | diecut · scrollUnfurled · cream/crimson/amber/ink | tier amethyst→gold |
| pearl_ultimate_critic | pearl | Ultimate Critic | REUSE | pearl_ultimate_critic | diecut · quill · crimson/amber | exact (50 ratings + 25 notes) |

### Social · Trip Organizer

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_organizer_1 | bronze | First Trip | NEW | — | — | no bronze trip art in v1 |
| silver_organizer_3 | silver | Trip Coordinator | REUSE | silver_trip_planner_3 | contained rosette · directionSigns · brown/amber/cream/crimson | exact (3 trips) |
| gold_organizer_5 | gold | Trip Captain | TWEAK | amethyst_trip_captain_5 | diecut · vintageSuitcase · brown/amber/white | tier amethyst→gold |
| amethyst_organizer_10 | amethyst | Trip Commander | NEW | — | — | 10 trips; both v1 trip motifs consumed by lower rungs |

### Social · Pinnacle

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| prism_legendary_guide | prism | Legendary Guide | NEW | — | — | Social pinnacle: 3-panel folded Walt Disney World guidemap with golden Cinderella Castle guide medallion and Mickey waypoint pin, replacing abstract flatStar placeholder |

### Resorts

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_resort_1 | bronze | First Resort | NEW | — | — | no resort-count-1 art in v1 |
| bronze_resort_3 | bronze | Resort Explorer 3 | NEW | — | — | no bronze resort-count art in v1 |
| silver_resort_6 | silver | Resort Voyager 6 | NEW | — | — | v1 resort-count starts at 12; low rung new |
| gold_resort_12 | gold | Resort Voyager 12 | TWEAK | silver_resorts_12 | diecut · bellConcierge · amber/ink | tier silver→gold, motif padlock→bellConcierge |
| amethyst_resort_20 | amethyst | Resort Explorer 20 | TWEAK | amethyst_resorts_15 | diecut · key · amber/sky/brown/crimson | banner 15→20; tier amethyst same |
| silver_monorail_loop | silver | Monorail Loop | TWEAK | bronze_monorail_resorts | diecut · monorailBeam · crimson/blue/green | tier bronze→silver |
| silver_crescent_lake | silver | Crescent Lake | TWEAK | bronze_crescent_lake_resorts | diecut · lighthouse · crimson/amber/white/navy | tier bronze→silver, motif sailboat→lighthouse (Yacht Club pier beacon) |
| silver_skyliner_resorts | silver | Skyliner Resorts | REUSE | silver_skyliner_resorts | diecut · skylinerCabin · sky/amber/crimson/purple | exact |
| pearl_deluxe_royalty | pearl | Grand Deluxe Seal | TWEAK | pearl_deluxe_royalty | contained crest · grandDeluxeSeal · crimson/pearl/gold | Neoclassical portico, laurel, 8 stars |
| prism_grand_hotelier | prism | Grand Hotelier | TWEAK | prism_grand_hotelier | diecut · grandFloridianCupola · crimson/cream/gold/stone | Grand Floridian Victorian Turret: Red shingle mansard roof, cupola belvidere with warm lantern glow, flagship galleon weathervane, gingerbread balustrade, and stepped garden entrance |

### Characters & Princesses

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_meet_1 | bronze | First Meet | REUSE | bronze_character_hug_1 | contained star · magicLamp · amber/purple/cyan/cream | exact (1 meet) |
| bronze_meet_3 | bronze | Character Trio | REUSE | bronze_character_trio_3 | contained star · dominoMask · purple/amber/white/crimson | exact |
| bronze_meet_5 | bronze | Character Friend | REUSE | bronze_character_friend_5 | diecut · autographBook · blue/amber/white | exact |
| silver_meet_10 | silver | Character Hunter | REUSE | silver_character_hunter_10 | diecut · photoCamera · scale 1.1 | exact |
| gold_meet_15 | gold | Character Collector | TWEAK | silver_meets_15 | diecut · autographQuill · cream/amber/crimson/purple | tier silver→gold |
| amethyst_meet_25 | amethyst | Character Royalty | NEW | — | colorDieCut · theLivingStorybook · purple/cream/crimson/amber | The Living Storybook / Illuminated Master Tome with gilded page edges, Gothic drop-cap, illustration, and silk bookmark (culmination of 5-stage character meet progression: Autograph Book → Camera → Quill → Living Storybook; screened 74.1% enamel @7.2px) |
| bronze_royal_encounter | bronze | Royal Encounter | REUSE | bronze_royal_encounter_1 | diecut · crown · amber/crimson/white/violet | exact (1 princess) |
| gold_princess_court | gold | Princess Court | TWEAK | silver_princess_court | diecut · enchantedRose · crimson/forest · scale 1.15 | tier silver→gold (4 princesses) |
| amethyst_all_princesses | amethyst | All Princesses | TWEAK | amethyst_meets_25 | diecut · queenCrown · amber/purple | reassigned queenCrown from amethyst_meets_25; imperial crown for meeting all Disney princesses; screened 33% enamel @7.2px |

### Touring / single-day feats

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_two_parks | bronze | Two Parks in One Day | REUSE | bronze_two_parks_day | diecut · bus · white/crimson/navy/amber/slate | exact |
| gold_three_parks | gold | Three Parks in One Day | REUSE | gold_three_parks_day | diecut · skyliner · gold/sky/crimson/slate | exact |
| amethyst_four_parks | amethyst | Four Parks in One Day | REUSE | amethyst_four_parks_day | diecut · subway · sky/amber/white/ink | exact |
| silver_6_ride_day | silver | 6-Ride Day | REUSE | silver_6_ride_sprint | diecut · speedometer · ink/crimson/cyan/white/amber | art fine; v1 criteria was "6 before 1 PM", v2 is "6 same day" |
| gold_10_ride_day | gold | 10-Ride Day | REUSE | gold_10_ride_marathon | diecut · sprint · amber | exact |
| amethyst_12_ride_day | amethyst | 12-Ride Day | REUSE | amethyst_12_ride_marathon | diecut · hourglass · amber/yellow/ice/ink | exact (note hourglass is enamel-starved at amethyst — grandfathered) |
| pearl_15_ride_marathon | pearl | 15-Ride Marathon | REUSE | pearl_15_ride_marathon | diecut · stopwatch · ink/crimson/white/amber | exact |
| gold_taste_of_the_kingdoms | gold | Taste of the Kingdoms | NEW | — | contained disc · scene tasteOfTheKingdoms · sky/teal/crimson/forest | The Grand Banquet Charger: Ceremonial gold charger plate quartered into 4 park enamels (MK Castle, EPCOT Globe, HS Clapperboard, AK Tree of Life) around raised gold 4-tined fork & knife medallion |
| silver_around_the_world | silver | Around the World | NEW | — | contained disc · scene promenadeCompass · teal/ink/crimson | The Promenade Compass: Calibrated silver promenade bezel with 11 pavilion station markers encircling deep teal/ink lagoon well with central geodesic coordinate sphere, 8-point compass rose, and XI center cap |
| prism_grand_slam | prism | Ultimate Park Hopper | NEW | — | contained disc · scene grandSlam · navy/sky/teal/crimson/forest | The 4-Park Master Compass: Prismatic rainbow metal disc with Royal Navy 15-star outer bezel, inner well quartered into 4 park royal enamels (MK Sky Blue, EPCOT Teal, DHS Crimson, DAK Forest Green), 8-point beveled compass star, and central Roman numeral XV milestone core |

### Thematic · Rides

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| bronze_coaster_rookie | bronze | Coaster Rookie | REUSE | bronze_coaster_rookie | contained crest · coasterLoop · scale 0.78 · crimson | exact |
| gold_coaster_royalty | gold | Coaster Royalty | REUSE | gold_coaster_king | diecut · coasterLoop · slate/silver/crimson/amber | exact (coaster progression reuse of coasterLoop is allowed) |
| silver_three_mountains | silver | Triple Mountain | TWEAK | amethyst_mountain_conqueror | diecut · peaks · white/ice/slate/ink | tier amethyst→silver |
| silver_water_rides_5 | silver | Water Ride Splasher | REUSE | silver_water_ride_splash | diecut · waterfallFlume · blues/whites | art fine; criteria broadened (v1 was Kali + Tiana, v2 "5 water rides") |
| amethyst_water_rides_all | amethyst | Making Waves | NEW | — | — | all water rides; adapt waterfallFlume/waterSplash at amethyst, distinct from silver |
| silver_dark_rides_6 | silver | Dark Ride Fan | REUSE | silver_dark_ride_aficionado | diecut · magicLantern · yellow/white/indigo/amber | exact (6 dark rides) |
| gold_dark_rides_all | gold | Dark Ride Master | NEW | — | colorDieCut · galleon · cream/amber | Full-Rigged Cloisonné Galleon (lorc/galleon.svg CC BY 3.0); pure die-cut ship with porcelain cream sails (#fbf7ee) and warm teak hull (#b5721a); screened 38.5% enamel @6.2px |
| bronze_spinner_1 | bronze | Spin Cycle | NEW | — | colorDieCut · teacup · plum/teal/cream/royal/amber | custom Mad Tea Party cloisonné teacup with diagonal swirling flutes and tiered pedestal saucer (screened 70% enamel @4.2px) |
| silver_spinners_all | silver | Dizzy Devotee | NEW | — | colorDieCut · magicCarpet · royal/teal/plum/amber/cream | all spinners; Adventureland Magic Carpet aerial spinner candidate (screened 78% enamel @5.5px) |
| gold_gentle_rides_all | gold | Gentle Soul | NEW | — | — | all gentle rides (carousel); no v1 gentle-ride pin |

### Thematic · Shows

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_show_enthusiast | silver | Show Enthusiast | TWEAK | bronze_theater_spectacular | diecut · theater · crimson/amber/ink/white | tier bronze→silver; banner→5 |
| gold_show_connoisseur | gold | Show Connoisseur | TWEAK | amethyst_stage_connoisseur_15 | diecut · dramaMasks · cream/crimson/ink | tier amethyst→gold (15 shows) |
| amethyst_show_devotee | amethyst | Show Devotee | NEW | — | diecut · theaterCurtainsStage · amber/royal/crimson/ink/gold | 30 shows; grand velvet proscenium curtain with recessed solo spotlight (screened 42.2% enamel @7.2px) |
| silver_nighttime_spectaculars | silver | Nighttime Spectaculars | NEW | — | contained · arch · castleFireworks · sky:night | nighttime-shows set; Cinderella Castle on baseline with glowing projection windows, shoreline reflection, and 3-burst pyrotechnic crown (Amber center, Crimson left, Sky right) |
| silver_parades | silver | Parade Watcher | NEW | — | diecut · trumpetFlag · amber/royal | all parades; true single-piece solid die-cut fanfare trumpet in brass with flush Royal Navy swallowtail banner and golden heraldic crest (`game-icons:trumpet-flag` Delapouite CC BY 3.0) |

### Thematic · Historical / signature

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_1971_club | silver | 1971 Opening Day Club | TWEAK | pearl_1971_heritage | diecut · pocketWatch · white/ink/amber | tier pearl→silver (same 9 opening-day classics) |
| silver_animatronic_classics | silver | Animatronic Classics | REUSE | silver_animatronics_veteran | diecut · tikiMacaw · crimson/amber/teal/royal · scale 1.15 | art fine; v2 criteria adds Country Bears |
| silver_flight_simulators | silver | Flight Simulator Ace | REUSE | silver_flight_sim_ace | diecut · soarinGliderWings · slate/blues/white | exact (same 4 sims) |
| bronze_target_blaster | bronze | Target Blaster | REUSE | bronze_target_blaster | diecut · rayGun · violet | exact (Buzz + TSMania) |
| silver_interstellar_pilot | silver | Interstellar Pilot | REUSE | silver_interstellar_pilot | diecut · spaceSatellite · blues/white/amber | exact |
| silver_rail_transit | silver | Rail & Transit | REUSE | silver_rail_transit | diecut · steamTrain · slate/crimson/blues | exact |
| silver_wildlife_spotter | silver | Wildlife Spotter | TWEAK | bronze_animal_spotter | diecut · lion · amber/brown/cream | tier bronze→silver |
| bronze_comedy_laughs | bronze | Comedy & Laughs | REUSE | bronze_laugh_out_loud | diecut · microphone · slate/amber/crimson/sky | exact |
| silver_circle_vision_360 | silver | Circle-Vision 360 | TWEAK | bronze_360_cinema | diecut · filmSpool · slate/ink/amber/white | tier bronze→silver; criteria adds France (v1 was Canada + China) |

### Thematic · Franchise (no v1 franchise-set pins)

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_star_wars | silver | Star Wars Devotee | NEW | — | — | all Star Wars; lightsaber motif but MUST differ from Galaxy's Edge crossedLightsabers art |
| gold_pixar_pals | gold | Pixar Pals | NEW | — | — | all Pixar experiences |
| silver_classic_characters | silver | Classic Characters | NEW | — | — | classic-character set; no Mickey ears (banned near-miss) |

### Thematic · Culture

| v2 id | tier | v2 name | class | v1 source id | v1 art recipe | notes |
|---|---|---|---|---|---|---|
| silver_world_traveler_6 | silver | World Traveler | REUSE | silver_epcot_showcase_6 | diecut · pagoda · crimson/amber/ink/forest · scale 1.15 | exact (6 WS countries) — note `pagoda`/`toriiGate` provenance issue is a CREDITS bug, recipe unchanged |
| gold_world_traveler_11 | gold | World Showcase Traveler | REUSE | gold_world_showcase_complete | diecut · world · blue/green/sky/amber | exact tier + meaning (all 11 pavilions/countries) |
| prism_global_ambassador | prism | Global Ambassador | TWEAK | prism_global_ambassador | diecut · passport · navy/ivory/azure/gold/burgundy · 11 stars | refined (Grand Folio): navy leather cover with gold corner filigrees, 3 World Showcase visa stamps (Japan sakura, UK shield, France 360), 11 pavilion gemstones orbiting geodesic globe, fanned deckled pages with silk bookmark ribbon, sculpted burgundy/black embassy fountain pen |

---

## TWEAK worklist (40) — v1 art reusable, but change required

The human job for each: take the named v1 recipe and apply the listed change. Grouped by kind of
change.

### A. Ladder rungs — reuse the B4 firework scene, change banner + composition stage (12)

The v2 Centurion ladder has 12 rungs (5·15·30·50·75·100·130·160·190·215·235 + All Attractions)
against v1's 20 (`b4fire1`–`b4fire20`, banners 10→400). For each rung: keep `shape arch`,
`sky night`, `motifEnamel B4_STAGES[n].cols`, `scale 1.4`; set the banner to the v2 threshold; and
**re-pick the stage `n`** so coverage climbs monotonically across the 12 rungs.

1. `bronze_centurion_5` ← b4fire1, banner 10→**5**.
2. `bronze_centurion_15` ← b4fire2, banner stays **15** (near-REUSE, bronze).
3. `bronze_centurion_30` ← b4fire5, banner **30**; reassign stage → ~b4fire3.
4. `silver_centurion_50` ← b4fire8, banner **50**; reassign → ~b4fire4/5.
5. `silver_centurion_75` ← b4fire10 (nearest 70), banner→**75**, tier gold→silver.
6. `gold_centurion_100` ← b4fire12, banner **100**; reassign stage.
7. `gold_centurion_130` ← b4fire13, banner 125→**130**.
8. `amethyst_centurion_160` ← b4fire14, banner 150→**160**.
9. `amethyst_centurion_190` ← b4fire16, banner 200→**190**.
10. `pearl_centurion_215` ← b4fire16/17, banner→**215**, **tier amethyst→pearl** (rim 7.2→8.2px, pearl metal + 5.5s glow).
11. `pearl_centurion_235` ← b4fire17, banner→**235**, **tier amethyst→pearl**.
12. `prism_all_attractions` ← b4fire20 (prism_grand_master), banner 400→**"ALL"/100%**; must be visually distinct from the finalised mythic capstone that already claimed b4fire20.

### B. Tier shift only — same motif/scene, different rim + metal ramp (19)

- `gold_all_lands` ← pearl_all_lands_starter (**compassRose**): pearl→gold.
- `amethyst_world_showcase` ← pearl_ws_master (**earthAfricaEurope**, scale 1.15): pearl→amethyst.
- `pearl_mk_sovereign` ← amethyst_magic_kingdom_complete (**scene castle**): amethyst→pearl.
- `pearl_epcot_sovereign` ← amethyst_epcot_complete (**wireframeGlobe**): amethyst→pearl.
- `pearl_hs_sovereign` ← amethyst_hollywood_complete (**clapperboard**): amethyst→pearl.
- `pearl_ak_sovereign` ← amethyst_animal_kingdom_complete (**holyOak**): amethyst→pearl.
- `gold_royal_banquet` ← pearl_royal_banquet_grand_slam (**tiara**): pearl→gold.
- `silver_monorail_loop` ← bronze_monorail_resorts (**monorailBeam**): bronze→silver.
- `silver_crescent_lake` ← bronze_crescent_lake_resorts (**lighthouse**): bronze→silver, motif sailboat→lighthouse (Yacht Club pier beacon).
- `silver_three_mountains` ← amethyst_mountain_conqueror (**peaks**): amethyst→silver.
- `gold_meet_15` ← silver_meets_15 (**autographQuill**): silver→gold.
- `gold_princess_court` ← silver_princess_court (**enchantedRose**): silver→gold.
- `silver_1971_club` ← pearl_1971_heritage (**pocketWatch**): pearl→silver.
- `silver_wildlife_spotter` ← bronze_animal_spotter (**lion**): bronze→silver.
- `gold_show_connoisseur` ← amethyst_stage_connoisseur_15 (**dramaMasks**): amethyst→gold.
- `gold_critic_50` ← amethyst_critic_50 (**scrollUnfurled**): amethyst→gold.
- `gold_organizer_5` ← amethyst_trip_captain_5 (**vintageSuitcase**): amethyst→gold.
- `gold_resort_12` ← silver_resorts_12 (**bellConcierge**): silver→gold (threshold 12 unchanged, motif padlock→bellConcierge).
- `amethyst_signature_all` ← amethyst_fine_dining_critic (**wineGlass**): repurpose reviews→dine-all, tier unchanged.

### C. Tier shift + banner/threshold change (5)

- `gold_signature_10` ← silver_signature_dining_2 (**chefToque**): silver→gold, banner→10.
- `gold_squad_25` ← amethyst_squad_20 (**partyPopper**): amethyst→gold, banner→25.
- `amethyst_squad_40` ← pearl_squad_master (**highFive**): pearl→amethyst, banner→40. ⚠ highFive is enamel-starved (0.233 at pearl 8.2px); re-screen at amethyst 7.2px and scale up if it fails the 0.30 floor.
- `amethyst_resort_20` ← amethyst_resorts_15 (**key**): banner 15→20, tier unchanged.
- `silver_circle_vision_360` ← bronze_360_cinema (**filmSpool**): bronze→silver, criteria adds France.

### D. New combined pins that borrow an existing land motif (2)

- `silver_boulevards` (Hollywood Blvd + Sunset Blvd): borrow **directorChair** (or drumKit) from the Studios land pins; new two-land achievement.
- `silver_immersive_lands` (Toy Story + Galaxy's Edge): borrow **crossedLightsabers** (or sheriffBadge); new two-land achievement.

### E. Motif reused but criteria widened (2, art unchanged)

- `bronze_diner_3` ← bronze_diner_1 (**hotDog**): add count banner "3".
- (art-only note) `silver_water_rides_5`, `silver_animatronic_classics`, `silver_6_ride_day` are
  classified REUSE because the recipe is unchanged even though the criteria wording widened — no art
  work needed.

---

## NEW worklist (48) — no v1 equivalent, design from scratch

One-line art brief each. Follow `docs/pin-art-direction.md`: prefer a library icon, screen through
`emblemGate` at the pin's tier rim, weld/scale/plate per the fabrication ladder.

**Restaurant-count ladder (11)** — a die-cut dining motif per rung with a count banner; v1 only had
a single "First Meal" hotDog. Distinct art per rung (dedup):
- `bronze_diner_10`, `bronze_diner_20`, `bronze_diner_30` — bronze dining icons (plate, cutlery, dish).
- `silver_foodie_45`, `silver_foodie_60` — silver dining icons.
- `gold_gourmand_80`, `gold_gourmand_100` — gold dining icons.
- `amethyst_connoisseur_120`, `amethyst_connoisseur_145` — amethyst dining icons.
- `pearl_epicure_170` — pearl fine-dining icon.
- `prism_culinary_legend` — prism "every real restaurant" pinnacle (plated feast / grand cloche).

**Festival Foodie (5)** — festival-marketplace booth/tent motif ladder with count banner:
`bronze_festival_first`, `bronze_festival_5`, `bronze_festival_10`, `silver_festival_20`,
`gold_festival_30`.

**Snacks & Lounges (7)**:
- `bronze_snacker_5`, `bronze_snacker_15`, `bronze_snacker_30`, `silver_snacker_50`,
  `gold_snacker_75` — snack motif (churro/pretzel/popcorn) with count banner.
- `bronze_coffee_crawl` — coffee cup.
- `silver_pool_bar_hopper` — tiki mug / cocktail.

**Fine dining (3)**:
- `gold_signature_10` — Milestone toast flutes clinking (`glassCelebration`).
- `silver_character_dining_3` — Rounded dining placemat setting (`placematMeal`).
- `gold_character_dining_all` — Master character chef toque (`chefToque`).

**Social — Squad/Critic/Trip low & top rungs (7)** — v1 had no bronze squad/critic/trip art:
- `bronze_squad_1` (first ride together), `bronze_squad_5`.
- `bronze_critic_1` (first review), `bronze_critic_5`.
- `bronze_organizer_1` (first trip), `amethyst_organizer_10` (10 trips — both v1 trip motifs used by lower rungs).

**Resorts low rungs (3)** — v1 resort-count art starts at 12:
- `bronze_resort_1`, `bronze_resort_3`, `silver_resort_6`.

**Characters (1)**:
- `amethyst_meet_25` — "Character Royalty"; culminates the 5-stage character meet progression (Autograph Book → Camera → Quill → Master Storybook); The Living Storybook / Illuminated Master Tome (screened 74.1% enamel @7.2px). (`amethyst_all_princesses` is classified under TWEAK as reassigned `queenCrown`).

**Touring single-day (2)**:
- `gold_taste_of_the_kingdoms` — The Grand Banquet Charger: ceremonial gold charger plate quartered into 4 park enamels with official park vector emblems (MK Castle, EPCOT Globe, HS Clapperboard, AK Tree of Life) with a raised gold central medallion of crossed 4-tined banquet fork and carving knife over deep ink.
- `silver_around_the_world` — all 11 WS countries same day (The Promenade Compass; contained silver disc with calibrated 11-station promenade bezel, central geodesic coordinate sphere, 8-point compass rose, and XI center cap in Royal Teal, Ink, Crimson; distinct from lifetime WS pins).

**Thematic rides (5)**:
- `amethyst_water_rides_all` — all water rides (big wave/splash, distinct from silver splasher).
- `gold_dark_rides_all` — all dark rides (Full-Rigged Cloisonné Galleon lorc/galleon.svg CC BY 3.0; pure die-cut ship with porcelain cream sails #fbf7ee and warm teak hull #b5721a; screened 38.5% enamel @6.2px).
- `bronze_spinner_1` — first spinner (teacups).
- `silver_spinners_all` — all spinners.
- `gold_gentle_rides_all` — all gentle rides (carousel horse / omnimover).

**Thematic shows (3)**:
- `amethyst_show_devotee` — 30 shows (Option 2: Solo Spotlight; grand velvet proscenium curtain with recessed center conical beam and shadow wings `theaterCurtainsStage`; screened 42.2% enamel @7.2px).
- `silver_nighttime_spectaculars` — nighttime-shows set; contained silver arch with Cinderella Castle on baseline, illuminated projection windows, shoreline reflection, and 3-burst pyrotechnic crown (Amber center, Crimson left, Sky right) against deep midnight sky.
- `silver_parades` — all parades; true single-piece solid die-cut fanfare trumpet in amber brass with flush Royal Navy swallowtail banner and golden crest (`game-icons:trumpet-flag` Delapouite CC BY 3.0).

**Thematic franchise (3)** — v1 had no franchise-set pins:
- `silver_star_wars` — all Star Wars; a lightsaber/saga motif that MUST differ from the Galaxy's Edge crossedLightsabers land art.
- `gold_pixar_pals` — all Pixar (Luxo ball / Pixar lamp).
- `silver_classic_characters` — classic-character set; no Mickey ears (banned near-miss) — use a classic-era film cue (Steamboat / vintage reel).

---

## Cross-cutting notes for whoever materialises this

- **Park progression reuse is intentional and allowed.** `castle` (MK starter→master→sovereign),
  `wireframeGlobe` (EPCOT), `clapperboard` (HS), `holyOak` (AK), `waterTower` (Disney Springs
  starter→complete), and `coasterLoop` (rookie→royalty) each appear on 2–3 v2 pins across tiers.
  `docs/pin-art-direction.md` §5 exempts land/park progressions from the `dedup.js` "no two pins
  render the same artwork" rule. Every other REUSE/TWEAK here targets a distinct v1 source, so no
  new dedup collisions are introduced.
- **`prism_all_attractions` vs `mythic_whole_catalog`** both descend from v1 `prism_grand_master`
  (b4fire20). Mythic's art is finalised (Aurora-Gold, `mythic-pin.html`); the attractions-ladder
  capstone must be a visibly distinct firework treatment so the two apex pins don't collide.
- **Known-fragile motifs flagged above**: `highFive` (starved) and `hourglass` (starved,
  grandfathered) — re-screen at their new tier rim and apply the fabrication ladder (weld → scale →
  plate) if they miss the 0.30 enamel floor. `magicLantern` is drawn on a 24-unit grid and only
  survives die-cut (never contained). `pagoda`/`toriiGate` have an open CREDITS/provenance issue
  (they render the same pagoda path) — that's a provenance fix, not an art-recipe change.
- These verifiers do **not** run under `npm run verify`; the pin gate is
  `node .kiro/specs/pin-collection/verify/run-all.js`. This document changed no source and adds no
  pin, so it does not itself require a gate run.
