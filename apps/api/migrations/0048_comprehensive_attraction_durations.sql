-- Disney World Tracker — Comprehensive Ride/Show Durations
-- Data-only migration: no schema change. Populates `duration_minutes` on
-- `experiences` across EPCOT, Hollywood Studios, Animal Kingdom, Magic Kingdom,
-- and Water Parks. Idempotent on reapply.

BEGIN;

-- ============================================================================
-- EPCOT
-- ============================================================================
-- Remy's Ratatouille Adventure: ~5 min trackless ride cycle.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '19497835;entityType=Attraction';

-- Guardians of the Galaxy: Cosmic Rewind: ~3 min coaster ride cycle.
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '411499845;entityType=Attraction';

-- Frozen Ever After: ~5 min boat ride cycle.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '18375495;entityType=Attraction';

-- Test Track: ~5 min ride cycle.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010199;entityType=Attraction';

-- Spaceship Earth: ~16 min dark omnimover ride cycle.
UPDATE experiences SET duration_minutes = 16 WHERE upstream_entity_id = '80010191;entityType=Attraction';

-- Soarin' Around the World: ~5 min flight simulator cycle.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '20194;entityType=Attraction';
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '412577054;entityType=Attraction';

-- Living with the Land: ~14 min boat ride.
UPDATE experiences SET duration_minutes = 14 WHERE upstream_entity_id = '80010161;entityType=Attraction';
UPDATE experiences SET duration_minutes = 14 WHERE upstream_entity_id = '412010036;entityType=Attraction';

-- Mission: SPACE: ~6 min centrifuge / motion cycle.
UPDATE experiences SET duration_minutes = 6 WHERE upstream_entity_id = '80010173;entityType=Attraction';

-- The Seas with Nemo & Friends: ~5 min omnimover dark ride.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '107785;entityType=Attraction';

-- Journey Into Imagination With Figment: ~6 min dark ride.
UPDATE experiences SET duration_minutes = 6 WHERE upstream_entity_id = '80010152;entityType=Attraction';

-- Gran Fiesta Tour Starring The Three Caballeros: ~8 min boat ride.
UPDATE experiences SET duration_minutes = 8 WHERE upstream_entity_id = '207395;entityType=Attraction';

-- Turtle Talk With Crush: ~15 min interactive show.
UPDATE experiences SET duration_minutes = 15 WHERE upstream_entity_id = '62992;entityType=Attraction';

-- The American Adventure: ~29 min animatronic show.
UPDATE experiences SET duration_minutes = 29 WHERE upstream_entity_id = '80010200;entityType=Attraction';

-- Awesome Planet: ~10 min film show.
UPDATE experiences SET duration_minutes = 10 WHERE upstream_entity_id = '19473173;entityType=Attraction';

-- Beauty and the Beast Sing-Along: ~15 min theater show.
UPDATE experiences SET duration_minutes = 15 WHERE upstream_entity_id = '19463785;entityType=Attraction';

-- Canada Far and Wide in Circle-Vision 360: ~12 min film show.
UPDATE experiences SET duration_minutes = 12 WHERE upstream_entity_id = '80010174;entityType=Attraction';

-- Impressions de France: ~18 min film show.
UPDATE experiences SET duration_minutes = 18 WHERE upstream_entity_id = '80010145;entityType=Attraction';

-- Reflections of China: ~14 min film show.
UPDATE experiences SET duration_minutes = 14 WHERE upstream_entity_id = '80010180;entityType=Attraction';

-- Disney and Pixar Short Film Festival: ~18 min 4D theater show.
UPDATE experiences SET duration_minutes = 18 WHERE upstream_entity_id = '18269694;entityType=Attraction';

-- Voices of Liberty: ~15 min choral show.
UPDATE experiences SET duration_minutes = 15 WHERE upstream_entity_id = '80010879;entityType=Entertainment';

-- Luminous The Symphony of Us: ~17 min nighttime fireworks show.
UPDATE experiences SET duration_minutes = 17 WHERE upstream_entity_id = '412008998;entityType=Entertainment';

-- ============================================================================
-- Disney's Hollywood Studios
-- ============================================================================
-- Star Tours – The Adventures Continue: ~5 min flight simulator ride.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010193;entityType=Attraction';

-- Star Wars: Rise of the Resistance: ~18 min multi-part trackless ride.
UPDATE experiences SET duration_minutes = 18 WHERE upstream_entity_id = '19263736;entityType=Attraction';

-- Millennium Falcon: Smugglers Run: ~5 min cockpit simulator.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '19263735;entityType=Attraction';

-- Slinky Dog Dash: ~3 min family coaster.
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '18904138;entityType=Attraction';

-- Toy Story Mania!: ~8 min 4D interactive ride.
UPDATE experiences SET duration_minutes = 8 WHERE upstream_entity_id = '209857;entityType=Attraction';

-- Alien Swirling Saucers: ~3 min spinning ride.
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '18904172;entityType=Attraction';

