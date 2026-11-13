/**
 * DiningPlanCalculatorScreen (dining-plan-calculator tasks 11.4 & 14.5): the real 4-tab standalone screen with the
 * real sheets, picker and date fields; only `apiRequest` is mocked, and timers are fake for exact debounce tests.
 *
 * Validates: Requirements 1.2, 3.8, 20.1–20.4, 27.
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiningCalculateBody, DiningPlanResultDTO, ExperienceDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { LIBERTY, result } from '../../../test/diningPlanFixtures';
import DiningPlanCalculatorScreen from '../DiningPlanCalculatorScreen';
import { CALCULATOR_DEFAULT_SETTINGS } from '../diningCalculatorBody';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const CALC = '/dining-plan/calculate';

const RESTAURANT = {
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

type ScreenProps = React.ComponentProps<typeof DiningPlanCalculatorScreen>;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true } as unknown as ScreenProps['navigation'];
  const route = { key: 'DiningPlanCalculator-1', name: 'DiningPlanCalculator', params: undefined } as ScreenProps['route'];
  render(
    <QueryClientProvider client={client}>
      <DiningPlanCalculatorScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
  return { navigation };
}

function serve(answer: DiningPlanResultDTO | ((body: DiningCalculateBody) => Promise<DiningPlanResultDTO>) = result()) {
  mockApi.mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path.startsWith('/catalog')) return { experiences: [RESTAURANT] };
    if (method === 'POST' && path === CALC) return typeof answer === 'function' ? answer(body as DiningCalculateBody) : answer;
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const posts = () => mockApi.mock.calls.filter(([m, p]) => m === 'POST' && p === CALC);
const lastBody = () => posts().at(-1)![2] as DiningCalculateBody;

function pickDate(testID: string, date: string): void {
  fireEvent.press(screen.getByTestId(testID));
  const calendar = screen.UNSAFE_getByProps({ testID: `${testID}-calendar-view` });
  act(() => {
    (calendar.props as { onDayPress: (d: { dateString: string }) => void }).onDayPress({ dateString: date });
  });
}

async function settle(ms = 400): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockApi.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DiningPlanCalculatorScreen', () => {
  it('says the entries are not saved and asks for dates before calculating', async () => {
    serve();
    renderScreen();
    expect(screen.getByTestId('dining-calc-not-saved')).toBeTruthy();
    expect(screen.getByText('Your entries are not saved. They stay on this screen only and are not added to any trip.')).toBeTruthy();
    expect(screen.getByText('Choose your check-in and check-out dates to see the comparison.')).toBeTruthy();
    await settle(2_000);
    expect(posts()).toHaveLength(0);
  });

  it('three quick edits post exactly once, 400 ms after the last, with the assembled body, and render the 4-tab answer', async () => {
    serve();
    renderScreen();

    pickDate('dining-calc-check-in', '2027-03-01');
    fireEvent.press(screen.getByTestId('dining-calc-adults-up'));
    pickDate('dining-calc-check-out', '2027-03-06');

    await settle(399);
    expect(posts()).toHaveLength(0);
    await settle(1);
    expect(posts()).toHaveLength(1);
    expect(lastBody()).toEqual({
      party: [
        { key: 'g:a1', label: 'Adult 1', ageBracket: 'adult', passType: 'none' },
        { key: 'g:a2', label: 'Adult 2', ageBracket: 'adult', passType: 'none' },
        { key: 'g:a3', label: 'Adult 3', ageBracket: 'adult', passType: 'none' },
      ],
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-06' },
      settings: { ...CALCULATOR_DEFAULT_SETTINGS, stay: null },
      entries: [],
    });

    expect(screen.getByTestId('dining-verdict-title').props.children).toBe('Saves about $299.99');
    expect(screen.queryByTestId('dining-disclaimer')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    expect(screen.getByTestId('dining-disclaimer')).toBeTruthy();
    expect(screen.getByTestId('dining-slot-2027-03-06-dinner')).toBeTruthy();
    expect(screen.queryByTestId('dining-slot-2027-03-07-dinner')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    const shown = await screen.findByTestId('dining-calc-result');
    expect(within(shown).getByTestId('dining-compare-row-table_service')).toBeTruthy();
    expect(within(screen.getByTestId('dining-compare-row-table_service')).getByText('Recommended')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dining-compare-toggle-none'));
    expect(within(screen.getByTestId('dining-compare-row-none')).getAllByText('$999.99').length).toBeGreaterThanOrEqual(1);

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    const credits = screen.getByTestId('dining-credit-summary');
    expect(within(credits).getByLabelText('Table-Service: 10 for the party, 4 used, 6 left over')).toBeTruthy();
    expect(within(credits).getByText('4 / 10')).toBeTruthy();
  });

  it('keeps meals, settings, stay type and pass holder in local state and sends each in the next request only', async () => {
    serve();
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-03-03');
    await settle();
    expect(posts()).toHaveLength(1);

    // A typical table-service meal.
    fireEvent.press(screen.getByTestId('dining-slot-2027-03-02-dinner'));
    fireEvent.press(screen.getByTestId('dining-slot-choice-table_service'));
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await settle();
    expect(posts()).toHaveLength(2);
    expect(lastBody().entries).toEqual([{ date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys: [] }]);
    expect(within(screen.getByTestId('dining-slot-2027-03-02-dinner')).getByText('Typical table-service meal')).toBeTruthy();

    // Eating style, stay type, and pass holder inline from Settings tab.
    fireEvent.press(screen.getByTestId('dining-calc-open-settings'));
    expect(screen.queryByTestId('dining-settings-custom-dates')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-settings-order-splurge'));
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await settle();
    expect(posts()).toHaveLength(3);
    expect(lastBody().settings.orderStyle).toBe('splurge');

    fireEvent.press(screen.getByTestId('dining-tab-settings'));
    fireEvent.press(screen.getByTestId('dining-calc-stay-type-not_disney_resort'));
    await settle();
    expect(posts()).toHaveLength(4);
    expect(lastBody().settings.stayType).toBe('not_disney_resort');

    fireEvent.press(screen.getByTestId('dining-calc-pass-holder'));
    await settle();
    expect(posts()).toHaveLength(5);
    expect(lastBody().party.map((p) => p.passType)).toEqual(['annual_pass', 'none']);

    // Clearing the meal.
    fireEvent.press(screen.getByTestId('dining-tab-meals'));
    fireEvent.press(screen.getByTestId('dining-slot-2027-03-02-dinner'));
    fireEvent.press(screen.getByTestId('dining-slot-clear'));
    await settle();
    expect(posts()).toHaveLength(6);
    expect(lastBody().entries).toEqual([]);
    expect(within(screen.getByTestId('dining-slot-2027-03-02-dinner')).getByText('+ Add')).toBeTruthy();

    expect(mockApi.mock.calls.every(([m, p]) => (m === 'POST' && p === CALC) || (m === 'GET' && p.startsWith('/catalog')))).toBe(true);
  });

  it('shows a chosen restaurant by name in the grid and sends only its id', async () => {
    serve();
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-03-02');
    await settle();

    fireEvent.press(screen.getByTestId('dining-slot-2027-03-02-dinner'));
    fireEvent.press(screen.getByTestId('dining-slot-change-restaurant'));
    fireEvent.changeText(screen.getByTestId('dining-slot-picker-search'), 'Liberty');
    await settle(1_000);
    fireEvent.press(await screen.findByTestId(`dining-slot-picker-result-${LIBERTY}`));
    fireEvent.press(screen.getByTestId('dining-slot-save'));
    await settle();

    expect(within(screen.getByTestId('dining-slot-2027-03-02-dinner')).getByText('Liberty Tree Tavern')).toBeTruthy();
    expect(lastBody().entries).toEqual([{ date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: LIBERTY, placeholderKind: null, excludedKeys: [] }]);
  });

  it('shows only the newest answer when an older request returns late', async () => {
    let releaseFirst: (r: DiningPlanResultDTO) => void = () => undefined;
    let call = 0;
    serve(
      () =>
        new Promise<DiningPlanResultDTO>((resolve) => {
          call += 1;
          if (call === 1) releaseFirst = resolve;
          else resolve(result());
        }),
    );
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-03-06');
    await settle();
    fireEvent.press(screen.getByTestId('dining-calc-open-settings'));
    fireEvent.press(screen.getByTestId('dining-calc-adults-up'));
    await settle();
    expect(posts()).toHaveLength(2);
    expect(screen.getByTestId('dining-verdict-title').props.children).toBe('Saves about $299.99');

    await act(async () => {
      releaseFirst(result({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 700 }));
    });
    expect(screen.getByTestId('dining-verdict-title').props.children).toBe('Saves about $299.99');
  });

  it('shows a failed calculation in words, and Try again posts again', async () => {
    let fail = true;
    serve(async () => {
      if (fail) throw new Error('The calculator is busy. Please try again.');
      return result();
    });
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-03-06');
    await settle();
    expect(within(screen.getByTestId('dining-calc-error')).getByText('The calculator is busy. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('dining-verdict')).toBeNull();

    fail = false;
    fireEvent.press(screen.getByTestId('dining-calc-retry'));
    await settle();
    expect(posts()).toHaveLength(2);
    expect(screen.queryByTestId('dining-calc-error')).toBeNull();
    expect(screen.getByTestId('dining-verdict')).toBeTruthy();
  });

  it('does not calculate a stay over 30 nights, check-out before check-in, or an empty party', async () => {
    serve();
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-04-01');
    await settle();
    expect(screen.getByText('The calculator handles stays of up to 30 nights.')).toBeTruthy();

    pickDate('dining-calc-check-in', '2027-04-05');
    await settle();
    expect(screen.getByText('Check-out must not be before check-in.')).toBeTruthy();

    pickDate('dining-calc-check-in', '2027-03-28');
    fireEvent.press(screen.getByTestId('dining-tab-settings'));
    fireEvent.press(screen.getByTestId('dining-calc-adults-down'));
    fireEvent.press(screen.getByTestId('dining-calc-adults-down'));
    await settle();
    expect(screen.getByText('Add at least one person.')).toBeTruthy();
    expect(posts()).toHaveLength(0);

    fireEvent.press(screen.getByTestId('dining-calc-children-up'));
    await settle();
    expect(posts()).toHaveLength(1);
    expect(lastBody().party).toEqual([{ key: 'g:c1', label: 'Child 1', ageBracket: 'child', passType: 'none' }]);
  });

  it('hides an earlier answer once the form can no longer be calculated', async () => {
    serve();
    renderScreen();
    pickDate('dining-calc-check-in', '2027-03-01');
    pickDate('dining-calc-check-out', '2027-03-06');
    await settle();
    expect(screen.getByTestId('dining-verdict')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-tab-settings'));
    pickDate('dining-calc-check-out', '2027-04-15');
    expect(screen.queryByTestId('dining-verdict')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-tab-meals'));
    expect(screen.getByText('The calculator handles stays of up to 30 nights.')).toBeTruthy();
    await settle();
    expect(posts()).toHaveLength(1);
  });

  it('goes back from the header', () => {
    serve();
    const { navigation } = renderScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
