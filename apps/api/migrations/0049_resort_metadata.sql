-- Disney World Tracker — Resort Classification, Amenities, and Transit Metadata
-- Adds additive metadata columns to `resorts`: tier, feature_pool, transportation_modes,
-- recreation, transit_times, and architectural_lore.
-- Idempotent on reapply.

BEGIN;

ALTER TABLE resorts
    ADD COLUMN IF NOT EXISTS tier TEXT,
    ADD COLUMN IF NOT EXISTS feature_pool TEXT,
    ADD COLUMN IF NOT EXISTS transportation_modes TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS recreation JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS transit_times JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS architectural_lore JSONB DEFAULT '[]'::jsonb;

-- Optional constraint ensuring recognized Disney resort tiers
ALTER TABLE resorts DROP CONSTRAINT IF EXISTS resorts_tier_chk;

ALTER TABLE resorts
    ADD CONSTRAINT resorts_tier_chk
    CHECK (tier IS NULL OR tier IN ('Value', 'Moderate', 'Deluxe', 'Deluxe Villa', 'Campground'));

-- ============================================================================
-- 1. Disney's Coronado Springs Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Moderate',
    feature_pool = 'The Dig Site & Lost City of Cibola Pool',
    transportation_modes = ARRAY['Bus'],
    recreation = '[
        {"icon": "🏊", "title": "The Dig Site & Lost City of Cibola Pool", "badge": "Feature Pool", "description": "50-foot Mayan pyramid with cascading waterfall, 123-foot jaguar waterslide, and the largest outdoor hot tub at WDW (22-person capacity)."},
        {"icon": "🏊", "title": "Casitas, Ranchos & Cabanas Leisure Pools", "badge": "Quiet Pools", "description": "Three tranquil heated leisure pools located in each village neighborhood for relaxed swimming."},
        {"icon": "🏃", "title": "Lago Dorado 0.9-Mile Jogging Loop", "badge": "Trail", "description": "Scenic paved waterfront path connecting all four village neighborhoods across over-water boardwalk bridges."},
        {"icon": "🏋️", "title": "La Vida Health Club & Fitness Center", "badge": "Wellness", "description": "24/7 fitness facility with modern cardio and weight machines, dry saunas, and wellness services."},
        {"icon": "🪵", "title": "Campfire & Movies Under the Stars", "badge": "Family Fun", "description": "Nightly marshmallow roasts by Lago Dorado followed by complimentary Disney movie screenings under the Florida twilight."}
    ]'::jsonb,
    transit_times = '{"Animal Kingdom": 8, "Hollywood Studios": 9, "EPCOT": 12, "Magic Kingdom": 16, "Disney Springs": 12}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎨", "title": "Salvador Dalí Collaboration", "text": "Gran Destino Tower is named after Destino, the 1946 animated collaboration between Walt Disney and surrealist painter Salvador Dalí."},
        {"emoji": "🌉", "title": "Villa del Lago Over-Water Bridges", "text": "Three wooden bridges span across 22-acre Lago Dorado to connect the Casitas, Ranchos, and Cabanas to Three Bridges Bar & Grill at the lake center."}
    ]'::jsonb
WHERE name ILIKE '%Coronado Springs%';

-- ============================================================================
-- 2. Disney's Grand Floridian Resort & Spa (and Villas)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Beach Pool',
    transportation_modes = ARRAY['Monorail', 'Boat', 'Bus', 'Walking'],
    recreation = '[
        {"icon": "🏊", "title": "Beach Pool", "badge": "Feature Pool", "description": "111,261-gallon pool overlooking Seven Seas Lagoon with 181-foot natural springs waterslide, walking bridge, and zero-depth entry."},
        {"icon": "🏊", "title": "Courtyard Pool", "badge": "Quiet Pool", "description": "Serene heated leisure pool situated in the tranquil center courtyard with an adjacent whirlpool spa."},
        {"icon": "🧖", "title": "The Grand Floridian Spa", "badge": "Wellness", "description": "Full-service Victorian health spa offering signature massage, botanical facials, and relaxation lounges."},
        {"icon": "⛵", "title": "Seven Seas Lagoon Marina & Campfire", "badge": "Family Fun", "description": "Motorized boat rentals, evening marshmallow roasts, and prime viewing of the Electrical Water Pageant."}
    ]'::jsonb,
    transit_times = '{"Magic Kingdom": 4, "EPCOT": 18, "Hollywood Studios": 16, "Animal Kingdom": 18, "Disney Springs": 20}'::jsonb,
    architectural_lore = '[
        {"emoji": "🏰", "title": "Victorian Seaside Grandeur", "text": "Designed after the grand Victorian beach resorts of Florida''s gilded age, featuring a soaring five-story atrium with stained-glass domes."}
    ]'::jsonb
