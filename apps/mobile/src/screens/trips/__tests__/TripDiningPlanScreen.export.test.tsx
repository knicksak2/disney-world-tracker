/**
 * TripDiningPlanScreen: import suggestion labels and the "Add to Trip Budget" sheet (dining-plan-calculator task 11.6),
 * rendered with the real screen, sheet and hooks; only the network layer (`apiRequest`) is mocked.
 *
 * Validates: Requirements 5.3, 5.8, 5.9, 26.1, 26.7, 26.9, 26.12.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiningBudgetExportBody, DiningBudgetExportResultDTO, DiningPlanDTO, DiningSuggestionDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { LIBERTY, PECOS, plan, result, scenario, TRIP_ID } from '../../../test/diningPlanFixtures';
import TripDiningPlanScreen from '../TripDiningPlanScreen';
import { budgetKeys } from '../budgetApi';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const PLAN_URL = `/trips/${TRIP_ID}/dining-plan`;
const EXPORT_URL = `${PLAN_URL}/export-to-budget`;
const PLAN_KEY = 'dining_plan:plan:implicit:2027-03-01';

const PREVIEW: DiningBudgetExportResultDTO = {
  created: 3,
  updated: 0,
  deleted: 0,
  lines: [
    { key: PLAN_KEY, lineId: null, description: 'Table-Service Dining Plan (Disney Resort)', category: 'dining', subtotalCents: 93_779 },
    { key: 'dining_plan:oop', lineId: null, description: 'Dining out of pocket (estimate)', category: 'dining', subtotalCents: 1_900 },
    { key: 'dining_plan:tips', lineId: null, description: 'Dining tips (estimate)', category: 'other', subtotalCents: 4_500 },
  ],
  warnings: [{ code: 'tax_rate_mismatch', calculatorTaxBps: 650, budgetTaxBps: 700 }],
};

// Every count differs, so a count shown in the wrong place is caught.
const DONE: DiningBudgetExportResultDTO = {
  created: 2,
  updated: 1,
  deleted: 3,
  lines: PREVIEW.lines.slice(0, 2).map((l, i) => ({ ...l, lineId: `70000000-0000-4000-8000-00000000000${i}` })),
  warnings: [],
};

type ScreenProps = React.ComponentProps<typeof TripDiningPlanScreen>;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(budgetKeys.detail(TRIP_ID), { lines: [] });
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true } as unknown as ScreenProps['navigation'];
  const route = { key: 'TripDiningPlan-1', name: 'TripDiningPlan', params: { tripId: TRIP_ID } } as ScreenProps['route'];
  render(
    <QueryClientProvider client={client}>
      <TripDiningPlanScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
  return { navigation, client };
}

function serve(initial: DiningPlanDTO, onExport: (body: DiningBudgetExportBody) => DiningBudgetExportResultDTO = (b) => (b.preview ? PREVIEW : DONE)) {
  mockApi.mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path === PLAN_URL) return initial;
    if (method === 'POST' && path === EXPORT_URL) return onExport(body as DiningBudgetExportBody);
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const exportCalls = () => mockApi.mock.calls.filter(([m, p]) => m === 'POST' && p === EXPORT_URL).map(([, , b]) => b);

async function openSheet(): Promise<void> {
  fireEvent.press(await screen.findByTestId('dining-tab-compare'));
  fireEvent.press(await screen.findByTestId('dining-export-open'));
  await screen.findByTestId('dining-export-preview');
}

beforeEach(() => mockApi.mockReset());

describe('import suggestions (Requirements 5.3, 5.8, 5.9)', () => {
  const suggestion = (o: Partial<DiningSuggestionDTO>): DiningSuggestionDTO => ({
    plannedItemId: '50000000-0000-4000-8000-000000000001',
    experienceId: PECOS,
    experienceName: 'Pecos Bill',
    date: '2027-03-04',
    mealPeriod: 'lunch',
    source: 'planned_item',
    partySizeMismatch: false,
    alreadyHasEntry: false,
    ...o,
  });

  it('labels each new suggestion Reservation or Planned, flags a party-size mismatch, and leaves out ones already planned', async () => {
    serve(
      plan({
        suggestions: [
          suggestion({}),
          suggestion({ plannedItemId: '50000000-0000-4000-8000-000000000002', experienceId: LIBERTY, experienceName: 'Liberty Tree Tavern', date: '2027-03-05', mealPeriod: 'dinner', source: 'reservation', partySizeMismatch: true }),
          suggestion({ plannedItemId: '50000000-0000-4000-8000-000000000003', experienceName: 'Casey’s Corner', alreadyHasEntry: true }),
        ],
      }),
    );
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-suggestions-review'));
    const planned = await screen.findByTestId('dining-suggestion-50000000-0000-4000-8000-000000000001');
    expect(within(planned).getByText('Pecos Bill, Thu, Mar 4, lunch')).toBeTruthy();
    expect(within(planned).getByText('Planned')).toBeTruthy();
    expect(screen.queryByTestId('dining-suggestion-mismatch-50000000-0000-4000-8000-000000000001')).toBeNull();

    const reservation = screen.getByTestId('dining-suggestion-50000000-0000-4000-8000-000000000002');
    expect(within(reservation).getByText('Liberty Tree Tavern, Fri, Mar 5, dinner')).toBeTruthy();
    expect(within(reservation).getByText('Reservation')).toBeTruthy();
    expect(within(reservation).getByText('The reservation is for fewer people than your party')).toBeTruthy();

    expect(screen.queryByTestId('dining-suggestion-50000000-0000-4000-8000-000000000003')).toBeNull();
    expect(within(screen.getByTestId('dining-import')).getByText('Add 2 reservations')).toBeTruthy();
  });

  it('says how many planned restaurants have no meal time, even with nothing to import', async () => {
    serve(plan({ suggestions: [], suggestionsNeedingMealPeriod: 2 }));
    renderScreen();
    expect(await screen.findByText('2 planned restaurants have no meal time; add them by hand')).toBeTruthy();
    expect(screen.queryByTestId('dining-import')).toBeNull();
  });

  it('shows no note when every planned restaurant has a meal time', async () => {
    serve(plan());
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    expect(screen.queryByTestId('dining-needs-meal-time')).toBeNull();
  });
});

describe('Add to Trip Budget (Requirement 26.12)', () => {
  it('opening the sheet posts a preview and lists each line with its category and amount, the note and the warning', async () => {
    serve(plan());
    renderScreen();
    await openSheet();

    expect(exportCalls()).toEqual([{ include: ['plan', 'out_of_pocket', 'tips'], preview: true }]);
    const planLine = screen.getByTestId(`dining-export-line-${PLAN_KEY}`);
    expect(within(planLine).getByText('Table-Service Dining Plan (Disney Resort)')).toBeTruthy();
    expect(within(planLine).getByText('Dining & Snacks')).toBeTruthy();
    expect(within(planLine).getByText('$937.79')).toBeTruthy();
    expect(within(screen.getByTestId('dining-export-group-plan')).getByTestId(`dining-export-line-${PLAN_KEY}`)).toBeTruthy();
    const tips = screen.getByTestId('dining-export-line-dining_plan:tips');
    expect(within(tips).getByText('Other & Extras')).toBeTruthy();
    expect(within(tips).getByText('$45.00')).toBeTruthy();
    expect(within(screen.getByTestId('dining-export-group-tips')).getByTestId('dining-export-line-dining_plan:tips')).toBeTruthy();

    expect(within(screen.getByTestId('dining-export-replace-note')).getByText(
      'Adding again later updates these same Budget lines. Changes you make to them in the Budget will be overwritten.',
    )).toBeTruthy();
    expect(within(screen.getByTestId('dining-export-warning-tax_rate_mismatch')).getByText(
      "The Budget taxes dining at 7% and the calculator used 6.5%, so the Budget's totals will differ slightly.",
    )).toBeTruthy();
    // Nothing is written by the preview.
    expect(exportCalls().every((b) => (b as DiningBudgetExportBody).preview)).toBe(true);
  });

  it('unchecking tips and confirming posts include plan and out_of_pocket, shows the counts, and refreshes the Budget', async () => {
    serve(plan());
    const { client, navigation } = renderScreen();
    await openSheet();
    expect(screen.getByTestId('dining-export-include-tips').props.accessibilityState).toEqual({ checked: true });

    fireEvent.press(screen.getByTestId('dining-export-include-tips'));
    expect(screen.getByTestId('dining-export-include-tips').props.accessibilityState).toEqual({ checked: false });
    fireEvent.press(screen.getByTestId('dining-export-confirm'));

    expect(await screen.findByText('2 lines added, 1 updated, 3 removed.')).toBeTruthy();
    expect(exportCalls()[1]).toEqual({ include: ['plan', 'out_of_pocket'], preview: false });
    await waitFor(() => expect(client.getQueryState(budgetKeys.detail(TRIP_ID))?.isInvalidated).toBe(true));

    fireEvent.press(screen.getByTestId('dining-export-open-budget'));
    expect(navigation.navigate).toHaveBeenCalledWith('TripBudget', { tripId: TRIP_ID });
    expect(screen.queryByTestId('dining-export-sheet')).toBeNull();
  });

  it('a rejected export shows the error and keeps the sheet open with its choices', async () => {
    serve(plan(), (b) => {
      if (b.preview) return PREVIEW;
      throw new Error('You cannot change this trip\u2019s Budget.');
    });
    const { client } = renderScreen();
    await openSheet();
    fireEvent.press(screen.getByTestId('dining-export-include-plan'));
    fireEvent.press(screen.getByTestId('dining-export-confirm'));

    expect(await screen.findByText('You cannot change this trip\u2019s Budget.')).toBeTruthy();
    expect(screen.getByTestId('dining-export-sheet')).toBeTruthy();
    expect(screen.getByTestId('dining-export-preview')).toBeTruthy();
    expect(screen.queryByTestId('dining-export-done')).toBeNull();
    expect(screen.getByTestId('dining-export-include-plan').props.accessibilityState).toEqual({ checked: false });
    expect(client.getQueryState(budgetKeys.detail(TRIP_ID))?.isInvalidated).toBe(false);
  });

  it('a failed preview shows the error and offers nothing to confirm', async () => {
    serve(plan(), () => {
      throw new Error('Something went wrong loading the Budget.');
    });
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-tab-compare'));
    fireEvent.press(await screen.findByTestId('dining-export-open'));
    expect(await screen.findByText('Something went wrong loading the Budget.')).toBeTruthy();
    expect(screen.queryByTestId('dining-export-confirm')).toBeNull();
  });

  it('cannot confirm with every group unchecked', async () => {
    serve(plan());
    renderScreen();
    await openSheet();
    for (const g of ['plan', 'out_of_pocket', 'tips']) fireEvent.press(screen.getByTestId(`dining-export-include-${g}`));
    expect(screen.getByTestId('dining-export-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('dining-export-confirm'));
    expect(exportCalls()).toHaveLength(1);
  });

  it('closing the sheet writes nothing', async () => {
    serve(plan());
    renderScreen();
    await openSheet();
    fireEvent.press(screen.getByTestId('dining-export-close'));
    expect(screen.queryByTestId('dining-export-sheet')).toBeNull();
    expect(exportCalls()).toHaveLength(1);
  });

  it('offers no export when no plan is available and nothing is paid out of pocket', async () => {
    const nothing = scenario({ foodOutOfPocketCents: 0, taxCents: 0, tipCents: 0, snackOutOfPocketCents: 0, mugOutOfPocketCents: 0, totalCents: 0, meals: [] });
    serve(
      plan({
        entries: [],
        result: result({
          verdict: 'plan_unavailable',
          recommended: 'none',
          bestPlan: null,
          scenarios: [nothing, scenario({ code: 'table_service', available: false, unavailableReason: 'not_disney_resort', meals: [] })],
        }),
      }),
    );
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(screen.queryByTestId('dining-export-open')).toBeNull();
  });
});
