// Feature: experience-detail-redesign — LocationGroupSection
//
// Validates: Requirements 1.2, 4.2-4.9, 10.1-10.8, 14.4
//
// Location_Group card plus Static_Map_Preview and Get_Directions_Action.

import React from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SectionLabel } from '../../theme/components';
import type { TagGroup } from './infoTags';
import type { DirectionsPlatform } from './directions';
import {
  directionsUrlCandidates,
  hasValidCoordinates,
  staticMapUrl,
} from './directions';

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return 'web';
}

export interface LocationGroupSectionProps {
  readonly group: TagGroup | undefined;
  readonly experienceName: string;
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
}

interface LandmarkNavigationDetails {
  readonly area: string;
  readonly hubWalk: string;
  readonly detail: string;
}

function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLon =
    (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

const PARK_CENTERS = {
  mk_hub: { name: 'Central Plaza', lat: 28.4194, lon: -81.5812 },
  mk_castle: { name: 'Cinderella Castle', lat: 28.4194, lon: -81.5812 },
  epcot_front: { name: 'Spaceship Earth', lat: 28.3747, lon: -81.5494 },
  epcot_gateway: { name: 'International Gateway', lat: 28.3697, lon: -81.5522 },
  epcot_promenade: { name: 'World Showcase Plaza', lat: 28.3705, lon: -81.5494 },
  dhs_center: { name: 'Chinese Theatre', lat: 28.3575, lon: -81.5583 },
  dak_tree: { name: 'Tree of Life', lat: 28.3598, lon: -81.5907 },
  ds_center: { name: 'Town Center', lat: 28.3705, lon: -81.516 },
};

function computeDynamicWalk(
  park?: string,
  land?: string,
  lat?: number | null,
  lon?: number | null,
): string | null {
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null;
  }
  const parkLower = (park || '').toLowerCase();
  const landLower = (land || '').toLowerCase();

  if (parkLower.includes('epcot')) {
    const distGateway = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.epcot_gateway.lat,
      PARK_CENTERS.epcot_gateway.lon,
    );
    if (
      distGateway < 420 ||
      landLower.includes('france') ||
      landLower.includes('united kingdom') ||
      landLower.includes('uk')
    ) {
      const mins = Math.max(1, Math.round((distGateway * 1.35) / 75));
      return `~${mins} min walk from International Gateway`;
    }
    const distPromenade = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.epcot_promenade.lat,
      PARK_CENTERS.epcot_promenade.lon,
    );
    if (landLower.includes('world showcase')) {
      const mins = Math.max(1, Math.round((distPromenade * 1.35) / 75));
      return `~${mins} min walk from World Showcase Plaza`;
    }
    const distFront = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.epcot_front.lat,
      PARK_CENTERS.epcot_front.lon,
    );
    const mins = Math.max(1, Math.round((distFront * 1.35) / 75));
    return `~${mins} min walk from Spaceship Earth`;
  }

  if (parkLower.includes('hollywood')) {
    const dist = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.dhs_center.lat,
      PARK_CENTERS.dhs_center.lon,
    );
    const mins = Math.max(1, Math.round((dist * 1.35) / 75));
    return `~${mins} min walk from Chinese Theatre`;
  }

  if (parkLower.includes('animal kingdom')) {
    const dist = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.dak_tree.lat,
      PARK_CENTERS.dak_tree.lon,
    );
    const mins = Math.max(1, Math.round((dist * 1.35) / 75));
    return `~${mins} min walk from Tree of Life`;
  }

  if (parkLower.includes('magic kingdom')) {
    if (landLower.includes('fantasyland')) {
      const dist = distanceMeters(
        lat,
        lon,
        PARK_CENTERS.mk_castle.lat,
        PARK_CENTERS.mk_castle.lon,
      );
      const mins = Math.max(1, Math.round((dist * 1.35) / 75));
      return `~${mins} min walk from Cinderella Castle`;
    }
    const dist = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.mk_hub.lat,
      PARK_CENTERS.mk_hub.lon,
    );
    const mins = Math.max(1, Math.round((dist * 1.35) / 75));
    return `~${mins} min walk from Central Plaza`;
  }

  if (parkLower.includes('springs')) {
    const dist = distanceMeters(
      lat,
      lon,
      PARK_CENTERS.ds_center.lat,
      PARK_CENTERS.ds_center.lon,
    );
    const mins = Math.max(1, Math.round((dist * 1.35) / 75));
    return `~${mins} min walk from Town Center`;
  }

  return null;
}