WHERE name ILIKE '%Grand Floridian%';

-- ============================================================================
-- 3. Disney's Polynesian Village Resort (and Villas & Bungalows / Island Tower)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Lava Pool',
    transportation_modes = ARRAY['Monorail', 'Boat', 'Bus', 'Walking'],
    recreation = '[
        {"icon": "🏊", "title": "Lava Pool", "badge": "Feature Pool", "description": "Signature pool featuring a towering volcanic rock massif, 142-foot twisting waterslide, and direct Seven Seas Lagoon views."},
        {"icon": "🏊", "title": "Oasis Pool", "badge": "Quiet Pool", "description": "Nestled in a lush garden alcove, this tranquil heated leisure pool is surrounded by palm groves and poolside cabanas."},
        {"icon": "🏃", "title": "Seven Seas Lagoon Walking Path", "badge": "Trail", "description": "Scenic 1-mile walking and running trail connecting the Polynesian to the Grand Floridian alongside the lagoon."},
        {"icon": "🔥", "title": "Evening Torch Lighting & Campfire", "badge": "Family Fun", "description": "Traditional Polynesian torch lighting ceremony followed by twilight marshmallow roasting on the white sand beach."}
    ]'::jsonb,
    transit_times = '{"Magic Kingdom": 8, "EPCOT": 15, "Hollywood Studios": 16, "Animal Kingdom": 18, "Disney Springs": 20}'::jsonb,
    architectural_lore = '[
        {"emoji": "🌺", "title": "Mid-Century Tiki Extravaganza", "text": "One of Disney World''s two original opening-day resorts (October 1, 1971), celebrating South Pacific island culture, tiki culture, and mid-century modern architecture."}
    ]'::jsonb
WHERE name ILIKE '%Polynesian%';

-- ============================================================================
-- 4. Disney's Contemporary Resort (and Bay Lake Tower)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Feature Pool with 17-ft Slide',
    transportation_modes = ARRAY['Monorail', 'Walking', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Feature Pool with 17-Foot Slide", "badge": "Feature Pool", "description": "Heated pool overlooking Bay Lake featuring a curving 17-foot-high curving waterslide and two bubbling whirlpool spas."},
        {"icon": "🏊", "title": "Bay Lake Leisure Pool & Bay Cove Pool", "badge": "Quiet Pools", "description": "Circular quiet pool on the Bay Lake shoreline and the exclusive Bay Cove zero-depth pool at Bay Lake Tower."},
        {"icon": "🏋️", "title": "Olympiad Fitness Center", "badge": "Wellness", "description": "Full workout facility equipped with state-of-the-art Cybex and Life Fitness equipment, saunas, and locker rooms."},
        {"icon": "🚤", "title": "Bay Lake Watersports & Boat Rentals", "badge": "Family Fun", "description": "Private chartered pontoon cruises, bass fishing excursions, and evening Electrical Water Pageant views."}
    ]'::jsonb,
    transit_times = '{"Magic Kingdom": 5, "EPCOT": 18, "Hollywood Studios": 16, "Animal Kingdom": 18, "Disney Springs": 20}'::jsonb,
    architectural_lore = '[
        {"emoji": "🚆", "title": "A-Frame Monorail Concourse", "text": "Opening-day icon featuring an iconic 14-story concrete A-frame atrium through which the Monorail silently glides, alongside Mary Blair''s massive 90-foot ceramic tile mural."}
    ]'::jsonb
WHERE name ILIKE '%Contemporary%' OR name ILIKE '%Bay Lake Tower%';

