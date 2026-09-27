// Feature: experience-detail-redesign, Task 26.3 — ResortGuideSection tests
//
// Validates: Requirements 20.4, 20.5, 20.6

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ResortGuideSection, {
  cleanAndSortMealPeriods,
  resolveDestinationTransit,
  resolveTransitSummary,
} from '../ResortGuideSection';
import { apiRequest } from '../../../api/client';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('../../../api/client', () => ({
  __esModule: true,
  apiRequest: jest.fn(async () => ({ items: [] })),
}));

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

describe('ResortGuideSection (Requirements 20.4, 20.5, 20.6)', () => {
  const mockResort = {
    id: 'resort-coronado',
    name: "Disney's Coronado Springs Resort",
    description: 'A moderate resort on Lago Dorado',
    tier: 'Moderate' as const,
    featurePool: 'The Dig Site & Lost City of Cibola Pool',
    transportationModes: ['Bus'],
    recreation: [
      {
        icon: '🏊',
        title: 'The Dig Site & Lost City of Cibola Pool',
        badge: 'Feature Pool',
        description: '50-foot Mayan pyramid with cascading waterfall.',
      },
      {
        icon: '🏃',
        title: 'Lago Dorado 0.9-Mile Jogging Loop',
        badge: 'Trail',
        description: 'Scenic paved waterfront path connecting all neighborhoods.',
      },
    ],
    transitTimes: {
      'Animal Kingdom': 8,
      'Magic Kingdom': 16,
    },
    architecturalLore: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiRequest as jest.Mock).mockResolvedValue({ items: [] });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  });

  it('renders all four primary resort cards (Highlights, Dining Directory, Recreation, Map & Transit)', () => {
    const client = createQueryClient();
    const { getByTestId, getByText, getAllByText } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    // 1. Highlights
    expect(getByTestId('resort-highlights-card')).toBeTruthy();
    expect(getByText('Property Highlights & Atmosphere')).toBeTruthy();
    expect(getByText('Moderate Resort')).toBeTruthy();
    expect(getByText('Gran Destino Tower')).toBeTruthy();

    // 2. Dining Directory (mockup match)
    expect(getByTestId('resort-dining-directory-card')).toBeTruthy();
    expect(getByText(/Dining & Lounges at the Resort/)).toBeTruthy();
    expect(getByTestId('resort-dining-inspect-hint')).toBeTruthy();
    expect(getByText('Toledo – Tapas, Steak & Seafood')).toBeTruthy();
    expect(getByText('Three Bridges Bar & Grill')).toBeTruthy();
    expect(getByText('Maya Grill')).toBeTruthy();
    expect(getByText('Dahlia Lounge & Barcelona Lounge')).toBeTruthy();
    expect(getByText('El Mercado de Coronado')).toBeTruthy();
    expect(getByTestId('resort-dining-meals-a2b8f7c2-5aed-5432-a69c-8944524ce74c')).toHaveTextContent('Dinner');
    expect(getByTestId('resort-dining-meals-7fedf9d2-0cf1-59df-bb66-0e77d947dece')).toHaveTextContent('Dinner, Late Night');
    expect(getByTestId('resort-dining-meals-b7cba035-5b25-5697-a0ca-dadef0054658')).toHaveTextContent('Breakfast, Lunch, Dinner');

    // 3. Recreation & Amenities
    expect(getByTestId('resort-recreation-card')).toBeTruthy();
    expect(getByText('Recreation & Resort Amenities')).toBeTruthy();
    expect(getAllByText('The Dig Site & Lost City of Cibola Pool').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Lago Dorado 0.9-Mile Jogging Loop')).toBeTruthy();

    // 4. Map & Transit
    expect(getByTestId('resort-map-transit-card')).toBeTruthy();
    expect(getByText('Property Map & Transit Times')).toBeTruthy();
    expect(getByText(/1000 W Buena Vista Dr/)).toBeTruthy();
    expect(getByTestId('resort-get-directions-btn')).toBeTruthy();
    expect(getByText('Animal Kingdom')).toBeTruthy();
    expect(getByText('~8m')).toBeTruthy();
    expect(getByText('Magic Kingdom')).toBeTruthy();
    expect(getByText('~16m')).toBeTruthy();
  });

  it('navigates to ExperienceDetail when a dining card is pressed', () => {
    const client = createQueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    // Tap Toledo card
    const toledoCard = getByTestId('resort-dining-item-a2b8f7c2-5aed-5432-a69c-8944524ce74c');
    fireEvent.press(toledoCard);

    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'a2b8f7c2-5aed-5432-a69c-8944524ce74c',
    });
  });

  it('navigates to ExperienceDetail when Menu › action button is pressed', () => {
    const client = createQueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    // Tap Three Bridges Menu › button
    const menuBtn = getByTestId('resort-dining-action-7fedf9d2-0cf1-59df-bb66-0e77d947dece');
    fireEvent.press(menuBtn);

    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: '7fedf9d2-0cf1-59df-bb66-0e77d947dece',
    });
  });

  it('invokes Linking.openURL with Disney dining URL when Reserve button is pressed', async () => {
    const client = createQueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    // Tap Toledo Reserve button
    const reserveBtn = getByTestId('resort-dining-action-a2b8f7c2-5aed-5432-a69c-8944524ce74c');
    fireEvent.press(reserveBtn);

    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith(
        'https://disneyworld.disney.go.com/dining/coronado-springs-resort/toledo/',
      );
    });
  });

  it('renders dynamic dining items when apiRequest returns catalog restaurants', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'custom-dining-1',
          name: 'Custom Lakeside Grill',
          category: 'Restaurant',
          subType: 'Table Service',
          description: 'Custom fine dining overlooking the water.',
          priceTier: '$$$',
          mealPeriods: [{ type: 'Lunch' }, { type: 'Dinner' }],
          diningUrl: 'https://disneyworld.disney.go.com/dining/custom/',
        },
      ],
    });

    const client = createQueryClient();
    const { getByText, getByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByText('Custom Lakeside Grill')).toBeTruthy();
      expect(getByText('Custom fine dining overlooking the water.')).toBeTruthy();
      expect(getByText('$$$')).toBeTruthy();
      expect(getByTestId('resort-dining-meals-custom-dining-1')).toHaveTextContent('Lunch, Dinner');
    });

    // Press card
    fireEvent.press(getByTestId('resort-dining-item-custom-dining-1'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'custom-dining-1',
    });
  });

  it('renders served meal periods on their own dedicated line in canonical chronological order and filters non-meal tags (Requirement 20.4)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'venue-scrambled-meals',
          name: 'Rix Sports Bar & Grill',
          category: 'Restaurant',
          subType: 'Table Service',
          priceTier: '$$',
          // Scrambled order from API: Dinner, Breakfast, Lunch
          mealPeriods: [{ type: 'Dinner' }, { type: 'Breakfast' }, { type: 'Lunch' }],
        },
        {
          id: 'venue-pool-bar-tag',
          name: 'Siestas Cantina',
          category: 'Restaurant',
          subType: 'Poolside Bar',
          priceTier: '$$',
          // Non-meal tag returned by upstream sync
          mealPeriods: [{ type: 'Pool Bar' }],
        },
        {
          id: 'venue-without-meals',
          name: 'Mystery Dining Spot',
          category: 'Restaurant',
          subType: 'Quick Service',
          priceTier: '$',
        },
      ],
    });

    const client = createQueryClient();
    const { getByTestId, queryByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-coronado"
          experienceName="Disney's Coronado Springs Resort"
          resort={mockResort as any}
          latitude={28.3644}
          longitude={-81.5694}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      // Scrambled meals sorted to canonical chronological order: Breakfast, Lunch, Dinner
      expect(getByTestId('resort-dining-meals-venue-scrambled-meals')).toHaveTextContent(
        'Breakfast, Lunch, Dinner',
      );
      // 'Pool Bar' tag filtered out, falling back to authentic Siestas known meals: Lunch, Dinner
      expect(getByTestId('resort-dining-meals-venue-pool-bar-tag')).toHaveTextContent(
        'Lunch, Dinner',
      );
      // Venue without meals renders no meals text element
      expect(queryByTestId('resort-dining-meals-venue-without-meals')).toBeNull();
    });
  });

  it('renders authentic Beach Club details without falling back to Coronado Springs copy', () => {
    const client = createQueryClient();
    const { getByTestId, getByText, getAllByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-beach-club"
          experienceName="Disney's Beach Club Resort"
          resort={{
            id: 'resort-beach-club',
            name: "Disney's Beach Club Resort",
            tier: 'Deluxe',
            featurePool: 'Stormalong Bay',
            transportationModes: ['Boat', 'Walking', 'Skyliner', 'Bus'],
            recreation: [],
            transitTimes: {
              EPCOT: 5,
              'Hollywood Studios': 12,
              'Magic Kingdom': 18,
            },
            architecturalLore: [],
          } as any}
          latitude={28.3712}
          longitude={-81.5544}
        />
      </QueryClientProvider>,
    );

    // 1. Highlights
    expect(getByTestId('resort-highlights-card')).toBeTruthy();
    expect(getByText('Deluxe Resort')).toBeTruthy();
    expect(getByText('Stormalong Bay Sand Lagoon')).toBeTruthy();
    expect(getByText('Crescent Lake & EPCOT Gateway')).toBeTruthy();
    expect(queryByText('Gran Destino Tower')).toBeNull();
    expect(queryByText(/Spanish Colonial and Southwestern Mexican heritage/)).toBeNull();

    // 2. Dining Directory
    expect(getByTestId('resort-dining-directory-card')).toBeTruthy();
    expect(getByText('Cape May Cafe')).toBeTruthy();
    expect(getByText('Beaches & Cream Soda Shop')).toBeTruthy();
    expect(getByText('Beach Club Marketplace')).toBeTruthy();
    expect(getByTestId('resort-dining-meals-beach-club-cape-may')).toHaveTextContent('Breakfast, Dinner');
    expect(getByTestId('resort-dining-meals-beach-club-beaches-cream')).toHaveTextContent('Lunch, Dinner');
    expect(getByTestId('resort-dining-meals-beach-club-marketplace')).toHaveTextContent('Breakfast, Lunch, Dinner');
    expect(queryByText('Toledo – Tapas, Steak & Seafood')).toBeNull();
    expect(queryByText('Three Bridges Bar & Grill')).toBeNull();

    // 3. Map & Transit
    expect(getByTestId('resort-map-transit-card')).toBeTruthy();
    expect(getByText(/1800 Epcot Resorts Blvd/)).toBeTruthy();
    expect(queryByText(/1000 W Buena Vista Dr/)).toBeNull();
    expect(getByText('⛴️ Boat • 🚌 Bus')).toBeTruthy();
    expect(getByText(/Complimentary Boat & Bus transportation connects you/)).toBeTruthy();
    expect(getByText('EPCOT')).toBeTruthy();
    expect(getAllByText('⛴️ Boat / Walk').length).toBe(2);
    expect(getByText('~5m')).toBeTruthy();
    expect(getByText('Hollywood Studios')).toBeTruthy();
    expect(getByText('~12m')).toBeTruthy();
    expect(getByText('Magic Kingdom')).toBeTruthy();
    expect(getByText('🚌 Bus')).toBeTruthy();
    expect(getByText('~18m')).toBeTruthy();
  });

  it('renders Skyliner and Bus transit correctly for Skyliner resorts (e.g. Pop Century)', () => {
    const client = createQueryClient();
    const { getByTestId, getByText, getAllByText } = render(
      <QueryClientProvider client={client}>
        <ResortGuideSection
          experienceId="exp-pop-century"
          experienceName="Disney's Pop Century Resort"
          resort={{
            id: 'resort-pop',
            name: "Disney's Pop Century Resort",
            tier: 'Value',
            featurePool: 'Hippy Dippy Pool',
            transportationModes: ['Skyliner', 'Bus'],
            recreation: [],
            transitTimes: {
              'Hollywood Studios': 8,
              EPCOT: 12,
              'Animal Kingdom': 15,
              'Magic Kingdom': 20,
              'Disney Springs': 14,
            },
            architecturalLore: [],
          } as any}
          latitude={28.3512}
          longitude={-81.5412}
        />
      </QueryClientProvider>,
    );

    expect(getByTestId('resort-map-transit-card')).toBeTruthy();
    expect(getByText('🚡 Skyliner • 🚌 Bus')).toBeTruthy();
    expect(getByText(/Complimentary Skyliner & Bus transportation connects you/)).toBeTruthy();
    expect(getAllByText('🚡 Skyliner').length).toBe(2); // EPCOT & Hollywood Studios
    expect(getAllByText('🚌 Bus').length).toBe(3); // AK, MK, Disney Springs
  });

  describe('resolveDestinationTransit and resolveTransitSummary (Property 28, Requirement 20.4)', () => {
    it('resolves Crescent Lake resorts to Boat / Walk for EPCOT and HS, and Bus for other parks', () => {
      const epcot = resolveDestinationTransit("Disney's Beach Club Resort", 'EPCOT');
      expect(epcot).toEqual({ mode: 'Boat / Walk', icon: '⛴️' });

      const hs = resolveDestinationTransit("Disney's Yacht Club Resort", 'Hollywood Studios');
      expect(hs).toEqual({ mode: 'Boat / Walk', icon: '⛴️' });

      const mk = resolveDestinationTransit("Disney's BoardWalk Inn", 'Magic Kingdom');
      expect(mk).toEqual({ mode: 'Bus', icon: '🚌' });

      const ak = resolveDestinationTransit("Disney's Beach Club Resort", 'Animal Kingdom');
      expect(ak).toEqual({ mode: 'Bus', icon: '🚌' });

      const ds = resolveDestinationTransit("Disney's Beach Club Resort", 'Disney Springs');
      expect(ds).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('resolves Monorail resorts to Monorail for Magic Kingdom and EPCOT, and Bus for others', () => {
      const gfMk = resolveDestinationTransit("Disney's Grand Floridian Resort & Spa", 'Magic Kingdom');
      expect(gfMk).toEqual({ mode: 'Monorail / Boat', icon: '🚝' });

      const contMk = resolveDestinationTransit("Disney's Contemporary Resort", 'Magic Kingdom');
      expect(contMk).toEqual({ mode: 'Monorail / Walk', icon: '🚝' });

      const gfEpcot = resolveDestinationTransit("Disney's Grand Floridian Resort & Spa", 'EPCOT');
      expect(gfEpcot).toEqual({ mode: 'Monorail', icon: '🚝' });

      const gfHs = resolveDestinationTransit("Disney's Grand Floridian Resort & Spa", 'Hollywood Studios');
      expect(gfHs).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('resolves Skyliner resorts to Skyliner for EPCOT and HS, and Bus for others', () => {
      const popEpcot = resolveDestinationTransit("Disney's Pop Century Resort", 'EPCOT');
      expect(popEpcot).toEqual({ mode: 'Skyliner', icon: '🚡' });

      const popHs = resolveDestinationTransit("Disney's Pop Century Resort", 'Hollywood Studios');
      expect(popHs).toEqual({ mode: 'Skyliner', icon: '🚡' });

      const popMk = resolveDestinationTransit("Disney's Pop Century Resort", 'Magic Kingdom');
      expect(popMk).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('resolves Wilderness Lodge to Boat for Magic Kingdom and Bus for others', () => {
      const wlMk = resolveDestinationTransit("Disney's Wilderness Lodge", 'Magic Kingdom');
      expect(wlMk).toEqual({ mode: 'Boat', icon: '⛴️' });

      const wlEpcot = resolveDestinationTransit("Disney's Wilderness Lodge", 'EPCOT');
      expect(wlEpcot).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('resolves Port Orleans to Boat for Disney Springs and Bus for theme parks', () => {
      const poDs = resolveDestinationTransit("Disney's Port Orleans Resort - French Quarter", 'Disney Springs');
      expect(poDs).toEqual({ mode: 'Boat', icon: '⛴️' });

      const poMk = resolveDestinationTransit("Disney's Port Orleans Resort - Riverside", 'Magic Kingdom');
      expect(poMk).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('resolves bus-only resorts to Bus for all destinations', () => {
      const csMk = resolveDestinationTransit("Disney's Coronado Springs Resort", 'Magic Kingdom');
      expect(csMk).toEqual({ mode: 'Bus', icon: '🚌' });

      const csAk = resolveDestinationTransit("Disney's Coronado Springs Resort", 'Animal Kingdom');
      expect(csAk).toEqual({ mode: 'Bus', icon: '🚌' });
    });

    it('generates multi-modal transit summaries and badge text accurately', () => {
      const beachSummary = resolveTransitSummary(
        "Disney's Beach Club Resort",
        ['EPCOT', 'Hollywood Studios', 'Magic Kingdom', 'Animal Kingdom', 'Disney Springs'],
        ['Boat', 'Bus'],
      );
      expect(beachSummary.summaryText).toBe('Boat & Bus');
      expect(beachSummary.badgeText).toBe('⛴️ Boat • 🚌 Bus');

      const popSummary = resolveTransitSummary(
        "Disney's Pop Century Resort",
        ['Hollywood Studios', 'EPCOT', 'Animal Kingdom', 'Magic Kingdom', 'Disney Springs'],
        ['Skyliner', 'Bus'],
      );
      expect(popSummary.summaryText).toBe('Skyliner & Bus');
      expect(popSummary.badgeText).toBe('🚡 Skyliner • 🚌 Bus');

      const gfSummary = resolveTransitSummary(
        "Disney's Grand Floridian Resort & Spa",
        ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom', 'Disney Springs'],
        ['Monorail', 'Boat', 'Bus'],
      );
      expect(gfSummary.summaryText).toBe('Monorail, Boat & Bus');
      expect(gfSummary.badgeText).toBe('🚝 Monorail • ⛴️ Boat • 🚌 Bus');

      const csSummary = resolveTransitSummary(
        "Disney's Coronado Springs Resort",
        ['Animal Kingdom', 'Hollywood Studios', 'EPCOT', 'Magic Kingdom', 'Disney Springs'],
        ['Bus'],
      );
      expect(csSummary.summaryText).toBe('Bus');
      expect(csSummary.badgeText).toBe('🚌 Direct Bus');
    });
  });

  describe('cleanAndSortMealPeriods (canonical order & filtering)', () => {
    it('sorts meals into canonical chronological order', () => {
      const raw = [{ type: 'Dinner' }, { type: 'Late Night' }, { type: 'Breakfast' }, { type: 'Lunch' }];
      expect(cleanAndSortMealPeriods(raw)).toEqual([
        'Breakfast',
        'Lunch',
        'Dinner',
        'Late Night',
      ]);
    });

    it('filters out non-meal facility tags like Pool Bar, Bar, Lounge', () => {
      const raw = ['Pool Bar', 'Dinner', 'Bar', 'Lunch', 'Lounge'];
      expect(cleanAndSortMealPeriods(raw)).toEqual(['Lunch', 'Dinner']);
    });

    it('handles strings and objects, deduplicates, and normalizes casing', () => {
      const raw = ['dinner', { type: 'Breakfast' }, 'dinner', 'brunch'];
      expect(cleanAndSortMealPeriods(raw)).toEqual(['Breakfast', 'Brunch', 'Dinner']);
    });

    it('returns undefined when all tags are invalid or input is empty', () => {
      expect(cleanAndSortMealPeriods([])).toBeUndefined();
      expect(cleanAndSortMealPeriods(undefined)).toBeUndefined();
      expect(cleanAndSortMealPeriods(['Pool Bar', 'Lounge'])).toBeUndefined();
    });
  });
});

