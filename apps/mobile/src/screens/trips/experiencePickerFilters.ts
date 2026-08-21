/**
 * Pure helper functions for the ExperiencePicker multi-tier filtering & Land grouping.
 *
 * Encodes Property 19:
 *   - deriveFilterChips: pure, partitioned derivation of unique landChips and unique attributeChips.
 *     Attribute chips are mined from high-signal whitelisted facet groups (interests, thrillFactor,
 *     parkInterests, disneyFavorites, tableService, quickService, dining) + subType, explicitly
 *     excluding noisy age and height groups, and deduped by id OR case-insensitive trimmed name.
 *   - matchesExperienceAttribute: checks if an experience carries a matching attribute facet or subType.
 *   - filterExperiencesMulti: multi-select filtering combining OR within dimensions and AND across dimensions.
 *   - resolveParkScope: exhaustive mapping from DestinationId | 'all' to { parkId?: string; areaType?: 'Resort' }.
 *   - isKnownPark: strict type guard for canonical members of PARKS.
 *
 * Validates: Requirements 4.12, 4.15
 */

import { PARKS, type ExperienceCategory, type ExperienceDTO, type Park } from '@dwt/shared';

import { browseLandOf } from '../catalog/catalogGrouping';
import {
  DESTINATIONS,
  destinationCatalogFilter,
  type DestinationId,
} from '../catalog/destinations';

export type ExperiencePickerTab =
  | 'all'
  | 'attractions'
  | 'dining'
  | 'shows'
  | 'breaks';

export const TAB_CATEGORIES: Record<
  ExperiencePickerTab,
  readonly ExperienceCategory[]
> = {
  all: [],
  attractions: ['Ride'],
  dining: ['Restaurant'],
  shows: ['Show', 'Parade', 'Character_Meet', 'Event'],
  breaks: [], // Unrestricted location search for breaks
};

export const POPULAR_QUICK_TAGS_BY_TAB: Record<
  ExperiencePickerTab,
  readonly string[]
> = {
  all: ['Thrill Rides', 'Quick Service', 'Table Service', 'Slow Rides'],
  attractions: ['Thrill Rides', 'Slow Rides', 'Water Rides', 'Dark'],
  dining: ['Quick Service', 'Table Service', '$', '$$', 'Character Dining'],
  shows: ['Nighttime Spectacular', 'Stage Shows', 'Parades', 'Character Meets'],
  breaks: [],
};

/**
 * High-signal facet groups mined for attribute chips.
 * Excludes noisy ubiquitous groups like 'age' and 'height'.
 */
export const WHITELISTED_FACET_GROUPS = [
  'interests',
  'thrillFactor',
  'parkInterests',
  'disneyFavorites',
  'diningInterests',
  'cuisine',
  'dining',
  'tableService',
  'quickService',
] as const;

export interface FilterChipItem {
  readonly id: string;
  readonly label: string;
  readonly kind: 'land' | 'attribute' | 'price';
  readonly rawValue: string;
  readonly accessibilityLabel: string;
}

export interface DerivedFilterChips {
  readonly landChips: readonly FilterChipItem[];
  readonly priceChips: readonly FilterChipItem[];
  readonly attributeChips: readonly FilterChipItem[];
  readonly allChips: readonly FilterChipItem[];
}

/**
 * Compare two strings case-insensitively and accent-insensitively.
 */
function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

const PRICE_TIER_ORDER: Record<string, number> = {
  '$': 1,
  '$$': 2,
  '$$$': 3,
  '$$$$': 4,
};

/**
 * Formats a price tier display label with clean range annotations.
 */
export function formatPriceChipLabel(priceTier: string): string {
  const tier = priceTier.trim();
  switch (tier) {
    case '$':
      return '💵 $ (Under $15)';
    case '$$':
      return '💵 $$ ($15–$35)';
    case '$$$':
      return '💵 $$$ ($35–$60)';
    case '$$$$':
      return '💵 $$$$ ($60+)';
    default:
      return `💵 ${tier}`;
  }
}

/**
 * Formats an attribute display label with a thematic icon.
 */
