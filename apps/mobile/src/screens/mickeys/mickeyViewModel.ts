import type {
  MickeyDifficulty,
  MickeyListItemDTO,
  MickeySummaryDTO,
  MickeyZone,
  Park,
} from '@dwt/shared';

export interface ActiveAreaSummary {
  readonly found: number;
  readonly total: number;
  readonly percent: number;
  readonly subtext: string;
}

export interface GroupedVenueMickeyItem {
  readonly item: MickeyListItemDTO;
  readonly indexInVenue: number;
  readonly totalInVenue: number;
  readonly mickeyPositionLabel: string;
}

export interface MickeyVenueGroup {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly land: string | null;
  readonly areaSubtitle: string;
  readonly foundCount: number;
  readonly totalCount: number;
  readonly items: readonly GroupedVenueMickeyItem[];
}

export const ZONE_ICON_MAP: Readonly<Record<MickeyZone, string>> = {
  queue: 'hourglass-outline',
  pre_show: 'sparkles-outline',
  on_ride: 'flash-outline',
  exit: 'exit-outline',
  exterior: 'sunny-outline',
  interior: 'business-outline',
  grounds: 'leaf-outline',
};

export const DIFFICULTY_DOTS_MAP: Readonly<Record<MickeyDifficulty, string>> = {
  easy: '●',
  medium: '●●',
  hard: '●●●',
};

export function formatAreaSubtitle(item: {
  readonly park: Park | null;
  readonly land: string | null;
  readonly experienceName: string;
}): string {
  if (item.park && item.land && item.land !== item.experienceName) {
    return `${item.park} • ${item.land}`;
  }
  if (item.park) {
    return item.park;
  }
  if (item.land && item.land !== item.experienceName) {
    return item.land;
  }
  return 'Resort Area';
}

function computeBoundedPercent(found: number, total: number): number {
  if (total <= 0 || found <= 0) {
    return 0;
  }
  const rounded = Math.round((found / total) * 100);
  return Math.min(100, Math.max(1, rounded));
}

export function formatParkTabLabel(
  summary: MickeySummaryDTO | undefined,
  tab: 'All' | Park | 'Resort',
  selectedScope: 'all' | 'official' | 'community' = 'all',
  items?: readonly MickeyListItemDTO[],
): string {
  const baseLabel = tab === 'All' ? 'All Parks' : tab === 'Resort' ? 'Resorts' : tab;
  if (!summary && !items) {
    return baseLabel;
  }

  if (selectedScope === 'community') {
    const commItems = items ? items.filter((i) => !i.official) : [];
    if (tab === 'All') {
      const total = summary?.community.total ?? commItems.length;
      const found = summary?.community.found ?? commItems.filter((i) => i.found).length;
      return `${baseLabel} ${found}/${total}`;
    }
    if (tab === 'Resort') {
      const resortItems = commItems.filter((i) => i.park === null);
      return `${baseLabel} ${resortItems.filter((i) => i.found).length}/${resortItems.length}`;
    }
    const parkItems = commItems.filter((i) => i.park === tab);
    return `${baseLabel} ${parkItems.filter((i) => i.found).length}/${parkItems.length}`;
  }

  if (!summary) {
    return baseLabel;
  }
  if (tab === 'All') {
    return `${baseLabel} ${summary.overall.found}/${summary.overall.total}`;
  }
  if (tab === 'Resort') {
    const resortEntry = summary.byPark.find((p) => p.park === null);
    if (!resortEntry) return baseLabel;
    return `${baseLabel} ${resortEntry.found}/${resortEntry.total}`;
  }
  const parkEntry = summary.byPark.find((p) => p.park === tab);
  if (!parkEntry) return baseLabel;
  return `${baseLabel} ${parkEntry.found}/${parkEntry.total}`;
}

