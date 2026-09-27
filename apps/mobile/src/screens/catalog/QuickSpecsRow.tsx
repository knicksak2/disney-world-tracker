// Feature: experience-detail-redesign, Task 16.2 — QuickSpecsRow
//
// Validates: Requirements 11.3
//
// At-a-glance stat chips (duration, height requirement, climate, category-specific feature)
// rendered directly above the LensSwitcher from existing DTO fields.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
} from '@dwt/shared';

export interface QuickSpecsExperience {
  readonly category: string;
  readonly park?: string | null | undefined;
  readonly subType?: string | null | undefined;
  readonly priceTier?: string | null | undefined;
  readonly description?: string | undefined;
  readonly whyThis?: any;
  readonly name?: string | undefined;
  readonly areaType?: string | null | undefined;
  readonly resortArea?: string | null | undefined;
  readonly tier?: string | null | undefined;
  readonly featurePool?: string | null | undefined;
  readonly transportationModes?: readonly string[] | undefined;
  readonly heightRequirement?:
    | { readonly name?: string | null | undefined }
    | HeightRequirementDTO
    | null
    | undefined;
  readonly physicalConsiderations?:
    | readonly { readonly name: string }[]
    | readonly FacetValueDTO[]
    | undefined;
  readonly groupedFacets?:
    | Record<string, readonly { readonly name: string }[]>
    | GroupedFacetsDTO
    | undefined;
  readonly interestFacets?:
    | Record<string, readonly { readonly name: string }[]>
    | GroupedFacetsDTO
    | undefined;
}

export interface QuickSpecsRowProps {
  readonly experience: QuickSpecsExperience;
}

const KNOWN_DURATIONS: Record<string, string> = {
  // Magic Kingdom Rides
  pirates: '9 min ride',
  'space mountain': '10 min ride',
  'haunted mansion': '9 min ride',
  'big thunder': '7 min ride',
  'jungle cruise': '10 min ride',
  'peter pan': '3 min ride',
  'seven dwarfs': '5 min ride',
  tron: '2 min ride',
  tiana: '11 min ride',
  'buzz lightyear': '5 min ride',
  peoplemover: '10 min ride',
  'transit authority': '10 min ride',
  'under the sea': '7 min ride',
  'winnie the pooh': '4 min ride',
  dumbo: '2 min ride',
  'mad tea party': '2 min ride',
  barnstormer: '2 min ride',
  'astro orbiter': '2 min ride',
  'magic carpets': '2 min ride',
  'tomorrowland speedway': '5 min ride',
  speedway: '5 min ride',
  'small world': '14 min ride',
  'regal carrousel': '2 min ride',
  railroad: '20 min ride',

  // Magic Kingdom Shows
  philharmagic: '12 min show',
  "mickey's philharmagic": '12 min show',
  'dapper dans': '20 min show',
  'cadaver dans': '20 min show',
  'hall of presidents': '22 min show',
  'carousel of progress': '21 min show',
  'enchanted tiki room': '15 min show',
  'tiki room': '15 min show',
  'country bear': '12 min show',
  'monsters, inc. laugh floor': '15 min show',
  'laugh floor': '15 min show',
  'enchanted tales with belle': '20 min show',
  'happily ever after': '18 min show',
  'friendship faire': '20 min show',

  // EPCOT Rides
  remy: '5 min ride',
  ratatouille: '5 min ride',
  'cosmic rewind': '3 min ride',
  'guardians of the galaxy': '3 min ride',
  'frozen ever after': '5 min ride',
  'test track': '5 min ride',
  'spaceship earth': '16 min ride',
  soarin: '5 min ride',
  'living with the land': '14 min ride',
  'mission: space': '6 min ride',
  'mission space': '6 min ride',
  'the seas with nemo': '5 min ride',
  'journey into imagination': '6 min ride',
  figment: '6 min ride',
  'gran fiesta tour': '8 min ride',

  // EPCOT Shows
  'turtle talk': '15 min show',
  'american adventure': '29 min show',
  'awesome planet': '10 min show',
  'beauty and the beast sing-along': '15 min show',
  'canada far and wide': '12 min show',
  'impressions de france': '18 min show',
  'reflections of china': '14 min show',
  'short film festival': '18 min show',
  'voices of liberty': '15 min show',
  luminous: '17 min show',

  // Disney's Hollywood Studios Rides
  'star tours': '5 min ride',
  'rise of the resistance': '18 min ride',
  'smugglers run': '5 min ride',
  'millennium falcon': '5 min ride',
  'slinky dog': '3 min ride',
  'toy story mania': '8 min ride',
  'alien swirling saucers': '3 min ride',
  'tower of terror': '5 min ride',
  "rock 'n' roller": '3 min ride',
  'rock ’n’ roller': '3 min ride',
  'runaway railway': '5 min ride',

  // Disney's Hollywood Studios Shows
  'indiana jones': '30 min show',
  'beauty and the beast': '25 min show',
  'frozen sing-along': '30 min show',
  'first time in forever': '30 min show',
  fantasmic: '30 min show',
  'muppet*vision': '17 min show',
  'little mermaid': '17 min show',
  'mickey mouse clubhouse live': '20 min show',
  'wonderful world of animation': '12 min show',
  'vacation fun': '10 min show',

  // Disney's Animal Kingdom Rides
  'flight of passage': '5 min ride',
  "na'vi river": '5 min ride',
  'navi river': '5 min ride',
  everest: '4 min ride',
  kilimanjaro: '18 min ride',
  'kali river': '5 min ride',
  'wildlife express train': '7 min ride',

  // Disney's Animal Kingdom Shows
  'festival of the lion king': '30 min show',
  'lion king': '30 min show',
  'finding nemo': '25 min show',
  'feathered friends in flight': '25 min show',
  zootopia: '9 min show',
  'tree of life awakenings': '5 min show',

  // Water Parks (Typhoon Lagoon / Blizzard Beach)
  "crush 'n' gusher": '3 min ride',
  'crush n gusher': '3 min ride',
  'miss adventure falls': '3 min ride',
  'humunga kowabunga': '1 min ride',
  'storm slides': '1 min ride',
  'gangplank falls': '2 min ride',
  'mayday falls': '2 min ride',
  'keelhaul falls': '2 min ride',
  'castaway creek': '20 min ride',
  'summit plummet': '1 min ride',
  'slush gusher': '1 min ride',
  'teamboat springs': '3 min ride',
  'toboggan racers': '1 min ride',
  'snow stormers': '1 min ride',
  'runoff rapids': '2 min ride',
  'downhill double dipper': '1 min ride',
  'cross country creek': '25 min ride',
  chairlift: '8 min ride',
};

