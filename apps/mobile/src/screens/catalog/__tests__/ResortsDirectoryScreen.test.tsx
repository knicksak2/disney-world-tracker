import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ResortsDirectoryScreen from '../ResortsDirectoryScreen';
import { apiRequest } from '../../../api/client';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('../../../api/client', () => ({
  __esModule: true,
  apiRequest: jest.fn(),
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

describe('ResortsDirectoryScreen (Requirement 2, Tasks 5.1-5.4)', () => {
  const mockResortsData = [
    {
      id: 'resort-grand-floridian',
      name: "Disney's Grand Floridian Resort & Spa",
      tier: 'Deluxe' as const,
      description: 'Victorian elegance on Seven Seas Lagoon.',
      imageUrl: 'https://example.com/gf.jpg',
      representingExperienceId: 'exp-grand-floridian',
      featurePool: 'Beach Pool',
      transportationModes: ['Monorail', 'Boat', 'Bus'],
      transitTimes: { 'Magic Kingdom': 4, EPCOT: 18 },
      recreation: [
        {
          id: 'exp-gf-pool',
          icon: '🏊',
          title: 'Beach Pool & Courtyard Pool',
          badge: 'Feature Pool',
          description: 'Zero-entry pool with slide.',
          hours: '9:00 AM - 10:00 PM',
          priceTier: 'Included',
        },
      ],
    },
    {
      id: 'resort-riviera',
      name: "Disney's Riviera Resort",
      tier: 'Deluxe Villa' as const,
      description: 'European elegance inspired by Walt and Lillian.',
      imageUrl: 'https://example.com/riviera.jpg',
      representingExperienceId: 'exp-riviera',
      featurePool: 'Riviera Pool',
      transportationModes: ['Skyliner', 'Bus'],
      transitTimes: { EPCOT: 8, 'Hollywood Studios': 8 },
      recreation: [
        {
          icon: '🏊',
          title: 'Riviera Pool',
          badge: 'Feature Pool',
          description: 'Mediterranean sun deck and stone turret.',
          hours: '9:00 AM - 10:00 PM',
          priceTier: 'Included',
        },
      ],
    },
    {
      id: 'resort-coronado',
      name: "Disney's Coronado Springs Resort",
      tier: 'Moderate' as const,
      description: 'Southwestern lakeside oasis and Gran Destino Tower.',
      imageUrl: 'https://example.com/coronado.jpg',
      representingExperienceId: 'exp-coronado',
      featurePool: 'The Dig Site & Lost City of Cibola Pool',
      transportationModes: ['Bus'],
      transitTimes: { 'Animal Kingdom': 8, 'Magic Kingdom': 16 },
    },
    {
      id: 'resort-pop',
      name: "Disney's Pop Century Resort",
      tier: 'Value' as const,
      description: 'Pop-culture decades 1950s–1990s.',
      imageUrl: 'https://example.com/pop.jpg',
      representingExperienceId: 'exp-pop-century',
      featurePool: 'Hippy Dippy Pool',
      transportationModes: ['Skyliner', 'Bus'],
      transitTimes: { 'Hollywood Studios': 10, EPCOT: 12 },
    },
  ];

  const mockExperiencesData = [
    {
      id: 'exp-gf-victoria-albert',
      resortId: 'resort-grand-floridian',
      name: "Victoria & Albert's",
      category: 'Restaurant',
      subType: 'Fine Dining',
      priceTier: '$$$$',
      description: 'AAA Five Diamond culinary palace.',
      mealPeriods: [{ type: 'Dinner' }],
    },
    {
      id: 'exp-riviera-topolino',
      resortId: 'resort-riviera',
      name: "Topolino's Terrace",
      category: 'Restaurant',
      subType: 'Table Service',
      priceTier: '$$$$',
      description: 'Rooftop French and Italian dining.',
      mealPeriods: [{ type: 'Breakfast' }, { type: 'Dinner' }],
    },
    {
      id: 'exp-coronado-el-mercado',
      resortId: 'resort-coronado',
      name: 'El Mercado de Coronado',
      category: 'Restaurant',
      subType: 'Quick Service',
      priceTier: '$',
      description: 'Food court with Mexican favorites.',
      mealPeriods: [{ type: 'Breakfast' }, { type: 'Lunch' }, { type: 'Dinner' }],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiRequest as jest.Mock).mockImplementation(async (_method: string, path: string) => {
      if (path === '/resorts') {
        return { resorts: mockResortsData };
      }
      if (path.includes('/catalog')) {
        return { experiences: mockExperiencesData };
      }
      return {};
    });
  });

  it('renders header, title, and handles back navigation (Requirement 2.1)', () => {
    const client = createQueryClient();
    const { getByTestId, getByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    expect(getByTestId('resorts-directory-screen')).toBeTruthy();
    expect(getByText('Disney Resorts & Hotels')).toBeTruthy();
    expect(getByTestId('resorts-search-input')).toBeTruthy();

    const backBtn = getByTestId('resorts-back-btn');
    fireEvent.press(backBtn);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('switches between all four partition tabs (Requirement 2.2)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Initial tab: Hotels
    expect(getByTestId('resorts-filter-all')).toBeTruthy();

    // Tap Dining tab
    fireEvent.press(getByTestId('resorts-tab-dining'));
    expect(getByTestId('dining-filter-all')).toBeTruthy();
    expect(getByTestId('dining-filter-table')).toBeTruthy();
    expect(getByTestId('dining-filter-quick')).toBeTruthy();
    expect(getByTestId('dining-filter-lounge')).toBeTruthy();

    // Tap Recreation tab
    fireEvent.press(getByTestId('resorts-tab-recreation'));
    expect(getByTestId('rec-filter-all')).toBeTruthy();
    expect(getByTestId('rec-filter-pools')).toBeTruthy();

    // Tap Sub-Destinations tab
    fireEvent.press(getByTestId('resorts-tab-subdest'));
    expect(getByTestId('subdest-card-boardwalk')).toBeTruthy();
    expect(getByTestId('subdest-card-wwos')).toBeTruthy();
    expect(getByTestId('subdest-card-golf')).toBeTruthy();
    expect(getByText("Disney's BoardWalk & Promenade")).toBeTruthy();
    expect(getByText('ESPN Wide World of Sports Complex')).toBeTruthy();
  });

  it('filters hotels by tier and transport modes (Requirement 2.3)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
      expect(getByText("Disney's Riviera Resort")).toBeTruthy();
      expect(getByText("Disney's Coronado Springs Resort")).toBeTruthy();
      expect(getByText("Disney's Pop Century Resort")).toBeTruthy();
    });

    // 1. Filter by Deluxe
    fireEvent.press(getByTestId('resorts-filter-deluxe'));
    expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
    expect(queryByText("Disney's Riviera Resort")).toBeNull();
    expect(queryByText("Disney's Coronado Springs Resort")).toBeNull();
    expect(queryByText("Disney's Pop Century Resort")).toBeNull();

    // 2. Filter by DVC Villas (persisted tier === 'Deluxe Villa', Requirement 2.3)
    fireEvent.press(getByTestId('resorts-filter-dvc'));
    expect(getByText("Disney's Riviera Resort")).toBeTruthy();
    expect(queryByText("Disney's Grand Floridian Resort & Spa")).toBeNull();
    expect(queryByText("Disney's Coronado Springs Resort")).toBeNull();

    // 3. Filter by Monorail
    fireEvent.press(getByTestId('resorts-filter-monorail'));
    expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
    expect(queryByText("Disney's Riviera Resort")).toBeNull();

    // 4. Reset to All
    fireEvent.press(getByTestId('resorts-filter-all'));
    expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
    expect(getByText("Disney's Pop Century Resort")).toBeTruthy();
  });

  it('renders HotelPreviewCard with metrics and navigates to ExperienceDetail (Requirements 2.4, 2.5, 2.6)', async () => {
    const client = createQueryClient();
    const { getByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('hotel-preview-card-resort-grand-floridian')).toBeTruthy();
      expect(getByTestId('hotel-metric-dining-resort-grand-floridian')).toBeTruthy();
      expect(getByTestId('hotel-metric-activities-resort-grand-floridian')).toBeTruthy();
      expect(getByTestId('hotel-metric-transit-resort-grand-floridian')).toBeTruthy();
    });

    // Tap CTA button
    const ctaBtn = getByTestId('hotel-view-resort-btn-resort-grand-floridian');
    fireEvent.press(ctaBtn);

    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-grand-floridian',
    });
  });

  it('filters dining venues and handles navigation in dining tab (Requirement 2.7)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Switch to Dining tab
    fireEvent.press(getByTestId('resorts-tab-dining'));

    await waitFor(() => {
      expect(getByText("Victoria & Albert's")).toBeTruthy();
      expect(getByText("Topolino's Terrace")).toBeTruthy();
      expect(getByText('El Mercado de Coronado')).toBeTruthy();
    });

    // Filter to Quick Service
    fireEvent.press(getByTestId('dining-filter-quick'));
    expect(getByText('El Mercado de Coronado')).toBeTruthy();
    expect(queryByText("Victoria & Albert's")).toBeNull();

    // Tap dining card to navigate
    fireEvent.press(getByTestId('resort-dining-card-exp-coronado-el-mercado'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-coronado-el-mercado',
    });
  });

  it('renders dining cards with thumbnails, owning resort badges, favorite buttons, and searches by resort name (Requirement 2.7)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Switch to Dining tab
    fireEvent.press(getByTestId('resorts-tab-dining'));

    await waitFor(() => {
      expect(getByText("Victoria & Albert's")).toBeTruthy();
    });

    // Thumbnail and favorite button exist
    expect(getByTestId('dining-thumb-exp-gf-victoria-albert')).toBeTruthy();
    expect(getByTestId('favorite-toggle-exp-gf-victoria-albert')).toBeTruthy();

    // Owning resort is displayed
    expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();

    // Raw description text is omitted from the card
    expect(queryByText('AAA Five Diamond culinary palace.')).toBeNull();

    // Search by resort name filters to that resort's dining
    const searchInput = getByTestId('resorts-search-input');
    fireEvent.changeText(searchInput, 'Coronado');
    expect(getByText('El Mercado de Coronado')).toBeTruthy();
    expect(queryByText("Victoria & Albert's")).toBeNull();
  });

  it('filters search text across hotels and clears cleanly (Requirement 2.1)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
    });

    const searchInput = getByTestId('resorts-search-input');
    fireEvent.changeText(searchInput, 'Riviera');

    expect(getByText("Disney's Riviera Resort")).toBeTruthy();
    expect(queryByText("Disney's Grand Floridian Resort & Spa")).toBeNull();

    // Clear search
    const clearBtn = getByTestId('resorts-search-clear');
    fireEvent.press(clearBtn);

    expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
  });

  it('renders all resort recreation activities including arts & classes with resort origin badges and handles category filtering (Requirement 2.8)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, getAllByText, queryByText, queryByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Switch to Recreation tab
    fireEvent.press(getByTestId('resorts-tab-recreation'));

    await waitFor(() => {
      // Coronado signature activities (including painting & craft classes)
      expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
      expect(getByText('Spanish Mosaic Art Experience')).toBeTruthy();
      // Riviera signature activities
      expect(getByText('Painting on the Riviera')).toBeTruthy();
      // Origin resort badge is rendered for activities
      expect(getAllByText("📍 Disney's Coronado Springs Resort").length).toBeGreaterThanOrEqual(1);
    });

    // 1. Filter to Arts & Classes
    fireEvent.press(getByTestId('rec-filter-arts'));
    expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
    expect(getByText('Spanish Mosaic Art Experience')).toBeTruthy();
    expect(getByText('Sangria University')).toBeTruthy();
    expect(getByText('Painting on the Riviera')).toBeTruthy();
    // Pools should be filtered out
    expect(queryByText('The Dig Site & Lost City of Cibola Pool')).toBeNull();

    // 2. Filter to Pools & Water
    fireEvent.press(getByTestId('rec-filter-pools'));
    expect(getByText('The Dig Site & Lost City of Cibola Pool')).toBeTruthy();
    expect(queryByText('Colors of Coronado Painting Experience')).toBeNull();

    // 3. Reset to All Activities
    fireEvent.press(getByTestId('rec-filter-all'));
    expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
    expect(getByText('Painting on the Riviera')).toBeTruthy();

    // 4. Tap on a recreation amenity without an experience page (Pool) to open amenity detail modal
    fireEvent.press(getByTestId('resort-rec-card-rec-coronado-pool'));
    expect(getByTestId('resorts-amenity-modal')).toBeTruthy();
    expect(getAllByText('The Dig Site & Lost City of Cibola Pool').length).toBeGreaterThanOrEqual(1);

    // Close modal
    fireEvent.press(getByTestId('resorts-amenity-modal-close'));
    await waitFor(() => {
      expect(queryByTestId('resorts-amenity-modal')).toBeNull();
    });

    // 5. Tap on a signature activity with an experience page to navigate to ExperienceDetailScreen
    fireEvent.press(getByTestId('resort-rec-card-b1010001-c001-4000-8000-000000000001'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'b1010001-c001-4000-8000-000000000001',
    });
  });

  it('opens hotel picker bottom sheet, filters dining to a specific hotel, and clears filter (Requirements 2.7, 2.10)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Switch to Dining tab
    fireEvent.press(getByTestId('resorts-tab-dining'));

    await waitFor(() => {
      expect(getByText("Victoria & Albert's")).toBeTruthy();
    });

    // Hotel filter pill is rendered with "All Hotels" default
    const hotelFilterBtn = getByTestId('dining-hotel-filter-btn');
    expect(hotelFilterBtn).toBeTruthy();
    expect(getByText('All Hotels')).toBeTruthy();

    // Tap to open modal sheet
    fireEvent.press(hotelFilterBtn);
    expect(getByTestId('resorts-hotel-picker-modal')).toBeTruthy();
    expect(getByTestId('hotel-filter-option-all')).toBeTruthy();

    // Search in modal
    const modalSearch = getByTestId('resorts-hotel-modal-search');
    fireEvent.changeText(modalSearch, 'Riviera');
    expect(getByTestId('hotel-filter-option-resort-riviera')).toBeTruthy();
    expect(queryByTestId('hotel-filter-option-resort-grand-floridian')).toBeNull();

    // Select Riviera
    fireEvent.press(getByTestId('hotel-filter-option-resort-riviera'));

    // Modal closes
    await waitFor(() => {
      expect(queryByTestId('resorts-hotel-picker-modal')).toBeNull();
    });

    // Dining venues filtered: Topolino's Terrace visible, Victoria & Albert's and El Mercado hidden
    expect(getByText("Topolino's Terrace")).toBeTruthy();
    expect(queryByText("Victoria & Albert's")).toBeNull();
    expect(queryByText('El Mercado de Coronado')).toBeNull();

    // Filter pill now displays Riviera Resort
    expect(getByText('Riviera Resort')).toBeTruthy();

    // Clear filter via quick-clear button
    const clearBtn = getByTestId('dining-hotel-filter-clear');
    fireEvent.press(clearBtn);

    // All dining venues reappear
    expect(getByText("Victoria & Albert's")).toBeTruthy();
    expect(getByText("Topolino's Terrace")).toBeTruthy();
    expect(getByText('El Mercado de Coronado')).toBeTruthy();
    expect(getByText('All Hotels')).toBeTruthy();
  });

  it('filters recreation to a specific hotel using the hotel picker bottom sheet and resets via All option (Requirements 2.8, 2.10)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    // Switch to Recreation tab
    fireEvent.press(getByTestId('resorts-tab-recreation'));

    await waitFor(() => {
      expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
      expect(getByText('Painting on the Riviera')).toBeTruthy();
    });

    // Recreation hotel filter button exists
    const hotelFilterBtn = getByTestId('rec-hotel-filter-btn');
    expect(hotelFilterBtn).toBeTruthy();

    // Open modal
    fireEvent.press(hotelFilterBtn);
    expect(getByTestId('resorts-hotel-picker-modal')).toBeTruthy();

    // Select Coronado Springs
    fireEvent.press(getByTestId('hotel-filter-option-resort-coronado'));

    // Modal closes
    await waitFor(() => {
      expect(queryByTestId('resorts-hotel-picker-modal')).toBeNull();
    });

    // Coronado activities visible, Riviera activities filtered out
    expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
    expect(queryByText('Painting on the Riviera')).toBeNull();

    // Re-open modal and select "All Resorts & Hotels"
    fireEvent.press(getByTestId('rec-hotel-filter-btn'));
    expect(getByTestId('resorts-hotel-picker-modal')).toBeTruthy();

    fireEvent.press(getByTestId('hotel-filter-option-all'));
    await waitFor(() => {
      expect(queryByTestId('resorts-hotel-picker-modal')).toBeNull();
    });

    // All activities visible again
    expect(getByText('Colors of Coronado Painting Experience')).toBeTruthy();
    expect(getByText('Painting on the Riviera')).toBeTruthy();
  });

  it('keeps filter chips compact and un-stretched during search (Requirement 2.1, 2.3)', async () => {
    const client = createQueryClient();
    const { getByTestId, getByText, queryByText } = render(
      <QueryClientProvider client={client}>
        <ResortsDirectoryScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getByText("Disney's Grand Floridian Resort & Spa")).toBeTruthy();
    });

    // Enter search query that matches a single resort (like "coro")
    const searchInput = getByTestId('resorts-search-input');
    fireEvent.changeText(searchInput, 'coro');

    expect(getByText("Disney's Coronado Springs Resort")).toBeTruthy();
    expect(queryByText("Disney's Grand Floridian Resort & Spa")).toBeNull();

    // Verify filter scroll and filter pill constraints prevent vertical ballooning
    const scroll = getByTestId('resorts-hotels-filter-scroll');
    const flattenedScrollStyle = Array.isArray(scroll.props.style)
      ? Object.assign({}, ...scroll.props.style.filter(Boolean))
      : scroll.props.style;
    expect(flattenedScrollStyle).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
    });

    const contentContainerStyle = Array.isArray(scroll.props.contentContainerStyle)
      ? Object.assign({}, ...scroll.props.contentContainerStyle.filter(Boolean))
      : scroll.props.contentContainerStyle;
    expect(contentContainerStyle).toMatchObject({
      alignItems: 'center',
    });

    const allPill = getByTestId('resorts-filter-all');
    const flattenedPillStyle = Array.isArray(allPill.props.style)
      ? Object.assign({}, ...allPill.props.style.filter(Boolean))
      : allPill.props.style;
    expect(flattenedPillStyle).toMatchObject({
      alignSelf: 'center',
    });
  });
});