export function resolveActiveAreaSummary(
  summary: MickeySummaryDTO | undefined,
  selectedParkTab: 'All' | Park | 'Resort',
  selectedScope: 'all' | 'official' | 'community' = 'all',
  items?: readonly MickeyListItemDTO[],
): ActiveAreaSummary {
  if (selectedScope === 'community') {
    const commItems = items ? items.filter((i) => !i.official) : [];
    if (selectedParkTab === 'All') {
      const total = summary?.community.total ?? commItems.length;
      const found = summary?.community.found ?? commItems.filter((i) => i.found).length;
      const percent = computeBoundedPercent(found, total);
      return {
        found,
        total,
        percent,
        subtext: 'Community finds across Disney World',
      };
    }
    if (selectedParkTab === 'Resort') {
      const resortItems = commItems.filter((i) => i.park === null);
      const total = resortItems.length;
      const found = resortItems.filter((i) => i.found).length;
      const percent = computeBoundedPercent(found, total);
      return {
        found,
        total,
        percent,
        subtext: 'Disney Resort Hotels found',
      };
    }
    const parkItems = commItems.filter((i) => i.park === selectedParkTab);
    const total = parkItems.length;
    const found = parkItems.filter((i) => i.found).length;
    const percent = computeBoundedPercent(found, total);
    return {
      found,
      total,
      percent,
      subtext: `${selectedParkTab} found`,
    };
  }

  if (!summary) {
    return {
      found: 0,
      total: 0,
      percent: 0,
      subtext:
        selectedParkTab === 'All'
          ? 'Overall found across Disney World'
          : selectedParkTab === 'Resort'
            ? 'Disney Resort Hotels found'
            : `${selectedParkTab} found`,
    };
  }

  if (selectedParkTab === 'All') {
    const found = summary.overall.found;
    const total = summary.overall.total;
    const percent = computeBoundedPercent(found, total);
    return {
      found,
      total,
      percent,
      subtext: 'Overall found across Disney World',
    };
  }

  if (selectedParkTab === 'Resort') {
    const resortEntry = summary.byPark.find((p) => p.park === null);
    const found = resortEntry?.found ?? 0;
    const total = resortEntry?.total ?? 0;
    const percent = computeBoundedPercent(found, total);
    return {
      found,
      total,
      percent,
      subtext: 'Disney Resort Hotels found',
    };
  }

  const parkEntry = summary.byPark.find((p) => p.park === selectedParkTab);
  const found = parkEntry?.found ?? 0;
  const total = parkEntry?.total ?? 0;
  const percent = computeBoundedPercent(found, total);
  return {
    found,
    total,
    percent,
    subtext: `${selectedParkTab} found`,
  };
}

export function groupMickeysByVenue(
  items: readonly MickeyListItemDTO[],
): readonly MickeyVenueGroup[] {
  const map = new Map<string, MickeyListItemDTO[]>();
  for (const item of items) {
    const existing = map.get(item.experienceId);
    if (existing) {
      existing.push(item);
    } else {
      map.set(item.experienceId, [item]);
    }
  }

  const groups: MickeyVenueGroup[] = [];
  for (const [experienceId, groupItems] of map.entries()) {
    const first = groupItems[0]!;
    const totalInVenue = groupItems.length;
    const foundCount = groupItems.filter((i) => i.found).length;
    groups.push({
      experienceId,
      experienceName: first.experienceName,
      park: first.park,
      land: first.land,
      areaSubtitle: formatAreaSubtitle(first),
      foundCount,
      totalCount: totalInVenue,
      items: groupItems.map((item, idx) => ({
        item,
        indexInVenue: idx + 1,
        totalInVenue,
        mickeyPositionLabel: `Mickey ${idx + 1} of ${totalInVenue}`,
      })),
    });
  }

  return groups;
}

export function stepProgressLabel(mickey: {
  readonly clue2?: string | undefined;
  readonly reveal?: string | undefined;
  readonly hintLevel: 1 | 2 | 3;
  readonly found: boolean;
}): string {
  if (Boolean(mickey.reveal) || mickey.hintLevel >= 3 || mickey.found) {
    return 'All 3 Steps Unlocked';
  }
  if (Boolean(mickey.clue2) || mickey.hintLevel === 2) {
    return 'Step 2 of 3 Unlocked';
  }
  return 'Step 1 of 3 Unlocked';
}