-- ============================================================================
-- 5. Disney's Animal Kingdom Lodge (and Villas - Jambo House & Kidani Village)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Uzima Pool',
    transportation_modes = ARRAY['Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Uzima Pool (Jambo House)", "badge": "Feature Pool", "description": "11,000-square-foot tropical oasis with zero-depth entry, a 67-foot waterslide, and views facing the flamingo pond."},
        {"icon": "🏊", "title": "Samawati Springs Pool (Kidani Village)", "badge": "Feature Pool", "description": "4,700-square-foot pool featuring a 128-foot waterslide and the Uwanja Camp interactive water playground."},
        {"icon": "🦒", "title": "Guided Savanna Wildlife Viewing", "badge": "Nature", "description": "Four lush savannas home to over 200 animals with resident African Cultural Representatives and night-vision viewing."},
        {"icon": "🏋️", "title": "Zahanati Massage & Fitness Center", "badge": "Wellness", "description": "Full fitness and sauna center with personal training equipment and relaxation body treatments."}
    ]'::jsonb,
    transit_times = '{"Animal Kingdom": 6, "Hollywood Studios": 14, "EPCOT": 16, "Magic Kingdom": 22, "Disney Springs": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🦒", "title": "Authentic African Kraal Architecture", "text": "Designed by Peter Dominick in the shape of a traditional African semicircular kraal, overlooking four private savannas with over 200 roaming hoofed animals and birds."}
    ]'::jsonb
WHERE name ILIKE '%Animal Kingdom Lodge%' OR name ILIKE '%Animal Kingdom Villas%';

-- ============================================================================
-- 6. Disney's Wilderness Lodge (and Boulder Ridge / Copper Creek Villas)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Copper Creek Springs Pool',
    transportation_modes = ARRAY['Boat', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Copper Creek Springs Pool", "badge": "Feature Pool", "description": "Heated pool fed by lobby hot springs, featuring a 67-foot waterslide built into natural rocks, and hot/cold whirlpool spas."},
        {"icon": "🏊", "title": "Boulder Ridge Cove Pool", "badge": "Quiet Pool", "description": "Tranquil zero-entry leisure pool set in the Boulder Ridge courtyard with shaded sun decks and bubbling whirlpool."},
        {"icon": "🌲", "title": "Piney Woods Trail & Fire Rock Geyser", "badge": "Trail", "description": "Scenic nature trail connecting to Fort Wilderness, with Fire Rock Geyser erupting 120 feet every hour on the hour."},
        {"icon": "🪵", "title": "Campfire & Stargazing", "badge": "Family Fun", "description": "Nightly evening campfire roasts and outdoor Disney movies on the shores of Bay Lake."}
    ]'::jsonb,
    transit_times = '{"Magic Kingdom": 8, "EPCOT": 16, "Hollywood Studios": 18, "Animal Kingdom": 20, "Disney Springs": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🪵", "title": "Pacific Northwest Great Lodges", "text": "Inspired by legendary turn-of-the-century national park lodges like Old Faithful Inn in Yellowstone, featuring an 82-foot stone fireplace and bubbling geyser."}
    ]'::jsonb
WHERE name ILIKE '%Wilderness Lodge%' OR name ILIKE '%Boulder Ridge%' OR name ILIKE '%Copper Creek%';

-- ============================================================================
-- 7. Disney's Yacht Club Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Stormalong Bay',
    transportation_modes = ARRAY['Boat', 'Walking', 'Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Stormalong Bay", "badge": "Feature Pool", "description": "3-acre beachside water park shared with Beach Club featuring a sand-bottom pool, lazy river, and 230-foot shipwreck slide."},
        {"icon": "🏊", "title": "Admiral Pool", "badge": "Quiet Pool", "description": "Quiet heated leisure pool nestled in a peaceful garden area near the Tennis Courts on the Yacht Club property."},
        {"icon": "🏋️", "title": "Ship Shape Health Club", "badge": "Wellness", "description": "24-hour fitness center equipped with strength and cardio equipment, steam rooms, and saunas."},
        {"icon": "🚴", "title": "Crescent Lake Surrey Bikes & Marinas", "badge": "Family Fun", "description": "Rent 2- and 4-person surrey bicycles for a scenic lap around Crescent Lake and the BoardWalk promenade."}
    ]'::jsonb,
    transit_times = '{"EPCOT": 6, "Hollywood Studios": 12, "Magic Kingdom": 18, "Animal Kingdom": 16, "Disney Springs": 15}'::jsonb,
    architectural_lore = '[
        {"emoji": "⚓", "title": "New England Nautical Heritage", "text": "Designed by Robert A.M. Stern with stately clapboard siding and nautical brass fixtures evocative of Martha''s Vineyard yacht clubs."}
    ]'::jsonb
WHERE name ILIKE '%Yacht Club%';

