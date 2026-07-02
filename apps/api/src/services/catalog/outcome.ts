/**
 * Catalog_Sync run-outcome mapping (`outcomeFromError`).
 *
 * A Catalog_Sync run ends either in `success` or in a failure that must be
 * recorded in `Sync_Run_History` with a discriminator drawn from the closed
 * `SyncRunOutcome` set (R12.6). This module owns the single, total translation
 * from a caught error (or an already-classified transport failure) into that
 * discriminator so an operator can tell an Akamai edge block (`waf_block`,
 * transient) apart from a credential failure (`auth_failure`, fatal) apart from
 * every other failure mode (R12.4, R12.5).
 *
 * The `Disney_Transport` raises a single typed error (`DisneyTransportError`)
 * carrying a `kind: DisneyFailureKind` discriminator. To avoid a hard build
 * ordering / circular dependency on the transport module, this mapper detects a
 * transport failure *structurally* — any error object exposing a `kind`
 * property whose value is a member of `DISNEY_FAILURE_KINDS` — rather than by
 * importing the `DisneyTransportError` class. This keeps the mapper a pure,
 * dependency-light function that both the transport and the orchestrator can
 * lean on.
 *
 * Mapping (total over all inputs):
 *   - `waf_block`        → `waf_block`         (R12.4)
 *   - `auth_failure`     → `auth_failure`      (R12.5)
 *   - `network`          → `network`           (pass-through)
 *   - `invalid_response` → `invalid_response`  (pass-through)
 *   - `aborted`          → `aborted`           (pass-through)
 *   - `http_status`      → `invalid_response`  (retired from the outcome set;
 *                                               design §5 / data model note)
 *   - any non-transport / unknown error → `invalid_response`
 *
 * The function is total (it never throws) and `waf_block` / `auth_failure`
 * never coincide: each transport `kind` maps to exactly one outcome, so a WAF
 * block and an auth failure are always recorded as distinct outcomes.
 *
 * Validates: Requirements 12.4, 12.5, 12.6
 */

import {
  DISNEY_FAILURE_KINDS,
  type DisneyFailureKind,
  type SyncRunOutcome,
} from '@dwt/shared';

/**
 * The set of transport failure kinds, materialized once for O(1) structural
 * membership checks. Backed by the closed-set tuple in `@dwt/shared` so it can
 * never drift from the transport's discriminator vocabulary.
 */
const TRANSPORT_FAILURE_KINDS: ReadonlySet<string> = new Set(
  DISNEY_FAILURE_KINDS,
);

/**
 * Map from a transport failure `kind` to the recorded `SyncRunOutcome`.
 *
 * Every member of `DISNEY_FAILURE_KINDS` has an entry, so the lookup is total
 * over the transport vocabulary. `http_status` is folded into
 * `invalid_response` because it is retired from the outcome closed set (design
 * §5): a Disney failure is always classified into `waf_block`, `auth_failure`,
 * or another transport kind, so a generic non-2xx no longer reaches
 * `Sync_Run_History`.
 */
const OUTCOME_BY_KIND: Readonly<Record<DisneyFailureKind, SyncRunOutcome>> = {
  waf_block: 'waf_block',
  auth_failure: 'auth_failure',
  network: 'network',
  invalid_response: 'invalid_response',
  aborted: 'aborted',
  http_status: 'invalid_response',
};

/**
 * Structural predicate: does `err` look like a `DisneyTransportError` (or any
 * error carrying a transport `kind`)? True iff `err` is a non-null object with
 * a string `kind` property whose value is a member of `DISNEY_FAILURE_KINDS`.
 *
 * Detecting structurally (rather than via `instanceof DisneyTransportError`)
 * keeps this module free of a dependency on the transport module and robust to
 * errors that cross a module/realm boundary.
 */
function hasTransportKind(err: unknown): err is { readonly kind: DisneyFailureKind } {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const kind = (err as { readonly kind?: unknown }).kind;
  return typeof kind === 'string' && TRANSPORT_FAILURE_KINDS.has(kind);
}

/**
 * Map a caught error (or a classified transport failure) to the
 * `SyncRunOutcome` recorded for a failed Catalog_Sync run.
 *
 * Total and never-throwing: a recognized transport failure maps by its `kind`;
 * any other value (a `DB` error, a plain `Error`, a string, `null`, etc.) maps
 * to `invalid_response` because the run could not produce a valid, applied
 * result and the closed set (R12.6) admits no generic failure code.
 *
 * @param err - the value thrown/caught by the orchestrator, of any shape.
 * @returns the closed-set outcome discriminator for `Sync_Run_History`.
 */
export function outcomeFromError(err: unknown): SyncRunOutcome {
  if (hasTransportKind(err)) {
    return OUTCOME_BY_KIND[err.kind];
  }
  return 'invalid_response';
}