export function resolveLandmarkDetails(
  experienceName: string,
  landLabel?: string,
  parkLabel?: string,
  latitude?: number | null | undefined,
  longitude?: number | null | undefined,
  resortLabel?: string,
  resortAreaLabel?: string,
): LandmarkNavigationDetails {
  const lower = experienceName.toLowerCase();
  const parkLower = (parkLabel || '').toLowerCase();
  const landLower = (landLabel || '').toLowerCase();
  const resortLower = (resortLabel || '').toLowerCase();
  const resortAreaLower = (resortAreaLabel || '').toLowerCase();

  const dynamicWalk = computeDynamicWalk(
    parkLabel,
    landLabel,
    latitude,
    longitude,
  );

  // 0. Resort & Resort Experience landmark routing (eliminates Central Plaza fallback)
  const isCoronado =
    lower.includes('coronado') ||
    resortLower.includes('coronado') ||
    resortAreaLower.includes('animal kingdom resort');

  if (isCoronado) {
    if (lower.includes('painting') || lower.includes('colors of coronado')) {
      return {
        area: 'Gran Destino Tower',
        hubWalk: dynamicWalk ?? '~2 min walk from El Centro Lobby',
        detail: 'Located in the Dahlia Lounge / Toledo terrace at Gran Destino Tower.',
      };
    }
    if (
      lower.includes('mercado') ||
      lower.includes('maya grill') ||
      lower.includes('riquitillos') ||
      lower.includes('cafe rix')
    ) {
      return {
        area: 'El Centro Commercial Corridor',
        hubWalk: dynamicWalk ?? '~1 min walk from Main Lobby',
        detail: 'Located inside El Centro main building adjacent to Panchito’s Gifts.',
      };
    }
    if (lower.includes('three bridges')) {
      return {
        area: 'Villa del Lago',
        hubWalk: dynamicWalk ?? '~3 min walk across over-water bridge',
        detail: 'Located in the center of Lago Dorado accessed via boardwalk bridges.',
      };
    }
    return {
      area: 'El Centro & Gran Destino Tower',
      hubWalk: dynamicWalk ?? 'Direct Bus Service to Parks \u2022 1000 W Buena Vista Dr',
      detail: `Located on Lago Dorado in the ${resortAreaLabel ?? 'Animal Kingdom Resort Area'}.`,
    };
  }

  if (
    resortLabel ||
    resortAreaLabel ||
    (!parkLabel &&
      !landLabel &&
      (lower.includes('resort') || lower.includes('inn') || lower.includes('lodge')))
  ) {
    const areaName = resortLabel ?? resortAreaLabel ?? 'Resort Area';
    return {
      area: areaName,
      hubWalk: dynamicWalk ?? 'Direct Disney Transportation Available',
      detail: `Located in ${resortAreaLabel ?? resortLabel ?? 'Walt Disney World Resort'}.`,
    };
  }

  // 1. Magic Kingdom specific attractions
  if (lower.includes('pirates')) {
    return {
      area: 'Caribbean Plaza',
      hubWalk: dynamicWalk ?? '~4 min walk from Central Plaza',
      detail: 'Located in Caribbean Plaza, opposite Tortuga Tavern.',
    };
  }

  if (
    lower.includes('skipper canteen') ||
    lower.includes('jungle navigation')
  ) {
    return {
      area: 'Skipper Canteen',
      hubWalk: dynamicWalk ?? '~4 min walk from Central Plaza',
      detail: 'Located next to Jungle Cruise in Adventureland.',
    };
  }

  if (lower.includes('jungle cruise')) {
    return {
      area: 'Adventureland Outpost',
      hubWalk: dynamicWalk ?? '~3 min walk from Central Plaza',
      detail: 'Located just across the Adventureland bridge on the left.',
    };
  }

  if (lower.includes('be our guest') || lower.includes('beast')) {
    return {
      area: "Beast's Castle",
      hubWalk: dynamicWalk ?? '~5 min walk from Cinderella Castle',
      detail: 'Cross the stone bridge into the Enchanted Forest.',
    };
  }

  if (lower.includes('seven dwarfs') || lower.includes('mine train')) {
    return {
      area: 'Enchanted Forest',
      hubWalk: dynamicWalk ?? '~4 min walk from Cinderella Castle',
      detail:
        'Located in the center of Fantasyland near Prince Charming Regal Carrousel.',
    };
  }

  if (lower.includes('space mountain')) {
    return {
      area: 'Tomorrowland East',
      hubWalk: dynamicWalk ?? '~6 min walk from Central Plaza',
      detail: 'Located at the far end of Tomorrowland, past PeopleMover.',
    };
  }

  if (lower.includes('tron')) {
    return {
      area: 'TRON Plaza',
      hubWalk: dynamicWalk ?? '~7 min walk from Central Plaza',
      detail: 'Located beneath the curved canopy past Space Mountain.',
    };
  }

  if (lower.includes('haunted mansion')) {
    return {
      area: 'Liberty Square Manor',
      hubWalk: dynamicWalk ?? '~5 min walk from Central Plaza',
      detail: 'Located along the Rivers of America in Liberty Square.',
    };
  }

  if (lower.includes('big thunder')) {
    return {
      area: 'Frontierland Depot',
      hubWalk: dynamicWalk ?? '~6 min walk from Central Plaza',
      detail: 'Located at the far edge of Frontierland along the river.',
    };
  }

  if (lower.includes('tiana') || lower.includes('bayou adventure')) {
    return {
      area: 'Rivers of America',
      hubWalk: dynamicWalk ?? '~5 min walk from Central Plaza',
      detail: 'Located between the Frontierland boardwalk and the train station.',
    };
  }

  // 2. EPCOT specific attractions
  if (lower.includes('remy') || lower.includes('ratatouille')) {
    return {
      area: 'France Pavilion',
      hubWalk: dynamicWalk ?? '~3 min walk from International Gateway',
      detail: 'Located in the France Pavilion expansion, past the crêperie.',
    };
  }

  if (lower.includes('frozen') || lower.includes('norway')) {
    return {
      area: 'Norway Pavilion',
      hubWalk: dynamicWalk ?? '~5 min walk from World Showcase Plaza',
      detail: 'Located in the Stave Church plaza between Mexico and China.',
    };
  }

  if (
    lower.includes('gran fiesta') ||
    lower.includes('san angel') ||
    (lower.includes('mexico') && parkLower.includes('epcot'))
  ) {
    return {
      area: 'Mexico Pavilion',
      hubWalk: dynamicWalk ?? '~4 min walk from World Showcase Plaza',
      detail: 'Located inside the Mesoamerican pyramid on the lagoon promenade.',
    };
  }

  if (lower.includes('soarin') || lower.includes('living with the land')) {
    return {
      area: 'The Land Pavilion',
      hubWalk: dynamicWalk ?? '~5 min walk from Spaceship Earth',
      detail: 'Located on the lower level inside The Land Pavilion.',
    };
  }

  if (lower.includes('cosmic rewind') || lower.includes('guardians')) {
    return {
      area: 'Wonders of Xandar',
      hubWalk: dynamicWalk ?? '~4 min walk from Spaceship Earth',
      detail: 'Located in World Discovery across from Mission: SPACE.',
    };
  }

  if (lower.includes('test track')) {
    return {
      area: 'Test Track Pavilion',
      hubWalk: dynamicWalk ?? '~5 min walk from Spaceship Earth',
      detail: 'Located on the east side of World Discovery.',
    };
  }

  if (lower.includes('mission: space') || lower.includes('space 220')) {
    return {
      area: 'Mission: SPACE Pavilion',
      hubWalk: dynamicWalk ?? '~5 min walk from Spaceship Earth',
      detail: 'Located next to Test Track in World Discovery.',
    };
  }

  if (lower.includes('spaceship earth')) {
    return {
      area: 'Spaceship Earth Plaza',
      hubWalk: dynamicWalk ?? '~1 min walk from Main Entrance',
      detail: 'Located directly inside the park entrance at the geosphere.',
    };
  }

  // 3. Disney's Hollywood Studios specific attractions
  if (lower.includes('star tours')) {
    return {
      area: 'Echo Lake Plaza',
      hubWalk: dynamicWalk ?? '~3 min walk from Chinese Theatre',
      detail: 'Located in Echo Lake, near Commissary Lane and Grand Avenue.',
    };
  }

  if (lower.includes('rise of the resistance')) {
    return {
      area: 'Resistance Forest',
      hubWalk: dynamicWalk ?? '~7 min walk from Chinese Theatre',
      detail: 'Follow the forested pathway on the outskirts of Black Spire Outpost.',
    };
  }

  if (
    lower.includes('smugglers run') ||
    lower.includes('millennium falcon') ||
    lower.includes('galaxy\'s edge')
  ) {
    return {
      area: 'Black Spire Outpost',
      hubWalk: dynamicWalk ?? '~6 min walk from Chinese Theatre',
      detail: 'Located in the spaceport docking bay in Galaxy\'s Edge.',
    };
  }

  if (lower.includes('slinky dog') || lower.includes('toy story')) {
    return {
      area: "Andy's Backyard",
      hubWalk: dynamicWalk ?? '~5 min walk from Chinese Theatre',
      detail:
        'Located in the center of Toy Story Land behind the coaster track.',
    };
  }

  if (lower.includes('tower of terror')) {
    return {
      area: 'Hollywood Tower Hotel',
      hubWalk: dynamicWalk ?? '~6 min walk from Chinese Theatre',
      detail: 'Located at the far end of Sunset Boulevard.',
    };
  }

  if (lower.includes('rock \'n\' roller')) {
    return {
      area: 'G-Force Records',
      hubWalk: dynamicWalk ?? '~5 min walk from Chinese Theatre',
      detail:
        'Located in the courtyard past Tower of Terror on Sunset Boulevard.',
    };
  }

  // 4. Disney's Animal Kingdom specific attractions
  if (lower.includes('flight of passage')) {
    return {
      area: 'Valley of Mo\'ara',
      hubWalk: dynamicWalk ?? '~7 min walk from Tree of Life',
      detail: 'Located beneath the floating mountains in Valley of Mo\'ara.',
    };
  }

  if (lower.includes('na\'vi river')) {
    return {
      area: 'Valley of Mo\'ara',
      hubWalk: dynamicWalk ?? '~5 min walk from Tree of Life',
      detail:
        'Located near the entrance of Pandora along the bio-luminescent path.',
    };
  }

  if (lower.includes('kilimanjaro') || lower.includes('safari')) {
    return {
      area: 'Harambe Reserve',
      hubWalk: dynamicWalk ?? '~7 min walk from Tree of Life',
      detail:
        'Located at the northernmost point of Harambe Village in Africa.',
    };
  }

  if (lower.includes('lion king') || lower.includes('harambe')) {
    return {
      area: 'Harambe Theater',
      hubWalk: dynamicWalk ?? '~5 min walk from Tree of Life',
      detail: 'Follow the path into Harambe Village toward the train.',
    };
  }

  if (lower.includes('everest')) {
    return {
      area: 'Anandapur Village',
      hubWalk: dynamicWalk ?? '~7 min walk from Tree of Life',
      detail:
        'Located along the Discovery River in the shadow of Mount Everest.',
    };
  }

  if (lower.includes('dinosaur')) {
    return {
      area: 'Dino Institute',
      hubWalk: dynamicWalk ?? '~6 min walk from Tree of Life',
      detail: 'Located at the far end of the DinoLand U.S.A. path.',
    };
  }

  // 5. Park & Land general fallbacks
  if (parkLower.includes('epcot')) {
    if (landLower.includes('world showcase')) {
      const isGatewaySide =
        landLower.includes('france') ||
        landLower.includes('united kingdom') ||
        landLower.includes('uk') ||
        landLower.includes('morocco');
      const area = isGatewaySide
        ? 'International Gateway Area'
        : 'World Showcase Promenade';
      const walk = isGatewaySide
        ? '~4 min walk from International Gateway'
        : '~6 min walk from World Showcase Plaza';
      return {
        area,
        hubWalk: dynamicWalk ?? walk,
        detail: 'Located along the World Showcase Lagoon promenade.',
      };
    }
    if (landLower.includes('nature')) {
      return {
        area: 'World Nature',
        hubWalk: dynamicWalk ?? '~4 min walk from Spaceship Earth',
        detail: 'Located in the World Nature neighborhood on the west side.',
      };
    }
    if (landLower.includes('discovery')) {
      return {
        area: 'World Discovery',
        hubWalk: dynamicWalk ?? '~4 min walk from Spaceship Earth',
        detail: 'Located in the World Discovery neighborhood on the east side.',
      };
    }
    return {
      area: landLabel ?? 'World Celebration',
      hubWalk: dynamicWalk ?? '~3 min walk from Spaceship Earth',
      detail: `Located in ${landLabel ?? 'EPCOT'}.`,
    };
  }

  if (parkLower.includes('hollywood')) {
    return {
      area: landLabel ?? 'Studio Courtyard',
      hubWalk: dynamicWalk ?? '~4 min walk from Chinese Theatre',
      detail: `Located in ${landLabel ?? "Disney's Hollywood Studios"}.`,
    };
  }

  if (parkLower.includes('animal kingdom')) {
    return {
      area: landLabel ?? 'Discovery Outpost',
      hubWalk: dynamicWalk ?? '~6 min walk from Tree of Life',
      detail: `Located in ${landLabel ?? "Disney's Animal Kingdom"}.`,
    };
  }

  if (parkLower.includes('springs')) {
    return {
      area: landLabel ?? 'Town Center',
      hubWalk: dynamicWalk ?? '~4 min walk from Town Center',
      detail: `Located in ${landLabel ?? 'Disney Springs'}.`,
    };
  }

  if (parkLower.includes('typhoon') || parkLower.includes('blizzard')) {
    return {
      area: parkLabel ?? 'Water Park',
      hubWalk: '~3 min walk from Park Entrance',
      detail: `Located inside ${parkLabel ?? 'the water park'}.`,
    };
  }

  // Magic Kingdom / general default
  const defaultWalk = landLower.includes('fantasyland')
    ? '~4 min walk from Cinderella Castle'
    : '~4 min walk from Central Plaza';

  return {
    area: landLabel ?? 'Central Plaza',
    hubWalk: dynamicWalk ?? defaultWalk,
    detail: `Located in ${landLabel ?? parkLabel ?? 'the park'}.`,
  };
}

