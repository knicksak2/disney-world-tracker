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
    entityType: 'Attraction',
  } as unknown as ExperienceDTO,
  {
    id: 'exp-dining-1',
    name: 'Be Our Guest',
    category: 'Restaurant',
    park: 'Magic Kingdom',
    land: 'Fantasyland',
    entityType: 'Restaurant',
  } as unknown as ExperienceDTO,
  {
    id: 'exp-show-1',
    name: 'Festival of the Lion King',
    category: 'Show',
    park: 'Animal Kingdom',
    land: 'Africa',
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

  it('filters experiences by category when tabs are clicked', async () => {
    renderPicker();

    fireEvent.changeText(screen.getByTestId('picker-search'), 'Magic');

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
      expect(screen.getByText('Be Our Guest')).toBeTruthy();
      expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
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
    });
    expect(screen.queryByText('Space Mountain')).toBeNull();
    expect(screen.queryByText('Be Our Guest')).toBeNull();
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
      expect(apiRequest).toHaveBeenCalledWith('GET', expect.stringContaining('/catalog?category=Restaurant'));
    });
  });
});

