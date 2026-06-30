# Disney World Tracker

A mobile app for tracking Walt Disney World experiences (attractions, shows, restaurants, parades, character meets, and more), backed by a Fastify API and a shared TypeScript package. Catalog data is sourced from the public [ThemeParks.wiki](https://api.themeparks.wiki/v1) API.

## Repository Layout

This repository is an npm workspaces monorepo with three packages:

| Path | Description |
| --- | --- |
| `apps/api` | Node.js + Fastify backend (TypeScript). Hosts the seven service modules — Auth, Catalog, Tracking, Stats, Friends, Sharing, Aggregate Ratings — plus BullMQ background workers. Talks to PostgreSQL, Redis, and an S3-compatible object store. |
| `apps/mobile` | React Native + TypeScript client built with Expo. Targets iOS and Android. |
| `packages/shared` | Shared DTOs, Zod validation schemas, error code catalog, and enums consumed by both `apps/api` and `apps/mobile`. Imported as `@dwt/shared`. |

## Prerequisites

- **Node.js 22 or 24** (LTS). The version is pinned in `.nvmrc` (24) — run `nvm use` to match it. The engines floor is Node 22; the API's `dev` script relies on Node's built-in `--env-file` flag (Node 20.6+).
- **npm 10+** (ships with Node 22/24)
- **Docker Desktop** (or any Docker engine + Compose v2) for the Postgres / Redis / MinIO stack
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
docker compose up -d                 # start Postgres, Redis, MinIO
npm run migrate                      # apply database migrations
npm run dev:api                      # terminal 1: Fastify API on :3000
npm run dev:mobile                   # terminal 2: Expo dev server
```

Three terminals total once everything is running:
1. Docker (in the background)
2. The API (`npm run dev:api`)
3. The Expo dev server (`npm run dev:mobile`)

When the Expo server prints a QR code, scan it with the Expo Go app on your phone, or press `i` for the iOS simulator / `a` for the Android emulator.

The mobile app resolves its API URL automatically: local `expo start` runs default to `http://10.0.2.2:3000` (the Android emulator), while production builds target the hosted Render API. You only need `apps/mobile/.env.local` to override the local target (iOS simulator or a physical phone); see [Mobile `dev` script](#mobile-dev-script). Restart Metro after changing it.

## What Each Piece Does

### `docker-compose.yml` (repo root)

Spins up the three backend services the API depends on. Default credentials match `apps/api/.env.example` so nothing needs editing.

| Service | Image | Port(s) | Purpose |
| --- | --- | --- | --- |
| `postgres` | `postgres:16` | `5432` | App database (users, experiences, ratings, friendships, shares, etc.) |
| `redis` | `redis:7-alpine` | `6379` | Session lookups, login lockout counters, leaderboard cache, BullMQ job queues |
| `minio` | `minio/minio` | `9000` (S3 API), `9001` (web console) | S3-compatible bucket for avatar uploads |
| `minio-init` | `minio/mc` | — | One-shot job that creates the `avatars` bucket and makes it publicly readable. Exits as soon as the bucket exists. |

Useful commands:

```bash
docker compose up -d         # start everything in the background
docker compose ps            # see what's running
docker compose logs -f       # tail all logs (Ctrl+C to stop tailing)
docker compose down          # stop containers (data preserved)
docker compose down -v       # stop and wipe data — clean slate
```

The MinIO console is at http://localhost:9001 (login: `dwt-minio-admin` / `dwt-minio-password`) if you want to inspect uploaded avatars.

### `apps/api/.env`

The API never reads `process.env` directly outside its config loader, so every backend setting lives in an env file. The `.env.example` template ships with values that match `docker-compose.yml` — just copy it to `.env` (see [Quickstart](#quickstart--run-everything-locally)). The real `.env` is gitignored.

Required keys: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SESSION_SECRET` (32+ chars), `THEMEPARKS_BASE_URL`. See `apps/api/.env.example` for descriptions.

Optional keys: `WIKI_CONTACT` — a contact email or project URL used only by the image-sourcing job (`npm run source-images`); see [Experience Images](#experience-images). Not needed to run the API server.

#### Two environments: local vs hosted dev

You can point the API at either your local Docker stack or your hosted managed services (Neon / Upstash / Cloudflare R2) without editing files — each lives in its own gitignored env file and has its own command:

| Target | Env file | Run the API | Run migrations |
| --- | --- | --- | --- |
| **Local** (Docker) | `apps/api/.env` | `npm run dev:api` | `npm run migrate` |
| **Hosted dev** (Neon/Upstash/R2) | `apps/api/.env.dev` | `npm run dev:api:cloud` | `npm run migrate:cloud` |

Copy `.env.example` to `.env.dev` and fill in your managed-service credentials there. The two files never interfere, so switching environments is just a matter of which command you run. (`migrate:cloud` only needs `DATABASE_URL`; running the full API with `dev:api:cloud` needs the Redis and S3 values filled in too.) All `.env*` files except `.env.example` are gitignored.

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
| 1 | `API_BASE_URL` env var | Any context — explicit override |
| 2 | `PROD_API_BASE_URL` env var (default `https://dwt-api.onrender.com`) | Release builds/exports, where Expo sets `NODE_ENV=production` |
| 3 | Built-in default `http://10.0.2.2:3000` | Local `expo start` (`NODE_ENV=development`) |

The upshot: a plain `npm run dev:mobile` hits your **local** API automatically, and a production build (`expo export` / EAS) targets **Render** automatically — no env juggling between them. The hosted default matches the `dwt-api` service in `render.yaml`; if you rename the Render service, set `PROD_API_BASE_URL` to its URL.

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

#### Android emulator: connecting over localhost (recommended)

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

## Repo-Wide Scripts

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Starts the Fastify API in watch mode against the **local** services in `docker-compose.yml` (uses `apps/api/.env`). |
| `npm run dev:api:cloud` | Starts the Fastify API in watch mode against your **hosted dev** services (uses `apps/api/.env.dev`). |
| `npm run dev:mobile` | Starts the Expo dev server. |
| `npm run migrate` | Applies any pending SQL migrations from `apps/api/migrations/` to the **local** Postgres (`apps/api/.env`). Idempotent. |
| `npm run migrate:cloud` | Applies pending migrations to the **hosted** Postgres (`apps/api/.env.dev`). Idempotent. |
| `npm run lint` | Runs ESLint across the entire repo using the shared `eslint.config.mjs`. |
| `npm run typecheck` | Runs `tsc --noEmit` in every workspace. |
| `npm test` | Runs the test suite in every workspace (vitest for API + shared, jest for mobile). |
| `npm run build` | Builds every workspace's `build` script. |
| `npm run build:shared` | Builds just the shared package. |

## Experience Images

The mobile app shows an image for every Experience — a thumbnail in the catalog list and a hero image on the detail screen. Because the ThemeParks.wiki catalog upstream exposes **no imagery**, images are sourced and stored separately from the catalog sync.

### How it works

- The `experiences` table has `image_url` and `image_attribution` columns (migration `0002_experience_images.sql`). These are **not** written by the catalog sync, so a curated image survives every catalog refresh.
- A standalone job, `npm run source-images` (run from `apps/api`), fills each Experience's image using a layered lookup, taking the first hit:
  1. **Curated override** — an entry in [`src/scripts/imageOverrides.json`](apps/api/src/scripts/imageOverrides.json) keyed by Experience name. The escape hatch for anything the automated lookup misses: you pick the URL by hand and it always wins.
  2. **Wikipedia article** — finds a matching article and uses its lead image, accepted only when the page title confidently matches the name.
  3. **Wikimedia Commons** — searches [Commons](https://commons.wikimedia.org) for a photo file. Commons holds photos for far more attractions, restaurants, and shows than there are Wikipedia articles, so this is the biggest coverage source. A file is accepted only when its filename confidently matches and it's a raster photo (logos/PDFs/audio are filtered out).
  4. **Park-level fallback** *(opt-in, `--park-fallback`)* — uses the park's own photo so the row still shows a real image instead of a placeholder.
- "Confident match" accepts a candidate when token similarity clears a threshold **or** one name's meaningful tokens are a subset of the other's (ignoring filler like "the", "of", "Disney"). This matches partial names like "Soarin'" → "Soarin' Around the World" without guessing a wrong photo.
- Where every layer misses, the row keeps `image_url = NULL` and the app renders a **category-colored placeholder** with the category glyph — so coverage is always 100% visually, even when photo coverage isn't.

> Note: Images are sourced from Wikimedia (freely licensed, attribution preserved), **not** scraped from Disney's website — Disney's images are copyrighted and their site's terms prohibit scraping.

### Curating images by hand

For anything the automated lookup can't find (or finds a poor photo for), add an entry to `apps/api/src/scripts/imageOverrides.json`. Keys are Experience names (matched case-insensitively, punctuation ignored); values are a URL string or an object with `url` + `attribution`:

```json
{
  "Tiana's Bayou Adventure": "https://upload.wikimedia.org/.../image.jpg",
  "Space Mountain": {
    "url": "https://upload.wikimedia.org/.../space_mountain.jpg",
    "attribution": "Space Mountain — Wikimedia Commons (CC BY-SA)."
  }
}
```

Use freely-licensed images (a Wikimedia Commons file URL works well) and keep the attribution accurate. Keys starting with `__` are ignored, so the file's `__comment`/`__example` entries aren't applied. Overrides always win over the automated lookup.

### Running the job

```bash
cd apps/api

npm run source-images -- --dry-run         # preview matches without writing
npm run source-images                      # fill rows missing an image
npm run source-images -- --force           # re-source every active row
npm run source-images -- --park-fallback   # also use a park photo for misses
npm run source-images -- --overrides path.json   # use a custom overrides file
```

The job is idempotent: without `--force` it only fills rows where `image_url IS NULL`. It requires network access and a populated catalog (run `npm run migrate` and let the catalog sync first). The closing line reports a per-source breakdown, e.g. `1 override, 40 wikipedia, 73 commons, 0 park-fallback, 12 skipped`.

### `WIKI_CONTACT` and rate limiting

Wikimedia's [User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy) requires requests to send a descriptive User-Agent that includes a way to contact you; traffic using a placeholder User-Agent is throttled (HTTP 429) or blocked. Set `WIKI_CONTACT` in `apps/api/.env` to an email or project URL:

```dotenv
WIKI_CONTACT=https://github.com/<you>/<repo>
```

The job warns at startup if it's unset. It also removes browser-only CORS params and honors `Retry-After` with exponential backoff, so occasional throttling during a large run is handled gracefully rather than erroring out.

## First-Run Behavior

A few things to expect on the very first request:

- **Empty catalog.** The Catalog service syncs from ThemeParks.wiki on first read when the cache is older than 24 hours. The first `GET /catalog` triggers a sync; give it a few seconds. If the upstream is unreachable and there's no prior cache, the API returns `503 catalog_unavailable` rather than serving stale empty data.
- **Argon2 native build.** On first `npm install`, the `argon2` package compiles a small native module. On Windows this needs the Visual Studio Build Tools with the "Desktop development with C++" workload. macOS / Linux users typically have this for free.
- **MinIO bucket creation.** The `minio-init` container runs once on first `docker compose up`, creates the `avatars` bucket, and exits. You'll see it as `Exited (0)` in `docker compose ps` — that's normal. It re-runs idempotently on subsequent `up` commands.

## Smoke Testing the Stack

After `docker compose up -d` and `npm run migrate`, with the API running on `:3000`:

```bash
# Should return an empty list initially (catalog sync runs in background).
curl http://localhost:3000/catalog

# Register a user.
curl -X POST http://localhost:3000/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"test@example.com","password":"longenoughpw","displayName":"Test"}'
```

If both succeed, the API is talking to Postgres and Redis correctly. The mobile app can then reach the same endpoints.

## Deploying the API (Render)

The API deploys to [Render](https://render.com) as a free Web Service, defined as code in [`render.yaml`](./render.yaml) (a Render Blueprint). The backing services are managed elsewhere on their own free tiers — Postgres on [Neon](https://neon.tech), Redis on [Upstash](https://upstash.com), and avatar storage on [Cloudflare R2](https://developers.cloudflare.com/r2/). See [`hosting.md`](./.kiro/specs/disney-world-tracker/hosting.md) for the full rationale and free-tier details.

### One-time provider setup

1. **Neon** — create a project, then copy the **pooled** connection string (host contains `-pooler`, ends with `?sslmode=require`). The schema and extensions (`citext`, `pg_trgm`, `pgcrypto`) are created by the migrations, not by hand. You don't need Neon Auth — the app has its own auth.
2. **Upstash** — create a Redis database, copy the `rediss://` URL.
3. **Cloudflare R2** — create a bucket (e.g. `avatars-dev`), generate an Access Key ID + Secret, and note the S3 endpoint `https://<accountid>.r2.cloudflarestorage.com`.

### Deploy

1. Push to the `develop` branch (the branch `render.yaml` auto-deploys).
2. In Render: **New +** → **Blueprint** → select this repo. Render reads `render.yaml`.
3. Fill in the secret env vars it prompts for (these are `sync: false` in the blueprint): `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `SESSION_SECRET` is auto-generated; `NODE_ENV` and `THEMEPARKS_BASE_URL` are preset.
4. Render runs the build (`npm ci` → build shared → build API → apply migrations), then starts the server. The health check is `GET /health`. (Migrations run in the build step because Render's free tier doesn't support a separate pre-deploy command; they're idempotent, so they're skipped when already applied.)

The deployed URL looks like `https://dwt-api.onrender.com` — this is also the default the mobile app targets in production builds (see [How the API base URL is chosen](#how-the-api-base-url-is-chosen)). If you rename the Render service, set `PROD_API_BASE_URL` in the mobile app to match.

> **Free-tier note:** the service sleeps after 15 minutes idle, so the first request after a quiet period takes 30–60s to wake. Expected, not a bug.

### Testing against hosted services from your machine

Before (or instead of) deploying, you can run the API or migrations locally against the hosted services using `apps/api/.env.dev` — see [Two environments: local vs hosted dev](#two-environments-local-vs-hosted-dev). For example, `npm run migrate:cloud` applies the schema to Neon from your machine; Render's build-step migration then finds them already applied and skips them.

## Tooling Conventions

- **TypeScript**: strict mode, ES2022 target. All workspaces extend `tsconfig.base.json`. The path alias `@dwt/shared` resolves to `packages/shared/src`.
- **ESLint**: flat config in `eslint.config.mjs` shared across all workspaces.
- **Editor settings**: `.editorconfig` enforces LF line endings, UTF-8, and 2-space indentation.
- **Testing**: `vitest` for the backend and shared package, `jest` (via `jest-expo`) for the mobile app. Property-based tests use `fast-check` and tag each test with the design property number it validates.

## Documentation

- [`.kiro/specs/disney-world-tracker/requirements.md`](./.kiro/specs/disney-world-tracker/requirements.md) — feature requirements
- [`.kiro/specs/disney-world-tracker/design.md`](./.kiro/specs/disney-world-tracker/design.md) — architecture and design decisions
- [`.kiro/specs/disney-world-tracker/tasks.md`](./.kiro/specs/disney-world-tracker/tasks.md) — implementation plan
- [`.kiro/specs/disney-world-tracker/hosting.md`](./.kiro/specs/disney-world-tracker/hosting.md) — production hosting and deployment details