-- ============================================================================
-- 8. Disney's Beach Club Resort (and Beach Club Villas)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Stormalong Bay',
    transportation_modes = ARRAY['Boat', 'Walking', 'Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Stormalong Bay", "badge": "Feature Pool", "description": "3-acre sand-bottom aquatic playground with gentle current lazy river, life-sized shipwreck, and elevated tanning decks."},
        {"icon": "🏊", "title": "Tidal Pool & Dunes Cove Pool", "badge": "Quiet Pools", "description": "Two secluded heated leisure pools located at Beach Club and Beach Club Villas for serene sunbathing."},
        {"icon": "🏃", "title": "Crescent Lake 0.8-Mile Jogging Path", "badge": "Trail", "description": "Picturesque lakeside paved loop connecting EPCOT International Gateway, Yacht & Beach Club, and BoardWalk."},
        {"icon": "🪵", "title": "Beach Club Campfire & Lawn Movies", "badge": "Family Fun", "description": "Campfire roasted marshmallows followed by Disney movies screened under the stars on the beach."}
    ]'::jsonb,
    transit_times = '{"EPCOT": 5, "Hollywood Studios": 12, "Magic Kingdom": 18, "Animal Kingdom": 16, "Disney Springs": 15}'::jsonb,
    architectural_lore = '[
        {"emoji": "🏖️", "title": "Stormalong Bay Sand Lagoon", "text": "A pastel seaside cottage aesthetic anchored by Stormalong Bay—a 3-acre mini water park with genuine sand bottom and life-sized shipwreck waterslide."}
    ]'::jsonb
WHERE name ILIKE '%Beach Club%';

-- ============================================================================
-- 9. Disney's BoardWalk Inn (and BoardWalk Villas)
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe',
    feature_pool = 'Luna Park Pool',
    transportation_modes = ARRAY['Skyliner', 'Boat', 'Walking', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Luna Park Pool", "badge": "Feature Pool", "description": "184,217-gallon carnival-themed pool featuring the 200-foot-long Keister Coaster waterslide and elephant spouts."},
        {"icon": "🏊", "title": "Inn & Villas Leisure Pools", "badge": "Quiet Pools", "description": "Two heated leisure pools set within private landscaped garden courtyards on the Inn and Villas grounds."},
        {"icon": "🏋️", "title": "Muscles & Bustles Health Club", "badge": "Wellness", "description": "Cardiovascular workout center with weight training machines and sauna amenities."},
        {"icon": "🎪", "title": "BoardWalk Promenade Street Performers", "badge": "Entertainment", "description": "Nightly jugglers, magicians, and carnival midway arcade games along the bustling quarter-mile wooden promenade."}
    ]'::jsonb,
    transit_times = '{"EPCOT": 5, "Hollywood Studios": 12, "Magic Kingdom": 18, "Animal Kingdom": 16, "Disney Springs": 15}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎡", "title": "Turn-of-the-Century Atlantic Coast", "text": "Recreates the charm and energy of 1930s coastal Atlantic boardwalks like Coney Island and Atlantic City, along Crescent Lake."}
    ]'::jsonb
WHERE name ILIKE '%BoardWalk Inn%' OR name ILIKE '%BoardWalk Villas%';

-- ============================================================================
-- 10. Disney's Riviera Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe Villa',
    feature_pool = 'Riviera Pool',
    transportation_modes = ARRAY['Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Riviera Pool", "badge": "Feature Pool", "description": "Family-friendly pool with a 30-foot winding stone tower waterslide, umbrellas, and S''il Vous Play interactive water area."},
        {"icon": "🏊", "title": "Beau Soleil Pool", "badge": "Quiet Pool", "description": "Tranquil leisure pool nestled in private hedges, designed for relaxing and sunbathing in a quiet Mediterranean setting."},
        {"icon": "🏋️", "title": "Athlétique Fitness Center", "badge": "Wellness", "description": "Contemporary gym offering modern cardio machinery, free weights, and stretching equipment."},
        {"icon": "♟️", "title": "Riviera Lawn Games & Walking Path", "badge": "Recreation", "description": "Bocce ball court, life-sized chess on the lawn, and scenic waterfront promenade around Barefoot Bay."}
    ]'::jsonb,
    transit_times = '{"EPCOT": 8, "Hollywood Studios": 10, "Magic Kingdom": 20, "Animal Kingdom": 16, "Disney Springs": 14}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎨", "title": "European Mediterranean Grandeur", "text": "Celebrates the grand art, terraced gardens, and coastal architecture of the European Riviera that captivated Walt and Lillian Disney."}
    ]'::jsonb
