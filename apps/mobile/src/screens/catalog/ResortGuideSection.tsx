// Feature: experience-detail-redesign, Task 26.3 — ResortGuideSection
//
// Validates: Requirements 20.4, 20.5, 20.6
//
// Dedicated concierge guide for Disney Resort hotels:
//   1. Resort Highlights Card detailing property theme, village layout, and tier
//   2. On-Property Dining Directory listing active dining venues for this resort
//   3. Recreation & Amenities Card detailing feature pools, trails, wellness, and evening campfire
//   4. Property Map & Transit Card showing map preview, verified address, and direct park travel times

import React from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  ExperienceDTO,
  ResortDTO,
  ResortRecreationItemDTO,
  ResortTier,
} from '@dwt/shared';

import { apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  directionsUrlCandidates,
  hasValidCoordinates,
  staticMapUrl,
  type DirectionsPlatform,
} from './directions';
import { isQuickServiceDining } from './gating';
import {
  computeVisibleItems,
  filterDiningByCategory,
  classifyDiningCategory,
  type DiningCategoryFilter,
} from './resortGuideView';

function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export interface ResortGuideSectionProps {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly resort?: ResortDTO | null | undefined;
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
}


export interface ResortDiningVenue {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly tag: string;
  readonly price: string;
  readonly action: 'Reserve' | 'Menu ›';
  readonly diningUrl?: string | null;
  readonly meals?: readonly string[] | undefined;
  readonly imageUrl?: string | null;
  readonly resortName?: string | undefined;
  readonly resortId?: string | null | undefined;
}

export interface ResortHighlightBlock {
  readonly emoji: string;
  readonly title: string;
  readonly desc: string;
}

export interface ResortProfile {
  readonly blurb: string;
  readonly address: string;
  readonly highlights: readonly ResortHighlightBlock[];
  readonly diningSubtitle: string;
  readonly diningFallback: readonly ResortDiningVenue[];
  readonly recreationFallback?: readonly ResortRecreationItemDTO[];
  readonly transitTimes?: Record<string, number>;
}

export const DEFAULT_TRANSIT_BY_RESORT: Record<string, Record<string, number>> = {
  coronado: {
    'Animal Kingdom': 8,
    'Hollywood Studios': 9,
    EPCOT: 12,
    'Disney Springs': 12,
    'Magic Kingdom': 16,
  },
  beach: {
    EPCOT: 5,
    'Hollywood Studios': 12,
    'Disney Springs': 15,
    'Animal Kingdom': 16,
    'Magic Kingdom': 18,
  },
  yacht: {
    EPCOT: 6,
    'Hollywood Studios': 12,
    'Disney Springs': 15,
    'Animal Kingdom': 16,
    'Magic Kingdom': 18,
  },
  boardwalk: {
    EPCOT: 5,
    'Hollywood Studios': 12,
    'Disney Springs': 15,
    'Animal Kingdom': 16,
    'Magic Kingdom': 18,
  },
  floridian: {
    'Magic Kingdom': 4,
    'Hollywood Studios': 16,
    EPCOT: 18,
    'Animal Kingdom': 18,
    'Disney Springs': 20,
  },
  polynesian: {
    'Magic Kingdom': 8,
    EPCOT: 15,
    'Hollywood Studios': 16,
    'Animal Kingdom': 18,
    'Disney Springs': 20,
  },
  contemporary: {
    'Magic Kingdom': 5,
    'Hollywood Studios': 16,
    EPCOT: 18,
    'Animal Kingdom': 18,
    'Disney Springs': 20,
  },
  wilderness: {
    'Magic Kingdom': 8,
    EPCOT: 16,
    'Hollywood Studios': 18,
    'Disney Springs': 18,
    'Animal Kingdom': 20,
  },
  animal: {
    'Animal Kingdom': 6,
    'Hollywood Studios': 14,
    EPCOT: 16,
    'Disney Springs': 18,
    'Magic Kingdom': 22,
  },
  riviera: {
    EPCOT: 8,
    'Hollywood Studios': 8,
    'Disney Springs': 14,
    'Animal Kingdom': 16,
    'Magic Kingdom': 18,
  },
  caribbean: {
    'Hollywood Studios': 8,
    EPCOT: 10,
    'Disney Springs': 12,
    'Animal Kingdom': 16,
    'Magic Kingdom': 18,
  },
  pop: {
    'Hollywood Studios': 10,
    EPCOT: 12,
    'Disney Springs': 14,
    'Animal Kingdom': 16,
    'Magic Kingdom': 20,
  },
  animation: {
    'Hollywood Studios': 10,
    EPCOT: 12,
    'Disney Springs': 14,
    'Animal Kingdom': 16,
    'Magic Kingdom': 20,
  },
};

export const KNOWN_DINING_METADATA: Record<
  string,
  {
    subtitle: string;
    tag: string;
    price: string;
    action: 'Reserve' | 'Menu ›';
    meals?: readonly string[];
  }
