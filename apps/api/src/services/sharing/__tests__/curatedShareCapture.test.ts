/**
 * Send-time snapshot capture for the curated Progress_Share stats
 * (expanded-stats task 9.3).
 *
 * Example-based unit/integration tests that pin down three behaviors of the
 * send-time snapshot the Sharing_Service captures at `progress` Share creation
 * (Requirement 10):
 *
 *   1. A sender with NO per-Facet_Value_Key Coverage_Statistic → `topFacet` is
 *      omitted entirely from the captured payload (R10.8).
 *   2. A sender whose top facet has `completed === 0` → `topFacet` is STILL
 *      included (R10.7).
 *   3. Send-time snapshot immutability (R10.6): once a `progress` Share is
 *      created, changing the sender's stats afterwards does not alter the
 *      captured payload the recipient later sees.
 *
 * Two complementary layers are exercised:
 *
 *   - The pure curated builder (`buildCuratedProgressStats` / `selectTopFacet`)
 *     over `StatsSnapshot` fixtures — this is the source of truth for whether a
 *     `topFacet` is present at all, so cases 1 and 2 are proven there directly.
 *   - The route seam (`sharingRoutes` + the injected `computeProgressShareStats`
 *     provider) over an in-process Fastify instance with a fake `SharingRepo`
 *     that stores the payload snapshot exactly as the DB would. This proves the
 *     capture wiring writes the curated fields into the persisted payload and
 *     that the recipient's view (the stored snapshot) is frozen at send time.
 *
 * Validates: Requirements 10.6, 10.7, 10.8.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type {
  GroupedFacetsDTO,
  ProgressSharePayload,
  SharePayload,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { RawCoverageCell } from '../../stats/coverage.js';
import {
  buildCuratedProgressStats,
  selectTopFacet,
  type CuratedProgressStats,
} from '../../stats/curatedShare.js';
import { rollUpFacets } from '../../stats/facets.js';
import type { RawFacetExperienceRow, StatsSnapshot } from '../../stats/repo.js';
import type {
  InboxResponse,
  OpenedShareDetail,
  SentShareDTO,
  ShareDeliveryResult,
  SharingRepo,
} from '../repo.js';
import {
  sharingRoutes,
  type ProgressShareStatsProvider,
  type SharingRoutesOptions,
} from '../routes.js';

// ---------------------------------------------------------------------------
// Stable test ids
// ---------------------------------------------------------------------------

const SENDER = '11111111-1111-4111-8111-111111111111';
const REC_A = '22222222-2222-4222-8222-222222222222';
const SHARE_ID = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// StatsSnapshot fixture builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal `StatsSnapshot`. `coverage` drives `overallPercent`,
 * `facetExperiences` drives the `topFacet` selection, and `percentile` (default
 * `null`) collapses `percentileRank` to `0.0`.
 */
function makeSnapshot(overrides: {
  coverage?: readonly RawCoverageCell[];
  facetExperiences?: readonly RawFacetExperienceRow[];
} = {}): StatsSnapshot {
  return {
    coverage: overrides.coverage ?? [],
    facetExperiences: overrides.facetExperiences ?? [],
    userRatings: [],
    resortCoverage: [],
    percentile: null,
  };
}

/** One active-experience facet row with a single-group `{ id, name }` facet. */
function facetRow(
  experienceId: string,
  completedByUser: boolean,
  facets: ReadonlyArray<{ id: string; name: string }>,
): RawFacetExperienceRow {
  const grouped: Record<string, ReadonlyArray<{ id: string; name: string }>> = {
    Theme: facets,
  };
  return {
    experienceId,
    completedByUser,
    groupedFacets: grouped as GroupedFacetsDTO,
  };
}

// ===========================================================================
// Layer 1 — pure curated builder (source of truth for topFacet presence)
// ===========================================================================

