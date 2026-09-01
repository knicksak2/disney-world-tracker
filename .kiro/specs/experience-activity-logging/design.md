# Design Document

## Architecture Overview

Experience Activity Logging establishes a clean separation between **User Activity Streams** and **Trip Membership Linkages**:

1. **User-Scoped Activity Stream (`experience_logs`)**: Captures every individual visit/ride event with its specific timestamp, calendar date (`visited_on`), optional per-visit rating (1–10), and optional visit note. It is trip-agnostic and permanent to the user's account.
2. **Trip Log Entries (`trip_log_entries`)**: Links an `experience_logs` record to a specific `Trip` via `log_id UUID NOT NULL REFERENCES experience_logs(id) ON DELETE CASCADE`.
   - **Trip Deletion Cascade:** When a Trip is deleted, `trip_log_entries` rows are removed via the existing `trip_id REFERENCES trips(id) ON DELETE CASCADE` (migration 0015), leaving the user's lifelong `experience_logs` records completely intact.
   - **Log Deletion Cascade:** When an `experience_logs` record is deleted, the referencing `trip_log_entries` row is cascaded away via `log_id REFERENCES experience_logs(id) ON DELETE CASCADE`.
   - **Redundancy & Read Preservation Invariant:** `trip_log_entries.member_id` and `trip_log_entries.experience_id` strictly mirror the linked `experience_logs.user_id` and `experience_logs.experience_id`. This intentional redundancy allows existing trip queries (`listLogEntries`, `getFeed`, `getSummary`) to execute with zero structural regressions.
3. **The Canonical Projection Layer (`completions`, `ratings`)**: Maintained synchronously. A new log automatically creates a row in `completions` (if first time), and a rated log updates the user's current canonical `ratings` row. Deleting a log never clobbers canonical ratings, and per-visit notes stay on the log only.

```
                           POST /me/experiences/:id/logs
                                         │
                                         ▼
                     ┌────────────────────────────────────────┐
                     │         Tracking_Service (logs)        │
                     │       (Single Read-Write Tx)           │
                     └───────────────────┬────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
  INSERT INTO experience_logs                     INSERT INTO completions (ON CONFLICT DO NOTHING)
  • user_id, experience_id                        • user_id, experience_id
  • visited_on, user_tz, logged_at                • completed_on = visited_on
  • rating, note                                  
                                                                 │ (if rating provided)
                 ┌───────────────────────┐                       ▼
                 ▼ (if trip_id provided) │        UPSERT INTO ratings
  INSERT INTO trip_log_entries           │        • user_id, experience_id, value
  • trip_id, member_id, experience_id    │
  • log_id = experience_logs.id          │
```

## Components and Interfaces

### Backend Structure (`apps/api/src/services/tracking/logs/`)
- `repo.ts`: `ExperienceLogRepo` interface providing:
  - `addLog(input: CreateLogInput): Promise<ExperienceLogDTO>`
  - `getVisitHistory(userId: string, experienceId: string): Promise<ExperienceVisitHistoryDTO>`
  - `deleteLog(userId: string, experienceId: string, logId: string): Promise<{ deleted: boolean; completionRemoved: boolean }>`
  - `confirmRodeWithLog(taggedMemberId: string, originatingLogId: string): Promise<ExperienceLogDTO>`
- `routes.ts`: Fastify routes mounted at `/me/experiences/:id/logs`.
- `composeServices.ts`: Composed under `tracking: { logs: { repo, requireSession }, completion, rating, note, friendCompletions }`.

### Mobile Structure (`apps/mobile/src/screens/catalog/`)
- `YourVisitCard.tsx`: Embeds visit count badge, "Log Visit / Ride Again" trigger button, and `VisitHistoryTimeline`.
- `LogVisitModal.tsx`: Modal sheet with date picker, 1–10 star slider, note input, and trip dropdown.
- `VisitHistoryTimeline.tsx`: Collapsible past visits list rendering dates, ratings, and notes.

## Data Models & Migration

### Migration `0034_experience_logs.sql`