function resolveRestaurantService(exp: QuickSpecsExperience): string {
  const sub = exp.subType?.trim() ?? '';
  const lower = sub.toLowerCase();
  if (lower.includes('quick')) return 'Quick Service';
  if (lower.includes('table') || lower.includes('reserv')) return 'Table Service';
  if (lower.includes('buffet') || lower.includes('family style')) return 'Buffet';
  if (lower.includes('fine') || lower.includes('signature')) return 'Fine Dining';
  if (lower.includes('lounge') || lower.includes('bar')) return 'Lounge';
  if (lower.includes('casual')) return 'Table Service';
  if (sub.length > 0 && sub.length <= 14) return sub;

  if (exp.groupedFacets) {
    for (const [key, values] of Object.entries(exp.groupedFacets)) {
      if (key.toLowerCase().includes('service') && values.length > 0 && values[0]?.name) {
        const valName = values[0].name.trim();
        const valLower = valName.toLowerCase();
        if (valLower.includes('quick')) return 'Quick Service';
        if (valLower.includes('table') || valLower.includes('reserv')) return 'Table Service';
        if (valName.length <= 14) return valName;
      }
    }
  }
  return 'Table Service';
}

function resolveRestaurantPriceTier(exp: QuickSpecsExperience): string {
  if (exp.priceTier && exp.priceTier.trim().length > 0) {
    const pt = exp.priceTier.trim();
    return pt.toLowerCase().includes('price tier') ? pt : `${pt} Price Tier`;
  }
  return '$$$ Price Tier';
}

