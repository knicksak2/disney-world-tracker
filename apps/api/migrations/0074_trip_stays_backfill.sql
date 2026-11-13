-- Disney World Tracker: backfill Trip lodging stays from the resorts a Trip already records (trip-lodging-stays spec,
-- Requirement 10). Data only: 0073 created the table.
--
-- Conservative and idempotent. Only Trips with NO trip_stays row are touched, so running this twice changes nothing the
-- second time, and a Trip that already has stays is never altered. trip_resorts, trip_booking_settings and trips are
-- only READ; none of them is modified.
--
--   (a) A Trip with exactly one trip_resorts row gets one stay:
--         lodging_kind = trip_booking_settings.stay_type when set, otherwise 'resort';
--         a 'resort' stay references the Resort, any other kind carries the Resort's name as its place_name;
--         check_in  = trip_booking_settings.check_in_override when it lies within 30 days before the Trip start and not
--                     after it, otherwise the Trip start;
--         check_out = the Trip end; a Trip whose end is not after that check-in (a one-day Trip) gets an UNSCHEDULED
--                     stay (both dates NULL).
--   (b) A Trip with several trip_resorts rows gets one UNSCHEDULED 'resort' stay per row, ordered by Resort name then id
--       (the same order as TripDTO.resorts); position is that rank, capped at 7 by the column CHECK.
--   (c) A Trip with no trip_resorts row gets nothing.
--
-- Written with derived tables, uncorrelated IN / NOT IN and a self-join (no correlated subquery, no window function, no
-- HAVING: pg-mem silently ignores HAVING, so the per-Trip resort count is filtered in an outer WHERE instead) so
-- the file also runs on the pg-mem harnesses that apply every migration file; it is verified for real against Postgres in
-- migration0074.livedb.test.ts and against pg-mem in migration0073.test.ts.

BEGIN;

-- (a) exactly one recorded resort
INSERT INTO trip_stays (trip_id, position, lodging_kind, resort_id, place_name, check_in, check_out)
SELECT c.trip_id,
       0,
       c.kind,
       CASE WHEN c.kind = 'resort' THEN c.resort_id ELSE NULL END,
       CASE WHEN c.kind = 'resort' THEN NULL ELSE substring(c.resort_name from 1 for 100) END,
       CASE WHEN c.end_date > c.ci THEN c.ci ELSE NULL END,
       CASE WHEN c.end_date > c.ci THEN c.end_date ELSE NULL END
  FROM (
        SELECT t.id                         AS trip_id,
               t.end_date                   AS end_date,
               tr.resort_id                 AS resort_id,
               r.name                       AS resort_name,
               COALESCE(s.stay_type, 'resort') AS kind,
               CASE WHEN s.check_in_override IS NOT NULL
                         AND s.check_in_override >= t.start_date - 30
                         AND s.check_in_override <= t.start_date
                    THEN s.check_in_override
                    ELSE t.start_date END   AS ci
          FROM trips t
          JOIN trip_resorts tr ON tr.trip_id = t.id
          JOIN resorts r ON r.id = tr.resort_id
          LEFT JOIN trip_booking_settings s ON s.trip_id = t.id
         WHERE t.id IN (SELECT g.trip_id FROM (SELECT trip_id AS trip_id, count(*) AS n FROM trip_resorts GROUP BY trip_id) g WHERE g.n = 1)
           AND t.id NOT IN (SELECT have.trip_id FROM trip_stays have)
       ) c;

-- (b) several recorded resorts: one unscheduled stay each, ranked by Resort name then id
INSERT INTO trip_stays (trip_id, position, lodging_kind, resort_id, place_name, check_in, check_out)
SELECT x.trip_id,
       CASE WHEN x.rank > 7 THEN 7 ELSE x.rank END,
       'resort',
       x.resort_id,
       NULL,
       NULL,
       NULL
  FROM (
        SELECT a.trip_id AS trip_id,
               a.resort_id AS resort_id,
               count(b.resort_id) AS rank
          FROM trip_resorts a
          JOIN resorts ra ON ra.id = a.resort_id
          LEFT JOIN (
                     SELECT tr2.trip_id AS trip_id, tr2.resort_id AS resort_id, r2.name AS name
                       FROM trip_resorts tr2
                       JOIN resorts r2 ON r2.id = tr2.resort_id
                    ) b
                 ON b.trip_id = a.trip_id
                AND (b.name < ra.name OR (b.name = ra.name AND b.resort_id < a.resort_id))
         WHERE a.trip_id IN (SELECT g.trip_id FROM (SELECT trip_id AS trip_id, count(*) AS n FROM trip_resorts GROUP BY trip_id) g WHERE g.n > 1)
           AND a.trip_id NOT IN (SELECT have.trip_id FROM trip_stays have)
         GROUP BY a.trip_id, a.resort_id
       ) x;

COMMIT;