export function formatAttributeChipLabel(name: string, id?: string): string {
  const n = name.toLowerCase();
  const i = (id ?? '').toLowerCase();
  if (n.includes('thrill') || i.includes('thrill')) return `🎢 ${name}`;
  if (n.includes('slow') || n.includes('gentle') || i.includes('slow')) return `🐢 ${name}`;
  if (n.includes('water') || i.includes('water')) return `🌊 ${name}`;
  if (n.includes('dark') || n.includes('indoor') || i.includes('dark')) return `🌙 ${name}`;
  if (n.includes('classic') || i.includes('classic')) return `🏰 ${name}`;
  if (n.includes('interactive') || i.includes('interactive')) return `🎯 ${name}`;
  if (n.includes('quick service') || i.includes('quick-service') || n.includes('counter service')) return `🍔 ${name}`;
  if (n.includes('table service') || i.includes('table-service') || n.includes('casual dining') || n.includes('fine / signature') || n.includes('fine/signature')) return `🍽️ ${name}`;
  if (n.includes('character') || i.includes('character')) return `👑 ${name}`;
  if (n.includes('lounge') || n.includes('bar') || i.includes('lounge')) return `🍸 ${name}`;
  if (n.includes('buffet') || i.includes('buffet')) return `🥗 ${name}`;
  if (n.includes('firework') || i.includes('firework')) return `🎆 ${name}`;
  if (n.includes('stage') || i.includes('stage')) return `🎭 ${name}`;
  if (n.includes('spectacular') || i.includes('spectacular')) return `✨ ${name}`;
  if (n.includes('parade') || i.includes('parade')) return `🥁 ${name}`;
  if (n.includes('mexican') || i.includes('mexican') || n.includes('latin') || i.includes('latin')) return `🌮 ${name}`;
  if (n.includes('italian') || i.includes('italian') || n.includes('pizza') || i.includes('pizza')) return `🍝 ${name}`;
  if (n.includes('french') || i.includes('french') || n.includes('bakery') || i.includes('bakery')) return `🥐 ${name}`;
  if (n.includes('asian') || i.includes('asian') || n.includes('japanese') || i.includes('japanese') || n.includes('chinese') || i.includes('chinese') || n.includes('sushi') || i.includes('sushi')) return `🍱 ${name}`;
  if (n.includes('seafood') || i.includes('seafood')) return `🦞 ${name}`;
  if (n.includes('steakhouse') || i.includes('steakhouse') || n.includes('american') || i.includes('american')) return `🥩 ${name}`;
  return `✨ ${name}`;
}

/**
 * Dynamically derives available Land chips, Price chips, and Attribute chips from loaded experiences.
 * Whitelists high-signal facet groups, derives price tiers, and dedupes by id OR case-insensitive trimmed name.
 */
