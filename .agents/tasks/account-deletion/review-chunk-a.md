# Account-deletion repository: claim, trip resolution, purge stages and finalize (chunk A, tasks 6.1-6.6 and checkpoint 7)

This chunk finishes the SQL layer of account deletion: the bounded `softDeleteByOwner(limit)` photo extension, the fenced claim and counter writes, per-trip resolution in one transaction, the tombstone/anonymize/scrub/enqueue/delete/finalize stages, and a pg-mem test suite that reads rows back for every registry row. `repo.ts` already existed from the earlier pass and matches design.md "Repo surface", "Purge claim SQL", "Trip resolution at purge" and "Purge procedure". The coder added the missing tests, a test-side stage driver, and a pg-mem harness that rewrites two constructs pg-mem mishandles. Verification evidence is one `npm run verify:api` run (3848 passed, exit 0) plus per-file loops, which is the scoped tier the discipline asks for at a checkpoint.

Watch for: one test title claims an orphan-reaper assertion that is not written (confirmed); the composite-key `per_key` statements are only exercised with one tuple per table (likely); the Postgres-only behaviours (concurrent `SKIP LOCKED`, `ANY(ARRAY(... FOR UPDATE SKIP LOCKED))`, parameter typing) are invisible to pg-mem and already sit on the operator smoke list.

**Verdict**: APPROVED

## High-level view

The repo SQL is correct against the disposition registry and the design's trip order: trip row locked first, roster read second in its own statement, plan computed from those rows, photos soft-deleted on the same client before the trip delete, and the fenced counter update inside the same transaction with a rollback on a lost claim. Every write to a `purge_*` column carries the claim predicate; chunk statements are unfenced and idempotent as designed.

Every registry row has a seeded subject and bystander and is read back after the purge path; whole-purge residue, money, report-count and bounded-run tests run over a graph seeded from every registry table; the two fast-check properties (9 and 31) run 100 times and carry the `// Feature: account-deletion, Property N` tag. The weak spots are small: one overclaiming title, tautological count assertions, and single-tuple coverage of the composite-key path.

The photos extension is additive and adds no account-deletion wording to any file the photos guard scans.

<details>
<summary>Issues (5)</summary>

1. **Orphan-reaper assertion missing** (confirmed) — `repo.stages.test.ts` "stage 4 nulls owner_id..." says "and the orphan reaper query does not" but only asserts `listDeleted`. Add `createPhotosRepo(w.pool).findOwnerNullOrphanIds(...)` returning `[]` (the query filters `status <> 'deleted'`, so it will pass), or drop the clause from the title. Design Testing Strategy lists it under "Photo owner nulling".
2. **Composite-key `per_key` path under-tested** (likely) — every `describe.each` case seeds one row, so the six multi-column-key entries run one tuple; the Property 17 bound test only uses single-key tables. Add a case with several tuples for one composite-key table (for example `trip_reactions`) to prove the loop-until-empty over tuples.
3. **`ON CONFLICT` batch not explicitly deduped** (confirmed, low) — `enqueueRatedChunk` relies on the `ratings` PK `(user_id, experience_id)` for distinct ids. Sufficient today; a `new Set(ids)` or a comment naming the PK would make the 21000 rule self-evident.
4. **Tautological assertions** (confirmed, harmless) — `covered.size === DISPOSITIONS.length` and `fixtures.size === DISPOSITIONS.length` hold by construction, and "fresh account purged within two runs" asserts `toContain(true)` and then the same fact again. Trim or tighten when next touched.
5. **Unrelated edits in the tree** (confirmed) — `db/pool.ts` (idle-client error listener, `keepAlive`) with `db/__tests__/pool.test.ts`, and the `.kiro/specs/*/requirements.md` edits, are not part of this chunk. Commit them separately.

</details>

<details>
<summary>Details</summary>

### Rollback emulation carries the atomicity tests

pg-mem's `ROLLBACK` does not undo, so the harness snapshots the database on `BEGIN` and restores on `ROLLBACK`. Three trip tests depend on it: a throwing `afterTripLocked` seam, a photo step that throws after marking, and a lost claim. Each asserts the photo row is still `approved` and the trip still exists, which would fail if the photo call used the pool instead of the transaction client. The statement-order assertions (BEGIN, trip lock, roster read, photo update, trip delete, COMMIT) pin Property 30 directly, and the roster-change seam test pins the race the design describes.

### What pg-mem cannot tell us

The harness rewrites `IN (SELECT ... LIMIT $n)` and `= ANY(ARRAY(SELECT ... LIMIT $n))` by running the bounded subselect first and substituting a parameter list. That matches Postgres semantics, but the claim's `ANY(ARRAY(... FOR UPDATE SKIP LOCKED))` shape and the bounded `per_key` selects are therefore tested through a rewrite, not as written. Recorded statement text is the original, so the text assertions stay honest. Concurrent locking, the `$1::uuid`/`$2::text` typing in the tombstone insert, and the multi-row `VALUES` enqueue are Postgres-only and are named in design.md's operator smoke list and in code-status "Not verified". Nothing in this chunk's SQL contradicts them, but nothing here proves them either.

### Evidence

`code-status.md` carries inner-loop counts, the `verify:api` tail with exit 0, a behavior-to-test map whose rows I spot-checked against the test files, and a "Not verified" list. It does not state outright that no registry row lacks a test; I confirmed that structurally (the `describe.each` blocks cover all six `Disposition` values and the residual test seeds every entry). I did not re-run any suite and found no `TODO`, `.skip`, `.only`, stray script or generated file in the accountDeletion tree.

</details>

## File map

<details>
<summary>Files reviewed</summary>

- `apps/api/src/services/accountDeletion/repo.ts` — claim, fencing, trip resolution, tombstone, anonymize, scrub, enqueue, delete/nullify, finalize, drain (earlier pass; read in full)
- `apps/api/src/services/accountDeletion/__tests__/helpers.ts` — pg-mem harness: recording pool, snapshot transactions, subselect and `ANY` rewrites, schema-driven seeder
- `apps/api/src/services/accountDeletion/__tests__/world.ts` — seeded people, per-registry-row fixtures, realistic share payloads
- `apps/api/src/services/accountDeletion/__tests__/purgeDriver.ts` — test-side stage driver written from the design
- `apps/api/src/services/accountDeletion/__tests__/repo.claim.test.ts` — claim, fencing, counters, attempts, claim order (property, 100 runs)
- `apps/api/src/services/accountDeletion/__tests__/repo.trips.test.ts` — trip resolution, seam and atomicity tests, Property 9 (100 runs)
- `apps/api/src/services/accountDeletion/__tests__/repo.stages.test.ts` — one test per registry row, photos stage, share scrub, queue drain, idempotence
- `apps/api/src/services/accountDeletion/__tests__/repo.tombstone.test.ts`, `repo.enqueue.test.ts`, `repo.finalize.test.ts` — tombstone statement shape, chunked enqueue, finalize and ledger
- `apps/api/src/services/accountDeletion/__tests__/repo.purge.residual.test.ts` — whole-purge residue, money, reports, bounded run
- `apps/api/src/services/photos/repo.ts`, `service.ts` and their tests — bounded `softDeleteByOwner` and `deleteAllForUser({ limit })`
- `.kiro/specs/account-deletion/tasks.md` — 6.1 to 6.6 and 7 ticked

Full diff: `git diff` plus the untracked `apps/api/src/services/accountDeletion/` tree.

</details>
