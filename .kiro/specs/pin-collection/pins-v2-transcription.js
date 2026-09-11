/* =============================================================================
   PIN COLLECTION — v2 TRANSCRIPTION (durable artifact for spec task 6.5)
   =============================================================================
   Authoritative roster: packages/shared/src/pins/catalog.ts (174 pins).
   Art recipes: transcribed from pin-catalog-mockup.html (v1, 167 pins) per the
   mapping in art-reconciliation.md.

   WHY THIS FILE EXISTS: the transcription (matching each v2 pin to its v1 art
   recipe) is the judgment-heavy step. Capturing it here makes it survive context
   compaction — the HTML catalogue rebuild (task 6.5) becomes a mechanical merge
   of these recipes into the v2 PINS array + MOTIFS/SCENES the renderer already
   defines. NOT a runnable file on its own: `PALETTES.royal.*` / `P.*` / `B4_STAGES`
   references resolve inside pin-catalog-mockup.html, which defines them.

   status tag per pin:
     reuse    — v1 recipe copied verbatim (id/name swapped to v2)
     tweak    — v1 recipe reused with a listed change (tier / banner / combine)
     new      — no v1 ancestor; `brief` is the art brief (design WITH the user)
     resolved — art already finalised elsewhere (mythic-pin.html)

   JUDGMENT CALLS made here (flagged for review, cheap to change):
   - Centurion ladder: 12 rungs spread monotonically over B4_STAGES 1,2,4,6,8,10,
     12,14,16,17,18 and stage 19 for the "All Attractions" capstone. Stage 20 is
     LEFT for the Mythic capstone only, so prism_all_attractions (b4fire19) stays
     visually distinct from mythic_whole_catalog per the reconciliation flag.
   - Tier shifts change ONLY tier (rim width + metal ramp are derived by the
     renderer); enamel/motif carried over unchanged unless noted.

   FLAGS (resolved): amethyst_squad_40 is no longer a die-cut highFive motif — it was
   converted to the star-ladder mechanic (scene:'starLadder'), which emblemGate does not
   screen. `starved` (enamelShare < 0.30) was retired as a hard emblemGate failure — see
   docs/pin-art-direction.md §5 — so several pins previously scaled up purely to clear
   that floor (amethyst_ak_master, pearl_ak_sovereign, pearl_ultimate_critic,
   prism_legendary_guide, amethyst_resort_20, gold_three_parks, amethyst_12_ride_day,
   gold_coaster_royalty) were reverted to motifScale 1: the scale-up no longer served any
   gate purpose and only risked overflowing the 130px card, the defect actually found on
   amethyst_signature_all.
   ========================================================================== */

