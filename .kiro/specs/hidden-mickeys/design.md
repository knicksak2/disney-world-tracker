# Design Document

## Overview

Hidden Mickeys adds a list of hidden Mickey shapes tied to existing `experiences` rows, plus per-user progress, a "still there?" signal, user submissions that publish immediately, reports with a reversible soft-hide, and Friend and Trip comparison.

It is one new backend service (`apps/api/src/services/mickeys/`), one new admin page set, and a set of mobile screens. It reuses existing infrastructure instead of building anything parallel:

- **Authorization**: `assertTripMember`, `assertOwnerOrFriend`, the `active_friendships` view.
- **Time**: `wdwToday` from `trips/wdwClock.ts`.
- **Admin**: `/admin/mickeys` beside `/admin/photos`, using the same basic auth, `renderPage` and same-origin check.
- **Text safety**: the same moderation endpoint the photo service already calls (`/v1/moderations`), through a new text adapter.

There are **no photos and no AI image calls**. The photo service, its tables, its constraints and its push-notification kinds are not touched. The only outside call is the text check, made during a User's submit request.

The central modeling choice is the **Official / Community split**. `official` is a stored boolean. Official entries (the reviewed seed list, plus anything the Operator promotes) are the only ones that count toward park totals. Community entries are found and counted separately, so a User's official progress changes only when the Operator promotes an entry. This keeps the goalposts fixed (Requirement 2.6, 2.7, 8.4).

Two further choices keep the goalposts fixed:

- **The denominator is fixed.** `total` is every approved Official Hidden_Mickey. The Confidence_Label (from "still there?" votes) only drives a warning badge and the Operator's review list, never a count (Requirement 2.6, 5.4). Otherwise four throwaway accounts voting `gone` could move every User's park total, and two Friends would see different totals for the same park. A Hidden_Mickey that is really gone is retired by the Operator.
- **The catalog's `active` flag is not consulted for visibility** (Requirement 16.4). It records whether Disney's feed currently lists an Experience, not whether the physical Hidden_Mickey exists. A seasonal variant such as Living with the Land – Glimmering Greenhouses is a separate Experience in the catalog, so Hidden_Mickeys are stored once on the base Experience and the variant is linked to it as an *alias* (`mickey_experience_aliases`). Reads resolve any Experience to its **Experience_Group** (the base plus its aliases), so opening either entry shows the same Hidden_Mickeys and counts them once (Requirement 16). Nothing outside this feature reads the link table.

## Architecture

```
experiences ──< mickey_experience_aliases (alias -> canonical, one hop; read only by this feature)
experiences ──< hidden_mickeys >── submitter_id -> users (SET NULL)
                   │ source: seed | user        official: bool
                   │ status: pending | approved | rejected | retired | hidden
                   │
     ┌─────────────┼───────────────────┬───────────────────────┐
     ▼             ▼                   ▼                       ▼
mickey_progress  mickey_still_there_votes  mickey_reports   mickey_submission_bans
(user,mickey)    (user,mickey) one vote    (user,mickey)    (user_id PK)
hint_level, found_at, found_on, trip_id    reason, status
```

**Request paths (no background work anywhere):**

```
list / summary / detail / hint / find / undo / vote   → mickeys/routes.ts → repo (SQL)
submit    → SubmissionService → URL/email rule → TextScreen (OpenAI moderations) → insert (+ progress + vote)
report    → ReportService     → insert report → count Counted_Reports → maybe status 'hidden'
operator  → /admin/mickeys    → AdminMickeyService (approve/reject/edit/retire/restore/promote/ban/dismiss)
```

**Access rules:**

- A User reads and writes only their own Progress_Row, vote and Report. `user_id` is always `request.userId`.
- Only `approved` Hidden_Mickeys are readable by Users. A submitter additionally reads their own Submissions in any Status through `GET /me/mickeys/submissions`.
- Clue_2 and Reveal leave the server only through `GET /mickeys/:id` and the hint route, gated by Hint_Level or a Find (Property 1).
- Cross-user reads are limited to Friends' summaries and finds (owner-or-friend) and the Trip tally (members), neither of which returns Clue_2 or Reveal.

## Components and Interfaces

### Backend layout — `apps/api/src/services/mickeys/`

```
domain/                      (pure, no I/O; property-tested)
  hintGate.ts                visibleLayers(mickey, progress) → { clue2?, reveal? }
  stillThere.ts              stillThereConfidence(votes, now, params), confidenceLabel(c, params),
                             isCommunityVerified(input)
  progress.ts                summarizeProgress(mickeys, progressRows)
  aliasGroup.ts              groupOf(experienceId, links), canonicalOf(experienceId, links),
                             validateAliasLinks(links, existing)
  submissionPolicy.ts        validateSubmission(input), containsUrlOrEmail(text),
                             checkDailyCap(count, cap), initialStatus(mode, screen)
  reportPolicy.ts            shouldAutoHide({ status, countedReporters }, threshold)
  transitions.ts             canTransition(from, to)
  seedParse.ts               parseSeedFile(json) → { valid[], invalid[], dupes[] }
ports.ts                     TextScreen
repo.ts                      SQL for everything above (pg)
service.ts                   HuntService (list, summary, detail, hint, find, undo, vote, friends, trip tally)
submissionService.ts         SubmissionService
reportService.ts             ReportService
adminService.ts              AdminMickeyService
routes.ts                    Fastify routes for Users
adapters/openaiTextScreen.ts implements TextScreen
admin pages:   apps/api/src/services/admin/mickeyRoutes.ts   (registered beside photoRoutes)
script:        apps/api/src/scripts/importHiddenMickeys.ts
```

Provider names (`openai`) stay inside `mickeys/adapters/`, mirroring the photos service rule that provider code lives only in adapter files. A guard test for the new folder enforces it.

### Ports (`ports.ts`)

```typescript
export type TextOutcome =
  | { kind: 'ok'; flagged: boolean }
  | { kind: 'retryable'; code: string };
export interface TextScreen { check(text: string): Promise<TextOutcome>; }
```

`SubmissionService` receives `TextScreen` by constructor injection from `composeServices.ts`, so tests substitute a fake (the same pattern as `HarmModerator`).

### Routes — Users (`routes.ts`)

Every route requires a session (401 first). Error codes are listed under Error Handling.

