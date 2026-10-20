# Trip-booking Reminder_Cron: why the morning runs fail

Read-only investigation. No source was modified. (The step prompt's `{{report_path}}` placeholder was never substituted, so I wrote this file here.)

Tags used below: **[V]** = verified by reading code or docs at the cited line. **[I]** = inference. **[?]** = could not be determined from the repo.

---

## 1. Summary

1. **The app is not producing the 503s [V].** The reminder handler can only answer 202, 401 (`unauthorized`) or 500 (`internal_error`). `routes.ts:418-446` throws only those two error codes. `errors.ts` maps them to 401 and 500. A 503 that comes back in 0.4-1.5 s must come from Render or its edge, not from this code. This matches the note in `docs/hosting.md:117` that fast failures of about 200-600 ms are the edge answering for a sleeping or crashed service. **[I]** for the conclusion; **[V]** for the handler's status codes.

2. **At 6:00 ET the service is asleep by design, and nothing in the repo or docs wakes it first [V].**
   - The keep-alive is designed as `*/10 0-1,7-23 * * *` (`design.md:17`), so it starts at 07:00.
   - `docs/hosting.md:113` says "7am-2am".
   - The 2026-08 runbook measured the real keep-alive at about 07:40-00:50 ET, with a single overnight gap (`docs/runbooks/2026-08-27-commit-and-deploy.md:100`).
   - Render sleeps a free service after 15 idle minutes, and the spin-up "takes about one minute" per [Render's free-tier docs](https://render.com/docs/free).
   - cron-job.org gives up at 30 s. Yesterday's wake took 28.7 s (success) and today's took longer than 30 s (timeout). So the 7:10 run is a coin flip. The 7:20 success today is expected: the 7:10 request still woke the container after cron-job.org gave up.

3. **The spec assumed a 6:00 request would wake the service and the +10/+20 retries would cover it [V].** That is the only reasoning in `design.md:17`, `requirements.md:212` and `docs/hosting.md:133-135`. The hosting-impact estimate (about 0.25 h/day, `design.md:1075`) also assumes the instance is up soon after 6:00 and stays up. The observed data contradicts that.

4. **Unexplained by the code: why 6:00, 6:10, 6:20 and 7:00 all got an instant 503 instead of one of them waking the service [?].** If a 6:00 request had started the container, 6:10 would have hit a warm instance. The first success of the day, a cold start taking 28.7 s, begins around 7:10. Pending your diagnostics (section 6), my best reading is that requests before roughly 7:00-7:10 did not start the container, or the start failed. I cannot tell which from the repo. Diagnostic steps are in section 6.

5. **Late calls DO deliver the reminders; the real gap is that there are no ticks after 7:20 until 20:00 [V].**
   - Reminders have a 180-minute catch-up window (`config.ts:87`, `reminders.ts:48`).
   - The dining "open" reminder is valid 06:00-09:00 and the Lightning Lane "open" reminder 07:00-10:00.
   - The 7:10 (yesterday) and 7:20 (today) passes ran inside that window. If a trip had a window dropping on those days, the push went out at about 7:10 and 7:20, late rather than missing.
   - Check the ledger (section 6, SQL). "No notification at 6" may also mean no trip had a drop that day.

6. **Fix, ranked.**
   - First: make sure the service is awake before 06:00 and stays awake until the keep-alive takes over. This is operator-only (cron-job.org), with a roughly +36 h/month Render cost. Run the diagnostic first (section 6), because this fix works only if a pre-6:00 request actually wakes the container.
   - Second: add late catch-up ticks at 8:15 and 9:15 (operator-only, doc amendment).
   - Third: the paid $7 always-on tier.
   - No code change is needed to deliver late reminders.

---

## 2. Q1: Intended send time and cron schedule

| Item | Value | Source |
|---|---|---|
| Dining window drop time | 06:00 WDW (`dropMinutes: 360`) | `packages/shared/src/tripBooking.ts:44` |
| Lightning Lane drop time | 07:00 WDW (`dropMinutes: 420`) | `tripBooking.ts:53` |
| Lead `eve` | day before the drop, 20:00 | `tripBooking.ts:66` |
| Lead `open` | exactly at the drop (06:00 dining / 07:00 LL) | `tripBooking.ts:67` |
| Lead `week` | drop minus 7 days, 09:00 (**disabled by default**) | `tripBooking.ts:68`, default `eve,open` at `config.ts:86` |
| Send window | 06:00 inclusive to 23:00 exclusive | `config.ts:94-95`, `reminders.ts:98` |
| Intended Reminder_Cron | `0,10,20 6,7,20 * * *` in **America/New_York**, `HEAD` or `POST`, header `x-cron-secret` | `requirements.md:212` (R8.12), `design.md:17`, `design.md:1070-1071`, `tasks.md:346-348`, `docs/hosting.md:124-135`, `render.yaml` comment on `TRIP_BOOKING_CRON_SECRET` |

- `docs/hosting.md:130` tells the operator the timezone (`America/New_York`) and the exact crontab. No file in `docs/runbooks/` mentions the reminder cron.
- Task 15.1 (operator cron setup) is still unchecked at `tasks.md:346`.
- The design intends the 06:00 "open" reminder to fire as the dining window opens.

**Timezone caveat [?].** The history you quoted shows 6, 7 and 20, which exactly matches the hours in the crontab. That suggests the job timezone and the display timezone agree. They may both be ET, or both be something else. If the job's timezone was left at a non-ET default, the real ET times differ from what the docs assume. In cron-job.org, check the job's own timezone setting and the account display timezone; both should read America/New_York. A UTC job would put "6:00" at 2 AM ET, which would explain the failures even more simply. The repo cannot tell me which.

---

## 3. Q2: Endpoint behaviour, catch-up, idempotency

**Handler [V].** `apps/api/src/services/tripBooking/routes.ts:418-446`:
- `gateCronSecret` does a constant-time compare (`passGate.ts:secretMatches`). A bad or missing secret gives 401 and starts no pass.
- `POST` calls `reminderRunner.tryStart()` and returns 202 with `{status:'accepted'}` or `{status:'skipped', reason}`.
- `HEAD` calls `tryStart()` and returns 202 with no body.
- `tryStart()` (`runner.ts:185-213`) decides synchronously, then does `void runPass(now)` at `runner.ts:204`. The 202 goes out before any DB work. So 202 fires within milliseconds once the process is awake. The 1-2 s evening times are request overhead.

**Due-ness [V].**
- `runner.ts:77-` computes `today = wdwToday(now)` and WDW minutes from `wdwClock.ts` (America/New_York).
- It returns early outside the 06:00-23:00 send window (`runner.ts:90`).
- It lists candidate trips, then `deriveDueReminders` (`reminders.ts:52-`).
- A reminder is due when `fireAt <= now < fireAt + catchup` (`reminders.ts:48-50`), with `catchup` = 180 minutes by default (`config.ts:87`).

**Late calls [V].** A pass at 7:10 or 7:20 still finds the 06:00 dining "open" reminder due, because it is inside its 180-minute window (06:00-09:00). Same for the 07:00 LL "open" reminder (07:00-10:00). This matches requirement R8.14 (`requirements.md:214`).

The catch-up only works if some tick lands inside the window. With the default crontab the ticks are 06:00/10/20, 07:00/10/20 and 20:00/10/20. If the service cannot answer during 06:00-07:20, there is no tick between 07:20 and 20:00. A dining "open" reminder would expire unsent at 09:00. That is the design gap.

**Idempotency [V].**
- The ledger `trip_booking_reminder_log` has the primary key `(trip_id, window_kind, drop_at, reminder_lead)` (`migrations/0061_trip_booking_timeline.sql:39-47`), with `claimed_at` (line 44).
- `claimReminder` is `INSERT ... ON CONFLICT DO NOTHING RETURNING` (`repo.ts:412-423`). Only the call that inserts the row dispatches.
- Already-claimed keys are filtered first (`reminders.ts:73`). A retry at :10 or :20 therefore cannot double-send.
- There is also an in-memory 300 s debounce and in-flight guard (`runner.ts:74-75`, `passGate.ts decidePassStart`). Ticks 600 s apart always clear it.
- Failure mode is at-most-once, not at-least-once. The claim is written before the push is sent (`runner.ts:131` then `runner.ts:158`). If the process dies between those two steps, that reminder is never sent. If there are no recipients the claim is also kept (`runner.ts:146`, R9.11).

---

## 4. Q3: Is the post-202 work safe on a freshly woken instance?

**Mostly yes [V].**
- **In-memory state.** Only `inFlight` and `lastStartMs` are held in memory (`runner.ts:74-75`). Losing them on sleep is harmless because the real dedupe state is in Postgres.
- **Redis.** The reminder path uses none (R8.8, `requirements.md:207`). No caches are needed. The rate limiter is registered with `rateLimit: {}` (`composeServices.ts:991`) and no Redis client, so it uses an in-memory store **[V]**; the plugin's own comment says "Redis" but the call passes none.
- **Neon.** The pass queries Neon on first use. The pool has `connectionTimeoutMillis: 10_000` (`db/pool.ts:35`), and a Neon wake is "a couple of seconds" (`docs/hosting.md:134-135` area). If the first query failed, the pass would log and end (`runner.ts:170`), and the next tick (10 minutes later) would retry. A pass that fails for this reason produces a **202 with no reminders**, so a green 202 in cron-job.org does not prove the push went out. Check Render logs for `trip booking reminder pass complete` or `... unexpected error`.
- **Killed mid-work.** Render idles an instance only after 15 minutes without inbound traffic, and the pass is triggered by an inbound request, so it normally finishes in seconds. The push retry window is up to 30 s (`notifications/service.ts:384-385`). Render's own docs say it "might restart a Free web service at any time". That would lose any claimed-but-unsent reminder (the at-most-once case above). This is a small residual risk, not the cause of your two mornings.

---

## 5. Q4: Cold-start and boot behaviour

- **Boot is light [V].** `index.ts:37` calls `buildApp(config)`, then `app.listen` at `index.ts:71`.
  - `buildApp` (`composeServices.ts:195`) builds repos, creates `new Redis(url)` at line 202 (ioredis connects in the background and does not block `listen`) and registers routes. The pool is lazy.
  - There are no `setInterval` calls anywhere in non-test `apps/api/src` **[V]** (grep: no matches). The catalog sync scheduler is not started on the hosted deployment (`docs/hosting.md`, "What this means for the design").
  - Migrations run in the **build** step, not at start (`render.yaml:29`). `start` is `node --env-file-if-exists=.env dist/index.js` (`apps/api/package.json:11`).
- **So the cold start is dominated by Render's container spin-up (about one minute per Render docs) plus Node loading the module graph [I].** I did not profile the app's own boot time.
- **The app cannot emit a 503 on this route [V]** (see summary item 1). 503 is only used elsewhere for `catalog_unavailable`, `live_unavailable`, `stats_unavailable` and `photo_uploads_disabled` (`packages/shared/src/errors.ts:313,317,360,426`).
- **Working-tree changes do not affect the deployed code.** `git status` shows uncommitted edits to `render.yaml`, `apps/api/src/config.ts` and `apps/api/package.json` (photo-uploads). The diffs add optional env vars (`PHOTOS_ENABLED` defaults to false), two `@aws-sdk` dependencies and a render.yaml block of env vars. Render deploys `origin/develop` (`933a863`); local `develop` is one commit ahead (`fbc7d00`). So none of this is running in production. Once pushed, the new `PHOTO_*` keys are `sync: false`; the config marks them optional, so I do not expect a boot failure **[I]**, but I did not test a deploy.

---

## 6. Q5: Keep-alive, `/health`, and the hours budget

**`/health` [V].** `server.ts:518`: `app.get('/health', async () => ({ status: 'ok' }))`. It touches no DB or Redis. Fastify auto-registers `HEAD` for it. It passes through the global rate limiter (300 reads/min per client), which is irrelevant at one call per 10 minutes.

**Window and why it ends [V].**
- `docs/hosting.md:111`: pinging 24/7 uses about 744 hours in a 31-day month, under the 750 cap with only about 6 hours of margin.
- `docs/hosting.md:113`: the recommended 7am-2am schedule is about 589 hours/month. The ending hour is an **instance-hours** budget decision. Neon compute is deliberately not kept warm (`hosting.md` "Do NOT ping the database").
- Render's docs state the 750 hours are per **workspace**, not per service, so any other free service you run counts against the same 750.

**Documented window is inconsistent.** `docs/hosting.md:113` says 7am-2am; `design.md:17` has `*/10 0-1,7-23` (07:00-01:50); `tech-conventions.md:40` says about 7 AM-1 AM; the runbook measured about 07:40-00:50. Actual current settings live in cron-job.org, not the repo **[?]**.

**Hours maths [I; arithmetic on the documented numbers].**

| Scenario | Awake h/day | h/month (31 d) | vs 750 |
|---|---|---|---|
| Always on | 24 | 744 | 99% |
| Documented day-only (7:00-2:00) | 19 | 589 | 79% |
| Measured Aug (about 07:40 to 00:50, plus 15 min idle) | about 17.6 | about 545 | about 73% |
| Documented plus pre-6:00 start (5:50 start) | about 20.2 | about 626 | about 83% |
| Measured plus 5:50 start | about 18.8 | about 583 | about 78% |

Starting at 5:50 adds roughly 1.2 h/day, about 36 h/month. The spec's "about 0.25 h/day for the 06:00 wake" (`design.md:1075`) assumes the container stays up only briefly; in practice the 6:00/6:10/6:20 ticks plus the 15-minute idle tail keep it up about 35 minutes, and then it sleeps until 7:00 (a 40-minute gap), so the LL 07:00 reminder is exposed to a second cold start as well.

---

## 7. Diagnostics to run before changing anything

These discriminate between "pre-7 requests don't wake it" and "something else".

1. **Check what the 503 really is.** In cron-job.org, open one failed 6:00 history entry and look at the response headers and body (Render/Cloudflare page, `server`, `cf-ray`, `x-render-routing` if present). Note: if a 503 body is an HTML page, the HEAD method matters for the 8 KB limit (`hosting.md:117`).
2. **Render dashboard, Events and Logs for 05:55-07:15 ET on a failing morning.** Look for the container start line. If the first start log is at about 7:09 on both days, the 6:xx requests never started it. If starts appear at 6:00 and the process then dies, the logs will show why.
3. **Live test (once, tomorrow).** At about 5:50 ET run `curl -sI https://<render-host>/health` from a laptop and record the status, the time to answer and the headers. Repeat at 5:55 and 6:00. If this wakes the service, the ranked fix below works.
4. **Did the reminders go out late?** Run against Neon:
   ```sql
   SELECT trip_id, window_kind, drop_at, reminder_lead, claimed_at
   FROM trip_booking_reminder_log
   ORDER BY claimed_at DESC
   LIMIT 20;
   ```
   Rows with `claimed_at` near 7:10 or 7:20 ET mean the late passes did send. No rows means no trip had a window dropping on those days (then nothing could have been sent at any time). Also confirm your test trips actually have a dining drop on that date (60 days before arrival; see `tripBooking.ts:38-52`).
5. **Check the job is still enabled** in cron-job.org. `hosting.md:117` warns that enough consecutive failures auto-disable a job. Consecutive failures here are interleaved with successes, but confirm.
6. **Confirm the job's timezone** and the account display timezone (section 2).

---

## 8. Recommendations (ranked)

### 1. Wake the service before 6:00 and keep it warm until the keep-alive takes over. Operator-only, no code.

Do diagnostic step 3 first. If a pre-6:00 request wakes the service:

- **Keep-alive job:** `HEAD https://<render-host>/health`, timezone America/New_York, every 10 minutes during hours **6-23 and 0-1** (so it covers 6:00, 6:10 ... through the evening without gaps).
- **New one-minute-slot job "pre-dawn warm-up":** same URL and method, hours **5**, minutes **50**. That lands 10 minutes before the first reminder tick. cron-job.org schedules hours and minutes as independent sets, so one job cannot express "5:50 and then every 10 minutes from 6:00"; two jobs are needed. Alternatively set the single keep-alive job to hours 5-23,0-1 (starts at 5:00, about +62 h/month instead of +36).
- **Do not point the keep-alive at the reminder URL.** R8.11 and `hosting.md:124` say it must never call it (Neon budget).
- **Cost:** about +36 h/month, so about 626 h of 750 on the documented baseline.
- **Result:** the 6:00 reminder ticks reach a warm instance and answer in 1-2 s like 8 PM. The 7:00 LL tick is warm too, with no 6:20-7:00 gap.
- **Caveat:** the unexplained part (summary item 4) means this might not be enough. If the 5:50 curl does not wake it, escalate to option 4.

### 2. Add late catch-up ticks. Operator config plus a doc amendment, no code.

- New cron-job.org job: `HEAD https://<render-host>/internal/trip-booking-reminders/run`, same `x-cron-secret`, America/New_York, crontab `15 8,9 * * *`.
- At 8:15 the dining "open" (valid until 9:00) and LL "open" (until 10:00) reminders are still due. At 9:15 only the LL one is.
- Cost: 2 more Neon wakes per day (11 passes/day total instead of 9). I recommend against ticks every 10 minutes through the morning: that would hold Neon awake for hours and cost compute against the roughly 100 CU-hour budget (`hosting.md:121`).
- **Spec impact:** R8.12 (`requirements.md:212`), `design.md:17,1070-1075`, `hosting.md:131-132` and `render.yaml:69` all fix the schedule at 9 passes. Add the new ticks and the 11-pass bound to those places as an additive amendment (per the repo's "Editing an existing spec" rule), plus the Neon-impact line. Do not renumber R8.
- Honest value note: a dining "open" reminder at 8:15 arrives 2 h 15 min after the window opened. The `eve` reminder at 20:00 the night before is the one that actually helps people prepare. So option 2 mostly protects delivery, not usefulness.

### 3. cron-job.org job settings. Operator-only.

- Keep `HEAD` (avoids the 8 KB limit).
- The 30 s request timeout is what you hit at 7:10 today. I could not verify whether the free plan lets you raise it **[?]**. Not needed if option 1 works.
- Turn on failure notifications for the reminder job so you hear about 503 streaks.
- I could not verify whether cron-job.org has a built-in retry-on-failure option **[?]**, so I am not relying on one.

### 4. Pay for always-on ($7/month, Render Starter). Operator decision.

`hosting.md` already says to do this once there are real users, and `release-readiness/report.md` item B2 flags cold starts. It removes the whole cold-start class for both crons and user traffic, and it frees the Render hours budget.

### 5. Things I do not recommend

- **Moving the reminder later (your option b).** It would not help: the dining window opens at 6:00, so a 6:00 "open" reminder is the point of that lead. Moving it needs a change to `REMINDER_LEAD_SCHEDULE` in `packages/shared` (code plus spec change). The failure is about the service being asleep, not about the clock time.
- **Raising `BOOKING_REMINDER_CATCHUP_MINUTES`.** It is an env var, so it needs no code, but it contradicts R7.9 (`requirements.md:193`) and would send stale "windows opened hours ago" pushes.
- **Starting a reminder pass on boot or when the first user request arrives.** This would catch up automatically, but it contradicts R8.8 and R8.11 and the explicit instruction in `tasks.md` task 9.1 not to start the runner from any boot hook. It would be a spec change plus code, and it would pull Neon on every cold start. Only worth it if options 1-4 fail.

### Operator-only versus code change

| Option | Kind | Spec amendment needed? |
|---|---|---|
| 1. Earlier keep-alive and 5:50 warm-up | cron-job.org only | No functional change; update `hosting.md` window text and the hours table |
| 2. Late catch-up ticks `15 8,9` | cron-job.org only | Yes, doc/spec text (R8.12, design schedule table, `hosting.md`, `render.yaml` comment) |
| 3. Timeout/notification settings | cron-job.org only | No |
| 4. Render Starter | Render billing | Update `hosting.md` |
| Boot-time catch-up pass | Code | Yes, new requirement plus a conflict with R8.8/R8.11 |
| Shift reminder times | Code (`packages/shared`) | Yes, REMINDER_LEAD_SCHEDULE and R7.1 |
| Raise catch-up minutes | Render env var | Yes (R7.9 default) |

---

## 9. What I verified and what I did not

**Verified by reading code or docs:** handler status codes; 180-minute catch-up and ledger idempotency; at-most-once claim ordering; no boot-time timers or migrations; keep-alive and reminder cron schedules as documented; working-tree changes do not touch the deployed code.

**Inferred:** that the 503 is edge-side; that Render's spin-up exceeds 30 s often enough to make the 7:10 run a coin flip; the hours arithmetic (uses the documented hours, not your live cron-job.org config).

**Could not determine:** why 6:00-7:00 requests failed instead of waking the service; the actual current keep-alive schedule and the cron-job.org timezone; whether the free cron-job.org plan supports retries or longer timeouts; whether a late pass actually sent pushes on either day (SQL above answers it).

No `.env` file was read, and no secrets are reproduced here.