> = {
  // Coronado Springs
  toledo: {
    subtitle: 'Rooftop signature dining atop Gran Destino Tower • Surrealist Spanish interior',
    tag: 'Rooftop Signature',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'three bridges': {
    subtitle: 'Lakeside open-air dining at Villa del Lago • Sangria flights & warm churros',
    tag: 'Lakeside Casual',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },
  'maya grill': {
    subtitle: 'Nuevo Latino cuisine under Mayan sun deities and fire accents',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  dahlia: {
    subtitle: 'Tower rooftop cocktails and lobby espresso bar inspired by Salvador Dalí',
    tag: 'Lounges',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },
  barcelona: {
    subtitle: 'Catalan-inspired lobby espresso bar by day, Spanish cocktail lounge by night',
    tag: 'Lounges',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Dinner', 'Late Night'],
  },
  'el mercado': {
    subtitle: 'Airy food court with artisan pizzas, Mexican specialties, and grab-and-go',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  siestas: {
    subtitle: 'Poolside retreat serving nachos, tacos, and tropical specialty cocktails',
    tag: 'Poolside Bar',
    price: '$$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },
  'rix sports': {
    subtitle: 'Upscale sports lounge serving craft beers and classic American game-day fare',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'cafe rix': {
    subtitle: 'Artisan cafe serving specialty coffees, pastries, and grab-and-go items',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  laguna: {
    subtitle: 'Sip on a refreshing beverage at this breezy lakeside tequila and mezcal bar',
    tag: 'Lakeside Bar',
    price: '$$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },

  // Beach Club
  'cape may': {
    subtitle: "New England-style beachside clambake dinner buffet and Minnie's Beach Bash character breakfast",
    tag: 'Character Buffet',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  'beaches & cream': {
    subtitle: 'Nostalgic Atlantic seashore soda shop famous for burgers, grilled cheese, and Kitchen Sink sundaes',
    tag: 'Casual Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Lunch', 'Dinner'],
  },
  'beach club marketplace': {
    subtitle: 'Quick-service hub with hot breakfast platters, artisan sandwiches, and grab-and-go essentials',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  "martha's vineyard": {
    subtitle: 'New England-inspired lounge offering fine wines, craft beers, clam chowder, and coastal cocktails',
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },
  'hurricane hanna': {
    subtitle: 'Open-air poolside grill and cocktail retreat on Stormalong Bay serving burgers and frozen drinks',
    tag: 'Poolside Grill',
    price: '$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },

  // Yacht Club
  yachtsman: {
    subtitle: 'Signature New England steakhouse serving prime grain-fed steaks, fresh seafood, and savory sides',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'ale & compass': {
    subtitle: 'Gastropub-inspired New England coastal classics and hearty hearth-oven comfort dishes',
    tag: 'Casual Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'market at ale': {
    subtitle: 'Airy grab-and-go market offering hot breakfast paninis, sandwiches, and specialty coffee',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  "crew's cup": {
    subtitle: 'Cozy maritime lounge adjacent to Yachtsman Steakhouse with prime rib sliders and craft draft beers',
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // Grand Floridian
  'victoria & albert': {
    subtitle: 'AAA Five Diamond culinary palace with exquisite multi-course French-inspired chef tasting menus',
    tag: 'Fine Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'cítricos': {
    subtitle: 'Mary Poppins Returns-inspired signature dining featuring Mediterranean-influenced Florida cuisine',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  citricos: {
    subtitle: 'Mary Poppins Returns-inspired signature dining featuring Mediterranean-influenced Florida cuisine',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  narcoossee: {
    subtitle: 'Waterfront coastal dining on Seven Seas Lagoon with panoramic views of Magic Kingdom fireworks',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'grand floridian cafe': {
    subtitle: 'Charming Victorian cafe serving elevated American bistro favorites, crab cake benedicts, and steaks',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  '1900 park fare': {
    subtitle: 'Whimsical carousel-themed buffet celebrating wishmakers like Mirabel, Aladdin, Cinderella, and Tiana',
    tag: 'Character Dining',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  gasparilla: {
    subtitle: '24-hour quick-service bakery and cafe overlooking the Seven Seas Lagoon marina',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner', 'Late Night'],
  },
  'enchanted rose': {
    subtitle: 'Sophisticated four-room lounge inspired by Beauty and the Beast with craft cocktails and caviar',
    tag: 'Lounge',
    price: '$$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // Polynesian Village
  "'ohana": {
    subtitle: "Family-style Polynesian feasts with fire-grilled skewers, 'Ohana noodles, and Stitch character breakfast",
    tag: 'Family-Style Feast',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  ohana: {
    subtitle: "Family-style Polynesian feasts with fire-grilled skewers, 'Ohana noodles, and Stitch character breakfast",
    tag: 'Family-Style Feast',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  'kona cafe': {
    subtitle: 'Casual island dining famous for legendary Macadamia Nut Pancakes, Tonga Toast, and fresh sushi',
    tag: 'Casual Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'trader sam': {
    subtitle: 'Iconic interactive tiki bar with theatrical cocktail surprises, volcano eruptions, and Polynesian pupus',
    tag: 'Tiki Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },
  "capt. cook": {
    subtitle: '24-hour South Seas quick-service favorite serving Pulled Pork Nachos, Thai Coconut Meatballs, and Tonga Toast',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner', 'Late Night'],
  },
  'pineapple lanai': {
    subtitle: 'Open-air walk-up counter serving world-famous traditional Dole Whip soft-serve swirls and floats',
    tag: 'Snack Counter',
    price: '$',
    action: 'Menu ›',
    meals: ['Snacks', 'Treats'],
  },

  // Contemporary
  'california grill': {
    subtitle: '15th-floor rooftop signature dining with California-market cooking and private fireworks observation decks',
    tag: 'Rooftop Signature',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'chef mickey': {
    subtitle: 'Lively Grand Canyon Concourse buffet with Mickey, Minnie, Donald, Goofy, and Pluto greeting each table',
    tag: 'Character Buffet',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  'steakhouse 71': {
    subtitle: 'Retro 1971-inspired chophouse with vintage Walt Disney photos, prime rib, and signature burgers',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'contempo cafe': {
    subtitle: 'Airy quick service directly beneath the Monorail beam serving flatbreads, grain bowls, and cupcakes',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'outer rim': {
    subtitle: 'Open concourse lounge overlooking Bay Lake with craft cocktails and evening twilight views',
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // Wilderness Lodge
  'artist point': {
    subtitle: 'Enchanted forest character dinner featuring Snow White, Dopey, Grumpy, and the Evil Queen',
    tag: 'Character Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'whispering canyon': {
    subtitle: 'Raucous Old West dining hall with bottomless barbecue skillets, hobby horse races, and ketchup antics',
    tag: 'Family-Style Feast',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'geyser point': {
    subtitle: 'Open-air cedar pavilion on Bay Lake serving bison bacon burgers, Northwest craft beers, and cocktails',
    tag: 'Lakeside Bar & Grill',
    price: '$$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },
  'roaring fork': {
    subtitle: 'Rustic quick-service nook serving breakfast hash, barbecue brisket sandwiches, and gourmet cupcakes',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'territory lounge': {
    subtitle: 'Intimate wood-paneled lounge featuring Northwest wines, fondue, and charcuterie boards',
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // Animal Kingdom Lodge
  jiko: {
    subtitle: 'Vibrant wood-burning ovens serving bold African, Indian, and Mediterranean fusion cuisine with South African wines',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  boma: {
    subtitle: 'Lively African marketplace buffet with wood-grilled meats, butternut squash soup, and zebra domes',
    tag: 'Market Buffet',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  sanaa: {
    subtitle: 'Kidani Village restaurant overlooking Sunset Savanna famous for its 9-dip Indian-style Bread Service and braised short ribs',
    tag: 'Savanna Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Lunch', 'Dinner'],
  },
  'the mara': {
    subtitle: 'Savanna quick-service spot serving falafel pita, flatbreads, breakfast bowls, and grab-and-go zebra domes',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'victoria falls': {
    subtitle: 'Mezzanine lounge perched above Boma serving African craft beers, specialty cocktails, and small bites',
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // BoardWalk Inn
  'flying fish': {
    subtitle: 'High-end contemporary seafood and prime steaks prepared in a theatrical open showcase kitchen',
    tag: 'Signature Dining',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'trattoria al forno': {
    subtitle: 'Cozy Italian trattoria serving handcrafted pastas, wood-fired pizzas, and Italian regional wines',
    tag: 'Casual Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  'cake bake shop': {
    subtitle: 'Elegant waterfront confectionary and restaurant serving artisanal French pastries, cakes, and champagne',
    tag: 'Table Service & Bakery',
    price: '$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'boardwalk deli': {
    subtitle: 'Northeastern deli counter offering warm pastrami, house-baked bagels, and seasonal pastries',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  abracadabar: {
    subtitle: "Former illusionists' haunt with mystical cocktails, magical memorabilia, and curious craft concoctions",
    tag: 'Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Dinner', 'Late Night'],
  },

  // Riviera Resort
  topolino: {
    subtitle: 'Rooftop character breakfast with artist Mickey & friends and signature French-Italian coastal dinner',
    tag: 'Rooftop Signature',
    price: '$$$$',
    action: 'Reserve',
    meals: ['Breakfast', 'Dinner'],
  },
  'primo piatto': {
    subtitle: 'Trattoria-style quick service serving blueberry-lemon pancakes, hearth-baked artisanal pizzas, and sandwiches',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'bar riva': {
    subtitle: 'Chic open-air poolside bar and lounge serving Mediterranean small plates, spritzers, and frozen cocktails',
    tag: 'Poolside Bar & Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },
  'le petit caf': {
    subtitle: 'Charming Parisian coffee bar in the lobby serving espresso and pastries by day, wine and desserts by night',
    tag: 'Coffee & Wine Bar',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Dinner', 'Late Night'],
  },

  // Caribbean Beach
  'sebastian': {
    subtitle: 'Casual waterfront dining on Barefoot Bay serving family-style Caribbean jerk chicken, mojo pork, and coconut bread pudding',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'banana cabana': {
    subtitle: 'Lively poolside bar and lounge serving tropical cocktails, jerk chicken wings, and loaded fries',
    tag: 'Poolside Bar & Lounge',
    price: '$$',
    action: 'Menu ›',
    meals: ['Lunch', 'Dinner'],
  },
  'centertown market': {
    subtitle: 'Indoor street market quick-service food hall offering custom bowls, burgers, and Island-inspired breakfast',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },

  // Pop Century & Art of Animation
  'everything pop': {
    subtitle: 'Sprawling food court serving custom burgers, artisan pizzas, and nostalgic tie-dye cheesecake',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },
  'landscape of flavors': {
    subtitle: 'Culinary market featuring made-to-order burgers, customized pasta bowls, and smoothies',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Lunch', 'Dinner'],
  },

  // Port Orleans
  boatwright: {
    subtitle: 'Southern hospitality serving slow-cooked jambalaya, crawfish bisque, and Nashville hot chicken',
    tag: 'Table Service',
    price: '$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
  'scat cat': {
    subtitle: 'Authentic fluffy Mickey-shaped New Orleans beignets served warm with powdered sugar and specialty dipping sauces',
    tag: 'Quick Service',
    price: '$',
    action: 'Menu ›',
    meals: ['Breakfast', 'Dinner', 'Late Night'],
  },

  // Fort Wilderness
  'hoop-dee-doo': {
    subtitle: 'Legendary pioneer musical comedy dinner show serving all-you-care-to-enjoy fried chicken and barbecue ribs',
    tag: 'Dinner Show',
    price: '$$$',
    action: 'Reserve',
    meals: ['Dinner'],
  },
};

export const KNOWN_RESORT_PROFILES: Record<string, ResortProfile> = {
  coronado: {
    blurb:
      'Spanish Colonial and Southwestern Mexican heritage surrounding 22-acre Lago Dorado. Guests can stroll across wooden boardwalk bridges to Villa del Lago or take in panoramic Florida skyline views from Gran Destino Tower.',
    address: '1000 W Buena Vista Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🏰',
        title: 'Gran Destino Tower',
        desc: '16-story rooftop oasis featuring Catalan-inspired stained glass and grand lobby.',
      },
      {
        emoji: '🏊',
        title: 'The Dig Site & Lost City of Cibola Pool',
        desc: '50-foot Mayan pyramid with cascading waterfall, 123-foot jaguar waterslide, and massive outdoor hot tub.',
      },
      {
        emoji: '🌉',
        title: 'Villa del Lago Over-Water Island',
        desc: 'Three connecting wooden bridges over 22-acre Lago Dorado to open-air dining.',
      },
      {
        emoji: '🏡',
        title: 'Village Neighborhoods',
        desc: 'Distinct Casitas (urban courtyards), Ranchos (desert flora), and Cabanas (coastal hammocks).',
      },
    ],
    diningSubtitle:
      'Award-winning Spanish tapas, Tex-Mex feasts, and panoramic rooftop views:',
    diningFallback: [
      {
        id: 'a2b8f7c2-5aed-5432-a69c-8944524ce74c',
        name: 'Toledo – Tapas, Steak & Seafood',
        subtitle:
          'Rooftop signature dining atop Gran Destino Tower • Surrealist Spanish interior',
        tag: 'Rooftop Signature',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/coronado-springs-resort/toledo/',
        meals: ['Dinner'],
      },
      {
        id: '7fedf9d2-0cf1-59df-bb66-0e77d947dece',
        name: 'Three Bridges Bar & Grill',
        subtitle:
          'Lakeside open-air dining at Villa del Lago • Sangria flights & warm churros',
        tag: 'Lakeside Casual',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/coronado-springs-resort/three-bridges-bar-and-grill/',
        meals: ['Dinner', 'Late Night'],
      },
      {
        id: '0fcc636e-2dcb-56c6-9d8c-88d27846093d',
        name: 'Maya Grill',
        subtitle: 'Nuevo Latino cuisine under Mayan sun deities and fire accents',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/coronado-springs-resort/maya-grill/',
        meals: ['Dinner'],
      },
      {
        id: 'cc393774-6eb2-5385-a87a-12dd4ddb62a1',
        name: 'Dahlia Lounge & Barcelona Lounge',
        subtitle:
          'Tower rooftop cocktails and lobby espresso bar inspired by Salvador Dalí',
        tag: 'Lounges',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/coronado-springs-resort/dahlia-lounge/',
        meals: ['Breakfast', 'Dinner', 'Late Night'],
      },
      {
        id: 'b7cba035-5b25-5697-a0ca-dadef0054658',
        name: 'El Mercado de Coronado',
        subtitle:
          'Airy food court with artisan pizzas, Mexican specialties, and grab-and-go',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/coronado-springs-resort/el-mercado-de-coronado/',
        meals: ['Breakfast', 'Lunch', 'Dinner'],
      },
    ],
    recreationFallback: [
      {
        id: 'b1010001-c001-4000-8000-000000000001',
        icon: '🎨',
        title: 'Colors of Coronado Painting Experience',
        badge: 'Arts & Crafts',
        description:
          'Paint an iconic Disney masterpiece alongside master artists overlooking panoramic views from Gran Destino Tower.',
        hours: 'Select Afternoons',
        priceTier: '$$$',
      },
      {
        id: 'b1010001-c001-4000-8000-000000000002',
        icon: '🎨',
        title: 'Spanish Mosaic Art Experience',
        badge: 'Arts & Crafts',
        description:
          'Design and handcraft your own unique Spanish mosaic art tile inspired by Catalan architecture at Dahlia Lounge terrace.',
        hours: 'Select Mornings',
        priceTier: '$$',
      },
      {
        id: 'b1010001-c001-4000-8000-000000000003',
        icon: '🍷',
        title: 'Sangria University',
        badge: 'Class',
        description:
          'Delve into the history and craft of four artisan sangria recipes with sommeliers at Three Bridges Bar & Grill.',
        hours: 'Saturdays & Sundays',
        priceTier: '$$$',
      },
      {
        icon: '🏊',
        title: 'The Dig Site & Lost City of Cibola Pool',
        badge: 'Feature Pool',
        description:
          '50-foot Mayan pyramid with cascading waterfall, 123-foot jaguar waterslide, and largest outdoor hot tub at WDW.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏃',
        title: 'Lago Dorado Waterfront Trail',
        badge: 'Trail',
        description:
          '0.9-mile scenic paved path connecting all four village neighborhoods across over-water boardwalk bridges.',
        hours: '24 Hours',
        priceTier: 'Free',
      },
      {
        icon: '🏋️',
        title: 'La Vida Health Club & Fitness Center',
        badge: 'Wellness',
        description:
          '24/7 fitness facility with modern cardio and strength equipment, dry saunas, and wellness services.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
      {
        icon: '🪵',
        title: 'Campfire & Movies Under the Stars',
        badge: 'Family Fun',
        description:
          'Nightly marshmallow roasts by Lago Dorado followed by complimentary Disney movie screenings under the Florida twilight.',
        hours: 'Evenings',
        priceTier: 'Free',
      },
    ],
  },

  'beach club': {
    blurb:
      'Charming New England seaside cottage elegance along Crescent Lake. Guests enjoy pastel coastal architecture, white sandy shores, and a breezy 5-minute stroll to the EPCOT International Gateway.',
    address: '1800 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🏖️',
        title: 'Stormalong Bay Sand Lagoon',
        desc: '3-acre aquatic mini water park with genuine sand-bottom pools, life-sized shipwreck, and 230-foot twisting waterslide.',
      },
      {
        emoji: '⛵',
        title: 'Crescent Lake & EPCOT Gateway',
        desc: 'Picturesque waterfront promenade connecting to EPCOT and Disney’s Hollywood Studios via Friendship Boats and walking paths.',
      },
      {
        emoji: '🍦',
        title: 'Beaches & Cream & Cape May Cafe',
        desc: 'Retro Atlantic seashore soda fountain serving the Kitchen Sink sundae, alongside Minnie’s Beach Bash Character Breakfast.',
      },
      {
        emoji: '🌊',
        title: 'Tidal Pool & Leisure Sun Decks',
        desc: 'Two secluded heated leisure pools at Beach Club and Beach Club Villas surrounded by fragrant gardens and shaded loungers.',
      },
    ],
    diningSubtitle:
      'Fresh coastal seafood, casual soda fountain treats, and poolside favorites:',
    diningFallback: [
      {
        id: 'beach-club-cape-may',
        name: 'Cape May Cafe',
        subtitle:
          "New England-style beachside clambake dinner buffet and Minnie's Beach Bash character breakfast",
        tag: 'Character Buffet',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/beach-club-resort/cape-may-cafe/',
        meals: ['Breakfast', 'Dinner'],
      },
      {
        id: 'beach-club-beaches-cream',
        name: 'Beaches & Cream Soda Shop',
        subtitle:
          'Nostalgic Atlantic seashore soda shop famous for burgers, grilled cheese, and the legendary Kitchen Sink sundae',
        tag: 'Casual Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/beach-club-resort/beaches-and-cream-soda-shop/',
        meals: ['Lunch', 'Dinner'],
      },
      {
        id: 'beach-club-marketplace',
        name: 'Beach Club Marketplace',
        subtitle:
          'Quick-service hub with hot breakfast platters, artisan sandwiches, and grab-and-go essentials',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/beach-club-resort/beach-club-marketplace/',
        meals: ['Breakfast', 'Lunch', 'Dinner'],
      },
      {
        id: 'beach-club-marthas-vineyard',
        name: "Martha's Vineyard",
        subtitle:
          'New England-inspired lounge offering fine wines, craft beers, clam chowder, and coastal cocktails',
        tag: 'Lounge',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/beach-club-resort/marthas-vineyard/',
        meals: ['Dinner', 'Late Night'],
      },
      {
        id: 'beach-club-hurricane-hannas',
        name: "Hurricane Hanna's Waterside Bar and Grill",
        subtitle:
          'Open-air poolside grill and cocktail retreat on Stormalong Bay serving burgers and frozen drinks',
        tag: 'Poolside Grill',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/beach-club-resort/hurricane-hannas-waterside-bar-and-grill/',
        meals: ['Lunch', 'Dinner'],
      },
    ],
  },

  'yacht club': {
    blurb:
      'Stately New England yacht club sophistication designed by Robert A.M. Stern. Features rich hardwood floors, brass nautical accents, and prime waterfront access on Crescent Lake.',
    address: '1700 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '⚓',
        title: 'Stormalong Bay Aquatic Playground',
        desc: 'Shared 3-acre water park featuring a sand-bottom lagoon, lazy river, and life-sized shipwreck slide.',
      },
      {
        emoji: '🥩',
        title: 'Yachtsman Steakhouse',
        desc: 'Premier signature dining venue serving dry-aged prime steaks, fresh seafood, and an extensive global wine cellar.',
      },
      {
        emoji: '⛵',
        title: 'Crescent Lake Marina & Watercraft',
        desc: 'Friendship Boat transportation to EPCOT and Hollywood Studios plus surrey bike rentals along the promenade.',
      },
      {
        emoji: '🎾',
        title: 'The Admiral Pool & Ship Shape Health Club',
        desc: 'Peaceful quiet pool in a manicured courtyard and full-service fitness center with steam rooms and saunas.',
      },
    ],
    diningSubtitle:
      'Prime New England steaks, gastropub classics, and maritime lounges:',
    diningFallback: [
      {
        id: 'yacht-club-yachtsman',
        name: 'Yachtsman Steakhouse',
        subtitle:
          'Signature New England steakhouse serving prime grain-fed steaks, fresh seafood, and savory sides',
        tag: 'Signature Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/yacht-club-resort/yachtsman-steakhouse/',
      },
      {
        id: 'yacht-club-ale-compass',
        name: 'Ale & Compass Restaurant',
        subtitle:
          'Gastropub-inspired New England coastal classics and hearty hearth-oven comfort dishes',
        tag: 'Casual Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/yacht-club-resort/ale-and-compass/',
      },
      {
        id: 'yacht-club-market-ale',
        name: 'The Market at Ale & Compass',
        subtitle:
          'Airy grab-and-go market offering hot breakfast paninis, sandwiches, and specialty coffee',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/yacht-club-resort/market-at-ale-and-compass/',
      },
      {
        id: 'yacht-club-crews-cup',
        name: "Crew's Cup Lounge",
        subtitle:
          'Cozy maritime lounge adjacent to Yachtsman Steakhouse with prime rib sliders and craft draft beers',
        tag: 'Lounge',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/yacht-club-resort/crews-cup-lounge/',
      },
    ],
  },

  'grand floridian': {
    blurb:
      "Walt Disney World's flagship resort celebrates the golden era of Victorian beach resorts. Features a soaring 5-story lobby atrium, stained-glass domes, live orchestra music, and views of Seven Seas Lagoon.",
    address: '4401 Floridian Way, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🏰',
        title: 'Victorian Grandeur & Monorail Concourse',
        desc: 'Direct Monorail and water taxi access to Magic Kingdom, with evening fireworks views from the marina.',
      },
      {
        emoji: '🏊',
        title: 'Beach Pool & Natural Rock Springs',
        desc: '111,261-gallon pool with 181-foot natural rock waterslide, walking bridge, zero-depth entry, and cabana rentals.',
      },
      {
        emoji: '🍽️',
        title: "Victoria & Albert's & Signature Dining",
        desc: "AAA Five Diamond culinary palace, Cítricos Mediterranean dining, Narcoossee's waterfront views, and 1900 Park Fare.",
      },
      {
        emoji: '🧖',
        title: 'The Grand Floridian Spa',
        desc: 'Full-service Victorian wellness sanctuary offering botanical facials, therapeutic massage, and soothing relaxation lounges.',
      },
    ],
    diningSubtitle:
      'AAA Five Diamond signature dining, Victorian cafes, and character meals:',
    diningFallback: [
      {
        id: 'gf-victoria-alberts',
        name: "Victoria & Albert's",
        subtitle:
          'AAA Five Diamond culinary palace with exquisite multi-course French-inspired chef tasting menus',
        tag: 'Fine Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/grand-floridian-resort-and-spa/victoria-and-alberts/',
      },
      {
        id: 'gf-citricos',
        name: 'Cítricos',
        subtitle:
          'Mary Poppins Returns-inspired signature dining featuring Mediterranean-influenced Florida cuisine',
        tag: 'Signature Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/grand-floridian-resort-and-spa/citricos/',
      },
      {
        id: 'gf-narcoossees',
        name: "Narcoossee's",
        subtitle:
          'Waterfront coastal dining on Seven Seas Lagoon with panoramic views of Magic Kingdom fireworks',
        tag: 'Signature Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/grand-floridian-resort-and-spa/narcoossees/',
      },
      {
        id: 'gf-grand-floridian-cafe',
        name: 'Grand Floridian Cafe',
        subtitle:
          'Charming Victorian cafe serving elevated American bistro favorites, crab cake benedicts, and steaks',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/grand-floridian-resort-and-spa/grand-floridian-cafe/',
      },
      {
        id: 'gf-1900-park-fare',
        name: '1900 Park Fare',
        subtitle:
          'Whimsical carousel-themed buffet celebrating wishmakers like Mirabel, Aladdin, Cinderella, and Tiana',
        tag: 'Character Dining',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/grand-floridian-resort-and-spa/1900-park-fare/',
      },
    ],
  },

  polynesian: {
    blurb:
      "An oasis of South Seas hospitality celebrating South Pacific island culture since Walt Disney World's opening day in 1971. Lush palm groves, white-sand beaches, and tiki torches surround Seven Seas Lagoon.",
    address: '1600 Seven Seas Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🌋',
        title: 'Lava Pool & Volcanic Massif',
        desc: 'Signature pool built into a towering volcanic rock formation with a 142-foot twisting waterslide and lagoon views.',
      },
      {
        emoji: '🚝',
        title: 'Resort Monorail & Water Taxi',
        desc: 'Direct Monorail station in the Great Ceremonial House connecting to Magic Kingdom, EPCOT, and nearby resorts.',
      },
      {
        emoji: '🌺',
        title: "'Ohana & Trader Sam's Grog Grotto",
        desc: 'Family-style feasts with fire-grilled skewers, character breakfast with Stitch, and the legendary interactive tiki bar.',
      },
      {
        emoji: '🌴',
        title: 'Seven Seas Lagoon Beach & Torch Lighting',
        desc: 'Nightly torch lighting ceremonies, white sand hammocks, and prime viewing of the Electrical Water Pageant.',
      },
    ],
    diningSubtitle:
      'South Seas family-style feasts, tropical tiki cocktails, and Dole Whip treats:',
    diningFallback: [
      {
        id: 'poly-ohana',
        name: "'Ohana",
        subtitle:
          "Family-style Polynesian feasts with fire-grilled skewers, 'Ohana noodles, and Stitch character breakfast",
        tag: 'Family-Style Feast',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/polynesian-resort/ohana/',
      },
      {
        id: 'poly-kona-cafe',
        name: 'Kona Cafe',
        subtitle:
          'Casual island dining famous for legendary Macadamia Nut Pancakes, Tonga Toast, and fresh sushi',
        tag: 'Casual Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/polynesian-resort/kona-cafe/',
      },
      {
        id: 'poly-trader-sams',
        name: "Trader Sam's Grog Grotto",
        subtitle:
          'Iconic interactive tiki bar with theatrical cocktail surprises, volcano eruptions, and Polynesian pupus',
        tag: 'Tiki Lounge',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/polynesian-resort/trader-sams-grog-grotto/',
      },
      {
        id: 'poly-capt-cooks',
        name: "Capt. Cook's",
        subtitle:
          '24-hour South Seas quick-service favorite serving Pulled Pork Nachos, Thai Coconut Meatballs, and Tonga Toast',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/polynesian-resort/capt-cooks/',
      },
    ],
  },

  contemporary: {
    blurb:
      'An ultra-modern opening-day marvel known for its futuristic 14-story concrete A-frame tower. The iconic Walt Disney World Monorail glides directly through the bustling Grand Canyon Concourse.',
    address: '4600 N World Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🚆',
        title: 'Monorail Flying Concourse',
        desc: "The Monorail glides directly through the 14-story atrium alongside Mary Blair's towering 90-foot ceramic tile mural.",
      },
      {
        emoji: '🎆',
        title: 'California Grill Rooftop Dining',
        desc: '15th-floor signature restaurant offering seasonal California cuisine and private panoramic fireworks observation decks.',
      },
      {
        emoji: '🚶',
        title: 'Walkway to Magic Kingdom',
        desc: "Short 10-minute pedestrian path connecting directly to Magic Kingdom's main entrance turnstiles.",
      },
      {
        emoji: '🏊',
        title: 'Feature Pool & Bay Lake Watersports',
        desc: 'Heated lakeside pool with 17-foot twisting slide, Bay Lake boat rentals, and evening Electrical Water Pageant views.',
      },
    ],
    diningSubtitle:
      'Panoramic rooftop fireworks dining, character buffets, and modern chophouses:',
    diningFallback: [
      {
        id: 'contemp-california-grill',
        name: 'California Grill',
        subtitle:
          '15th-floor rooftop signature dining with California-market cooking and private fireworks observation decks',
        tag: 'Rooftop Signature',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/contemporary-resort/california-grill/',
      },
      {
        id: 'contemp-chef-mickeys',
        name: "Chef Mickey's",
        subtitle:
          'Lively Grand Canyon Concourse buffet with Mickey, Minnie, Donald, Goofy, and Pluto greeting each table',
        tag: 'Character Buffet',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/contemporary-resort/chef-mickeys/',
      },
      {
        id: 'contemp-steakhouse-71',
        name: 'Steakhouse 71',
        subtitle:
          'Retro 1971-inspired chophouse with vintage Walt Disney photos, prime rib, and signature burgers',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/contemporary-resort/steakhouse-71/',
      },
      {
        id: 'contemp-contempo-cafe',
        name: 'Contempo Cafe',
        subtitle:
          'Airy quick service directly beneath the Monorail beam serving flatbreads, grain bowls, and cupcakes',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/contemporary-resort/contempo-cafe/',
      },
    ],
  },

  wilderness: {
    blurb:
      'Inspired by legendary turn-of-the-century national park lodges of the American Northwest. Features an 82-foot stone fireplace, bubbling interior hot spring, and towering timber architecture along Bay Lake.',
    address: '901 Timberline Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🪵',
        title: 'Grand Timber Lodge & Fireplace',
        desc: 'Soaring 7-story lobby with massive totem poles, an 82-foot rock fireplace matching Grand Canyon strata, and natural spring.',
      },
      {
        emoji: '🏊',
        title: 'Copper Creek Springs Pool',
        desc: 'Heated pool fed by lobby hot springs, featuring a 67-foot waterslide built into natural boulders and hot/cold whirlpool spas.',
      },
      {
        emoji: '💨',
        title: 'Fire Rock Geyser & Piney Woods',
        desc: 'Authentic artificial geyser erupting 120 feet into the air every hour on the hour alongside Bay Lake nature trails.',
      },
      {
        emoji: '⛵',
        title: 'Water Taxi to Magic Kingdom',
        desc: 'Scenic boat launch taking guests across Bay Lake and Seven Seas Lagoon directly to Magic Kingdom.',
      },
    ],
    diningSubtitle:
      'Pacific Northwest character dining, rowdy Western skillets, and lakeside lounges:',
    diningFallback: [
      {
        id: 'wl-artist-point',
        name: 'Story Book Dining at Artist Point',
        subtitle:
          'Enchanted forest character dinner featuring Snow White, Dopey, Grumpy, and the Evil Queen',
        tag: 'Character Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/wilderness-lodge-resort/artist-point/',
      },
      {
        id: 'wl-whispering-canyon',
        name: 'Whispering Canyon Cafe',
        subtitle:
          'Raucous Old West dining hall with bottomless barbecue skillets, hobby horse races, and ketchup antics',
        tag: 'Family-Style Feast',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/wilderness-lodge-resort/whispering-canyon-cafe/',
      },
      {
        id: 'wl-geyser-point',
        name: 'Geyser Point Bar & Grill',
        subtitle:
          'Open-air cedar pavilion on Bay Lake serving bison bacon burgers, Northwest craft beers, and cocktails',
        tag: 'Lakeside Bar & Grill',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/wilderness-lodge-resort/geyser-point-bar-and-grill/',
      },
      {
        id: 'wl-roaring-fork',
        name: 'Roaring Fork',
        subtitle:
          'Rustic quick-service nook serving breakfast hash, barbecue brisket sandwiches, and gourmet cupcakes',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/wilderness-lodge-resort/roaring-fork/',
      },
    ],
  },

  animal: {
    blurb:
      'Immersive African safari lodge designed in the shape of a traditional semicircular kraal. Overlooks four private 11-acre savannas home to over 200 roaming African hoofed animals and exotic birds.',
    address: '2901 Osceola Pkwy, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🦒',
        title: 'Four Private Wildlife Savannas',
        desc: 'Lush savannas with over 200 animals including giraffes, zebras, gazelles, and resident African Cultural Representatives.',
      },
      {
        emoji: '🏊',
        title: 'Uzima & Samawati Springs Pools',
        desc: 'Two zero-entry themed pools featuring natural rock waterslides, flamingos, and the Uwanja Camp water playground.',
      },
      {
        emoji: '🍽️',
        title: 'Award-Winning African Cuisine',
        desc: 'Signature dining at Jiko (wood-burning ovens & African wines), Boma marketplace buffet, and Sanaa savanna bread service.',
      },
      {
        emoji: '🪵',
        title: 'Authentic African Art Collection',
        desc: 'One of the largest curated collections of authentic indigenous African artwork and wood carvings in North America.',
      },
    ],
    diningSubtitle:
      'Award-winning African and Indian cuisine, marketplace buffets, and savanna lounges:',
    diningFallback: [
      {
        id: 'akl-jiko',
        name: 'Jiko – The Cooking Place',
        subtitle:
          'Vibrant wood-burning ovens serving bold African, Indian, and Mediterranean fusion cuisine with South African wines',
        tag: 'Signature Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/animal-kingdom-lodge/jiko-the-cooking-place/',
      },
      {
        id: 'akl-boma',
        name: 'Boma – Flavors of Africa',
        subtitle:
          'Lively African marketplace buffet with wood-grilled meats, butternut squash soup, and zebra domes',
        tag: 'Market Buffet',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/animal-kingdom-lodge/boma-flavors-of-africa/',
      },
      {
        id: 'akl-sanaa',
        name: 'Sanaa',
        subtitle:
          'Kidani Village restaurant overlooking Sunset Savanna famous for its 9-dip Indian-style Bread Service and braised short ribs',
        tag: 'Savanna Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/animal-kingdom-villas-kidani/sanaa/',
      },
      {
        id: 'akl-the-mara',
        name: 'The Mara',
        subtitle:
          'Savanna quick-service spot serving falafel pita, flatbreads, breakfast bowls, and grab-and-go zebra domes',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/animal-kingdom-lodge/the-mara/',
      },
    ],
  },

  boardwalk: {
    blurb:
      'Recreates the charm and excitement of a 1930s mid-Atlantic coastal boardwalk along Crescent Lake. Features street performers, midway arcade games, nightlife, and direct Skyliner and boat access.',
    address: '2101 Epcot Resorts Blvd, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🎪',
        title: 'Crescent Lake Boardwalk Promenade',
        desc: 'Quarter-mile wooden seaside promenade with evening jugglers, magicians, surrey bike rentals, and midway games.',
      },
      {
        emoji: '🏊',
        title: 'Luna Park Pool & Keister Coaster',
        desc: '184,217-gallon carnival-themed pool featuring the famous 200-foot-long Keister Coaster wooden rollercoaster waterslide.',
      },
      {
        emoji: '🚡',
        title: 'Disney Skyliner & Friendship Boats',
        desc: 'Direct water taxis and a 5-minute stroll to the EPCOT International Gateway Skyliner station.',
      },
      {
        emoji: '🍽️',
        title: 'Flying Fish & Boardwalk Bakeries',
        desc: 'Signature seafood dining at Flying Fish, classic Italian at Trattoria al Forno, and The Cake Bake Shop by Gwendolyn Rogers.',
      },
    ],
    diningSubtitle:
      'Waterfront steaks and seafood, Italian trattorias, and seaside bakeries:',
    diningFallback: [
      {
        id: 'bw-flying-fish',
        name: 'Flying Fish',
        subtitle:
          'High-end contemporary seafood and prime steaks prepared in a theatrical open showcase kitchen',
        tag: 'Signature Dining',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/boardwalk/flying-fish/',
      },
      {
        id: 'bw-trattoria',
        name: 'Trattoria al Forno',
        subtitle:
          'Cozy Italian trattoria serving handcrafted pastas, wood-fired pizzas, and Italian regional wines',
        tag: 'Casual Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/boardwalk/trattoria-al-forno/',
      },
      {
        id: 'bw-cake-bake',
        name: 'The Cake Bake Shop by Gwendolyn Rogers',
        subtitle:
          'Elegant waterfront confectionary and restaurant serving artisanal French pastries, cakes, and champagne',
        tag: 'Table Service & Bakery',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/boardwalk/cake-bake-shop-restaurant/',
      },
      {
        id: 'bw-deli',
        name: 'BoardWalk Deli',
        subtitle:
          'Northeastern deli counter offering warm pastrami, house-baked bagels, and seasonal pastries',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/boardwalk/boardwalk-deli/',
      },
    ],
  },

  riviera: {
    blurb:
      'Celebrates the grandeur of the European Riviera where Walt and Lillian Disney spent memorable holidays. Features Mediterranean artwork, modern French elegance, and a dedicated Disney Skyliner station.',
    address: '1080 Esplanade Ave, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🚡',
        title: 'Disney Skyliner Station',
        desc: 'Dedicated aerial gondola station providing direct, breezy transit to EPCOT and Disney’s Hollywood Studios.',
      },
      {
        emoji: '🏊',
        title: 'Riviera Pool & Mediterranean Sun Deck',
        desc: 'Family-friendly pool with a 30-foot stone turret waterslide and S’il Vous Plaît interactive water play area.',
      },
      {
        emoji: '🍽️',
        title: "Topolino's Terrace Rooftop Dining",
        desc: 'Rooftop signature restaurant offering character breakfast with artist Mickey and sweeping views of evening park fireworks.',
      },
      {
        emoji: '🎨',
        title: 'Disney European Art & Grand Murals',
        desc: 'Curated collection of over 40 mosaic murals and Disney-inspired modern Mediterranean masterworks.',
      },
    ],
    diningSubtitle:
      'Rooftop French-Italian signature dinners and Parisian patisseries:',
    diningFallback: [
      {
        id: 'riviera-topolinos',
        name: "Topolino's Terrace – Flavors of the Riviera",
        subtitle:
          'Rooftop character breakfast with artist Mickey & friends and signature French-Italian coastal dinner',
        tag: 'Rooftop Signature',
        price: '$$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/riviera-resort/topolinos-terrace/',
      },
      {
        id: 'riviera-primo-piatto',
        name: 'Primo Piatto',
        subtitle:
          'Trattoria-style quick service serving blueberry-lemon pancakes, hearth-baked artisanal pizzas, and sandwiches',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/riviera-resort/primo-piatto/',
      },
      {
        id: 'riviera-bar-riva',
        name: 'Bar Riva',
        subtitle:
          'Chic open-air poolside bar and lounge serving Mediterranean small plates, spritzers, and frozen cocktails',
        tag: 'Poolside Bar & Lounge',
        price: '$$',
        action: 'Menu ›',
        meals: ['Breakfast', 'Lunch', 'Dinner'],
      },
    ],
    recreationFallback: [
      {
        id: 'b1010001-c001-4000-8000-000000000004',
        icon: '🎨',
        title: 'Painting on the Riviera',
        badge: 'Arts & Crafts',
        description:
          'Terrace painting masterclass celebrating European Mediterranean art overlooking Barefoot Bay.',
        hours: 'Select Mornings',
        priceTier: '$$$',
      },
      {
        icon: '♟️',
        title: 'Riviera Lawn Games & Bocce Ball',
        badge: 'Recreation',
        description:
          'Bocce ball court, life-sized chess on the event lawn, and scenic waterfront promenade around Barefoot Bay.',
        hours: 'Daytime',
        priceTier: 'Included',
      },
      {
        icon: '🏊',
        title: 'Riviera Pool & S’il Vous Play',
        badge: 'Feature Pool',
        description:
          'Signature Mediterranean pool with 30-foot winding stone turret waterslide and interactive water play area.',
        hours: '9:00 AM - 10:00 PM',
        priceTier: 'Included',
      },
      {
        icon: '🏋️',
        title: 'Athlétique Fitness Center',
        badge: 'Wellness',
        description:
          'Contemporary fitness center with top-tier cardio machinery, free weights, and stretching equipment.',
        hours: '24 Hours',
        priceTier: 'Included',
      },
    ],
  },

  caribbean: {
    blurb:
      'Lush tropical paradise celebrating Caribbean island culture surrounding 45-acre Barefoot Bay. Guests enjoy pastel island villages, white-sand hammock beaches, and the main Disney Skyliner transportation hub.',
    address: '1114 Cayman Way, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🚡',
        title: 'Disney Skyliner Central Hub',
        desc: 'Main transfer terminal connecting directly to EPCOT, Disney’s Hollywood Studios, and neighboring resorts.',
      },
      {
        emoji: '🏊',
        title: 'Fuentes del Morro Pool',
        desc: 'Colonial Spanish fortress pool featuring two waterslides, water cannons, and a Caribbean shipwreck water play area.',
      },
      {
        emoji: '🏝️',
        title: 'Old Port Royale & Centertown',
        desc: 'Centertown Market food hall, Calypso Trading Post, and open-air Sebastian’s Bistro along the Barefoot Bay promenade.',
      },
      {
        emoji: '🌴',
        title: 'Island Villages & Hammock Beaches',
        desc: 'Five distinct pastel villages—Barbados, Jamaica, Martinique, Trinidad, and Aruba—with five quiet leisure pools.',
      },
    ],
    diningSubtitle:
      'Caribbean island-inspired specialties, waterfront bistros, and tropical rum bars:',
    diningFallback: [
      {
        id: 'cbr-sebastians',
        name: "Sebastian's Bistro",
        subtitle:
          'Waterfront family-style feast serving mojo pork, slow-cooked beef, and warm coconut-pineapple bread pudding',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/caribbean-beach-resort/sebastians-bistro/',
      },
      {
        id: 'cbr-centertown',
        name: 'Centertown Market',
        subtitle:
          'Indoor street market quick-service food hall offering custom bowls, burgers, and Island-inspired breakfast',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/caribbean-beach-resort/centertown-market/',
      },
      {
        id: 'cbr-banana-cabana',
        name: 'Banana Cabana',
        subtitle:
          'Open-air poolside bar and lounge serving Caribbean rum cocktails, jerk chicken wings, and loaded fries',
        tag: 'Poolside Lounge',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/caribbean-beach-resort/banana-cabana/',
      },
    ],
  },

  pop: {
    blurb:
      'A vibrant journey through pop culture celebrating the fads, catchphrases, dances, and toys of the 1950s through 1990s. Features larger-than-life iconic memorabilia, nostalgic bowling pins, and direct Disney Skyliner access.',
    address: '1050 Century Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🚡',
        title: 'Disney Skyliner Station',
        desc: 'Shared aerial gondola station on Hourglass Lake bridge connecting straight to EPCOT and Disney’s Hollywood Studios.',
      },
      {
        emoji: '🏊',
        title: 'Hippy Dippy Pool & 3 Themed Pools',
        desc: 'Flower-shaped 1960s pool with flower-spout jets, plus the 1950s Bowling Pool and 1990s Computer Pool.',
      },
      {
        emoji: '🕹️',
        title: 'Everything POP Food & Memorabilia',
        desc: 'Massive shopping and dining complex famous for artisan pizzas, custom burgers, and nostalgic tie-dye cheesecake.',
      },
      {
        emoji: '⏳',
        title: 'Hourglass Lake 1.3-Mile Walking Trail',
        desc: 'Scenic paved loop connecting Pop Century and Art of Animation along the waterfront with Decade Fact Plaques.',
      },
    ],
    diningSubtitle:
      'Nostalgic American favorites, grab-and-go bakeries, and tie-dye cheesecake:',
    diningFallback: [
      {
        id: 'pop-everything-pop',
        name: 'Everything POP Shopping & Dining',
        subtitle:
          'Sprawling food court serving custom burgers, artisan pizzas, and nostalgic tie-dye cheesecake',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/pop-century-resort/everything-pop-shopping-and-dining/',
      },
      {
        id: 'pop-petals',
        name: 'Petals Pool Bar',
        subtitle:
          'Groovy open-air pool bar serving retro specialty cocktails, sangria, and draft beer by the Hippy Dippy Pool',
        tag: 'Pool Bar',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/pop-century-resort/petals-pool-bar/',
      },
    ],
  },

  animation: {
    blurb:
      'Immerse yourself into classic Disney and Pixar animation—The Lion King, Cars, Finding Nemo, and The Little Mermaid. Sprawling themed family suites, character courtyards, and direct Disney Skyliner connectivity.',
    address: '1850 Animation Way, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🏊',
        title: 'The Big Blue Pool',
        desc: 'The single largest resort swimming pool in all of Walt Disney World (310,000 gallons) featuring state-of-the-art underwater speakers.',
      },
      {
        emoji: '🚡',
        title: 'Disney Skyliner Access',
        desc: 'Direct aerial gondola transportation across Hourglass Lake to EPCOT and Disney’s Hollywood Studios.',
      },
      {
        emoji: '🚗',
        title: 'Life-Sized Radiator Springs & Courtyards',
        desc: 'Full-scale walk-through replicas of Lightning McQueen, Mater, Pride Rock, and Prince Eric’s castle grounds.',
      },
      {
        emoji: '🎨',
        title: 'Landscape of Flavors Market',
        desc: 'Artisan food court featuring four dynamic stations serving customized bowls, made-to-order burgers, and smoothies.',
      },
    ],
    diningSubtitle:
      'International culinary marketplace, custom bowl bars, and poolside sips:',
    diningFallback: [
      {
        id: 'aoa-landscape-of-flavors',
        name: 'Landscape of Flavors',
        subtitle:
          'Culinary market featuring made-to-order burgers, customized pasta bowls, and smoothies',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/art-of-animation-resort/landscape-of-flavors/',
      },
      {
        id: 'aoa-drop-off',
        name: 'The Drop Off Pool Bar',
        subtitle:
          'Quenching poolside watering hole serving tropical cocktails, frozen drinks, and draft beers by The Big Blue Pool',
        tag: 'Pool Bar',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/art-of-animation-resort/drop-off-pool-bar/',
      },
    ],
  },

  'port orleans': {
    blurb:
      'Experience the heart and soul of Louisiana along the scenic Sassagoula River—from the historic romance and jazz of the French Quarter to the rustic antebellum charm of Riverside.',
    address: '2201 Orleans Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🎷',
        title: 'French Quarter & Riverside Charm',
        desc: 'Cobblestone gas-lit streets, wrought-iron balconies, and magnolia mansions linked by riverbank walking trails.',
      },
      {
        emoji: '🏊',
        title: 'Doubloon Lagoon & Ol’ Man Island',
        desc: 'Iconic 51-foot sea serpent waterslide with King Triton at French Quarter, plus 3.5-acre Ol’ Man Island sawmill pool at Riverside.',
      },
      {
        emoji: '⛴️',
        title: 'Sassagoula River Cruise',
        desc: 'Complimentary scenic water taxi gliding down the tree-lined Sassagoula River straight to Disney Springs.',
      },
      {
        emoji: '🍩',
        title: 'Mickey Beignets & Southern Fare',
        desc: 'Fresh warm powdered sugar Mickey beignets at Scat Cat’s Club and slow-cooked jambalaya at Boatwright’s Dining Hall.',
      },
    ],
    diningSubtitle:
      'Authentic Cajun-Creole feasts, legendary Mickey beignets, and riverside taverns:',
    diningFallback: [
      {
        id: 'po-boatwrights',
        name: "Boatwright's Dining Hall",
        subtitle:
          'Southern hospitality serving slow-cooked jambalaya, crawfish bisque, and Nashville hot chicken',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/port-orleans-resort-riverside/boatwrights-dining-hall/',
      },
      {
        id: 'po-scat-cat',
        name: "Scat Cat's Club – Cafe",
        subtitle:
          'Authentic fluffy Mickey-shaped New Orleans beignets served warm with powdered sugar and specialty dipping sauces',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/port-orleans-resort-french-quarter/scat-cats-club-cafe/',
      },
      {
        id: 'po-sassagoula',
        name: 'Sassagoula Floatworks and Food Factory',
        subtitle:
          'Mardi Gras warehouse food court serving gumbo, po’boys, ribs, and create-your-own pasta',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/port-orleans-resort-french-quarter/sassagoula-floatworks-and-food-factory/',
      },
    ],
  },

  saratoga: {
    blurb:
      'Inspired by historic Saratoga Springs, New York—the late-1800s retreat famous for horse racing and mineral spas. Peaceful rolling green hills, Victorian architecture, and walking/boat access to Disney Springs.',
    address: '1960 Broadway, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🏇',
        title: 'Victorian Equine Heritage',
        desc: 'Genteel Victorian gables, horse-racing lore, and manicured lakeside grounds nestled along Lake Buena Vista.',
      },
      {
        emoji: '🏊',
        title: 'High Rock Spring Pool & 4 Leisure Pools',
        desc: 'Zero-entry pool with cascading waterfalls, bubbling geysers, and 128-foot stone rock waterslide, plus 4 quiet pools.',
      },
      {
        emoji: '⛵',
        title: 'Water Taxi & Walkway to Disney Springs',
        desc: 'Scenic pedestrian bridge and direct watercraft launch transporting guests right into the heart of Disney Springs.',
      },
      {
        emoji: '🧖',
        title: 'Senses Spa & LBV Golf Course',
        desc: 'Full-service day spa with mineral hydrotherapy, alongside the award-winning 18-hole championship Lake Buena Vista Golf Course.',
      },
    ],
    diningSubtitle:
      'Equestrian clubhouse dining, poolside barbecue, and specialty grab-and-go:',
    diningFallback: [
      {
        id: 'ssr-turf-club',
        name: 'The Turf Club Bar and Grill',
        subtitle:
          'Intimate racetrack clubhouse chophouse serving prime rib, steaks, and pasta with views of Lake Buena Vista Golf Course',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/saratoga-springs-resort-and-spa/turf-club-bar-and-grill/',
      },
      {
        id: 'ssr-artist-palette',
        name: "The Artist's Palette",
        subtitle:
          'Artisan market and bakery serving gourmet flatbreads, custom sandwiches, fresh salads, and hot breakfast',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/saratoga-springs-resort-and-spa/artists-palette/',
      },
    ],
  },

  'key west': {
    blurb:
      'The original Disney Vacation Club resort captures the sun-drenched romance, gingerbread architecture, and tranquil island pacing of Key West and Conch Flats. Features palm-shaded canals, golf course fairways, and water taxi access.',
    address: '1510 North Cove Rd, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🐚',
        title: 'Conch Republic Island Hospitality',
        desc: 'Pastel gingerbread Victorian villas, swaying palms, and boat docks evoking the historic Florida Keys.',
      },
      {
        emoji: '🏊',
        title: 'Sandcastle Pool & Dolphin Slide',
        desc: '149,441-gallon pool with 125-foot slide through a giant sandcastle, dry sauna inside the lighthouse, and whirlpool.',
      },
      {
        emoji: '⛵',
        title: 'Sassagoula Water Taxi to Disney Springs',
        desc: 'Relaxing ferry boat service from Hospitality House marina straight into Disney Springs marketplace dock.',
      },
      {
        emoji: '🍽️',
        title: "Olivia's Cafe Homestyle Feasts",
        desc: 'Famous for genuine Southern coastal hospitality, Conch Fritters, Banana Bread French Toast, and buttermilk chicken.',
      },
    ],
    diningSubtitle:
      'Conch Flats home cooking, island cocktails, and waterside snacks:',
    diningFallback: [
      {
        id: 'okw-olivias',
        name: "Olivia's Cafe",
        subtitle:
          'Island homestyle cooking celebrated for authentic Conch Fritters, Southernmost Buttermilk Fried Chicken, and brunch',
        tag: 'Table Service',
        price: '$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/old-key-west-resort/olivias-cafe/',
      },
      {
        id: 'okw-goods',
        name: "Good's Food to go",
        subtitle:
          'Waterfront quick-service window by the main pool serving burgers, conch chowder, and Dole Whip',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/old-key-west-resort/goods-food-to-go/',
      },
      {
        id: 'okw-gurgling-suit',
        name: 'Gurgling Suitcase Libations & Spirits',
        subtitle:
          'Cozy Key West-style tavern serving tropical cocktails, draft beers, and Olivia’s Cafe favorites',
        tag: 'Tavern Lounge',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/old-key-west-resort/gurgling-suitcase/',
      },
    ],
  },

  'fort wilderness': {
    blurb:
      '750 acres of cypress and pine forest offering the rustic charm of the American frontier. Features cozy wilderness cabins, campsites, archery, horse trails, campfire sing-alongs, and boat transit to Magic Kingdom.',
    address: '4510 N Fort Wilderness Trail, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '🌲',
        title: '750 Acres of Pine & Cypress Woods',
        desc: 'Nature trails, pony rides, horse-drawn carriages, and archery under tranquil moss-draped Florida forest.',
      },
      {
        emoji: '🎭',
        title: 'Hoop-Dee-Doo Musical Revue',
        desc: 'World-famous 50-year-old pioneer dinner show featuring all-you-care-to-enjoy fried chicken, smoked ribs, and comedy.',
      },
      {
        emoji: '🏊',
        title: 'Meadow Swimmin’ Pool & Wilderness Splash',
        desc: 'Heated pool with 67-foot corkscrew slide built around a water tower, whirlpool, and wilderness play area.',
      },
      {
        emoji: '⛵',
        title: 'Water Taxi to Magic Kingdom',
        desc: 'Scenic boat launch across Bay Lake and Seven Seas Lagoon directly to Magic Kingdom park gates.',
      },
    ],
    diningSubtitle:
      'Legendary frontier musical dinner shows, barbecue feasts, and tavern fare:',
    diningFallback: [
      {
        id: 'fw-hoop-dee-doo',
        name: 'Hoop-Dee-Doo Musical Revue',
        subtitle:
          'Legendary pioneer musical comedy dinner show serving all-you-care-to-enjoy fried chicken and barbecue ribs',
        tag: 'Dinner Show',
        price: '$$$',
        action: 'Reserve',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/cabins-at-fort-wilderness-resort/hoop-dee-doo-musical-revue/',
      },
      {
        id: 'fw-trails-end',
        name: "Trail's End Restaurant",
        subtitle:
          'Pioneer quick-service marketplace offering fried chicken by the bucket, brisket sandwiches, and pizza',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/cabins-at-fort-wilderness-resort/trails-end-restaurant/',
      },
      {
        id: 'fw-crocketts-tavern',
        name: "Crockett's Tavern",
        subtitle:
          'Rustic lounge inspired by Davy Crockett serving moonshine cocktails, sliders, and crispy chicken bites',
        tag: 'Tavern Lounge',
        price: '$$',
        action: 'Menu ›',
        diningUrl:
          'https://disneyworld.disney.go.com/dining/cabins-at-fort-wilderness-resort/crocketts-tavern/',
      },
    ],
  },

  'all-star': {
    blurb:
      'Larger-than-life celebrations of sports, music, and Disney movies. Features whimsical giant icons, themed guitar, piano, and surfboard swimming pools, and family-friendly food court dining.',
    address: '1801 W Buena Vista Dr, Lake Buena Vista, FL 32830',
    highlights: [
      {
        emoji: '⭐',
        title: 'Giant 3-Story Pop Culture Icons',
        desc: 'Massive towering jukeboxes, guitars, megaphones, football helmets, and classic Disney character statues.',
      },
      {
        emoji: '🏊',
        title: 'Themed Signature Swimming Pools',
        desc: 'Calypso Pool with Donald Duck water maracas, Piano Pool, Fantasia Pool with Sorcerer Mickey, and Surfboard Bay.',
      },
      {
        emoji: '🍕',
        title: 'Sprawling Food Court Dining',
        desc: 'Convenient food court markets serving custom pizzas, burgers, hot breakfast platters, and grab-and-go treats.',
      },
      {
        emoji: '🚌',
        title: 'Direct Walt Disney World Bus Transit',
        desc: 'Complimentary direct Disney bus transportation straight to all 4 theme parks, water parks, and Disney Springs.',
      },
    ],
    diningSubtitle:
      'Classic American quick-service food courts, pizza counters, and pool bars:',
    diningFallback: [
      {
        id: 'allstar-food-court',
        name: 'End Zone / Intermission / World Premiere Food Court',
        subtitle:
          'Spacious family food courts serving burgers, custom pizzas, deli sandwiches, and bakery treats',
        tag: 'Quick Service',
        price: '$',
        action: 'Menu ›',
      },
      {
        id: 'allstar-singing-spirits',
        name: 'Silver Screen / Singing Spirits / Grandstand Spirits Pool Bar',
        subtitle:
          'Open-air poolside retreat serving refreshing frozen cocktails, draft beers, and wines',
        tag: 'Pool Bar',
        price: '$',
        action: 'Menu ›',
      },
    ],
  },
};

export function resolveFallbackResortMeta(name: string): {
  tier: ResortTier;
  featurePool: string;
  transportationModes: readonly string[];
} {
  const norm = name.toLowerCase();
  if (norm.includes('beach club')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Stormalong Bay',
      transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
    };
  }
  if (norm.includes('yacht club')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Stormalong Bay',
      transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
    };
  }
  if (norm.includes('grand floridian')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Beach Pool',
      transportationModes: ['Monorail', 'Boat', 'Bus', 'Walking'],
    };
  }
  if (norm.includes('polynesian')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Lava Pool',
      transportationModes: ['Monorail', 'Boat', 'Bus', 'Walking'],
    };
  }
  if (norm.includes('contemporary') || norm.includes('bay lake tower')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Feature Pool with 17-ft Slide',
      transportationModes: ['Monorail', 'Walking', 'Bus'],
    };
  }
  if (
    norm.includes('wilderness') ||
    norm.includes('boulder ridge') ||
    norm.includes('copper creek')
  ) {
    return {
      tier: 'Deluxe',
      featurePool: 'Copper Creek Springs Pool',
      transportationModes: ['Boat', 'Bus'],
    };
  }
  if (
    norm.includes('animal kingdom') ||
    norm.includes('jambo') ||
    norm.includes('kidani')
  ) {
    return {
      tier: 'Deluxe',
      featurePool: 'Uzima Pool',
      transportationModes: ['Bus'],
    };
  }
  if (norm.includes('boardwalk')) {
    return {
      tier: 'Deluxe',
      featurePool: 'Luna Park Pool',
      transportationModes: ['Skyliner', 'Boat', 'Walking', 'Bus'],
    };
  }
  if (norm.includes('riviera')) {
    return {
      tier: 'Deluxe Villa',
      featurePool: 'Riviera Pool',
      transportationModes: ['Skyliner', 'Bus'],
    };
  }
  if (norm.includes('caribbean')) {
    return {
      tier: 'Moderate',
      featurePool: 'Fuentes del Morro Pool',
      transportationModes: ['Skyliner', 'Bus'],
    };
  }
  if (norm.includes('pop century')) {
    return {
      tier: 'Value',
      featurePool: 'Hippy Dippy Pool',
      transportationModes: ['Skyliner', 'Bus'],
    };
  }
  if (norm.includes('art of animation') || norm.includes('animation')) {
    return {
      tier: 'Value',
      featurePool: 'The Big Blue Pool',
      transportationModes: ['Skyliner', 'Bus'],
    };
  }
  if (norm.includes('port orleans')) {
    return {
      tier: 'Moderate',
      featurePool: norm.includes('french') ? 'Doubloon Lagoon' : "Ol' Man Island Pool",
      transportationModes: ['Boat', 'Bus'],
    };
  }
  if (norm.includes('saratoga')) {
    return {
      tier: 'Deluxe Villa',
      featurePool: 'High Rock Spring Pool',
      transportationModes: ['Boat', 'Walking', 'Bus'],
    };
  }
  if (norm.includes('key west')) {
    return {
      tier: 'Deluxe Villa',
      featurePool: 'Sandcastle Pool',
      transportationModes: ['Boat', 'Bus'],
    };
  }
  if (norm.includes('fort wilderness')) {
    return {
      tier: 'Campground',
      featurePool: "Meadow Swimmin' Pool",
      transportationModes: ['Boat', 'Bus'],
    };
  }
  if (norm.includes('all-star') || norm.includes('all star')) {
    return {
      tier: 'Value',
      featurePool: 'Feature Pool',
      transportationModes: ['Bus'],
    };
  }
  if (norm.includes('coronado')) {
    return {
      tier: 'Moderate',
      featurePool: 'The Dig Site & Lost City of Cibola Pool',
      transportationModes: ['Bus'],
    };
  }
  return {
    tier: 'Moderate',
    featurePool: 'Feature Pool',
    transportationModes: ['Bus'],
  };
}