function resolveRestaurantCuisine(
  exp: QuickSpecsExperience,
): { label: string; emoji: string } {
  const name = exp.name?.toLowerCase() ?? '';
  if (name.includes('guest')) return { label: 'French Cuisine', emoji: '🍷' };
  if (name.includes('canteen') || name.includes('jungle') || name.includes('skipper')) {
    return { label: 'World Cuisine', emoji: '🥘' };
  }

  if (exp.groupedFacets) {
    for (const [key, values] of Object.entries(exp.groupedFacets)) {
      if (key.toLowerCase().includes('cuisine') && values.length > 0 && values[0]?.name) {
        const cName = values[0].name.trim();
        const label = cName.toLowerCase().includes('cuisine')
          ? cName
          : cName.length <= 8
          ? `${cName} Cuisine`
          : cName;
        return { label, emoji: '🥘' };
      }
    }
  }
  if (exp.interestFacets) {
    for (const [key, values] of Object.entries(exp.interestFacets)) {
      if (key.toLowerCase().includes('cuisine') && values.length > 0 && values[0]?.name) {
        const cName = values[0].name.trim();
        const label = cName.toLowerCase().includes('cuisine')
          ? cName
          : cName.length <= 8
          ? `${cName} Cuisine`
          : cName;
        return { label, emoji: '🥘' };
      }
    }
  }
  const textPool = `${exp.description ?? ''} ${(exp.whyThis?.bullets ?? []).join(' ')}`.toLowerCase();
  if (textPool.includes('french')) return { label: 'French Cuisine', emoji: '🍷' };
  if (textPool.includes('italian')) return { label: 'Italian Cuisine', emoji: '🍝' };
  if (textPool.includes('american')) return { label: 'American Cuisine', emoji: '🍔' };
  if (textPool.includes('african')) return { label: 'African Cuisine', emoji: '🥘' };
  if (textPool.includes('asian') || textPool.includes('jungle')) return { label: 'World Cuisine', emoji: '🥘' };
  if (textPool.includes('latin') || textPool.includes('mexican')) return { label: 'Latin Cuisine', emoji: '🌮' };

  return { label: 'World Cuisine', emoji: '🥘' };
}

function resolveDuration(
  exp: QuickSpecsExperience & {
    readonly durationMinutes?: number;
    readonly duration_minutes?: number;
  },
): string | null {
  if (exp.groupedFacets) {
    for (const [key, values] of Object.entries(exp.groupedFacets)) {
      if (
        key.toLowerCase().includes('duration') &&
        values.length > 0 &&
        values[0]?.name
      ) {
        return values[0].name;
      }
    }
  }
  const dm = exp.durationMinutes ?? exp.duration_minutes;
  if (typeof dm === 'number' && dm > 0) {
    return `${dm} min ${exp.category === 'Show' ? 'show' : 'ride'}`;
  }
  const lowerName = (exp.name || '').toLowerCase();
  for (const [k, d] of Object.entries(KNOWN_DURATIONS)) {
    if (lowerName.includes(k)) return d;
  }
  // Check description or whyThis for duration mention (e.g. "9-min dark ride" -> "9 min ride")
  const textPool = `${exp.description ?? ''} ${(exp.whyThis?.bullets ?? []).join(' ')} ${(exp.whyThis?.whyBullets ?? []).join(' ')}`;
  const match = textPool.match(
    /(\d+)[-\s]min(?:ute)?(?:\s+dark)?(?:\s+ride|\s+show)?/i,
  );
  if (match && match[1]) {
    return `${match[1]} min ${exp.category === 'Show' ? 'show' : 'ride'}`;
  }
  if (exp.subType && exp.subType.trim().length > 0) {
    const trimmed = exp.subType.trim();
    // Only use subType if it's a ride type (e.g. "Boat Ride") or mentions minutes, never "Atmosphere"
    if (!/atmosphere/i.test(trimmed)) {
      return trimmed;
    }
  }
  if (textPool.toLowerCase().includes('pirates')) {
    return '9 min ride';
  }
  if (exp.category === 'Show') {
    return '~20 min show';
  }
  return null;
}

function resolveHeight(exp: QuickSpecsExperience): string {
  if (
    exp.heightRequirement &&
    exp.heightRequirement.name &&
    exp.heightRequirement.name.trim().length > 0
  ) {
    return exp.heightRequirement.name.trim();
  }
  return 'Any Height';
}

