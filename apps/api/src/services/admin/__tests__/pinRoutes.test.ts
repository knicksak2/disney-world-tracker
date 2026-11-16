/**
 * Tests for Admin Panel Pins & Achievements console, evaluator helpers,
 * repository summary aggregation, and read-only Visual Catalogue routes.
 *
 * Validates: Requirements 1, 2, 12.4, 21.1, 21.2, 21.3, 21.4; Property 12
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import {
  PINS,
  PIN_SETS,
  type ExperienceCategory,
  type PinCriteria,
} from '@dwt/shared';

import { BOB, CAROL, SUBJECT, createWorld, makePending } from '../../accountDeletion/__tests__/visibility.harness.js';
import {
  evaluatePinSetHealth,
  resolveSet,
  summarizePinAwards,
  type EvalExperience,
} from '../../pins/evaluator.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo, type AdminRepo, type PinSystemSummary } from '../repo.js';
import { adminRoutes, ADMIN_SECTIONS } from '../routes.js';

function collectSetRefs(c: PinCriteria): { setId: string; required: number | 'all' }[] {
  if (c.kind === 'set') return [{ setId: c.setId, required: c.required }];
  if (c.kind === 'compound') return c.all.flatMap(collectSetRefs);
  return [];
}

describe('Admin Pin Observability & Routes', () => {
  // -------------------------------------------------------------------------
  // Property 12: Pin set-resolution health & award aggregation invariants
  // -------------------------------------------------------------------------
  it('Property 12a: evaluatePinSetHealth accurately mirrors PIN_SETS resolution and statuses', () => {
    const curatedPool = Object.values(PIN_SETS).flatMap((r) => (r.kind === 'ids' ? [...r.ids] : []));
    const idArb = fc.oneof(
      fc.constantFrom(...curatedPool),
      fc.constantFrom('custom-1', 'custom-2', 'custom-3'),
    );
    const categoryArb = fc.constantFrom<ExperienceCategory>(
      'Ride',
      'Show',
      'Character_Meet',
      'Walkthrough',
      'Parade',
      'PlayArea',
      'Restaurant',
      'Resort',
    );
    const expArb: fc.Arbitrary<EvalExperience> = fc.record({
      upstreamId: idArb,
      category: categoryArb,
      park: fc.constantFrom('Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom', null),
      land: fc.constantFrom('Fantasyland', 'Tomorrowland', null),
      worldShowcaseCountry: fc.constantFrom('Japan', 'France', null),
      facets: fc.record({
        thrillFactor: fc.subarray(['Water Rides', 'Dark', 'Spinning', 'Slow Rides']),
        interests: fc.subarray(['Star Wars', 'Pixar Pals', 'Classic Characters', 'Disney Princesses']),
        tableService: fc.subarray(['Fine/Signature Dining', 'Character Dining']),
        quickService: fc.subarray(['Quick Service - Coffee', 'Pool Bar', 'Festival Kiosk']),
      }),
      isDisneyResort: fc.boolean(),
      isRealRestaurant: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.array(expArb, { maxLength: 40 }),
        fc.dictionary(idArb, fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: null })),
        (catalog, nameRecord) => {
          const nameMap = new Map(Object.entries(nameRecord));
          const health = evaluatePinSetHealth(catalog, nameMap);
          const expectedKeys = Object.keys(PIN_SETS);

          expect(health.map((r) => r.setId)).toEqual(expectedKeys);

          for (const row of health) {
            const def = PIN_SETS[row.setId]!;
            const resolved = resolveSet(row.setId, catalog);
            const matchedIds = new Set(resolved.map((e) => e.upstreamId));

            expect(row.kind).toBe(def.kind);
            expect(row.matchedCount).toBe(resolved.length);
            expect(row.expectedCount).toBe(def.kind === 'ids' ? def.ids.length : null);

            const expectedMissing = def.kind === 'ids' ? def.ids.filter((id) => !matchedIds.has(id)) : [];
            expect(row.missingIds).toEqual(expectedMissing);

            const expectedRefs = PINS.filter((p) =>
              collectSetRefs(p.criteria).some((r) => r.setId === row.setId),
            );
            expect(row.referencingPinIds).toEqual(expectedRefs.map((p) => p.id));

            let maxNumericRequired: number | undefined;
            for (const pin of expectedRefs) {
              for (const ref of collectSetRefs(pin.criteria)) {
                if (ref.setId === row.setId && typeof ref.required === 'number') {
                  maxNumericRequired = Math.max(maxNumericRequired ?? 0, ref.required);
                }
              }
            }

            if (row.matchedCount === 0) {
              expect(row.status).toBe('empty');
            } else if (
              expectedMissing.length > 0 ||
              (maxNumericRequired !== undefined && row.matchedCount < maxNumericRequired)
            ) {
              expect(row.status).toBe('partial');
            } else {
              expect(row.status).toBe('ok');
            }

            expect(row.sampleNames.length).toBeLessThanOrEqual(5);
            expect(new Set(row.sampleNames).size).toBe(row.sampleNames.length);
            for (const name of row.sampleNames) {
              expect(name.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 12b: summarizePinAwards preserves exact sums and ignores unknown pin IDs', () => {
    const validIds = PINS.map((p) => p.id);
    const rowArb = fc.record({
      pin_id: fc.oneof(fc.constantFrom(...validIds), fc.constantFrom('retired_pin_x', 'unknown_pin')),
      claimed_at: fc.option(fc.constant('2026-10-01T12:00:00.000Z'), { nil: null }),
      user_id: fc.option(fc.constantFrom('u1', 'u2', 'u3'), { nil: null }),
    });

    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 100 }), (rows) => {
        const summary = summarizePinAwards(rows);

        expect(summary.byPin.map((r) => r.pinId)).toEqual(validIds);

        const sumUnlocked = summary.byPin.reduce((acc, r) => acc + r.unlockedCount, 0);
        const sumClaimed = summary.byPin.reduce((acc, r) => acc + r.claimedCount, 0);

        expect(summary.totalUnlocked).toBe(sumUnlocked);
        expect(summary.totalClaimed).toBe(sumClaimed);
        for (const r of summary.byPin) {
          expect(r.claimedCount).toBeLessThanOrEqual(r.unlockedCount);
          expect(r.claimedCount).toBeGreaterThanOrEqual(0);
        }

        const validSet = new Set(validIds);
        const validRows = rows.filter((r) => validSet.has(r.pin_id));
        expect(summary.totalUnlocked).toBe(validRows.length);
        expect(summary.totalClaimed).toBe(validRows.filter((r) => r.claimed_at !== null).length);
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // pg-mem integration: AdminRepo.getPinSystemSummary
  // -------------------------------------------------------------------------
  it('AdminRepo.getPinSystemSummary aggregates active users, excludes non-active accounts, and checks active sets', async () => {
    const w = await createWorld();

    // `mountains` curated set has 3 upstream ids:
    // 80010190;entityType=Attraction, 80010110;entityType=Attraction, 26068;entityType=Attraction
    await w.seeder.insertRow('experiences', {
      upstream_entity_id: '80010190;entityType=Attraction',
      name: 'Space Mountain',
      category: 'Ride',
      park: 'Magic Kingdom',
      active: true,
    });
    await w.seeder.insertRow('experiences', {
      upstream_entity_id: '80010110;entityType=Attraction',
      name: 'Big Thunder Mountain Railroad',
      category: 'Ride',
      park: 'Magic Kingdom',
      active: true,
    });
    // Third mountain exists in catalog table but is inactive -> must NOT resolve!
    await w.seeder.insertRow('experiences', {
      upstream_entity_id: '26068;entityType=Attraction',
      name: 'Expedition Everest',
      category: 'Ride',
      park: 'Animal Kingdom',
      active: false,
    });
    await w.seeder.insertRow('experiences', {
      upstream_entity_id: 'parade-1',
      name: 'Festival of Fantasy Parade',
      category: 'Parade',
      park: 'Magic Kingdom',
      active: true,
    });

    // Seed Bob (active): 2 pins (1 claimed, 1 unclaimed) + 1 showcase placement
    await w.pool.query(
      `INSERT INTO user_pins (user_id, pin_id, claimed_at) VALUES ($1, $2, now()), ($1, $3, NULL)`,
      [BOB.id, 'gold_coaster_royalty', 'silver_centurion_50'],
    );
    await w.pool.query(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y, z_index) VALUES ($1, $2, 0.5, 0.5, 0)`,
      [BOB.id, 'gold_coaster_royalty'],
    );

    // Seed Carol (active): 1 claimed pin
    await w.pool.query(
      `INSERT INTO user_pins (user_id, pin_id, claimed_at) VALUES ($1, $2, now())`,
      [CAROL.id, 'gold_coaster_royalty'],
    );

    // Seed Subject & transition to pending_deletion -> must be EXCLUDED from active metrics
    await w.pool.query(
      `INSERT INTO user_pins (user_id, pin_id, claimed_at) VALUES ($1, $2, now())`,
      [SUBJECT.id, 'silver_epcot_explorer'],
    );
    await w.pool.query(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y, z_index) VALUES ($1, $2, 0.2, 0.2, 0)`,
      [SUBJECT.id, 'silver_epcot_explorer'],
    );
    await makePending(w, SUBJECT.id);

    const adminRepo = createAdminRepo(w.pool, {} as never);
    const summary = await adminRepo.getPinSystemSummary();

    expect(summary.catalogTotal).toBe(PINS.length);
    expect(summary.setTotal).toBe(Object.keys(PIN_SETS).length);
    // BOB, CAROL, DAVE are active; SUBJECT is pending_deletion
    expect(summary.activeUsers).toBe(3);
    expect(summary.totalUnlocked).toBe(3);
    expect(summary.totalClaimed).toBe(2);
    expect(summary.usersWithUnlockedPins).toBe(2);
    expect(summary.showcasePlacements).toBe(1);
    expect(summary.showcaseUsers).toBe(1);

    const mountains = summary.setHealth.find((s) => s.setId === 'mountains')!;
    expect(mountains.status).toBe('partial');
    expect(mountains.matchedCount).toBe(2);
    expect(mountains.expectedCount).toBe(3);
    expect(mountains.missingIds).toEqual(['26068;entityType=Attraction']);
    expect(mountains.sampleNames).toEqual(['Space Mountain', 'Big Thunder Mountain Railroad']);

    const parades = summary.setHealth.find((s) => s.setId === 'parades')!;
    expect(parades.status).toBe('ok');
    expect(parades.matchedCount).toBe(1);

    const waterRides = summary.setHealth.find((s) => s.setId === 'water_rides')!;
    expect(waterRides.status).toBe('empty');
    expect(waterRides.matchedCount).toBe(0);

    const coasterCounts = summary.awardsByPin.find((a) => a.pinId === 'gold_coaster_royalty')!;
    expect(coasterCounts.unlockedCount).toBe(2);
    expect(coasterCounts.claimedCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Fastify route tests
  // -------------------------------------------------------------------------
  const username = 'admin';
  const password = 'supersecretpassword';
  const basicAuth = createBasicAuthHook({ username, password });
  const validAuthHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  function buildPinApp(opts: {
    summaryOverride?: Partial<PinSystemSummary>;
    reconcileAll?: () => Promise<{ usersProcessed: number; pinsAwarded: number }>;
    omitPinRepo?: boolean;
    pinCatalogDir?: string;
  } = {}) {
    const app = Fastify();
    const baseRepo = createAdminRepo({} as never, {} as never);
    const defaultSummary: PinSystemSummary = {
      catalogTotal: PINS.length,
      setTotal: Object.keys(PIN_SETS).length,
      byTier: { Bronze: 40, Silver: 50, Gold: 50, Prism: 34 },
      byTrack: { Explorer: 40, Connoisseur: 40, Touring: 50, Social: 24, Collector: 20 },
      activeUsers: 120,
      totalUnlocked: 310,
      totalClaimed: 275,
      usersWithUnlockedPins: 80,
      showcasePlacements: 95,
      showcaseUsers: 35,
      setHealth: [
        {
          setId: 'mountains',
          kind: 'ids',
          expectedCount: 3,
          matchedCount: 2,
          missingIds: ['26068;entityType=Attraction'],
          sampleNames: ['Space Mountain', '<script>alert("xss")</script>'],
          referencingPinIds: ['silver_mountain_conqueror'],
          status: 'partial',
        },
        {
          setId: 'water_rides',
          kind: 'facet',
          expectedCount: null,
          matchedCount: 0,
          missingIds: [],
          sampleNames: [],
          referencingPinIds: [],
          status: 'empty',
        },
      ],
      awardsByPin: PINS.map((p, idx) => ({
        pinId: p.id,
        unlockedCount: idx === 0 ? 15 : 0,
        claimedCount: idx === 0 ? 10 : 0,
      })),
      ...opts.summaryOverride,
    };

    const repo: AdminRepo = {
      ...baseRepo,
      getPinSystemSummary: async () => defaultSummary,
    };

    void app.register(
      adminRoutes({
        repo,
        basicAuth,
        ...(opts.omitPinRepo
          ? {}
          : {
              pinRepo: {
                getBoard: async () => {
                  throw new Error('not needed');
                },
                awardNewly: async () => [],
                claimPin: async () => ({ status: 'not_awarded' }),
                reconcileAll: opts.reconcileAll ?? (async () => ({ usersProcessed: 42, pinsAwarded: 5 })),
              },
            }),
        ...(opts.pinCatalogDir ? { pinCatalogDir: opts.pinCatalogDir } : {}),
      }),
    );

    return app;
  }

  it('registers /admin/pins in ADMIN_SECTIONS under User Operations & Security', () => {
    const entry = ADMIN_SECTIONS.find((s) => s.path === '/admin/pins');
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('User Operations & Security');
    expect(entry?.title).toBe('Pins & Achievements');
  });

  it('enforces Basic Auth (401) across all /admin/pins* routes', async () => {
    const app = buildPinApp();
    for (const [method, url] of [
      ['GET', '/admin/pins'],
      ['POST', '/admin/pins/reconcile'],
      ['GET', '/admin/pins/catalog'],
      ['GET', '/admin/pins/motifs/motif-paths.js'],
      ['GET', '/admin/pins/catalog/pin-descriptions.js'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Basic realm="admin"');
    }
  });

  it('GET /admin/pins renders metrics, escaped set health, Series 1 table, and catalog/reconcile actions', async () => {
    const app = buildPinApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/pins',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toContain('Pins &amp; Achievements Console');
    expect(res.body).toContain(`${PINS.length} Pins`);
    expect(res.body).toContain('Named Set Resolution Health');
    expect(res.body).toContain('Series 1 Pin Catalog &amp; Live Awards');
    expect(res.body).toContain('href="/admin/pins/catalog"');
    expect(res.body).toContain('action="/admin/pins/reconcile"');
    expect(res.body).toContain('26068;entityType=Attraction');
    // XSS payload from experience name must be escaped
    expect(res.body).not.toContain('<script>alert("xss")</script>');
    expect(res.body).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('POST /admin/pins/reconcile enforces same-origin, invokes reconcileAll, and handles missing pinRepo', async () => {
    const reconcileSpy = vi.fn(async () => ({ usersProcessed: 42, pinsAwarded: 5 }));
    const app = buildPinApp({ reconcileAll: reconcileSpy });

    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/admin/pins/reconcile',
      headers: {
        authorization: validAuthHeader,
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(crossOrigin.headers['cache-control']).toBe('private, no-store');
    expect(reconcileSpy).not.toHaveBeenCalled();

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/admin/pins/reconcile',
      headers: {
        authorization: validAuthHeader,
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(sameOrigin.headers['cache-control']).toBe('private, no-store');
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(sameOrigin.body).toContain('Processed <strong>42</strong> user(s)');
    expect(sameOrigin.body).toContain('awarded <strong>5</strong> new pin(s)');

    const noRepoApp = buildPinApp({ omitPinRepo: true });
    const noRepoRes = await noRepoApp.inject({
      method: 'POST',
      url: '/admin/pins/reconcile',
      headers: { authorization: validAuthHeader },
    });
    expect(noRepoRes.statusCode).toBe(200);
    expect(noRepoRes.body).toContain('Global Pin Reconciliation Unavailable');
  });

  it('GET /admin/pins/catalog and companion scripts serve read-only catalogue with security headers', async () => {
    const app = buildPinApp();

    for (const url of ['/admin/pins/catalog', '/admin/pins/catalog/']) {
      const htmlRes = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: validAuthHeader },
      });
      expect(htmlRes.statusCode).toBe(200);
      expect(htmlRes.headers['content-type']).toContain('text/html');
      expect(htmlRes.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(htmlRes.headers['cache-control']).toBe('private, no-store');
      expect(htmlRes.body).toContain('href="/admin/pins"');
      expect(htmlRes.body).toContain('pins-v2-transcription.js');
    }

    for (const scriptPath of [
      '/admin/pins/motifs/motif-paths.js',
      '/admin/pins/pins-v2-transcription.js',
      '/admin/pins/pin-descriptions.js',
      '/admin/pins/catalog/motifs/motif-paths.js',
      '/admin/pins/catalog/pins-v2-transcription.js',
      '/admin/pins/catalog/pin-descriptions.js',
    ]) {
      const jsRes = await app.inject({
        method: 'GET',
        url: scriptPath,
        headers: { authorization: validAuthHeader },
      });
      expect(jsRes.statusCode).toBe(200);
      expect(jsRes.headers['content-type']).toContain('application/javascript');
      expect(jsRes.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(jsRes.headers['cache-control']).toBe('private, no-store');
      expect(jsRes.body.length).toBeGreaterThan(100);
    }
  });

  it('GET /admin/pins/catalog and companion scripts return 404 gracefully when catalogue directory is missing', async () => {
    const missingDir = join(tmpdir(), 'dwt-non-existent-pin-catalog-dir');
    const app = buildPinApp({ pinCatalogDir: missingDir });

    const htmlRes = await app.inject({
      method: 'GET',
      url: '/admin/pins/catalog',
      headers: { authorization: validAuthHeader },
    });
    expect(htmlRes.statusCode).toBe(404);
    expect(htmlRes.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(htmlRes.headers['cache-control']).toBe('private, no-store');
    expect(htmlRes.body).toContain('Visual Catalogue Unavailable');

    const jsRes = await app.inject({
      method: 'GET',
      url: '/admin/pins/pin-descriptions.js',
      headers: { authorization: validAuthHeader },
    });
    expect(jsRes.statusCode).toBe(404);
    expect(jsRes.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(jsRes.headers['cache-control']).toBe('private, no-store');
  });
});
