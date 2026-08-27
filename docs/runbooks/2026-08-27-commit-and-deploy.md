# 2026-08-27 — Commit, deploy, confirm nothing broke

**Do this first.** Everything else in this folder assumes the work is committed and live.

## Context

A large change to the wait-time and crowd-calendar prediction stack was completed on 2026-08-27 and left **uncommitted** on the `develop` branch. It spans `apps/api`, `apps/mobile`, `packages/shared`, and `.kiro/specs/crowd-calendar/`.

It includes **migration `0033_stable_baseline_and_wait_archive.sql`**, which adds two columns to `ride_shapes`, one to `experience_season_hour`, and three new tables. The application code writes those columns unconditionally. **If the code deploys before the migration applies, `upsertRideShapes` throws, the per-park `try/catch` in the sampling pass swallows it as "Failed to sample park", and the sampler silently stops updating anything.** That is the main risk here.

The migration was already applied by hand to the Neon database referenced by `apps/api/.env.dev`.

## Steps

### 1. Confirm the working tree holds only intended changes

```
git status --porcelain
```

Expect ~21 modified and ~10 new files. Two groups are **not** part of this work and were in flight separately — leave them alone or commit them separately:

- `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`
- `apps/mobile/src/screens/catalog/directions.ts` and its tests
- `.kiro/specs/experience-detail-redesign/*`

There should be **no** `_tmp*.ts` files anywhere. If there are, delete them — they are throwaway diagnostics.

### 2. Run the gate

```
npm run verify
```

Must exit `0`. Reference figures from 2026-08-27:

```
apps/api        Test Files 295 passed   Tests 1973 passed   coverage 96.64 / 93.97 / 100 / 97.01
apps/mobile     Test Suites 154 passed  Tests  835 passed
packages/shared Test Files  22 passed   Tests  151 passed
```

If `apps/api` fails to typecheck with `TS2339` on `capturedForecast` or `forecastAccuracy`, run `npm run build` in `packages/shared` — its `dist` is gitignored and `apps/api` resolves the built output.

### 3. Commit and push

Stage by name rather than `git add .`, to avoid picking up the in-flight mobile work above. Push to a branch, not straight to `develop`, unless you specifically want it on `develop`.

### 4. Confirm the migration applied wherever production points

Migrations run in the Render deploy build step (`npm run migrate`). If production uses a different `DATABASE_URL` than `.env.dev`, verify after deploy:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ride_shapes' AND column_name LIKE 'baseline%';

SELECT to_regclass('wait_archive')        AS wait_archive,
       to_regclass('wait_forecast_log')   AS wait_forecast_log,
       to_regclass('wait_forecast_accuracy') AS wait_forecast_accuracy;
```

Expect both `baseline_wait_minutes` and `baseline_sample_count`, and three non-null `to_regclass` results.

Also confirm the backfill landed — a null baseline everywhere means the index has no eligible rides and the crowd index stops being written:

```sql
SELECT COUNT(*) AS rows,
       SUM(CASE WHEN baseline_wait_minutes IS NULL THEN 1 ELSE 0 END) AS null_baseline,
       SUM(CASE WHEN baseline_wait_minutes >= 5 AND baseline_sample_count >= 5 THEN 1 ELSE 0 END) AS basket_eligible
FROM ride_shapes;
```

On the `.env.dev` database on 2026-08-27 this was 7,928 rows / 0 null / **7,556 eligible** — identical to the pre-migration eligible count, which is the point: swapping the denominator dropped no ride.

### 5. Confirm sampling still works after deploy

During park hours (roughly 8 AM – 11 PM ET):

```sql
SELECT COUNT(*) AS samples_last_hour
FROM wait_samples WHERE observed_at > now() - interval '1 hour';
```

Expect roughly 200–350 (about 55 rides × 4–5 passes). **Zero during park hours means the sampler is failing** — check the Render logs for `Failed to sample park`, and re-check step 4.

## Done when

- `npm run verify` exited `0` and the work is pushed.
- The three new tables and two new columns exist wherever production points.
- `wait_samples` is still growing during park hours.

Then move to `2026-09-03-verify-measurement-loop.md`.
