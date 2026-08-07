/**
 * Pure derivation of an Experience's special-hours participation from its Disney
 * Sync Gateway Schedule_Channel blocks (disney-facilities-catalog-source R5.8).
 *
 * Disney's `wdw.today.1_0.{Type}` schedule document types each block under a
 * `scheduleType` (verified live: `Operating`, `Early Entry`,
 * `Special Ticketed Event`, `Performance Time`, `Closed`, `No Performance`,
 * `Refurbishment`; `Extended Evening` confirmed via the forward `wdw.calendar.1_0`
 * channel — EPCOT on 2026-08-10 carries a `scheduleType: "Extended Evening"`
 * block). A ride "operates during"
 * a window iff it carries a block whose normalized type is in that window's
 * token set. The result is a stable per-ride fact Catalog_Sync persists and
 * applies to future planning dates.
 *
 * Pure, total, and deterministic: tolerates missing/blank types and empty or
 * absent input (→ all `false`). Token normalization mirrors the live
 * projection's schedule handling (`liveProject.ts`) — uppercase, with spaces and
 * hyphens collapsed to underscores — so `"Early Entry"`, `"early-entry"`, and
 * `"EARLY_ENTRY"` all match.
 *
 * Validates: Requirements 5.8, 5.9
 */

/** Morning Early Entry / Extra Magic (a.k.a. Early Theme Park Entry) tokens. */
const EARLY_ENTRY_TYPE_TOKENS: ReadonlySet<string> = new Set([
  'EARLY_ENTRY',
  'EARLY_PARK_ENTRY',
  'EXTRA_MAGIC_HOURS',
  'EXTRA_MAGIC_HOUR',
]);

/** Late-night Extended Evening (Deluxe-guest) tokens. */
const EXTENDED_EVENING_TYPE_TOKENS: ReadonlySet<string> = new Set([
  'EXTENDED_EVENING',
  'EXTENDED_EVENING_HOURS',
]);

/** Paid after-hours / special ticketed event tokens. */
const TICKETED_EVENT_TYPE_TOKENS: ReadonlySet<string> = new Set([
  'SPECIAL_TICKETED_EVENT',
  'TICKETED_EVENT',
  'AFTER_HOURS',
]);

/**
 * A single schedule block. The real Sync Gateway document labels the type under
 * `scheduleType` (e.g. `"Early Entry"`, `"Operating"`); `type` is accepted too
 * so the live-projection `ScheduleEntry` shape also works.
 */
export interface ScheduleBlock {
  readonly scheduleType?: string;
  readonly type?: string;
}

/** Per-ride participation across the three special-hours windows. */
export interface SpecialHoursParticipation {
  readonly earlyEntry: boolean;
  readonly extendedEvening: boolean;
  readonly ticketedEvent: boolean;
}

/** Uppercase a raw schedule type and collapse spaces/hyphens to underscores. */
function normalizeType(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function hasBlockOfType(
  blocks: readonly ScheduleBlock[] | undefined | null,
  tokens: ReadonlySet<string>,
): boolean {
  if (!Array.isArray(blocks)) {
    return false;
  }
  for (const block of blocks) {
    const rawType = block?.scheduleType ?? block?.type;
    if (typeof rawType === 'string' && rawType.trim().length > 0) {
      if (tokens.has(normalizeType(rawType))) {
        return true;
      }
    }
  }
  return false;
}

/** `true` iff any block's normalized type is an Early Entry type. */
export function operatesDuringEarlyEntry(
  blocks: readonly ScheduleBlock[] | undefined | null,
): boolean {
  return hasBlockOfType(blocks, EARLY_ENTRY_TYPE_TOKENS);
}

/** Classify a ride's participation across all three special-hours windows. */
export function classifySpecialHours(
  blocks: readonly ScheduleBlock[] | undefined | null,
): SpecialHoursParticipation {
  return {
    earlyEntry: hasBlockOfType(blocks, EARLY_ENTRY_TYPE_TOKENS),
    extendedEvening: hasBlockOfType(blocks, EXTENDED_EVENING_TYPE_TOKENS),
    ticketedEvent: hasBlockOfType(blocks, TICKETED_EVENT_TYPE_TOKENS),
  };
}

/**
 * Parse a `wdw.today.1_0.{Type}` schedule document's `facilities` map (keyed by
 * `facilityId` = Enterprise_Id, each value a `ScheduleBlock[]`) into per-facility
 * special-hours participation. Pure and tolerant: a missing or malformed
 * `facilities` value yields an empty map.
 */
export function specialHoursByFacility(
  facilities: unknown,
): Map<string, SpecialHoursParticipation> {
  const result = new Map<string, SpecialHoursParticipation>();
  if (typeof facilities !== 'object' || facilities === null || Array.isArray(facilities)) {
    return result;
  }
  for (const [facilityId, blocks] of Object.entries(facilities as Record<string, unknown>)) {
    if (Array.isArray(blocks)) {
      result.set(facilityId, classifySpecialHours(blocks as ScheduleBlock[]));
    }
  }
  return result;
}
