/**
 * Special-hours participation capture (disney-facilities-catalog-source R5.8, R5.9).
 *
 * Disney's Sync Gateway exposes today's per-ride schedule in a single document
 * `wdw.today.1_0.Attraction` whose `facilities` map is keyed by `facilityId`
 * (= Enterprise_Id) with a `ScheduleBlock[]` value (each block carries a
 * `scheduleType` such as `"Early Entry"` / `"Special Ticketed Event"` — verified
 * against the live gateway). For each attraction we derive whether it operates
 * during Early Entry, Extended Evening, and Special Ticketed Event windows.
 * Because participation is stable day-to-day, the captured flags are persisted
 * per Experience and applied to future planning dates.
 *
 * This runs as a best-effort step of Catalog_Sync: a fetch/parse failure leaves
 * the previously persisted flags unchanged and never fails the catalog run
 * (R5.9).
 */

import type { CatalogRepo } from '../repo.js';
import type { FacilitiesClient } from './facilitiesClient.js';
import { specialHoursByFacility } from './earlyEntry.js';

/** The single current-day schedule document holding every attraction's blocks. */
export const ATTRACTION_SCHEDULE_DOC_ID = 'wdw.today.1_0.Attraction';

export interface SpecialHoursCaptureDeps {
  /** Only the bulk document fetch is needed. */
  readonly client: Pick<FacilitiesClient, 'bulkGetDocuments'>;
  /** Only the special-hours updater is needed. */
  readonly repo: Pick<CatalogRepo, 'updateSpecialHoursParticipation'>;
  readonly logger?: { warn: (obj: unknown, msg?: string) => void; info?: (obj: unknown, msg?: string) => void };
}

/**
 * Capture per-ride special-hours participation from the Disney Schedule channel
 * and persist it. Returns the number of Experiences whose flags were written.
 * Never throws — a failure is logged and yields `{ updated: 0 }` (R5.9).
 */
export async function captureSpecialHours(
  deps: SpecialHoursCaptureDeps,
): Promise<{ updated: number }> {
  try {
    const docs = await deps.client.bulkGetDocuments([ATTRACTION_SCHEDULE_DOC_ID]);
    // The schedule doc is not a Facility_Document, but bulkGetDocuments preserves
    // the raw body, so `facilities` is present. Read it defensively.
    const facilities = (docs[0] as unknown as { facilities?: unknown } | undefined)?.facilities;

    const byFacility = specialHoursByFacility(facilities);
    if (byFacility.size === 0) {
      deps.logger?.warn({ docId: ATTRACTION_SCHEDULE_DOC_ID }, 'Special-hours capture: no facilities map in schedule doc');
      return { updated: 0 };
    }

    const entries = [...byFacility.entries()].map(([upstreamEntityId, p]) => ({
      upstreamEntityId,
      earlyEntry: p.earlyEntry,
      extendedEvening: p.extendedEvening,
      ticketedEvent: p.ticketedEvent,
    }));

    await deps.repo.updateSpecialHoursParticipation(entries);
    deps.logger?.info?.(
      {
        total: entries.length,
        earlyEntry: entries.filter((e) => e.earlyEntry).length,
        extendedEvening: entries.filter((e) => e.extendedEvening).length,
        ticketedEvent: entries.filter((e) => e.ticketedEvent).length,
      },
      'Special-hours capture applied',
    );
    return { updated: entries.length };
  } catch (err) {
    deps.logger?.warn({ err }, 'Special-hours capture failed; prior flags retained');
    return { updated: 0 };
  }
}