| Method and path | Body / query | Success | Notes |
|---|---|---|---|
| `GET /mickeys/config` | none | `MickeyClientConfigDTO` | Requirement 14.3 |
| `GET /mickeys` | `experienceId?, park?, areaType?, land?, q?, zone?, found?, scope?, cursor?, limit?` | `MickeyListPageDTO` | R2.1 to R2.4; never clue 2 or reveal. `park` cannot select resort-area rows (null park); `areaType=Resort` does. `experienceId` matches the Experience_Group (R16.2). `zone` is one value of `MICKEY_ZONES`. All filters run in SQL before the keyset cursor |
| `GET /mickeys/summary` | `for?` | `MickeySummaryDTO` | R2.5 to R2.8; `for` uses `assertOwnerOrFriend` (R10.1) |
| `GET /mickeys/:id` | none | `MickeyDetailDTO` | R3.2, R3.7 |
| `POST /me/mickeys/:id/hint` | `{ level: 2 \| 3 }` | `MickeyDetailDTO` | R3.3 |
| `POST /me/mickeys/:id/find` | `{ tripId? }` | `MickeyProgressDTO` | R4.1 to R4.4 |
| `DELETE /me/mickeys/:id/find` | none | `204` | R4.5 |
| `PUT /me/mickeys/:id/vote` | `{ vote }` | `{ confidenceLabel, communityVerified }` | R5.1 |
| `POST /mickeys/:id/report` | `{ reason, note? }` | `204` | R7.1 to R7.4 |
| `POST /me/mickeys/submissions` | submission body | `MickeySubmissionDTO` | R6 |
| `GET /me/mickeys/submissions` | none | `MickeySubmissionDTO[]` | R9.1 |
| `GET /users/:userId/mickeys/finds` | `cursor?` | `FriendMickeyFindsPageDTO` | R10.2 |
| `GET /trips/:id/mickeys` | none | `TripMickeysDTO` | R11.1 (in the Trips routes module, `assertTripMember`) |

Route order: `/mickeys/config`, `/mickeys/summary` and `/me/mickeys/submissions` are static and registered before the parametric `:id` forms so they are not captured by them.

### Pure modules

**`hintGate.ts`**

```typescript
export function visibleLayers(
  m: { clue2: string; reveal: string },
  p: { hintLevel: number; found: boolean } | null,
): { clue2?: string; reveal?: string } {
  const level = p?.hintLevel ?? 1;
  const found = p?.found ?? false;
  return {
    ...(level >= 2 || found ? { clue2: m.clue2 } : {}),
    ...(level >= 3 || found ? { reveal: m.reveal } : {}),
  };
}
```

**`stillThere.ts`** — starting formula, used exactly as written:

```typescript
export interface StillThereParams {
  priorValue: number;    // 0.9
  priorWeight: number;   // 3
  halfLifeDays: number;  // 90
  confirmedMin: number;  // 0.65
  uncertainMin: number;  // 0.4
}
export function stillThereConfidence(
  votes: ReadonlyArray<{ vote: 'there' | 'gone'; votedAt: Date }>,
  now: Date,
  p: StillThereParams,
): number {
  let num = p.priorWeight * p.priorValue;
  let den = p.priorWeight;
  for (const v of votes) {
    const ageDays = Math.max(0, (now.getTime() - v.votedAt.getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / p.halfLifeDays);
    num += w * (v.vote === 'there' ? 1 : 0);
    den += w;
  }
  return num / den;
}
export type ConfidenceLabel = 'confirmed' | 'uncertain' | 'possibly_removed';
export function confidenceLabel(c: number, p: StillThereParams): ConfidenceLabel {
  return c >= p.confirmedMin ? 'confirmed' : c >= p.uncertainMin ? 'uncertain' : 'possibly_removed';
}
export function isCommunityVerified(i: {
  official: boolean;
  label: ConfidenceLabel;
  otherThereVoters: number;   // distinct users with a 'there' vote, excluding the submitter
  min: number;                // MICKEYS_COMMUNITY_VERIFIED_MIN
}): boolean {
  return !i.official && i.label !== 'possibly_removed' && i.otherThereVoters >= i.min;
}
```

Worked values at default parameters with fresh votes (weight 1 each): no votes gives 0.9; one `gone` gives 2.7/4 = 0.675 (confirmed); two give 0.54 (uncertain); three give 0.45 (uncertain); four give ≈0.386 (`possibly_removed`). One angry vote cannot bury a Hidden_Mickey, and a later `there` vote lifts it back. The continuous value is the internal one; the label is for display and counting only (Requirement 5.4).

**`progress.ts`** — `summarizeProgress` implements Requirement 2.5 to 2.8: official `total` counts every approved Official Hidden_Mickey, whatever its Confidence_Label and whatever its Experience's `active` flag (the function receives neither as an input to the count); official `found` counts the User's Finds among that set; Hidden_Mickeys on Experiences with a null `park` all go into the single `park: null` entry; `community.found` counts the User's Finds on approved Community entries; retired, hidden, pending and rejected contribute to nothing.

**`aliasGroup.ts`** — pure functions over a list of links `{ aliasId, canonicalId }`:

```typescript
export interface AliasLink { readonly aliasId: string; readonly canonicalId: string; }

// The canonical id for an Experience: its canonical when it is an alias, otherwise itself. One hop only.
export function canonicalOf(experienceId: string, links: readonly AliasLink[]): string;

// Canonical plus every alias of that canonical, sorted and de-duplicated. A group of one when unlinked.
export function groupOf(experienceId: string, links: readonly AliasLink[]): readonly string[];

// Partition candidate links into accepted and rejected (with a reason), given the links already stored.
// Rejects: aliasId === canonicalId; an alias that is already a canonical (stored or earlier in the file);
// a canonical that is already an alias (stored or earlier in the file); an alias that already has a link.
export function validateAliasLinks(
  candidates: readonly AliasLink[],
  existing: readonly AliasLink[],
): { accepted: readonly AliasLink[]; rejected: ReadonlyArray<{ link: AliasLink; reason: 'self' | 'alias_is_canonical' | 'canonical_is_alias' | 'already_linked' }> };
```

The repo does not call these for the hot path; it expresses the same group rule in SQL (below). The pure functions are the reference model that the SQL is tested against, and the import script uses `validateAliasLinks`.

**`submissionPolicy.ts`**

```typescript
export function containsUrlOrEmail(text: string): boolean;   // http(s)://, www., bare domain.tld/path, user@host
export function initialStatus(
  mode: 'publish' | 'review',
  screen: 'pass' | 'unscreened',
): 'approved' | 'pending' {
  return mode === 'publish' && screen === 'pass' ? 'approved' : 'pending';
}
```