WHERE name ILIKE '%Riviera%';

-- ============================================================================
-- 11. Disney's Saratoga Springs Resort & Spa
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe Villa',
    feature_pool = 'High Rock Spring Pool',
    transportation_modes = ARRAY['Boat', 'Walking', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "High Rock Spring Pool", "badge": "Feature Pool", "description": "Zero-entry pool with cascading waterfalls, bubbling geysers, a 128-foot waterslide through stone rocks, and two whirlpools."},
        {"icon": "🏊", "title": "The Paddock Pool & 3 Quiet Leisure Pools", "badge": "Pools", "description": "Secondary feature pool with a 146-foot slide, plus 3 quiet pools at Treehouse Villas, Congress Park, and The Grandstand."},
        {"icon": "🧖", "title": "Senses Spa & Health Club", "badge": "Wellness", "description": "Full-service spa retreat offering therapeutic body treatments, facials, and high-performance fitness center."},
        {"icon": "⛳", "title": "Disney''s Lake Buena Vista Golf Course", "badge": "Sports", "description": "PGA Tour championship 18-hole golf course winding through pine forests and pastel resort villas."}
    ]'::jsonb,
    transit_times = '{"Disney Springs": 6, "EPCOT": 12, "Hollywood Studios": 14, "Magic Kingdom": 18, "Animal Kingdom": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🏇", "title": "Upstate New York Victorian Retreat", "text": "Themed after historic 1800s Saratoga Springs, New York, celebrated for Victorian horse racing, mineral springs, and rolling hills."}
    ]'::jsonb
WHERE name ILIKE '%Saratoga Springs%';

-- ============================================================================
-- 12. Disney's Old Key West Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Deluxe Villa',
    feature_pool = 'Sandcastle Pool',
    transportation_modes = ARRAY['Boat', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Sandcastle Pool", "badge": "Feature Pool", "description": "149,441-gallon pool with a 125-foot waterslide built into a giant decorative sandcastle, dry sauna in the lighthouse, and whirlpool."},
        {"icon": "🏊", "title": "Old Turtle Pond, South Point & Miller''s Road Pools", "badge": "Quiet Pools", "description": "Three peaceful neighborhood leisure pools each equipped with whirlpool spas across the sprawling grounds."},
        {"icon": "🎾", "title": "Conch Flats Community Hall & Tennis", "badge": "Recreation", "description": "Community center with ping pong, video games, bicycle rentals, shuffleboard, and lighted tennis courts."},
        {"icon": "🪵", "title": "Campfire by the Hospitality House", "badge": "Family Fun", "description": "Evening storytelling, marshmallow roasts, and waterfront movie screenings under the Florida stars."}
    ]'::jsonb,
    transit_times = '{"Disney Springs": 10, "EPCOT": 12, "Hollywood Studios": 14, "Magic Kingdom": 18, "Animal Kingdom": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🐚", "title": "Conch Republic & The First DVC Resort", "text": "The inaugural 1991 Disney Vacation Club property, featuring pastel gingerbread Victorian estates and the breezy lifestyle of the Florida Keys."}
    ]'::jsonb
WHERE name ILIKE '%Old Key West%';

-- ============================================================================
-- 13. Disney's Caribbean Beach Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Moderate',
    feature_pool = 'Fuentes del Morro Pool',
    transportation_modes = ARRAY['Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Fuentes del Morro Pool", "badge": "Feature Pool", "description": "Zero-entry Spanish colonial citadel pool with two waterslides (including an 82-foot slide), water cannons, and shipwreck splash zone."},
        {"icon": "🏊", "title": "5 Island Village Quiet Leisure Pools", "badge": "Quiet Pools", "description": "Individual secluded leisure pools located in each of the 5 island villages (Barbados, Jamaica, Martinique, Trinidad, Aruba)."},
        {"icon": "🏃", "title": "Barefoot Bay 1.4-Mile Walking Trail", "badge": "Trail", "description": "Paved scenic loop around 45-acre Barefoot Bay with serene Caribbean island breezes and hammocks."},
        {"icon": "🪵", "title": "Caribbean Campfire & Island Movies", "badge": "Family Fun", "description": "Nightly marshmallow roasts on the white sands of Barefoot Bay followed by Disney movie screenings."}
    ]'::jsonb,
    transit_times = '{"Hollywood Studios": 6, "EPCOT": 10, "Animal Kingdom": 14, "Magic Kingdom": 18, "Disney Springs": 12}'::jsonb,
    architectural_lore = '[
        {"emoji": "🦜", "title": "Island Villages Around Barefoot Bay", "text": "Encompasses five colorful island villages (Barbados, Jamaica, Martinique, Trinidad, Aruba) surrounding 45-acre Barefoot Bay."}
    ]'::jsonb
