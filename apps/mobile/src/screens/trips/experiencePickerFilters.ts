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

import {
  FESTIVAL_SLUG_LABELS,
  PARKS,
  type ExperienceCategory,
  type ExperienceDTO,
  type Park,
} from '@dwt/shared';

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
  | 'breaks'
  | 'myLists'
  | 'favorites';

export const TAB_CATEGORIES: Record<
  ExperiencePickerTab,
  readonly ExperienceCategory[]
> = {
  all: [],
  attractions: ['Ride', 'Walkthrough', 'PlayArea', 'Game'],
  dining: ['Restaurant'],
  shows: ['Show', 'Parade', 'Character_Meet', 'Event'],
  breaks: [], // Unrestricted location search for breaks
  myLists: [], // Unrestricted — membership comes from the attached Experience_Lists, not a category
  favorites: [], // Unrestricted — membership comes from the User's Favorited_Set, not a category
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
  myLists: [],
  favorites: [],
};

/**
 * High-signal facet groups mined for attribute chips.
 * Includes height and age facet groups for dedicated Height/Physical filtering.
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
  'height',
  'age',
] as const;

export interface FilterChipItem {
  readonly id: string;
  readonly label: string;
  readonly kind: 'land' | 'attribute' | 'price' | 'festival';
  readonly rawValue: string;
  readonly accessibilityLabel: string;
}

export interface DerivedFilterChips {
  readonly landChips: readonly FilterChipItem[];
  readonly priceChips: readonly FilterChipItem[];
  readonly attributeChips: readonly FilterChipItem[];
  /**
   * One chip per distinct `festivalTag.slug` observed among the input
   * Experiences (festival-booth-tagging R8.9), labeled via
   * `FESTIVAL_SLUG_LABELS` (never the raw slug) and sorted by that display
   * label. Empty when no input Experience carries a `festivalTag`.
   */
  readonly festivalChips: readonly FilterChipItem[];
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
 * Internal or redundant Disney facet names/ids that pollute the attribute filter list.
 */
const SUPPRESSED_ATTRIBUTE_NAMES = new Set([
  'areaxx',
  'epcot areaxx',
  'menu category display',
  'walkupwaitlist',
  'festival kiosk',
  'theme park dining',
  'all quick service',
]);

export function isSuppressedAttributeFacet(name: string, id?: string): boolean {
  const n = name.trim().toLowerCase();
  const i = (id ?? '').trim().toLowerCase();
  if (SUPPRESSED_ATTRIBUTE_NAMES.has(n) || SUPPRESSED_ATTRIBUTE_NAMES.has(i)) {
    return true;
  }
  if (n.includes('areaxx') || i.includes('areaxx')) {
    return true;
  }
  return false;
}

const ATTRIBUTE_SYNONYM_CANONICAL = new Map<string, string>([
  ['bar-lounge', 'Bars/Lounges'],
  ['bars/lounges', 'Bars/Lounges'],
  ['snack', 'Snacks'],
  ['snacks', 'Snacks'],
]);

/**
 * Dynamically derives available Land chips, Price chips, and Attribute chips from loaded experiences.
 * Whitelists high-signal facet groups, derives price tiers, and dedupes by id OR case-insensitive trimmed name.
 */