describe('buildCuratedProgressStats topFacet presence (R10.7, R10.8)', () => {
  it('omits topFacet when the sender has no facet statistic (R10.8)', () => {
    // A sender with no facet material at all: no facet rows means no
    // Facet_Value_Key groups, so there is no top facet to report.
    const snapshot = makeSnapshot({ facetExperiences: [] });

    const curated = buildCuratedProgressStats(snapshot);

    expect(curated.topFacet).toBeUndefined();
    expect('topFacet' in curated).toBe(false);
  });

  it('omits topFacet when every experience carries an empty facet set (R10.8)', () => {
    // Experiences exist but none carry any Facet_Value ⇒ no keys ⇒ no top facet.
    const snapshot = makeSnapshot({
      facetExperiences: [
        facetRow('exp-1', true, []),
        facetRow('exp-2', false, []),
      ],
    });

    expect(rollUpFacets(snapshot.facetExperiences)).toHaveLength(0);
    expect(buildCuratedProgressStats(snapshot).topFacet).toBeUndefined();
  });

  it('includes topFacet even when its completed count is 0 (R10.7)', () => {
    // The sender has facet statistics, but has completed none of the tagged
    // experiences ⇒ the top facet's `completed` is 0. It must still be
    // reported because the sender has >= 1 facet statistic.
    const snapshot = makeSnapshot({
      facetExperiences: [
        facetRow('exp-1', false, [{ id: 'thrill', name: 'Thrill' }]),
        facetRow('exp-2', false, [{ id: 'thrill', name: 'Thrill' }]),
      ],
    });

    const curated = buildCuratedProgressStats(snapshot);

    expect(curated.topFacet).toBeDefined();
    expect(curated.topFacet?.label).toBe('Thrill');
    expect(curated.topFacet?.cell.completed).toBe(0);
    expect(curated.topFacet?.cell.total).toBe(2);
  });

  it('selectTopFacet returns undefined for an empty facet list (R10.8)', () => {
    expect(selectTopFacet([])).toBeUndefined();
  });
});

// ===========================================================================
// Route harness — send-time capture into the persisted payload
// ===========================================================================

interface StoredShare {
  readonly senderId: string;
  readonly payload: SharePayload;
}

interface CaptureRepo extends SharingRepo {
  /** The payload snapshots as they were persisted, keyed by share id. */
  readonly stored: Map<string, StoredShare>;
}

/**
 * A fake `SharingRepo` that persists the composed payload verbatim (as the DB
 * `payload_snapshot` column would) and serves it back through `openShare` — the
 * recipient's view. It deep-clones on write and read so the stored snapshot is
 * genuinely detached from any later mutation, exactly like a JSONB round-trip.
 */
function makeCaptureRepo(): CaptureRepo {
  const stored = new Map<string, StoredShare>();
  let counter = 0;
  return {
    stored,
    async createShareAtomic(senderId, _recipientIds, payload): Promise<ShareDeliveryResult> {
      counter += 1;
      const shareId =
        counter === 1 ? SHARE_ID : `${SHARE_ID.slice(0, -1)}${counter}`;
      stored.set(shareId, {
        senderId,
        payload: structuredClone(payload) as SharePayload,
      });
      return { shareId, deliveredTo: 1 };
    },
    async listInbox(): Promise<InboxResponse> {
      return { unread: 0, items: [] };
    },
    async listSentShares(): Promise<SentShareDTO[]> {
      return [];
    },
    async openShare(_recipientId, shareId): Promise<OpenedShareDetail | null> {
      const row = stored.get(shareId);
      if (!row) return null;
      return {
        shareId,
        senderId: row.senderId,
        payloadKind: row.payload.kind,
        payload: structuredClone(row.payload) as SharePayload,
        sentAt: '2024-05-01T10:00:00.000Z',
      };
    },
    async softDeleteForRecipient(): Promise<boolean> {
      return true;
    },
  };
}

function makeRequireSession(userId: string): SharingRoutesOptions['requireSession'] {
  return async (request) => {
    if (!userId) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = userId;
  };
}

async function buildApp(opts: {
  repo: CaptureRepo;
  computeProgressShareStats: ProgressShareStatsProvider;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    sharingRoutes({
      repo: opts.repo,
      requireSession: makeRequireSession(SENDER),
      computeProgressShareStats: opts.computeProgressShareStats,
    }),
  );
  await app.ready();
  return app;
}

/** Minimal valid `progress` share request body. */
function progressBody() {
  return {
    kind: 'progress' as const,
    recipientIds: [REC_A],
    statsSnapshot: {
      overallPercent: 0,
      perParkPercent: {},
      perCategoryPercent: {},
    },
  };
}

describe('POST /me/shares curated capture (R10.7, R10.8)', () => {
  it('omits topFacet in the persisted payload when the provider returns none (R10.8)', async () => {
    const repo = makeCaptureRepo();
    // Provider modeling a sender with no facet statistic: topFacet absent.
    const provider: ProgressShareStatsProvider = async () => ({
      overallPercent: 42.5,
      percentileRank: 10,
    });
    const app = await buildApp({ repo, computeProgressShareStats: provider });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: progressBody(),
    });

    expect(response.statusCode).toBe(201);
    const persisted = repo.stored.get(SHARE_ID)?.payload as ProgressSharePayload;
    expect(persisted.kind).toBe('progress');
    expect(persisted.overallPercent).toBe(42.5);
    expect(persisted.percentileRank).toBe(10);
    expect(persisted.topFacet).toBeUndefined();
    expect('topFacet' in persisted).toBe(false);

    await app.close();
  });

  it('includes topFacet with completed 0 in the persisted payload (R10.7)', async () => {
    const repo = makeCaptureRepo();
    const curated: CuratedProgressStats = {
      overallPercent: 12.3,
      percentileRank: 0,
      topFacet: {
        label: 'Thrill',
        cell: {
          completed: 0,
          total: 5,
          percent: 0,
          remaining: 5,
          completeBadge: false,
        },
      },
    };
    const provider: ProgressShareStatsProvider = async () => curated;
    const app = await buildApp({ repo, computeProgressShareStats: provider });

    const response = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: progressBody(),
    });

    expect(response.statusCode).toBe(201);
    const persisted = repo.stored.get(SHARE_ID)?.payload as ProgressSharePayload;
    expect(persisted.topFacet).toBeDefined();
    expect(persisted.topFacet?.label).toBe('Thrill');
    expect(persisted.topFacet?.cell.completed).toBe(0);
    expect(persisted.topFacet?.cell.total).toBe(5);

    await app.close();
  });
});