WHERE name ILIKE '%Caribbean Beach%';

-- ============================================================================
-- 14. Disney's Port Orleans Resort - French Quarter
-- ============================================================================
UPDATE resorts SET
    tier = 'Moderate',
    feature_pool = 'Doubloon Lagoon',
    transportation_modes = ARRAY['Boat', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Doubloon Lagoon", "badge": "Feature Pool", "description": "Mardi Gras themed pool featuring Scales, a 51-foot blue sea serpent waterslide ridden by King Triton, with alligator water spouts."},
        {"icon": "🎷", "title": "Sassagoula River Cruise & Waterfront Walk", "badge": "Scenic", "description": "Scenic water taxi ride along the Sassagoula River to Disney Springs, plus a picturesque 1-mile path connecting to Riverside."},
        {"icon": "🪵", "title": "Cajun Campfire & Movies Under the Stars", "badge": "Family Fun", "description": "Nightly marshmallow roasting on the courtyard lawn followed by Disney family movie screenings."}
    ]'::jsonb,
    transit_times = '{"Disney Springs": 10, "EPCOT": 14, "Hollywood Studios": 16, "Magic Kingdom": 16, "Animal Kingdom": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎺", "title": "New Orleans French Quarter Romance", "text": "Intimate cobblestone streets, gas lanterns, wrought-iron balconies, and Mardi Gras pageantry along the Sassagoula River."}
    ]'::jsonb
WHERE name ILIKE '%French Quarter%';

-- ============================================================================
-- 15. Disney's Port Orleans Resort - Riverside
-- ============================================================================
UPDATE resorts SET
    tier = 'Moderate',
    feature_pool = 'Ol'' Man Island',
    transportation_modes = ARRAY['Boat', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Ol'' Man Island Pool", "badge": "Feature Pool", "description": "3.5-acre island pool complex featuring a working sawmill with cascading waterfalls, 95-foot waterslide, and whirlpool spa."},
        {"icon": "🏊", "title": "5 Country Courtyard Quiet Pools", "badge": "Quiet Pools", "description": "Five peaceful heated leisure pools dispersed across the Magnolia Bend mansions and rustic Alligator Bayou cottages."},
        {"icon": "🎣", "title": "The Fishin'' Hole & Surrey Bikes", "badge": "Recreation", "description": "Catch-and-release cane pole fishing on the river, surrey bicycle rentals, and horse-drawn carriage rides."},
        {"icon": "🪵", "title": "Riverside Campfire & Yehaa Bob Musical Saloon", "badge": "Entertainment", "description": "Campfire storytelling and lively family piano sing-alongs with Yehaa Bob at River Roost Lounge."}
    ]'::jsonb,
    transit_times = '{"Disney Springs": 12, "EPCOT": 14, "Hollywood Studios": 16, "Magic Kingdom": 16, "Animal Kingdom": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🚢", "title": "Louisiana Riverboat & Bayou Culture", "text": "Contrasts the stately columned mansions of Magnolia Bend with the rustic tin-roof timber cottages of Alligator Bayou."}
    ]'::jsonb
WHERE name ILIKE '%Port Orleans%' AND name NOT ILIKE '%French Quarter%';