export function deriveFilterChips(
  experiences: readonly ExperienceDTO[],
): DerivedFilterChips {
  const landSet = new Set<string>();
  const priceSet = new Set<string>();
  const seenAttributeIds = new Set<string>();
  const seenAttributeNames = new Set<string>();
  const attributeChips: FilterChipItem[] = [];

  for (const exp of experiences) {
    // 1. Land / Country pavilion derivation
    const land = browseLandOf(exp);
    if (typeof land === 'string' && land.trim().length > 0) {
      landSet.add(land.trim());
    }

    // 2. Price tier derivation
    if (typeof exp.priceTier === 'string' && exp.priceTier.trim().length > 0) {
      priceSet.add(exp.priceTier.trim());
    }

    // 3. Whitelisted facet group extraction
    if (exp.groupedFacets) {
      for (const groupKey of WHITELISTED_FACET_GROUPS) {
        const facets = exp.groupedFacets[groupKey];
        if (Array.isArray(facets)) {
          for (const facet of facets) {
            if (typeof facet?.name === 'string') {
              const nameTrimmed = facet.name.trim();
              const nameLower = nameTrimmed.toLowerCase();
              const idTrimmed = typeof facet.id === 'string' ? facet.id.trim() : '';
              const idLower = idTrimmed.toLowerCase();

              if (nameTrimmed.length > 0) {
                const hasSeenId = idLower.length > 0 && seenAttributeIds.has(idLower);
                const hasSeenName = seenAttributeNames.has(nameLower);

                if (!hasSeenId && !hasSeenName) {
                  if (idLower.length > 0) seenAttributeIds.add(idLower);
                  seenAttributeNames.add(nameLower);

                  const label = formatAttributeChipLabel(nameTrimmed, idTrimmed);
                  attributeChips.push({
                    id: idTrimmed || `attr-${nameLower}`,
                    label,
                    kind: 'attribute',
                    rawValue: nameTrimmed,
                    accessibilityLabel: `${nameTrimmed}, attribute filter`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // 4. Fallback/supplemental subType extraction
    if (typeof exp.subType === 'string') {
      const subTypeTrimmed = exp.subType.trim();
      const subTypeLower = subTypeTrimmed.toLowerCase();
      if (subTypeTrimmed.length > 0 && !seenAttributeNames.has(subTypeLower)) {
        seenAttributeNames.add(subTypeLower);
        const label = formatAttributeChipLabel(subTypeTrimmed);
        attributeChips.push({
          id: `subtype-${subTypeLower}`,
          label,
          kind: 'attribute',
          rawValue: subTypeTrimmed,
          accessibilityLabel: `${subTypeTrimmed}, attribute filter`,
        });
      }
    }
  }

  // Sort land chips case-insensitively ascending
  const landChips: FilterChipItem[] = Array.from(landSet)
    .sort(compareCaseInsensitive)
    .map((land) => ({
      id: `land-${land.toLowerCase()}`,
      label: `📍 ${land}`,
      kind: 'land',
      rawValue: land,
      accessibilityLabel: `${land}, land filter`,
    }));

  // Sort price chips by canonical tier order
  const priceChips: FilterChipItem[] = Array.from(priceSet)
    .sort((a, b) => (PRICE_TIER_ORDER[a] ?? 99) - (PRICE_TIER_ORDER[b] ?? 99))
    .map((tier) => ({
      id: `price-${tier.toLowerCase().replace(/\$/g, 's')}`,
      label: formatPriceChipLabel(tier),
      kind: 'price',
      rawValue: tier,
      accessibilityLabel: `Price tier: ${tier}`,
    }));

  // Sort attribute chips case-insensitively ascending by rawValue
  attributeChips.sort((a, b) => compareCaseInsensitive(a.rawValue, b.rawValue));

  return {
    landChips,
    priceChips,
    attributeChips,
    allChips: [...landChips, ...priceChips, ...attributeChips],
  };
}

/**
 * Extracts top 3-4 popular quick-toggle chips for the active tab from derived attribute and price chips.
 */
export function deriveQuickChips(
  attributeChips: readonly FilterChipItem[],
  activeTab: ExperiencePickerTab,
  priceChips: readonly FilterChipItem[] = [],
): readonly FilterChipItem[] {
  const popularKeywords = POPULAR_QUICK_TAGS_BY_TAB[activeTab] ?? [];
  const quickChips: FilterChipItem[] = [];
  const pickedIds = new Set<string>();

  const pool = [...priceChips, ...attributeChips];

  // 1. Try to match prioritized tags first
  for (const keyword of popularKeywords) {
    const kwLower = keyword.toLowerCase();
    const matched = pool.find(
      (c) =>
        !pickedIds.has(c.id) &&
        (c.rawValue.toLowerCase() === kwLower ||
          c.rawValue.toLowerCase().includes(kwLower) ||
          kwLower.includes(c.rawValue.toLowerCase())),
    );
    if (matched) {
      const quickChipItem: FilterChipItem =
        matched.kind === 'price'
          ? {
              ...matched,
              label: `💵 ${matched.rawValue}`,
            }
          : matched;
      quickChips.push(quickChipItem);
      pickedIds.add(matched.id);
      if (quickChips.length >= 4) break;
    }
  }

  // 2. If fewer than 3 found, fill from available pool up to 3 or 4
  if (quickChips.length < 3) {
    for (const chip of pool) {
      if (!pickedIds.has(chip.id)) {
        const quickChipItem: FilterChipItem =
          chip.kind === 'price'
            ? {
                ...chip,
                label: `💵 ${chip.rawValue}`,
              }
            : chip;
        quickChips.push(quickChipItem);
        pickedIds.add(chip.id);
        if (quickChips.length >= 3) break;
      }
    }
  }

  return quickChips;
}

/**
 * Checks whether an experience matches a given attribute or price raw value (case-insensitively).
 */
export function matchesExperienceAttribute(
  exp: ExperienceDTO,
  attributeRawValue: string,
): boolean {
  const target = attributeRawValue.trim().toLowerCase();
  if (typeof exp.priceTier === 'string' && exp.priceTier.trim().toLowerCase() === target) {
    return true;
  }
  if (typeof exp.subType === 'string' && exp.subType.trim().toLowerCase() === target) {
    return true;
  }
  if (exp.groupedFacets) {
    for (const groupKey of WHITELISTED_FACET_GROUPS) {
      const facets = exp.groupedFacets[groupKey];
      if (Array.isArray(facets)) {
        for (const facet of facets) {
          if (
            (typeof facet?.name === 'string' && facet.name.trim().toLowerCase() === target) ||
            (typeof facet?.id === 'string' && facet.id.trim().toLowerCase() === target)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Map a chosen DestinationId (or 'all') to the query parameter object accepted by GET /catalog.
 * Reuses the canonical `destinationCatalogFilter` from `destinations.ts`.
 */
export function resolveParkScope(
  selectedPark: DestinationId | 'all',
): { parkId?: string; areaType?: 'Resort' } {
  if (selectedPark === 'all') {
    return {};
  }
  const destination = DESTINATIONS.find((d) => d.id === selectedPark);
  if (!destination) {
    return {};
  }
  return destinationCatalogFilter(destination);
}

/**
 * Filters experiences matching active land set (OR) and active tag set (OR),
 * intersecting with AND across categories.
 * When both sets are empty, returns the input array unmodified (identity).
 */
export function filterExperiencesMulti(
  experiences: readonly ExperienceDTO[],
  selectedLands: ReadonlySet<string>,
  selectedTags: ReadonlySet<string>,
): readonly ExperienceDTO[] {
  if (selectedLands.size === 0 && selectedTags.size === 0) {
    return experiences;
  }

  return experiences.filter((exp) => {
    // 1. Land check (OR within selected lands)
    if (selectedLands.size > 0) {
      const expLand = browseLandOf(exp);
      if (!expLand || !selectedLands.has(expLand.trim())) {
        return false;
      }
    }

    // 2. Attribute check (OR within selected tags)
    if (selectedTags.size > 0) {
      let matchesAnyTag = false;
      for (const tag of selectedTags) {
        if (matchesExperienceAttribute(exp, tag)) {
          matchesAnyTag = true;
          break;
        }
      }
      if (!matchesAnyTag) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Strict type-guard narrowing a string (e.g. from DayTouringHoursDTO.startingPark) to Park.
 */
export function isKnownPark(val: unknown): val is Park {
  return typeof val === 'string' && (PARKS as readonly string[]).includes(val);
}

/**
 * Format a human-friendly message when no experiences match the active filters or query.
 */
export function formatEmptyFilterMessage(
  selectedPark: DestinationId | 'all',
  activeTab: ExperiencePickerTab,
  query: string,
  hasActiveFilters: boolean,
): string {
  const tabLabel =
    activeTab === 'attractions'
      ? 'rides'
      : activeTab === 'dining'
      ? 'restaurants'
      : activeTab === 'shows'
      ? 'shows'
      : activeTab === 'breaks'
      ? 'locations'
      : 'experiences';

  const parkLabel = selectedPark !== 'all' ? ` in ${selectedPark}` : '';

  if (query.trim().length > 0) {
    return `No ${tabLabel}${parkLabel} matched “${query.trim()}”.`;
  }
  if (hasActiveFilters) {
    return `No ${tabLabel}${parkLabel} found matching active filters.`;
  }
  if (selectedPark !== 'all') {
    return `No ${tabLabel} found in ${selectedPark} matching active filters.`;
  }
  return `No ${tabLabel} matched active filters.`;
}

/**
 * Format a search hint message when the picker is inactive.
 */
export function formatSearchHintMessage(): string {
  return 'Search for experiences to add to your plan.';
}