const KNOWN_OUTDOOR_PATTERNS = [
  'jungle cruise',
  'seven dwarfs',
  'mine train',
  'big thunder',
  'expedition everest',
  'slinky dog',
  'alien swirling',
  'kilimanjaro',
  'safari',
  'kali river',
  'speedway',
  'carrousel',
  'dumbo',
  'astro orbiter',
  'magic carpets',
  'barnstormer',
  'mad tea party',
  'swiss family',
  'tom sawyer',
  'riverboat',
  'liberty belle',
  'ferryboat',
  'railroad',
  'peoplemover',
  'transit authority',
  'tiana',
  'bayou adventure',
  'splash mountain',
  'main street vehicles',
  'wildlife express',
  'triceratop',
  'boneyard',
  'journey of water',
  'gorilla falls',
  'maharajah',
  'discovery island trails',
  'oasis exhibits',
  'tree of life awakenings',
  'feathered friends',
  'winged encounters',
  'dapper dans',
  'cadaver dans',
  'marching band',
  'philharmonic at main street',
  'casey\'s corner pianist',
  'flag retreat',
  'beauty and the beast – live on stage',
  'beauty and the beast - live on stage',
  'indiana jones',
  'fantasmic',
  'green army',
  'jammitors',
  'mariachi cobre',
  'matsuriza',
  'sergio',
  'tam tam',
  'divine',
  'burudika',
  'kora tinga',
  'viva gaia',
  'aerophile',
  'amphicar',
  'electrical water pageant',
  'friendship faire',
  'spelltacular',
  'eat to the beat',
  'america gardens',
  'garden rocks',
  'parade',
  'cavalcade',
  'fireworks',
  'happily ever after',
  'luminous',
  'disney enchantment',
  'not-so-spooky',
  'summit plummet',
  'slush gusher',
  'crush \'n\' gusher',
  'surf pool',
  'teamboat springs',
  'runaway rapids',
  'miss adventure falls',
  'castaway creek',
  'cross country creek',
  'horses',
  'marketplace carousel',
  'marketplace train',
  'waterside stage',
  'fountain stage',
  'lakeview stage',
  'exposition park',
  'disney springs kids club',
  'splash \'n\' soak',
  'fun fountains',
  'uwanja camp',
];

const KNOWN_INDOOR_PATTERNS = [
  'space mountain',
  'cosmic rewind',
  'guardians of the galaxy',
  'rock \'n\' roller',
  'flight of passage',
  'rise of the resistance',
  'smugglers run',
  'millennium falcon',
  'star tours',
  'haunted mansion',
  'pirates',
  'peter pan',
  'winnie the pooh',
  'little mermaid',
  'under the sea',
  'buzz lightyear',
  'spaceship earth',
  'mission: space',
  'soarin',
  'living with the land',
  'seas with nemo',
  'remy',
  'frozen ever after',
  'gran fiesta',
  'tower of terror',
  'toy story mania',
  'dinosaur',
  'philharmagic',
  'hall of presidents',
  'carousel of progress',
  'tiki room',
  'country bear',
  'muppet',
  'lion king',
  "it's tough to be a bug",
  'finding nemo',
  'voices of liberty',
  'american adventure',
  'awesome planet',
  'turtle talk',
  'seabase',
  'laugh floor',
  'enchanted tales with belle',
  'frozen sing-along',
  'runaway railway',
  'walt disney presents',
  'vacation fun',
  'disney jr',
  'short film festival',
  'impressions de france',
  'reflections of china',
  'canada far and wide',
  'palais du cinéma',
  'drawn to life',
  'cirque du soleil',
  'hoop-dee-doo',
  'grand floridian lobby',
  'scat cat',
  'house of blues',
  'splitsville',
  'atlantic dance',
  'communicore hall',
  'advanced training lab',
  'bruce\'s shark world',
  'imageworks',
  'project tomorrow',
  'the edison',
  'raglan road',
  'amc',
];