export function resolveResortProfile(
  name: string,
  resort?: ResortDTO | null,
  featurePool: string = 'Feature Pool',
  primaryTransit: string = 'Bus',
): ResortProfile {
  const norm = (resort?.name ?? name).toLowerCase();
  for (const [key, profile] of Object.entries(KNOWN_RESORT_PROFILES)) {
    if (norm.includes(key)) {
      return profile;
    }
  }

  const blurb =
    resort?.description && resort.description.trim().length > 0
      ? resort.description
      : `Enjoy world-class Disney hospitality, themed accommodations, and complimentary transportation across Walt Disney World at ${name}.`;

  const address =
    resort?.address && resort.address.trim().length > 0
      ? resort.address
      : 'Walt Disney World Resort, Lake Buena Vista, FL 32830';

  const featurePoolDesc =
    resort?.recreation?.find(
      (r) => r.badge === 'Feature Pool' || r.title === featurePool,
    )?.description ??
    `Heated signature swimming pool with themed waterslide, sun deck, and whirlpool spa.`;

  const lore = resort?.architecturalLore?.[0];
  const rec = resort?.recreation?.[1];

  const transitEmoji =
    primaryTransit === 'Monorail'
      ? '🚝'
      : primaryTransit === 'Boat'
      ? '⛴️'
      : primaryTransit === 'Skyliner'
      ? '🚡'
      : '🚌';

  const highlights: readonly ResortHighlightBlock[] = [
    lore
      ? { emoji: lore.emoji, title: lore.title, desc: lore.text }
      : {
          emoji: '🏰',
          title: `${name} Architecture`,
          desc: 'Distinctive themed Disney architecture and scenic landscaped grounds.',
        },
    {
      emoji: '🏊',
      title: featurePool,
      desc: featurePoolDesc,
    },
    {
      emoji: transitEmoji,
      title: `${primaryTransit} Transportation`,
      desc: `Direct complimentary ${primaryTransit} service connecting guests across Walt Disney World.`,
    },
    rec
      ? { emoji: rec.icon, title: rec.title, desc: rec.description }
      : {
          emoji: '✨',
          title: 'Resort Amenities & Recreation',
          desc: 'Complimentary recreation, wellness facilities, and evening family activities.',
        },
  ];

  return {
    blurb,
    address,
    highlights,
    diningSubtitle:
      'Award-winning on-property dining, lounges, and quick-service favorites:',
    diningFallback: [],
  };
}

