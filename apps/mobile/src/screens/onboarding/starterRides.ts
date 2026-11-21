import type { ExperienceDTO, Park } from '@dwt/shared';

export const STARTER_RIDES_MAX = 12;

interface CuratedStarterRideTarget {
  readonly park: Park;
  readonly name: string;
}

const PARK_ROUND_ROBIN_ORDER: readonly Park[] = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
];

const CURATED_STARTER_RIDES: readonly CuratedStarterRideTarget[] = [
  { park: 'Magic Kingdom', name: 'Space Mountain' },
  { park: 'Magic Kingdom', name: 'Haunted Mansion' },
  { park: 'Magic Kingdom', name: 'Pirates of the Caribbean' },
  { park: 'EPCOT', name: 'Guardians of the Galaxy: Cosmic Rewind' },
  { park: 'EPCOT', name: "Soarin' Around the World" },
  { park: 'EPCOT', name: 'Spaceship Earth' },
  { park: 'Hollywood Studios', name: 'Star Wars: Rise of the Resistance' },
  { park: 'Hollywood Studios', name: 'The Twilight Zone Tower of Terror' },
  { park: 'Hollywood Studios', name: 'Slinky Dog Dash' },
  { park: 'Animal Kingdom', name: 'Avatar Flight of Passage' },
  { park: 'Animal Kingdom', name: 'Expedition Everest' },
  { park: 'Animal Kingdom', name: 'Kilimanjaro Safaris' },
];

export function normalizeRideTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareByNameThenId(a: ExperienceDTO, b: ExperienceDTO): number {
  const byName = normalizeRideTitle(a.name).localeCompare(normalizeRideTitle(b.name));
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Selects up to `STARTER_RIDES_MAX` active rides (`category === 'Ride'`) from the
 * unpaginated catalog query (`['catalog', 'all']`), preferring curated iconic rides
 * and deterministically backfilling by park round-robin when any curated ride is absent.
 */
export function selectStarterRides(
  experiences: readonly ExperienceDTO[],
): readonly ExperienceDTO[] {
  // Deduplicate active Ride entries deterministically by id before selection so
  // order of input array never perturbs curated or backfill order.
  const uniqueById = new Map<string, ExperienceDTO>();
  for (const exp of experiences) {
    if (exp.active === true && exp.category === 'Ride' && !uniqueById.has(exp.id)) {
      uniqueById.set(exp.id, exp);
    }
  }

  const activeRides = Array.from(uniqueById.values()).sort(compareByNameThenId);
  const selected: ExperienceDTO[] = [];
  const selectedIds = new Set<string>();

  for (const target of CURATED_STARTER_RIDES) {
    if (selected.length >= STARTER_RIDES_MAX) break;
    const targetNorm = normalizeRideTitle(target.name);
    const match = activeRides.find(
      (exp) =>
        !selectedIds.has(exp.id) &&
        exp.park === target.park &&
        normalizeRideTitle(exp.name).includes(targetNorm),
    );
    if (match) {
      selected.push(match);
      selectedIds.add(match.id);
    }
  }

  if (selected.length < STARTER_RIDES_MAX) {
    const remainingByPark = new Map<Park, ExperienceDTO[]>();
    for (const park of PARK_ROUND_ROBIN_ORDER) {
      remainingByPark.set(
        park,
        activeRides.filter((exp) => !selectedIds.has(exp.id) && exp.park === park),
      );
    }

    let madeProgress = true;
    while (selected.length < STARTER_RIDES_MAX && madeProgress) {
      madeProgress = false;
      for (const park of PARK_ROUND_ROBIN_ORDER) {
        if (selected.length >= STARTER_RIDES_MAX) break;
        const pool = remainingByPark.get(park);
        const next = pool?.shift();
        if (next) {
          selected.push(next);
          selectedIds.add(next.id);
          madeProgress = true;
        }
      }
    }

    if (selected.length < STARTER_RIDES_MAX) {
      for (const exp of activeRides) {
        if (selected.length >= STARTER_RIDES_MAX) break;
        if (!selectedIds.has(exp.id)) {
          selected.push(exp);
          selectedIds.add(exp.id);
        }
      }
    }
  }

  return selected;
}
