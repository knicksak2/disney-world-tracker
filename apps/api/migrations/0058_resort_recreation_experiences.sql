BEGIN;

-- ============================================================================
-- 1. Insert signature resort recreation activities into experiences catalog
-- ============================================================================
INSERT INTO experiences (
    id,
    upstream_entity_id,
    name,
    park,
    category,
    description,
    active,
    area_type,
    resort_id,
    price_tier,
    sub_type
)
VALUES
    (
        'b1010001-c001-4000-8000-000000000001',
        'rec-coronado-paint',
        'Colors of Coronado Painting Experience',
        NULL,
        'Recreation',
        'Paint an iconic Disney masterpiece alongside master artists overlooking panoramic views from Gran Destino Tower.',
        TRUE,
        'Resort',
        (SELECT id FROM resorts WHERE name ILIKE '%Coronado Springs%' LIMIT 1),
        '$$$',
        'Arts & Crafts'
    ),
    (
        'b1010001-c001-4000-8000-000000000002',
        'rec-coronado-mosaic',
        'Spanish Mosaic Art Experience',
        NULL,
        'Recreation',
        'Design and handcraft your own unique Spanish mosaic art tile inspired by Catalan architecture at Dahlia Lounge terrace.',
        TRUE,
        'Resort',
        (SELECT id FROM resorts WHERE name ILIKE '%Coronado Springs%' LIMIT 1),
        '$$',
        'Arts & Crafts'
    ),
    (
        'b1010001-c001-4000-8000-000000000003',
        'rec-coronado-sangria',
        'Sangria University',
        NULL,
        'Recreation',
        'Delve into the history and craft of four artisan sangria recipes with sommeliers at Three Bridges Bar & Grill.',
        TRUE,
        'Resort',
        (SELECT id FROM resorts WHERE name ILIKE '%Coronado Springs%' LIMIT 1),
        '$$$',
        'Class'
    ),
    (
        'b1010001-c001-4000-8000-000000000004',
        'rec-riviera-paint',
        'Painting on the Riviera',
        NULL,
        'Recreation',
        'Create your own Mediterranean-inspired acrylic painting on canvas with guidance from a Disney artist at Topolino''s Terrace.',
        TRUE,
        'Resort',
        (SELECT id FROM resorts WHERE name ILIKE '%Riviera%' LIMIT 1),
        '$$$',
        'Arts & Crafts'
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    area_type = EXCLUDED.area_type,
    resort_id = EXCLUDED.resort_id,
    price_tier = EXCLUDED.price_tier,
    sub_type = EXCLUDED.sub_type;

-- ============================================================================
-- 2. Update Coronado Springs Resort recreation JSONB with experience IDs
-- ============================================================================
UPDATE resorts SET
    recreation = '[
        {"id": "b1010001-c001-4000-8000-000000000001", "icon": "🎨", "title": "Colors of Coronado Painting Experience", "badge": "Arts & Crafts", "description": "Paint an iconic Disney masterpiece alongside master artists overlooking panoramic views from Gran Destino Tower.", "hours": "Select Afternoons", "priceTier": "$$$"},
        {"id": "b1010001-c001-4000-8000-000000000002", "icon": "🎨", "title": "Spanish Mosaic Art Experience", "badge": "Arts & Crafts", "description": "Design and handcraft your own unique Spanish mosaic art tile inspired by Catalan architecture at Dahlia Lounge terrace.", "hours": "Select Mornings", "priceTier": "$$"},
        {"id": "b1010001-c001-4000-8000-000000000003", "icon": "🍷", "title": "Sangria University", "badge": "Class", "description": "Delve into the history and craft of four artisan sangria recipes with sommeliers at Three Bridges Bar & Grill.", "hours": "Saturdays & Sundays", "priceTier": "$$$"},
        {"icon": "🏊", "title": "The Dig Site & Lost City of Cibola Pool", "badge": "Feature Pool", "description": "50-foot Mayan pyramid with cascading waterfall, 123-foot jaguar waterslide, and the largest outdoor hot tub at WDW (22-person capacity).", "hours": "9:00 AM - 10:00 PM", "priceTier": "Included"},
        {"icon": "🏊", "title": "Casitas, Ranchos & Cabanas Leisure Pools", "badge": "Quiet Pools", "description": "Three tranquil heated leisure pools located in each village neighborhood for relaxed swimming.", "hours": "7:00 AM - 11:00 PM", "priceTier": "Included"},
        {"icon": "🏃", "title": "Lago Dorado 0.9-Mile Jogging Loop", "badge": "Trail", "description": "Scenic paved waterfront path connecting all four village neighborhoods across over-water boardwalk bridges.", "hours": "24 Hours", "priceTier": "Free"},
        {"icon": "🏋️", "title": "La Vida Health Club & Fitness Center", "badge": "Wellness", "description": "24/7 fitness facility with modern cardio and weight machines, dry saunas, and wellness services.", "hours": "24 Hours", "priceTier": "Included"},
        {"icon": "🪵", "title": "Campfire & Movies Under the Stars", "badge": "Family Fun", "description": "Nightly marshmallow roasts by Lago Dorado followed by complimentary Disney movie screenings under the Florida twilight.", "hours": "Evenings", "priceTier": "Free"}
    ]'::jsonb
WHERE name ILIKE '%Coronado Springs%';

-- ============================================================================
-- 3. Update Riviera Resort recreation JSONB with experience IDs
-- ============================================================================
UPDATE resorts SET
    recreation = '[
        {"id": "b1010001-c001-4000-8000-000000000004", "icon": "🎨", "title": "Painting on the Riviera", "badge": "Arts & Crafts", "description": "Create your own Mediterranean-inspired acrylic painting on canvas with guidance from a Disney artist at Topolino''s Terrace.", "hours": "Select Mornings", "priceTier": "$$$"},
        {"icon": "🏊", "title": "Riviera Pool & S''il Vous Play", "badge": "Feature Pool", "description": "Family-friendly pool with a 30-foot winding stone tower waterslide, umbrellas, and S''il Vous Play interactive water area.", "hours": "9:00 AM - 10:00 PM", "priceTier": "Included"},
        {"icon": "🏊", "title": "Beau Soleil Pool", "badge": "Quiet Pool", "description": "Tranquil leisure pool nestled in private hedges, designed for relaxing and sunbathing in a quiet Mediterranean setting.", "hours": "7:00 AM - 11:00 PM", "priceTier": "Included"},
        {"icon": "🏋️", "title": "Athlétique Fitness Center", "badge": "Wellness", "description": "Contemporary gym offering modern cardio machinery, free weights, and stretching equipment.", "hours": "24 Hours", "priceTier": "Included"},
        {"icon": "♟️", "title": "Riviera Lawn Games & Bocce Ball", "badge": "Recreation", "description": "Bocce ball court, life-sized chess on the lawn, and scenic waterfront promenade around Barefoot Bay.", "hours": "Daylight", "priceTier": "Free"}
    ]'::jsonb
WHERE name ILIKE '%Riviera%';

COMMIT;