export function resolveTransitTimes(
  resortName: string,
  resort?: ResortDTO | null,
): Record<string, number> {
  if (resort?.transitTimes && Object.keys(resort.transitTimes).length > 0) {
    return resort.transitTimes as Record<string, number>;
  }
  const norm = (resort?.name ?? resortName).toLowerCase();
  for (const [key, times] of Object.entries(DEFAULT_TRANSIT_BY_RESORT)) {
    if (norm.includes(key)) {
      return times;
    }
  }
  return DEFAULT_TRANSIT_BY_RESORT.coronado ?? {};
}

export interface DestinationTransit {
  mode: string;
  icon: string;
}

export function resolveDestinationTransit(
  resortName: string,
  destination: string,
  _modes: readonly string[] = ['Bus'],
): DestinationTransit {
  const norm = resortName.toLowerCase();
  const dest = destination.toLowerCase();

  // Crescent Lake / EPCOT Resort Area: Beach Club, Yacht Club, BoardWalk, Swan & Dolphin
  if (
    norm.includes('beach club') ||
    norm.includes('yacht club') ||
    norm.includes('boardwalk') ||
    norm.includes('swan') ||
    norm.includes('dolphin')
  ) {
    if (dest.includes('epcot')) {
      return { mode: 'Boat / Walk', icon: '⛴️' };
    }
    if (dest.includes('hollywood')) {
      return { mode: 'Boat / Walk', icon: '⛴️' };
    }
    return { mode: 'Bus', icon: '🚌' };
  }

  // Magic Kingdom Monorail Resorts: Grand Floridian, Polynesian, Contemporary
  if (
    norm.includes('grand floridian') ||
    norm.includes('polynesian') ||
    norm.includes('contemporary') ||
    norm.includes('bay lake tower')
  ) {
    if (dest.includes('magic kingdom')) {
      if (norm.includes('contemporary') || norm.includes('bay lake')) {
        return { mode: 'Monorail / Walk', icon: '🚝' };
      }
      return { mode: 'Monorail / Boat', icon: '🚝' };
    }
    if (dest.includes('epcot')) {
      return { mode: 'Monorail', icon: '🚝' };
    }
    return { mode: 'Bus', icon: '🚌' };
  }

  // Skyliner Resorts: Riviera, Caribbean Beach, Pop Century, Art of Animation
  if (
    norm.includes('riviera') ||
    norm.includes('caribbean') ||
    norm.includes('pop century') ||
    norm.includes('art of animation') ||
    norm.includes('animation')
  ) {
    if (dest.includes('epcot') || dest.includes('hollywood')) {
      return { mode: 'Skyliner', icon: '🚡' };
    }
    return { mode: 'Bus', icon: '🚌' };
  }

  // Magic Kingdom Water Taxi Resorts: Wilderness Lodge, Fort Wilderness
  if (
    norm.includes('wilderness') ||
    norm.includes('fort wilderness') ||
    norm.includes('boulder ridge') ||
    norm.includes('copper creek')
  ) {
    if (dest.includes('magic kingdom')) {
      return { mode: 'Boat', icon: '⛴️' };
    }
    return { mode: 'Bus', icon: '🚌' };
  }

  // Disney Springs Water Taxi Resorts: Port Orleans French Quarter/Riverside, Saratoga Springs, Old Key West
  if (
    norm.includes('port orleans') ||
    norm.includes('saratoga') ||
    norm.includes('key west')
  ) {
    if (dest.includes('springs')) {
      if (norm.includes('saratoga')) {
        return { mode: 'Boat / Walk', icon: '⛴️' };
      }
      return { mode: 'Boat', icon: '⛴️' };
    }
    return { mode: 'Bus', icon: '🚌' };
  }

  return { mode: 'Bus', icon: '🚌' };
}

