#!/usr/bin/env node
/**
 * One-off Facet_Enrichment backfill.
 *
 * The experience-facet-enrichment feature added four persisted columns
 * (`grouped_facets`, `height_requirement`, `why_this`, `sub_type`) that
 * Catalog_Sync writes from each Facility_Document. By design those fields are
 * NOT drift signals (R12.2): a change confined to enrichment never triggers an
 * upsert. That is correct for steady state, but it means a normal sync does not
 * populate enrichment onto Experiences that already existed before the feature
 * shipped — reconcile emits no upsert for a row whose name/park/category/land/
 * areaType/resortId/resortArea are unchanged, so its new columns keep the
 * migration defaults (`'{}'` / NULL).
 *
 * This script performs the one-time backfill: for every stored, non-deleted
 * Disney document it recomputes the enrichment with the SAME pure cores the
 * sync uses (`adaptFacilityDocument` -> `extractEnrichment`) and writes the four
 * columns onto the matching `experiences` row (matched by
 * `upstream_entity_id`). It touches no other column and is idempotent — running
 * it repeatedly yields the same result and it is safe to run again after a
 * future sync.
 *
 * Usage:
 *   npm run backfill-facets          (uses .env)
 *   npm run backfill-facets:cloud    (uses .env.dev)
 */

import { closePool, getPool } from '../db/pool.js';
import {
  adaptFacilityDocument,
  type FacilityDocument,
} from '../services/catalog/disney/facilityDoc.js';
import { extractEnrichment } from '../services/catalog/disney/enrich.js';

interface DocRow {
  body: Record<string, unknown>;
}

async function main(): Promise<void> {
  const pool = getPool();
  let scanned = 0;
  let updated = 0;

  try {
    const { rows } = await pool.query<DocRow>(
      `SELECT body FROM disney_documents WHERE deleted = FALSE`,
    );

    for (const { body } of rows) {
      scanned += 1;
      const doc: FacilityDocument = adaptFacilityDocument(body);
      const enrichment = extractEnrichment(doc);

      // Update only the four enrichment columns, only for an Experience whose
      // upstream_entity_id matches this document's Enterprise_Id. Nullable JSONB
      // is passed as SQL NULL (not the JSON string 'null') so an absent field is
      // stored as NULL, matching applyReconciliation.
      const result = await pool.query(
        `UPDATE experiences
            SET grouped_facets     = $2::jsonb,
                height_requirement = $3::jsonb,
                why_this           = $4::jsonb,
                sub_type           = $5,
                updated_at         = now()
          WHERE upstream_entity_id = $1`,
        [
          doc.id,
          JSON.stringify(enrichment.groupedFacets),
          enrichment.heightRequirement === null
            ? null
            : JSON.stringify(enrichment.heightRequirement),
          enrichment.whyThis === null ? null : JSON.stringify(enrichment.whyThis),
          enrichment.subType,
        ],
      );
      updated += result.rowCount ?? 0;
    }

    console.log(
      `[backfill-facets] done: scanned ${scanned} documents, ` +
        `updated ${updated} experience rows.`,
    );
  } finally {
    await closePool();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill-facets] unexpected failure:', err);
  process.exitCode = 1;
});
