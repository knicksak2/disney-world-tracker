/**
 * `themeParksDirectory` — externalId -> ThemeParks.wiki entity id resolution.
 *
 * Regression coverage for the "resort quick-service restaurants/bars/lounges
 * never resolve live data" bug: ThemeParks.wiki parents resort-hotel dining
 * venues (e.g. Cove Bar, Sanaa Lounge) directly to the WDW *destination*
 * entity rather than to any of the six theme/water parks in
 * `destination.parks`. A directory build that only enumerates each park's
 * children (`getEntityChildren(park.id)`) never sees these entities, so
 * `resolveEntityId` permanently returns `null` for them — which is exactly
 * what previously produced `live_unavailable` for Cove Bar despite its
 * `upstream_entity_id` being a correct, well-formed Enterprise_Id.
 *
 * These tests pin that the directory build ALSO enumerates the destination's
 * own children (in addition to each park's), so a destination-parented
 * entity resolves correctly.
 */

import { describe, expect, it } from 'vitest';

import type {
  ThemeParksClient,
  ThemeParksDestinationsResponse,
  ThemeParksEntityChildrenResponse,
} from '../../catalog/themeparks.js';
import { createThemeParksDirectory } from '../themeParksDirectory.js';

const WDW_DESTINATION_ID = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';
const MAGIC_KINGDOM_ID = '75ea578a-adc8-4116-a54d-dccb60765ef9';

const DESTINATIONS: ThemeParksDestinationsResponse = {
  destinations: [
    {
      id: WDW_DESTINATION_ID,
      name: "Walt Disney World® Resort",
      externalId: '80007798;entityType=destination',
      parks: [{ id: MAGIC_KINGDOM_ID, name: 'Magic Kingdom Park' }],
    },
  ],
};

/** Magic Kingdom's own children — an ordinary in-park attraction. */
const MAGIC_KINGDOM_CHILDREN: ThemeParksEntityChildrenResponse = {
  id: MAGIC_KINGDOM_ID,
  name: 'Magic Kingdom Park',
  entityType: 'PARK',
  children: [
    {
      id: 'space-mountain-guid',
      name: 'Space Mountain',
      entityType: 'ATTRACTION',
      externalId: '80010190;entityType=Attraction',
      parentId: MAGIC_KINGDOM_ID,
    },
  ],
};

/**
 * The destination's OWN children — resort-hotel dining venues parented
 * directly to the destination, exactly as ThemeParks.wiki's real
 * `/entity/{wdw}/children` response shapes Cove Bar (Disney's Polynesian
 * Resort quick-service bar).
 */
const DESTINATION_CHILDREN: ThemeParksEntityChildrenResponse = {
  id: WDW_DESTINATION_ID,
  name: "Walt Disney World® Resort",
  entityType: 'DESTINATION',
  children: [
    {
      id: 'cove-bar-guid',
      name: 'Cove Bar',
      entityType: 'RESTAURANT',
      externalId: '362428;entityType=restaurant',
      parentId: WDW_DESTINATION_ID,
    },
  ],
};

function createFakeClient(
  childrenByParentId: Readonly<Record<string, ThemeParksEntityChildrenResponse>>,
): ThemeParksClient {
  return {
    async getDestinations() {
      return DESTINATIONS;
    },
    async getEntityChildren(id: string) {
      const response = childrenByParentId[id];
      if (response === undefined) {
        throw new Error(`unexpected getEntityChildren(${id})`);
      }
      return response;
    },
  };
}

describe('createThemeParksDirectory', () => {
  it('resolves an in-park entity from its park\u2019s children (baseline)', async () => {
    const client = createFakeClient({
      [MAGIC_KINGDOM_ID]: MAGIC_KINGDOM_CHILDREN,
      [WDW_DESTINATION_ID]: DESTINATION_CHILDREN,
    });
    const directory = createThemeParksDirectory({ client });

    await expect(
      directory.resolveEntityId('80010190;entityType=Attraction'),
    ).resolves.toBe('space-mountain-guid');
  });

  it('resolves a resort-hotel restaurant parented directly to the destination (regression: Cove Bar)', async () => {
    const client = createFakeClient({
      [MAGIC_KINGDOM_ID]: MAGIC_KINGDOM_CHILDREN,
      [WDW_DESTINATION_ID]: DESTINATION_CHILDREN,
    });
    const directory = createThemeParksDirectory({ client });

    // Before the fix, the directory build never called
    // `getEntityChildren(wdw.id)`, so this externalId was never indexed and
    // resolution returned null (-> live_unavailable for every resort-based
    // restaurant, bar, or lounge).
    await expect(
      directory.resolveEntityId('362428;entityType=restaurant'),
    ).resolves.toBe('cove-bar-guid');
  });

  it('returns null for an externalId absent from both the park and destination children', async () => {
    const client = createFakeClient({
      [MAGIC_KINGDOM_ID]: MAGIC_KINGDOM_CHILDREN,
      [WDW_DESTINATION_ID]: DESTINATION_CHILDREN,
    });
    const directory = createThemeParksDirectory({ client });

    await expect(directory.resolveEntityId('999999;entityType=restaurant')).resolves.toBeNull();
  });

  it('a destination-children enumeration failure is logged and swallowed, still resolving in-park entities', async () => {
    const client: ThemeParksClient = {
      async getDestinations() {
        return DESTINATIONS;
      },
      async getEntityChildren(id: string) {
        if (id === WDW_DESTINATION_ID) {
          throw new Error('simulated destination children failure');
        }
        if (id === MAGIC_KINGDOM_ID) {
          return MAGIC_KINGDOM_CHILDREN;
        }
        throw new Error(`unexpected getEntityChildren(${id})`);
      },
    };
    const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const directory = createThemeParksDirectory({
      client,
      logger: {
        warn: (obj, msg) => warnings.push({ obj, msg }),
        debug: () => {},
      },
    });

    // Destination-children failure degrades gracefully: in-park resolution
    // still works, and the failure is logged rather than thrown.
    await expect(
      directory.resolveEntityId('80010190;entityType=Attraction'),
    ).resolves.toBe('space-mountain-guid');
    await expect(
      directory.resolveEntityId('362428;entityType=restaurant'),
    ).resolves.toBeNull();
    expect(
      warnings.some((w) => w.msg.includes("destination\u2019s own children")),
    ).toBe(true);
  });

  it('getEntityIdMap exposes both park-scoped and destination-scoped entries', async () => {
    const client = createFakeClient({
      [MAGIC_KINGDOM_ID]: MAGIC_KINGDOM_CHILDREN,
      [WDW_DESTINATION_ID]: DESTINATION_CHILDREN,
    });
    const directory = createThemeParksDirectory({ client });

    const map = await directory.getEntityIdMap();
    expect(map.get('80010190;entityType=Attraction')).toBe('space-mountain-guid');
    expect(map.get('362428;entityType=restaurant')).toBe('cove-bar-guid');
  });
});