export function resolveTransitSummary(
  resortName: string,
  destinations: readonly string[],
  modes: readonly string[] = ['Bus'],
): {
  summaryText: string;
  badgeText: string;
} {
  const destTransits = destinations.map((d) =>
    resolveDestinationTransit(resortName, d, modes),
  );

  const hasMonorail = destTransits.some((t) => t.mode.includes('Monorail'));
  const hasSkyliner = destTransits.some((t) => t.mode.includes('Skyliner'));
  const hasBoat = destTransits.some((t) => t.mode.includes('Boat'));
  const hasBus =
    destTransits.some((t) => t.mode.includes('Bus')) ||
    (!hasMonorail && !hasSkyliner && !hasBoat);

  const specialLabels: string[] = [];
  const badgeParts: string[] = [];

  if (hasMonorail) {
    specialLabels.push('Monorail');
    badgeParts.push('🚝 Monorail');
  }
  if (hasSkyliner) {
    specialLabels.push('Skyliner');
    badgeParts.push('🚡 Skyliner');
  }
  if (hasBoat) {
    specialLabels.push('Boat');
    badgeParts.push('⛴️ Boat');
  }

  if (hasBus) {
    badgeParts.push('🚌 Bus');
  }

  const allLabels = hasBus ? [...specialLabels, 'Bus'] : specialLabels;

  let summaryText = 'Bus';
  if (allLabels.length === 1 && allLabels[0]) {
    summaryText = allLabels[0];
  } else if (allLabels.length === 2 && allLabels[0] && allLabels[1]) {
    summaryText = `${allLabels[0]} & ${allLabels[1]}`;
  } else if (allLabels.length > 2) {
    const last = allLabels[allLabels.length - 1];
    summaryText = `${allLabels.slice(0, -1).join(', ')} & ${last ?? 'Bus'}`;
  }

  let badgeText = '🚌 Direct Bus';
  if (badgeParts.length === 1 && badgeParts[0] === '🚌 Bus') {
    badgeText = '🚌 Direct Bus';
  } else if (badgeParts.length > 0) {
    badgeText = badgeParts.join(' • ');
  }

  return { summaryText, badgeText };
}

