/**
 * ResortsDirectoryScreen — Level-2 dedicated directory for Disney resorts and hotels.
 * (catalog-redesign spec, Requirement 2, Tasks 5.1, 5.2, 5.3)
 *
 * Provides a structured, 4-partition directory for discovering:
 *   1. Hotels (32 on-property resorts with HotelPreviewCard)
 *   2. Dining (104+ resort restaurants, quick-service, lounges)
 *   3. Recreation (85+ pools, marinas, trails, spas, golf)
 *   4. Sub-Destinations (BoardWalk, ESPN Wide World of Sports, Golf complexes)
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { ExperienceDTO, ResortDTO, ResortRecreationItemDTO } from '@dwt/shared';
import { apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import { Card, EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import {
  filterDiningByCategory,
  type DiningCategoryFilter,
} from './resortGuideView';
import {
  KNOWN_RESORT_PROFILES,
  resolveResortProfile,
  resolveTransitTimes,
  cleanAndSortMealPeriods,
  type ResortDiningVenue,
} from './ResortGuideSection';
import FavoriteToggle from './FavoriteToggle';
import { resortAreaLabel } from './infoTags';
import { useFavoritedExperiences } from './useFavoritedExperiences';

export type ResortDirectoryTab = 'hotels' | 'dining' | 'recreation' | 'subdest';

export type HotelTierFilter =
  | 'all'
  | 'deluxe'
  | 'moderate'
  | 'value'
  | 'dvc'
  | 'monorail'
  | 'skyliner'
  | 'boat';

export type RecreationCategoryFilter =
  | 'all'
  | 'pools'
  | 'arts'
  | 'boating'
  | 'spas'
  | 'golf'
  | 'family';

export interface ResortsDirectoryScreenProps {
  readonly navigation?: any;
  readonly onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Static fallback resorts for offline and testing resilience
// ---------------------------------------------------------------------------

const FALLBACK_RESORTS: readonly ResortDTO[] = [
  {
    id: 'resort-grand-floridian',
    name: "Disney's Grand Floridian Resort & Spa",
    tier: 'Deluxe',
    description:
      'Victorian elegance on Seven Seas Lagoon · Courtyard & Beach Pools · Full-service spa & fine dining.',
    imageUrl: null,
    representingExperienceId: 'exp-grand-floridian',
    featurePool: 'Beach Pool with 181-foot slide',
    transportationModes: ['Monorail', 'Boat', 'Bus', 'Walking'],
    latitude: 28.4109,
    longitude: -81.5878,
    address: '4401 Floridian Way, Lake Buena Vista, FL 32830',
    phone: '(407) 824-3000',
    transitTimes: {
      'Magic Kingdom': 4,
      'Hollywood Studios': 16,
      EPCOT: 18,
      'Animal Kingdom': 18,
      'Disney Springs': 20,
    },
    recreation: [
      {
        icon: '🏊',
        title: 'Beach Pool & Courtyard Pool',
        badge: 'Feature Pool',
        description: 'Zero-entry lagoon with 181-foot waterslide and waterfalls.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '💆',
        title: 'The Grand Floridian Spa',
        badge: 'Spa',
        description: 'Full-service day spa with massages, facials, and relaxation lounge.',
        hours: '9:00 AM - 6:00 PM',
        priceTier: '$$$$',
      },
      {
        icon: '🛥️',
        title: 'Seven Seas Marina Boat Rentals',
        badge: 'Boating',
        description: 'Motorized pontoon boat and Sea Raycer rentals on Seven Seas Lagoon.',
        hours: '10:00 AM - 5:00 PM',
        priceTier: '$$',
      },
    ],
  },
  {
    id: 'resort-polynesian',
    name: "Disney's Polynesian Village Resort",
    tier: 'Deluxe',
    description:
      'South Pacific island retreat on Seven Seas Lagoon · Lava Pool with volcano slide · Luau & beach.',
    imageUrl: null,
    representingExperienceId: 'exp-polynesian',
    featurePool: 'Lava Pool with 142-foot slide',
    transportationModes: ['Monorail', 'Boat', 'Bus', 'Walking'],
    latitude: 28.4058,
    longitude: -81.5835,
    address: '1600 Seven Seas Dr, Lake Buena Vista, FL 32830',
    phone: '(407) 824-2000',
    transitTimes: {
      'Magic Kingdom': 8,
      EPCOT: 15,
      'Hollywood Studios': 16,
      'Animal Kingdom': 18,
      'Disney Springs': 20,
    },
    recreation: [
      {
        icon: '🏊',
        title: 'Lava Pool',
        badge: 'Feature Pool',
        description: 'Volcano rock formations, cascading waterfall, and 142-foot waterslide.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏖️',
        title: 'Seven Seas Beach & Fireworks Viewing',
        badge: 'Beach',
        description: 'White-sand beach with prime views of the Magic Kingdom fireworks.',
        hours: '24 Hours',
        priceTier: 'Free',
      },
    ],
  },
  {
    id: 'resort-contemporary',
    name: "Disney's Contemporary Resort",
    tier: 'Deluxe',
    description:
      'Ultra-modern icon with Monorail gliding directly through the Grand Canyon Concourse.',
    imageUrl: null,
    representingExperienceId: 'exp-contemporary',
    featurePool: 'Feature Pool with 17-foot slide',
    transportationModes: ['Monorail', 'Boat', 'Bus', 'Walking'],
    latitude: 28.4162,
    longitude: -81.5746,
    address: '4600 N World Dr, Lake Buena Vista, FL 32830',
    phone: '(407) 824-1000',
    transitTimes: {
      'Magic Kingdom': 5,
      'Hollywood Studios': 16,
      EPCOT: 18,
      'Animal Kingdom': 18,
      'Disney Springs': 20,
    },
    recreation: [
      {
        icon: '🚤',
        title: 'Bay Lake Watersports & Boat Rentals',
        badge: 'Boating',
        description: 'Private chartered pontoon cruises, motorized boat rentals, and water skiing on Bay Lake.',
        hours: '10:00 AM - 5:00 PM',
        priceTier: '$$',
      },
      {
        icon: '🏊',
        title: 'Feature Pool with 17-Foot Slide',
        badge: 'Feature Pool',
        description: 'Heated pool overlooking Bay Lake featuring a curving 17-foot-high waterslide and whirlpool spas.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏋️',
        title: 'Olympiad Fitness Center',
        badge: 'Wellness',
        description: 'Full workout facility equipped with state-of-the-art Cybex and Life Fitness equipment and saunas.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
      {
        icon: '🎣',
        title: 'Guided Bass Fishing Excursions',
        badge: 'Boating',
        description: '2- to 4-hour catch-and-release tournament-style bass fishing charters on Bay Lake.',
        hours: 'Morning & Afternoon',
        priceTier: '$$$',
      },
    ],
  },
  {
    id: 'resort-beach-club',
    name: "Disney's Beach Club Resort",
    tier: 'Deluxe',
    description:
      'New England seaside charm featuring 3-acre Stormalong Bay sand-bottom lagoon · Steps to EPCOT gateway.',
    imageUrl: null,
    representingExperienceId: 'exp-beach-club',
    featurePool: 'Stormalong Bay',
    transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
    latitude: 28.3712,
    longitude: -81.5544,
    address: '1800 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    phone: '(407) 934-8000',
    transitTimes: {
      EPCOT: 5,
      'Hollywood Studios': 12,
      'Disney Springs': 15,
      'Animal Kingdom': 16,
      'Magic Kingdom': 18,
    },
    recreation: [
      {
        icon: '🏖️',
        title: 'Stormalong Bay Sand Lagoon',
        badge: 'Feature Pool',
        description: '3-acre sand-bottom aquatic playground with gentle current lazy river, life-sized shipwreck, and 230-foot slide.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '⛵',
        title: 'Bayside Marina Boat Rentals',
        badge: 'Boating',
        description: 'Motorized watercraft rentals and private chartered cruises departing from Crescent Lake.',
        hours: '10:00 AM - 5:00 PM',
        priceTier: '$$',
      },
      {
        icon: '🚴',
        title: 'Crescent Lake Surrey Bike Rentals',
        badge: 'Family Fun',
        description: 'Rent 2- and 4-person surrey bicycles for a scenic lap around Crescent Lake and the BoardWalk promenade.',
        hours: 'Day & Evening',
        priceTier: '$$',
      },
      {
        icon: '🪵',
        title: 'Beach Club Campfire & Lawn Movies',
        badge: 'Family Fun',
        description: 'Campfire roasted marshmallows followed by Disney movies screened under the stars on the beach.',
        hours: 'Evenings',
        priceTier: 'Free',
      },
    ],
  },
  {
    id: 'resort-yacht-club',
    name: "Disney's Yacht Club Resort",
    tier: 'Deluxe',
    description:
      'Stately maritime sophistication on Crescent Lake · Hardwood nautical lobby · Shipwreck waterslide.',
    imageUrl: null,
    representingExperienceId: 'exp-yacht-club',
    featurePool: 'Stormalong Bay',
    transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
    latitude: 28.3705,
    longitude: -81.5572,
    address: '1700 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    phone: '(407) 934-7000',
    transitTimes: {
      EPCOT: 6,
      'Hollywood Studios': 12,
      'Disney Springs': 15,
      'Animal Kingdom': 16,
      'Magic Kingdom': 18,
    },
    recreation: [
      {
        icon: '🏖️',
        title: 'Stormalong Bay Sand Lagoon',
        badge: 'Feature Pool',
        description: '3-acre sand-bottom aquatic playground with gentle current lazy river, life-sized shipwreck, and elevated tanning decks.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🎾',
        title: 'Lighted Tennis & Pickleball Courts',
        badge: 'Sports',
        description: 'Lighted courts nestled in lush landscaping with complimentary equipment loan.',
        hours: '8:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏋️',
        title: 'Ship Shape Health Club',
        badge: 'Wellness',
        description: '24-hour fitness center equipped with strength and cardio equipment, steam rooms, and saunas.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
    ],
  },
  {
    id: 'resort-boardwalk',
    name: "Disney's BoardWalk Inn",
    tier: 'Deluxe',
    description:
      'Atlantic coastal boardwalk elegance with vibrant waterfront nightlife, dining, and carnival games.',
    imageUrl: null,
    representingExperienceId: 'exp-boardwalk-inn',
    featurePool: 'Luna Park Pool',
    transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
    latitude: 28.3664,
    longitude: -81.5562,
    address: '2101 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    phone: '(407) 939-5100',
    transitTimes: {
      EPCOT: 5,
      'Hollywood Studios': 12,
      'Disney Springs': 15,
      'Animal Kingdom': 16,
      'Magic Kingdom': 18,
    },
    recreation: [
      {
        icon: '🎪',
        title: 'BoardWalk Street Performers & Midway Games',
        badge: 'Entertainment',
        description: 'Nightly jugglers, magicians, and vintage midway arcade games along the bustling quarter-mile wooden promenade.',
        hours: '7:00 PM - 10:00 PM',
        priceTier: 'Free',
      },
      {
        icon: '🏊',
        title: 'Luna Park Pool',
        badge: 'Feature Pool',
        description: 'Carnival-themed pool featuring the 200-foot-long Keister Coaster waterslide and elephant spouts.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🚴',
        title: 'Crescent Lake Surrey Bikes',
        badge: 'Family Fun',
        description: 'Family pedal surrey rentals cruising the waterfront promenade and Crescent Lake bridges.',
        hours: 'Day & Evening',
        priceTier: '$$',
      },
      {
        icon: '🏋️',
        title: 'Muscles & Bustles Health Club',
        badge: 'Wellness',
        description: 'Workout facility with cardio machinery, resistance equipment, and sauna amenities.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
    ],
  },
  {
    id: 'resort-riviera',
    name: "Disney's Riviera Resort",
    tier: 'Deluxe Villa',
    description:
      "European elegance inspired by Walt and Lillian's travels · Riviera Pool with stone turret · Skyliner hub.",
    imageUrl: null,
    representingExperienceId: 'exp-riviera',
    featurePool: 'Riviera Pool',
    transportationModes: ['Skyliner', 'Bus'],
    latitude: 28.3585,
    longitude: -81.5398,
    address: '1080 Esplanade Ave, Lake Buena Vista, FL 32830',
    phone: '(407) 828-7030',
    transitTimes: {
      EPCOT: 8,
      'Hollywood Studios': 8,
      'Disney Springs': 14,
      'Animal Kingdom': 16,
      'Magic Kingdom': 18,
    },
    recreation: [
      {
        id: 'b1010001-c001-4000-8000-000000000004',
        icon: '🎨',
        title: 'Painting on the Riviera',
        badge: 'Arts & Crafts',
        description: 'Terrace painting masterclass celebrating European Mediterranean art overlooking Barefoot Bay.',
        hours: 'Select Mornings',
        priceTier: '$$$',
      },
      {
        icon: '♟️',
        title: 'Riviera Lawn Games & Bocce Ball',
        badge: 'Recreation',
        description: 'Bocce ball court, life-sized chess on the event lawn, and scenic waterfront promenade around Barefoot Bay.',
        hours: 'Daytime',
        priceTier: 'Included',
      },
      {
        icon: '🏊',
        title: 'Riviera Pool & S’il Vous Play',
        badge: 'Feature Pool',
        description: 'Signature Mediterranean pool with 30-foot winding stone turret waterslide and interactive water play area.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏋️',
        title: 'Athlétique Fitness Center',
        badge: 'Wellness',
        description: 'Contemporary fitness center with top-tier cardio machinery, free weights, and stretching equipment.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
    ],
  },
  {
    id: 'resort-saratoga',
    name: "Disney's Saratoga Springs Resort & Spa",
    tier: 'Deluxe Villa',
    description:
      'Victorian equestrian retreat overlooking Lake Buena Vista · High Rock Spring Pool · Walkway to Disney Springs.',
    imageUrl: null,
    representingExperienceId: 'exp-saratoga',
    featurePool: 'High Rock Spring Pool',
    transportationModes: ['Boat', 'Walking', 'Bus'],
    latitude: 28.3758,
    longitude: -81.5245,
    address: '1960 Broadway, Lake Buena Vista, FL 32830',
    phone: '(407) 827-1100',
    transitTimes: {
      'Disney Springs': 5,
      EPCOT: 12,
      'Hollywood Studios': 14,
      'Animal Kingdom': 18,
      'Magic Kingdom': 18,
    },
    recreation: [
      {
        icon: '🎨',
        title: 'Painting in the Vineyard',
        badge: 'Arts & Crafts',
        description: 'Outdoor lakeside painting class capturing peaceful equestrian garden vistas.',
        hours: 'Select Afternoons',
        priceTier: '$$$',
      },
      {
        icon: '💆',
        title: 'Senses Spa at Saratoga Springs',
        badge: 'Spa',
        description: 'Full-service American spa retreat offering signature body wraps, hydrotherapy, and custom massages.',
        hours: '9:00 AM - 6:00 PM',
        priceTier: '$$$$',
      },
      {
        icon: '🏊',
        title: 'High Rock Spring Pool',
        badge: 'Feature Pool',
        description: 'Natural springs-themed pool with cascading waterfalls, 128-foot grotto waterslide, and whirlpool spas.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '⛳',
        title: 'Lake Buena Vista Golf Course Clubhouse',
        badge: 'Golf',
        description: 'Championship 18-hole golf facility certified as a Cooperative Sanctuary by Audubon International.',
        hours: 'Daylight',
        priceTier: '$$$',
      },
    ],
  },
  {
    id: 'resort-coronado',
    name: "Disney's Coronado Springs Resort",
    tier: 'Moderate',
    description:
      'Spanish Colonial and Southwestern Mexican heritage surrounding 22-acre Lago Dorado and Gran Destino Tower.',
    imageUrl: null,
    representingExperienceId: 'exp-coronado',
    featurePool: 'The Dig Site & Lost City of Cibola Pool',
    transportationModes: ['Bus'],
    latitude: 28.3644,
    longitude: -81.5694,
    address: '1000 W Buena Vista Dr, Lake Buena Vista, FL 32830',
    phone: '(407) 939-1000',
    transitTimes: {
      'Animal Kingdom': 8,
      'Hollywood Studios': 9,
      EPCOT: 12,
      'Disney Springs': 12,
      'Magic Kingdom': 16,
    },
    recreation: [
      {
        id: 'b1010001-c001-4000-8000-000000000001',
        icon: '🎨',
        title: 'Colors of Coronado Painting Experience',
        badge: 'Arts & Crafts',
        description: 'Paint an iconic Disney masterpiece alongside master artists overlooking panoramic views from Gran Destino Tower.',
        hours: 'Select Afternoons',
        priceTier: '$$$',
      },
      {
        id: 'b1010001-c001-4000-8000-000000000002',
        icon: '🎨',
        title: 'Spanish Mosaic Art Experience',
        badge: 'Arts & Crafts',
        description: 'Design and handcraft your own unique Spanish mosaic art tile inspired by Catalan architecture at Dahlia Lounge terrace.',
        hours: 'Select Mornings',
        priceTier: '$$',
      },
      {
        id: 'b1010001-c001-4000-8000-000000000003',
        icon: '🍷',
        title: 'Sangria University',
        badge: 'Class',
        description: 'Delve into the history and craft of four artisan sangria recipes with sommeliers at Three Bridges Bar & Grill.',
        hours: 'Saturdays & Sundays',
        priceTier: '$$$',
      },
      {
        id: 'rec-coronado-pool',
        icon: '🏊',
        title: 'The Dig Site & Lost City of Cibola Pool',
        badge: 'Feature Pool',
        description: '50-foot Mayan pyramid with cascading waterfall, 123-foot jaguar waterslide, and largest outdoor hot tub at WDW.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏃',
        title: 'Lago Dorado Waterfront Trail',
        badge: 'Trail',
        description: '0.9-mile scenic paved path connecting all four village neighborhoods across over-water boardwalk bridges.',
        hours: '24 Hours',
        priceTier: 'Free',
      },
      {
        icon: '🏋️',
        title: 'La Vida Health Club & Fitness Center',
        badge: 'Wellness',
        description: '24/7 fitness facility with modern cardio and strength equipment, dry saunas, and wellness services.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
      {
        icon: '🪵',
        title: 'Campfire & Movies Under the Stars',
        badge: 'Family Fun',
        description: 'Nightly marshmallow roasts by Lago Dorado followed by complimentary Disney movie screenings under the Florida twilight.',
        hours: 'Evenings',
        priceTier: 'Free',
      },
    ],
  },
  {
    id: 'resort-caribbean',
    name: "Disney's Caribbean Beach Resort",
    tier: 'Moderate',
    description:
      'Lush tropical islands surrounding 45-acre Barefoot Bay · Central Disney Skyliner transportation hub.',
    imageUrl: null,
    representingExperienceId: 'exp-caribbean',
    featurePool: 'Fuentes del Morro Pool',
    transportationModes: ['Skyliner', 'Bus'],
    latitude: 28.3582,
    longitude: -81.5435,
    address: '1114 Cayman Way, Lake Buena Vista, FL 32830',
    phone: '(407) 934-3400',
    transitTimes: {
      'Hollywood Studios': 8,
      EPCOT: 10,
      'Disney Springs': 12,
      'Animal Kingdom': 16,
      'Magic Kingdom': 18,
    },
  },
  {
    id: 'resort-pop',
    name: "Disney's Pop Century Resort",
    tier: 'Value',
    description:
      'Pop-culture decades 1950s–1990s · Hippy Dippy Pool · Skyliner bridge to EPCOT & Hollywood Studios.',
    imageUrl: null,
    representingExperienceId: 'exp-pop-century',
    featurePool: 'Hippy Dippy Pool',
    transportationModes: ['Skyliner', 'Bus'],
    latitude: 28.3512,
    longitude: -81.5412,
    address: '1050 Century Dr, Lake Buena Vista, FL 32830',
    phone: '(407) 938-4000',
    transitTimes: {
      'Hollywood Studios': 10,
      EPCOT: 12,
      'Disney Springs': 14,
      'Animal Kingdom': 16,
      'Magic Kingdom': 20,
    },
  },
  {
    id: 'resort-animation',
    name: "Disney's Art of Animation Resort",
    tier: 'Value',
    description:
      'Larger-than-life animation courtyards: The Lion King, Cars, Finding Nemo, and The Little Mermaid · Big Blue Pool.',
    imageUrl: null,
    representingExperienceId: 'exp-art-of-animation',
    featurePool: 'The Big Blue Pool',
    transportationModes: ['Skyliner', 'Bus'],
    latitude: 28.3498,
    longitude: -81.5452,
    address: '1850 Animation Way, Lake Buena Vista, FL 32830',
    phone: '(407) 938-7000',
    transitTimes: {
      'Hollywood Studios': 10,
      EPCOT: 12,
      'Disney Springs': 14,
      'Animal Kingdom': 16,
      'Magic Kingdom': 20,
    },
  },
];

// ---------------------------------------------------------------------------
// Pure helper to derive nearest theme park transit
// ---------------------------------------------------------------------------

function findNearestParkTransit(
  resortName: string,
  transitTimes?: Record<string, number>,
): { minutes: number; destination: string } {
  const times = transitTimes && Object.keys(transitTimes).length > 0
    ? transitTimes
    : resolveTransitTimes(resortName);

  let bestDest = 'Theme Parks';
  let bestMinutes = 15;

  const entries = Object.entries(times);
  if (entries.length > 0) {
    let minTime = Infinity;
    for (const [dest, mins] of entries) {
      if (typeof mins === 'number' && mins < minTime) {
        minTime = mins;
        bestDest = dest;
      }
    }
    if (minTime !== Infinity) {
      bestMinutes = minTime;
    }
  }

  // Abbreviate common park names for concise pill
  let shortDest = bestDest;
  if (bestDest === 'Magic Kingdom') shortDest = 'MK';
  else if (bestDest === 'Hollywood Studios') shortDest = 'Studios';
  else if (bestDest === 'Animal Kingdom') shortDest = 'AK';

  return { minutes: bestMinutes, destination: shortDest };
}

// ---------------------------------------------------------------------------
// HotelPreviewCard component (Task 5.2, Requirement 2.4, 2.5, 2.6)
// ---------------------------------------------------------------------------

export interface HotelPreviewCardProps {
  readonly resort: ResortDTO;
  readonly diningCount: number;
  readonly activitiesCount: number;
  readonly nearestTransit: { readonly minutes: number; readonly destination: string };
  readonly isFavorite: boolean;
  readonly onToggleFavorite: (resortId: string) => void;
  readonly onSelect: (resort: ResortDTO) => void;
}

export function HotelPreviewCard({
  resort,
  diningCount,
  activitiesCount,
  nearestTransit,
  isFavorite,
  onToggleFavorite,
  onSelect,
}: HotelPreviewCardProps): JSX.Element {
  const tier = resort.tier ?? 'Moderate';
  const tierStyle =
    tier === 'Deluxe'
      ? styles.tierDeluxe
      : tier === 'Deluxe Villa'
      ? styles.tierVilla
      : tier === 'Moderate'
      ? styles.tierModerate
      : styles.tierValue;

  const handleFavoritePress = useCallback(() => {
    onToggleFavorite(resort.representingExperienceId ?? resort.id);
  }, [onToggleFavorite, resort]);

  const handleCardPress = useCallback(() => {
    onSelect(resort);
  }, [onSelect, resort]);

  return (
    <View
      style={styles.hotelCard}
      testID={`hotel-preview-card-${resort.id}`}
      accessibilityRole="button"
      accessibilityLabel={`View ${resort.name}`}
    >
      <Pressable onPress={handleCardPress} style={styles.hotelCardInner}>
        {/* Hero Photo & Badges */}
        <View style={styles.hotelHeaderImg}>
          {resort.imageUrl ? (
            <Image
              source={{ uri: resort.imageUrl }}
              style={styles.hotelHeroImg}
              contentFit="cover"
              accessibilityLabel={`${resort.name} hero photo`}
            />
          ) : (
            <View style={[styles.hotelHeroImg, styles.hotelThemedHeader]}>
              <LinearGradient
                colors={['#1d0a2d', '#4a154b', '#7b1fa2']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons
                name="bed"
                size={84}
                color="rgba(255, 255, 255, 0.09)"
                style={styles.hotelWatermark}
              />
            </View>
          )}
          <View style={styles.hotelHeaderGradient} />

          <View style={[styles.tierBadge, tierStyle]}>
            <Text style={styles.tierBadgeText}>
              {tier === 'Deluxe Villa' ? 'Deluxe Villa' : `${tier} Resort`}
            </Text>
          </View>

          {/* Transportation pills */}
          <View style={styles.transitPillsRow}>
            {(resort.transportationModes ?? ['Bus']).slice(0, 3).map((mode) => {
              const icon =
                mode.toLowerCase().includes('monorail') ? '🚝' :
                mode.toLowerCase().includes('skyliner') ? '🚡' :
                mode.toLowerCase().includes('boat') ? '🛥️' :
                mode.toLowerCase().includes('walk') ? '🚶' : '🚌';
              return (
                <View key={mode} style={styles.transitPill}>
                  <Text style={styles.transitPillText}>{`${icon} ${mode}`}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Card Body */}
        <View style={styles.hotelCardBody}>
          <View style={styles.hotelTitleRow}>
            <View style={styles.hotelTitleTextWrap}>
              <Text style={styles.hotelTitle} testID={`hotel-title-${resort.id}`} numberOfLines={2}>
                {resort.name}
              </Text>
              <Text style={styles.hotelDescription} numberOfLines={2}>
                {resort.description ?? 'Distinctive Disney themed accommodations and hospitality.'}
              </Text>
            </View>

            <Pressable
              onPress={handleFavoritePress}
              accessibilityRole="button"
              accessibilityLabel={`Favorite ${resort.name}`}
              testID={`hotel-favorite-btn-${resort.id}`}
              style={styles.hotelFavBtn}
              hitSlop={8}
            >
              <Text style={[styles.favHeartIcon, isFavorite && styles.favHeartActive]}>
                {isFavorite ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>

          {/* 3 Glanceable Metric Pills (Requirement 2.5) */}
          <View style={styles.previewMetricsRow}>
            <View style={styles.previewMetricPill} testID={`hotel-metric-dining-${resort.id}`}>
              <Text style={styles.previewMetricPillText}>{`🍽️ ${diningCount} Dining Venues`}</Text>
            </View>
            <View style={styles.previewMetricPill} testID={`hotel-metric-activities-${resort.id}`}>
              <Text style={styles.previewMetricPillText}>{`🏊 ${activitiesCount} Activities & Pools`}</Text>
            </View>
            <View style={[styles.previewMetricPill, styles.transitMetricPill]} testID={`hotel-metric-transit-${resort.id}`}>
              <Text style={[styles.previewMetricPillText, styles.transitMetricText]}>
                {`⏱️ ${nearestTransit.minutes}m to ${nearestTransit.destination}`}
              </Text>
            </View>
          </View>

          {/* CTA Button navigating directly to ExperienceDetailScreen (Requirement 2.6) */}
          <Pressable
            style={styles.hotelCtaBtn}
            onPress={handleCardPress}
            testID={`hotel-view-resort-btn-${resort.id}`}
            accessibilityRole="button"
            accessibilityLabel={`View Resort Page for ${resort.name}`}
          >
            <Text style={styles.hotelCtaBtnText}>🏨 View Resort Page</Text>
            <Ionicons name="arrow-forward" size={16} color={theme.color.primary} />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DiningThumb component
// ---------------------------------------------------------------------------

export interface DiningThumbProps {
  readonly imageUrl?: string | null | undefined;
  readonly name: string;
  readonly testID?: string | undefined;
}

export const DiningThumb = React.memo(function DiningThumb({
  imageUrl,
  name,
  testID,
}: DiningThumbProps): JSX.Element {
  const [failed, setFailed] = useState(false);

  if (imageUrl !== null && imageUrl !== undefined && imageUrl.length > 0 && !failed) {
    return (
      <View style={styles.diningThumbWrap} testID={testID ?? 'dining-thumb-wrap'}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.diningThumbImg}
          contentFit="cover"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${name} photo`}
          testID={testID ? `${testID}-img` : 'dining-thumb-img'}
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.diningThumbWrap, styles.diningThumbPlaceholder]}
      testID={testID ?? 'dining-thumb-placeholder'}
    >
      <Ionicons name="restaurant" size={24} color="#6d28d9" />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Main ResortsDirectoryScreen component (Tasks 5.1, 5.2, 5.3)
// ---------------------------------------------------------------------------

export default function ResortsDirectoryScreen({
  navigation: passedNavigation,
  onBack,
}: ResortsDirectoryScreenProps): JSX.Element {
  const hookNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const navigation = passedNavigation ?? hookNavigation;

  const [activeTab, setActiveTab] = useState<ResortDirectoryTab>('hotels');
  const [searchInput, setSearchInput] = useState('');
  const [activeTierFilter, setActiveTierFilter] = useState<HotelTierFilter>('all');
  const [diningFilter, setDiningFilter] = useState<DiningCategoryFilter>('all');
  const [recreationFilter, setRecreationFilter] = useState<RecreationCategoryFilter>('all');
  const [selectedAmenity, setSelectedAmenity] = useState<ResortRecreationItemDTO | null>(null);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [isHotelModalOpen, setIsHotelModalOpen] = useState(false);
  const [hotelModalSearch, setHotelModalSearch] = useState('');

  const favoritedIds = useFavoritedExperiences();

  // 1. Fetch live resorts list from GET /resorts
  const resortsQuery = useQuery({
    queryKey: ['resorts', 'list'],
    queryFn: async () => {
      const res = await apiRequest<{ resorts: readonly ResortDTO[] }>('GET', '/resorts');
      return res.resorts;
    },
    staleTime: 5 * 60 * 1000,
  });

  // 2. Fetch catalog experiences with areaType=Resort for dining & recreation linking
  const catalogExperiencesQuery = useQuery({
    queryKey: ['catalog', 'resorts', 'all-experiences'],
    queryFn: async () => {
      const res = await apiRequest<{
        experiences?: readonly ExperienceDTO[];
        items?: readonly ExperienceDTO[];
      }>('GET', '/catalog?areaType=Resort');
      return res.experiences ?? res.items ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const liveResorts = resortsQuery.data && resortsQuery.data.length > 0
    ? resortsQuery.data
    : FALLBACK_RESORTS;

  const catalogExperiences = catalogExperiencesQuery.data ?? [];

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      navigation.goBack();
    }
  }, [navigation, onBack]);

  const handleSelectResort = useCallback(
    (resort: ResortDTO) => {
      const targetId = resort.representingExperienceId ?? resort.id;
      navigation.navigate('ExperienceDetail', { experienceId: targetId });
    },
    [navigation],
  );

  const handleSelectExperience = useCallback(
    (experienceId: string) => {
      navigation.navigate('ExperienceDetail', { experienceId });
    },
    [navigation],
  );

  // Group experiences by resortId for Property 4 counts
  const { diningByResortId, recreationByResortId, allDiningVenues, allRecreationItems } = useMemo(() => {
    const diningMap = new Map<string, ExperienceDTO[]>();
    const recMap = new Map<string, ExperienceDTO[]>();
    const allDining: ResortDiningVenue[] = [];
    const allRec: Array<ResortRecreationItemDTO & { resortName?: string | undefined; resortId?: string | undefined }> = [];
    const seenRecTitles = new Set<string>();

    // Fast lookup for resort names across fallback and live resorts
    const resortNameById = new Map<string, string>();
    for (const r of [...FALLBACK_RESORTS, ...liveResorts]) {
      resortNameById.set(r.id, r.name);
      if (r.representingExperienceId) {
        resortNameById.set(r.representingExperienceId, r.name);
      }
    }

    // 1. Catalog-linked experiences (Restaurants and Recreation/Spa/Tours, excluding Resort hotels)
    for (const exp of catalogExperiences) {
      const rId = (exp as any).resortId;
      if (exp.category === 'Restaurant') {
        const resortName = (rId ? resortNameById.get(rId) : null) ?? resortAreaLabel(exp) ?? undefined;
        if (rId) {
          const list = diningMap.get(rId) ?? [];
          list.push(exp);
          diningMap.set(rId, list);
        }
        allDining.push({
          id: exp.id,
          name: exp.name,
          subtitle: exp.description ?? 'On-property dining venue',
          tag: exp.subType ?? 'Dining',
          price: exp.priceTier ?? '$$',
          action: 'Menu ›',
          diningUrl: exp.diningUrl ?? null,
          meals: cleanAndSortMealPeriods(exp.mealPeriods),
          imageUrl: exp.imageUrl ?? null,
          resortName,
          resortId: rId ?? undefined,
        });
      } else if (exp.category !== 'Resort') {
        // Genuine recreation experience (not the hotel entity itself)
        const resortName = (rId ? resortNameById.get(rId) : null) ?? resortAreaLabel(exp) ?? undefined;
        if (rId) {
          const list = recMap.get(rId) ?? [];
          list.push(exp);
          recMap.set(rId, list);
        }
        seenRecTitles.add(exp.name.toLowerCase());
        allRec.push({
          id: exp.id,
          icon: exp.category === 'Spa' ? '💆' : exp.category === 'Tour' ? '🏛️' : '🏊',
          title: exp.name,
          badge: exp.subType ?? exp.category ?? 'Recreation',
          description: exp.description ?? 'Resort recreation activity',
          priceTier: exp.priceTier ?? 'Included',
          resortName,
          resortId: rId ?? undefined,
        });
      }
    }

    // 2. Always merge on-property resort recreation activities from liveResorts (combining live & curated fallback)
    for (const resort of liveResorts) {
      const liveList = resort.recreation ?? [];
      const matchedFallback = FALLBACK_RESORTS.find(
        (f) =>
          f.id === resort.id ||
          (f.representingExperienceId &&
            f.representingExperienceId === resort.representingExperienceId) ||
          f.name.toLowerCase() === resort.name.toLowerCase() ||
          resort.name
            .toLowerCase()
            .includes(f.name.toLowerCase().replace("disney's ", '')) ||
          f.name
            .toLowerCase()
            .includes(resort.name.toLowerCase().replace("disney's ", '')),
      );
      const fallbackList = matchedFallback?.recreation ?? [];
      const combined = [...fallbackList, ...liveList];
      for (const item of combined) {
        const key = `${resort.name} - ${item.title}`.toLowerCase();
        if (!seenRecTitles.has(key) && !seenRecTitles.has(item.title.toLowerCase())) {
          seenRecTitles.add(key);
          allRec.push({ ...item, resortName: resort.name, resortId: resort.id });
        }
      }
    }

    // Also include any curated recreation from FALLBACK_RESORTS for resorts not in liveResorts
    for (const fb of FALLBACK_RESORTS) {
      if (fb.recreation) {
        for (const item of fb.recreation) {
          const key = `${fb.name} - ${item.title}`.toLowerCase();
          if (!seenRecTitles.has(key) && !seenRecTitles.has(item.title.toLowerCase())) {
            seenRecTitles.add(key);
            allRec.push({ ...item, resortName: fb.name, resortId: fb.id });
          }
        }
      }
    }

    // 3. Fallback dining entries if catalog query returns sparse list
    if (allDining.length === 0) {
      const fallbackResortKeyNames: Record<string, string> = {
        coronado: "Disney's Coronado Springs Resort",
        beach: "Disney's Beach Club Resort",
        yacht: "Disney's Yacht Club Resort",
        boardwalk: "Disney's BoardWalk Inn",
        floridian: "Disney's Grand Floridian Resort & Spa",
        contemporary: "Disney's Contemporary Resort",
        polynesian: "Disney's Polynesian Village Resort",
        wilderness: "Disney's Wilderness Lodge",
        animalkingdom: "Disney's Animal Kingdom Lodge",
        riviera: "Disney's Riviera Resort",
      };
      for (const [resortKey, profile] of Object.entries(KNOWN_RESORT_PROFILES)) {
        const fallbackResortName = fallbackResortKeyNames[resortKey] ?? resortNameById.get(resortKey);
        for (const venue of profile.diningFallback) {
          allDining.push({
            ...venue,
            resortName: venue.resortName ?? fallbackResortName,
            resortId: venue.resortId ?? (resortKey ? `resort-${resortKey}` : undefined),
          });
        }
      }
    }

    return {
      diningByResortId: diningMap,
      recreationByResortId: recMap,
      allDiningVenues: allDining,
      allRecreationItems: allRec,
    };
  }, [catalogExperiences, liveResorts]);

  // Filter hotels by tier and search query (Requirement 2.3)
  const filteredHotels = useMemo(() => {
    const query = searchInput.trim().toLowerCase();
    return liveResorts.filter((resort) => {
      // Tier / Transportation filter
      if (activeTierFilter === 'deluxe') {
        if (resort.tier !== 'Deluxe') return false;
      } else if (activeTierFilter === 'moderate') {
        if (resort.tier !== 'Moderate') return false;
      } else if (activeTierFilter === 'value') {
        if (resort.tier !== 'Value') return false;
      } else if (activeTierFilter === 'dvc') {
        // Requirement 2.3: DVC Villas alias filters on persisted tier === 'Deluxe Villa'
        if (resort.tier !== 'Deluxe Villa') return false;
      } else if (activeTierFilter === 'monorail') {
        const hasMonorail = resort.transportationModes?.some((m) =>
          m.toLowerCase().includes('monorail'),
        );
        if (!hasMonorail) return false;
      } else if (activeTierFilter === 'skyliner') {
        const hasSkyliner = resort.transportationModes?.some((m) =>
          m.toLowerCase().includes('skyliner'),
        );
        if (!hasSkyliner) return false;
      } else if (activeTierFilter === 'boat') {
        const hasBoat = resort.transportationModes?.some((m) =>
          m.toLowerCase().includes('boat'),
        );
        if (!hasBoat) return false;
      }

      // Search query filter
      if (query.length > 0) {
        const nameMatch = resort.name.toLowerCase().includes(query);
        const descMatch = resort.description?.toLowerCase().includes(query) ?? false;
        if (!nameMatch && !descMatch) return false;
      }

      return true;
    });
  }, [liveResorts, activeTierFilter, searchInput]);

  const selectedHotel = useMemo(() => {
    if (!selectedHotelId) return null;
    return liveResorts.find((r) => r.id === selectedHotelId) ?? null;
  }, [selectedHotelId, liveResorts]);

  const matchesHotel = useCallback(
    (
      itemResortId: string | undefined | null,
      itemResortName: string | undefined | null,
      targetHotel: ResortDTO,
    ): boolean => {
      if (itemResortId) {
        if (itemResortId === targetHotel.id) return true;
        if (
          targetHotel.representingExperienceId &&
          itemResortId === targetHotel.representingExperienceId
        )
          return true;
        const targetSlug = targetHotel.id.replace('resort-', '').replace('exp-', '');
        const itemSlug = itemResortId.replace('resort-', '').replace('exp-', '');
        if (
          targetSlug === itemSlug ||
          itemSlug.includes(targetSlug) ||
          targetSlug.includes(itemSlug)
        )
          return true;
      }
      if (itemResortName && targetHotel.name) {
        const clean = (s: string) =>
          s
            .toLowerCase()
            .replace(/^(disney's\s+|the\s+)/, '')
            .replace(/\s*(resort(\s*&\s*spa)?|hotel|villas|lodge|inn)/g, '')
            .replace(/[^a-z0-9]/g, '');
        const cleanItem = clean(itemResortName);
        const cleanTarget = clean(targetHotel.name);
        if (
          cleanItem === cleanTarget ||
          cleanItem.includes(cleanTarget) ||
          cleanTarget.includes(cleanItem)
        )
          return true;
      }
      return false;
    },
    [],
  );

  // Filter dining venues by category, selected hotel, and search query (Requirements 2.7, 2.10)
  const filteredDining = useMemo(() => {
    let list = filterDiningByCategory(allDiningVenues, diningFilter);
    if (selectedHotel) {
      list = list.filter((v) => matchesHotel(v.resortId, v.resortName, selectedHotel));
    }
    const query = searchInput.trim().toLowerCase();
    if (query.length === 0) return list;
    return list.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        (v.resortName?.toLowerCase().includes(query) ?? false) ||
        v.subtitle.toLowerCase().includes(query) ||
        v.tag.toLowerCase().includes(query),
    );
  }, [allDiningVenues, diningFilter, selectedHotel, searchInput, matchesHotel]);

  // Filter recreation items by category, selected hotel, and search query (Requirements 2.8, 2.10)
  const filteredRecreation = useMemo(() => {
    let list = allRecreationItems;
    if (selectedHotel) {
      list = list.filter((item) =>
        matchesHotel(item.resortId, item.resortName, selectedHotel),
      );
    }
    const query = searchInput.trim().toLowerCase();
    return list.filter((item) => {
      if (recreationFilter === 'pools') {
        const isPool =
          item.badge?.toLowerCase().includes('pool') ||
          item.title.toLowerCase().includes('pool') ||
          item.title.toLowerCase().includes('water');
        if (!isPool) return false;
      } else if (recreationFilter === 'arts') {
        const isArts =
          item.badge?.toLowerCase().includes('art') ||
          item.badge?.toLowerCase().includes('craft') ||
          item.badge?.toLowerCase().includes('class') ||
          item.title.toLowerCase().includes('paint') ||
          item.title.toLowerCase().includes('mosaic') ||
          item.title.toLowerCase().includes('sangria') ||
          item.title.toLowerCase().includes('class') ||
          item.title.toLowerCase().includes('tour') ||
          item.title.toLowerCase().includes('workshop') ||
          item.description.toLowerCase().includes('paint') ||
          item.description.toLowerCase().includes('art');
        if (!isArts) return false;
      } else if (recreationFilter === 'boating') {
        const isBoat =
          item.badge?.toLowerCase().includes('boat') ||
          item.title.toLowerCase().includes('boat') ||
          item.title.toLowerCase().includes('marina');
        if (!isBoat) return false;
      } else if (recreationFilter === 'spas') {
        const isSpa =
          item.badge?.toLowerCase().includes('spa') ||
          item.title.toLowerCase().includes('spa') ||
          item.title.toLowerCase().includes('wellness');
        if (!isSpa) return false;
      } else if (recreationFilter === 'golf') {
        const isGolf =
          item.badge?.toLowerCase().includes('golf') ||
          item.title.toLowerCase().includes('golf') ||
          item.title.toLowerCase().includes('sport');
        if (!isGolf) return false;
      } else if (recreationFilter === 'family') {
        const isFamily =
          item.badge?.toLowerCase().includes('family') ||
          item.title.toLowerCase().includes('campfire') ||
          item.title.toLowerCase().includes('movie') ||
          item.title.toLowerCase().includes('arcade');
        if (!isFamily) return false;
      }

      if (query.length > 0) {
        const nameMatch = item.title.toLowerCase().includes(query);
        const descMatch = item.description.toLowerCase().includes(query);
        const resortMatch = (item.resortName ?? '').toLowerCase().includes(query);
        if (!nameMatch && !descMatch && !resortMatch) return false;
      }
      return true;
    });
  }, [allRecreationItems, recreationFilter, selectedHotel, searchInput, matchesHotel]);

  // Modal filtered hotels for bottom sheet search
  const modalFilteredHotels = useMemo(() => {
    const q = hotelModalSearch.trim().toLowerCase();
    if (!q) return liveResorts;
    return liveResorts.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.tier ? r.tier.toLowerCase().includes(q) : false) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [liveResorts, hotelModalSearch]);

  return (
    <ScreenContainer testID="resorts-directory-screen">
      {/* Header with back navigation, title, and subtitle matching Explore size and shape (Requirement 2.1) */}
      <GradientHeader
        colors={['#1d0a2d', '#4a154b', '#7b1fa2']}
        iconText="🏨"
        title="Disney Resorts & Hotels"
        subtitle={`${liveResorts.length} Properties · On-Property Concierge`}
        compact
        onBack={handleBack}
        backAccessibilityLabel="Back to Explore"
        backTestID="resorts-back-btn"
      />

      {/* Dedicated Search Input (Requirement 2.1) */}
      <View style={styles.controls}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={theme.color.textSecondary} style={styles.searchIcon} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search hotels, lounges, dining, activities..."
            placeholderTextColor={theme.color.textSecondary}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search resorts, dining, and activities"
            testID="resorts-search-input"
          />
          {searchInput.length > 0 ? (
            <Pressable
              onPress={() => setSearchInput('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="resorts-search-clear"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 4 Partition Tabs (Requirement 2.2) */}
      <View style={styles.tabsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContent}
        >
          <Pressable
            style={[styles.tabBtn, activeTab === 'hotels' && styles.tabBtnActive]}
            onPress={() => setActiveTab('hotels')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'hotels' }}
            accessibilityLabel={`Hotels tab, ${liveResorts.length} properties`}
            testID="resorts-tab-hotels"
          >
            <Text style={[styles.tabBtnText, activeTab === 'hotels' && styles.tabBtnTextActive]}>
              {`🏨 Hotels (${liveResorts.length})`}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabBtn, activeTab === 'dining' && styles.tabBtnActive]}
            onPress={() => setActiveTab('dining')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'dining' }}
            accessibilityLabel={`Dining tab, ${allDiningVenues.length} venues`}
            testID="resorts-tab-dining"
          >
            <Text style={[styles.tabBtnText, activeTab === 'dining' && styles.tabBtnTextActive]}>
              {`🍽️ Dining (${allDiningVenues.length})`}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabBtn, activeTab === 'recreation' && styles.tabBtnActive]}
            onPress={() => setActiveTab('recreation')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'recreation' }}
            accessibilityLabel={`Recreation tab, ${allRecreationItems.length} activities`}
            testID="resorts-tab-recreation"
          >
            <Text style={[styles.tabBtnText, activeTab === 'recreation' && styles.tabBtnTextActive]}>
              {`🏊 Recreation (${allRecreationItems.length})`}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabBtn, activeTab === 'subdest' && styles.tabBtnActive]}
            onPress={() => setActiveTab('subdest')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'subdest' }}
            accessibilityLabel="Sub-Destinations tab, 37 experiences"
            testID="resorts-tab-subdest"
          >
            <Text style={[styles.tabBtnText, activeTab === 'subdest' && styles.tabBtnTextActive]}>
              {'🎪 Sub-Destinations (37)'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* ----------------------------------------------------
          TAB 1: HOTELS DIRECTORY (Requirement 2.3, 2.4, 2.5)
         ---------------------------------------------------- */}
      {activeTab === 'hotels' ? (
        <View style={styles.tabBody}>
          {/* Horizontal filter strip (Requirement 2.3) */}
          <View style={styles.filterBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScrollView}
              contentContainerStyle={styles.filterStrip}
              testID="resorts-hotels-filter-scroll"
            >
            <Pressable
              style={[styles.filterPill, activeTierFilter === 'all' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('all')}
              testID="resorts-filter-all"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'all' && styles.filterPillTextActive,
                ]}
              >
                {`All (${liveResorts.length})`}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'deluxe' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('deluxe')}
              testID="resorts-filter-deluxe"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'deluxe' && styles.filterPillTextActive,
                ]}
              >
                👑 Deluxe
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'moderate' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('moderate')}
              testID="resorts-filter-moderate"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'moderate' && styles.filterPillTextActive,
                ]}
              >
                🌿 Moderate
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'value' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('value')}
              testID="resorts-filter-value"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'value' && styles.filterPillTextActive,
                ]}
              >
                🎨 Value
              </Text>
            </Pressable>

            {/* Requirement 2.3: DVC Villas filter label is a display-only alias for tier === 'Deluxe Villa' */}
            <Pressable
              style={[styles.filterPill, activeTierFilter === 'dvc' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('dvc')}
              testID="resorts-filter-dvc"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'dvc' && styles.filterPillTextActive,
                ]}
              >
                🏰 DVC Villas
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'monorail' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('monorail')}
              testID="resorts-filter-monorail"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'monorail' && styles.filterPillTextActive,
                ]}
              >
                🚝 Monorail
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'skyliner' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('skyliner')}
              testID="resorts-filter-skyliner"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'skyliner' && styles.filterPillTextActive,
                ]}
              >
                🚡 Skyliner
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, activeTierFilter === 'boat' && styles.filterPillActive]}
              onPress={() => setActiveTierFilter('boat')}
              testID="resorts-filter-boat"
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeTierFilter === 'boat' && styles.filterPillTextActive,
                ]}
              >
                🛥️ Boat
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Hotel cards list (Requirement 2.4, 2.5) */}
        <FlatList
          style={styles.list}
          data={filteredHotels}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              // Property 4: exact count of linked active restaurants / recreation experiences or static fallback
              const linkedDining = diningByResortId.get(item.id);
              const staticProfile = resolveResortProfile(item.name, item);
              const diningCount = linkedDining && linkedDining.length > 0
                ? linkedDining.length
                : (staticProfile.diningFallback.length > 0 ? staticProfile.diningFallback.length : 4);

              const linkedRec = recreationByResortId.get(item.id);
              const matchedFallback = FALLBACK_RESORTS.find(
                (f) =>
                  f.id === item.id ||
                  (f.representingExperienceId &&
                    f.representingExperienceId === item.representingExperienceId) ||
                  f.name.toLowerCase() === item.name.toLowerCase() ||
                  item.name
                    .toLowerCase()
                    .includes(f.name.toLowerCase().replace("disney's ", '')) ||
                  f.name
                    .toLowerCase()
                    .includes(item.name.toLowerCase().replace("disney's ", '')),
              );
              const totalRecCount = (() => {
                const set = new Set<string>();
                for (const r of [
                  ...(matchedFallback?.recreation ?? []),
                  ...(item.recreation ?? []),
                ]) {
                  set.add(r.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
                }
                return set.size;
              })();
              const activitiesCount = linkedRec && linkedRec.length > 0
                ? linkedRec.length
                : totalRecCount > 0
                  ? totalRecCount
                  : (item.recreation?.length ?? 4);

              const nearestTransit = findNearestParkTransit(item.name, item.transitTimes);

              const isFav =
                favoritedIds.has(item.id) ||
                (item.representingExperienceId !== null &&
                  favoritedIds.has(item.representingExperienceId ?? ''));

              return (
                <HotelPreviewCard
                  resort={item}
                  diningCount={diningCount}
                  activitiesCount={activitiesCount}
                  nearestTransit={nearestTransit}
                  isFavorite={isFav}
                  onToggleFavorite={() => {}}
                  onSelect={handleSelectResort}
                />
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="search-outline"
                title="No hotels match filters"
                body="Try adjusting your tier or transport filters."
              />
            }
          />
        </View>
      ) : null}

      {/* ----------------------------------------------------
          TAB 2: DINING & LOUNGES DIRECTORY (Requirement 2.7)
         ---------------------------------------------------- */}
      {activeTab === 'dining' ? (
        <View style={styles.tabBody}>
          {/* Category & hotel filter pills (Requirements 2.7, 2.10) */}
          <View style={styles.filterBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScrollView}
              contentContainerStyle={styles.filterStrip}
              testID="resorts-dining-filter-scroll"
            >
            {/* Hotel filter button (Requirement 2.10) */}
            <Pressable
              style={[
                styles.hotelFilterPill,
                selectedHotel !== null && styles.hotelFilterPillActive,
              ]}
              onPress={() => setIsHotelModalOpen(true)}
              testID="dining-hotel-filter-btn"
              accessibilityRole="button"
              accessibilityLabel={`Filter dining by hotel, currently ${selectedHotel ? selectedHotel.name : 'All Hotels'}`}
            >
              <Text style={styles.hotelFilterPillIcon}>🏨</Text>
              <Text
                style={[
                  styles.hotelFilterPillText,
                  selectedHotel !== null && styles.hotelFilterPillTextActive,
                ]}
                numberOfLines={1}
              >
                {selectedHotel ? selectedHotel.name.replace("Disney's ", '') : 'All Hotels'}
              </Text>
              {selectedHotel ? (
                <Pressable
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    setSelectedHotelId(null);
                  }}
                  testID="dining-hotel-filter-clear"
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Clear hotel filter"
                >
                  <Ionicons name="close-circle" size={14} color="#ffffff" style={styles.hotelFilterPillClearIcon} />
                </Pressable>
              ) : (
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={theme.color.textSecondary}
                  style={styles.hotelFilterPillChevron}
                />
              )}
            </Pressable>
            <Pressable
              style={[styles.filterPill, diningFilter === 'all' && styles.filterPillActive]}
              onPress={() => setDiningFilter('all')}
              testID="dining-filter-all"
            >
              <Text
                style={[
                  styles.filterPillText,
                  diningFilter === 'all' && styles.filterPillTextActive,
                ]}
              >
                All Dining
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, diningFilter === 'table' && styles.filterPillActive]}
              onPress={() => setDiningFilter('table')}
              testID="dining-filter-table"
            >
              <Text
                style={[
                  styles.filterPillText,
                  diningFilter === 'table' && styles.filterPillTextActive,
                ]}
              >
                Table Service
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, diningFilter === 'quick' && styles.filterPillActive]}
              onPress={() => setDiningFilter('quick')}
              testID="dining-filter-quick"
            >
              <Text
                style={[
                  styles.filterPillText,
                  diningFilter === 'quick' && styles.filterPillTextActive,
                ]}
              >
                Quick Service
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, diningFilter === 'lounge' && styles.filterPillActive]}
              onPress={() => setDiningFilter('lounge')}
              testID="dining-filter-lounge"
            >
              <Text
                style={[
                  styles.filterPillText,
                  diningFilter === 'lounge' && styles.filterPillTextActive,
                ]}
              >
                Lounges
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Dining cards list */}
        <FlatList
          style={styles.list}
          data={filteredDining}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={styles.diningCard}
                testID={`resort-dining-card-${item.id}`}
                onPress={() => handleSelectExperience(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.name}`}
              >
                <DiningThumb
                  imageUrl={item.imageUrl}
                  name={item.name}
                  testID={`dining-thumb-${item.id}`}
                />
                <View style={styles.diningCardBody}>
                  <Text style={styles.diningTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.resortName ? (
                    <View style={styles.diningLocationRow} testID={`dining-resort-${item.id}`}>
                      <Ionicons
                        name="location-sharp"
                        size={11}
                        color="#6d28d9"
                        style={styles.diningLocationIcon}
                      />
                      <Text style={styles.diningLocationText} numberOfLines={1}>
                        {item.resortName}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.diningMetaRow}>
                    <View style={styles.diningTagBadge}>
                      <Text style={styles.diningTagText}>{item.tag}</Text>
                    </View>
                    <Text style={styles.diningPrice}>{item.price}</Text>
                    {item.meals && item.meals.length > 0 ? (
                      <Text style={styles.diningMealsText}>{item.meals.join(' · ')}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.diningCardActions}>
                  <FavoriteToggle
                    experienceId={item.id}
                    favorited={favoritedIds.has(item.id)}
                    size="small"
                  />
                  <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="restaurant-outline"
                title="No dining locations found"
                body="Try adjusting your dining filter or search term."
              />
            }
          />
        </View>
      ) : null}

      {/* ----------------------------------------------------
          TAB 3: RECREATION DIRECTORY (Requirement 2.8)
         ---------------------------------------------------- */}
      {activeTab === 'recreation' ? (
        <View style={styles.tabBody}>
          {/* Recreation category & hotel filters (Requirements 2.8, 2.10) */}
          <View style={styles.filterBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScrollView}
              contentContainerStyle={styles.filterStrip}
              testID="resorts-rec-filter-scroll"
            >
            {/* Hotel filter button (Requirement 2.10) */}
            <Pressable
              style={[
                styles.hotelFilterPill,
                selectedHotel !== null && styles.hotelFilterPillActive,
              ]}
              onPress={() => setIsHotelModalOpen(true)}
              testID="rec-hotel-filter-btn"
              accessibilityRole="button"
              accessibilityLabel={`Filter recreation by hotel, currently ${selectedHotel ? selectedHotel.name : 'All Hotels'}`}
            >
              <Text style={styles.hotelFilterPillIcon}>🏨</Text>
              <Text
                style={[
                  styles.hotelFilterPillText,
                  selectedHotel !== null && styles.hotelFilterPillTextActive,
                ]}
                numberOfLines={1}
              >
                {selectedHotel ? selectedHotel.name.replace("Disney's ", '') : 'All Hotels'}
              </Text>
              {selectedHotel ? (
                <Pressable
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    setSelectedHotelId(null);
                  }}
                  testID="rec-hotel-filter-clear"
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Clear hotel filter"
                >
                  <Ionicons name="close-circle" size={14} color="#ffffff" style={styles.hotelFilterPillClearIcon} />
                </Pressable>
              ) : (
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={theme.color.textSecondary}
                  style={styles.hotelFilterPillChevron}
                />
              )}
            </Pressable>
            <Pressable
              style={[styles.filterPill, recreationFilter === 'all' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('all')}
              testID="rec-filter-all"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'all' && styles.filterPillTextActive,
                ]}
              >
                All Activities
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'pools' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('pools')}
              testID="rec-filter-pools"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'pools' && styles.filterPillTextActive,
                ]}
              >
                🏊 Pools & Water
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'arts' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('arts')}
              testID="rec-filter-arts"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'arts' && styles.filterPillTextActive,
                ]}
              >
                🎨 Arts & Classes
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'boating' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('boating')}
              testID="rec-filter-boating"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'boating' && styles.filterPillTextActive,
                ]}
              >
                🛥️ Boating & Marinas
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'spas' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('spas')}
              testID="rec-filter-spas"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'spas' && styles.filterPillTextActive,
                ]}
              >
                💆 Spas & Wellness
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'golf' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('golf')}
              testID="rec-filter-golf"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'golf' && styles.filterPillTextActive,
                ]}
              >
                ⛳ Golf & Sports
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, recreationFilter === 'family' && styles.filterPillActive]}
              onPress={() => setRecreationFilter('family')}
              testID="rec-filter-family"
            >
              <Text
                style={[
                  styles.filterPillText,
                  recreationFilter === 'family' && styles.filterPillTextActive,
                ]}
              >
                🔥 Family Fun
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Recreation cards list */}
        <FlatList
          style={styles.list}
          data={filteredRecreation}
            keyExtractor={(item, index) => item.id ?? `${item.title}-${index}`}
            contentContainerStyle={styles.listContent}
            initialNumToRender={50}
            renderItem={({ item, index }) => (
              <Pressable
                style={styles.recCard}
                testID={`resort-rec-card-${item.id ?? index}`}
                onPress={() => {
                  if (item.id && !item.id.startsWith('rec-')) {
                    handleSelectExperience(item.id);
                  } else {
                    setSelectedAmenity(item);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.title}`}
              >
                <View style={styles.recIconWrap}>
                  <Text style={styles.recIconText}>{item.icon}</Text>
                </View>
                <View style={styles.recCardBody}>
                  <Text style={styles.recTitle}>{item.title}</Text>
                  <Text style={styles.recDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <View style={styles.recMetaRow}>
                    {item.resortName ? (
                      <View style={styles.recResortBadge} testID="rec-resort-badge">
                        <Text style={styles.recResortBadgeText}>📍 {item.resortName}</Text>
                      </View>
                    ) : null}
                    {item.badge ? (
                      <View style={styles.recBadge}>
                        <Text style={styles.recBadgeText}>{item.badge}</Text>
                      </View>
                    ) : null}
                    {item.hours ? (
                      <Text style={styles.recHoursText}>{item.hours}</Text>
                    ) : null}
                    {item.priceTier ? (
                      <Text style={styles.recPriceText}>{item.priceTier}</Text>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
              </Pressable>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="fitness-outline"
                title="No activities found"
                body="Try adjusting your recreation category filter."
              />
            }
          />
        </View>
      ) : null}

      {/* ----------------------------------------------------
          TAB 4: SUB-DESTINATIONS (Requirement 2.9)
         ---------------------------------------------------- */}
      {activeTab === 'subdest' ? (
        <ScrollView contentContainerStyle={styles.subdestContainer}>
          {/* 1. Disney's BoardWalk & Promenade */}
          <Card style={styles.subdestCard} testID="subdest-card-boardwalk">
            <View style={styles.subdestHeaderRow}>
              <View style={[styles.subdestBadge, { backgroundColor: '#ede9fe' }]}>
                <Text style={[styles.subdestBadgeText, { color: '#6d28d9' }]}>
                  Crescent Lake Waterfront
                </Text>
              </View>
            </View>
            <Text style={styles.subdestTitle}>Disney's BoardWalk & Promenade</Text>
            <Text style={styles.subdestDescription}>
              Turn-of-the-century Atlantic boardwalk featuring premier nightlife, dueling piano
              bars, dance halls, and seaside dining connecting EPCOT and Hollywood Studios.
            </Text>
            <View style={styles.subdestHighlightPill}>
              <Text style={styles.subdestHighlightText}>
                Jellyrolls · Atlantic Dance Hall · BoardWalk Deli · Surrey Bikes
              </Text>
            </View>
          </Card>

          {/* 2. ESPN Wide World of Sports Complex */}
          <Card style={styles.subdestCard} testID="subdest-card-wwos">
            <View style={styles.subdestHeaderRow}>
              <View style={[styles.subdestBadge, { backgroundColor: '#fee2e2' }]}>
                <Text style={[styles.subdestBadgeText, { color: '#b91c1c' }]}>
                  Premier Athletics
                </Text>
              </View>
            </View>
            <Text style={styles.subdestTitle}>ESPN Wide World of Sports Complex</Text>
            <Text style={styles.subdestDescription}>
              State-of-the-art 220-acre athletic complex hosting national cheerleading, basketball
              tournaments, runDisney expos, and training fields.
            </Text>
            <View style={styles.subdestHighlightPill}>
              <Text style={styles.subdestHighlightText}>
                AdventHealth Arena · The Turf Fields · ESPN Sports Grill
              </Text>
            </View>
          </Card>

          {/* 3. Championship Golf Courses & Mini-Golf */}
          <Card style={styles.subdestCard} testID="subdest-card-golf">
            <View style={styles.subdestHeaderRow}>
              <View style={[styles.subdestBadge, { backgroundColor: '#dcfce7' }]}>
                <Text style={[styles.subdestBadgeText, { color: '#15803d' }]}>
                  Outdoor Adventures & Golf
                </Text>
              </View>
            </View>
            <Text style={styles.subdestTitle}>
              Fantasia Gardens, Winter Summerland & Golf Courses
            </Text>
            <Text style={styles.subdestDescription}>
              36 holes of whimsical miniature golf at Fantasia Gardens and Winter Summerland, plus
              18-hole PGA Tour caliber courses at Palm, Magnolia, and Lake Buena Vista.
            </Text>
            <View style={styles.subdestHighlightPill}>
              <Text style={styles.subdestHighlightText}>
                Fantasia Gardens · Winter Summerland · Palm & Magnolia Golf
              </Text>
            </View>
          </Card>
        </ScrollView>
      ) : null}

      {/* Amenity Modal Sheet for static recreation items */}
      <Modal
        visible={selectedAmenity !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedAmenity(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedAmenity(null)} />
          <View style={styles.modalSheet} testID="resorts-amenity-modal">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{selectedAmenity?.title}</Text>
            <Text style={styles.modalDescription}>{selectedAmenity?.description}</Text>
            {selectedAmenity?.hours ? (
              <Text style={styles.modalDetailText}>{`Hours: ${selectedAmenity.hours}`}</Text>
            ) : null}
            {selectedAmenity?.priceTier ? (
              <Text style={styles.modalDetailText}>{`Cost: ${selectedAmenity.priceTier}`}</Text>
            ) : null}
            <Pressable
              style={styles.modalCloseBtn}
              onPress={() => setSelectedAmenity(null)}
              testID="resorts-amenity-modal-close"
            >
              <Text style={styles.modalCloseBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Hotel Filter Modal Sheet (Requirement 2.10) */}
      <Modal
        visible={isHotelModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setIsHotelModalOpen(false);
          setHotelModalSearch('');
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setIsHotelModalOpen(false);
              setHotelModalSearch('');
            }}
          />
          <View style={styles.hotelModalSheet} testID="resorts-hotel-picker-modal">
            <View style={styles.modalHandle} />

            <View style={styles.hotelModalHeader}>
              <Text style={styles.hotelModalTitle}>Filter by Disney Resort</Text>
              <Pressable
                onPress={() => {
                  setIsHotelModalOpen(false);
                  setHotelModalSearch('');
                }}
                testID="resorts-hotel-modal-close"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close hotel filter"
              >
                <Ionicons name="close" size={22} color={theme.color.textSecondary} />
              </Pressable>
            </View>

            {/* Search Input */}
            <View style={styles.hotelModalSearchWrap}>
              <Ionicons
                name="search"
                size={16}
                color={theme.color.textSecondary}
                style={styles.hotelModalSearchIcon}
              />
              <TextInput
                value={hotelModalSearch}
                onChangeText={setHotelModalSearch}
                placeholder="Search resorts (e.g. Grand Floridian, Riviera)..."
                placeholderTextColor={theme.color.textSecondary}
                style={styles.hotelModalSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
                testID="resorts-hotel-modal-search"
                accessibilityLabel="Search resorts"
              />
              {hotelModalSearch.length > 0 ? (
                <Pressable
                  onPress={() => setHotelModalSearch('')}
                  hitSlop={8}
                  testID="resorts-hotel-modal-search-clear"
                >
                  <Ionicons name="close-circle" size={16} color={theme.color.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            {/* List of Resorts */}
            <ScrollView style={styles.hotelModalList} keyboardShouldPersistTaps="handled">
              {/* Option 0: All Resorts & Hotels (Reset) */}
              <Pressable
                style={[
                  styles.hotelModalRow,
                  selectedHotelId === null && styles.hotelModalRowSelected,
                ]}
                onPress={() => {
                  setSelectedHotelId(null);
                  setIsHotelModalOpen(false);
                  setHotelModalSearch('');
                }}
                testID="hotel-filter-option-all"
                accessibilityRole="button"
                accessibilityLabel="All Resorts and Hotels, show all"
              >
                <View style={styles.hotelModalRowIconWrap}>
                  <Text style={styles.hotelModalRowIcon}>✨</Text>
                </View>
                <View style={styles.hotelModalRowInfo}>
                  <Text
                    style={[
                      styles.hotelModalRowName,
                      selectedHotelId === null && styles.hotelModalRowNameSelected,
                    ]}
                  >
                    All Resorts & Hotels
                  </Text>
                  <Text style={styles.hotelModalRowSubtitle}>
                    {`Show all venues across all ${liveResorts.length} properties`}
                  </Text>
                </View>
                {selectedHotelId === null ? (
                  <Ionicons name="checkmark-circle" size={20} color="#6d28d9" />
                ) : null}
              </Pressable>

              {/* Individual Resorts */}
              {modalFilteredHotels.map((resort) => {
                const isSelected = selectedHotelId === resort.id;
                const tierColor =
                  resort.tier === 'Deluxe' || resort.tier === 'Deluxe Villa'
                    ? '#7c3aed'
                    : resort.tier === 'Moderate'
                      ? '#059669'
                      : '#2563eb';
                return (
                  <Pressable
                    key={resort.id}
                    style={[
                      styles.hotelModalRow,
                      isSelected && styles.hotelModalRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedHotelId(resort.id);
                      setIsHotelModalOpen(false);
                      setHotelModalSearch('');
                    }}
                    testID={`hotel-filter-option-${resort.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={resort.name}
                  >
                    <View style={styles.hotelModalRowIconWrap}>
                      <Text style={styles.hotelModalRowIcon}>🏨</Text>
                    </View>
                    <View style={styles.hotelModalRowInfo}>
                      <Text
                        style={[
                          styles.hotelModalRowName,
                          isSelected && styles.hotelModalRowNameSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {resort.name}
                      </Text>
                      <View style={styles.hotelModalRowBadgeRow}>
                        <View
                          style={[
                            styles.hotelModalTierBadge,
                            { backgroundColor: `${tierColor}18` },
                          ]}
                        >
                          <Text
                            style={[
                              styles.hotelModalTierBadgeText,
                              { color: tierColor },
                            ]}
                          >
                            {resort.tier}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={20} color="#6d28d9" />
                    ) : null}
                  </Pressable>
                );
              })}

              {modalFilteredHotels.length === 0 ? (
                <View style={styles.hotelModalEmpty}>
                  <Text style={styles.hotelModalEmptyText}>
                    {`No resorts match "${hotelModalSearch}"`}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  tabsRow: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1edfa',
  },
  tabsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1edfa',
  },
  tabBtnActive: {
    backgroundColor: theme.color.primary,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  tabBtnTextActive: {
    color: '#ffffff',
  },
  tabBody: {
    flex: 1,
  },
  filterBarWrap: {
    flexShrink: 0,
  },
  filterScrollView: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e9e3f5',
  },
  filterPillActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  filterPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  hotelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e9e3f5',
    overflow: 'hidden',
    shadowColor: '#371556',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  hotelCardInner: {
    width: '100%',
  },
  hotelHeaderImg: {
    height: 130,
    width: '100%',
    position: 'relative',
    backgroundColor: '#371556',
  },
  hotelHeroImg: {
    width: '100%',
    height: '100%',
  },
  hotelThemedHeader: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  hotelWatermark: {
    position: 'absolute',
    right: 12,
    bottom: -10,
  },
  hotelHeaderGradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  tierBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#ffffff',
  },
  tierDeluxe: {
    backgroundColor: '#d97706',
  },
  tierVilla: {
    backgroundColor: '#7c3aed',
  },
  tierModerate: {
    backgroundColor: '#0284c7',
  },
  tierValue: {
    backgroundColor: '#9333ea',
  },
  transitPillsRow: {
    position: 'absolute',
    bottom: 8,
    left: 10,
    flexDirection: 'row',
    gap: 4,
  },
  transitPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  transitPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  hotelCardBody: {
    padding: 12,
  },
  hotelTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  hotelTitleTextWrap: {
    flex: 1,
  },
  hotelTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  hotelDescription: {
    fontSize: 11.5,
    color: theme.color.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  hotelFavBtn: {
    padding: 4,
  },
  favHeartIcon: {
    fontSize: 18,
    color: theme.color.textSecondary,
  },
  favHeartActive: {
    color: '#ef4444',
  },
  previewMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 8,
  },
  previewMetricPill: {
    backgroundColor: '#f5f2fb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(126, 87, 194, 0.15)',
  },
  previewMetricPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: theme.color.primary,
  },
  transitMetricPill: {
    backgroundColor: '#f0f9ff',
    borderColor: '#bae6fd',
  },
  transitMetricText: {
    color: '#0284c7',
  },
  hotelCtaBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f5fd',
    borderWidth: 1,
    borderColor: 'rgba(106, 27, 154, 0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  hotelCtaBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.color.primary,
  },
  diningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e9e3f5',
    padding: 10,
    gap: 12,
  },
  diningThumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  diningThumbImg: {
    width: '100%',
    height: '100%',
  },
  diningThumbPlaceholder: {
    backgroundColor: '#ede9fe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  diningCardBody: {
    flex: 1,
    gap: 2,
  },
  diningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  diningLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  diningLocationIcon: {
    marginTop: 0.5,
  },
  diningLocationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6d28d9',
  },
  diningMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  diningTagBadge: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  diningTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6d28d9',
  },
  diningPrice: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  diningMealsText: {
    fontSize: 10.5,
    color: theme.color.textSecondary,
  },
  diningCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e9e3f5',
    padding: 12,
    gap: 10,
  },
  recIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ede9fe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recIconText: {
    fontSize: 18,
  },
  recCardBody: {
    flex: 1,
  },
  recTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  recDescription: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  recMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  recBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recResortBadge: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recResortBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#6d28d9',
  },
  recBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#15803d',
  },
  recHoursText: {
    fontSize: 10,
    color: theme.color.textSecondary,
  },
  recPriceText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  subdestContainer: {
    padding: 16,
    gap: 14,
  },
  subdestCard: {
    padding: 14,
    borderRadius: 16,
  },
  subdestHeaderRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  subdestBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  subdestBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  subdestTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.color.textPrimary,
    marginBottom: 4,
  },
  subdestDescription: {
    fontSize: 12,
    color: theme.color.textSecondary,
    lineHeight: 17,
    marginBottom: 10,
  },
  subdestHighlightPill: {
    backgroundColor: '#f1edfa',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subdestHighlightText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.primary,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: theme.color.textPrimary,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 13,
    color: theme.color.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
  },
  modalDetailText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
    marginBottom: 4,
  },
  modalCloseBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  modalCloseBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  // Hotel filter pill & modal styles (Requirement 2.10)
  hotelFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 8,
  },
  hotelFilterPillActive: {
    backgroundColor: '#6d28d9',
    borderColor: '#6d28d9',
  },
  hotelFilterPillIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  hotelFilterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6d28d9',
    maxWidth: 130,
  },
  hotelFilterPillTextActive: {
    color: '#ffffff',
  },
  hotelFilterPillChevron: {
    marginLeft: 4,
  },
  hotelFilterPillClearIcon: {
    marginLeft: 5,
  },
  hotelModalSheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '82%',
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  hotelModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  hotelModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  hotelModalSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 10,
  },
  hotelModalSearchIcon: {
    marginRight: 8,
  },
  hotelModalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.color.textPrimary,
    paddingVertical: 0,
  },
  hotelModalList: {
    flexGrow: 0,
  },
  hotelModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  hotelModalRowSelected: {
    backgroundColor: '#f5f3ff',
  },
  hotelModalRowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  hotelModalRowIcon: {
    fontSize: 16,
  },
  hotelModalRowInfo: {
    flex: 1,
    marginRight: 8,
  },
  hotelModalRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  hotelModalRowNameSelected: {
    color: '#6d28d9',
  },
  hotelModalRowSubtitle: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  hotelModalRowBadgeRow: {
    flexDirection: 'row',
    marginTop: 3,
  },
  hotelModalTierBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  hotelModalTierBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  hotelModalEmpty: {
    padding: 24,
    alignItems: 'center',
  },
  hotelModalEmptyText: {
    color: theme.color.textSecondary,
    fontSize: 14,
  },
});
