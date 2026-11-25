# ParkHQ rename: baseline gate (unmodified worktree)

- Worktree: `c:/Users/knick/dev/disney-app/.worktrees/parkhq`
- Branch: `rename-parkhq`
- Commit: `9807a3f9ec79336b52c7caca44126a3e55fb5b85` (working tree clean before and after the run)
- Command: `npm run verify` (typecheck across all workspaces, then tests across all workspaces)
- Exit code: **0**

## Typecheck

`tsc -p tsconfig.json --noEmit` ran for `@dwt/api`, `@dwt/mobile` and `@dwt/shared`. No `error TS` lines in the output.

## Per-workspace test counts

| Workspace | Runner | Result |
|---|---|---|
| `@dwt/api` | vitest `--run --coverage` | Test Files 707 passed (707); Tests 5748 passed (5748) |
| `@dwt/mobile` | jest | Test Suites 400 passed (400); Tests 3388 passed (3388); Snapshots 2 passed (2) |
| `@dwt/shared` | vitest `--run` | Test Files 67 passed (67); Tests 961 passed (961) |

`@dwt/api` coverage report printed (planning thresholds met): Statements 96.01%, Branches 92.95%, Functions 95.83%, Lines 96.6%.

## Literal output tails

`@dwt/api`:

```
 Test Files  707 passed (707)
      Tests  5748 passed (5748)
   Start at  18:23:48
   Duration  146.86s (transform 70.14s, setup 0ms, import 1034.16s, tests 2560.88s, environment 197ms)
 % Coverage report from v8
All files     |   96.01 |    92.95 |   95.83 |    96.6 |
Statements   : 96.01% ( 337/351 )
Branches     : 92.95% ( 277/298 )
Functions    : 95.83% ( 23/24 )
Lines        : 96.6% ( 313/324 )
```

`@dwt/mobile`:

```
Test Suites: 400 passed, 400 total
Tests:       3388 passed, 3388 total
Snapshots:   2 passed, 2 total
Time:        147.296 s
Ran all test suites.
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept
running after all tests finished?
```

`@dwt/shared`:

```
> @dwt/shared@0.0.0 test
> vitest --run
 RUN  v4.1.10 C:/Users/knick/dev/disney-app/.worktrees/parkhq/packages/shared
 Test Files  67 passed (67)
      Tests  961 passed (961)
   Start at  18:28:46
   Duration  3.42s (transform 15.83s, setup 0ms, import 46.58s, tests 4.96s, environment 13ms)
```

Final shell exit code: `0`

## Notes

- The log contains pino JSON error/warn lines (e.g. `Sampling pass failed fatally`, `relation "wait_archive" does not exist`, `idle pg client error`) and a jest "worker process has failed to exit gracefully" message. They are expected test noise from error-path tests; no test failed.

## Verdict

**GREEN**: baseline `npm run verify` exits 0 with every workspace passing before any rename change.