const CANONICAL_MEAL_ORDER = [
  'Breakfast',
  'Brunch',
  'Lunch',
  'Dinner',
  'Late Night',
] as const;

const NON_MEAL_TAGS = new Set([
  'pool bar',
  'bar',
  'lounge',
  'poolside bar',
  'snack bar',
]);

export function cleanAndSortMealPeriods(
  rawMeals: readonly any[] | undefined,
): readonly string[] | undefined {
  if (!rawMeals || rawMeals.length === 0) return undefined;

  const extracted = rawMeals
    .map((m: any) =>
      typeof m === 'string' ? m.trim() : (m?.type?.trim() ?? ''),
    )
    .filter((t: string) => Boolean(t && t.length > 0 && !NON_MEAL_TAGS.has(t.toLowerCase())));

  if (extracted.length === 0) return undefined;

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of extracted) {
    const lower = item.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      const canonicalMatch = CANONICAL_MEAL_ORDER.find(
        (c) => c.toLowerCase() === lower,
      );
      deduped.push(canonicalMatch ?? item);
    }
  }

  deduped.sort((a, b) => {
    const idxA = CANONICAL_MEAL_ORDER.findIndex(
      (m) => m.toLowerCase() === a.toLowerCase(),
    );
    const idxB = CANONICAL_MEAL_ORDER.findIndex(
      (m) => m.toLowerCase() === b.toLowerCase(),
    );
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  return deduped;
}

function mapExperienceToDiningVenue(
  item: ExperienceDTO,
  resortName: string,
): ResortDiningVenue {
  const normName = item.name.toLowerCase();
  const matchedKey = Object.keys(KNOWN_DINING_METADATA).find((k) =>
    normName.includes(k),
  );
  const known = matchedKey ? KNOWN_DINING_METADATA[matchedKey] : null;

  const isQuick = isQuickServiceDining(item.subType, item.groupedFacets);
  const isTable =
    !isQuick || (item.subType?.toLowerCase().includes('table') ?? false);
  const action: 'Reserve' | 'Menu ›' =
    known?.action ?? (isTable ? 'Reserve' : 'Menu ›');
  const tag =
    known?.tag ?? (isQuick ? 'Quick Service' : (item.subType ?? 'Table Service'));
  const price = known?.price ?? (item.priceTier ?? (isQuick ? '$' : '$$'));
  const subtitle =
    known?.subtitle ??
    (item.description && item.description.trim().length > 0
      ? item.description
      : `${isQuick ? 'Quick-service dining' : 'Table-service restaurant'} at ${resortName}.`);

  const dynamicMeals = cleanAndSortMealPeriods(item.mealPeriods);
  const knownMeals = cleanAndSortMealPeriods(known?.meals);
  const meals = dynamicMeals && dynamicMeals.length > 0 ? dynamicMeals : knownMeals;

  return {
    id: item.id,
    name: item.name,
    subtitle,
    tag,
    price,
    action,
    diningUrl: item.diningUrl ?? null,
    meals: meals && meals.length > 0 ? meals : undefined,
  };
}

/**
 * Map a catalog-synced Recreation/Spa/Tour `ExperienceDTO` to the shared
 * `ResortRecreationItemDTO` display shape, mirroring `mapExperienceToDiningVenue`
 * above. Carries the real experience `id` through so the card is interactive
 * (navigates to `ExperienceDetail` on press) rather than opening the
 * informational bottom sheet.
 */
function mapExperienceToRecreationItem(
  item: ExperienceDTO,
): ResortRecreationItemDTO {
  const icon =
    item.category === 'Spa' ? '💆' : item.category === 'Tour' ? '🏛️' : '🏊';
  return {
    id: item.id,
    icon,
    title: item.name,
    badge: item.subType ?? item.category,
    description:
      item.description && item.description.trim().length > 0
        ? item.description
        : 'On-property recreation activity.',
    ...(item.priceTier ? { priceTier: item.priceTier } : {}),
  };
}

export default function ResortGuideSection({
  experienceId,
  experienceName,
  resort,
  latitude,
  longitude,
}: ResortGuideSectionProps): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [directionsFailed, setDirectionsFailed] = React.useState(false);
  const [mapImageFailed, setMapImageFailed] = React.useState(false);
  const [diningExpanded, setDiningExpanded] = React.useState(false);
  const [diningCategoryFilter, setDiningCategoryFilter] = React.useState<DiningCategoryFilter>('all');
  const [recreationExpanded, setRecreationExpanded] = React.useState(false);
  const [selectedAmenity, setSelectedAmenity] = React.useState<ResortRecreationItemDTO | null>(null);

  const resortId = resort?.id;
  const fallbackMeta = resolveFallbackResortMeta(experienceName);
  const tier = resort?.tier ?? fallbackMeta.tier;
  const featurePool = resort?.featurePool ?? fallbackMeta.featurePool;
  const transitModes =
    resort?.transportationModes && resort.transportationModes.length > 0
      ? resort.transportationModes
      : fallbackMeta.transportationModes;
  const primaryTransit = transitModes[0] ?? 'Bus';

  const profile = resolveResortProfile(
    experienceName,
    resort,
    featurePool,
    primaryTransit,
  );

  // Query catalog-linked Recreation/Spa/Tour experiences for this resort,
  // mirroring the dining query above. Unlike dining, resort amenities such as
  // pools, fitness centers, and spas are deliberately excluded from Disney's
  // catalog sync (see `AMENITY_SUB_TYPES` in `facilityExclusion.ts`) and exist
  // only in the curated `resort.recreation` / `recreationFallback` data below,
  // so live results are merged additively with that curated data rather than
  // replacing it the way live dining replaces `diningFallback`.
  const recreationQuery = useQuery({
    queryKey: ['catalog', 'recreation', resortId ?? experienceId] as const,
    queryFn: async () => {
      const q = resortId
        ? `?categories=Recreation,Spa,Tour&resortId=${encodeURIComponent(resortId)}`
        : '?categories=Recreation,Spa,Tour';
      const res = await apiRequest<{
        experiences?: readonly ExperienceDTO[];
        items?: readonly ExperienceDTO[];
      }>('GET', `/catalog${q}`);
      const list = res?.experiences ?? res?.items ?? [];
      return list.filter(
        (item) =>
          item.category === 'Recreation' ||
          item.category === 'Spa' ||
          item.category === 'Tour',
      );
    },
    enabled: Boolean(resortId),
  });

  const liveRecreationItems: readonly ResortRecreationItemDTO[] = React.useMemo(
    () => (recreationQuery.data ?? []).map(mapExperienceToRecreationItem),
    [recreationQuery.data],
  );

  const recreation: readonly ResortRecreationItemDTO[] = React.useMemo(() => {
    // Start from the existing curated/live-JSONB resolution (unchanged below),
    // then merge in the catalog-linked items that aren't already represented
    // there, deduped by id (preferred) or case-insensitive title.
    const base: readonly ResortRecreationItemDTO[] = (() => {
    if (resort?.recreation && resort.recreation.length > 0) {
      // If live resort recreation has items, check if signature art/class experiences
      // (Colors of Coronado, Spanish Mosaic, Sangria University, Painting on the Riviera)
      // are missing from this specific resort. If missing from an older DB seed, merge them up-front.
      const norm = (resort?.name ?? experienceName).toLowerCase();
      const hasSignature = resort.recreation.some(
        (r) =>
          r.title.toLowerCase().includes('painting') ||
          r.title.toLowerCase().includes('mosaic') ||
          r.title.toLowerCase().includes('sangria'),
      );

      if (!hasSignature && profile.recreationFallback && profile.recreationFallback.length > 0) {
        const signatureItems = profile.recreationFallback.filter(
          (fb) =>
            fb.badge === 'Arts & Crafts' ||
            fb.badge === 'Class' ||
            fb.title.toLowerCase().includes('painting') ||
            fb.title.toLowerCase().includes('mosaic') ||
            fb.title.toLowerCase().includes('sangria'),
        );

        if (signatureItems.length > 0) {
          const isKnownResort = norm.includes('coronado') || norm.includes('riviera');
          const isLegacyDbList = resort.recreation.some(
            (r) =>
              r.title.includes('Casitas, Ranchos & Cabanas') ||
              r.title.includes('Beau Soleil') ||
              r.title.includes('Athlétique Fitness Center'),
          );
          if (isKnownResort && isLegacyDbList) {
            const seenTitles = new Set(signatureItems.map((s) => s.title.toLowerCase()));
            const remainingLive = resort.recreation.filter(
              (r) => !seenTitles.has(r.title.toLowerCase()),
            );
            return [...signatureItems, ...remainingLive];
          }
        }
      }

      return resort.recreation;
    }

    if (profile.recreationFallback && profile.recreationFallback.length > 0) {
      return profile.recreationFallback;
    }

    return [
      {
        icon: '🏊',
        title: featurePool,
        badge: 'Feature Pool',
        description: `Heated signature pool with themed slide and lounge deck at ${experienceName}.`,
      },
      {
        icon: '🏃',
        title: 'Resort Walking Trail',
        badge: 'Trail',
        description:
          'Paved scenic path winding through landscaped grounds and resort courtyards.',
      },
      {
        icon: '🪵',
        title: 'Campfire & Movies Under the Stars',
        badge: 'Family Fun',
        description:
          'Nightly marshmallow roasts followed by complimentary outdoor Disney movie screenings under the Florida twilight.',
      },
    ];
    })();

    if (liveRecreationItems.length === 0) {
      return base;
    }

    const seenIds = new Set(
      base.map((b) => b.id).filter((id): id is string => Boolean(id)),
    );
    const seenTitles = new Set(base.map((b) => b.title.toLowerCase()));
    const additions = liveRecreationItems.filter(
      (item) =>
        !(item.id && seenIds.has(item.id)) &&
        !seenTitles.has(item.title.toLowerCase()),
    );

    return additions.length > 0 ? [...base, ...additions] : base;
  }, [
    resort?.recreation,
    resort?.name,
    profile.recreationFallback,
    featurePool,
    experienceName,
    liveRecreationItems,
  ]);

  const transitTimes = resolveTransitTimes(experienceName, resort);
  const transitSummary = resolveTransitSummary(
    resort?.name ?? experienceName,
    Object.keys(transitTimes),
    transitModes,
  );

  // Query on-property dining experiences for this resort
  const diningQuery = useQuery({
    queryKey: ['catalog', 'dining', resortId ?? experienceId] as const,
    queryFn: async () => {
      const q = resortId
        ? `?category=Restaurant&resortId=${encodeURIComponent(resortId)}`
        : '?category=Restaurant';
      const res = await apiRequest<{
        experiences?: readonly ExperienceDTO[];
        items?: readonly ExperienceDTO[];
      }>('GET', `/catalog${q}`);
      const list = res?.experiences ?? res?.items ?? [];
      return list.filter((item) => item.category === 'Restaurant');
    },
    enabled: Boolean(resortId),
  });

  const canGetDirections = hasValidCoordinates(latitude, longitude);

  const handleOpenDirections = async (): Promise<void> => {
    if (!canGetDirections) return;
    const candidates = directionsUrlCandidates(
      latitude as number,
      longitude as number,
      mapsPlatform(),
    );
    for (const url of candidates) {
      try {
        await Linking.openURL(url);
        setDirectionsFailed(false);
        return;
      } catch {
        // try next candidate
      }
    }
    setDirectionsFailed(true);
  };

  const rawDynamicItems = (diningQuery.data ?? []).filter(
    (item) => !item.name.toLowerCase().includes('to go'),
  );

  const diningVenues: readonly ResortDiningVenue[] =
    rawDynamicItems.length > 0
      ? rawDynamicItems.map((item) =>
          mapExperienceToDiningVenue(item, resort?.name ?? experienceName),
        )
      : profile.diningFallback.map((venue) => {
          if (venue.meals && venue.meals.length > 0) {
            return {
              ...venue,
              meals: cleanAndSortMealPeriods(venue.meals),
            };
          }
          const norm = venue.name.toLowerCase();
          const matchedKey = Object.keys(KNOWN_DINING_METADATA).find((k) =>
            norm.includes(k),
          );
          const knownMeals = matchedKey ? KNOWN_DINING_METADATA[matchedKey]?.meals : undefined;
          const cleaned = cleanAndSortMealPeriods(knownMeals);
          return cleaned && cleaned.length > 0
            ? { ...venue, meals: cleaned }
            : venue;
        });

  const handleCardPress = (venue: ResortDiningVenue): void => {
    if (typeof (navigation as any).push === 'function') {
      (navigation as any).push('ExperienceDetail', {
        experienceId: venue.id,
      });
    } else {
      navigation.navigate('ExperienceDetail', {
        experienceId: venue.id,
      });
    }
  };

  const handleActionPress = async (venue: ResortDiningVenue): Promise<void> => {
    if (venue.action === 'Reserve' && venue.diningUrl) {
      try {
        await Linking.openURL(venue.diningUrl);
        return;
      } catch {
        // Fallback to navigating to experience detail
      }
    }
    handleCardPress(venue);
  };

  const diningCategoryCounts = React.useMemo(() => {
    let table = 0;
    let quick = 0;
    let lounge = 0;
    for (const venue of diningVenues) {
      const cat = classifyDiningCategory(venue);
      if (cat === 'table') table++;
      else if (cat === 'quick') quick++;
      else if (cat === 'lounge') lounge++;
    }
    return { all: diningVenues.length, table, quick, lounge };
  }, [diningVenues]);

  const filteredDiningVenues = React.useMemo(() => {
    return filterDiningByCategory(diningVenues, diningCategoryFilter);
  }, [diningVenues, diningCategoryFilter]);

  const visibleDiningResult = React.useMemo(() => {
    return computeVisibleItems({
      items: filteredDiningVenues,
      limit: 4,
      expanded: diningExpanded,
      isFiltered: diningCategoryFilter !== 'all',
    });
  }, [filteredDiningVenues, diningExpanded, diningCategoryFilter]);

  const visibleRecreationResult = React.useMemo(() => {
    return computeVisibleItems({
      items: recreation,
      limit: 4,
      expanded: recreationExpanded,
    });
  }, [recreation, recreationExpanded]);

  const handleRecreationPress = (item: ResortRecreationItemDTO): void => {
    if (item.id) {
      if (typeof (navigation as any).push === 'function') {
        (navigation as any).push('ExperienceDetail', {
          experienceId: item.id,
        });
      } else {
        navigation.navigate('ExperienceDetail', {
          experienceId: item.id,
        });
      }
    } else {
      setSelectedAmenity(item);
    }
  };

  return (
    <View style={styles.container} testID="resort-guide-section">
      {/* ------------------------------------------------------------------ */}
      {/* 1. Resort Highlights Card                                         */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card} testID="resort-highlights-card">
        <View style={styles.cardHead}>
          <View style={styles.titleWrap}>
            <Ionicons name="sparkles" size={17} color="#5b2a86" />
            <Text style={styles.cardTitle}>Property Highlights & Atmosphere</Text>
          </View>
          <View style={styles.tierPill}>
            <Text style={styles.tierPillText}>{tier} Resort</Text>
          </View>
        </View>

        <Text style={styles.propertyBlurb}>
          {profile.blurb}
        </Text>

        <View style={styles.highlightsGrid}>
          {profile.highlights.map((h, idx) => (
            <View key={idx} style={styles.highlightBlock}>
              <Text style={styles.highlightEmoji}>{h.emoji}</Text>
              <View style={styles.highlightTextWrap}>
                <Text style={styles.highlightTitle}>{h.title}</Text>
                <Text style={styles.highlightDesc}>{h.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Dining & Lounges at the Resort                                  */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card} testID="resort-dining-directory-card">
        <View style={styles.diningHeaderRow}>
          <View style={styles.titleWrap}>
            <Text style={styles.diningHeaderEmoji}>🍽️</Text>
            <Text style={styles.cardTitle}>
              Dining & Lounges at the Resort ({diningVenues.length})
            </Text>
          </View>
          <Text
            style={styles.inspectHintText}
            testID="resort-dining-inspect-hint"
          >
            Tap to inspect
          </Text>
        </View>

        <Text style={styles.cardSubtitle}>
          {profile.diningSubtitle}
        </Text>

        {diningVenues.length > 0 ? (
          <View style={styles.categoryPillRow} testID="resort-dining-category-pills">
            {(
              [
                { id: 'all' as const, label: `All (${diningCategoryCounts.all})` },
                { id: 'table' as const, label: `Table Service (${diningCategoryCounts.table})` },
                { id: 'quick' as const, label: `Quick Service (${diningCategoryCounts.quick})` },
                { id: 'lounge' as const, label: `Lounges (${diningCategoryCounts.lounge})` },
              ] as const
            ).map((pill) => {
              const isActive = diningCategoryFilter === pill.id;
              return (
                <Pressable
                  key={pill.id}
                  style={[styles.categoryPill, isActive && styles.categoryPillActive]}
                  onPress={() => setDiningCategoryFilter(pill.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${pill.label} dining`}
                  testID={`resort-dining-filter-${pill.id}`}
                >
                  <Text style={[styles.categoryPillText, isActive && styles.categoryPillTextActive]}>
                    {pill.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.diningList}>
          {visibleDiningResult.visibleItems.length === 0 ? (
            <Text style={styles.noDiningText}>
              No dining locations currently listed for this resort.
            </Text>
          ) : (
            visibleDiningResult.visibleItems.map((venue) => (
            <Pressable
              key={venue.id}
              style={({ pressed }) => [
                styles.diningItemCard,
                pressed && styles.cardPressed,
              ]}
              onPress={() => handleCardPress(venue)}
              accessibilityRole="button"
              accessibilityLabel={`View ${venue.name}`}
              testID={`resort-dining-item-${venue.id}`}
            >
              <View style={styles.diningCardBody}>
                <Text style={styles.diningName} numberOfLines={1}>
                  {venue.name}
                </Text>
                <Text style={styles.diningSubtitle} numberOfLines={2}>
                  {venue.subtitle}
                </Text>
                {venue.meals && venue.meals.length > 0 && (
                  <Text
                    style={styles.diningMealsText}
                    testID={`resort-dining-meals-${venue.id}`}
                  >
                    {venue.meals.join(', ')}
                  </Text>
                )}
                <View style={styles.diningTagRow}>
                  <View style={styles.diningTagPill}>
                    <Text style={styles.diningTagText}>{venue.tag}</Text>
                  </View>
                  <Text style={styles.diningPriceText}>{venue.price}</Text>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.diningActionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  void handleActionPress(venue);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${venue.action === 'Reserve' ? 'Reserve table' : 'View menu'} for ${venue.name}`}
                testID={`resort-dining-action-${venue.id}`}
              >
                <Text style={styles.diningActionBtnText}>{venue.action}</Text>
              </Pressable>
            </Pressable>
          )))}
        </View>

        {diningCategoryFilter === 'all' && diningVenues.length > 4 ? (
          <Pressable
            style={({ pressed }) => [
              styles.expandToggleBtn,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setDiningExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              diningExpanded
                ? 'Show fewer dining locations'
                : `Show all ${diningVenues.length} dining locations`
            }
            testID="resort-dining-expand-toggle"
          >
            <Text style={styles.expandToggleBtnText}>
              {diningExpanded
                ? 'Show fewer dining locations ▴'
                : `Show all ${diningVenues.length} dining locations (${visibleDiningResult.hiddenCount} more) ▾`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Recreation & Amenities Card                                    */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card} testID="resort-recreation-card">
        <View style={styles.cardHead}>
          <View style={styles.titleWrap}>
            <Ionicons name="fitness-outline" size={18} color="#5b2a86" />
            <Text style={styles.cardTitle}>Recreation & Resort Amenities</Text>
          </View>
        </View>

        <Text style={styles.cardSubtitle}>
          Signature activities, wellness spaces, and recreation available to resort guests.
        </Text>

        <View style={styles.recreationList}>
          {visibleRecreationResult.visibleItems.map((item, idx) => (
            <Pressable
              key={idx}
              style={({ pressed }) => [
                styles.recreationItem,
                styles.recreationItemPressable,
                pressed && styles.cardPressed,
              ]}
              onPress={() => handleRecreationPress(item)}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.title}`}
              testID={`resort-recreation-item-${item.id ?? idx}`}
            >
              <View style={styles.recreationIconWrap}>
                <Text style={styles.recreationEmoji}>{item.icon}</Text>
              </View>
              <View style={styles.recreationContent}>
                <View style={styles.recreationTitleRow}>
                  <Text style={styles.recreationTitle}>{item.title}</Text>
                  {item.badge ? (
                    <View style={styles.recreationBadge}>
                      <Text style={styles.recreationBadgeText}>{item.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.recreationDesc}>{item.description}</Text>
              </View>
              <View style={styles.recreationChevronWrap}>
                <Ionicons name="chevron-forward" size={16} color="#8a7ba7" />
              </View>
            </Pressable>
          ))}
        </View>

        {recreation.length > 4 ? (
          <Pressable
            style={({ pressed }) => [
              styles.expandToggleBtn,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setRecreationExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              recreationExpanded
                ? 'Show fewer activities'
                : `Show all ${recreation.length} recreation & activities`
            }
            testID="resort-recreation-expand-toggle"
          >
            <Text style={styles.expandToggleBtnText}>
              {recreationExpanded
                ? 'Show fewer activities ▴'
                : `Show all ${recreation.length} recreation & activities (${visibleRecreationResult.hiddenCount} more) ▾`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Property Map & Transit Times Card                              */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.card} testID="resort-map-transit-card">
        <View style={styles.cardHead}>
          <View style={styles.titleWrap}>
            <Ionicons name="map-outline" size={18} color="#5b2a86" />
            <Text style={styles.cardTitle}>Property Map & Transit Times</Text>
          </View>
        </View>

        <Text style={styles.cardSubtitle}>
          Complimentary {transitSummary.summaryText} transportation connects you across Walt Disney World.
        </Text>

        {canGetDirections && !mapImageFailed ? (
          <Pressable
            onPress={handleOpenDirections}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Map preview of ${experienceName}. Tap for directions.`}
            style={styles.mapFrame}
            testID="resort-map-preview"
          >
            <Image
              source={{ uri: staticMapUrl(latitude as number, longitude as number) }}
              style={styles.mapImage}
              resizeMode="cover"
              onError={() => setMapImageFailed(true)}
              accessibilityIgnoresInvertColors
            />
            <View style={styles.mapPinContainer}>
              <Ionicons name="location" size={32} color="#f6c343" />
            </View>
          </Pressable>
        ) : null}

        <View style={styles.addressBar}>
          <Ionicons name="pin" size={15} color="#5b2a86" />
          <Text style={styles.addressText}>
            {profile.address}
          </Text>
        </View>

        {canGetDirections ? (
          <Pressable
            style={({ pressed }) => [
              styles.directionsBtn,
              pressed && styles.cardPressed,
            ]}
            onPress={handleOpenDirections}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${experienceName}`}
            testID="resort-get-directions-btn"
          >
            <Text style={{ fontSize: 13 }}>🧭</Text>
            <Text style={styles.directionsBtnText}>Open in Maps App</Text>
          </Pressable>
        ) : null}

        {directionsFailed ? (
          <Text style={styles.errorText}>
            Couldn&apos;t open maps application. Please try again.
          </Text>
        ) : null}

        {/* Transit Matrix Grid */}
        <View style={styles.transitHeaderRow}>
          <Text style={styles.transitGridTitle}>Direct Park Travel Times</Text>
          <Text style={styles.transitModeBadge}>{transitSummary.badgeText}</Text>
        </View>

        <View style={styles.transitGrid}>
          {Object.entries(transitTimes).map(([destination, minutes]) => {
            const destTransit = resolveDestinationTransit(
              resort?.name ?? experienceName,
              destination,
              transitModes,
            );
            return (
              <View key={destination} style={styles.transitCell}>
                <View style={styles.transitCellLeft}>
                  <Text style={styles.destName} numberOfLines={1}>
                    {destination}
                  </Text>
                  <Text style={styles.destTransitMode}>
                    {destTransit.icon} {destTransit.mode}
                  </Text>
                </View>
                <View style={styles.minutePill}>
                  <Text style={styles.minuteText}>~{minutes}m</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Amenity Detail Modal for complimentary recreation items */}
      {selectedAmenity ? (
        <Modal
          visible={Boolean(selectedAmenity)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedAmenity(null)}
          testID="resort-amenity-modal"
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setSelectedAmenity(null)}
            testID="resort-amenity-modal-backdrop"
          >
            <Pressable style={styles.modalCard} onPress={(e) => e?.stopPropagation?.()}>
              <View style={styles.modalHead}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalEmoji}>{selectedAmenity.icon}</Text>
                  <View style={styles.modalTitleWrap}>
                    <Text style={styles.modalTitle}>{selectedAmenity.title}</Text>
                    {selectedAmenity.badge ? (
                      <View style={styles.recreationBadge}>
                        <Text style={styles.recreationBadgeText}>{selectedAmenity.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  style={styles.modalCloseBtn}
                  onPress={() => setSelectedAmenity(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close amenity details"
                  testID="resort-amenity-modal-close"
                >
                  <Ionicons name="close" size={20} color="#372f4a" />
                </Pressable>
              </View>

              <Text style={styles.modalDesc}>{selectedAmenity.description}</Text>

              <View style={styles.modalDetailsRow}>
                <Ionicons name="time-outline" size={16} color="#5b2a86" />
                <Text style={styles.modalDetailText}>
                  {selectedAmenity.hours ?? 'Operating Hours: 7:00 AM – 11:00 PM daily'}
                </Text>
              </View>

              <View style={styles.modalDetailsRow}>
                <Ionicons name="pricetag-outline" size={16} color="#5b2a86" />
                <Text style={styles.modalDetailText}>
                  {selectedAmenity.priceTier ?? 'Complimentary for registered resort guests'}
                </Text>
              </View>

              <View style={styles.modalDetailsRow}>
                <Ionicons name="information-circle-outline" size={16} color="#5b2a86" />
                <Text style={styles.modalDetailText}>
                  Available to all guests staying at {resort?.name ?? experienceName}.
                </Text>
              </View>

              <Pressable
                style={styles.modalDoneBtn}
                onPress={() => setSelectedAmenity(null)}
                accessibilityRole="button"
                accessibilityLabel="Done"
                testID="resort-amenity-modal-done"
              >
                <Text style={styles.modalDoneBtnText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    marginTop: 4,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    padding: 16,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#655d78',
    marginBottom: 12,
    lineHeight: 16,
  },
  tierPill: {
    backgroundColor: '#f3e8ff',
    borderWidth: 1,
    borderColor: '#d8b4fe',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  tierPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7e22ce',
  },
  countBadge: {
    backgroundColor: '#ede6f6',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5b2a86',
  },
  propertyBlurb: {
    fontSize: 12.5,
    color: '#372f4a',
    lineHeight: 18,
    marginBottom: 14,
  },
  highlightsGrid: {
    gap: 10,
  },
  highlightBlock: {
    flexDirection: 'row',
    backgroundColor: '#fbf9fe',
    borderWidth: 1,
    borderColor: '#ede6f6',
    borderRadius: 14,
    padding: 12,
    alignItems: 'flex-start',
    gap: 12,
  },
  highlightEmoji: {
    fontSize: 22,
    marginTop: 1,
  },
  highlightTextWrap: {
    flex: 1,
  },
  highlightTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#190c2d',
    marginBottom: 3,
  },
  highlightDesc: {
    fontSize: 11.5,
    color: '#655d78',
    lineHeight: 16,
  },
  diningHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  diningHeaderEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  inspectHintText: {
    fontSize: 12,
    color: '#655d78',
    fontWeight: '500',
  },
  diningList: {
    gap: 10,
    marginTop: 8,
  },
  diningItemCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede6f6',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#1f1235',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  diningCardBody: {
    flex: 1,
    paddingRight: 10,
  },
  diningName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#190c2d',
    marginBottom: 2,
  },
  diningSubtitle: {
    fontSize: 11.5,
    color: '#655d78',
    lineHeight: 16,
    marginBottom: 4,
  },
  diningMealsText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#5b2a86',
    marginBottom: 6,
  },
  diningTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  diningTagPill: {
    backgroundColor: '#f3e8ff',
    paddingVertical: 2.5,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  diningTagText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#5b2a86',
  },
  diningPriceText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#16a34a',
    marginLeft: 2,
  },
  diningActionBtn: {
    backgroundColor: '#5b2a86',
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  diningActionBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  recreationList: {
    gap: 10,
  },
  recreationItem: {
    flexDirection: 'row',
    backgroundColor: '#fbf9fe',
    borderWidth: 1,
    borderColor: '#ede6f6',
    borderRadius: 14,
    padding: 12,
    alignItems: 'flex-start',
    gap: 12,
  },
  recreationIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ede6f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recreationEmoji: {
    fontSize: 18,
  },
  recreationContent: {
    flex: 1,
  },
  recreationTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 6,
  },
  recreationTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#190c2d',
    flex: 1,
  },
  recreationBadge: {
    backgroundColor: '#ede6f6',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  recreationBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5b2a86',
  },
  recreationDesc: {
    fontSize: 11.5,
    color: '#655d78',
    lineHeight: 16,
  },
  mapFrame: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#ede6f6',
    marginBottom: 10,
    position: 'relative',
  },
  mapImage: {
    width: '100%',
    height: '100%',
  },
  mapPinContainer: {
    position: 'absolute',
    top: '40%',
    left: '46%',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  addressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  addressText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#372f4a',
    flex: 1,
  },
  directionsBtn: {
    backgroundColor: '#5b2a86',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  directionsBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#ffffff',
  },
  errorText: {
    fontSize: 11.5,
    color: '#e11d48',
    marginBottom: 10,
    textAlign: 'center',
  },
  transitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transitGridTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#190c2d',
  },
  transitModeBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5b2a86',
  },
  transitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transitCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fbf9fe',
    borderWidth: 1,
    borderColor: '#ede6f6',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transitCellLeft: {
    flex: 1,
    marginRight: 6,
  },
  destName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#190c2d',
  },
  destTransitMode: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#5b2a86',
    marginTop: 2,
  },
  minutePill: {
    backgroundColor: '#ede6f6',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  minuteText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5b2a86',
  },
  noDiningText: {
    fontSize: 12.5,
    color: '#655d78',
    fontStyle: 'italic',
    paddingVertical: 8,
    textAlign: 'center',
  },
  categoryPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  categoryPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#f1edfa',
    borderWidth: 1,
    borderColor: '#e4daf5',
  },
  categoryPillActive: {
    backgroundColor: '#5b2a86',
    borderColor: '#5b2a86',
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5b2a86',
  },
  categoryPillTextActive: {
    color: '#ffffff',
  },
  expandToggleBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f7f4fc',
    borderWidth: 1,
    borderColor: '#e9e1f5',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  expandToggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5b2a86',
  },
  recreationItemPressable: {
    borderWidth: 1,
    borderColor: '#ede6f6',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fbf9fe',
  },
  recreationChevronWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 10, 28, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modalEmoji: {
    fontSize: 26,
  },
  modalTitleWrap: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#190c2d',
    marginBottom: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalDesc: {
    fontSize: 12.5,
    color: '#4a3f60',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  modalDetailText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#372f4a',
    flex: 1,
  },
  modalDoneBtn: {
    backgroundColor: '#5b2a86',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 14,
  },
  modalDoneBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
});
