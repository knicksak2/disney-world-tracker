/**
 * DiningSlotSheet (dining-plan-calculator task 11.2), rendered with the real component and the real ExperiencePicker;
 * only the network layer (`apiRequest`) is mocked. The sheet is driven through the real entry hooks, so each action
 * asserts the request it sends.
 *
 * Validates: Requirements 4.1, 4.2, 4.4, 4.5, 19.3, 19.4, 22.2.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiningEntryDTO, ExperienceDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { ALEX_KEY, BLAIR_KEY, KIT_KEY, LIBERTY, plan, TRIP_ID } from '../../../test/diningPlanFixtures';
import { DiningSlotSheet } from '../DiningSlotSheet';
import { useDeleteDiningEntry, usePutDiningEntry } from '../diningPlanApi';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;

const RESTAURANT: ExperienceDTO = {
  id: LIBERTY,
  name: 'Liberty Tree Tavern',
  category: 'Restaurant',
  park: 'Magic Kingdom',
  land: 'Liberty Square',
  subType: 'Table Service',
  description: '',
  active: true,
  imageUrl: null,
  areaType: 'ThemePark',
} as ExperienceDTO;

const PARTY = [...plan().party, { key: 'g:baby', label: 'Bo', ageBracket: 'under3' as const, passType: 'none' as const }];
const ENTRY_URL = `/trips/${TRIP_ID}/dining-plan/entries/2027-03-02/dinner`;

function Harness({ entry, onClose = jest.fn() }: { entry?: DiningEntryDTO; onClose?: () => void }) {
  const put = usePutDiningEntry(TRIP_ID);
  const del = useDeleteDiningEntry(TRIP_ID);
  const slot = { date: '2027-03-02', mealPeriod: 'dinner' as const };
  return (
    <DiningSlotSheet
      visible
      date="2027-03-02"
      mealPeriod="dinner"
      entry={entry}
      party={PARTY}
      onSave={(body) => put.mutateAsync({ slot, entry: body })}
      {...(entry === undefined ? {} : { onClear: () => del.mutateAsync(slot) })}
      onClose={onClose}
    />
  );
}

function renderSheet(props: { entry?: DiningEntryDTO; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation(async (method, path) => {
    if (method === 'GET' && path.startsWith('/catalog')) return { experiences: [RESTAURANT] };
    return plan();
  });
});

describe('DiningSlotSheet', () => {
  it('announces the slot and lists only diners aged 3 and over', () => {
    renderSheet();
    expect(screen.getByText('Dinner · Tue, Mar 2')).toBeTruthy();
    expect(screen.getByTestId(`dining-slot-diner-${ALEX_KEY}`)).toBeTruthy();
    expect(screen.getByTestId(`dining-slot-diner-${KIT_KEY}`)).toBeTruthy();
    expect(screen.queryByTestId('dining-slot-diner-g:baby')).toBeNull();
    // Nothing chosen yet: Save is disabled.
    expect(screen.getByTestId('dining-slot-action').props.accessibilityState).toEqual({ disabled: true });
  });

  it('searches, picks a restaurant and saves a restaurant entry', async () => {
    const onClose = jest.fn();
    renderSheet({ onClose });
    fireEvent.press(screen.getByTestId('dining-slot-change-restaurant'));
    fireEvent.changeText(screen.getByTestId('dining-slot-picker-search'), 'Liberty');
    await waitFor(() => expect(screen.getByTestId(`dining-slot-picker-result-${LIBERTY}`)).toBeTruthy());
    // The picker searched the Restaurant category only.
    expect(mockApi).toHaveBeenCalledWith('GET', expect.stringContaining('categories=Restaurant'));
    fireEvent.press(screen.getByTestId(`dining-slot-picker-result-${LIBERTY}`));
    expect(screen.getByTestId('dining-slot-selected')).toHaveTextContent('Chosen: Liberty Tree Tavern');
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi).toHaveBeenCalledWith('PUT', ENTRY_URL, { kind: 'restaurant', experienceId: LIBERTY, placeholderKind: null, excludedKeys: [] });
  });

  it('saves a typical table-service meal as a placeholder', async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('dining-slot-choice-table_service'));
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', ENTRY_URL, { kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys: [] }));
  });

  it('saves a skipped meal', async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('dining-slot-choice-skip'));
    expect(screen.queryByTestId(`dining-slot-diner-${ALEX_KEY}`)).toBeNull();
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', ENTRY_URL, { kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] }));
  });

  it('sends the unticked diners as excludedKeys', async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('dining-slot-choice-quick_service'));
    const blair = screen.getByTestId(`dining-slot-diner-${BLAIR_KEY}`);
    expect(blair.props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(blair);
    expect(screen.getByTestId(`dining-slot-diner-${BLAIR_KEY}`).props.accessibilityState).toEqual({ checked: false });
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', ENTRY_URL, { kind: 'placeholder', experienceId: null, placeholderKind: 'quick_service', excludedKeys: [BLAIR_KEY] }));
  });

  it('opens on the existing entry and Clear sends DELETE', async () => {
    const onClose = jest.fn();
    const existing = plan().entries[0]!;
    renderSheet({ entry: { ...existing, excludedKeys: [KIT_KEY] }, onClose });
    expect(screen.getByTestId('dining-slot-selected')).toHaveTextContent('Chosen: Liberty Tree Tavern');
    expect(screen.queryByTestId('dining-slot-picker-search')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-slot-change-restaurant'));
    expect(screen.getByTestId('dining-slot-picker-search')).toBeTruthy();
    expect(screen.getByTestId('dining-slot-picker-park-filters')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dining-slot-picker-back'));
    expect(screen.queryByTestId('dining-slot-picker-search')).toBeNull();
    expect(screen.getByTestId(`dining-slot-diner-${KIT_KEY}`).props.accessibilityState).toEqual({ checked: false });
    fireEvent.press(screen.getByTestId('dining-slot-clear'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi).toHaveBeenCalledWith('DELETE', ENTRY_URL);
  });

  it('shows a refused save in words and stays open', async () => {
    const onClose = jest.fn();
    mockApi.mockImplementation(async (method) => {
      if (method === 'PUT') throw new Error('Choose an open restaurant from the catalog.');
      return plan();
    });
    renderSheet({ onClose });
    fireEvent.press(screen.getByTestId('dining-slot-choice-skip'));
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(screen.getByTestId('dining-slot-error')).toHaveTextContent('Choose an open restaurant from the catalog.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // Task 11.4: the standalone calculator keeps entries locally, so it needs the chosen name; the body never has it.
  it('hands the chosen restaurant name to onSave beside the body, and null for other choices', async () => {
    const onSave = jest.fn(async () => undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DiningSlotSheet visible date="2027-03-02" mealPeriod="dinner" entry={plan().entries[0]} party={PARTY} onSave={onSave} onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        { kind: 'restaurant', experienceId: LIBERTY, placeholderKind: null, excludedKeys: [] },
        { experienceName: 'Liberty Tree Tavern' },
      ),
    );
    fireEvent.press(screen.getByTestId('dining-slot-choice-skip'));
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] }, { experienceName: null }));
  });
});
