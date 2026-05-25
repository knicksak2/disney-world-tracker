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

- **Node.js 20.x** (use `nvm use` — the version is pinned in `.nvmrc`). The API's `dev` script relies on Node's built-in `--env-file` flag, which requires Node 20.6+.
- **npm 10+** (ships with Node 20)
- **Docker Desktop** (or any Docker engine + Compose v2) for the Postgres / Redis / MinIO stack
- For the mobile app: **Expo Go** on your phone, or Xcode (iOS) / Android Studio with an emulator

## Quickstart — Run Everything Locally

From a fresh clone:

```bash
nvm use                              # picks up .nvmrc → Node 20
npm install                          # installs all workspaces

cp apps/api/.env.example apps/api/.env   # backend env
                                         # (defaults match docker-compose.yml)

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

The API never reads `process.env` directly outside its config loader, so every backend setting lives in `apps/api/.env`. The `.env.example` template ships with values that match `docker-compose.yml` — just `cp` it. The real `.env` is gitignored.

Required keys: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SESSION_SECRET` (32+ chars), `THEMEPARKS_BASE_URL`. See `apps/api/.env.example` for descriptions.

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

Runs `expo start` from `apps/mobile`. The Expo dev server reads `apps/mobile/app.config.ts`, which exposes `extra.apiBaseUrl` to the app via `expo-constants`. By default it points at `http://localhost:3000`, which works on the iOS simulator and (with `localhost` swapped for `10.0.2.2`) the Android emulator.

**For testing on a real phone**, set `API_BASE_URL` to your laptop's LAN IP before starting Expo:

```bash
# macOS / Linux
API_BASE_URL=http://192.168.1.50:3000 npm run dev:mobile

# Windows PowerShell
$env:API_BASE_URL="http://192.168.1.50:3000"; npm run dev:mobile

# Windows cmd
set API_BASE_URL=http://192.168.1.50:3000 && npm run dev:mobile
```

Find your LAN IP with `ipconfig` (Windows) or `ifconfig` / `ip a` (macOS / Linux).

## Repo-Wide Scripts

All from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Starts the Fastify API in watch mode against the services in `docker-compose.yml`. |
| `npm run dev:mobile` | Starts the Expo dev server. |
| `npm run migrate` | Applies any pending SQL migrations from `apps/api/migrations/` to the configured Postgres. Idempotent. |
| `npm run lint` | Runs ESLint across the entire repo using the shared `eslint.config.mjs`. |
| `npm run typecheck` | Runs `tsc --noEmit` in every workspace. |
| `npm test` | Runs the test suite in every workspace (vitest for API + shared, jest for mobile). |
| `npm run build` | Builds every workspace's `build` script. |
| `npm run build:shared` | Builds just the shared package. |

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
