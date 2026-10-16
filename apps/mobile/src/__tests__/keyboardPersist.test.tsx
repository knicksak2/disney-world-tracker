import React from 'react';
import { ScrollView, FlatList, SectionList } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

import { ExpenseFormModal } from '../screens/trips/ExpenseFormModal';

describe('Global scroll defaults (setupScrollDefaults)', () => {
  it('automatically defaults ScrollView keyboardShouldPersistTaps to handled', () => {
    const { getByTestId } = render(<ScrollView testID="test-scroll" />);
    expect(getByTestId('test-scroll').props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('allows ScrollView to explicitly override to never', () => {
    const { getByTestId } = render(
      <ScrollView testID="test-scroll-never" keyboardShouldPersistTaps="never" />,
    );
    expect(getByTestId('test-scroll-never').props.keyboardShouldPersistTaps).toBe('never');
  });

  it('automatically defaults FlatList keyboardShouldPersistTaps to handled', () => {
    const { getByTestId } = render(
      <FlatList testID="test-flatlist" data={[]} renderItem={() => null} />,
    );
    expect(getByTestId('test-flatlist').props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('allows FlatList to explicitly override to always', () => {
    const { getByTestId } = render(
      <FlatList
        testID="test-flatlist-override"
        keyboardShouldPersistTaps="always"
        data={[]}
        renderItem={() => null}
      />,
    );
    expect(getByTestId('test-flatlist-override').props.keyboardShouldPersistTaps).toBe('always');
  });

  it('automatically defaults SectionList keyboardShouldPersistTaps to handled', () => {
    const { getByTestId } = render(
      <SectionList testID="test-sectionlist" sections={[]} renderItem={() => null} />,
    );
    expect(getByTestId('test-sectionlist').props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('renders ExpenseFormModal with keyboardShouldPersistTaps="handled" on its scroll container', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ExpenseFormModal
          visible={true}
          tripId="trip-1"
          members={[
            {
              userId: 'u1',
              displayName: 'Alice',
              avatarPreset: null,
              role: 'organizer',
            },
          ]}
          guests={[]}
          callerId="u1"
          onClose={jest.fn()}
        />
      </QueryClientProvider>,
    );

    const scroll = screen.getByTestId('expense-form-scroll');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });
});