-- ============================================================================
-- 16. Disney's Pop Century Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Value',
    feature_pool = 'Hippy Dippy Pool',
    transportation_modes = ARRAY['Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Hippy Dippy Pool", "badge": "Feature Pool", "description": "235,125-gallon 1960s flower-shaped pool with flower petal water jets and adjacent kiddie pool."},
        {"icon": "🏊", "title": "Bowling Pool & Computer Pool", "badge": "Quiet Pools", "description": "Two heated leisure pools themed as a 1950s bowling pin and a 1990s desktop computer monitor with keyboard deck."},
        {"icon": "🏃", "title": "Hourglass Lake 1.3-Mile Walking Trail", "badge": "Trail", "description": "Scenic loop around Hourglass Lake connecting Pop Century to Art of Animation via the Generation Gap Bridge."},
        {"icon": "🪵", "title": "Fast Forward Arcade & Pop Campfire", "badge": "Family Fun", "description": "Classic and modern video arcade plus evening marshmallow roasts and Movies Under the Stars."}
    ]'::jsonb,
    transit_times = '{"Hollywood Studios": 8, "EPCOT": 12, "Animal Kingdom": 15, "Magic Kingdom": 20, "Disney Springs": 14}'::jsonb,
    architectural_lore = '[
        {"emoji": "📻", "title": "20th Century Pop Culture Icons", "text": "Celebrates the pop fads, toys, and cultural moments of the 1950s through 1990s with oversized 4-story memorabilia sculptures."}
    ]'::jsonb
WHERE name ILIKE '%Pop Century%';

-- ============================================================================
-- 17. Disney's Art of Animation Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Value',
    feature_pool = 'The Big Blue Pool',
    transportation_modes = ARRAY['Skyliner', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "The Big Blue Pool", "badge": "Feature Pool", "description": "The largest resort pool on Disney property (308,527 gallons), themed after Finding Nemo with giant character sculptures and underwater speakers."},
        {"icon": "🏊", "title": "Cozy Cone Pool & Flippin'' Fins Pool", "badge": "Quiet Pools", "description": "Two themed leisure pools: Cozy Cone Pool with cone-shaped cabanas (Cars) and Flippin'' Fins Pool with orchestral statues (Little Mermaid)."},
        {"icon": "🎨", "title": "Animation Courtyard & Art Classes", "badge": "Family Fun", "description": "Complimentary animation drawing classes taught by Disney artists in the main lobby, plus Pixel Play Arcade."},
        {"icon": "🪵", "title": "Campfire & Movies Under the Stars", "badge": "Family Fun", "description": "Evening marshmallow roasts and outdoor screenings of classic Disney and Pixar animated features."}
    ]'::jsonb,
    transit_times = '{"Hollywood Studios": 8, "EPCOT": 12, "Animal Kingdom": 15, "Magic Kingdom": 20, "Disney Springs": 14}'::jsonb,
    architectural_lore = '[
        {"emoji": "🦁", "title": "Animation Process & Disney Classics", "text": "Walk through sketch-to-screen storyboards celebrating The Lion King, Cars, Finding Nemo, and The Little Mermaid."}
    ]'::jsonb
WHERE name ILIKE '%Art of Animation%';

-- ============================================================================
-- 18. Disney's All-Star Movies Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Value',
    feature_pool = 'Fantasia Pool',
    transportation_modes = ARRAY['Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Fantasia Pool", "badge": "Feature Pool", "description": "Sorcerer Mickey fountains spray water across this cinematic pool inspired by Disney''s 1940 classic Fantasia, with a kiddie pool."},
        {"icon": "🏊", "title": "Duck Pond Pool", "badge": "Quiet Pool", "description": "Hockey-rink-shaped leisure pool themed after The Mighty Ducks with giant goalposts and duck-face referee decor."},
        {"icon": "🎮", "title": "Reel Fun Arcade", "badge": "Recreation", "description": "Energetic family games arcade packed with classic and contemporary video games."},
        {"icon": "🪵", "title": "Cinema Campfire & Movies Under the Stars", "badge": "Family Fun", "description": "Nightly Disney movies screened on the lawn near the Fantasia Pool, preceded by toasted marshmallows."}
    ]'::jsonb,
    transit_times = '{"Animal Kingdom": 8, "Hollywood Studios": 12, "EPCOT": 16, "Magic Kingdom": 20, "Disney Springs": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎬", "title": "Classic Disney Cinema Lore", "text": "Giant installations honoring cinema legends: Fantasia, Toy Story, 101 Dalmatians, The Mighty Ducks, and Herbie the Love Bug."}
    ]'::jsonb
WHERE name ILIKE '%All-Star Movies%';

