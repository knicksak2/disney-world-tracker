# Disney World Tracker

A mobile app for tracking Walt Disney World experiences (attractions, shows, restaurants, parades, character meets, and more) and checking live wait times, show times, Lightning Lane state, and boarding groups, backed by a Fastify API and a shared TypeScript package.

Data is sourced along a **data-by-change-rate** split:

- **Static catalog data** (descriptive fields, resorts/hotels, imagery, menus, coordinates, facets, area/park hierarchy) — low change rate, available only from Disney — comes from Disney's sources: the Couchbase **Sync Gateway** (catalog documents) and Disney's public **dining-menu API** (`disneyworld.disney.go.com`, restaurant menus).
- **Live data** (status, standby & single-rider waits, forecast, showtimes, operating hours, walk-up dining, Lightning Lane price/coarse state, boarding groups) — high change rate, stable, third-party-maintained — comes from the public [ThemeParks.wiki](https://api.themeparks.wiki/v1) API.

All Disney access is funneled through a single hardened transport (shared rate limit, bounded backoff with jitter, `Retry-After` handling, and Akamai/WAF-vs-auth failure classification); the catalog sync is incremental (a persisted `_changes` checkpoint + a durable local document store), fetches menus lazily, and runs on an infrequent (≥24h) cadence. See [Data sources & resilience](#data-sources--resilience).

## Repository Layout

This repository is an npm workspaces monorepo with three packages:

| Path | Description |
| --- | --- |
| `apps/api` | Node.js + Fastify backend (TypeScript). Hosts the eight service modules — Auth, Catalog, Live, Tracking, Stats, Friends, Sharing, Aggregate Ratings — plus BullMQ background workers. Talks to PostgreSQL and Redis. |
| `apps/mobile` | React Native + TypeScript client built with Expo. Targets iOS and Android. |
| `packages/shared` | Shared DTOs, Zod validation schemas, error code catalog, and enums consumed by both `apps/api` and `apps/mobile`. Imported as `@dwt/shared`. |

## Prerequisites

- **Node.js 22 or 24** (LTS). The version is pinned in `.nvmrc` (24) — run `nvm use` to match it. The engines floor is Node 22; the API's `dev` script relies on Node's built-in `--env-file` flag (Node 20.6+).
- **npm 10+** (ships with Node 22/24)
- **Docker Desktop** (or any Docker engine + Compose v2) for the Postgres / Redis stack
- **Disney Sync Gateway credentials** (`DISNEY_SYNC_GATEWAY_USERNAME` / `_PASSWORD`). The API fails fast at startup without them. Pull them into `apps/api/.env` with `node tools/pull-disney-creds.mjs` (see [Disney credentials](#disney-credentials)).
- For the mobile app: **Expo Go** on your phone, or Xcode (iOS) / Android Studio with an emulator

## Quickstart — Run Everything Locally

From a fresh clone:

```bash
nvm use                              # picks up .nvmrc → Node 24
npm install                          # installs all workspaces
```

Set up the environment files (one-time). On Windows use `copy`; on macOS / Linux use `cp`:

```bash
# Backend env (defaults match docker-compose.yml)
copy apps\api\.env.example apps\api\.env          # Windows
cp apps/api/.env.example apps/api/.env            # macOS / Linux

# Mobile env — OPTIONAL. The app defaults to the Android emulator URL with no
# config. Only copy this if you target an iOS simulator or a physical phone.
copy apps\mobile\.env.example apps\mobile\.env.local   # Windows
cp apps/mobile/.env.example apps/mobile/.env.local     # macOS / Linux
```

Then bring up the stack and start the apps:

```bash
docker compose up -d                 # start Postgres, Redis
node tools/pull-disney-creds.mjs     # write Disney Sync Gateway creds into apps/api/.env
npm run migrate                      # apply database migrations
npm run sync --workspace apps/api    # seed the catalog from Disney (first run; see below)
npm run dev:api                      # terminal 1: Fastify API on :3000
npm run dev:mobile                   # terminal 2: Expo dev server
```

> **Seed the catalog first.** The initial catalog load is a full "bootstrap" sync of several thousand Disney documents. The on-read opportunistic refresh only races that against a 5-second read deadline, so a cold `GET /catalog` would return `503 catalog_unavailable` while the sync finishes in the background. Running `npm run sync` (from `apps/api`) once up front populates the cache so the app has data immediately. After that, syncs are incremental.

Three terminals total once everything is running:
1. Docker (in the background)
2. The API (`npm run dev:api`)
3. The Expo dev server (`npm run dev:mobile`)

When the Expo server prints a QR code, scan it with the Expo Go app on your phone, or press `i` for the iOS simulator / `a` for the Android emulator.

The mobile app resolves its API URL automatically: local `expo start` runs default to `http://10.0.2.2:3000` (the Android emulator), while production builds target the hosted Render API. You only need `apps/mobile/.env.local` to override the local target (iOS simulator or a physical phone); see [Mobile `dev` script](#mobile-dev-script). Restart Metro after changing it.

> **Local vs hosted services.** The commands above run the API against the local Docker stack (`apps/api/.env`). To point it at managed cloud services (Neon / Upstash) instead, use the `:cloud` variants — `npm run dev:api:cloud` and `npm run migrate:cloud` — which read `apps/api/.env.dev`. See [Two environments: local vs hosted dev](#two-environments-local-vs-hosted-dev).

## First-Run Behavior

A few things to expect on the very first request:

- **Catalog seeding.** The catalog is sourced from Disney's Sync Gateway. On a fresh database run `npm run sync` (from `apps/api`) once to bootstrap it — see the note in [Quickstart](#quickstart--run-everything-locally). The on-read refresh keeps it fresh afterward (a read past the 24h freshness window kicks off an incremental background sync). If Disney is blocked/unreachable and a prior cache exists, the API keeps serving the cached catalog with a staleness indicator; only a first-ever failure with no prior cache returns `503 catalog_unavailable`.
- **Live data.** Live details (waits, showtimes, Lightning Lane, boarding groups) are fetched on demand from ThemeParks.wiki and cached in Redis for 5 minutes — no catalog sync needed. The first live request builds a small entity directory (Enterprise_Id → ThemeParks id) from ThemeParks.wiki and caches it for 12h.
- **Disney credentials.** The API refuses to start if `DISNEY_SYNC_GATEWAY_USERNAME` / `_PASSWORD` are missing or blank. Run `node tools/pull-disney-creds.mjs` to populate them.
- **Argon2 native build.** On first `npm install`, the `argon2` package compiles a small native module. On Windows this needs the Visual Studio Build Tools with the "Desktop development with C++" workload. macOS / Linux users typically have this for free.
- **Avatars.** Profile avatars are a fixed set of bundled illustrations chosen in-app (no upload, no object storage). See `apps/mobile/src/avatars/AvatarPresets.tsx`.

## Smoke Testing the Stack

After `docker compose up -d` and `npm run migrate`, with the API running on `:3000`:

```bash
# After `npm run sync`, this returns the catalog; before seeding it may 503.
curl http://localhost:3000/catalog

# Register a user.
curl -X POST http://localhost:3000/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"test@example.com","password":"longenoughpw","displayName":"Test"}'
```

If both succeed, the API is talking to Postgres and Redis correctly. The mobile app can then reach the same endpoints.

## What Each Piece Does

### `docker-compose.yml` (repo root)

Spins up the three backend services the API depends on. Default credentials match `apps/api/.env.example` so nothing needs editing.

| Service | Image | Port(s) | Purpose |
| --- | --- | --- | --- |
| `postgres` | `postgres:16` | `5432` | App database (users, experiences, ratings, friendships, shares, etc.) |
| `redis` | `redis:7-alpine` | `6379` | Session lookups, login lockout counters, leaderboard cache, BullMQ job queues |

Useful commands:

```bash
docker compose up -d         # start everything in the background
docker compose ps            # see what's running
docker compose logs -f       # tail all logs (Ctrl+C to stop tailing)
docker compose down          # stop containers (data preserved)
docker compose down -v       # stop and wipe data — clean slate
```


### `apps/api/.env`

The API never reads `process.env` directly outside its config loader, so every backend setting lives in an env file. The `.env.example` template ships with values that match `docker-compose.yml` — just copy it to `.env` (see [Quickstart](#quickstart--run-everything-locally)). The real `.env` is gitignored.

Required keys: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (32+ chars), and the Disney Sync Gateway `Static_Credentials` `DISNEY_SYNC_GATEWAY_USERNAME` / `DISNEY_SYNC_GATEWAY_PASSWORD` (startup fails fast if either is blank). `THEMEPARKS_BASE_URL` (live source), `DISNEY_SYNC_GATEWAY_BASE_URL` (static catalog source), and `DISNEY_DINING_MENU_BASE_URL` (restaurant menus, from Disney's public website dining-menu API — anonymous, no credentials) all default to the documented public endpoints. See `apps/api/.env.example` for descriptions.

Optional Disney resilience-tuning keys (all have sane defaults): `DISNEY_MAX_RPS`, `DISNEY_MAX_CONCURRENCY` (shared Request_Budget), `DISNEY_BACKOFF_*` (bounded backoff), `MENU_FRESHNESS_MS` (lazy-menu cache window), and `CATALOG_SYNC_INTERVAL_MS` (scheduled cadence, floored at 24h). Override only if you have a reason to.

#### Disney credentials

The Sync Gateway requires HTTP Basic `Static_Credentials`. The supported way to obtain/refresh them is the credential-pull tool, which decodes them and writes only the two `DISNEY_SYNC_GATEWAY_*` lines into `apps/api/.env` (never printing the values; `.env` is gitignored):

```bash
node tools/pull-disney-creds.mjs
```

Re-run it if Disney rotates the credentials. A `waf_block` outcome in the sync-run history means Disney's edge (Akamai) throttled the shared egress IP (transient, retried); an `auth_failure` means the credentials are invalid/expired — re-pull them.

#### Two environments: local vs hosted dev

You can point the API at either your local Docker stack or your hosted managed services (Neon / Upstash) without editing files — each lives in its own gitignored env file and has its own command:

| Target | Env file | Run the API | Run migrations |
| --- | --- | --- | --- |
| **Local** (Docker) | `apps/api/.env` | `npm run dev:api` | `npm run migrate` |
| **Hosted dev** (Neon/Upstash) | `apps/api/.env.dev` | `npm run dev:api:cloud` | `npm run migrate:cloud` |

Copy `.env.example` to `.env.dev` and fill in your managed-service credentials there. The two files never interfere, so switching environments is just a matter of which command you run. (`migrate:cloud` only needs `DATABASE_URL`; running the full API with `dev:api:cloud` needs the Redis value filled in too.) The Disney Sync Gateway credentials are the exception — don't hand-copy them; `node tools/pull-disney-creds.mjs` writes the current values into **both** `.env` and `.env.dev` (a stale placeholder in `.env.dev` is what makes `sync:cloud` fail with `auth_failure`/401). All `.env*` files except `.env.example` are gitignored.

### API `dev` script

```json
"dev": "tsx watch --env-file=.env src/index.ts"
```

What it does:
1. **Runs TypeScript directly** with `tsx` — no separate `tsc` build step while you iterate.
2. **Loads `apps/api/.env` automatically** via Node's `--env-file` flag, so `DATABASE_URL` and friends are populated before `loadConfig()` reads them.
3. **Hot-reloads on file changes** — `tsx watch` restarts the server when any imported `.ts` file changes.

Run it with `npm run dev:api` from the repo root.

### Mobile `dev` script

```bash
npm run dev:mobile
```

Runs `expo start` from `apps/mobile`. The Expo dev server reads `apps/mobile/app.config.ts`, which exposes `extra.apiBaseUrl` to the app via `expo-constants`.

#### How the API base URL is chosen

`app.config.ts` resolves the base URL with this precedence (first match wins):

| # | Source | When it applies |
| --- | --- | --- |
| 1 | `.env.<APP_ENV>` file's `API_BASE_URL` | When `APP_ENV` is set — `npm run dev:mobile:cloud` sets `APP_ENV=dev` and loads `.env.dev`. Falls back to the Render default if the file is absent. |
| 2 | `API_BASE_URL` env var | Any other context — explicit override |
| 3 | `PROD_API_BASE_URL` env var (default `https://dwt-api.onrender.com`) | Release builds/exports, where Expo sets `NODE_ENV=production` |
| 4 | Built-in default `http://10.0.2.2:3000` | Local `expo start` (`NODE_ENV=development`) |

The upshot: a plain `npm run dev:mobile` hits your **local** API automatically, a production build (`expo export` / EAS) targets **Render** automatically, and `npm run dev:mobile:cloud` runs a **dev** build against **Render** — no env juggling between them. The hosted default matches the `dwt-api` service in `render.yaml`; if you rename the Render service, set `PROD_API_BASE_URL` to its URL.

#### Run a dev build against the hosted (Render) backend

`npm run dev:mobile:cloud` starts the Expo dev server (fast refresh, dev bundling) but points the app at the hosted Render API instead of your local one — the mobile analogue of the API's `dev:api:cloud`. It sets `APP_ENV=dev`, which makes `app.config.ts` load `apps/mobile/.env.dev` and, when that file is absent, default to the Render URL. So it works with no setup; create `.env.dev` (gitignored) with `API_BASE_URL=<url>` only if your hosted URL differs from the default:

```bash
# optional — only to override the default Render URL
copy apps\mobile\.env.example apps\mobile\.env.dev    # Windows
cp apps/mobile/.env.example apps/mobile/.env.dev       # macOS / Linux
```

`APP_ENV=dev` deliberately wins over an `API_BASE_URL` pinned in `.env.local`, so a local override doesn't silently defeat the cloud script. Restart Metro after editing `.env.dev` (the value is read at Expo startup). Note the hosted API talks to Neon/Upstash — if the catalog looks empty, seed it with `npm run sync:cloud` from `apps/api`. Free-tier Render sleeps after ~15 min idle, so the first request after a quiet spell takes 30–60s.

#### Local config with `.env.local` (only to override the local target)

You don't need `.env.local` at all for the Android emulator — that's the built-in default. Create it only to point local dev somewhere else (iOS simulator, physical phone). Expo's CLI loads `apps/mobile/.env.local` (gitignored) automatically at startup:

```bash
# Windows
copy apps\mobile\.env.example apps\mobile\.env.local

# macOS / Linux
cp apps/mobile/.env.example apps/mobile/.env.local
```

Then uncomment `API_BASE_URL` in `.env.local` and set your target:

| Target | `API_BASE_URL` |
| --- | --- |
| Android emulator | `http://10.0.2.2:3000` (the default — no `.env.local` needed) |
| iOS simulator | `http://localhost:3000` |
| Physical phone (Expo Go) | `http://<your-LAN-IP>:3000`, e.g. `http://192.168.1.50:3000` |

Find your LAN IP with `ipconfig` (Windows) or `ifconfig` / `ip a` (macOS / Linux).

> Because `API_BASE_URL` wins in **every** context (precedence #1), setting it in `.env.local` also applies to a local `expo export`. That's harmless for EAS/CI builds (no `.env.local` there), just keep it in mind if you run a production export on your own machine.

Because the value is read at Expo startup, restart Metro after editing `.env.local`.

#### One-off override

To override without editing the file, set `API_BASE_URL` inline for a single run:

```bash
# macOS / Linux
API_BASE_URL=http://192.168.1.50:3000 npm run dev:mobile

# Windows PowerShell
$env:API_BASE_URL="http://192.168.1.50:3000"; npm run dev:mobile

# Windows cmd
set API_BASE_URL=http://192.168.1.50:3000 && npm run dev:mobile
```

<details>
<summary><strong>Troubleshooting: Android emulator can't connect to Metro</strong></summary>

By default Expo advertises a **LAN** URL (e.g. `exp://192.168.1.154:8081`). Expo Go running inside an Android emulator often can't reach your machine's LAN address — usually because Windows Defender Firewall blocks Node on port `8081` — so the app never connects back to Metro. The symptom in the Expo terminal is:

```
> Opening exp://192.168.1.154:8081 on Pixel_7
> Reloading apps
No apps connected. Sending "reload" to all React Native apps failed. Make sure
your app is running in the simulator or on a phone connected via USB.
```

The reliable fix for an emulator is to route Metro over the `adb` bridge and tell Expo to **advertise** `localhost` (so Expo Go connects through that bridge) while Metro still binds to all interfaces:

```powershell
# 1. Map the emulator's localhost:8081 to the host's Metro port.
#    (Re-run this if you restart the emulator or adb — the mapping resets.)
adb reverse tcp:8081 tcp:8081

# 2. From the mobile workspace, advertise localhost and start normally.
#    PowerShell:
cd apps/mobile
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "localhost"
npx expo start
```

```cmd
:: cmd.exe equivalent
cd apps\mobile
set REACT_NATIVE_PACKAGER_HOSTNAME=localhost
npx expo start
```

Press `a` to open on Android, then **wait** for the first bundle to finish (30–60s). Don't press `r` (reload) before the app has connected once — reloading when no device is attached is exactly what produces the "No apps connected" message above.

> **Do not use the `--localhost` flag on Windows.** It makes Metro bind to the IPv6 loopback (`::1`) only, but `adb reverse` forwards to the IPv4 loopback (`127.0.0.1`). The emulator then can't reach the dev server and Expo Go fails with "Failed to download remote update" / "Something went wrong." Setting `REACT_NATIVE_PACKAGER_HOSTNAME=localhost` with the **default** `expo start` avoids this, because the default server binds `0.0.0.0` (IPv4-reachable) while still advertising `localhost`.

Verify Metro is reachable over IPv4 before pressing `a` (should print `packager-status:running`):

```
curl.exe http://127.0.0.1:8081/status
```

Verify the emulator and Expo Go are healthy if it still won't open:

```bash
adb devices -l                                   # the emulator should be listed as `device`
adb shell pm list packages | findstr exponent    # expect: package:host.exp.exponent
```

If you'd rather keep the **LAN** URL (e.g. to also test on a physical phone over the same Wi-Fi), allow Node.js through Windows Defender Firewall on **Private** networks for port `8081` instead — and skip both the `adb reverse` and `REACT_NATIVE_PACKAGER_HOSTNAME` steps.

> The app's API base URL is independent of how Metro connects: in local dev it defaults to `http://10.0.2.2:3000` (the emulator's route to the host), overridable via `API_BASE_URL` in `apps/mobile/.env.local`. Make sure `npm run dev:api` is running so the app has a backend to talk to.

</details>

## Repo-Wide Scripts

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Starts the Fastify API in watch mode against the **local** services in `docker-compose.yml` (uses `apps/api/.env`). |
| `npm run dev:api:cloud` | Starts the Fastify API in watch mode against your **hosted dev** services (uses `apps/api/.env.dev`). |
| `npm run dev:mobile` | Starts the Expo dev server against your **local** API. |
| `npm run dev:mobile:cloud` | Starts the Expo dev server (dev build) against the **hosted** Render API (`APP_ENV=dev` → loads `apps/mobile/.env.dev`, defaulting to the Render URL). |
| `npm run migrate` | Applies any pending SQL migrations from `apps/api/migrations/` to the **local** Postgres (`apps/api/.env`). Idempotent. |
| `npm run migrate:cloud` | Applies pending migrations to the **hosted** Postgres (`apps/api/.env.dev`). Idempotent. |
| `npm run lint` | Runs ESLint across the entire repo using the shared `eslint.config.mjs`. |
| `npm run typecheck` | Runs `tsc --noEmit` in every workspace. |
| `npm test` | Runs the test suite in every workspace (vitest for API + shared, jest for mobile). |
| `npm run build` | Builds every workspace's `build` script. |
| `npm run build:shared` | Builds just the shared package. |

### Catalog operational scripts (`apps/api`)

Run these from `apps/api` (they read `apps/api/.env`):

| Command | What it does |
| --- | --- |
| `npm run sync` | Triggers one immediate Catalog_Sync now (bootstrap on first run, incremental thereafter), reconciling the result into the cache. Coordinated by the same Redis lock as the scheduled/on-read syncs, so concurrent runs are safe. Use it to seed a fresh DB or force a refresh. |
| `npm run sync:cloud` | Same as `sync`, but against your **hosted** services (reads `apps/api/.env.dev`). Use it to seed or refresh the catalog in the hosted Neon database from your machine — the hosted API has no unattended seed step (see [Updating a running deployment](#updating-a-running-deployment)). |
| `npm run build-bridge` | One-time identity Bridge_Map build: maps each Disney `Enterprise_Id` to the internal id derived during the ThemeParks.wiki era, preserving id continuity across the source migration. Only needed when migrating an existing catalog. |

## Experience images

Every Experience and Resort can show an image — a thumbnail in the catalog list and a hero image on the detail screen. Imagery is now **sourced directly from Disney** as part of the catalog: each Facility document carries `detailImageUrl` / `listImageUrl`, and the catalog sync writes the preferred one to `experiences.image_url` (and `resorts.image_url`). No separate image-sourcing job, curated overrides, or third-party (Wikimedia) lookup is involved — that pipeline, its `imageOverrides.json`, the `source-images` command, and the `image_attribution` column were retired when catalog sourcing moved to Disney.

When an item has no Disney image URL, the row keeps `image_url = NULL` and the app renders a **category-colored placeholder** with the category glyph, so coverage is always 100% visually.

## Data sources & resilience

The catalog and live paths are deliberately split (see the intro) and Disney access is hardened so a sync burst can't again trip Disney's edge protection.

### Static catalog (Disney)

- **Single shared transport.** Every Disney request (Sync Gateway + dining-menu API) flows through one `Disney_Transport` that owns the shared **Request_Budget** rate limiter (Redis-backed across processes, in-process fallback), bounded **exponential backoff with jitter** honoring `Retry-After`, the required `User-Agent` headers, and failure **classification** — an Akamai/WAF "Access Denied" `403`/`429` is a transient `waf_block` (retried), distinct from a genuine `auth_failure` (fatal, fail fast).
- **Incremental sync.** `Catalog_Sync` persists a `_changes` **checkpoint** and a durable local **document store** (`disney_documents`). The first run is a full `Bootstrap_Sync`; subsequent runs are `Delta_Sync`s that fetch only changed documents. Reconciliation reads the active document set from the store, not a fresh full enumeration.
- **Lazy menus & infrequent cadence.** Restaurant menus are fetched on demand from Disney's **public website dining-menu API** (anonymous, keyed by the restaurant's `Enterprise_Id`) and cached (not fetched during sync); a menu fetch failure or an unexpected response shape is logged and degrades to the cached/empty result without failing the detail read. The scheduled sync runs no more than once per 24h, with an on-read opportunistic refresh past the freshness window.
- **Graceful degradation.** A Disney block or credential rotation leaves the prior cache byte-identical and keeps serving it with a staleness indicator; only a first-ever failure with no prior cache returns `503 catalog_unavailable`. Every run records an outcome (`success | waf_block | auth_failure | network | invalid_response | aborted`) in the sync-run history.

### Live data (ThemeParks.wiki)

- Live details come from ThemeParks.wiki's `/entity/{id}/live` feed, joined to the catalog by matching the Experience's Disney `Enterprise_Id` to the ThemeParks.wiki `externalId`. Because the live endpoint is keyed by ThemeParks.wiki's own entity id (a GUID), the API resolves `Enterprise_Id → entity id` via a cached directory (built from the WDW destination's entities, refreshed every 12h) before fetching.
- Beyond status, waits, forecast, showtimes, hours, and walk-up dining, ThemeParks.wiki uniquely provides single-rider wait **minutes**, **Lightning Lane** price + coarse return-window state, and **boarding-group** status — all surfaced in the app's ride live section. The live path never contacts a Disney source, so it stays fully functional even while Disney is blocked.
- Entities ThemeParks.wiki doesn't track (e.g. some resort dining) resolve to no live data and degrade to "live unavailable" — there is no Disney live fallback (that path is retired).


## Hosting

The backend runs entirely on free tiers, one managed service per concern, chosen so a side-project can run at **$0/month** with no expiring trials. The design is hosting-agnostic (plain Postgres / Redis interfaces), so any single provider can be swapped without touching application code.

| Concern | Service | Why this one | Free-tier limit |
| --- | --- | --- | --- |
| API server | [**Render**](https://render.com) | GitHub-driven deploys, automatic HTTPS, defined as code in [`render.yaml`](./render.yaml); truly free with no credit card | 750 instance-hours/mo; sleeps after 15 min idle (30–60s cold start) |
| PostgreSQL | [**Neon**](https://neon.tech) | Real Postgres (not a clone) with the `citext` / `pg_trgm` / `pgcrypto` extensions the schema needs, plus built-in connection pooling and scale-to-zero | 0.5 GB storage, 1 project, pauses when idle (1–3s wake) |
| Redis | [**Upstash**](https://upstash.com) | Pay-per-command with no idle cost — a good fit for our low, bursty usage (cache reads, lockout counters, sync lock, BullMQ) | 10,000 commands/day, 256 MB |
| Live data | [ThemeParks.wiki](https://api.themeparks.wiki/v1) | Already free, public, no key required | — |

Everything except the mobile app is reached server-side; the app only ever knows the Render URL. The main free-tier trade-off is Render's cold start (first request after idle is slow) — a $7/mo upgrade makes it always-on when you have real users.

See [`docs/hosting.md`](./docs/hosting.md) for the full rationale, per-service trade-offs, architecture diagrams, when-to-upgrade thresholds, and honest caveats.

## Deploying the API (Render)

The API deploys to [Render](https://render.com) as a free Web Service, defined as code in [`render.yaml`](./render.yaml) (a Render Blueprint). The backing services are managed elsewhere on their own free tiers — Postgres on [Neon](https://neon.tech) and Redis on [Upstash](https://upstash.com). See the [Hosting](#hosting) section above (and [`docs/hosting.md`](./docs/hosting.md)) for the full rationale and free-tier details.

### One-time provider setup

1. **Neon** — create a project, then copy the **pooled** connection string (host contains `-pooler`, ends with `?sslmode=require`). The schema and extensions (`citext`, `pg_trgm`, `pgcrypto`) are created by the migrations, not by hand. You don't need Neon Auth — the app has its own auth.
2. **Upstash** — create a Redis database, copy the `rediss://` URL.

### Deploy

1. Push to the `develop` branch (the branch `render.yaml` auto-deploys).
2. In Render: **New +** → **Blueprint** → select this repo. Render reads `render.yaml`.
3. Fill in the secret env vars it prompts for (these are `sync: false` in the blueprint): `DATABASE_URL`, `REDIS_URL`, and the Disney Sync Gateway `DISNEY_SYNC_GATEWAY_USERNAME` / `DISNEY_SYNC_GATEWAY_PASSWORD` (the API won't boot without the Disney credentials — obtain them locally with `node tools/pull-disney-creds.mjs` and paste the values). `SESSION_SECRET` is auto-generated; `NODE_ENV` and `THEMEPARKS_BASE_URL` are preset.
4. Render runs the build (`npm ci` → build shared → build API → apply migrations), then starts the server. The health check is `GET /health`. (Migrations run in the build step because Render's free tier doesn't support a separate pre-deploy command; they're idempotent, so they're skipped when already applied.)

The deployed URL looks like `https://dwt-api.onrender.com` — this is also the default the mobile app targets in production builds (see [How the API base URL is chosen](#how-the-api-base-url-is-chosen)). If you rename the Render service, set `PROD_API_BASE_URL` in the mobile app to match.

> **Free-tier note:** the service sleeps after 15 minutes idle, so the first request after a quiet period takes 30–60s to wake. Expected, not a bug.

### Testing against hosted services from your machine

Before (or instead of) deploying, you can run the API or migrations locally against the hosted services using `apps/api/.env.dev` — see [Two environments: local vs hosted dev](#two-environments-local-vs-hosted-dev). For example, `npm run migrate:cloud` applies the schema to Neon from your machine; Render's build-step migration then finds them already applied and skips them.

## Updating a running deployment

Once everything is live, an update flows through three independent tracks — the API/backend, the hosted catalog data, and the mobile app. Only the ones you actually changed need attention.

### 1. API + schema (Render, automatic on push)

Render auto-deploys the `dwt-api` service on every push to the **`develop`** branch. There is no separate deploy command:

```bash
git checkout develop
git add -A && git commit -m "..."   # your changes
git push origin develop             # Render picks it up and rebuilds
```

The build step re-runs the whole chain — `npm ci` → build `@dwt/shared` → build the API → **`npm run migrate`** — so:

- **Shared-package changes** (`packages/shared`) ship automatically; the API build rebuilds `@dwt/shared` before compiling, so no extra step.
- **New migrations** in `apps/api/migrations/` are applied against Neon during the build (idempotent — already-applied files are skipped). You don't run migrations by hand for a deploy.
- **New/changed env vars:** if your change reads a new secret, add it in the **Render dashboard first** (Environment → Add), then push. Secrets are `sync: false` in `render.yaml`, so they're never in git and Render won't have them until you set them. A missing required var makes the API fail fast on boot (e.g. the Disney credentials).

Watch the deploy in the Render dashboard; the health check is `GET /health`. Free-tier note still applies — the first request after idle takes 30–60s to wake.

> **Managed services (Neon / Upstash) need no "push."** There's nothing to deploy to them — schema changes reach Neon through the deploy's migrate step, and Upstash only holds runtime data. You only touch their dashboards to rotate credentials or resize.

### 2. Hosted catalog data (manual, from your machine)

The hosted API has **no unattended catalog seed** — the scheduler isn't started in the boot path, and a cold read only opportunistically refreshes. After a fresh deploy (or when you want to force a catalog refresh in production), seed Neon from your machine:

```bash
npm run migrate:cloud --workspace apps/api   # ensure schema is current (safe to re-run)
npm run sync:cloud --workspace apps/api      # bootstrap/refresh the hosted catalog
```

`sync:cloud` reads `apps/api/.env.dev` (your hosted `DATABASE_URL` + Disney credentials) and writes into the same Neon database the deployed API reads. The first run is a full bootstrap; later runs are incremental. Live data (waits, showtimes, Lightning Lane, boarding groups) needs no sync — it's fetched on demand from ThemeParks.wiki.

> **Backfilling enrichment onto existing rows.** The facet-enrichment columns (`why_this`, `grouped_facets`, `height_requirement`, `sub_type`) are written by sync only when a row is inserted or its identity metadata (name/park/category/land/area/resort) drifts — by design they are *not* drift signals, so a plain `sync:cloud` leaves them NULL on Experiences that already existed before the enrichment feature shipped. After deploying a migration that adds them (or if these fields read NULL in the hosted DB despite a completed sync), run the one-time backfill:
>
> ```bash
> npm run backfill-facets:cloud --workspace apps/api   # recompute enrichment onto existing rows
> ```
>
> It rescans the stored Disney documents, recomputes enrichment with the same pure cores the sync uses, and writes only those four columns onto matching rows. It's idempotent and safe to re-run. (Rows whose source document carries no `whyThis` stay NULL — that's expected, not a failure.)

### 3. Mobile app (EAS build → install on phone)

The app points at the hosted API in every non-local build (`API_BASE_URL=https://dwt-api.onrender.com` in `eas.json`), so once the API deploy is live the phone just needs a new build. **There is no over-the-air update path** — `expo-updates` isn't installed, so *every* JS or native change requires a full rebuild (no `eas update`).

Build with EAS (needs the [EAS CLI](https://docs.expo.dev/eas/) — `npm i -g eas-cli` — and an Expo login; the project is already configured in `eas.json`, project `knicksak2s-team`):

```bash
cd apps/mobile
eas login                                  # once
eas build --profile preview -p android     # internal APK to sideload
```

Profiles (all target the hosted Render API):

| Profile | Output | Use |
| --- | --- | --- |
| `development` | dev client (`developmentClient: true`) | run with a local Metro dev server |
| `preview` | internal Android **APK** | quickest way to get a real build on your own phone |
| `production` | store-ready build (`autoIncrement: true`) | app store submission |

When the build finishes, EAS prints a URL — open it on the phone (or scan the QR) to download and install the APK. For iOS you'd use `-p ios` with an appropriate profile and Apple credentials.

> Because there's no OTA channel, the sequence for a full change is: push to `develop` (API), then rebuild and reinstall the app. A backend-only change needs no rebuild; a mobile-only JS change still needs a full `eas build`.

#### Push notification credentials (FCM / APNs)

Push (Share deliveries, friend-request notifications) goes through **Expo's push service** — the backend needs no credentials for it (see [`docs/hosting.md`](./docs/hosting.md)). But for Expo to actually *deliver* pushes to devices, the platform credentials must be configured in the EAS project, or Android pushes silently never arrive:

- **Android (FCM).** `apps/mobile/app.config.ts` already points at `apps/mobile/google-services.json` for the `com.dwt.mobile` Firebase app, so Expo's prebuild wires the native FCM SDK to mint device tokens. You still need to upload the matching **FCM v1 service-account key** to the Expo project so the push service can deliver — set it once with `eas credentials -p android` (choose the FCM/push key) or via the Expo dashboard (Project → Credentials → Android → FCM V1). Without it, tokens mint but no notification is delivered.
- **iOS (APNs).** EAS manages the **APNs push key** as part of your Apple credentials; `eas credentials -p ios` provisions/uploads it. A push-enabled provisioning profile is required.

These are one-time per project (re-done only if the keys rotate). They're a mobile-build concern, independent of the API deploy — a backend change never touches them.

## Tooling Conventions

- **TypeScript**: strict mode, ES2022 target. All workspaces extend `tsconfig.base.json`. The path alias `@dwt/shared` resolves to `packages/shared/src`.
- **ESLint**: flat config in `eslint.config.mjs` shared across all workspaces.
- **Editor settings**: `.editorconfig` enforces LF line endings, UTF-8, and 2-space indentation.
- **Testing**: `vitest` for the backend and shared package, `jest` (via `jest-expo`) for the mobile app. Property-based tests use `fast-check` and tag each test with the design property number it validates.

## Documentation

- [`.kiro/specs/disney-world-tracker/requirements.md`](./.kiro/specs/disney-world-tracker/requirements.md) — feature requirements
- [`.kiro/specs/disney-world-tracker/design.md`](./.kiro/specs/disney-world-tracker/design.md) — architecture and design decisions
- [`.kiro/specs/disney-world-tracker/tasks.md`](./.kiro/specs/disney-world-tracker/tasks.md) — implementation plan
- [`docs/hosting.md`](./docs/hosting.md) — production hosting and deployment details
- [`.kiro/specs/disney-facilities-catalog-source/`](./.kiro/specs/disney-facilities-catalog-source/) — migration of catalog sourcing from ThemeParks.wiki to the Disney sources (facilities, resorts, menus, imagery, identity continuity)
- [`.kiro/specs/disney-source-resilience/`](./.kiro/specs/disney-source-resilience/) — the data-by-change-rate split (static from Disney, live from ThemeParks.wiki), the hardened Disney transport, incremental checkpoint-driven sync, lazy menus, graceful degradation, and the ThemeParks.wiki live path (Lightning Lane + boarding groups)