export default function LocationGroupSection({
  group,
  experienceName,
  latitude,
  longitude,
}: LocationGroupSectionProps): JSX.Element | null {
  const [failed, setFailed] = React.useState(false);
  const [mapImageFailed, setMapImageFailed] = React.useState(false);
  const canGetDirections = hasValidCoordinates(latitude, longitude);

  if (group === undefined && !canGetDirections) {
    return null;
  }

  const handleGetDirections = async (): Promise<void> => {
    const candidates = directionsUrlCandidates(
      latitude as number,
      longitude as number,
      mapsPlatform(),
    );

    for (const url of candidates) {
      try {
        await Linking.openURL(url);
        setFailed(false);
        return;
      } catch {
        // Fall through to next candidate
      }
    }

    setFailed(true);
  };

  const parkTag = group?.tags.find((t) => t.kind === 'park');
  const landTag = group?.tags.find((t) => t.kind === 'land');
  const resortTag = group?.tags.find((t) => t.kind === 'resort');
  const resortAreaTag = group?.tags.find((t) => t.kind === 'resortArea');

  const landmark = resolveLandmarkDetails(
    experienceName,
    landTag?.label,
    parkTag?.label,
    latitude,
    longitude,
    resortTag?.label,
    resortAreaTag?.label,
  );

  const isResortLocation = Boolean(
    resortTag ||
      resortAreaTag ||
      (!parkTag &&
        !landTag &&
        (experienceName.toLowerCase().includes('resort') ||
          experienceName.toLowerCase().includes('lodge'))),
  );

  let routeBriefTitle = '';
  if (landTag) {
    routeBriefTitle =
      landmark.area &&
      landmark.area !== 'Landmark Area' &&
      landmark.area !== landTag.label
        ? `${landTag.label} \u2022 ${landmark.area}`
        : landTag.label;
  } else if (resortTag) {
    routeBriefTitle = resortAreaTag
      ? `${resortTag.label} \u2022 ${resortAreaTag.label}`
      : `${resortTag.label}${
          landmark.area &&
          landmark.area !== resortTag.label &&
          landmark.area !== 'Central Plaza'
            ? ` \u2022 ${landmark.area}`
            : ''
        }`;
  } else if (resortAreaTag) {
    routeBriefTitle = `${resortAreaTag.label}${
      landmark.area &&
      landmark.area !== resortAreaTag.label &&
      landmark.area !== 'Central Plaza'
        ? ` \u2022 ${landmark.area}`
        : ''
    }`;
  } else if (parkTag) {
    routeBriefTitle = `${parkTag.label}${
      landmark.area && landmark.area !== 'Landmark Area'
        ? ` \u2022 ${landmark.area}`
        : ''
    }`;
  } else {
    routeBriefTitle = landmark.area;
  }

  const displaySubtitle = isResortLocation
    ? `${resortTag?.label ?? resortAreaTag?.label ?? 'Walt Disney World Resort'} \u2022 Property Landmark`
    : `${parkTag?.label ?? 'Theme Park'} \u2022 Landmark Navigation`;

  return (
    <View style={styles.card} testID="experience-location-group">
      <SectionLabel style={styles.srOnly}>Location</SectionLabel>
      {canGetDirections && !mapImageFailed ? (
        <Pressable
          onPress={() => {
            void handleGetDirections();
          }}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Map preview of ${experienceName}. Tap for directions.`}
          testID="experience-static-map"
          style={styles.mapFrame}
        >
          <Image
            source={{
              uri: staticMapUrl(latitude as number, longitude as number),
            }}
            style={styles.mapImage}
            resizeMode="cover"
            onError={() => setMapImageFailed(true)}
            accessibilityIgnoresInvertColors
          />
          <Ionicons
            name="location"
            size={34}
            color="#f6c343"
            style={styles.mapPin}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      ) : null}

      <View style={styles.cardBody}>
        <View style={styles.briefRow}>
          <View style={styles.briefTextWrap}>
            <Text style={styles.briefTitle}>{routeBriefTitle}</Text>
            <Text style={styles.briefSub}>{displaySubtitle}</Text>
          </View>

          {canGetDirections ? (
            <Pressable
              onPress={() => {
                void handleGetDirections();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${experienceName}`}
              testID="experience-get-directions"
              style={styles.directionsBtn}
            >
              <Text style={{ fontSize: 13 }}>🧭</Text>
              <Text style={styles.directionsBtnText}>Get Directions</Text>
            </Pressable>
          ) : null}
        </View>

        {group !== undefined ? (
          <View style={styles.badgeRow}>
            {group.tags.map((tag, index) => (
              <View
                key={`${tag.kind}-${index}`}
                style={styles.tagPill}
                testID={`experience-info-tag-${tag.kind}`}
                accessibilityLabel={tag.accessibilityLabel}
              >
                <Text style={styles.tagPillText}>{tag.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.walkingCallout}>
          <Text style={styles.walkingCalloutText}>
            🚶 <Text style={styles.walkingCalloutBold}>{landmark.hubWalk}</Text> • {landmark.detail}
          </Text>
        </View>

        {failed ? (
          <Text style={styles.errorText} testID="experience-directions-error">
            Couldn&apos;t open the maps app. Please try again.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    marginHorizontal: 0,
    marginTop: 14,
  },
  mapFrame: {
    width: '100%',
    height: 195,
    backgroundColor: '#f3edf9',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  mapImage: {
    width: '100%',
    height: '100%',
  },
  mapPin: {
    position: 'absolute',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  cardBody: {
    padding: 16,
  },
  briefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  briefTextWrap: {
    flex: 1,
  },
  briefTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
  },
  briefSub: {
    fontSize: 11,
    color: '#655d78',
    marginTop: 2,
  },
  directionsBtn: {
    backgroundColor: '#5b2a86',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  directionsBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  badgeRow: {
    height: 0,
    width: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  tagPill: {
    backgroundColor: '#f1ecf9',
    borderWidth: 1,
    borderColor: '#e2d7f2',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#371756',
  },
  walkingCallout: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  walkingCalloutText: {
    fontSize: 11.5,
    color: '#4338ca',
    lineHeight: 16,
  },
  walkingCalloutBold: {
    fontWeight: '800',
    color: '#312e81',
  },
  errorText: {
    fontSize: 12,
    color: '#e11d48',
    marginTop: 8,
  },
  srOnly: {
    height: 0,
    width: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});