export function deriveFilterChips(
  experiences: readonly ExperienceDTO[],
): DerivedFilterChips {
  const landSet = new Set<string>();
  const priceSet = new Set<string>();
  const festivalSlugSet = new Set<string>();
  const seenAttributeIds = new Set<string>();
  const seenAttributeNames = new Set<string>();
  const attributeChips: FilterChipItem[] = [];

  for (const exp of experiences) {
    // 1. Land / Country pavilion derivation
    const land = browseLandOf(exp);
    if (typeof land === 'string' && land.trim().length > 0) {
      landSet.add(land.trim());
    }

    // 1b. Festival derivation (festival-booth-tagging R8.9)
    if (exp.festivalTag) {
      festivalSlugSet.add(exp.festivalTag.slug);
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
                if (isSuppressedAttributeFacet(nameTrimmed, idTrimmed)) {
                  continue;
                }
                const canonicalName =
                  ATTRIBUTE_SYNONYM_CANONICAL.get(nameLower) ?? nameTrimmed;
                const canonicalLower = canonicalName.toLowerCase();

                const hasSeenId =
                  idLower.length > 0 && seenAttributeIds.has(idLower);
                const hasSeenName = seenAttributeNames.has(canonicalLower);

                if (!hasSeenId && !hasSeenName) {
                  if (idLower.length > 0) seenAttributeIds.add(idLower);
                  seenAttributeNames.add(canonicalLower);

                  const label = formatAttributeChipLabel(
                    canonicalName,
                    idTrimmed,
                  );
                  attributeChips.push({
                    id: idTrimmed || `attr-${canonicalLower}`,
                    label,
                    kind: 'attribute',
                    rawValue: canonicalName,
                    accessibilityLabel: `${canonicalName}, attribute filter`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // 3b. Physical considerations extraction
    if (Array.isArray(exp.physicalConsiderations)) {
      for (const facet of exp.physicalConsiderations) {
        if (typeof facet?.name === 'string') {
          const nameTrimmed = facet.name.trim();
          const nameLower = nameTrimmed.toLowerCase();
          const idTrimmed = typeof facet.id === 'string' ? facet.id.trim() : '';
          const idLower = idTrimmed.toLowerCase();

          if (nameTrimmed.length > 0 && !isSuppressedAttributeFacet(nameTrimmed, idTrimmed)) {
            const hasSeenId = idLower.length > 0 && seenAttributeIds.has(idLower);
            const hasSeenName = seenAttributeNames.has(nameLower);

            if (!hasSeenId && !hasSeenName) {
              if (idLower.length > 0) seenAttributeIds.add(idLower);
              seenAttributeNames.add(nameLower);

              const label = formatAttributeChipLabel(nameTrimmed, idTrimmed);
              attributeChips.push({
                id: idTrimmed || `physical-${nameLower}`,
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

    // 4. Fallback/supplemental subType extraction
    if (typeof exp.subType === 'string') {
      const subTypeTrimmed = exp.subType.trim();
      const subTypeLower = subTypeTrimmed.toLowerCase();
      if (
        subTypeTrimmed.length > 0 &&
        !isSuppressedAttributeFacet(subTypeTrimmed)
      ) {
        const canonicalName =
          ATTRIBUTE_SYNONYM_CANONICAL.get(subTypeLower) ?? subTypeTrimmed;
        const canonicalLower = canonicalName.toLowerCase();
        if (!seenAttributeNames.has(canonicalLower)) {
          seenAttributeNames.add(canonicalLower);
          const label = formatAttributeChipLabel(canonicalName);
          attributeChips.push({
            id: `subtype-${canonicalLower}`,
            label,
            kind: 'attribute',
            rawValue: canonicalName,
            accessibilityLabel: `${canonicalName}, attribute filter`,
          });
        }
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

  // Festival chips: one per distinct observed slug, labeled via
  // FESTIVAL_SLUG_LABELS (never the raw slug), sorted by that display label.
  const festivalChips: FilterChipItem[] = Array.from(festivalSlugSet)
    .map((slug) => ({
      id: `festival-${slug}`,
      label: FESTIVAL_SLUG_LABELS[slug as keyof typeof FESTIVAL_SLUG_LABELS],
      kind: 'festival' as const,
      rawValue: slug,
      accessibilityLabel: `${FESTIVAL_SLUG_LABELS[slug as keyof typeof FESTIVAL_SLUG_LABELS]}, festival filter`,
    }))
    .sort((a, b) => compareCaseInsensitive(a.label, b.label));

  return {
    landChips,
    priceChips,
    attributeChips,
    festivalChips,
    allChips: [...landChips, ...priceChips, ...attributeChips, ...festivalChips],
  };
}

/**
 * Extracts top 3-4 popular quick-toggle chips for the active tab from derived chips,
 * prioritizing active festivals when browsing dining or all tabs.
 */
export function deriveQuickChips(
  attributeChips: readonly FilterChipItem[],
  activeTab: ExperiencePickerTab,
  priceChips: readonly FilterChipItem[] = [],
  festivalChips: readonly FilterChipItem[] = [],
): readonly FilterChipItem[] {
  const popularKeywords = POPULAR_QUICK_TAGS_BY_TAB[activeTab] ?? [];
  const quickChips: FilterChipItem[] = [];
  const pickedIds = new Set<string>();

  // Prioritize active festival chips when on dining or all tabs
  if (
    (activeTab === 'all' || activeTab === 'dining') &&
    festivalChips.length > 0
  ) {
    for (const fc of festivalChips) {
      if (!pickedIds.has(fc.id)) {
        quickChips.push(fc);
        pickedIds.add(fc.id);
        if (quickChips.length >= 2) break;
      }
    }
  }

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
  const targets = new Set<string>([target]);
  if (target === 'bars/lounges' || target === 'bar-lounge') {
    targets.add('bars/lounges');
    targets.add('bar-lounge');
  } else if (target === 'snacks' || target === 'snack') {
    targets.add('snacks');
    targets.add('snack');
  }

  if (
    typeof exp.priceTier === 'string' &&
    targets.has(exp.priceTier.trim().toLowerCase())
  ) {
    return true;
  }
  if (
    typeof exp.subType === 'string' &&
    targets.has(exp.subType.trim().toLowerCase())
  ) {
    return true;
  }
  if (Array.isArray(exp.physicalConsiderations)) {
    for (const pc of exp.physicalConsiderations) {
      if (
        (typeof pc?.name === 'string' && targets.has(pc.name.trim().toLowerCase())) ||
        (typeof pc?.id === 'string' && targets.has(pc.id.trim().toLowerCase()))
      ) {
        return true;
      }
    }
  }
  if (
    exp.heightRequirement &&
    typeof exp.heightRequirement.name === 'string' &&
    targets.has(exp.heightRequirement.name.trim().toLowerCase())
  ) {
    return true;
  }
  if (exp.groupedFacets) {
    for (const groupKey of WHITELISTED_FACET_GROUPS) {
      const facets = exp.groupedFacets[groupKey];
      if (Array.isArray(facets)) {
        for (const facet of facets) {
          if (
            (typeof facet?.name === 'string' &&
              targets.has(facet.name.trim().toLowerCase())) ||
            (typeof facet?.id === 'string' &&
              targets.has(facet.id.trim().toLowerCase()))
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
 * Filters experiences matching active land set (OR), active tag set (OR), and
 * active festival set (OR), intersecting with AND across the three
 * dimensions. When all three sets are empty, returns the input array
 * unmodified (identity) — this keeps every existing call site that passes no
 * `selectedFestivals` argument (an implicit empty set) behavior-identical to
 * before `selectedFestivals` existed (festival-booth-tagging R8.10).
 */
export function filterExperiencesMulti(
  experiences: readonly ExperienceDTO[],
  selectedLands: ReadonlySet<string>,
  selectedTags: ReadonlySet<string>,
  selectedFestivals: ReadonlySet<string> = new Set(),
): readonly ExperienceDTO[] {
  if (
    selectedLands.size === 0 &&
    selectedTags.size === 0 &&
    selectedFestivals.size === 0
  ) {
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

    // 3. Festival check (OR within selected festivals, festival-booth-tagging R8.10)
    if (selectedFestivals.size > 0) {
      if (!exp.festivalTag || !selectedFestivals.has(exp.festivalTag.slug)) {
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
      : activeTab === 'myLists'
      ? 'list items'
      : activeTab === 'favorites'
      ? 'favorited experiences'
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
