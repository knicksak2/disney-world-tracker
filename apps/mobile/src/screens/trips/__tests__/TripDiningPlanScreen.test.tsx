/**
 * TripDiningPlanScreen (dining-plan-calculator tasks 11.3 & 14.5), rendered with the real 4-tab screen, Resort
 * Chapters, slot sheet, inline settings form, and query hooks; only `apiRequest` is mocked.
 *
 * Validates: Requirements 5.4, 14.3, 14.5, 15.3, 15.4, 15.6, 19.2–19.9, 21.1–21.3, 22.1, 22.2, 27.1–27.8;
 * Property 45 (screen half).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiningPlanDTO, DiningPlanResultDTO, DiningSuggestionDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { LIBERTY, line, PECOS, plan, result, scenario, TRIP_ID } from '../../../test/diningPlanFixtures';
import TripDiningPlanScreen from '../TripDiningPlanScreen';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const PLAN_URL = `/trips/${TRIP_ID}/dining-plan`;

type ScreenProps = React.ComponentProps<typeof TripDiningPlanScreen>;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true } as unknown as ScreenProps['navigation'];
  const route = { key: 'TripDiningPlan-1', name: 'TripDiningPlan', params: { tripId: TRIP_ID } } as ScreenProps['route'];
  render(
    <QueryClientProvider client={client}>
      <TripDiningPlanScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
  return { navigation };
}

/** Serve `GET` with `initial`, the catalog search with nothing, and every other call through `onWrite`. */
function serve(initial: DiningPlanDTO, onWrite: (method: string, path: string, body: unknown) => unknown = () => initial) {
  mockApi.mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path === PLAN_URL) return initial;
    if (method === 'GET' && path.startsWith('/catalog')) return { experiences: [] };
    return onWrite(method, path, body);
  });
}

function withResult(r: Partial<DiningPlanResultDTO>): DiningPlanDTO {
  return plan({ result: result(r) });
}

function testIdOrder(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: { testID?: string }; children?: unknown };
    if (typeof n.props?.testID === 'string') out.push(n.props.testID);
    walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}

const verdictTitle = () => screen.getByTestId('dining-verdict-title').props.children as string;

beforeEach(() => {
  mockApi.mockReset();
});