```sql
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. experience_logs table
-- ---------------------------------------------------------------------------
CREATE TABLE experience_logs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id),
    visited_on     DATE         NOT NULL,
    user_tz        TEXT         NOT NULL,
    logged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rating         SMALLINT,
    note           TEXT,
    CONSTRAINT experience_logs_rating_range_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
    CONSTRAINT experience_logs_note_length_chk CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);

CREATE INDEX experience_logs_user_experience_idx 
    ON experience_logs(user_id, experience_id, visited_on DESC, logged_at DESC);

CREATE INDEX experience_logs_user_date_idx 
    ON experience_logs(user_id, visited_on);

-- ---------------------------------------------------------------------------
-- 2. Deterministic Backfill from trip_log_entries
-- ---------------------------------------------------------------------------
ALTER TABLE trip_log_entries ADD COLUMN log_id UUID;
UPDATE trip_log_entries SET log_id = gen_random_uuid();

INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
SELECT 
    le.log_id, 
    le.member_id, 
    le.experience_id,
    (le.created_at AT TIME ZONE 'America/New_York')::date,
    'America/New_York', 
    le.created_at
FROM trip_log_entries le;

-- Backfill completions not recorded in any trip so zero past completions are lost
INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
SELECT 
    gen_random_uuid(),
    c.user_id,
    c.experience_id,
    c.completed_on,
    c.user_tz,
    c.completed_on::timestamp AT TIME ZONE c.user_tz
FROM completions c
WHERE NOT EXISTS (
    SELECT 1 FROM experience_logs el 
    WHERE el.user_id = c.user_id AND el.experience_id = c.experience_id
);

-- ---------------------------------------------------------------------------
-- 3. Set NOT NULL and Foreign Key on trip_log_entries.log_id
-- ---------------------------------------------------------------------------
ALTER TABLE trip_log_entries ALTER COLUMN log_id SET NOT NULL;
ALTER TABLE trip_log_entries 
    ADD CONSTRAINT trip_log_entries_log_id_fkey 
    FOREIGN KEY (log_id) REFERENCES experience_logs(id) ON DELETE CASCADE;

COMMIT;
```

## Shared Contracts (`packages/shared/src/schemas/ExperienceLog.ts`)

```typescript
export interface ExperienceLogDTO {
  id: string;
  userId: string;
  experienceId: string;
  visitedOn: string; // YYYY-MM-DD
  userTz: string;
  loggedAt: string; // ISO-8601 UTC
  rating: number | null; // 1..10
  note: string | null;
}

export interface ExperienceVisitHistoryDTO {
  experienceId: string;
  repeatCount: number;
  logs: ExperienceLogDTO[];
}

export interface CreateExperienceLogInputDTO {
  visitedOn: string; // YYYY-MM-DD
  userTz: string;
  rating?: number | null; // 1..10
  note?: string | null;
  tripId?: string | null;
}
```

## Configuration & Constants

| Constant | Value | Purpose |
|---|---|---|
| `MAX_NOTE_LENGTH` | `2000` | Maximum character length for a visit note |
| `MIN_RATING` | `1` | Lowest valid rating score |
| `MAX_RATING` | `10` | Highest valid rating score |
| `DEFAULT_USER_TZ` | `'America/New_York'` | Default fallback IANA timezone for WDW visits |

## Error Handling

- `400 Bad Request`: Validation failure on invalid date, unparseable timezone string, rating outside 1..10, or note exceeding 2000 characters.
- `401 Unauthorized`: Unauthenticated request.
- `403 Forbidden`: Attempting to delete another user's log, or attempting to link to a trip the user is not a member of.
- `404 Not Found`: Experience ID does not exist or Log ID not found.

## Correctness Properties

### Property 1: Dual-Write Completion Invariant
*For any user and experience, inserting a new `experience_logs` record guarantees that `completions` contains exactly one matching `(user_id, experience_id)` record, and that subsequent repeat logs for the same experience do not produce duplicate completion rows.*
**Validates:** Requirement 1.1, Requirement 1.3, Requirement 2.1

### Property 2: Rated Log Canonical Update Invariant
*When a log is inserted with a non-null rating, the canonical `ratings` table row is updated to that rating. When an `experience_logs` row is deleted, the canonical `ratings` row remains untouched.*
**Validates:** Requirement 2.2, Requirement 5.3

### Property 3: Visit History Ordering and Repeat Count
*For any user and experience, `GET /me/experiences/:id/logs` returns `repeatCount === logs.length`, and every item in `logs` satisfies `logs[i].visitedOn >= logs[i+1].visitedOn` (with `loggedAt >= logs[i+1].loggedAt` as tie-breaker).*
**Validates:** Requirement 4.1, Requirement 4.2

### Property 4: Delete Cleanup & Trip Cascade Independence
*When an `experience_logs` record linked to a trip is deleted, the matching `trip_log_entries` row is cascaded away via `log_id`. When a Trip is deleted, the `trip_log_entries` row is deleted via `trip_id` while the underlying `experience_logs` record is preserved.*
**Validates:** Requirement 1.4, Requirement 5.1, Requirement 5.2

## Testing Strategy

- **Repository Property Tests (`apps/api/src/services/tracking/logs/__tests__/experienceLogs.prop.test.ts`)**:
  - `fast-check` (>=100 runs) testing Properties 1, 2, 3, and 4 against pg-mem.
- **Trip Cascade Integration Tests (`apps/api/src/services/trips/__tests__/cascadeDelete.integration.test.ts`)**:
  - Assert that deleting a trip deletes `trip_log_entries` while preserving `experience_logs`.
- **Fastify Route Integration Tests (`apps/api/src/services/tracking/logs/__tests__/routes.test.ts`)**:
  - Test authentication, date validations, trip permission check, and delete operations via `server.inject`.
- **Mobile Component Tests (`apps/mobile/src/screens/catalog/__tests__/YourVisitCard.logs.test.tsx`)**:
  - Render test for repeat count badge, modal trigger, query invalidations, and timeline rendering.