`validateSubmission` enforces Requirement 1.1 and 1.7 plus the URL and email rule; `checkDailyCap(createdLast24h, cap)` returns `ok` or `limit`.

**`reportPolicy.ts`**

```typescript
export function shouldAutoHide(
  i: { status: string; official: boolean; countedReporters: number },
  threshold: number,
): boolean {
  return i.status === 'approved' && !i.official && i.countedReporters >= threshold;
}
```

**`transitions.ts`** — the seven legal transitions of Requirement 1.3.

**`seedParse.ts`** — pure parse and validation of a Seed_File; dedupes by `seedKey` (first wins) and returns the dropped duplicates for the report.

The entry schema is a Zod `.strict()` object with the fields of Requirement 12.1 and `photoUrl: z.string().max(2048).optional()`. `photoUrl` is accepted so the owner can keep reference links in the file, then **removed from the parsed output**: `valid[]` entries have no `photoUrl` key, so the importer cannot pass it to an `INSERT` even by accident. It is not parsed as a URL and never fetched. The schema is strict rather than `.passthrough()` on purpose: passthrough would also accept a misspelled field (`clu1`, `experiencename`) and drop it silently, and a strict schema reports it as invalid. The shipped `apps/api/data/hidden-mickeys.seed.json` has 220 entries, 140 with a `photoUrl`, and its keys are exactly `seedKey, upstreamEntityId, experienceName, park, zone, difficulty, clue1, clue2, reveal, photoUrl` (checked 2026-11-06).

### Experience groups and the list filters (repo)

When `experienceId` is supplied, the list resolves the group in SQL and matches any member. There is one hop, so no recursion is needed:

```sql
-- $1 = the requested experience id
WITH canon AS (
  SELECT COALESCE((SELECT a.canonical_experience_id FROM mickey_experience_aliases a
                    WHERE a.alias_experience_id = $1), $1::uuid) AS id
), grp AS (
  SELECT id FROM canon
  UNION
  SELECT a.alias_experience_id FROM mickey_experience_aliases a JOIN canon c ON a.canonical_experience_id = c.id
)
SELECT hm.id /* ... */
  FROM hidden_mickeys hm
  JOIN experiences e ON e.id = hm.experience_id          -- no e.active predicate, by design (R16.4)
 WHERE hm.status = 'approved'
   AND hm.experience_id IN (SELECT id FROM grp)
   AND ($zone::text IS NULL OR hm.zone = $zone)           -- R2.2; zone is validated against MICKEY_ZONES first
   /* + park, areaType, land, q, found, scope, the caller's reported exclusion, keyset cursor */
```

The join to `experiences` exists only for the name, park and land. It carries **no** `e.active` predicate in the list, detail, summary, Friend finds or Trip tally queries, and a test asserts a Hidden_Mickey on an `active = false` Experience is still returned and still counted. A submission names an Experience, resolves `canonicalOf` (the same `COALESCE`) and inserts with the canonical id (R16.3).

The Operator's review list (R8.9) is the only query that reads `active`: approved Hidden_Mickeys whose group contains no `active = true` Experience.

### Report counting (repo)

A Report is stored with `INSERT ... ON CONFLICT (user_id, mickey_id) DO NOTHING`. The auto-hide check counts Counted_Reports in SQL:

```sql
SELECT count(*)::int AS n
  FROM mickey_reports r
 WHERE r.mickey_id = $1
   AND r.status = 'open'
   AND EXISTS (SELECT 1 FROM mickey_progress p WHERE p.user_id = r.user_id AND p.found_at IS NOT NULL);
```

When `shouldAutoHide` is true the repo runs a conditional `UPDATE hidden_mickeys SET status = 'hidden', hidden_reason = 'reports', updated_at = now() WHERE id = $1 AND status = 'approved' AND official = FALSE`, so an Official Hidden_Mickey can never be hidden by Reports (Requirement 7.4), and two concurrent reports cannot hide twice or hide a row that changed status in between.

## Data Models

### Migration `0072_hidden_mickeys.sql`