describe('TripDiningPlanScreen: 4-tab layout & server figures (Requirement 27)', () => {
  it('shows the sticky 2-line verdict + disclaimer above the 4-tab bar and Meals tab first', async () => {
    serve(plan());
    renderScreen();
    await screen.findByTestId('dining-plan-screen');

    expect(verdictTitle()).toBe('Saves about $299.99');
    expect(screen.getByTestId('dining-verdict-best').props.children[0]).toBe('Best: Table-Service Dining Plan');
    expect(screen.getByTestId('dining-verdict-total').props.children).toBe('Total $700.00');
    expect(screen.getByText('3 guests · Mar 1–6 (5n)')).toBeTruthy();
    expect(within(screen.getByTestId('dining-open-settings')).getByText('Typical · 18% tip')).toBeTruthy();
    expect(screen.queryByTestId('dining-disclaimer')).toBeNull();

    // Sticky top precedes tab bar and active Meals grid.
    const order = testIdOrder();
    expect(order.indexOf('dining-verdict')).toBeLessThan(order.indexOf('dining-tab-bar'));
    expect(order.indexOf('dining-tab-bar')).toBeLessThan(order.indexOf('dining-meal-grid'));

    // Why? drawer expands mini-stats, verdict detail, and disclaimer.
    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    expect(screen.getByTestId('dining-disclaimer').props.children).toBe(
      'Estimate only. Not affiliated with or endorsed by Disney. Plan prices and rules change; confirm in the Disney booking flow before you buy.',
    );
    expect(screen.getByTestId('dining-verdict-detail').props.children).toBe(
      'Compared with paying for the meals you listed yourself, tax and tips included.',
    );
    expect(within(screen.getByTestId('dining-verdict-mini-none')).getByText('No Plan')).toBeTruthy();
    expect(within(screen.getByTestId('dining-verdict-mini-quick_service')).getByText('All QS Plan')).toBeTruthy();
    expect(within(screen.getByTestId('dining-verdict-mini-table_service')).getByText('★ All Dining')).toBeTruthy();

    // Meals tab shows Resort Chapter grid, filter pill counts, and compact credit badges.
    expect(within(screen.getByTestId('dining-filter-all')).getByText('All Days (1)')).toBeTruthy();
    expect(within(screen.getByTestId('dining-filter-credits')).getByText('Use Credits (1)')).toBeTruthy();
    expect(within(screen.getByTestId('dining-filter-cash')).getByText('Pay Cash (0)')).toBeTruthy();
    expect(within(screen.getByTestId('dining-slot-2027-03-02-dinner')).getByText('1 TS')).toBeTruthy();
  });

  it('filters slots & days with Use Credits and Pay Cash pills on Meals tab', async () => {
    serve(plan());
    renderScreen();
    await screen.findByTestId('dining-meal-grid');

    // Only 2027-03-02 dinner (Use plan) & 2027-03-03 lunch (Partly covered) match credits.
    fireEvent.press(screen.getByTestId('dining-filter-credits'));
    expect(screen.getByTestId('dining-slot-2027-03-02-dinner')).toBeTruthy();
    expect(screen.getByTestId('dining-slot-2027-03-03-lunch')).toBeTruthy();
    expect(screen.queryByTestId('dining-slot-2027-03-01-dinner')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-filter-all'));
    expect(screen.getByTestId('dining-slot-2027-03-01-dinner')).toBeTruthy();
  });

  it('renders Compare tab with expanded recommended ledger, collapsible No Plan ledger, and unavailable reasons', async () => {
    serve(plan());
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-tab-compare'));

    const ts = screen.getByTestId('dining-compare-row-table_service');
    expect(within(ts).getAllByText('$700.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('dining-compare-net-table_service').props.children).toBe('Saves $299.99');
    expect(within(ts).getByText('Price not yet verified')).toBeTruthy();
    expect(within(ts).getByText('Recommended')).toBeTruthy();
    expect(screen.getByTestId('dining-compare-ledger-table_service')).toBeTruthy();

    // Non-recommended No Dining Plan starts collapsed and expands on tap.
    expect(screen.queryByTestId('dining-compare-ledger-none')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-compare-toggle-none'));
    const none = screen.getByTestId('dining-compare-row-none');
    expect(within(none).getByText('$250.00')).toBeTruthy();
    expect(within(none).getAllByText('$999.99').length).toBeGreaterThanOrEqual(1);

    expect(screen.queryByTestId('dining-compare-recommended-quick_service')).toBeNull();
    expect(screen.queryByTestId('dining-compare-recommended-none')).toBeNull();

    const deluxe = screen.getByTestId('dining-compare-unavailable-deluxe');
    expect(within(deluxe).getByText('Not available. There is no price for this plan on some of your dates.')).toBeTruthy();
  });

  it('renders Credits tab with meters, sensitivity, collapsible About these figures, and calendar jump', async () => {
    serve(withResult({ assumptions: { ...result().assumptions, passDiscountBps: 1_000 } }));
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-tab-credits'));

    const credits = screen.getByTestId('dining-credit-summary');
    expect(within(credits).getByText('Credits with the Table-Service Dining Plan')).toBeTruthy();
    expect(within(credits).getByLabelText('Table-Service: 10 for the party, 4 used, 6 left over')).toBeTruthy();
    expect(within(credits).getByText('4 / 10')).toBeTruthy();
    expect(within(screen.getByTestId('dining-sensitivity-typical')).getByText(/\(your setting\)/)).toBeTruthy();
    expect(within(screen.getByTestId('dining-sensitivity-max_value')).getByText('Deluxe Table-Service Dining Plan: Saves $520.00')).toBeTruthy();

    // About these figures starts collapsed in Credits and expands on tap.
    expect(screen.queryByTestId('dining-prices-as-of')).toBeNull();
    fireEvent.press(screen.getByTestId('dining-about-figures-toggle'));
    const about = screen.getByTestId('dining-about-figures');
    expect(screen.getByTestId('dining-prices-as-of').props.children).toBe('Plan prices as of 2026-11-09.');
    expect(screen.getByTestId('dining-rates').props.children).toBe('Tax 6.50% (default), tip 18% (default).');
    expect(within(about).getByText('Guests under 3 are not priced.')).toBeTruthy();
    expect(within(about).getByText('Buffets and fixed-price meals are counted at their set price, with no separate drink or alcohol added.')).toBeTruthy();
    expect(within(about).getByText(/A pass holder discount of 10%/)).toBeTruthy();

    // Jump to Meals calendar with Use Credits active.
    fireEvent.press(screen.getByTestId('dining-jump-to-credits'));
    expect(screen.getByTestId('dining-pane-meals')).toBeTruthy();
    expect(screen.getByTestId('dining-filter-credits').props.accessibilityState?.selected).toBe(true);
  });

  it('says nothing about a pass discount when none applies', async () => {
    serve(plan());
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-tab-credits'));
    fireEvent.press(screen.getByTestId('dining-about-figures-toggle'));
    expect(screen.queryByTestId('dining-pass-discount')).toBeNull();
  });

  it.each([
    ['estimatedEntries', 'Some figures are estimates: 2 meals are priced from an estimate.'],
    ['unverifiedRules', 'Some figures are estimates: 2 meals use an unverified credit rule.'],
    ['unverifiedPrices', 'Some figures are estimates: 2 plan prices are not yet verified.'],
  ] as const)('shows the quality notice in Why? / Compare and "Estimated" headline when %s is above zero', async (key, text) => {
    serve(withResult({ dataQuality: { ...result().dataQuality, [key]: 2 } }));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    expect(verdictTitle()).toBe('Estimated: Saves about $299.99');

    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    const notice = screen.getByTestId('dining-quality-notice');
    expect(within(notice).getByText(text)).toBeTruthy();

    // Switching to Compare while Why? is open keeps a single notice (inside Why?, not duplicated in Compare).
    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(screen.getAllByTestId('dining-quality-notice')).toHaveLength(1);
    // Collapsing Why? hides the notice instead of showing a duplicate banner on Compare.
    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    expect(screen.queryByTestId('dining-quality-notice')).toBeNull();
  });

  it('shows derived rules only as the secondary line: no notice and no "Estimated"', async () => {
    serve(withResult({ dataQuality: { ...result().dataQuality, derivedRules: 3 } }));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    expect(verdictTitle()).not.toContain('Estimated');
    expect(screen.queryByText(/Estimated/)).toBeNull();

    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    expect(screen.queryByTestId('dining-quality-notice')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    fireEvent.press(screen.getByTestId('dining-about-figures-toggle'));
    expect(screen.getByTestId('dining-derived-line').props.children).toBe('3 restaurants use the standard rules: one credit per meal.');
  });

  it('shows server meal reasons, partial coverage, and badges inside DiningSlotSheet on tap', async () => {
    const meals = [
      line({ twoCredit: true, creditCost: 2, gratuityIncluded: true, basis: 'tier_estimate', unverifiedRule: true, ruleBasis: 'unverified' }),
      line({
        date: '2027-03-03',
        mealPeriod: 'dinner',
        twoCredit: true,
        creditCost: 2,
        action: 'pay_out_of_pocket',
        reason: 'better_use_elsewhere',
        coverage: 'none',
        savingsCents: 0,
        outOfPocketCents: 26_148,
      }),
    ];
    serve(
      plan({
        entries: [
          ...plan().entries,
          {
            date: '2027-03-03',
            mealPeriod: 'dinner',
            kind: 'restaurant',
            experienceId: 'topolino',
            experienceName: "Topolino's Terrace",
            placeholderKind: null,
            plannedItemId: null,
            excludedKeys: [],
          },
        ],
        result: { ...result(), scenarios: result().scenarios.map((s) => (s.code === 'table_service' ? { ...s, meals } : s)) },
      }),
    );
    renderScreen();

    const sigCell = await screen.findByTestId('dining-slot-2027-03-02-dinner');
    expect(within(sigCell).getByText('2 TS')).toBeTruthy();
    expect(within(sigCell).getByText('~$113.00')).toBeTruthy();

    // Cash two-credit restaurant stays green Cash pill (never signature gold) and non-colliding price.
    const cashCell = screen.getByTestId('dining-slot-2027-03-03-dinner');
    expect(within(cashCell).getByText('Cash')).toBeTruthy();
    expect(within(cashCell).getByText('$261.48')).toBeTruthy();
    expect(JSON.stringify(cashCell.props.style)).not.toContain('#f59e0b');

    fireEvent.press(sigCell);
    const status = screen.getByTestId('dining-slot-credit-status');
    for (const badge of ['2 credits', 'Gratuity included', 'Estimate', 'Unverified rule']) {
      expect(within(status).getByText(badge)).toBeTruthy();
    }
  });

  it('surfaces partial coverage and uncovered reason in DiningSlotSheet for partly covered meals', async () => {
    serve(plan());
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-slot-2027-03-03-lunch'));
    const status = screen.getByTestId('dining-slot-credit-status');
    expect(within(status).getByText(/Partly covered/)).toBeTruthy();
    expect(within(status).getByText('Your credits are worth more at other meals.')).toBeTruthy();
    expect(within(status).getByText('1 of 2 diners covered')).toBeTruthy();
  });
});

describe('TripDiningPlanScreen: about even (Requirement 15.6, Property 45)', () => {
  function aboutEven(tsNet: number): DiningPlanDTO {
    const base = result();
    return withResult({
      verdict: 'about_even',
      recommended: 'none',
      bestPlan: 'table_service',
      scenarios: base.scenarios.map((s) => (s.code === 'table_service' ? { ...s, netSavingsCents: tsNet } : s)),
    });
  }

  it.each([
    [1_200, 'Too close to call', 'No plan and Table-Service Dining Plan are within ~2% ($20.00)', 'Slight edge: Table-Service Dining Plan (saves $12.00)'],
    [-900, 'Too close to call', 'No plan and Table-Service Dining Plan are within ~2% ($20.00)', 'Slight edge: Paying cash / No plan (saves $9.00)'],
  ])('with a best net of %i names the tied option and marks nothing recommended', async (net, title, bestText, edgeText) => {
    serve(aboutEven(net));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');

    expect(verdictTitle()).toBe(title);
    expect(screen.getByText(bestText)).toBeTruthy();
    expect(screen.getByText(edgeText)).toBeTruthy();
    fireEvent.press(screen.getByTestId('dining-verdict-toggle'));
    expect(screen.getByTestId('dining-verdict-detail').props.children).toBe(
      'Too close to call. The choice is up to you. A plan is paid in advance and leaves nothing to track at the table; no plan means no unused credits and free choice of where to eat.',
    );

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(testIdOrder().some((id) => id.startsWith('dining-compare-recommended-'))).toBe(false);
    expect(within(screen.getByTestId('dining-compare-row-none')).getAllByText('$999.99').length).toBeGreaterThanOrEqual(1);
    expect(within(screen.getByTestId('dining-compare-row-table_service')).getByText('$700.00')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    expect(screen.getByText('This one is too close to call; here is how the answer moves with how you order.')).toBeTruthy();
    expect(within(screen.getByTestId('dining-credit-summary')).getByText('Credits with the Table-Service Dining Plan')).toBeTruthy();
  });
});

describe('TripDiningPlanScreen: editing', () => {
  it('opens the slot sheet from the grid, saves through the entry route and shows the returned verdict', async () => {
    const saved = plan({
      entries: [
        ...plan().entries,
        { date: '2027-03-03', mealPeriod: 'lunch', kind: 'placeholder', experienceId: null, experienceName: null, placeholderKind: 'quick_service', plannedItemId: null, excludedKeys: [] },
      ],
      result: result({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 3_100 }),
    });
    serve(plan(), () => saved);
    renderScreen();

    const slot = await screen.findByTestId('dining-slot-2027-03-03-lunch');
    expect(slot.props.accessibilityLabel).toBe('Wednesday, March 3, lunch: Add a meal');
    fireEvent.press(slot);
    expect(screen.getByTestId('dining-slot-sheet')).toBeTruthy();
    expect(screen.getByText('Lunch · Wed, Mar 3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-slot-choice-quick_service'));
    fireEvent.press(screen.getByTestId('dining-slot-save'));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('PUT', `${PLAN_URL}/entries/2027-03-03/lunch`, {
        kind: 'placeholder',
        experienceId: null,
        placeholderKind: 'quick_service',
        excludedKeys: [],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('dining-slot-sheet')).toBeNull());
    expect(within(screen.getByTestId('dining-slot-2027-03-03-lunch')).getByText('Typical quick-service meal')).toBeTruthy();
    expect(verdictTitle()).toBe('No dining plan saves $31.00');
  });

  it('clears a filled slot through the entry route and shows the empty state from the response', async () => {
    serve(plan(), () => plan({ entries: [] }));
    renderScreen();
    expect(screen.queryByTestId('dining-empty-meals')).toBeNull();
    fireEvent.press(await screen.findByTestId('dining-slot-2027-03-02-dinner'));
    fireEvent.press(screen.getByTestId('dining-slot-clear'));

    await waitFor(() => expect(screen.getByTestId('dining-empty-meals')).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith('DELETE', `${PLAN_URL}/entries/2027-03-02/dinner`);
    expect(within(screen.getByTestId('dining-slot-2027-03-02-dinner')).getByText('+ Add')).toBeTruthy();
  });

  it('saves the eating style inline from the Settings tab and updates the verdict', async () => {
    serve(plan(), () => withResult({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 500 }));
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-open-settings'));
    expect(screen.getByTestId('dining-pane-settings')).toBeTruthy();
    const summary = screen.getByTestId('dining-summary');
    expect(within(summary).getByText('3 People')).toBeTruthy();
    expect(within(summary).getByText('2 adults (Alex, Blair), 1 child 3–9 (Kit)')).toBeTruthy();
    expect(within(summary).getByText('Mon, Mar 1 to Sat, Mar 6, 5 nights')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-settings-order-max_value'));
    fireEvent.press(screen.getByTestId('dining-settings-save'));

    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', `${PLAN_URL}/settings`, expect.objectContaining({ orderStyle: 'max_value', beverage: 'soft_drink' })));
    await waitFor(() => expect(verdictTitle()).toBe('No dining plan saves $5.00'));
  });
});

describe('TripDiningPlanScreen: reservations import', () => {
  const suggestion = (id: string, alreadyHasEntry: boolean, date = '2027-03-04'): DiningSuggestionDTO => ({
    plannedItemId: id,
    experienceId: alreadyHasEntry ? LIBERTY : PECOS,
    experienceName: alreadyHasEntry ? 'Liberty Tree Tavern' : 'Pecos Bill',
    date,
    mealPeriod: 'lunch',
    source: 'reservation',
    partySizeMismatch: false,
    alreadyHasEntry,
  });
  const SUGGESTIONS = [
    suggestion('50000000-0000-4000-8000-000000000001', false),
    suggestion('50000000-0000-4000-8000-000000000002', false, '2027-03-05'),
    suggestion('50000000-0000-4000-8000-000000000003', true),
  ];

  it('"Add 2 reservations" posts the import and shows "2 added, 1 already planned"', async () => {
    const after = plan({ suggestions: SUGGESTIONS.map((s) => ({ ...s, alreadyHasEntry: true })) });
    serve(plan({ suggestions: SUGGESTIONS }), () => ({ plan: after, created: 2, skippedExisting: 1, skippedOutOfStay: 0 }));
    renderScreen();

    const button = await screen.findByTestId('dining-import');
    expect(within(button).getByText('Add 2 reservations')).toBeTruthy();
    fireEvent.press(button);

    expect(await screen.findByText('2 added, 1 already planned')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('POST', `${PLAN_URL}/import-reservations`, { overwrite: false });
    expect(screen.queryByTestId('dining-import')).toBeNull();
  });

  it('shows a failed import in words', async () => {
    serve(plan({ suggestions: SUGGESTIONS }), () => {
      throw new Error('You cannot edit this trip.');
    });
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-import'));
    expect(await screen.findByText('You cannot edit this trip.')).toBeTruthy();
    expect(screen.queryByTestId('dining-import-result')).toBeNull();
  });

  it('offers no import when every suggestion already has an entry', async () => {
    serve(plan({ suggestions: [SUGGESTIONS[2]!] }));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    expect(screen.queryByTestId('dining-import')).toBeNull();
  });
});

describe('TripDiningPlanScreen: states & credits fallback', () => {
  it('with no entries shows the prompt on Meals and comparison figures on Compare', async () => {
    serve(plan({ entries: [] }));
    renderScreen();
    expect(await screen.findByText('Add the places you plan to eat')).toBeTruthy();
    expect(screen.getByTestId('dining-slot-2027-03-01-breakfast')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(within(screen.getByTestId('dining-compare-row-table_service')).getAllByText('$700.00').length).toBeGreaterThanOrEqual(1);
    expect(within(screen.getByTestId('dining-compare-row-none')).getByText('$999.99')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dining-compare-toggle-quick_service'));
    expect(within(screen.getByTestId('dining-compare-row-quick_service')).getByText('$627.80')).toBeTruthy();
  });

  it('shows a loading state until the plan arrives', async () => {
    let resolve: (p: DiningPlanDTO) => void = () => undefined;
    mockApi.mockImplementation(() => new Promise((r) => (resolve = r as (p: DiningPlanDTO) => void)));
    renderScreen();
    expect(screen.getByTestId('dining-plan-loading')).toBeTruthy();
    resolve(plan());
    expect(await screen.findByTestId('dining-plan-screen')).toBeTruthy();
    expect(screen.queryByTestId('dining-plan-loading')).toBeNull();
  });

  it('shows an error with Retry, and Retry loads the plan', async () => {
    mockApi.mockRejectedValueOnce(new Error('offline'));
    renderScreen();
    expect(await screen.findByTestId('dining-plan-error')).toBeTruthy();
    expect(screen.getByText("We couldn't load the dining plan")).toBeTruthy();

    serve(plan());
    fireEvent.press(screen.getByTestId('dining-plan-retry'));
    expect(await screen.findByTestId('dining-plan-screen')).toBeTruthy();
    expect(mockApi.mock.calls.filter(([m, p]) => m === 'GET' && p === PLAN_URL)).toHaveLength(2);
  });

  it('goes back from the header', async () => {
    serve(plan());
    const { navigation } = renderScreen();
    await screen.findByTestId('dining-plan-screen');
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('shows the best plan credit summary on Credits when No plan is recommended', async () => {
    serve(withResult({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 100 }));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(within(screen.getByTestId('dining-compare-row-none')).getByText('Recommended')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    expect(within(screen.getByTestId('dining-credit-summary')).getByText('Credits with the Table-Service Dining Plan')).toBeTruthy();
  });

  it('shows no credit summary on Credits when no option has credits', async () => {
    serve(withResult({ verdict: 'plan_unavailable', recommended: 'none', bestPlan: null, scenarios: [scenario(), scenario({ code: 'table_service', displayName: 'TS', available: false, unavailableReason: 'not_disney_resort', meals: [] })] }));
    renderScreen();
    await screen.findByTestId('dining-plan-screen');
    expect(verdictTitle()).toBe('No dining plan is available for this stay');

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    expect(screen.queryByTestId('dining-credit-summary')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(within(screen.getByTestId('dining-compare-row-table_service')).getByText('Not available. Only guests staying at a Disney Resort hotel can buy a dining plan.')).toBeTruthy();
  });
});