function resolveClimate(
  exp: QuickSpecsExperience,
): { label: string; emoji: string; isIndoor: boolean } {
  const lowerName = (exp.name || '').toLowerCase();
  const lowerSub = (exp.subType || '').toLowerCase();

  // Water park attractions are always outdoor
  const parkLower = (exp.park || '').toLowerCase();
  if (parkLower.includes('typhoon') || parkLower.includes('blizzard')) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }

  // Explicit physical considerations from Disney metadata take precedence
  if (exp.physicalConsiderations) {
    for (const pc of exp.physicalConsiderations) {
      const lower = (pc.name || '').toLowerCase();
      if (
        lower.includes('indoor') ||
        lower.includes('air-conditioned') ||
        lower.includes('a/c')
      ) {
        return { label: 'Indoor A/C', emoji: '❄️', isIndoor: true };
      }
      if (lower.includes('outdoor')) {
        return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
      }
    }
  }

  // Known indoor attractions take precedence over general atmosphere keywords
  if (KNOWN_INDOOR_PATTERNS.some((pat) => lowerName.includes(pat))) {
    return { label: 'Indoor A/C', emoji: '❄️', isIndoor: true };
  }

  // Parades, fireworks, nighttime spectaculars, and street entertainment
  if (
    exp.category === 'Parade' ||
    lowerSub.includes('fireworks') ||
    lowerSub.includes('nighttime spectacular') ||
    lowerSub.includes('street') ||
    lowerSub.includes('parade') ||
    lowerSub.includes('cavalcade')
  ) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }

  // Animal Kingdom outdoor trails, animal encounters, and exhibits
  if (
    parkLower.includes('animal kingdom') &&
    (lowerName.includes('disney animals') ||
      exp.category === 'Walkthrough' ||
      lowerName.includes('encounters'))
  ) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }

  // Known outdoor attractions (Jungle Cruise, Seven Dwarfs, Big Thunder, etc.)
  if (KNOWN_OUTDOOR_PATTERNS.some((pat) => lowerName.includes(pat))) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }

  // Outdoor street entertainment, parades, and atmosphere acts
  if (lowerSub.includes('atmosphere')) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }

  const textPool = `${exp.description ?? ''} ${(exp.whyThis?.bullets ?? []).join(' ')} ${(exp.whyThis?.whyBullets ?? []).join(' ')}`.toLowerCase();
  if (
    textPool.includes('outdoor') ||
    textPool.includes('open-air') ||
    textPool.includes('open air')
  ) {
    return { label: 'Outdoor', emoji: '☀️', isIndoor: false };
  }
  if (
    textPool.includes('air-conditioned') ||
    textPool.includes('indoor') ||
    textPool.includes('a/c escape')
  ) {
    return { label: 'Indoor A/C', emoji: '❄️', isIndoor: true };
  }
  return { label: 'Indoor A/C', emoji: '❄️', isIndoor: true };
}

function resolveFeature(
  exp: QuickSpecsExperience,
): { label: string; emoji: string } {
  const lowerName = (exp.name || '').toLowerCase();
  if (lowerName.includes('pirates')) {
    return { label: 'Water Classic', emoji: '🌊' };
  }
  if (exp.interestFacets) {
    for (const values of Object.values(exp.interestFacets)) {
      if (
        values.length > 0 &&
        values[0]?.name &&
        values[0].name.trim().length > 0
      ) {
        const val = values[0].name.trim();
        const lower = val.toLowerCase();
        if (lower === 'classics' || lower === 'classic') {
          return { label: 'Water Classic', emoji: '🌊' };
        }
        const emoji = lower.includes('water')
          ? '🌊'
          : lower.includes('thrill')
          ? '🚀'
          : '✨';
        return { label: val, emoji };
      }
    }
  }
  if (exp.subType && exp.subType.trim().length > 0) {
    const val = exp.subType.trim();
    const lower = val.toLowerCase();
    const emoji =
      lower.includes('boat') || lower.includes('water') ? '🌊' : '✨';
    return { label: val, emoji };
  }
  return { label: exp.category, emoji: '✨' };
}