-- ============================================================================
-- 19. Disney's All-Star Music Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Value',
    feature_pool = 'Calypso Pool',
    transportation_modes = ARRAY['Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Calypso Pool", "badge": "Feature Pool", "description": "251,418-gallon guitar-shaped pool with a fountain of The Three Caballeros (Donald Duck, José Carioca, and Panchito) spouting water."},
        {"icon": "🏊", "title": "Piano Pool", "badge": "Quiet Pool", "description": "Serene leisure pool shaped like a grand piano finished with a black-and-white keyboard pool deck."},
        {"icon": "🏃", "title": "All-Star 1-Mile Jogging Trail", "badge": "Trail", "description": "Paved path connecting all three All-Star resorts (Movies, Music, Sports) across colorful landscaped courtyards."},
        {"icon": "🪵", "title": "Note''able Games & Campfire", "badge": "Family Fun", "description": "Family gaming arcade and evening campfire storytelling with Movies Under the Stars."}
    ]'::jsonb,
    transit_times = '{"Animal Kingdom": 8, "Hollywood Studios": 12, "EPCOT": 16, "Magic Kingdom": 20, "Disney Springs": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🎸", "title": "Musical Genres Across America", "text": "Larger-than-life instruments highlighting Broadway, calypso, country, jazz, and rock ''n'' roll with guitar- and piano-shaped pools."}
    ]'::jsonb
WHERE name ILIKE '%All-Star Music%';

-- ============================================================================
-- 20. Disney's All-Star Sports Resort
-- ============================================================================
UPDATE resorts SET
    tier = 'Value',
    feature_pool = 'Surfboard Bay Pool',
    transportation_modes = ARRAY['Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Surfboard Bay Pool", "badge": "Feature Pool", "description": "242,471-gallon pool lined with 3-story surfboards and wave barriers, designed for splashing under the sun."},
        {"icon": "🏊", "title": "Grand Slam Pool", "badge": "Quiet Pool", "description": "Baseball-diamond-shaped leisure pool with Goofy on the pitcher''s mound spouting water at swimmers."},
        {"icon": "🏈", "title": "Touchdown Turf & Game Point Arcade", "badge": "Sports", "description": "Full-size outdoor football field for children to toss footballs, plus a high-energy video arcade."},
        {"icon": "🪵", "title": "Sports Campfire & Evening Movies", "badge": "Family Fun", "description": "Complimentary outdoor Disney movies screened on the football field with evening campfire roasts."}
    ]'::jsonb,
    transit_times = '{"Animal Kingdom": 8, "Hollywood Studios": 12, "EPCOT": 16, "Magic Kingdom": 20, "Disney Springs": 18}'::jsonb,
    architectural_lore = '[
        {"emoji": "🏈", "title": "Athletic Feats & Iconic Sports", "text": "Towering football helmets, surfboards, tennis rackets, and baseball bats salute the world of athletic competition."}
    ]'::jsonb
WHERE name ILIKE '%All-Star Sports%';

-- ============================================================================
-- 21. Disney's Fort Wilderness Resort & Campground (and Cabins & Campsites)
-- ============================================================================
UPDATE resorts SET
    tier = 'Campground',
    feature_pool = 'Meadow Swimmin'' Pool',
    transportation_modes = ARRAY['Boat', 'Bus'],
    recreation = '[
        {"icon": "🏊", "title": "Meadow Swimmin'' Pool", "badge": "Feature Pool", "description": "Features a corkscrew waterslide twisting around a water tower, whirlpool spa, and interactive water play area."},
        {"icon": "🏊", "title": "Wilderness Swimmin'' Pool", "badge": "Quiet Pool", "description": "Peaceful heated leisure pool set beneath towering cypress trees for quiet lap swimming and relaxation."},
        {"icon": "🐴", "title": "Tri-Circle-D Ranch & Trail Rides", "badge": "Recreation", "description": "Home to the horses of Main Street USA: pony rides, guided trail rides, and horse-drawn carriage excursions."},
        {"icon": "🪵", "title": "Chip ''n'' Dale''s Campfire Sing-A-Long", "badge": "Family Fun", "description": "Iconic fireside sing-along and marshmallow roast hosted by Chip and Dale, followed by an outdoor Disney movie."}
    ]'::jsonb,
    transit_times = '{"Magic Kingdom": 12, "EPCOT": 18, "Hollywood Studios": 20, "Animal Kingdom": 22, "Disney Springs": 20}'::jsonb,
    architectural_lore = '[
        {"emoji": "🏕️", "title": "Frontier Wilderness Along Bay Lake", "text": "750 wooded acres of cypress and pine where guests camp under the Florida stars, take carriage rides, and visit the Tri-Circle-D Ranch."}
    ]'::jsonb
WHERE name ILIKE '%Fort Wilderness%';

COMMIT;