// ===========================================================================
// Send-time snapshot immutability (R10.6)
// ===========================================================================

describe('send-time snapshot immutability (R10.6)', () => {
  it('freezes the captured payload even after the sender\u2019s stats change post-send', async () => {
    const repo = makeCaptureRepo();

    // A mutable provider standing in for the live Stats computation: the value
    // it returns is the sender's current stats at the moment of the call.
    let currentStats: CuratedProgressStats = {
      overallPercent: 20,
      percentileRank: 30,
      topFacet: {
        label: 'Thrill',
        cell: {
          completed: 2,
          total: 10,
          percent: 20,
          remaining: 8,
          completeBadge: false,
        },
      },
    };
    const provider: ProgressShareStatsProvider = async () => currentStats;
    const app = await buildApp({ repo, computeProgressShareStats: provider });

    // Create the Share — this captures the send-time snapshot.
    const created = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: progressBody(),
    });
    expect(created.statusCode).toBe(201);

    // Snapshot of what the recipient sees right after send.
    const openedBefore = await app.inject({
      method: 'POST',
      url: `/me/inbox/${SHARE_ID}/open`,
    });
    expect(openedBefore.statusCode).toBe(200);
    const payloadBefore = (openedBefore.json() as OpenedShareDetail)
      .payload as ProgressSharePayload;
    expect(payloadBefore.overallPercent).toBe(20);
    expect(payloadBefore.percentileRank).toBe(30);
    expect(payloadBefore.topFacet?.cell.completed).toBe(2);

    // The sender's stats change AFTER the send: more completions, a higher
    // percentile, a different top facet — even the shape changes.
    currentStats = {
      overallPercent: 88,
      percentileRank: 95,
      topFacet: {
        label: 'Water Rides',
        cell: {
          completed: 40,
          total: 50,
          percent: 80,
          remaining: 10,
          completeBadge: false,
        },
      },
    };

    // The recipient re-opens the Share: the stored snapshot must be unchanged.
    const openedAfter = await app.inject({
      method: 'POST',
      url: `/me/inbox/${SHARE_ID}/open`,
    });
    expect(openedAfter.statusCode).toBe(200);
    const payloadAfter = (openedAfter.json() as OpenedShareDetail)
      .payload as ProgressSharePayload;

    expect(payloadAfter.overallPercent).toBe(20);
    expect(payloadAfter.percentileRank).toBe(30);
    expect(payloadAfter.topFacet?.label).toBe('Thrill');
    expect(payloadAfter.topFacet?.cell.completed).toBe(2);
    // The recipient view equals the send-time capture exactly.
    expect(payloadAfter).toEqual(payloadBefore);

    await app.close();
  });

  it('captures a fresh snapshot per send, isolating one Share from another (R10.6)', async () => {
    const repo = makeCaptureRepo();
    let currentStats: CuratedProgressStats = {
      overallPercent: 20,
      percentileRank: 30,
    };
    const provider: ProgressShareStatsProvider = async () => currentStats;
    const app = await buildApp({ repo, computeProgressShareStats: provider });

    const firstCreate = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: progressBody(),
    });
    const firstShareId = (firstCreate.json() as ShareDeliveryResult).shareId;

    // Sender's stats advance between the two sends.
    currentStats = { overallPercent: 55, percentileRank: 70 };

    const secondCreate = await app.inject({
      method: 'POST',
      url: '/me/shares',
      payload: progressBody(),
    });
    const secondShareId = (secondCreate.json() as ShareDeliveryResult).shareId;

    const first = repo.stored.get(firstShareId)?.payload as ProgressSharePayload;
    const second = repo.stored.get(secondShareId)?.payload as ProgressSharePayload;

    // Each Share froze its own send-time values; the first is not retroactively
    // updated to match the second.
    expect(first.overallPercent).toBe(20);
    expect(first.percentileRank).toBe(30);
    expect(second.overallPercent).toBe(55);
    expect(second.percentileRank).toBe(70);

    await app.close();
  });
});