const PINS_V2 = [
  // ===== Attractions ladder (Centurion) — all TWEAK (B4 firework arch, sky night) =====
  { id:'bronze_centurion_5',   name:'Centurion 5',   tier:'bronze',   track:'attractions', status:'tweak', src:'bronze_centurion_10', shape:'arch', scene:'b4fire1',  sky:'night', banner:'5',   motifEnamel:'B4_STAGES[1].cols',  motifScale:1.4 },
  { id:'bronze_centurion_15',  name:'Centurion 15',  tier:'bronze',   track:'attractions', status:'tweak', src:'bronze_centurion_15', shape:'arch', scene:'b4fire2',  sky:'night', banner:'15',  motifEnamel:'B4_STAGES[2].cols',  motifScale:1.4 },
  { id:'bronze_centurion_30',  name:'Centurion 30',  tier:'bronze',   track:'attractions', status:'tweak', src:'bronze_centurion_30', shape:'arch', scene:'b4fire4',  sky:'night', banner:'30',  motifEnamel:'B4_STAGES[4].cols',  motifScale:1.4 },
  { id:'silver_centurion_50',  name:'Centurion 50',  tier:'silver',   track:'attractions', status:'tweak', src:'silver_centurion_50', shape:'arch', scene:'b4fire6',  sky:'night', banner:'50',  motifEnamel:'B4_STAGES[6].cols',  motifScale:1.4 },
  { id:'silver_centurion_75',  name:'Centurion 75',  tier:'silver',   track:'attractions', status:'tweak', src:'gold_centurion_70',   shape:'arch', scene:'b4fire8',  sky:'night', banner:'75',  motifEnamel:'B4_STAGES[8].cols',  motifScale:1.4 },
  { id:'gold_centurion_100',   name:'Centurion 100', tier:'gold',     track:'attractions', status:'tweak', src:'gold_centurion_100',  shape:'arch', scene:'b4fire10', sky:'night', banner:'100', motifEnamel:'B4_STAGES[10].cols', motifScale:1.4 },
  { id:'gold_centurion_130',   name:'Centurion 130', tier:'gold',     track:'attractions', status:'tweak', src:'gold_centurion_125',  shape:'arch', scene:'b4fire12', sky:'night', banner:'130', motifEnamel:'B4_STAGES[12].cols', motifScale:1.4 },
  { id:'amethyst_centurion_160', name:'Centurion 160', tier:'amethyst', track:'attractions', status:'tweak', src:'amethyst_centurion_150', shape:'arch', scene:'b4fire14', sky:'night', banner:'160', motifEnamel:'B4_STAGES[14].cols', motifScale:1.4 },
  { id:'amethyst_centurion_190', name:'Centurion 190', tier:'amethyst', track:'attractions', status:'tweak', src:'amethyst_centurion_200', shape:'arch', scene:'b4fire16', sky:'night', banner:'190', motifEnamel:'B4_STAGES[16].cols', motifScale:1.4 },
  { id:'pearl_centurion_215',  name:'Centurion 215', tier:'pearl',    track:'attractions', status:'tweak', src:'amethyst_centurion_250', shape:'arch', scene:'b4fire17', sky:'night', banner:'215', motifEnamel:'B4_STAGES[17].cols', motifScale:1.4 },
  { id:'pearl_centurion_235',  name:'Centurion 235', tier:'pearl',    track:'attractions', status:'tweak', src:'amethyst_centurion_250', shape:'arch', scene:'b4fire18', sky:'night', banner:'235', motifEnamel:'B4_STAGES[18].cols', motifScale:1.4 },
  { id:'prism_all_attractions', name:'All Attractions', tier:'prism', track:'attractions', status:'tweak', src:'prism_grand_master', shape:'arch', scene:'b4fire19', sky:'night', banner:'ALL', motifEnamel:'B4_STAGES[19].cols', motifScale:1.4, note:'capstone; b4fire19 keeps it distinct from mythic (b4fire20 art)' },

  // ===== Dining · Restaurants ladder =====
  // DECIDED (batch 1): "emblem + accumulating stars" mechanic — the count analog of the
  // firework ladder. Contained disc; constant cloche emblem (material-symbols:room-service,
  // Apache-2.0 -> new CREDITS row, motif key 'cloche'); starN stars accumulate 1..12 across the
  // whole ladder (no empty slots); count banner shows the exact number; tier metal climbs.
  // diner_3 unified into the mechanic (retired the lone hotDog). Apex = crown of stars.
  // scene 'starLadder' renders {emblem, starN, banner, crown?} — shared by all count ladders (dining/festival/snacks/...).
  { id:'bronze_diner_3', name:'Diner 3', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:1, banner:'3' },
  { id:'bronze_diner_10', name:'Diner 10', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:2, banner:'10' },
  { id:'bronze_diner_20', name:'Diner 20', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:3, banner:'20' },
  { id:'bronze_diner_30', name:'Diner 30', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:4, banner:'30' },
  { id:'silver_foodie_45', name:'Foodie 45', tier:'silver', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:5, banner:'45' },
  { id:'silver_foodie_60', name:'Foodie 60', tier:'silver', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:6, banner:'60' },
  { id:'gold_gourmand_80', name:'Gourmand 80', tier:'gold', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:7, banner:'80' },
  { id:'gold_gourmand_100', name:'Gourmand 100', tier:'gold', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:8, banner:'100' },
  { id:'amethyst_connoisseur_120', name:'Connoisseur 120', tier:'amethyst', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:9, banner:'120' },
  { id:'amethyst_connoisseur_145', name:'Connoisseur 145', tier:'amethyst', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:10, banner:'145' },
  { id:'pearl_epicure_170', name:'Epicure 170', tier:'pearl', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:11, banner:'170' },
  { id:'prism_culinary_legend', name:'Culinary Legend', tier:'prism', track:'dining', status:'new', scene:'starLadder', emblem:'cloche', starN:12, banner:'ALL', crown:true },

  // ===== Dining · Festival Foodie — starLadder, emblem 'storefront' (material-symbols:storefront, Apache-2.0) =====
  { id:'bronze_festival_first', name:'First Booth', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'storefront', starN:1, banner:'1' },
  { id:'bronze_festival_5', name:'Booth Sampler', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'storefront', starN:2, banner:'5' },
  { id:'bronze_festival_10', name:'Booth Explorer', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'storefront', starN:3, banner:'10' },
  { id:'silver_festival_20', name:'Booth Enthusiast', tier:'silver', track:'dining', status:'new', scene:'starLadder', emblem:'storefront', starN:4, banner:'20' },
  { id:'gold_festival_30', name:'Festival Feast', tier:'gold', track:'dining', status:'new', scene:'starLadder', emblem:'storefront', starN:5, banner:'30' },

  // ===== Dining · Snacks & Lounges — snacker = starLadder emblem 'popcorn' (game-icons, CC BY); coffee/pool single-emblem =====
  { id:'bronze_snacker_5', name:'Snacker 5', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'popcorn', starN:1, banner:'5' },
  { id:'bronze_snacker_15', name:'Snacker 15', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'popcorn', starN:2, banner:'15' },
  { id:'bronze_snacker_30', name:'Snacker 30', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'popcorn', starN:3, banner:'30' },
  { id:'silver_snacker_50', name:'Snacker 50', tier:'silver', track:'dining', status:'new', scene:'starLadder', emblem:'popcorn', starN:4, banner:'50' },
  { id:'gold_snacker_75', name:'Snacker 75', tier:'gold', track:'dining', status:'new', scene:'starLadder', emblem:'popcorn', starN:5, banner:'75' },
  { id:'bronze_coffee_crawl', name:'Coffee Crawl', tier:'bronze', track:'dining', status:'new', scene:'starLadder', emblem:'coffee', starN:0, banner:'5' },
  { id:'silver_pool_bar_hopper', name:'Pool Bar Hopper', tier:'silver', track:'dining', status:'new', scene:'starLadder', emblem:'cocktail', starN:0, banner:'8' },

  // ===== Dining · Fine Dining =====
  { id:'silver_signature_4', name:'Signature Gourmet', tier:'silver', track:'dining', status:'reuse', src:'silver_signature_4', mode:'diecut', motif:'cutDiamond', enamel:['#E0F2FE','#38BDF8','#FFFFFF','#94A3B8'] },
  { id:'gold_signature_10', name:'Signature Connoisseur', tier:'gold', track:'dining', status:'new', mode:'diecut', motif:'glassCelebration', enamel:['#fef08a','#fbf7ee','#fbf7ee','#a8323f','#a8323f'] },
  { id:'amethyst_signature_all', name:'Signature Master', tier:'amethyst', track:'dining', status:'tweak', src:'amethyst_fine_dining_critic', mode:'diecut', motif:'wineGlass', enamel:['#881337','#E2E8F0','#F59E0B'], note:'repurpose reviews→dine-all; motifScale 1 (real render reviewed and confirmed fine — bowl+foot read with colour despite low enamelShare, a thin-stem measurement artefact, not a visual defect); see docs/pin-art-direction.md §5' },
  { id:'silver_character_dining_3', name:'Character Dining Trio', tier:'silver', track:'dining', status:'new', mode:'diecut', motif:'placematMeal', enamel:['#a8323f','#ffffff','#ffffff','#fbf7ee'] },
  { id:'gold_character_dining_all', name:'Character Dining Master', tier:'gold', track:'dining', status:'new', mode:'diecut', motif:'chefToque', enamel:['#ffffff','#a8323f','#b5721a'] },
  { id:'gold_royal_banquet', name:'Royal Banquet', tier:'gold', track:'dining', status:'tweak', src:'pearl_royal_banquet_grand_slam', mode:'diecut', motif:'tiara', enamel:['#F59E0B','#DC2626'] },

  // ===== Places · Land Starters (20) — all REUSE (bronze disc) =====
  { id:'bronze_land_starter_main_street_usa', name:'Main Street, U.S.A. Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_main_street_starter', shape:'disc', motif:'trainStation', enamel:'crimson', motifDy:-3, note:'first-pass position nudge, needs visual confirmation' },
  { id:'bronze_land_starter_adventureland', name:'Adventureland Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_adventureland_starter', shape:'disc', motif:'treasureMap', enamel:'forest', motifDx:-2, note:'first-pass position nudge, needs visual confirmation' },
  { id:'bronze_land_starter_frontierland', name:'Frontierland Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_frontierland_starter', shape:'disc', motif:'mineWagon', enamel:'crimson' },
  { id:'bronze_land_starter_liberty_square', name:'Liberty Square Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_liberty_square_starter', shape:'disc', scene:'libertyBell', enamel:'crimson', motifDy:-14, note:'position nudge, iterating with user — previous +6 pushed it further down, correcting upward' },
  { id:'bronze_land_starter_fantasyland', name:'Fantasyland Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_fantasyland_starter', shape:'disc', motif:'fairyWand', enamel:'royal', motifScale:0.8, note:'root cause was scale not position — diagonal wand span was too long for the circle, both ends crowded the border regardless of translation' },
  { id:'bronze_land_starter_tomorrowland', name:'Tomorrowland Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_tomorrowland_starter', shape:'disc', motif:'rocket', enamel:'royal', motifScale:0.8, note:'root cause was scale not position — diagonal rocket span was too long for the circle, both ends crowded the border regardless of translation' },
  { id:'bronze_land_starter_world_celebration', name:'World Celebration Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_world_celebration', shape:'disc', motif:'globe', enamel:'royal' },
  { id:'bronze_land_starter_world_discovery', name:'World Discovery Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_world_discovery', shape:'disc', motif:'spaceship', enamel:'royal' },
  { id:'bronze_land_starter_world_nature', name:'World Nature Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_world_nature', shape:'disc', motif:'turtle', enamel:'teal' },
  { id:'bronze_land_starter_world_showcase', name:'World Showcase Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_world_showcase_starter', shape:'disc', motif:'world', enamel:'teal' },
  { id:'bronze_land_starter_hollywood_boulevard', name:'Hollywood Boulevard Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_hollywood_blvd_starter', shape:'disc', motif:'directorChair', enamel:'crimson' },
  { id:'bronze_land_starter_echo_lake', name:'Echo Lake Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_echo_lake_starter', shape:'disc', motif:'fedora', enamel:'crimson' },
  { id:'bronze_land_starter_animation_courtyard', name:'Animation Courtyard Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_animation_courtyard_starter', shape:'disc', motif:'filmProjector', enamel:'crimson' },
  { id:'bronze_land_starter_sunset_boulevard', name:'Sunset Boulevard Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_sunset_blvd_starter', shape:'disc', scene:'drumKit', enamel:'crimson', motifDy:-17, motifScale:0.88, note:'fine-tuning nudge, close to centered at -14, small further bump' },
  { id:'bronze_land_starter_toy_story_land', name:'Toy Story Land Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_toy_story_starter', shape:'disc', scene:'sheriffBadge', enamel:'crimson', motifScale:1.25, note:'floating too small with excess margin; scaling up' },
  { id:'bronze_land_starter_star_wars_galaxys_edge', name:"Star Wars: Galaxy's Edge Starter", tier:'bronze', track:'places', status:'reuse', src:'bronze_galaxys_edge_starter', shape:'disc', scene:'crossedLightsabers', enamel:'royal', motifScale:1.15, note:'floating a bit small with excess margin; scaling up (smaller bump than the other two, was closer already)' },
  { id:'bronze_land_starter_discovery_island', name:'Discovery Island Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_discovery_island_starter', shape:'disc', motif:'flamingo', enamel:'forest' },
  { id:'bronze_land_starter_pandora_the_world_of_avatar', name:'Pandora – The World of Avatar Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_pandora_starter', shape:'disc', motif:'wyvern', enamel:'forest' },
  { id:'bronze_land_starter_africa', name:'Africa Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_africa_starter', shape:'disc', motif:'elephant', enamel:'forest' },
  { id:'bronze_land_starter_asia', name:'Asia Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_asia_starter', shape:'disc', motif:'tiger', enamel:'forest', motifDx:3, motifDy:-4, note:'first-pass position nudge, needs visual confirmation' },

  // ===== Places · Park Starters (7) — all REUSE (bronze disc) =====
  { id:'bronze_park_starter_magic_kingdom', name:'Magic Kingdom Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_mk_starter', shape:'disc', scene:'castle', anchor:'center', motifScale:1.0, enamel:'sky' },
  { id:'bronze_park_starter_epcot', name:'EPCOT Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_epcot_starter', shape:'disc', motif:'wireframeGlobe', motifScale:1.0, enamel:'teal' },
  { id:'bronze_park_starter_hollywood_studios', name:'Hollywood Studios Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_hs_starter', shape:'disc', motif:'clapperboard', motifScale:0.95, enamel:'crimson' },
  { id:'bronze_park_starter_animal_kingdom', name:'Animal Kingdom Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_ak_starter', shape:'disc', motif:'holyOak', motifScale:1.0, enamel:'forest' },
  { id:'bronze_park_starter_typhoon_lagoon', name:'Typhoon Lagoon Starter', tier:'bronze', track:'places', status:'tweak', src:'bronze_typhoon_lagoon', shape:'disc', motif:'waterSplashLagoon', motifScale:0.92, enamel:'teal', note:'motif waterSplash→waterSplashLagoon: matches silver_typhoon_lagoon (dropped the 3 detached droplet accents there for the die-cut fix), so both tiers of this land pair now share one motif key like every other bronze/silver/gold pair in this track' },
  { id:'bronze_park_starter_blizzard_beach', name:'Blizzard Beach Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_blizzard_beach', shape:'disc', motif:'snowflake', motifScale:0.92, enamel:'sky' },
  { id:'bronze_park_starter_disney_springs', name:'Disney Springs Starter', tier:'bronze', track:'places', status:'reuse', src:'bronze_disney_springs', shape:'disc', motif:'waterTower', motifScale:0.98, enamel:'teal' },

  // ===== Places · Silver completions =====
  { id:'silver_land_adventureland', name:'Adventureland 100%', tier:'silver', track:'places', status:'reuse', src:'silver_adventureland_100', mode:'diecut', motif:'treasureMap', enamel:['#FEF3C7','#16A34A','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626','#DC2626'] },
  { id:'silver_land_discovery_island', name:'Discovery Island 100%', tier:'silver', track:'places', status:'reuse', src:'silver_discovery_island_100', mode:'diecut', motif:'flamingo', enamel:['#EC4899','#F43F5E'] },
  { id:'silver_land_animation_courtyard', name:'Animation Courtyard 100%', tier:'silver', track:'places', status:'reuse', src:'silver_animation_courtyard_100', mode:'diecut', motif:'filmProjector', enamel:['#334155','#F59E0B','#DC2626','#FFFFFF'] },
  { id:'silver_land_frontierland', name:'Frontierland 100%', tier:'silver', track:'places', status:'reuse', src:'silver_frontierland_100', mode:'diecut', motif:'mineWagon', enamel:['#78350F','#F59E0B','#B45309','#1E293B'] },
  { id:'silver_land_asia', name:'Asia 100%', tier:'silver', track:'places', status:'reuse', src:'silver_asia_100', mode:'diecut', motif:'tiger', enamel:['#EA580C','#FFFFFF','#0F172A','#FFFFFF','#EA580C','#0F172A','#0F172A','#0F172A'] },
  { id:'silver_land_world_discovery', name:'World Discovery 100%', tier:'silver', track:'places', status:'reuse', src:'silver_world_discovery_100', colorDieCut:true, motif:'spaceship', motifScale:1.35, enamel:['#0284C7','#F59E0B','#DC2626','#FFFFFF','#0F172A'], note:'GATE FIX: raw spaceship motif is 16 pieces (hull+fins+flames) at effective rim (silver 5.2px/1.35 scale); welded via galleon-style outer-rim-weld with original 5-colour enamel poured back on top (see renderColorDieCut)' },
  { id:'silver_boulevards', name:'The Boulevards', tier:'silver', track:'places', status:'tweak', src:'silver_hollywood_blvd_100', mode:'diecut', motif:'directorChair', enamel:['#1E293B','#FFFFFF','#DC2626','#F59E0B'], note:'combined Hollywood+Sunset; borrows directorChair' },
  { id:'silver_immersive_lands', name:'Immersive Lands', tier:'silver', track:'places', status:'new', mode:'contained', shape:'arch', scene:'gatewayTwoWorlds', enamel:['#0284c7','#1e103a','#e5ab2c','#ffffff','#120c24'], note:'Gateway of Two Worlds: 50/50 split arch featuring Andy\'s wallpaper cloud and Woody\'s sheriff badge on left, Batuu twin moons and Black Spire rocks on right.' },
  { id:'silver_typhoon_lagoon', name:'Typhoon Lagoon 100%', tier:'silver', track:'places', status:'reuse', src:'silver_typhoon_lagoon_master', mode:'diecut', motif:'waterSplashLagoon', enamel:['#06B6D4','#0C4A6E','#FFFFFF'], note:'GATE FIX (trim, not weld or plate): raw waterSplash is 6 cells — 3 DETACHED droplet accents per docs/pin-art-direction.md §5 (still separate pieces even at 3x rim, no union reaches them) plus a crown/wave/base group that is ALREADY one connected piece at the real silver 5.2px rim with no fabrication needed. Dropped the 3 detached droplets (as a plate/contained mode would have made this the only enclosed "100%" pin above bronze in its own track, inconsistent with every sibling); kept the connected group as a true die-cut motif (waterSplashLagoon) — emblemGate: 1 piece, 50% enamel, no fails.' },
  { id:'silver_blizzard_beach', name:'Blizzard Beach 100%', tier:'silver', track:'places', status:'reuse', src:'silver_blizzard_beach_master', mode:'diecut', motif:'snowflake', enamel:['#38BDF8','#0284C7'] },

  // ===== Places · Gold completions =====
  { id:'gold_land_fantasyland', name:'Fantasyland 100%', tier:'gold', track:'places', status:'reuse', src:'gold_fantasyland_complete', colorDieCut:true, motif:'fairyWandHalo', rim:8, enamel:['#A855F7','#F59E0B','#FFFFFF','#EC4899'], note:'GATE FIX: raw fairyWand is 4 pieces at gold 6.2px rim. Real closedOutline on union at bridge 8 (8px halo rim) encompasses wand shaft, main star, and 4 near sparkles into one unified die-cut plate with cloisonne enamel poured back on top; dropping the 2 detached sparkles 30-36px away; verified componentCount(outline+motif, 8px, union)=1.' },
  { id:'gold_land_main_street', name:'Main Street, U.S.A. 100%', tier:'gold', track:'places', status:'reuse', src:'gold_main_street_complete', mode:'diecut', motif:'trainStation', enamel:['#DC2626','#F59E0B','#334155'] },
  { id:'gold_land_tomorrowland', name:'Tomorrowland 100%', tier:'gold', track:'places', status:'reuse', src:'gold_tomorrowland_complete', colorDieCut:true, motif:'rocket', enamel:['#4A90E2','#FFFFFF','#F59E0B','#1E3A8A','#EF4444'], note:'GATE FIX: raw rocket motif is 2 pieces at gold 6.2px rim; welded via galleon-style outer-rim-weld with original 5-colour enamel poured back on top (see renderColorDieCut)' },
  { id:'gold_land_world_nature', name:'World Nature 100%', tier:'gold', track:'places', status:'reuse', src:'gold_world_nature_complete', mode:'diecut', motif:'turtle', enamel:['#0284C7','#16A34A','#FEF3C7','#0F766E'] },
  { id:'gold_land_world_celebration', name:'World Celebration 100%', tier:'gold', track:'places', status:'reuse', src:'gold_world_celebration_complete', mode:'diecut', motif:'globe', enamel:['#0284C7','#059669','#38BDF8'] },
  { id:'gold_land_africa', name:'Africa 100%', tier:'gold', track:'places', status:'reuse', src:'gold_africa_complete', mode:'diecut', motif:'elephant', enamel:['#64748B','#64748B','#FFFFFF','#64748B','#64748B','#64748B','#64748B'] },
  { id:'gold_disney_springs', name:'Disney Springs 100%', tier:'gold', track:'places', status:'reuse', src:'gold_disney_springs_master', mode:'diecut', motif:'waterTower', enamel:['#14727F','#78350F','#334155','#F59E0B'] },
  { id:'gold_all_lands', name:'All Lands Explorer', tier:'gold', track:'places', status:'tweak', src:'pearl_all_lands_starter', mode:'diecut', motif:'compassRose', enamel:['#d97706','#dc2626','#ffffff','#0f172a'], note:'tier pearl→gold' },

  // ===== Places · Amethyst mastery =====
  { id:'amethyst_world_showcase', name:'World Showcase 100%', tier:'amethyst', track:'places', status:'tweak', src:'pearl_ws_master', mode:'diecut', motif:'earthAfricaEurope', motifScale:1.15, enamel:['PALETTES.royal.sky','PALETTES.royal.forest','PALETTES.royal.teal','PALETTES.royal.royal'], note:'tier pearl→amethyst' },
  { id:'amethyst_mk_master', name:'Magic Kingdom Master', tier:'amethyst', track:'places', status:'reuse', src:'amethyst_magic_kingdom_complete', mode:'diecut', scene:'castle', enamel:['#2f6bb0','#e2e8f0','#8a45c9'] },
  { id:'amethyst_epcot_master', name:'EPCOT Master', tier:'amethyst', track:'places', status:'reuse', src:'amethyst_epcot_complete', mode:'diecut', motif:'wireframeGlobe', allowRound:true, roundReason:'a globe is round; the circle IS the object, not a frame around one', enamel:['#14727f','#e2e8f0','#8a45c9'] },
  { id:'amethyst_hs_master', name:'Hollywood Studios Master', tier:'amethyst', track:'places', status:'reuse', src:'amethyst_hollywood_complete', mode:'diecut', motif:'clapperboard', enamel:['#a8323f','#e2e8f0','#8a45c9'] },
  { id:'amethyst_ak_master', name:'Animal Kingdom Master', tier:'amethyst', track:'places', status:'reuse', src:'amethyst_animal_kingdom_complete', mode:'diecut', motif:'holyOak', enamel:['#2f7d3e','#e2e8f0','#8a45c9'] },

  // ===== Places · Pearl sovereigns (tier amethyst→pearl; same emblem) =====
  { id:'pearl_mk_sovereign', name:'Magic Kingdom Sovereign', tier:'pearl', track:'places', status:'tweak', src:'amethyst_magic_kingdom_complete', mode:'diecut', scene:'castle', enamel:['#2f6bb0','#e2e8f0','#8a45c9'] },
  { id:'pearl_epcot_sovereign', name:'EPCOT Sovereign', tier:'pearl', track:'places', status:'tweak', src:'amethyst_epcot_complete', mode:'diecut', motif:'wireframeGlobe', allowRound:true, roundReason:'a globe is round; the circle IS the object, not a frame around one', enamel:['#14727f','#e2e8f0','#8a45c9'] },
  { id:'pearl_hs_sovereign', name:'Hollywood Studios Sovereign', tier:'pearl', track:'places', status:'tweak', src:'amethyst_hollywood_complete', mode:'diecut', motif:'clapperboard', enamel:['#a8323f','#e2e8f0','#8a45c9'] },
  { id:'pearl_ak_sovereign', name:'Animal Kingdom Sovereign', tier:'pearl', track:'places', status:'tweak', src:'amethyst_animal_kingdom_complete', mode:'diecut', motif:'holyOak', enamel:['#2f7d3e','#e2e8f0','#8a45c9'] },
  { id:'pearl_four_parks_master', name:'Four Parks Master', tier:'pearl', track:'places', status:'reuse', src:'pearl_four_parks_master', shape:'crest', scene:'fourParksMaster' },

  // ===== Places · Mythic capstone (RESOLVED — Option 4: Golden Sovereign E-Ticket locked) =====
  { id:'mythic_whole_catalog', name:'The Whole Catalog', tier:'mythic', track:'places', status:'resolved', src:'mythic-pin.html', mode:'diecut', motif:'ticket', scene:'goldenMasterTicket', enamel:['#a8323f'], note:'1-of-1 Mythic Capstone: Golden Sovereign E-Ticket in Aurora-Gold and Royal crimson velvet enamel (#a8323f) with centered minted 100% seal and Polaris accent stars. Option 4 locked in.' },

  // ===== Social · Squad — star-ladder: constant 'friendsTrio' emblem + accumulating stars (1..6) =====
  // DECIDED: whole track unified as a star-ladder (like dining) — retires the v1 party motifs
  // (celebrationCheers/balloons/partyPopper/highFive) that were an incoherent set and made
  // Squad 5 vs 10 read as near-duplicates. Steps up per rung: +1 star, tier metal climb, banner.
  { id:'bronze_squad_1', name:'First Ride Together', tier:'bronze', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:1, banner:'1' },
  { id:'bronze_squad_5', name:'Squad 5', tier:'bronze', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:2, banner:'5' },
  { id:'silver_squad_10', name:'Squad 10', tier:'silver', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:3, banner:'10' },
  { id:'silver_squad_15', name:'Squad 15', tier:'silver', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:4, banner:'15' },
  { id:'gold_squad_25', name:'Squad 25', tier:'gold', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:5, banner:'25' },
  { id:'amethyst_squad_40', name:'Squad 40', tier:'amethyst', track:'social', status:'new', scene:'starLadder', emblem:'friendsTrio', starN:6, banner:'40', crown:true },

  // ===== Social · Critic =====
  { id:'bronze_critic_1', name:'First Review', tier:'bronze', track:'social', status:'new', scene:'starLadder', emblem:'reviews', starN:0, banner:'1' },
  { id:'bronze_critic_5', name:'Reviewer 5', tier:'bronze', track:'social', status:'new', scene:'starLadder', emblem:'rateReview', starN:0, banner:'5' },
  { id:'silver_critic_10', name:'Reviewer 10', tier:'silver', track:'social', status:'reuse', src:'silver_critic_10', mode:'diecut', motif:'filmStrip', enamel:['#1E293B','#F59E0B','#FFFFFF'] },
  { id:'silver_critic_25', name:'Reviewer 25', tier:'silver', track:'social', status:'reuse', src:'silver_critic_25', colorDieCut:true, motif:'megaphone', enamel:['#DC2626','#FEF3C7','#F59E0B','#0284C7'], note:'GATE FIX: raw megaphone motif is 4 pieces at silver 5.2px rim; welded via galleon-style outer-rim-weld (verified single continuous outline covering 99% of the full motif area, not a small corner) with original 4-colour enamel poured back on top (see renderColorDieCut)' },
  { id:'gold_critic_50', name:'Reviewer 50', tier:'gold', track:'social', status:'tweak', src:'amethyst_critic_50', mode:'diecut', motif:'scrollUnfurled', enamel:['#FEF3C7','#DC2626','#F59E0B','#1E293B'] },
  { id:'pearl_ultimate_critic', name:'Ultimate Critic', tier:'pearl', track:'social', status:'reuse', src:'pearl_ultimate_critic', mode:'diecut', motif:'quill', enamel:['#DC2626','#F59E0B'] },

  // ===== Social · Trip Organizer =====
  { id:'bronze_organizer_1', name:'First Trip', tier:'bronze', track:'social', status:'new', scene:'starLadder', emblem:'airplaneDeparture', starN:0, banner:'1' },
  { id:'silver_organizer_3', name:'Trip Coordinator', tier:'silver', track:'social', status:'reuse', src:'silver_trip_planner_3', shape:'rosette', motif:'directionSigns', enamel:'ink', note:'BUGFIX: was a 4-colour array left over from its v1 die-cut form, but this is a CONTAINED pin whose enamel is the single well colour — the array emitted an invalid comma-joined SVG fill. Single Royal tone chosen for metal-motif contrast.' },
  { id:'gold_organizer_5', name:'Trip Captain', tier:'gold', track:'social', status:'tweak', src:'amethyst_trip_captain_5', mode:'diecut', motif:'vintageSuitcase', enamel:['#78350F','#D97706','#F8FAFC'] },
  { id:'amethyst_organizer_10', name:'Trip Commander', tier:'amethyst', track:'social', status:'new', colorDieCut:true, motif:'__balloon', enamel:['#a8323f','#f59e0b','#14727f','#4a2a7a'], note:'trimmed a 5th colour (#78350f) that never rendered — balloon art has 4 cells and renderColorDieCut maps enamel per cell' },

  // ===== Social · Pinnacle =====
  { id:'prism_legendary_guide', name:'Legendary Guide', tier:'prism', track:'social', status:'new', mode:'diecut', motif:'disneyGuidemap', enamel:['#FEF3C7','#1E3A8A','#FFD700','#DC2626'], note:'Social pinnacle: 3-panel folded Walt Disney World guidemap with golden Cinderella Castle guide medallion and Mickey waypoint pin, replacing abstract flatStar placeholder' },

  // ===== Resorts =====
  { id:'bronze_resort_1', name:'First Resort', tier:'bronze', track:'resorts', status:'new', scene:'starLadder', emblem:'concierge', starN:0, banner:'1' },
  { id:'bronze_resort_3', name:'Resort Explorer 3', tier:'bronze', track:'resorts', status:'new', scene:'starLadder', emblem:'hotelBed', starN:0, banner:'3' },
  { id:'silver_resort_6', name:'Resort Voyager 6', tier:'silver', track:'resorts', status:'new', scene:'starLadder', emblem:'villa', starN:0, banner:'6' },
  { id:'gold_resort_12', name:'Resort Voyager 12', tier:'gold', track:'resorts', status:'tweak', src:'silver_resorts_12', mode:'diecut', motif:'bellConcierge', enamel:['#F59E0B','#1E293B'], note:'tier silver→gold, motif padlock→bellConcierge' },
  { id:'amethyst_resort_20', name:'Resort Explorer 20', tier:'amethyst', track:'resorts', status:'tweak', src:'amethyst_resorts_15', mode:'diecut', motif:'key', banner:'20', enamel:['#F59E0B','#0284C7','#78350F','#DC2626'] },
  { id:'silver_monorail_loop', name:'Monorail Loop', tier:'silver', track:'resorts', status:'tweak', src:'bronze_monorail_resorts', colorDieCut:true, motif:'monorailScene', enamel:['#F8FAFC','#DC2626','#0284C7','#64748B'], note:'tier bronze→silver, authentic WDW Mark VI monorail (aerodynamic bullet nose + Monorail Red beltline stripe on elevated beam with flared pylon, ref: Twemoji monorail cleaned of roof clutter)' },
  { id:'silver_crescent_lake', name:'Crescent Lake', tier:'silver', track:'resorts', status:'tweak', src:'bronze_crescent_lake_resorts', mode:'diecut', motif:'lighthouse', enamel:['#A8323F','#F59E0B','#F59E0B','#F59E0B','#F59E0B','#F8FAFC','#1E3A8A','#1E3A8A'], note:'tier bronze→silver, motif sailboat→lighthouse (Yacht Club pier beacon)' },
  { id:'silver_skyliner_resorts', name:'Skyliner Resorts', tier:'silver', track:'resorts', status:'reuse', src:'silver_skyliner_resorts', mode:'diecut', motif:'skylinerCabin', enamel:['#0284C7','#F59E0B','#DC2626','#7C3AED'] },
  { id:'pearl_deluxe_royalty', name:'Grand Deluxe Seal', tier:'pearl', track:'resorts', status:'tweak', src:'pearl_deluxe_royalty', shape:'crest', scene:'grandDeluxeSeal' },
  { id:'prism_grand_hotelier', name:'Grand Hotelier', tier:'prism', track:'resorts', status:'tweak', src:'prism_grand_hotelier', mode:'diecut', scene:'grandHotelier', enamel:['#A8323F','#FDFBF7','#F59E0B','#E2E8F0'], note:'tier prism, Grand Floridian Victorian Turret: Red shingle mansard roof, cupola belvidere with warm lantern glow, flagship galleon weathervane, gingerbread balustrade, and stepped garden terrace; culminates the Resorts track for all ~30 Disney resorts.' },

  // ===== Characters & Princesses =====
  { id:'bronze_meet_1', name:'First Meet', tier:'bronze', track:'characters', status:'reuse', src:'bronze_character_hug_1', shape:'star', motif:'magicLamp', enamel:'royal', note:'BUGFIX: contained pin carried a v1 die-cut colour array, which emitted an invalid comma-joined SVG fill; royal keeps the original purple intent' },
  { id:'bronze_meet_3', name:'Character Trio', tier:'bronze', track:'characters', status:'reuse', src:'bronze_character_trio_3', shape:'star', motif:'dominoMask', enamel:'plum', note:'BUGFIX: contained pin carried a v1 die-cut colour array, which emitted an invalid comma-joined SVG fill; plum keeps the original purple intent' },
  { id:'bronze_meet_5', name:'Character Friend', tier:'bronze', track:'characters', status:'reuse', src:'bronze_character_friend_5', mode:'diecut', motif:'autographBook', enamel:['#2563EB','#F59E0B','#F8FAFC'] },
  { id:'silver_meet_10', name:'Character Hunter', tier:'silver', track:'characters', status:'reuse', src:'silver_character_hunter_10', mode:'diecut', motif:'photoCamera', motifScale:1.1, enamel:['PALETTES.royal.crimson','PALETTES.royal.amber','PALETTES.royal.sky','PALETTES.royal.royal'] },
  { id:'gold_meet_15', name:'Character Collector', tier:'gold', track:'characters', status:'tweak', src:'silver_meets_15', mode:'diecut', motif:'autographQuill', enamel:['#FEF3C7','#FDE68A','#DC2626','#F59E0B','#6B21A8'] },
  { id:'amethyst_meet_25', name:'Character Royalty', tier:'amethyst', track:'characters', status:'new', colorDieCut:true, motif:'theLivingStorybook', enamel:['#4a2a7a','#fbf7ee'], note:'The Living Storybook / Illuminated Master Tome with gilded page edges, Gothic illuminated drop-cap, fairytale illustration, and silk bookmark; culminates the 5-stage character meet progression; screened 74.1% enamel @7.2px' },
  { id:'bronze_royal_encounter', name:'Royal Encounter', tier:'bronze', track:'characters', status:'reuse', src:'bronze_royal_encounter_1', mode:'diecut', motif:'crown', enamel:['#F59E0B','#DC2626','#FFFFFF','#9333EA'] },
  { id:'gold_princess_court', name:'Princess Court', tier:'gold', track:'characters', status:'tweak', src:'silver_princess_court', mode:'diecut', motif:'enchantedRose', motifScale:1.15, enamel:['PALETTES.royal.crimson','PALETTES.royal.crimson','PALETTES.royal.forest','PALETTES.royal.forest','PALETTES.royal.forest','PALETTES.royal.forest','PALETTES.royal.forest'] },
  { id:'amethyst_all_princesses', name:'All Princesses', tier:'amethyst', track:'characters', status:'tweak', src:'amethyst_meets_25', mode:'diecut', motif:'queenCrown', enamel:['#f59e0b','#581c87'], note:'reassigned queenCrown from amethyst_meets_25 to All Princesses; imperial crown for meeting all Disney princesses; screened 33% enamel @7.2px' },

  // ===== Touring / single-day feats =====
  { id:'bronze_two_parks', name:'Two Parks in One Day', tier:'bronze', track:'touring', status:'reuse', src:'bronze_two_parks_day', colorDieCut:true, motif:'bus', enamel:['#FFFFFF','#DC2626','#1E3A8A','#F59E0B','#475569'], note:'GATE FIX: raw bus motif renders with only cell0 (body, 464x174 of the 464x222 full motif) getting the real outer rim under classifyCells; the two wheel cells (8,9, plus their hub-dot cells 10,11) sit 96-100% outside cell0\'s silhouette and only got a thin interior wireline, so the wheels floated as loosely-tied rings rather than connected metal (confirmed visually, unlike the world/waterTower false alarms this session). Welded via galleon-style outer-rim-weld (single continuous outline, 99.7% bbox coverage of full motif, every cell 95-100% covered) with original 5-colour enamel poured back on top.' },
  { id:'gold_three_parks', name:'Three Parks in One Day', tier:'gold', track:'touring', status:'reuse', src:'gold_three_parks_day', mode:'diecut', motif:'skyliner', enamel:['#EAB308','#38BDF8','#DC2626','#475569'] },
  { id:'amethyst_four_parks', name:'Four Parks in One Day', tier:'amethyst', track:'touring', status:'reuse', src:'amethyst_four_parks_day', mode:'diecut', motif:'subway', enamel:['#0284C7','#F59E0B','#FFFFFF','#1E293B'] },
  { id:'silver_6_ride_day', name:'6-Ride Day', tier:'silver', track:'touring', status:'reuse', src:'silver_6_ride_sprint', colorDieCut:true, motif:'speedometer', enamel:['#1E293B','#DC2626','#00E5FF','#FFFFFF','#F59E0B'], note:'GATE FIX: raw speedometer motif is 2 pieces (needle vs dial+base) at silver 5.2px rim; welded via galleon-style outer-rim-weld with original 5-colour enamel poured back on top (see renderColorDieCut)' },
  { id:'gold_10_ride_day', name:'10-Ride Day', tier:'gold', track:'touring', status:'reuse', src:'gold_10_ride_marathon', mode:'diecut', motif:'sprint', enamel:['#F59E0B'] },
  { id:'amethyst_12_ride_day', name:'12-Ride Day', tier:'amethyst', track:'touring', status:'reuse', src:'amethyst_12_ride_marathon', mode:'diecut', motif:'hourglass', enamel:['#D97706','#FDE047','#E0F2FE','#1E293B'] },
  { id:'pearl_15_ride_marathon', name:'15-Ride Marathon', tier:'pearl', track:'touring', status:'reuse', src:'pearl_15_ride_marathon', mode:'diecut', motif:'stopwatch', enamel:['#1E293B','#DC2626','#FFFFFF','#F59E0B'] },
  { id:'gold_taste_of_the_kingdoms', name:'Taste of the Kingdoms', tier:'gold', track:'touring', status:'new', mode:'contained', shape:'disc', scene:'tasteOfTheKingdoms', enamel:['PALETTES.royal.sky','PALETTES.royal.teal','PALETTES.royal.crimson','PALETTES.royal.forest'], note:'The Grand Banquet Charger: Ceremonial gold charger plate quartered into 4 park enamels with official park vector emblems (MK Castle, EPCOT Globe, HS Clapperboard, AK Tree of Life), anchored by a raised gold central medallion of crossed 4-tined banquet fork and carving knife over deep ink.' },
  { id:'silver_around_the_world', name:'Around the World', tier:'silver', track:'touring', status:'new', mode:'contained', shape:'disc', scene:'promenadeCompass', enamel:['PALETTES.royal.teal','PALETTES.royal.ink','PALETTES.royal.crimson'], note:'The Promenade Compass: Calibrated silver promenade bezel with 11 pavilion station markers encircling deep teal/ink lagoon well with central geodesic coordinate sphere, 8-point compass rose, and XI center cap.' },
  { id:'prism_grand_slam', name:'Ultimate Park Hopper', tier:'prism', track:'touring', status:'new', mode:'contained', shape:'disc', scene:'grandSlam', note:'The 4-Park Master Compass: Prismatic rainbow metal disc with Royal Navy 15-star outer bezel, inner well quartered into 4 park royal enamels (MK Sky Blue, EPCOT Teal, DHS Crimson, DAK Forest Green), 8-point beveled compass star, and central Roman numeral XV milestone core.' },

  // ===== Thematic · Rides =====
  { id:'bronze_coaster_rookie', name:'Coaster Rookie', tier:'bronze', track:'thematic', status:'reuse', src:'bronze_coaster_rookie', shape:'crest', motif:'coasterLoop', motifScale:0.78, enamel:'crimson' },
  { id:'gold_coaster_royalty', name:'Coaster Royalty', tier:'gold', track:'thematic', status:'reuse', src:'gold_coaster_king', mode:'diecut', motif:'coasterLoop', enamel:['#475569','#94a3b8','#dc2626','#f59e0b'] },
  { id:'silver_three_mountains', name:'Triple Mountain', tier:'silver', track:'thematic', status:'tweak', src:'amethyst_mountain_conqueror', mode:'diecut', motif:'peaks', enamel:['#ffffff','#f1f5f9','#475569','#1e293b'], note:'tier amethyst→silver' },
  { id:'silver_water_rides_5', name:'Water Ride Splasher', tier:'silver', track:'thematic', status:'reuse', src:'silver_water_ride_splash', colorDieCut:true, motif:'waterfallFlume', enamel:['#334155','#334155','#0284C7','#38BDF8','#38BDF8','#38BDF8','#0EA5E9','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#F0FDF4','#FFFFFF'], note:'GATE FIX: raw waterfallFlume motif is 3 pieces at silver 5.2px rim; welded via galleon-style outer-rim-weld (verified single continuous outline covering 99% of the full motif area) with original 13-colour enamel poured back on top (see renderColorDieCut)' },
  { id:'amethyst_water_rides_all', name:'Making Waves', tier:'amethyst', track:'thematic', status:'new', mode:'diecut', motif:'sailboat', enamel:['#14727f','#f4e9d0','#2f6bb0'], note:'game-icons sailboat (CC BY 3.0); boat ride vehicle; screened 40% enamel @7.2px' },
  { id:'silver_dark_rides_6', name:'Dark Ride Fan', tier:'silver', track:'thematic', status:'reuse', src:'silver_dark_ride_aficionado', mode:'diecut', motif:'magicLantern', rim:5.8, enamel:['#FDE047','#FFFFFF','#FDE047','#1E1B4B','#F59E0B'], note:'GATE FIX: stars repositioned closer to wand body with balanced spacing (dx=+0.40, dy=+0.65 on top silver star; dx=-1.35, dy=-0.95 on right white star; left yellow star preserved) and 5.8px silver rim, fusing metal borders into 1 unified die-cut piece without excessive overlap or enamel notch artifacts.' },
  { id:'gold_dark_rides_all', name:'Dark Ride Master', tier:'gold', track:'thematic', status:'new', colorDieCut:true, motif:'galleon', enamel:['#fbf7ee'], note:'Full-Rigged Cloisonné Galleon (lorc/galleon.svg CC BY 3.0); pure die-cut ship with porcelain cream sails (#fbf7ee) and warm teak hull (#b5721a); screened 38.5% enamel @6.2px' },
  { id:'bronze_spinner_1', name:'Spin Cycle', tier:'bronze', track:'thematic', status:'new', colorDieCut:true, motif:'teacup', enamel:['#6a3fb0','#14727f'], note:'custom Mad Tea Party cloisonné teacup with diagonal swirling flutes, tiered pedestal saucer, and tea vortex ripple; screened 70% enamel @4.2px' },
  { id:'silver_spinners_all', name:'Dizzy Devotee', tier:'silver', track:'thematic', status:'new', colorDieCut:true, motif:'magicCarpet', enamel:['#4a2a7a','#14727f','#6a3fb0','#b5721a','#fbf7ee'], note:'Adventureland Magic Carpet billowing aerial spinner vehicle with corner tassels and center sunburst; screened 78% enamel @5.5px' },
  { id:'gold_gentle_rides_all', name:'Gentle Soul', tier:'gold', track:'thematic', status:'new', colorDieCut:true, motif:'carouselHorse', enamel:['#fbf7ee','#4a2a7a'], note:'emojione:carousel-horse (CC BY 4.0); Prince Charming Regal Carrousel / all gentle rides; leaping carousel horse on brass pole with cream coat (#fbf7ee), royal purple saddle/trappings (#4a2a7a), and gold dividing lines' },

  // ===== Thematic · Shows =====
  { id:'silver_show_enthusiast', name:'Show Enthusiast', tier:'silver', track:'thematic', status:'tweak', src:'bronze_theater_spectacular', colorDieCut:true, motif:'theater', banner:'5', enamel:['#991B1B','#F59E0B','#1E293B','#FFFFFF'], note:'tier bronze→silver; GATE FIX: raw theater motif is 2 pieces at silver 5.2px rim (screen and crowd sit ~19px apart, well beyond a normal weld bridge). Custom render uses a padded convex hull of the WHOLE scene (screen+crowd) as the one-piece outer rim, with the gap between screen and crowd filled by a dark recessed enamel field (#1E293B, matching the pin\'s own seat/ink colour) — a real cloisonné recessed-background technique, not an arbitrary metal bridge. (Found and discarded a dead, never-called hullFill code path already sitting in this file from an earlier renderDieCut version — the real renderDieCut has no such mechanism, so this needed its own render function.)' },
  { id:'gold_show_connoisseur', name:'Show Connoisseur', tier:'gold', track:'thematic', status:'tweak', src:'amethyst_stage_connoisseur_15', mode:'diecut', motif:'dramaMasks', enamel:['#fef3c7','#991b1b','#0f172a','#0f172a','#fef3c7','#991b1b','#0f172a','#0f172a'], note:'tier amethyst→gold' },
  { id:'amethyst_show_devotee', name:'Show Devotee', tier:'amethyst', track:'thematic', status:'new', mode:'diecut', motif:'theaterCurtainsStage', enamel:['#b5721a','#b5721a','#b5721a','#b5721a','#4a2a7a','#4a2a7a','#991b1b','#991b1b','#b5721a','#0c071a','#fde047','#0c071a'], note:'Grand velvet stage proscenium with recessed solo spotlight; screened 42.2% enamel @7.2px' },
  { id:'silver_nighttime_spectaculars', name:'Nighttime Spectaculars', tier:'silver', track:'thematic', status:'new', shape:'arch', scene:'castleFireworks', sky:'night', note:'Contained silver arch with Cinderella Castle on baseline, glowing projection windows, shoreline reflection, and 3-burst pyrotechnic crown (Option B)' },
  { id:'silver_parades', name:'Parade Watcher', tier:'silver', track:'thematic', status:'new', mode:'diecut', motif:'trumpetFlag', enamel:['#b5721a','#b5721a','#4a2a7a','#4a2a7a','#4a2a7a','#4a2a7a','#4a2a7a','#b5721a'], note:'Single-piece solid die-cut fanfare trumpet in amber brass with flush Royal Navy swallowtail banner and golden heraldic crest (Card 1)' },

  // ===== Thematic · Historical / signature =====
  { id:'silver_1971_club', name:'1971 Opening Day Club', tier:'silver', track:'thematic', status:'tweak', src:'pearl_1971_heritage', mode:'diecut', motif:'pocketWatch', enamel:['#f8fafc','#0f172a','#f59e0b','#0f172a','#f59e0b','#f8fafc','#f59e0b','#f59e0b','#f59e0b','#f59e0b','#f59e0b','#f59e0b','#f59e0b','#f59e0b'], note:'tier pearl→silver' },
  { id:'silver_animatronic_classics', name:'Animatronic Classics', tier:'silver', track:'thematic', status:'reuse', src:'silver_animatronics_veteran', mode:'diecut', motif:'tikiMacaw', motifScale:1.15, enamel:['PALETTES.royal.crimson','PALETTES.royal.amber','PALETTES.royal.teal','PALETTES.royal.royal'] },
  { id:'silver_flight_simulators', name:'Flight Simulator Ace', tier:'silver', track:'thematic', status:'reuse', src:'silver_flight_sim_ace', mode:'diecut', motif:'soarinGliderWings', enamel:['#334155','#475569','#334155','#475569','#334155','#475569','#334155','#0284C7','#38BDF8','#E0F2FE','#FFFFFF'] },
  { id:'bronze_target_blaster', name:'Target Blaster', tier:'bronze', track:'thematic', status:'reuse', src:'bronze_target_blaster', mode:'diecut', motif:'rayGun', enamel:['#581C87'] },
  { id:'silver_interstellar_pilot', name:'Interstellar Pilot', tier:'silver', track:'thematic', status:'reuse', src:'silver_interstellar_pilot', mode:'diecut', motif:'spaceSatellite', enamel:['#0284C7','#0369A1','#0284C7','#0369A1','#0284C7','#0369A1','#0284C7','#0369A1','#F8FAFC','#F59E0B','#0284C7','#0369A1','#0284C7','#0369A1','#0284C7','#0369A1','#0284C7','#0369A1','#0284C7','#94A3B8','#0369A1','#0284C7','#1E293B'] },
  { id:'silver_rail_transit', name:'Rail & Transit', tier:'silver', track:'thematic', status:'reuse', src:'silver_rail_transit', colorDieCut:true, motif:'steamTrain', enamel:['#E2E8F0','#DC2626','#1E293B','#93C5FD','#93C5FD','#1E293B','#0F172A','#B91C1C','#1E293B','#DC2626','#DC2626','#DC2626','#94A3B8','#CBD5E1','#CBD5E1','#DC2626','#334155','#F59E0B'], note:'GATE FIX: raw steamTrain motif is 6 ground-truth components at silver 5.2px rim (cab+boiler body, wheel cluster, rail strip, steam cloud, 2 small detail blocks); welded via galleon-style outer-rim-weld (single continuous outline, 99.7% bbox coverage of full motif, every original cell 57-100% covered by the outline) with original 18-colour enamel poured back on top. Per user direction: train parts + steam fused together via weld, not theatre-style filled-hull-plus-recessed-field.' },
  { id:'silver_wildlife_spotter', name:'Wildlife Spotter', tier:'silver', track:'thematic', status:'tweak', src:'bronze_animal_spotter', mode:'diecut', motif:'lion', enamel:['#D97706','#78350F','#FEF3C7'], note:'tier bronze→silver' },
  { id:'bronze_comedy_laughs', name:'Comedy & Laughs', tier:'bronze', track:'thematic', status:'reuse', src:'bronze_laugh_out_loud', mode:'diecut', motif:'microphone', enamel:['#94A3B8','#F59E0B','#DC2626','#0284C7'] },
  { id:'silver_circle_vision_360', name:'Circle-Vision 360', tier:'silver', track:'thematic', status:'tweak', src:'bronze_360_cinema', mode:'diecut', motif:'filmSpool', enamel:['#94A3B8','#0F172A','#F59E0B','#FFFFFF'], note:'tier bronze→silver' },

  // ===== Thematic · Franchise (all NEW) =====
  { id:'silver_star_wars', name:'Star Wars Devotee', tier:'silver', track:'thematic', status:'new', mode:'diecut', scene:'crossedLightsabers', enamel:['#00E5FF','#FF1744','#475569','#475569','#FFFFFF'], note:'crossedLightsabers MOVED here from silver_immersive_lands (that pin was a combined Toy Story + Galaxy Edge land and this art was 100% Star Wars, 0% Toy Story — belongs on the franchise pin instead). Pairs as a coherent bronze->silver escalation with bronze_land_starter_star_wars_galaxys_edge (also crossedLightsabers, one land vs. all Star Wars franchise-wide).' },
  { id:'gold_pixar_pals', name:'Pixar Pals', tier:'gold', track:'thematic', status:'new', mode:'diecut', scene:'luxoBall', enamel:['#fbbf24','#0284c7','#ef4444','#ffffff'], note:'Master Cloisonné Luxo Ball: 3D spherical projection with canary yellow enamel, curved cobalt blue equator, faceted red cloisonné star, and specular glass highlight.' },
  { id:'silver_classic_characters', name:'Classic Characters', tier:'silver', track:'thematic', status:'new', mode:'diecut', scene:'steamboatHelm', enamel:['#0f172a','#334155'], note:'Steamboat Willie Master Helm: 8-spoke pilot wheel with lathe-turned handles, felloe rivets, and 8-bolt hub boss honoring the Sensational Six and 1928 animation origins.' },

  // ===== Thematic · Culture =====
  { id:'silver_world_traveler_6', name:'World Traveler', tier:'silver', track:'thematic', status:'reuse', src:'silver_epcot_showcase_6', mode:'diecut', motif:'pagoda', motifScale:1.15, enamel:['PALETTES.royal.crimson','PALETTES.royal.amber','PALETTES.royal.ink','PALETTES.royal.forest'], note:'pagoda/toriiGate provenance is a CREDITS bug, recipe unchanged' },
  { id:'gold_world_traveler_11', name:'World Showcase Traveler', tier:'gold', track:'thematic', status:'reuse', src:'gold_world_showcase_complete', mode:'diecut', motif:'world', allowRound:true, roundReason:'a globe/world icon is round; the circle IS the object, not a frame around one (same reasoning already applied to wireframeGlobe)', enamel:['#0284C7','#10B981','#38BDF8','#F59E0B'], note:'emblemGate also flags "3 pieces" on the raw motif, but this is a false alarm not a real defect: cell0 spans the full motif bbox and every other cell\'s fill sits 100% inside cell0\'s silhouette, so under the real renderer (classifyCells gives cell0 the true outer rim) it renders as one connected piece — confirmed against the actual render, same false-alarm pattern found on waterTower this session. No weld needed.' },
  { id:'prism_global_ambassador', name:'Global Ambassador', tier:'prism', track:'thematic', status:'tweak', src:'prism_global_ambassador', mode:'diecut', scene:'globalAmbassador', motif:'passport', enamel:['#1a2e4c','#fbf7ee','#0284c7','#fbbf24','#a8323f'], note:'Diplomatic Cloisonné: Royal Navy leather cover, Ivory parchment pages, Burgundy embassy pen, Azure blue oceans, 11 World Showcase nation stars.' },
];

/* Totals (for the HTML rebuild sanity check — NOT asserted here):
   174 pins = 85 reuse + 40 tweak + 48 new + 1 resolved.
   NEW (48) needing art design WITH the user, by theme:
     dining restaurant ladder 11, festival 5, snacks 7, fine-dining 2,
     squad 2, critic 2, trip 2, resorts 3, princesses 1, touring 2,
     rides 5, shows 3, franchise 3.
*/
if (typeof module !== 'undefined') module.exports = { PINS_V2 };
if (typeof window !== 'undefined') window.PINS_V2 = PINS_V2;