-- The Twilight Zone™ Tower of Terror: ~5 min drop tower.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010218;entityType=Attraction';

-- Rock ’n’ Roller Coaster: ~3 min high-speed coaster.
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '412573652;entityType=Attraction';

-- Mickey & Minnie's Runaway Railway: ~5 min trackless dark ride.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '19259335;entityType=Attraction';

-- Indiana Jones™ Epic Stunt Spectacular!: ~30 min stunt show.
UPDATE experiences SET duration_minutes = 30 WHERE upstream_entity_id = '136;entityType=Entertainment';

-- Beauty and the Beast – Live on Stage: ~25 min musical show.
UPDATE experiences SET duration_minutes = 25 WHERE upstream_entity_id = '80010848;entityType=Entertainment';

-- For the First Time in Forever: A Frozen Sing-Along Celebration: ~30 min show.
UPDATE experiences SET duration_minutes = 30 WHERE upstream_entity_id = '17842841;entityType=Entertainment';

-- Fantasmic!: ~30 min nighttime spectacular show.
UPDATE experiences SET duration_minutes = 30 WHERE upstream_entity_id = '80010887;entityType=Entertainment';

-- The Little Mermaid – A Musical Adventure: ~17 min stage show.
UPDATE experiences SET duration_minutes = 17 WHERE upstream_entity_id = '412328858;entityType=Entertainment';

-- Disney Jr. Mickey Mouse Clubhouse Live!: ~20 min dance show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '412521565;entityType=Entertainment';

-- Wonderful World of Animation: ~12 min projection show.
UPDATE experiences SET duration_minutes = 12 WHERE upstream_entity_id = '19260580;entityType=Entertainment';

-- Vacation Fun: ~10 min animated short.
UPDATE experiences SET duration_minutes = 10 WHERE upstream_entity_id = '19497952;entityType=Attraction';

-- ============================================================================
-- Disney's Animal Kingdom
-- ============================================================================
-- Kali River Rapids: ~5 min raft ride.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010154;entityType=Attraction';

-- Festival of the Lion King: ~30 min theater-in-the-round show.
UPDATE experiences SET duration_minutes = 30 WHERE upstream_entity_id = '12432;entityType=Entertainment';

-- Finding Nemo: The Big Blue... and Beyond!: ~25 min puppet musical show.
UPDATE experiences SET duration_minutes = 25 WHERE upstream_entity_id = '411550125;entityType=Entertainment';

-- Feathered Friends in Flight!: ~25 min live bird show.
UPDATE experiences SET duration_minutes = 25 WHERE upstream_entity_id = '19581372;entityType=Entertainment';

-- Wildlife Express Train: ~7 min scenic train ride.
UPDATE experiences SET duration_minutes = 7 WHERE upstream_entity_id = '80010235;entityType=Attraction';

-- Tree of Life Awakenings: ~5 min projection show.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '18447293;entityType=Entertainment';

-- ============================================================================
-- Magic Kingdom
-- ============================================================================
-- Pirates of the Caribbean: ~9 min boat ride.
UPDATE experiences SET duration_minutes = 9 WHERE upstream_entity_id = '80010177;entityType=Attraction';

-- Space Mountain: ~10 min indoor coaster.
UPDATE experiences SET duration_minutes = 10 WHERE upstream_entity_id = '80010190;entityType=Attraction';

-- Haunted Mansion: ~9 min doombuggy dark ride.
UPDATE experiences SET duration_minutes = 9 WHERE upstream_entity_id = '80010208;entityType=Attraction';

-- Big Thunder Mountain Railroad: ~7 min runaway mine train.
UPDATE experiences SET duration_minutes = 7 WHERE upstream_entity_id = '80010110;entityType=Attraction';

-- Jungle Cruise: ~10 min riverboat tour.
UPDATE experiences SET duration_minutes = 10 WHERE upstream_entity_id = '80010153;entityType=Attraction';

-- Peter Pan's Flight: ~3 min suspended dark ride.
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '80010176;entityType=Attraction';

-- Seven Dwarfs Mine Train: ~5 min swinging coaster.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '16767284;entityType=Attraction';

-- TRON Lightcycle / Run: ~2 min launch coaster.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '411504498;entityType=Attraction';

-- Tiana's Bayou Adventure: ~11 min flume ride.
UPDATE experiences SET duration_minutes = 11 WHERE upstream_entity_id = '412021364;entityType=Attraction';

-- Buzz Lightyear’s Space Ranger Spin: ~5 min omnimover shooter ride.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010114;entityType=Attraction';

-- Tomorrowland Transit Authority PeopleMover: ~10 min elevated transit ride.
UPDATE experiences SET duration_minutes = 10 WHERE upstream_entity_id = '80010224;entityType=Attraction';

-- Under the Sea - Journey of The Little Mermaid: ~7 min clamshell dark ride.
UPDATE experiences SET duration_minutes = 7 WHERE upstream_entity_id = '16767263;entityType=Attraction';