export default function QuickSpecsRow({ experience }: QuickSpecsRowProps): JSX.Element {
  if (experience.category === 'Resort') {
    const tier = experience.tier ? `${experience.tier} Resort` : 'Moderate Resort';
    const primaryTransit =
      experience.transportationModes && experience.transportationModes.length > 0
        ? `${experience.transportationModes[0]} Transit`
        : 'Bus Transit';
    const pool = experience.featurePool
      ? experience.featurePool.includes('Pool')
        ? experience.featurePool
        : `${experience.featurePool} Pool`
      : 'Feature Pool';
    const transitIcon = primaryTransit.includes('Skyliner')
      ? '🚡'
      : primaryTransit.includes('Monorail')
      ? '🚝'
      : primaryTransit.includes('Boat')
      ? '⛴️'
      : '🚌';

    return (
      <View
        style={styles.container}
        testID="experience-quick-specs-row"
        accessibilityLabel={`Specifications: ${tier}, ${primaryTransit}, ${pool}`}
      >
        <View style={styles.specItem} testID="spec-tier">
          <Text style={styles.specIcon}>🏰</Text>
          <Text style={styles.specText} numberOfLines={1} ellipsizeMode="tail">
            {tier}
          </Text>
        </View>

        <View style={styles.separator} />

        <View style={styles.specItem} testID="spec-transit">
          <Text style={styles.specIcon}>{transitIcon}</Text>
          <Text style={styles.specText} numberOfLines={1} ellipsizeMode="tail">
            {primaryTransit}
          </Text>
        </View>

        <View style={styles.separator} />

        <View style={styles.specItemGrow} testID="spec-pool">
          <Text style={styles.specIcon}>🏊</Text>
          <Text style={styles.specText} numberOfLines={2} ellipsizeMode="tail">
            {pool}
          </Text>
        </View>
      </View>
    );
  }

  const isRestaurant = experience.category === 'Restaurant';
  const isActivity =
    experience.category === 'Tour' || experience.category === 'Recreation';

  const duration = isRestaurant
    ? resolveRestaurantService(experience)
    : isActivity
    ? resolveDuration(experience as any) ?? 'Activity Session'
    : resolveDuration(experience as any);
  const durationIcon = isActivity ? '📅' : '⏱️';

  const height = isRestaurant
    ? resolveRestaurantPriceTier(experience)
    : isActivity && experience.areaType === 'Resort'
    ? 'Resort Activity'
    : resolveHeight(experience);
  const heightIcon = isRestaurant ? '🥢' : isActivity ? '📍' : '📏';

  const climate = resolveClimate(experience);

  const feature = isRestaurant
    ? resolveRestaurantCuisine(experience)
    : resolveFeature(experience);

  return (
    <View
      style={styles.container}
      testID="experience-quick-specs-row"
      accessibilityLabel={`Specifications: ${duration ? `${duration}, ` : ''}${height}, ${climate.label}, ${feature.label}`}
    >
      {duration ? (
        <>
          <View style={styles.specItem} testID="spec-duration">
            <Text style={styles.specIcon}>{durationIcon}</Text>
            <Text style={styles.specText} numberOfLines={1} ellipsizeMode="tail">
              {duration}
            </Text>
          </View>
          <View style={styles.separator} />
        </>
      ) : null}

      <View style={styles.specItem} testID="spec-height">
        <Text style={styles.specIcon}>{heightIcon}</Text>
        <Text style={styles.specText} numberOfLines={1} ellipsizeMode="tail">
          {height}
        </Text>
      </View>

      <View style={styles.separator} />

      <View style={styles.specItem} testID="spec-climate">
        <Text style={styles.specIcon}>{climate.emoji}</Text>
        <Text
          style={[
            styles.specText,
            climate.isIndoor ? styles.indoorClimateText : styles.outdoorClimateText,
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {climate.label}
        </Text>
      </View>

      <View style={styles.separator} />

      <View style={styles.specItemGrow} testID="spec-feature">
        <Text style={styles.specIcon}>{feature.emoji}</Text>
        <Text style={styles.specText} numberOfLines={2} ellipsizeMode="tail">
          {feature.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginHorizontal: 0,
    marginTop: 2,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(230, 222, 242, 0.9)',
    shadowColor: '#190c2d',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    overflow: 'hidden',
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    flexGrow: 0,
    justifyContent: 'center',
  },
  // The last chip in each row (feature pool / feature label) tends to carry
  // the longest, most variable text (e.g. a resort's named feature pool, a
  // restaurant's cuisine). Rather than splitting the row into equal thirds —
  // which wastes space on short fixed-length chips like "Bus Transit" while
  // still truncating the long one — only this chip grows to absorb whatever
  // width the other, naturally-sized chips leave behind.
  specItemGrow: {
    flexDirection: 'row',
    // `flex-start` (not `center`) because this chip's text may wrap to a
    // second line (numberOfLines={2}) for a long feature-pool/feature name —
    // centering vertically against a two-line block would visually detach
    // the icon from the first line of text.
    alignItems: 'flex-start',
    gap: 4,
    flexShrink: 1,
    flexGrow: 1,
    flexBasis: 0,
    // Centered, matching the other two chips, so a short name (e.g.
    // "Stormalong Bay Pool") reads as evenly balanced in its slot rather than
    // orphaned against the left edge with a large empty gap on the right. A
    // fixed `paddingLeft` (rather than relying on leftover centered space)
    // guarantees a minimum gap from the preceding divider even when a long
    // name fills the whole slot and there is little or no room left to
    // center within — the failure mode that made the icon touch the divider.
    justifyContent: 'center',
    paddingLeft: 6,
  },
  specIcon: {
    fontSize: 12,
  },
  separator: {
    width: 1,
    height: 16,
    backgroundColor: '#ddd2ee',
    marginHorizontal: 8,
  },
  specText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#190c2d',
    letterSpacing: -0.2,
  },
  indoorClimateText: {
    color: '#0284c7',
  },
  outdoorClimateText: {
    color: '#d97706',
  },
});
