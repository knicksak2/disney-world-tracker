/**
 * TripDiningPlanScreen with several hotel stays (dining-plan-calculator tasks 11.5 & 14.5), rendered with the real
 * screen, Resort Chapters and hooks; only the network layer (`apiRequest`) is mocked.
 *
 * Validates: Requirements 25.2, 25.3, 25.11, 25.13, 25.15, 25.16, 22.1, 22.2, 27.3–27.6.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiningPlanDTO, DiningPlanSettings, DiningPlanStayResultDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { line, plan, planStay, result, scenario, SETTINGS, TRIP_ID, TS_CREDITS } from '../../../test/diningPlanFixtures';
import TripDiningPlanScreen, { customStayApplies } from '../TripDiningPlanScreen';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const PLAN_URL = `/trips/${TRIP_ID}/dining-plan`;
const ME = '30000000-0000-4000-8000-0000000000a1';

const C = 'stay-contemporary';
const P = 'stay-pop';
const O = 'stay-offsite';

const CONTEMPORARY = planStay({
  key: C,
  label: "Disney's Contemporary Resort",
  status: 'have_plan',
  heldPlan: 'table_service',
  recommendedPlan: 'table_service',
  planCostCents: 15_000,
  contributionCents: 4_000,
  credits: TS_CREDITS,
});
const POP = planStay({ key: P, label: "Disney's Pop Century Resort", checkIn: '2027-12-20', checkOut: '2027-12-26', nights: 6 });
const OFFSITE = planStay({
  key: O,
  label: 'Hotel off property',
  lodgingKind: 'offsite',
  checkIn: '2027-12-26',
  checkOut: '2027-12-28',
  nights: 2,
  available: false,
  unavailableReason: 'not_disney_resort',
});

const STORED: DiningPlanSettings = { ...SETTINGS, stayPlans: { [C]: { status: 'have_plan', heldPlan: 'table_service', channel: 'package' } } };

function multiPlan(stays: readonly DiningPlanStayResultDTO[] = [CONTEMPORARY, POP, OFFSITE], settings: DiningPlanSettings = STORED): DiningPlanDTO {
  const switchDinner = line({ date: '2027-12-20', mealPeriod: 'dinner', stayKey: stays[stays.length - 1]!.key, coveredByStayKey: stays[0]!.key });
  return plan({
    settings,
    entries: [
      {
        date: '2027-12-20',
        mealPeriod: 'dinner',
        kind: 'restaurant',
        experienceId: 'exp-1',
        experienceName: 'California Grill',
        placeholderKind: null,
        plannedItemId: null,
        excludedKeys: [],
      },
    ],
    stay: { checkIn: '2027-12-15', checkOut: '2027-12-28', nights: 13, days: 14, source: 'trip' },
    result: result({
      stay: { checkIn: '2027-12-15', checkOut: '2027-12-28', nights: 13, days: 14, source: 'trip' },
      verdict: 'plan_costs_more',
      recommended: 'none',
      breakEvenGapCents: 1_500,
      scenarios: [scenario({ displayName: 'No additional plan', meals: [switchDinner] }), ...result().scenarios.slice(1)],
      stays,
      recommendedCombination: Object.fromEntries(stays.map((s) => [s.key, s.key === C ? 'table_service' : 'none'])),
      alternatives: [{ combination: { [C]: 'table_service', [P]: 'quick_service', [O]: 'none' }, totalCents: 21_000, netSavingsCents: -1_500 }],
    }),
  });
}

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

function serve(initial: DiningPlanDTO, opts: { role?: 'organizer' | 'member'; onPut?: (body: DiningPlanSettings) => DiningPlanDTO } = {}) {
  mockApi.mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path === PLAN_URL) return initial;
    if (method === 'GET' && path === '/me') return { user: { id: ME } };
    if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return [{ userId: ME, tripId: TRIP_ID, role: opts.role ?? 'member', displayName: 'Alex' }];
    if (method === 'GET' && path.startsWith('/catalog')) return { experiences: [] };
    if (method === 'PUT' && path === `${PLAN_URL}/settings`) return (opts.onPut ?? (() => initial))(body as DiningPlanSettings);
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const puts = () => mockApi.mock.calls.filter(([m, p]) => m === 'PUT' && p === `${PLAN_URL}/settings`);
const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked;

beforeEach(() => mockApi.mockReset());

describe('TripDiningPlanScreen: several stays', () => {
  it('shows a Resort Chapter per stay with its Change drawer, and an off-site stay with its reason and no Change bar', async () => {
    serve(multiPlan());
    renderScreen();
    await screen.findByTestId(`dining-stay-${C}`);

    const contemporary = screen.getByTestId(`dining-stay-${C}`);
    expect(within(contemporary).getByText('Contemporary')).toBeTruthy();
    expect(within(contemporary).getByText('Dec 15–20 · 5 nights · 3 guests')).toBeTruthy();

    fireEvent.press(screen.getByTestId(`dining-stay-${C}-change`));
    expect(checked(`dining-stay-${C}-status-have_plan`)).toBe(true);
    expect(checked(`dining-stay-${C}-plan-table_service`)).toBe(true);
    expect(checked(`dining-stay-${C}-channel-package`)).toBe(true);

    fireEvent.press(screen.getByTestId(`dining-stay-${P}-change`));
    expect(checked(`dining-stay-${P}-status-compare`)).toBe(true);
    expect(screen.queryByTestId(`dining-stay-${P}-plan-table_service`)).toBeNull();

    const offsite = screen.getByTestId(`dining-stay-${O}`);
    expect(within(offsite).getByText('Only guests staying at a Disney Resort hotel can buy a dining plan.')).toBeTruthy();
    expect(screen.queryByTestId(`dining-stay-${O}-change`)).toBeNull();
  });

  it('"Already have plan" sends nothing until a plan is picked, then sends that stay\'s setting', async () => {
    const after = multiPlan([CONTEMPORARY, { ...POP, status: 'have_plan', heldPlan: 'quick_service' }, OFFSITE]);
    serve(multiPlan(), { onPut: () => after });
    renderScreen();
    fireEvent.press(await screen.findByTestId(`dining-stay-${P}-change`));
    fireEvent.press(screen.getByTestId(`dining-stay-${P}-status-have_plan`));
    expect(puts()).toHaveLength(0);
    expect(checked(`dining-stay-${P}-status-have_plan`)).toBe(true);
    expect(checked(`dining-stay-${P}-plan-quick_service`)).toBe(false);

    fireEvent.press(screen.getByTestId(`dining-stay-${P}-plan-quick_service`));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]![2]).toEqual({
      ...STORED,
      stayPlans: {
        [C]: { status: 'have_plan', heldPlan: 'table_service', channel: 'package' },
        [P]: { status: 'have_plan', heldPlan: 'quick_service', channel: 'package' },
      },
    });
    await waitFor(() => expect(checked(`dining-stay-${P}-plan-quick_service`)).toBe(true));
  });

  it('switching a stay to Pay cash only sends it with no held plan, and hides its plan and channel choices', async () => {
    const after = multiPlan([{ ...CONTEMPORARY, status: 'no_plan', heldPlan: null, recommendedPlan: 'none' }, POP, OFFSITE]);
    serve(multiPlan(), { onPut: () => after });
    renderScreen();
    fireEvent.press(await screen.findByTestId(`dining-stay-${C}-change`));
    fireEvent.press(screen.getByTestId(`dining-stay-${C}-status-no_plan`));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]![2] as DiningPlanSettings).stayPlans[C]).toEqual({ status: 'no_plan', heldPlan: null, channel: 'package' });
    await waitFor(() => expect(checked(`dining-stay-${C}-status-no_plan`)).toBe(true));
    expect(screen.queryByTestId(`dining-stay-${C}-plan-table_service`)).toBeNull();
    expect(screen.queryByTestId(`dining-stay-${C}-channel-package`)).toBeNull();
  });

  it.each([
    [P, { status: 'compare', heldPlan: null, channel: 'dvc_or_passholder' }],
    [C, { status: 'have_plan', heldPlan: 'table_service', channel: 'dvc_or_passholder' }],
  ] as const)('changing the booking channel of %s keeps its status and held plan', async (key, expected) => {
    serve(multiPlan());
    renderScreen();
    fireEvent.press(await screen.findByTestId(`dining-stay-${key}-change`));
    fireEvent.press(screen.getByTestId(`dining-stay-${key}-channel-dvc_or_passholder`));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]![2] as DiningPlanSettings).stayPlans[key]).toEqual(expected);
  });

  it('shows a refused change in words', async () => {
    mockApi.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === PLAN_URL) return multiPlan();
      if (method === 'PUT') throw new Error('That plan is not sold for these dates.');
      return { experiences: [] };
    });
    renderScreen();
    fireEvent.press(await screen.findByTestId(`dining-stay-${P}-change`));
    fireEvent.press(screen.getByTestId(`dining-stay-${P}-status-no_plan`));
    expect(await screen.findByText('That plan is not sold for these dates.')).toBeTruthy();
  });

  it('marks switch days with the explanation divider and badge', async () => {
    serve(multiPlan());
    renderScreen();
    const divider = await screen.findByTestId('dining-handoff-2027-12-20');
    expect(within(divider).getByText('Mon, Dec 20 Switch Day: Either Contemporary or Pop Century credits can be used on Dec 20.')).toBeTruthy();
    expect(screen.getByTestId('dining-day-switch-2027-12-20')).toBeTruthy();
    expect(screen.queryByTestId('dining-day-switch-2027-12-16')).toBeNull();
    expect(screen.queryByTestId('dining-handoff-2027-12-26')).not.toBeNull();
  });

  it('shows Best Plan Per Hotel, expandable 3-column combinations matrix in Compare, and covered-by-hotel in slot sheet', async () => {
    serve(multiPlan());
    renderScreen();

    // Tapping switch-day dinner opens DiningSlotSheet showing which hotel's credits cover it.
    fireEvent.press(await screen.findByTestId('dining-slot-2027-12-20-dinner'));
    expect(within(screen.getByTestId('dining-slot-credit-status')).getByText("Uses Disney's Contemporary Resort credits")).toBeTruthy();
    fireEvent.press(screen.getByTestId('dining-slot-close'));

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    await screen.findByTestId('dining-stays-result');
    expect(screen.getByText('BEST PLAN PER HOTEL')).toBeTruthy();
    const c = screen.getByTestId(`dining-stay-result-${C}`);
    expect(within(c).getByText('Table-Service Dining Plan (already booked)')).toBeTruthy();
    expect(within(c).getByText('Plan cost: $150.00')).toBeTruthy();
    expect(within(c).getByText('Saves about $40.00 at this hotel')).toBeTruthy();
    expect(within(screen.getByTestId(`dining-stay-result-${P}`)).getByText('No plan')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-alternatives-toggle'));
    const alts = screen.getByTestId('dining-alternatives');
    expect(within(alts).getByText('Contemporary')).toBeTruthy();
    expect(within(alts).getByText('Pop Century')).toBeTruthy();
    const alt = screen.getByTestId('dining-alternative-0');
    expect(within(alt).getByText('Quick-Service')).toBeTruthy();
    expect(within(alt).getByText('$210.00')).toBeTruthy();
    expect(within(alt).getByText('Costs $15.00 more')).toBeTruthy();
  });

  it('uses clean "per-hotel mix" wording in Verdict and Credits instead of "A plan per hotel"', async () => {
    const base = multiPlan();
    serve({
      ...base,
      result: {
        ...base.result,
        bestPlan: null,
        scenarios: [
          ...base.result.scenarios,
          scenario({ code: 'mix', displayName: 'A plan per hotel', credits: TS_CREDITS, totalCents: 21_000, netSavingsCents: -1_500 }),
        ],
      },
    });
    renderScreen();
    expect((await screen.findByTestId('dining-verdict-best')).props.children[0]).toBe(
      'Paying as you go beats per-hotel plan mix',
    );

    fireEvent.press(screen.getByTestId('dining-tab-credits'));
    fireEvent.press(screen.getByTestId('dining-credits-option-mix'));
    expect(within(screen.getByTestId('dining-credit-summary')).getByText('Credits with the per-hotel mix')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(within(screen.getByTestId('dining-compare-row-mix')).getByText('Per-Hotel Plan Mix')).toBeTruthy();
  });

  it('hides custom dates and stay type in Settings when dated stays are recorded', async () => {
    serve(multiPlan());
    renderScreen();
    fireEvent.press(await screen.findByTestId('dining-open-settings'));
    expect(screen.getByTestId('dining-pane-settings')).toBeTruthy();
    expect(screen.queryByTestId('dining-settings-custom-dates')).toBeNull();
    expect(screen.queryByTestId('dining-settings-stay-type-disney_resort_package')).toBeNull();
  });
});

describe('TripDiningPlanScreen: one stay', () => {
  const NO_LODGING = planStay({ key: 'implicit:2027-03-01', label: 'No lodging recorded', source: 'implicit_no_lodging', checkIn: '2027-03-01', checkOut: '2027-03-06' });

  it.each([
    ['organizer', true],
    ['member', false],
  ] as const)('a segment with no lodging says so; the Edit stays link is for the %s: %s', async (role, hasLink) => {
    serve(multiPlan([NO_LODGING], SETTINGS), { role });
    const { navigation } = renderScreen();
    const note = await screen.findByTestId('dining-stay-implicit:2027-03-01-no-lodging');
    expect(within(note).getByText('No lodging recorded; assuming a Disney Resort package')).toBeTruthy();
    if (hasLink) {
      fireEvent.press(await screen.findByTestId('dining-stay-implicit:2027-03-01-edit-stays'));
      expect(navigation.navigate).toHaveBeenCalledWith('TripEdit', { tripId: TRIP_ID });
    } else {
      await waitFor(() => expect(mockApi.mock.calls.some(([m, p]) => m === 'GET' && p === `/trips/${TRIP_ID}/members`)).toBe(true));
      expect(screen.queryByTestId('dining-stay-implicit:2027-03-01-edit-stays')).toBeNull();
    }
  });

  it('shows only one chapter with no switch marker, no Combination card, and keeps custom stay settings available', async () => {
    serve(multiPlan([NO_LODGING], SETTINGS));
    renderScreen();
    await screen.findByTestId('dining-stay-implicit:2027-03-01');
    expect(screen.queryByTestId('dining-day-switch-2027-03-02')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    expect(screen.queryByTestId('dining-stays-result')).toBeNull();

    fireEvent.press(screen.getByTestId('dining-tab-settings'));
    expect(screen.getByTestId('dining-settings-custom-dates')).toBeTruthy();
    expect(customStayApplies([NO_LODGING])).toBe(true);
    expect(customStayApplies([CONTEMPORARY, POP])).toBe(false);
    expect(customStayApplies([CONTEMPORARY])).toBe(false);
    expect(customStayApplies(undefined)).toBe(true);
  });

  it('on about_even replaces Saves badge with Within margin, auto-expands alternatives, and highlights tied rows', async () => {
    const base = multiPlan();
    serve({
      ...base,
      result: {
        ...base.result,
        verdict: 'about_even',
        recommended: 'none',
        bestPlan: null,
        evenThresholdCents: 6_922,
        recommendedCombination: { [C]: 'none', [P]: 'none' },
        scenarios: [
          ...base.result.scenarios,
          scenario({ code: 'mix', displayName: 'A plan per hotel', credits: TS_CREDITS, totalCents: 339_575, netSavingsCents: 6_501 }),
        ],
        alternatives: [
          { combination: { [C]: 'table_service', [P]: 'none' }, totalCents: 339_575, netSavingsCents: 6_501 },
          { combination: { [C]: 'table_service', [P]: 'table_service' }, totalCents: 361_325, netSavingsCents: -15_249 },
        ],
      },
    });
    renderScreen();
    await screen.findByTestId('dining-plan-screen');

    fireEvent.press(screen.getByTestId('dining-tab-compare'));
    const card = await screen.findByTestId('dining-stays-result');
    expect(within(card).getByText('TOO CLOSE TO CALL (~2% MARGIN)')).toBeTruthy();
    expect(within(card).getByText('About even')).toBeTruthy();
    expect(within(screen.getByTestId('dining-combination')).queryByText('Saves $65.01')).toBeNull();
    // Held-plan stays still render per-stay rows (without green No plan badges); non-held stays render single baseline row.
    expect(within(card).getByTestId(`dining-stay-result-${C}`)).toBeTruthy();

    // Alternatives matrix is already expanded on about_even and marks tied rows.
    const row0 = screen.getByTestId('dining-alternative-0');
    const row1 = screen.getByTestId('dining-alternative-1');
    expect(within(row0).getByText('Within margin')).toBeTruthy();
    expect(within(row1).queryByText('Within margin')).toBeNull();
  });
});
