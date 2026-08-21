import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperiencePicker } from '../ExperiencePicker';
import { apiRequest } from '../../../api/client';
import type { ExperienceDTO } from '@dwt/shared';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockExperiences: ExperienceDTO[] = [
  {
    id: 'exp-ride-1',
    name: 'Space Mountain',
    category: 'Ride',
    park: 'Magic Kingdom',
    land: 'Tomorrowland',
    subType: 'Roller Coaster',
    entityType: 'Attraction',
  } as unknown as ExperienceDTO,
  {
    id: 'exp-dining-1',
    name: 'Be Our Guest',
    category: 'Restaurant',
    park: 'Magic Kingdom',
    land: 'Fantasyland',
    subType: 'Table Service',
    entityType: 'Restaurant',
  } as unknown as ExperienceDTO,
  {
    id: 'exp-show-1',
    name: 'Festival of the Lion King',
    category: 'Show',
    park: 'Animal Kingdom',
    land: 'Africa',
    subType: 'Stage Show',
    entityType: 'Entertainment',
  } as unknown as ExperienceDTO,
  {
    id: 'exp-show-2',
    name: 'Festival of Fantasy Parade',
    category: 'Parade',
    park: 'Magic Kingdom',
    land: 'Main Street, U.S.A.',
    subType: 'Parade',
    entityType: 'Entertainment',
  } as unknown as ExperienceDTO,
];

