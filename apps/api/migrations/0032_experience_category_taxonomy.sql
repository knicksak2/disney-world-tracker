-- Disney World Tracker — add Walkthrough, PlayArea, Game Experience_Categories.
--
-- catalog-taxonomy-cleanup adds three new categories to classify self-paced
-- trails/aquariums/museums (Walkthrough), post-ride labs/play areas (PlayArea),
-- and park-wide games/scavenger hunts (Game).
--
-- Strictly additive: widens the `experiences_category_chk` CHECK to accept the
-- three new members alongside all pre-existing members.
-- Validates: Requirements 2.1, 2.2

BEGIN;

ALTER TABLE experiences DROP CONSTRAINT experiences_category_chk;

ALTER TABLE experiences
    ADD CONSTRAINT experiences_category_chk CHECK (category IN (
        'Ride',
        'Show',
        'Restaurant',
        'Parade',
        'Character_Meet',
        'Walkthrough',
        'PlayArea',
        'Game',
        'Tour',
        'Recreation',
        'Spa',
        'Event',
        'Other',
        'Resort'
    ));

COMMIT;
