# Dated runbooks — wait-time & crowd-calendar measurement

Each file here is a **self-contained task for a specific date**. Point an agent at one and say "do what this says." They assume no memory of the session that created them, so each carries its own context, its own baseline numbers to compare against, and explicit decision rules.

Created 2026-08-27, after the work that:

- stopped the observed Crowd_Index dividing by a value that chased its own numerator (R14),
- made a mature season bucket still respond to the date's crowd forecast (R15),
- shrunk thin day-of-week wait buckets toward the pooled per-hour mean (R16),
- started retaining day-level wait data past the 30-day raw prune (R17),
- started freezing and scoring wait predictions, with a shadow-challenger slot (R18),
- applied the measured crowd bias to the **published** forecast only, deliberately withholding it from the wait path until there is wait-side evidence (R7.4 / R7.7),
- surfaced predicted-versus-actual on the crowd calendar from the frozen log rather than a recomputed forecast (R7.5).

Full detail lives in `.kiro/specs/crowd-calendar/{requirements,design,tasks}.md`.

## Order

| Date | File | Question it answers |
|---|---|---|
| immediately | `2026-08-27-commit-and-deploy.md` | Is the work actually live and still collecting? |
| ~2026-09-03 | `2026-09-03-verify-measurement-loop.md` | Is the daily recompute turning and scoring anything? |
| ~2026-09-10 | `2026-09-10-first-accuracy-read.md` | How accurate is the wait model, forward, for real? |
| ~2026-10-08 | `2026-10-08-bias-vs-lag-decision.md` | Is the per-ride error genuine bias or lag? Decides the next model change. |
| ~2027-08-01 | `2027-08-01-baseline-reanchor.md` | Task 21.5: re-anchor the frozen baseline from a year of archive. |

`2026-09-03` and `2026-09-10` are health/observation. `2026-10-08` is the one that changes the model, and it **depends on having recorded the September numbers**, so don't skip ahead.

## How to run a query against the database

There is no `psql` wrapper in this repo. The pattern used throughout is a throwaway `tsx` script against the pooled Neon connection in `apps/api/.env.dev`:

```ts
/* TEMPORARY read-only diagnostic. Delete after use. */
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const r = await pool.query(`SELECT 1`);
for (const row of r.rows) console.log(JSON.stringify(row));
await pool.end();
```

Run it with:

```
cd apps/api
npx tsx --env-file=.env.dev src/scripts/_tmpCheck.ts
```

Rules, which matter:

- Prefix the filename with `_tmp` and **delete it when done**. The working tree must contain only intended source changes.
- Print with `console.log(JSON.stringify(row))`, not `console.table` — the latter renders as unreadable box-drawing characters in PowerShell.
- Keep these scripts **read-only** unless the runbook explicitly says otherwise.
- Never paste a connection string or secret into a response.

## Standing rules for any code change these runbooks trigger

- Behaviour changes need a backing requirement in `.kiro/specs/crowd-calendar/requirements.md`, a design Correctness Property, and a task — amended **additively**, never renumbered.
- After changing anything in `packages/shared`, run `npm run build` there or the root `npm run verify` fails with `TS2339`. `packages/shared/dist` is gitignored and `apps/api` resolves the built output.
- `npm run verify` from the repo root is the gate. It must exit `0`.
- pg-mem cannot execute `AT TIME ZONE`, `percentile_cont ... WITHIN GROUP`, or multi-argument `unnest`, and it does not raise Postgres error `21000`. Repo tests touching those need the live-Postgres scratch-DB harness — see `waitArchive.livedb.test.ts` for the pattern.
