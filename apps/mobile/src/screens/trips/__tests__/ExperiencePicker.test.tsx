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
    expect(screen.queryByText('Space Mountain')).toBeNull();
    expect(screen.getByText('Be Our Guest')).toBeTruthy();
    expect(screen.queryByText('Festival of the Lion King')).toBeNull();

    // Tap Shows tab
    fireEvent.press(screen.getByTestId('picker-tab-shows'));
    expect(screen.queryByText('Space Mountain')).toBeNull();
    expect(screen.queryByText('Be Our Guest')).toBeNull();
    expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
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

    expect(onSelectUnlocatedBreak).toHaveBeenCalledWith('Resort Pool & Rest', 60);
  });
});
