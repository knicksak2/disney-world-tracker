# Disney World Tracker

A mobile app for tracking Walt Disney World experiences (attractions, shows, restaurants, parades, character meets, and more), backed by a Fastify API and a shared TypeScript package. Catalog data is sourced from the public [ThemeParks.wiki](https://api.themeparks.wiki/v1) API.

## Repository Layout

This repository is an npm workspaces monorepo with three packages:

| Path | Description |
| --- | --- |
| `apps/api` | Node.js + Fastify backend (TypeScript). Hosts the seven service modules — Auth, Catalog, Tracking, Stats, Friends, Sharing, Aggregate Ratings — plus BullMQ background workers. Talks to PostgreSQL, Redis, and an S3-compatible object store. |
| `apps/mobile` | React Native + TypeScript client built with Expo (bare workflow). Targets iOS and Android. |
| `packages/shared` | Shared DTOs, Zod validation schemas, error code catalog, and enums consumed by both `apps/api` and `apps/mobile`. Imported as `@dwt/shared`. |

## Prerequisites

- Node.js **20.x** (use `nvm use` — the version is pinned in `.nvmrc`)
- npm **10+** (ships with Node 20)
- For the mobile app: Xcode (iOS) and/or Android Studio with an SDK + emulator
- For the backend: a local PostgreSQL 15+, Redis 7+, and an S3-compatible bucket (or stub) when running end-to-end

## First-Time Setup

```bash
nvm use            # picks up .nvmrc → Node 20
npm install        # installs all workspaces from the root
```

`npm install` at the repo root resolves and hoists dependencies for every workspace.

## Running Each Workspace

All commands are run from the repo root.

### API (`apps/api`)

```bash
npm run dev:api          # start the Fastify server in watch mode
npm run build --workspace apps/api
npm test --workspace apps/api
```

### Mobile (`apps/mobile`)

```bash
npm run dev:mobile       # start the Expo dev server
npm test --workspace apps/mobile
```

From there, press `i` for iOS simulator, `a` for Android emulator, or scan the QR code with the Expo Go app.

### Shared (`packages/shared`)

```bash
npm run build:shared     # emit type declarations consumed by the other workspaces
npm test --workspace packages/shared
```

## Repo-Wide Scripts

| Command | What it does |
| --- | --- |
| `npm run lint` | Runs ESLint across the entire repo using the shared `eslint.config.mjs`. |
| `npm run typecheck` | Runs `tsc --noEmit` in every workspace that defines a `typecheck` script. |
| `npm test` | Runs the test suite in every workspace that defines a `test` script. |
| `npm run build` | Builds every workspace that defines a `build` script. |

## Tooling Conventions

- **TypeScript**: strict mode, ES2022 target. All workspaces extend `tsconfig.base.json`. The path alias `@dwt/shared` resolves to `packages/shared/src`.
- **ESLint**: flat config in `eslint.config.mjs` shared across all workspaces.
- **Editor settings**: `.editorconfig` enforces LF line endings, UTF-8, and 2-space indentation.

## Documentation

- [`.kiro/specs/disney-world-tracker/requirements.md`](./.kiro/specs/disney-world-tracker/requirements.md) — feature requirements
- [`.kiro/specs/disney-world-tracker/design.md`](./.kiro/specs/disney-world-tracker/design.md) — architecture and design decisions
- [`.kiro/specs/disney-world-tracker/tasks.md`](./.kiro/specs/disney-world-tracker/tasks.md) — implementation plan
- [`.kiro/specs/disney-world-tracker/hosting.md`](./.kiro/specs/disney-world-tracker/hosting.md) — hosting and deployment details