-- The Many Adventures of Winnie the Pooh: ~4 min dark ride.
UPDATE experiences SET duration_minutes = 4 WHERE upstream_entity_id = '80010213;entityType=Attraction';

-- Dumbo the Flying Elephant: ~2 min aerial spinner.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010129;entityType=Attraction';

-- Mad Tea Party: ~2 min teacup spinner.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010162;entityType=Attraction';

-- The Barnstormer: ~2 min junior coaster.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '16491297;entityType=Attraction';

-- Astro Orbiter: ~2 min rocket spinner.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010107;entityType=Attraction';

-- The Magic Carpets of Aladdin: ~2 min spinner.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010210;entityType=Attraction';

-- Tomorrowland Speedway: ~5 min autopia track.
UPDATE experiences SET duration_minutes = 5 WHERE upstream_entity_id = '80010222;entityType=Attraction';

-- "it's a small world": ~14 min boat ride.
UPDATE experiences SET duration_minutes = 14 WHERE upstream_entity_id = '80010149;entityType=Attraction';

-- Prince Charming Regal Carrousel: ~2 min carousel.
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010117;entityType=Attraction';

-- Walt Disney World Railroad: ~20 min full-circle loop.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '80010230;entityType=Attraction';
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '16491299;entityType=Attraction';

-- Walt Disney's Carousel of Progress: ~21 min revolving theater show.
UPDATE experiences SET duration_minutes = 21 WHERE upstream_entity_id = '80010232;entityType=Attraction';

-- The Hall of Presidents: ~22 min audio-animatronics show.
UPDATE experiences SET duration_minutes = 22 WHERE upstream_entity_id = '80069754;entityType=Attraction';

-- Country Bear Musical Jamboree: ~12 min animatronic revue show.
UPDATE experiences SET duration_minutes = 12 WHERE upstream_entity_id = '80069748;entityType=Attraction';

-- Walt Disney's Enchanted Tiki Room: ~15 min animatronic show.
UPDATE experiences SET duration_minutes = 15 WHERE upstream_entity_id = '16124144;entityType=Attraction';

-- Mickey's PhilharMagic: ~12 min 3D concert show.
UPDATE experiences SET duration_minutes = 12 WHERE upstream_entity_id = '80010170;entityType=Attraction';

-- Monsters, Inc. Laugh Floor: ~15 min interactive comedy show.
UPDATE experiences SET duration_minutes = 15 WHERE upstream_entity_id = '136550;entityType=Attraction';

-- Enchanted Tales with Belle: ~20 min interactive storytelling show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '16767276;entityType=Attraction';

-- Happily Ever After: ~18 min fireworks & castle projection show.
UPDATE experiences SET duration_minutes = 18 WHERE upstream_entity_id = '18672598;entityType=Entertainment';

-- The Dapper Dans: ~20 min barbershop quartet show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '8075;entityType=Entertainment';

-- The Cadaver Dans Barbershop Quartet: ~20 min barbershop quartet show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '17506082;entityType=Entertainment';

-- Mickey's Magical Friendship Faire: ~20 min castle stage show.
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '18381020;entityType=Entertainment';

-- ============================================================================
-- Water Parks (Typhoon Lagoon / Blizzard Beach)
-- ============================================================================
-- Typhoon Lagoon
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '14200;entityType=Attraction'; -- Crush 'n' Gusher
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '18628633;entityType=Attraction'; -- Miss Adventure Falls
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010143;entityType=Attraction'; -- Humunga Kowabunga
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010194;entityType=Attraction'; -- Storm Slides
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010138;entityType=Attraction'; -- Gangplank Falls
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010167;entityType=Attraction'; -- Mayday Falls
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010155;entityType=Attraction'; -- Keelhaul Falls
UPDATE experiences SET duration_minutes = 20 WHERE upstream_entity_id = '80010115;entityType=Attraction'; -- Castaway Creek

-- Blizzard Beach
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010195;entityType=Attraction'; -- Summit Plummet
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010186;entityType=Attraction'; -- Slush Gusher
UPDATE experiences SET duration_minutes = 3 WHERE upstream_entity_id = '80010198;entityType=Attraction'; -- Teamboat Springs
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010219;entityType=Attraction'; -- Toboggan Racers
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010187;entityType=Attraction'; -- Snow Stormers
UPDATE experiences SET duration_minutes = 2 WHERE upstream_entity_id = '80010183;entityType=Attraction'; -- Runoff Rapids
UPDATE experiences SET duration_minutes = 1 WHERE upstream_entity_id = '80010128;entityType=Attraction'; -- Downhill Double Dipper
UPDATE experiences SET duration_minutes = 25 WHERE upstream_entity_id = '80010122;entityType=Attraction'; -- Cross Country Creek
UPDATE experiences SET duration_minutes = 8 WHERE upstream_entity_id = '80010116;entityType=Attraction'; -- Chairlift

COMMIT;