function renderPicker(props: Partial<React.ComponentProps<typeof ExperiencePicker>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExperiencePicker
        enabled={true}
        onSelect={jest.fn()}
        onSelectUnlocatedBreak={jest.fn()}
        testIDPrefix="picker"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ExperiencePicker Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiRequest as jest.Mock).mockResolvedValue({ experiences: mockExperiences });
  });

  it('renders category tabs', async () => {
    renderPicker();

    expect(screen.getByTestId('picker-tab-all')).toBeTruthy();
    expect(screen.getByTestId('picker-tab-attractions')).toBeTruthy();
    expect(screen.getByTestId('picker-tab-dining')).toBeTruthy();
    expect(screen.getByTestId('picker-tab-shows')).toBeTruthy();
    expect(screen.getByTestId('picker-tab-breaks')).toBeTruthy();
  });

  it('filters experiences by category when tabs are clicked and renders Land section headers (R4.12)', async () => {
    renderPicker();

    fireEvent.changeText(screen.getByTestId('picker-search'), 'Magic');

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
      expect(screen.getByText('Tomorrowland')).toBeTruthy();
      expect(screen.getByText('Fantasyland')).toBeTruthy();
    });

    // Tap Dining tab
    fireEvent.press(screen.getByTestId('picker-tab-dining'));
    await waitFor(() => {
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
    });
    expect(screen.queryByText('Space Mountain')).toBeNull();
    expect(screen.queryByText('Festival of the Lion King')).toBeNull();

    // Tap Shows tab
    fireEvent.press(screen.getByTestId('picker-tab-shows'));
    await waitFor(() => {
      expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      expect(screen.getByText('Festival of Fantasy Parade')).toBeTruthy();
    });
    expect(screen.queryByText('Space Mountain')).toBeNull();
    expect(screen.queryByText('Be Our Guest')).toBeNull();
  });

  it('queries multi-category on Shows tab using categories param and renders all 4 categories under land headers (R4.10, R4.12, R13.1)', async () => {
    const multiCategoryShows: ExperienceDTO[] = [
      {
        id: 'exp-show-1',
        name: 'Festival of the Lion King',
        category: 'Show',
        park: 'Animal Kingdom',
        land: 'Africa',
        subType: 'Stage Show',
        entityType: 'Entertainment',
      } as unknown as ExperienceDTO,
      {
        id: 'exp-show-2',
        name: 'Festival of Fantasy Parade',
        category: 'Parade',
        park: 'Magic Kingdom',
        land: 'Main Street, U.S.A.',
        subType: 'Parade',
        entityType: 'Entertainment',
      } as unknown as ExperienceDTO,
      {
        id: 'exp-show-3',
        name: 'Meet Mickey at Town Square',
        category: 'Character_Meet',
        park: 'Magic Kingdom',
        land: 'Main Street, U.S.A.',
        subType: 'Character Meet',
        entityType: 'Entertainment',
      } as unknown as ExperienceDTO,
      {
        id: 'exp-show-4',
        name: 'Disney After Hours Event',
        category: 'Event',
        park: 'Magic Kingdom',
        land: 'Fantasyland',
        subType: 'Special Event',
        entityType: 'Entertainment',
      } as unknown as ExperienceDTO,
    ];

    (apiRequest as jest.Mock).mockResolvedValue({ experiences: multiCategoryShows });

    renderPicker();

    fireEvent.press(screen.getByTestId('picker-tab-shows'));

    // Assert URL carries categories query param
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'GET',
        expect.stringMatching(/\/catalog\?categories=Show%2CParade%2CCharacter_Meet%2CEvent|\/catalog\?categories=Show,Parade,Character_Meet,Event/),
      );
    });

    // Assert all 4 items across categories are queryable and on screen
    await waitFor(() => {
      expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      expect(screen.getByText('Festival of Fantasy Parade')).toBeTruthy();
      expect(screen.getByText('Meet Mickey at Town Square')).toBeTruthy();
      expect(screen.getByText('Disney After Hours Event')).toBeTruthy();
    });

    // Assert Land section headers render
    expect(screen.getByText('Africa')).toBeTruthy();
    expect(screen.getByText('Main Street, U.S.A.')).toBeTruthy();
    expect(screen.getByText('Fantasyland')).toBeTruthy();
  });

  it('renders Destination/Park filter chips when showParkFilter=true, pre-selects defaultPark, and segregates cache on park switch (R4.12, R4.13)', async () => {
    (apiRequest as jest.Mock).mockImplementation(async (_method, path: string) => {
      if (path.includes('Magic+Kingdom') || path.includes('Magic Kingdom')) {
        return {
          experiences: [
            {
              id: 'exp-mk-1',
              name: 'Space Mountain',
              category: 'Ride',
              park: 'Magic Kingdom',
              land: 'Tomorrowland',
              subType: 'Roller Coaster',
              entityType: 'Attraction',
            },
          ],
        };
      }
      if (path.includes('EPCOT')) {
        return {
          experiences: [
            {
              id: 'exp-ep-1',
              name: 'Spaceship Earth',
              category: 'Ride',
              park: 'EPCOT',
              land: 'World Celebration',
              subType: 'Dark Ride',
              entityType: 'Attraction',
            },
          ],
        };
      }
      return { experiences: [] };
    });

    renderPicker({ showParkFilter: true, defaultPark: 'Magic Kingdom' });

    // Park filter bar is present with chips
    expect(screen.getByTestId('picker-park-filters')).toBeTruthy();
    expect(screen.getByTestId('picker-park-chip-all')).toBeTruthy();
    expect(screen.getByTestId('picker-park-chip-Magic Kingdom')).toBeTruthy();
    expect(screen.getByTestId('picker-park-chip-EPCOT')).toBeTruthy();

    // Query issued for Magic Kingdom and Space Mountain rendered
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('parkId=Magic+Kingdom'));
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Switch to EPCOT
    fireEvent.press(screen.getByTestId('picker-park-chip-EPCOT'));

    // Assert EPCOT query is issued, Spaceship Earth is rendered, and Space Mountain disappears
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('parkId=EPCOT'));
      expect(screen.getByText('Spaceship Earth')).toBeTruthy();
    });
    expect(screen.queryByText('Space Mountain')).toBeNull();
  });

  it('combines park chip, sub-filter chip, and search text conjunctively to narrow results (R4.12, R4.15)', async () => {
    (apiRequest as jest.Mock).mockImplementation(async (_method, path: string) => {
      if (path.includes('q=Be')) {
        return {
          experiences: [
            {
              id: 'exp-dining-1',
              name: 'Be Our Guest',
              category: 'Restaurant',
              park: 'Magic Kingdom',
              land: 'Fantasyland',
              subType: 'Table Service',
              entityType: 'Restaurant',
            },
          ],
        };
      }
      if (path.includes('Magic+Kingdom') || path.includes('Magic Kingdom')) {
        return {
          experiences: [
            {
              id: 'exp-dining-1',
              name: 'Be Our Guest',
              category: 'Restaurant',
              park: 'Magic Kingdom',
              land: 'Fantasyland',
              priceTier: '$$$',
              entityType: 'Restaurant',
              groupedFacets: {
                diningInterests: [{ id: 'table-service-rec', name: 'Table Service' }],
                cuisine: [{ id: 'french-cuisine', name: 'French' }],
                disneyFavorites: [{ id: 'disney-princesses-rec', name: 'Disney Princesses' }],
              },
            },
            {
              id: 'exp-dining-2',
              name: 'Cinderella Royal Table',
              category: 'Restaurant',
              park: 'Magic Kingdom',
              land: 'Fantasyland',
              priceTier: '$$$$',
              entityType: 'Restaurant',
              groupedFacets: {
                diningInterests: [{ id: 'table-service-rec', name: 'Table Service' }, { id: 'character-dining-rec', name: 'Character Dining' }],
                cuisine: [{ id: 'american-cuisine', name: 'American' }],
                disneyFavorites: [{ id: 'disney-princesses-rec', name: 'Disney Princesses' }],
              },
            },
            {
              id: 'exp-dining-3',
              name: 'Pecos Bill Tall Tale Inn',
              category: 'Restaurant',
              park: 'Magic Kingdom',
              land: 'Frontierland',
              priceTier: '$',
              entityType: 'Restaurant',
              groupedFacets: {
                diningInterests: [{ id: 'quick-service-rec', name: 'Quick Service' }],
                cuisine: [{ id: 'mexican-cuisine', name: 'Mexican' }],
              },
            },
          ],
        };
      }
      return { experiences: [] };
    });

    renderPicker({ showParkFilter: true, defaultPark: 'Magic Kingdom' });

    // Switch to Dining tab
    fireEvent.press(screen.getByTestId('picker-tab-dining'));

    await waitFor(() => {
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
      expect(screen.getByText('Cinderella Royal Table')).toBeTruthy();
      expect(screen.getByText('Pecos Bill Tall Tale Inn')).toBeTruthy();
    });

    // Open filters modal -> asserts Price Range section exists with derived price tiers
    fireEvent.press(screen.getByTestId('picker-open-filters-modal'));
    expect(screen.getByTestId('picker-modal-price-section')).toBeTruthy();
    expect(screen.getByTestId('picker-modal-filter-price-s')).toBeTruthy(); // $
    expect(screen.getByTestId('picker-modal-filter-price-sss')).toBeTruthy(); // $$$

    // Close modal
    fireEvent.press(screen.getByTestId('picker-modal-close'));

    // Tap quick-filter chip "Table Service" -> removes Pecos Bill ($ Quick Service)
    const tableServiceChip = screen.getByTestId('picker-subfilter-table-service-rec');
    expect(tableServiceChip.props.accessibilityRole).toBe('checkbox');
    expect(tableServiceChip.props.accessibilityState).toEqual({ checked: false });

    fireEvent.press(tableServiceChip);
    expect(tableServiceChip.props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText('Be Our Guest')).toBeTruthy();
    expect(screen.getByText('Cinderella Royal Table')).toBeTruthy();
    expect(screen.queryByText('Pecos Bill Tall Tale Inn')).toBeNull();

    // Type search text "Be" -> further narrows to only Be Our Guest
    fireEvent.changeText(screen.getByTestId('picker-search'), 'Be');

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('q=Be'));
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
    });
    expect(screen.queryByText('Cinderella Royal Table')).toBeNull();
    expect(screen.queryByText('Pecos Bill Tall Tale Inn')).toBeNull();
  });

  it('renders quick-chips and supports full multi-select via Filters bottom sheet modal (R4.15)', async () => {
    renderPicker();

    // Switch to Rides tab
    fireEvent.press(screen.getByTestId('picker-tab-attractions'));

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
      // Should display Filters modal button and quick chip for "Roller Coaster"
      expect(screen.getByTestId('picker-open-filters-modal')).toBeTruthy();
      expect(screen.getByTestId('picker-subfilter-subtype-roller coaster')).toBeTruthy();
    });

    // Open Filters Bottom Sheet Modal
    fireEvent.press(screen.getByTestId('picker-open-filters-modal'));
    expect(screen.getByTestId('picker-filters-modal-content')).toBeTruthy();
    expect(screen.getByTestId('picker-modal-lands-section')).toBeTruthy();
    expect(screen.getByTestId('picker-modal-attributes-section')).toBeTruthy();

    // Select Land chip "Tomorrowland" in modal
    const modalLandChip = screen.getByTestId('picker-modal-filter-land-tomorrowland');
    fireEvent.press(modalLandChip);
    expect(modalLandChip.props.accessibilityState).toEqual({ checked: true });

    // Apply modal
    fireEvent.press(screen.getByTestId('picker-modal-apply-btn'));

    // Filter button now reflects active count (1) and reset button appears
    expect(screen.getByText('Filters (1)')).toBeTruthy();
    expect(screen.getByTestId('picker-subfilter-reset')).toBeTruthy();

    // Tap reset button -> clears filters
    fireEvent.press(screen.getByTestId('picker-subfilter-reset'));
    expect(screen.getByText('Filters')).toBeTruthy();
    expect(screen.queryByTestId('picker-subfilter-reset')).toBeNull();

    // Switch to Dining tab -> filters reset and quick-chips update
    fireEvent.press(screen.getByTestId('picker-tab-dining'));
    await waitFor(() => {
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
      expect(screen.getByTestId('picker-subfilter-subtype-table service')).toBeTruthy();
    });
  });

  it('gates Breaks tab location searching behind search text threshold (R4.14)', async () => {
    renderPicker();

    // Switch to Breaks tab without typing
    fireEvent.press(screen.getByTestId('picker-tab-breaks'));

    // Should render search hint, no network call for catalog
    expect(screen.getByTestId('picker-search-hint')).toBeTruthy();
    expect(screen.getByText('Type at least 2 characters to search break locations.')).toBeTruthy();

    // Type 1 character - still gated
    fireEvent.changeText(screen.getByTestId('picker-search'), 'P');
    expect(screen.getByTestId('picker-search-hint')).toBeTruthy();

    // Type 2 characters - fires request
    fireEvent.changeText(screen.getByTestId('picker-search'), 'Po');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('q=Po'));
    });
  });

  it('renders unlocated break creator when Breaks tab is active and handles submission', async () => {
    const onSelectUnlocatedBreak = jest.fn();
    renderPicker({ onSelectUnlocatedBreak });

    fireEvent.press(screen.getByTestId('picker-tab-breaks'));

    expect(screen.getByTestId('picker-break-title-input')).toBeTruthy();
    expect(screen.getByTestId('picker-break-dur-45')).toBeTruthy();

    // Select 60 min duration
    fireEvent.press(screen.getByTestId('picker-break-dur-60'));

    // Change title
    fireEvent.changeText(screen.getByTestId('picker-break-title-input'), 'Resort Pool & Rest');

    // Submit break
    fireEvent.press(screen.getByTestId('picker-add-break-btn'));

    expect(onSelectUnlocatedBreak).toHaveBeenCalledWith('Resort Pool & Rest', 60, null);
  });

  it('B2: selecting a search result on Breaks tab stages location into the break card without calling onSelect directly', async () => {
    const onSelect = jest.fn();
    const onSelectUnlocatedBreak = jest.fn();
    const mockResort: ExperienceDTO = {
      id: 'exp-resort-poly',
      name: "Disney's Polynesian Village Resort",
      category: 'Resort',
      park: null,
      land: null,
      entityType: 'Resort',
    } as unknown as ExperienceDTO;

    (apiRequest as jest.Mock).mockResolvedValue({
      experiences: [mockResort],
    });

    renderPicker({ onSelect, onSelectUnlocatedBreak });

    // Switch to Breaks tab
    fireEvent.press(screen.getByTestId('picker-tab-breaks'));

    // Search for Polynesian
    fireEvent.changeText(screen.getByTestId('picker-search'), 'Polynesian');

    await waitFor(() => {
      expect(screen.getByText("Disney's Polynesian Village Resort")).toBeTruthy();
    });

    // Tap the Polynesian search result row
    fireEvent.press(screen.getByText("Disney's Polynesian Village Resort"));

    // onSelect MUST NOT be called (which would add a plain experience item)
    expect(onSelect).not.toHaveBeenCalled();

    // The break card MUST now render the staged attached location
    await waitFor(() => {
      expect(screen.getByTestId('picker-staged-location')).toBeTruthy();
      expect(screen.getByText("📍 Disney's Polynesian Village Resort")).toBeTruthy();
    });

    // Press Add Break
    fireEvent.press(screen.getByTestId('picker-add-break-btn'));

    // onSelectUnlocatedBreak MUST be called with the staged experienceId attached
    expect(onSelectUnlocatedBreak).toHaveBeenCalledWith('Midday Break', 60, 'exp-resort-poly');
  });

  it('B5: displays visual confirmation feedback when a break is added', async () => {
    const onSelectUnlocatedBreak = jest.fn();
    renderPicker({ onSelectUnlocatedBreak });

    fireEvent.press(screen.getByTestId('picker-tab-breaks'));

    fireEvent.press(screen.getByTestId('picker-add-break-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('picker-break-feedback')).toBeTruthy();
      expect(screen.getByText('✓ Break Added!')).toBeTruthy();
    });
  });

  it('C1: queries category without requiring search input when non-All tab is selected', async () => {
    renderPicker();

    // Select Dining tab with empty search input
    fireEvent.press(screen.getByTestId('picker-tab-dining'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('/catalog?categories=Restaurant'));
    });
  });

  it('applies fillContainer styling to container and results when fillContainer is true', async () => {
    renderPicker({ fillContainer: true });

    const container = screen.getByTestId('picker-container');
    expect(container.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ flex: 1 })]),
    );

    fireEvent.changeText(screen.getByTestId('picker-search'), 'Magic');

    await waitFor(() => {
      const resultsScroll = screen.getByTestId('picker-results');
      expect(resultsScroll.props.style).toEqual(expect.objectContaining({ flex: 1 }));
    });
  });
});