Latest existing migration is `0071`. Wrapped in `BEGIN/COMMIT`, idempotent on reapply, `gen_random_uuid()`, `TIMESTAMPTZ`, `CHECK`s and cascades as the repo convention requires. It changes no existing table.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS hidden_mickeys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  zone          TEXT NOT NULL,
  difficulty    TEXT NOT NULL,
  clue_1        TEXT NOT NULL,
  clue_2        TEXT NOT NULL,
  reveal        TEXT NOT NULL,
  source        TEXT NOT NULL,
  official      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'pending',
  hidden_reason TEXT,
  seed_key      TEXT,
  submitter_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note   TEXT,
  text_screen   TEXT NOT NULL DEFAULT 'skipped',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  promoted_at   TIMESTAMPTZ,
  CONSTRAINT chk_hm_zone CHECK (zone IN ('exterior','queue','pre_show','on_ride','exit','interior','grounds')),
  CONSTRAINT chk_hm_difficulty CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT chk_hm_clue1 CHECK (char_length(clue_1) BETWEEN 10 AND 140),
  CONSTRAINT chk_hm_clue2 CHECK (char_length(clue_2) BETWEEN 10 AND 300),
  CONSTRAINT chk_hm_reveal CHECK (char_length(reveal) BETWEEN 10 AND 500),
  CONSTRAINT chk_hm_source CHECK (source IN ('seed','user')),
  CONSTRAINT chk_hm_seed_official CHECK (source <> 'seed' OR official = TRUE),
  CONSTRAINT chk_hm_status CHECK (status IN ('pending','approved','rejected','retired','hidden')),
  CONSTRAINT chk_hm_hidden_reason CHECK (
    (status = 'hidden' AND hidden_reason IN ('reports','operator'))
    OR (status <> 'hidden' AND hidden_reason IS NULL)
  ),
  CONSTRAINT chk_hm_text_screen CHECK (text_screen IN ('skipped','pass','unscreened')),
  CONSTRAINT chk_hm_review_note CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS hidden_mickeys_seed_key_uidx ON hidden_mickeys(seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS hidden_mickeys_experience_idx ON hidden_mickeys(experience_id, status);
CREATE INDEX IF NOT EXISTS hidden_mickeys_status_idx ON hidden_mickeys(status, official, created_at);
CREATE INDEX IF NOT EXISTS hidden_mickeys_submitter_idx ON hidden_mickeys(submitter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mickey_progress (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id  UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  hint_level SMALLINT NOT NULL DEFAULT 1,
  found_at   TIMESTAMPTZ,
  found_on   DATE,
  trip_id    UUID REFERENCES trips(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mp_hint CHECK (hint_level BETWEEN 1 AND 3),
  CONSTRAINT chk_mp_found_pair CHECK ((found_at IS NULL) = (found_on IS NULL)),
  CONSTRAINT chk_mp_trip_needs_find CHECK (found_at IS NOT NULL OR trip_id IS NULL)
);
CREATE INDEX IF NOT EXISTS mickey_progress_user_idx ON mickey_progress(user_id, found_at DESC);
CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id) WHERE found_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS mickey_progress_trip_idx ON mickey_progress(trip_id) WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mickey_still_there_votes (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  vote      TEXT NOT NULL,
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mstv_vote CHECK (vote IN ('there','gone'))
);
CREATE INDEX IF NOT EXISTS mickey_votes_mickey_idx ON mickey_still_there_votes(mickey_id);

CREATE TABLE IF NOT EXISTS mickey_reports (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mickey_id   UUID NOT NULL REFERENCES hidden_mickeys(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, mickey_id),
  CONSTRAINT chk_mr_reason CHECK (reason IN ('inappropriate','not_a_mickey','restricted_area','spam','other')),
  CONSTRAINT chk_mr_status CHECK (status IN ('open','upheld','dismissed')),
  CONSTRAINT chk_mr_note CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS mickey_reports_mickey_idx ON mickey_reports(mickey_id, status);

CREATE TABLE IF NOT EXISTS mickey_submission_bans (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_msb_reason CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300)
);

CREATE TABLE IF NOT EXISTS mickey_experience_aliases (
  alias_experience_id     UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  canonical_experience_id UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mea_distinct CHECK (alias_experience_id <> canonical_experience_id)
);
CREATE INDEX IF NOT EXISTS mickey_aliases_canonical_idx ON mickey_experience_aliases(canonical_experience_id);

COMMIT;
```

Notes on the DDL:

- `mickey_progress` uses a composite primary key like `experience_favorites`; there is no surrogate id because nothing else references a Progress_Row.
- A Report is stored once per `(User, Hidden_Mickey)`; a reporter's own hide (Requirement 7.2) is "a row exists for me", whatever its status.
- No existing table, constraint or enum is modified, so `photos`, `push_delivery_log` and the shared `PhotoTargetKind` are unchanged.
- `mickey_experience_aliases` is deliberately named for this feature: it says two Experiences share their Hidden_Mickeys, not that they are the same Experience for ride logging, favorites, planning or wait history, which could reasonably differ (Requirement 16.7). Its primary key makes an alias belong to at most one canonical. The database cannot cheaply forbid chains, so the import script (`validateAliasLinks`) refuses them and reads treat links as one hop. It references `experiences`, not `users`, so it needs no entry in the account-deletion dispositions registry.
- `chk_mp_trip_needs_find` (`found_at IS NOT NULL OR trip_id IS NULL`) means the undo statement must clear `found_at`, `found_on` and `trip_id` in one `UPDATE`, never `found_at` first. A single `UPDATE` is checked against the final row, so this passes; a two-statement undo would fail because Postgres does not defer plain `CHECK`s inside a transaction. `repo.test.ts` undoes a Find that has a `trip_id` and asserts the row.

### Shared contracts (`packages/shared`)

Constants (`constants/mickeys.ts`):

```typescript
export const MICKEY_ZONES = ['exterior','queue','pre_show','on_ride','exit','interior','grounds'] as const;
export const MICKEY_DIFFICULTIES = ['easy','medium','hard'] as const;
export const MICKEY_STATUSES = ['pending','approved','rejected','retired','hidden'] as const;
export const MICKEY_CONFIDENCE_LABELS = ['confirmed','uncertain','possibly_removed'] as const;
export const MICKEY_REPORT_REASONS = ['inappropriate','not_a_mickey','restricted_area','spam','other'] as const;
export const MICKEY_SCOPES = ['all','official','community'] as const;
export const MICKEY_FOUND_FILTERS = ['all','found','unfound'] as const;
export const MICKEY_AREA_TYPES = ['ThemePark','WaterPark','DisneySprings','Resort'] as const;
export const MICKEY_CLUE1_MIN = 10, MICKEY_CLUE1_MAX = 140;
export const MICKEY_CLUE2_MIN = 10, MICKEY_CLUE2_MAX = 300;
export const MICKEY_REVEAL_MIN = 10, MICKEY_REVEAL_MAX = 500;
export const MICKEY_NOTE_MAX = 300;
export const MICKEY_LIST_DEFAULT_LIMIT = 50, MICKEY_LIST_MAX_LIMIT = 100;
export const MICKEY_SEARCH_MIN = 2, MICKEY_SEARCH_MAX = 60;
```

DTOs (`dto/Mickeys.ts`):

```typescript
export interface MickeyListItemDTO {
  readonly id: string;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly land: string | null;
  readonly zone: MickeyZone;
  readonly difficulty: MickeyDifficulty;
  readonly clue1: string;
  readonly official: boolean;
  readonly communityVerified: boolean;
  readonly confidenceLabel: MickeyConfidenceLabel;
  readonly hintLevel: 1 | 2 | 3;
  readonly found: boolean;
}
export interface MickeyDetailDTO extends MickeyListItemDTO {
  readonly clue2?: string;       // present only per hintGate
  readonly reveal?: string;      // present only per hintGate
  readonly tripId: string | null;
  readonly friendsFoundCount: number;
}
export interface MickeyProgressDTO {
  readonly mickeyId: string;
  readonly hintLevel: 1 | 2 | 3;
  readonly foundAt: string | null;
  readonly foundOn: string | null;   // YYYY-MM-DD, WDW calendar date
  readonly tripId: string | null;
}
export interface MickeyListPageDTO { readonly items: MickeyListItemDTO[]; readonly nextCursor: string | null; }
export interface MickeySummaryDTO {
  readonly overall: { total: number; found: number };            // Official only
  // park === null is the entry for Experiences with no owning park (resort-area Experiences).
  // overall is always the sum of these entries.
  readonly byPark: ReadonlyArray<{ park: Park | null; total: number; found: number }>;
  readonly community: { found: number };
}
export interface MickeySubmissionDTO {
  readonly id: string; readonly status: MickeyStatus; readonly official: boolean;
  readonly communityVerified: boolean; readonly clue1: string;
  readonly experienceName: string; readonly reviewNote: string | null; readonly createdAt: string;
}
export interface FriendMickeyFindDTO {
  readonly mickeyId: string; readonly clue1: string; readonly official: boolean;
  readonly experienceId: string; readonly experienceName: string; readonly park: Park | null;
  readonly foundOn: string;
}
export interface FriendMickeyFindsPageDTO { readonly items: FriendMickeyFindDTO[]; readonly nextCursor: string | null; }
export interface TripMickeysDTO {
  readonly members: ReadonlyArray<{ userId: string; displayName: string; avatarPreset: string | null; count: number }>;
  readonly mickeys: ReadonlyArray<{ mickeyId: string; clue1: string; official: boolean; experienceName: string; foundByCount: number }>;
}
export interface MickeyClientConfigDTO { readonly enabled: boolean; readonly submissionsEnabled: boolean; }
```

Zod schemas (`schemas/Mickeys.ts`): `mickeyListQuerySchema`, `mickeyHintBodySchema` (`level` is `z.union([z.literal(2), z.literal(3)])`), `mickeyFindBodySchema`, `mickeyVoteBodySchema`, `mickeyReportBodySchema`, `mickeySubmissionBodySchema`. Each is `.strict()`.

### Dispositions registry (account deletion)

New columns referencing `users(id)`, each needing an entry in `accountDeletion/dispositions.ts`:

| Table.column | Disposition |
|---|---|
| `hidden_mickeys.submitter_id` | `nullify` |
| `mickey_progress.user_id` | `delete` |
| `mickey_still_there_votes.user_id` | `delete` |
| `mickey_reports.user_id` | `delete` |
| `mickey_submission_bans.user_id` | `delete` |

**Read `dispositions.ts` and `dispositions.test.ts` first**: the registry's entry shape, the `today` field and the explicit lists in that test determine exactly what to add, and the test `registry table.column set equals the set parsed from REFERENCES users(id)` fails the suite until every new column has an entry. `mickey_progress` and its siblings have composite keys, so check how existing composite-key tables such as `experience_favorites` are registered and chunked.

## Configuration & Constants

All variables are read in `apps/api/src/config.ts`, validated with Zod, and surfaced as `config.mickeys`.

| Variable | Default | Meaning |
|---|---|---|
| `MICKEYS_ENABLED` | `true` | Master kill switch for every route |
| `MICKEYS_SUBMISSIONS_ENABLED` | `true` | Submissions on or off |
| `MICKEYS_SUBMISSION_MODE` | `publish` | `publish`: a screened submission goes live at once. `review`: every submission waits as `pending` for the Operator. A safety valve if abuse appears |
| `MICKEYS_TEXT_SCREEN_ENABLED` | `true` | Text harm check on submissions. Needs `PHOTO_HARM_API_KEY` |
| `MICKEYS_SUBMISSIONS_PER_DAY` | `5` | Trailing 24 hours, per User |
| `MICKEYS_REPORT_AUTOHIDE` | `3` | Counted_Reports before soft-hide |
| `MICKEYS_COMMUNITY_VERIFIED_MIN` | `3` | Distinct other `there` voters for the badge |
| `MICKEYS_CONFIDENCE_PRIOR_VALUE` | `0.9` | Prior mean |
| `MICKEYS_CONFIDENCE_PRIOR_WEIGHT` | `3` | Prior weight in vote units |
| `MICKEYS_CONFIDENCE_HALF_LIFE_DAYS` | `90` | Vote half-life |
| `MICKEYS_CONFIDENCE_CONFIRMED_MIN` | `0.65` | Label threshold |
| `MICKEYS_CONFIDENCE_UNCERTAIN_MIN` | `0.4` | Label threshold |

Startup validation (Requirement 14.2): if `MICKEYS_SUBMISSIONS_ENABLED` and `MICKEYS_SUBMISSION_MODE=publish`, then `MICKEYS_TEXT_SCREEN_ENABLED` must be true and `PHOTO_HARM_API_KEY` must be set; otherwise startup fails with a message naming the variable. Numeric variables use the same lenient-parse-with-default helper as the `PHOTO_*` numbers (`permissivePhotoNumber`), and an out-of-range value falls back to its default.

Credentials are reused: the text check uses `PHOTO_HARM_API_KEY`, `PHOTO_HARM_BASE_URL`, `PHOTO_HARM_MODEL` and `PHOTO_HARM_TIMEOUT_MS`. No new secret is introduced. `PHOTOS_ENABLED` is not required.

Hosting: no background worker, no cron, no Redis use, no polling. Storage is bounded as in Requirement 14.5.

## External Interfaces

### OpenAI text moderation (`mickeys/adapters/openaiTextScreen.ts`)

- **Endpoint:** `POST {PHOTO_HARM_BASE_URL}/v1/moderations`, header `Authorization: Bearer PHOTO_HARM_API_KEY`, body `{ "model": PHOTO_HARM_MODEL, "input": "<clue1>\n<clue2>\n<reveal>" }`. This is the endpoint `photos/adapters/openaiHarmModerator.ts` already calls (its test asserts `https://api.openai.com/v1/moderations`); the photo adapter sends an image input, this one sends a string.
- **Response field relied on:** `results[0].flagged` (boolean). The adapter does not use category scores.
- **Outcome mapping:** HTTP 2xx with a boolean `flagged` is `{ kind: 'ok', flagged }`. 401, 403, 429, 5xx, a timeout (`PHOTO_HARM_TIMEOUT_MS`), a network error and a malformed body are `{ kind: 'retryable', code }`. There is no automatic retry inside the adapter: a retryable result makes the submission `pending` for the Operator (Requirement 6.4), which is the safe fallback.
- **Verify at task time:** that `omni-moderation-latest` accepts a plain string `input`. The photo adapter's request body shape is the reference; confirm against the OpenAI moderation documentation before relying on it.
- **Not covered by this check:** spam, advertising, links, off-topic content and restricted-area locations. The URL and email rule (`containsUrlOrEmail`) covers links; reports and the Operator cover the rest.

### ID mapping

`hidden_mickeys.experience_id` is `experiences.id` (a UUID derived from the Disney entity id). The seed file refers to Experiences by `upstream_entity_id` (the Disney `Enterprise_Id`, for example `"362428;entityType=restaurant"`) or by exact `name` and `park`, where a null `park` means a resort-area Experience (`experiences.park` is nullable, per migration `0004`). Live data (ThemeParks.wiki) is not used by this feature.

**Alias_File** (`apps/api/data/mickey-aliases.json`, passed with `--aliases`): a JSON array of `{ "aliasUpstreamEntityId": "...", "canonicalUpstreamEntityId": "..." }`, both resolved by exact `experiences.upstream_entity_id`. Confirmed in the dev catalog on 2026-11-06, the first entry of the file:

```json
[
  { "aliasUpstreamEntityId": "412010036;entityType=Attraction", "canonicalUpstreamEntityId": "80010161;entityType=Attraction" }
]
```

That is *Living with the Land – Glimmering Greenhouses* (alias) linked to *Living with the Land* (canonical); both rows were `active = true`. *Jingle Cruise* (`412010035;entityType=Attraction`) also exists as its own Experience, but its base Experience was **not** confirmed, so it is not in the file until the owner looks it up (Open Item 6). A holiday overlay that the catalog does not list as a separate Experience (*Haunted Mansion*, one row) needs no link.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of the system. Properties are the bridge between the requirements and the machine-checkable tests below.*

### Property 1: Spoiler gating

*For any* Hidden_Mickey and any Progress_Row (or none), every list item contains no `clue2` or `reveal`; the detail contains `clue2` iff Hint_Level is at least 2 or the User has a Find, and `reveal` iff Hint_Level is 3 or the User has a Find.

**Validates: Requirements 2.3, 3.2**

### Property 2: Hint level is monotonic

*For any* sequence of hint requests with levels in {2, 3} on one Progress_Row, the stored `hint_level` after each request equals the maximum of 1 and all levels requested so far, and never decreases. Undoing a Find does not lower it.

**Validates: Requirements 3.3, 3.4, 4.6**

### Property 3: Find idempotence

*For any* sequence of find requests on one `(User, Hidden_Mickey)`, there is exactly one Progress_Row and `found_at` equals the first request's time. The trip link is set only while it is null.

**Validates: Requirements 4.1, 4.2**

### Property 4: Undo clears exactly the find state

*For any* Progress_Row with a Find and a vote, with or without a `trip_id`, undoing the Find (one `UPDATE`) leaves `hint_level` unchanged, nulls `found_at`, `found_on` and `trip_id`, and removes the vote. A second undo changes nothing.

**Validates: Requirements 4.5, 4.6**

### Property 5: Progress summary invariants

*For any* set of Hidden_Mickeys (every Status, both Official values, every Confidence_Label, on Experiences with and without an owning park, active and inactive) and any Progress_Rows: `found <= total` for every entry and overall; only approved Official Hidden_Mickeys contribute to `total` and `found`; `total` is independent of every Confidence_Label, of every Experience's `active` flag and of the viewer's own Reports on Official entries, so two Users with different Progress_Rows see the same `total` for the same park, and finding a Hidden_Mickey never changes `total`; Hidden_Mickeys on Experiences with a null `park` are all counted in the single `park: null` entry; overall equals the sum of the entries; `community.found` equals the User's Finds on approved Community Hidden_Mickeys.

**Validates: Requirements 2.5, 2.6, 2.7, 2.8**

### Property 6: Community entries never move the official total

*For any* User and any state, adding, finding, voting on, reporting, hiding or retiring a Community Hidden_Mickey leaves that User's `overall` and every `byPark` entry unchanged; promoting a Community Hidden_Mickey raises exactly one entry's `total` by one (and its `found` by one if the User found it) and changes nothing else. Reporting an Official Hidden_Mickey, by any number of Users, changes no User's `overall` or `byPark` entry, including the reporter's.

**Validates: Requirements 2.7, 8.4**

### Property 7: Still-there confidence

*For any* set of votes: Confidence is in [0, 1]; with no votes it equals the prior value; adding a `gone` vote never raises Confidence and adding a `there` vote never lowers it; for two otherwise identical vote sets, aging a vote moves Confidence toward the prior value and never away from it; `confidenceLabel` partitions [0, 1] into three contiguous, non-overlapping ranges ordered `possibly_removed` < `uncertain` < `confirmed`; and at the default parameters one fresh `gone` vote leaves the label `confirmed` while four fresh `gone` votes make it `possibly_removed`.

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 8: One vote per user

*For any* sequence of votes by one User on one Hidden_Mickey, exactly one Still_There_Vote row exists and equals the last vote; a Find sets it to `there`.

**Validates: Requirements 4.4, 5.1**

### Property 9: Community verified derivation

*For any* Hidden_Mickey, votes and submitter: `communityVerified` is true iff it is Community, its label is not `possibly_removed`, and the count of distinct Users other than the submitter with a `there` vote is at least `MICKEYS_COMMUNITY_VERIFIED_MIN`; it is false for every Official Hidden_Mickey; the submitter's own votes never contribute.

**Validates: Requirements 5.5, 6.6**

### Property 10: Visibility

*For any* Hidden_Mickey whose Status is `pending`, `rejected`, `retired` or `hidden`, it appears in no list, summary count, detail, Friend find list or Trip tally returned to a User, other than the submitter's own `GET /me/mickeys/submissions`; a Hidden_Mickey a User has reported is absent from that User's list but unchanged for every other User; for a Community Hidden_Mickey it is also absent from that User's `community.found`, while for an Official one the reporter's `total` and `found` are unchanged.

**Validates: Requirements 1.6, 2.4, 2.8, 7.2, 10.2, 11.1**

### Property 11: Status transitions

*For any* `(from, to)` pair, `canTransition` is true exactly for pending to approved, pending to rejected, approved to retired, retired to approved, approved to hidden, hidden to approved and hidden to retired. A rejected transition leaves the row unchanged. The database `CHECK` ties `hidden_reason` to the `hidden` Status.

**Validates: Requirements 1.3, 8.3**

### Property 12: Submission policy

*For any* submission input, counts, mode and screen outcome: a submission is accepted iff its fields satisfy the bounds and closed sets, contain no URL or email address, the text screen did not flag it, its Experience exists (the `active` flag is not consulted), the trailing-24-hour count is below `MICKEYS_SUBMISSIONS_PER_DAY`, and the User is not banned; an accepted submission creates exactly one Hidden_Mickey with Source `user` and Official false, Status `approved` iff mode is `publish` and the screen passed, otherwise `pending`; and it creates exactly one Progress_Row with a Find and exactly one `there` vote for the submitter. A flagged or rejected submission creates no row of any kind.

**Validates: Requirements 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8**

### Property 13: Report soft-hide

*For any* sequence of Reports on one approved Hidden_Mickey by various Users: a repeated Report by the same User changes nothing; a **Community** Hidden_Mickey becomes `hidden` iff the number of distinct Users with an open Report and at least one Find on any Hidden_Mickey reaches `MICKEYS_REPORT_AUTOHIDE`; an **Official** Hidden_Mickey stays `approved` for any number of Reports from any number of Users, is hidden from each reporter's own list only, and appears in the Operator's report section; Reports from Users with no Find are stored but never counted; a submitter's Report on their own entry is rejected; hiding deletes no Progress_Row and no vote; after the Operator restores it, its Reports are `dismissed` and do not count again.

**Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6**

### Property 14: Promotion

*For any* Hidden_Mickey, promotion succeeds iff it is approved and Community; it sets Official true and `promoted_at` and changes no other column; promoting an Official or non-approved Hidden_Mickey is rejected without a change.

**Validates: Requirements 8.4**

### Property 15: Seed import is idempotent

*For any* Seed_File, importing it twice yields the same set of `hidden_mickeys` rows as importing it once; every inserted row is Official with Source `seed`; entries with duplicate `seedKey` collapse to the first; entries whose Experience resolves to zero or several rows insert nothing; an existing `seedKey` is never modified; a null-park entry matches only a null-park Experience; an entry with a `photoUrl` (any string up to 2048 characters, including one that is not a URL) parses as valid, produces a parsed entry with no `photoUrl` key, and imports to a row identical to the same entry without it; an entry with an unknown field, or a `photoUrl` that is not a string or exceeds 2048 characters, is reported as invalid.

**Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.10**

### Property 16: Friend and Trip read gating

*For any* requester and target, a Friend finds or summary read succeeds iff the requester is the target or an active Friend, with identical `profile_forbidden` otherwise; a Trip tally read succeeds iff the requester is a current Trip_Member, with identical `trip_forbidden` for a non-member and for a non-existent Trip. Neither response contains `clue2` or `reveal`.

**Validates: Requirements 10.1, 10.2, 10.3, 11.2, 11.4**

### Property 17: Trip tally counts

*For any* Trip, members and Progress_Rows, each member's `count` equals the number of distinct approved Hidden_Mickeys with a Find by that member and `trip_id` equal to the Trip; a member who leaves the Trip drops out of the result on the next read; a Find without a `trip_id`, or with another Trip's id, counts toward no other Trip.

**Validates: Requirements 11.1, 11.3**

### Property 18: Trip link authorization

*For any* find request with a `tripId`, the request succeeds iff the User is a Trip_Member of that Trip; otherwise nothing is created or changed.

**Validates: Requirements 4.2, 4.3**

### Property 19: Account deletion

*For any* User with Progress_Rows, votes, Reports, a ban and Submissions, after the User is purged none of their Progress_Rows, votes, Reports or ban remain, their Submissions remain with `submitter_id` null, and the dispositions registry contains an entry for every column referencing `users(id)` added by migration `0072`.

**Validates: Requirements 9.3, 15.1, 15.2**

### Property 20: Submitter ban

*For any* banned User, a submission request is rejected with `mickey_submissions_banned` and creates nothing; banning hides every approved Community Hidden_Mickey of that submitter (`hidden`, reason `operator`) and no other Hidden_Mickey; lifting the ban restores nothing automatically.

**Validates: Requirements 6.8, 8.6**

### Property 21: Experience groups

*For any* set of alias links accepted by `validateAliasLinks`, any Hidden_Mickeys and any requested Experience: `GET /mickeys?experienceId=X` returns exactly the approved Hidden_Mickeys stored on a member of X's group, so the request for an alias and the request for its canonical return the same items; an unlinked Experience's group is itself; links are one hop (a Hidden_Mickey stored on an alias is returned for the canonical and for the alias, but a link is never followed from a canonical); `validateAliasLinks` rejects a self link, an alias that is already a canonical, a canonical that is already an alias, and a second link for the same alias, in the stored set and within one file; a Submission naming an alias is stored on its canonical; each Hidden_Mickey is counted once in the summary under the park of the Experience it is stored on, and adding or removing a link changes no User's `total` or `found`; the SQL result equals the `groupOf` model.

**Validates: Requirements 2.1, 6.1, 12.8, 16.1, 16.2, 16.3, 16.5**

### Property 22: Catalog independence

*For any* Hidden_Mickey and any value of its Experience's `active` flag (and any change of that flag), the Hidden_Mickey's visibility in the list, detail, summary, Friend finds and Trip tally, and its eligibility for a find, hint, vote, report or Submission, depends only on its Status; flipping `active` changes no count and no response, and the Operator's review list contains an approved Hidden_Mickey iff no Experience in its group is active, while changing nothing.

**Validates: Requirements 2.6, 8.9, 16.4**

### Property 23: Zone filter

*For any* set of approved Hidden_Mickeys, any `zone` and any combination of the other filters: the returned items are exactly those matching every supplied filter whose Zone equals `zone`; no `zone` returns the same items as before the filter existed; pagination over a filtered list returns every match once and no non-match, and a filtered page that is not the last is never short.

**Validates: Requirements 2.1, 2.2**

### Property 24: Venue grouping and area summary resolution

*For any* list of `MickeyListItemDTO` items and any `MickeySummaryDTO`: grouping items by venue (`groupMickeysByVenue`) partitions the list by `experienceId` preserving first-seen venue order and within-venue item order, the sum of group item lengths equals the input length, each group's `foundCount` equals the number of items in that group with `found === true`, and each sub-item's `indexInVenue` / `totalInVenue` satisfies `1 <= indexInVenue <= totalInVenue === group.items.length`; and resolving the active summary (`resolveActiveAreaSummary`) returns `overall` for `'All'`, the matching `byPark` entry for a `Park`, and the `park === null` entry for `'Resort'`, with `percent` clamped to `[0, 100]` (`0` when `total === 0`).

**Validates: Requirements 2.5, 13.10**

## Error Handling

New `ErrorCode` entries in `packages/shared/src/errors.ts`, with HTTP statuses in the same file's status map:

| Code | HTTP | When |
|---|---|---|
| `mickey_not_found` | 404 | Unknown or non-approved Hidden_Mickey id |
| `mickey_text_rejected` | 400 | A URL or email address in the text, or the text check flagged it |
| `mickey_submission_limit` | 429 | Daily cap reached |
| `mickey_submissions_banned` | 403 | The User is banned from submitting |
| `mickey_feature_disabled` | 503 | `MICKEYS_ENABLED` or `MICKEYS_SUBMISSIONS_ENABLED` false |

Existing codes are reused: `validation_failed`, `trip_forbidden`, `profile_forbidden`.

Behavioral rules:

- **The text check failing never publishes unscreened text.** A retryable outcome makes the Submission `pending` (visible to the Operator only) and the response tells the submitter it is waiting for review.
- **Flagged text is not stored.** A flagged Submission creates no row, so harmful text is never persisted; the response is `mickey_text_rejected`.
- **Submission is one transaction.** The Hidden_Mickey, the submitter's Progress_Row and the `there` vote are created together or not at all.
- **Report auto-hide is a conditional update** (`WHERE status = 'approved' AND official = FALSE`), so concurrent reports and concurrent Operator actions cannot produce an invalid Status.
- **Admin errors** render as the existing admin console error page; a mutation from the wrong Status responds with a plain "not allowed from this status" page and changes nothing.
- **Logging:** structured events (`mickey_find`, `mickey_submission`, `mickey_report`, `mickey_admin_action`) at info level carry ids and outcomes only. Clue text, Reveal, report notes and review notes are never logged at info or above (Requirement 15.3).

## Testing Strategy

The repo's dual approach applies: property tests for pure modules, pg-mem repo tests for SQL, `server.inject` for routes, and `@testing-library/react-native` for screens. Property tests use `fast-check`, at least 100 runs, tagged `// Feature: hidden-mickeys, Property N: <text>`.

**Pure modules** (`mickeys/domain/__tests__/`): Properties 1, 2 (model), 5, 7, 9 (derivation part), 11, 12 (policy part), 13 (policy part), 15 (parse part), 21 (model: `canonicalOf`, `groupOf`, `validateAliasLinks`).

**Repo** (pg-mem; load `0001_init.sql` through `0072`, the same fixtures other repos use): Properties 2, 3, 4, 5 (SQL side), 6, 8, 10, 12 (creation side, including that a flagged submission leaves no row), 13 (counting query, conditional hide, restore dismisses), 14, 15 (insert idempotence), 17, 18, 20, 21 (SQL equals the `groupOf` model; alias submissions land on the canonical; the summary is unchanged by a link), 22 (a Hidden_Mickey on an `active = false` Experience is still listed, counted, findable and votable; the review list), 23, and `migration0072.test.ts` asserting columns, `CHECK`s (`chk_hm_seed_official`, `chk_hm_hidden_reason`, `chk_mp_trip_needs_find`, `chk_mea_distinct`, text bounds), the alias table's primary key and both cascades, the unique `seed_key` partial index, every cascade and `SET NULL`, and that no existing table changed. Regression tests read rows back to assert the dropped-column class of bug cannot occur (for example `found_on` and `trip_id` are persisted by the find SQL, and `official`/`promoted_at` by promotion).

**Routes** (`server.inject`, fake ports): the 401 gate on every route; the happy path and at least one validation or error path per route; spoiler gating through the real handlers; `trip_forbidden` collapsing; `profile_forbidden`; each error code in the table above; kill switches; publish and review modes; static-before-parametric route order (`/mickeys/summary` is not captured by `/mickeys/:id`).

**Adapter:** `openaiTextScreen` with an injected `fetchFn`, as `openaiHarmModerator.test.ts` does: request URL, bearer header and body shape, flagged and unflagged parse, malformed body, 401 and 429 and 5xx mapping, timeout. A guard test for `services/mickeys/` mirrors `photos.guards.test.ts` (provider names and secret-shaped strings only inside `adapters/`).

**Account deletion:** extend the dispositions registry and rely on the existing schema-completeness property; add a purge test for Property 19.

**Mobile** (Jest, `jest-expo`, mock only the network layer): for each screen, drive each interaction and assert both the request (endpoint, payload) and the visible result. `HiddenMickeyDetail`: hint then reveal (two requests, text appears), find (optimistic flip and rollback on failure), undo, trip chip default and selection, vote, report (reason picker, request, entry disappears from the list), Community and Community verified badges. `HiddenMickeys`: progress and list, each filter changing the request params (including each Zone pill sending `zone`, and "All" sending none), the Official and Community switch, the Resorts tab, and a `possibly_removed` entry showing its warning badge while the park total stays unchanged. `SubmitMickey`: duplicate list shown, validation, URL rejection message, success, limit error, rules copy visible. `MySubmissions`: statuses and review note. Entry points: the `ExperienceDetail` card and quiet link, the Explore hub entry, the Vault card, the Trip tally section and its empty state, the Friend profile section. The theme guard (`themeRetrofit.guard.test.ts`) must pass with no allowlist change.

**Coverage and the behavior-to-test map:** per `execution-discipline.md`, the final report includes the map of every added behavior to its test and assertion, and the literal tail of `npm run verify`.

## Open Items to Verify at Task Time

These were not confirmed while writing the spec. Each task that depends on one says so.

1. That the OpenAI moderation endpoint accepts a plain string `input` with the model in `PHOTO_HARM_MODEL` (Task 5.1).
2. The shape of `dispositions.ts` entries, the `today` field, and how composite-key tables are registered (Task 9.1).
3. The root-stack registration pattern and tab route names in `RootNavigator.tsx`, and where the Friend profile screen composes its sections (Tasks 10.1, 10.7).
4. Whether `ExploreHubScreen`, `CollectionScreen` and `TripDetailScreen` follow a section-composition pattern the new cards should copy (Tasks 10.6 to 10.8).
5. The wording of Apple's user-generated-content guideline against the controls in Requirement 15.4; the requirement was written from developer-forum reports and a checklist article, not the guideline text.
6. Which other seasonal variants the catalog lists as separate Experiences, and their base Experiences (Task 8.4). Only Living with the Land and Glimmering Greenhouses was confirmed (dev catalog, 2026-11-06). Look up Jingle Cruise's base and any Halloween or holiday variants before filling `mickey-aliases.json`, and check whether the sync ever deactivates the base while the variant is listed (the design does not depend on the answer, because `active` is not consulted).
