/**
 * Dining Plan formatters (dining-plan-calculator task 11.1): every verdict, every action, the quality notice wording,
 * and that the comparison rows show the server's figures unchanged.
 *
 * Validates: Requirements 13.8, 14.5, 15.3, 15.6, 19.7, 19.9, 21.2, 22.1, 22.2; Property 45 (wording half).
 */

import { line, planStay, result, scenario, TS_CREDITS } from '../../../test/diningPlanFixtures';
import {
  alternativeMatrixRows,
  canExportToBudget,
  exportCategoryLabel,
  exportGroupOf,
  exportResultText,
  exportWarningText,
  groupStayChapters,
  headerMetaSummary,
  lineUsesCredit,
  needsMealTimeText,
  settingsChipLabel,
  shortHotelLabel,
  slotMatchesFilter,
  suggestionSourceLabel,
  suggestionText,
  alternativeRows,
  combinationSentence,
  combinationView,
  isSynthesizedStay,
  stayDayNotes,
  stayRangeText,
  stayResultRows,
  actionLabel,
  creditRows,
  importActionLabel,
  importResultText,
  lineBadges,
  partySummaryText,
  pricesAsOfText,
  scenarioName,
  sensitivityRows,
  staySummaryText,
  qualityNotice,
  ratesText,
  scenarioRows,
  shortDate,
  slotAccessibilityLabel,
  slotLabel,
  stayDates,
  unavailableReasonText,
  verdictCompactView,
  verdictHeadline,
  weekdayAndMonthDay,
} from '../diningPlanView';

const quality = (q: Partial<ReturnType<typeof result>['dataQuality']>) => result({ dataQuality: { ...result().dataQuality, ...q } });

describe('verdictHeadline', () => {
  it('plan_saves names the recommended plan and its saving', () => {
    expect(verdictHeadline(result())).toEqual({
      title: 'Table-Service Dining Plan saves about $299.99',
      detail: 'Compared with paying for the meals you listed yourself, tax and tips included.',
      icon: 'checkmark-circle-outline',
      provisional: false,
    });
  });

  it('plan_costs_more names the best plan and the gap from breakEvenGapCents', () => {
    const r = result({ verdict: 'plan_costs_more', recommended: 'none', breakEvenGapCents: 4_250 });
    expect(verdictHeadline(r).title).toBe('No dining plan: Table-Service Dining Plan would cost about $42.50 more');
    expect(verdictHeadline(r).icon).toBe('close-circle-outline');
  });

  it('about_even with a positive best net names the plan, the saving and the margin (Property 45)', () => {
    const r = result({
      verdict: 'about_even',
      recommended: 'none',
      scenarios: [scenario(), scenario({ code: 'table_service', displayName: 'Table-Service Dining Plan', netSavingsCents: 1_200 })],
    });
    const v = verdictHeadline(r);
    expect(v.title).toBe('About even: Table-Service Dining Plan would save about $12.00, less than the margin of these estimates');
    expect(v.detail).toContain('The choice is up to you.');
    expect(v.detail).toContain('paid in advance');
    expect(v.detail).toContain('no unused credits and free choice of where to eat');
  });

  it('about_even with a negative best net says no plan is cheaper by the absolute value (Property 45)', () => {
    const r = result({
      verdict: 'about_even',
      recommended: 'none',
      bestPlan: 'quick_service',
      scenarios: [scenario(), scenario({ code: 'quick_service', displayName: 'Quick-Service Dining Plan', netSavingsCents: -900 })],
    });
    expect(verdictHeadline(r).title).toBe('About even: no plan is about $9.00 cheaper');
  });

  it('about_even uses the per-hotel mix when bestPlan is null', () => {
    const r = result({ verdict: 'about_even', recommended: 'none', bestPlan: null, scenarios: [scenario(), scenario({ code: 'mix', displayName: 'A plan per hotel', netSavingsCents: 500 })] });
    expect(verdictHeadline(r).title).toBe('About even: A plan per hotel would save about $5.00, less than the margin of these estimates');
  });

  it('plan_unavailable gives the first unavailable plan\'s reason in words', () => {
    const r = result({
      verdict: 'plan_unavailable',
      recommended: 'none',
      bestPlan: null,
      scenarios: [scenario(), scenario({ code: 'quick_service', available: false, unavailableReason: 'not_disney_resort' })],
    });
    expect(verdictHeadline(r)).toMatchObject({ title: 'No dining plan is available for this stay', detail: 'Only guests staying at a Disney Resort hotel can buy a dining plan.', icon: 'remove-circle-outline' });
  });

  it.each([
    ['estimated entries', { estimatedEntries: 1 }],
    ['unverified rules', { unverifiedRules: 2 }],
    ['unverified prices', { unverifiedPrices: 1 }],
  ])('reads "Estimated" with %s', (_name, q) => {
    expect(verdictHeadline(quality(q))).toMatchObject({ provisional: true, title: 'Estimated: Table-Service Dining Plan saves about $299.99' });
  });

  it('does not read "Estimated" for derived rules alone', () => {
    expect(verdictHeadline(quality({ derivedRules: 3 })).title).not.toContain('Estimated');
  });
});

describe('scenarioRows', () => {
  it('shows the server figures unchanged, even when the terms do not add up to the total', () => {
    const rows = scenarioRows(result());
    // No plan: 250.00 + 16.25 + 45.00 + 34.60 is not 999.99, and the row shows 999.99.
    expect(rows[0]).toEqual({
      code: 'none', name: 'No Dining Plan', available: true, unavailableText: null, recommended: false, promoLabel: null, priceNote: null,
      planCost: '$0.00', foodOutOfPocket: '$250.00', tax: '$16.25', tip: '$45.00', snacks: '$34.60', mugs: '$0.00', total: '$999.99', netSavings: null,
    });
    expect(rows.map((r) => [r.code, r.total, r.netSavings, r.recommended])).toEqual([
      ['none', '$999.99', null, false],
      ['quick_service', '$880.00', 'Saves $119.99', false],
      ['table_service', '$700.00', 'Saves $299.99', true],
      ['deluxe', '$0.00', null, false],
    ]);
  });

  it('gives an unavailable plan its reason in words', () => {
    expect(scenarioRows(result())[3]).toMatchObject({ available: false, unavailableText: 'There is no price for this plan on some of your dates.' });
  });

  it('notes "Price not yet verified" only for an available plan with no verified date (Requirement 21.3)', () => {
    const r = result({
      scenarios: [
        scenario({ priceVerifiedAt: null }),
        scenario({ code: 'quick_service', displayName: 'QS', priceVerifiedAt: null }),
        scenario({ code: 'table_service', displayName: 'TS', priceVerifiedAt: '2026-11-01' }),
        scenario({ code: 'deluxe', displayName: 'DX', available: false, unavailableReason: 'no_price_for_dates', priceVerifiedAt: null }),
      ],
    });
    expect(scenarioRows(r).map((x) => [x.code, x.priceNote])).toEqual([
      ['none', null],
      ['quick_service', 'Price not yet verified'],
      ['table_service', null],
      ['deluxe', null],
    ]);
  });

  it('marks no row Recommended for an about-even result (Requirement 15.6)', () => {
    expect(scenarioRows(result({ verdict: 'about_even', recommended: 'none' })).some((r) => r.recommended)).toBe(false);
  });

  it('marks No plan Recommended when a plan costs more, with a "costs more" net', () => {
    const r = result({ verdict: 'plan_costs_more', recommended: 'none', scenarios: [scenario(), scenario({ code: 'table_service', displayName: 'TS', netSavingsCents: -3_000 })] });
    expect(scenarioRows(r).map((x) => [x.code, x.recommended, x.netSavings])).toEqual([['none', true, null], ['table_service', false, 'Costs $30.00 more']]);
  });
});

describe('meal slots and actions', () => {
  it('labels each slot by its content and announces date, period and content', () => {
    const base = { date: '2027-03-02', mealPeriod: 'dinner' as const, experienceId: null, experienceName: null, placeholderKind: null, plannedItemId: null, excludedKeys: [] };
    expect(slotLabel(undefined)).toBe('Add a meal');
    expect(slotLabel({ ...base, kind: 'skip' })).toBe('Skipped');
    expect(slotLabel({ ...base, kind: 'placeholder', placeholderKind: 'table_service' })).toBe('Typical table-service meal');
    expect(slotLabel({ ...base, kind: 'placeholder', placeholderKind: 'quick_service' })).toBe('Typical quick-service meal');
    expect(slotLabel({ ...base, kind: 'restaurant', experienceName: 'Liberty Tree Tavern' })).toBe('Liberty Tree Tavern');
    expect(slotAccessibilityLabel('2027-03-02', 'dinner', undefined)).toBe('Tuesday, March 2, dinner: Add a meal');
  });

  it.each([
    ['use_plan', null, { text: 'Use plan', icon: 'checkmark-circle-outline', reason: null }],
    ['partly_covered', 'better_use_elsewhere', { text: 'Partly covered', icon: 'contrast-outline', reason: 'Your credits are worth more at other meals.' }],
    ['pay_out_of_pocket', 'not_eligible', { text: 'Pay out of pocket', icon: 'cash-outline', reason: 'This restaurant does not take dining plan credits.' }],
    ['pay_out_of_pocket', 'no_matching_credits', { text: 'Pay out of pocket', icon: 'cash-outline', reason: 'This plan has no credit for this kind of meal.' }],
    ['not_applicable', null, { text: 'No plan', icon: 'ellipse-outline', reason: null }],
  ] as const)('action %s with reason %s', (action, reason, view) => {
    expect(actionLabel({ action, reason })).toEqual(view);
  });

  it('gives text badges for two credits, included gratuity, estimates and unverified rules', () => {
    expect(lineBadges(line({ twoCredit: true, gratuityIncluded: true, basis: 'tier_estimate', unverifiedRule: true }))).toEqual(['2 credits', 'Gratuity included', 'Estimate', 'Unverified rule']);
    expect(lineBadges(line({ basis: 'default_estimate' }))).toEqual(['Estimate']);
    expect(lineBadges(line())).toEqual([]);
  });
});

describe('qualityNotice', () => {
  it('shows nothing when no figure is estimated or unverified', () => {
    expect(qualityNotice(result())).toEqual({ notice: null, derivedLine: null });
  });

  it('states each non-zero count, singular and plural', () => {
    expect(qualityNotice(quality({ estimatedEntries: 1, unverifiedRules: 2, unverifiedPrices: 1 })).notice).toBe(
      'Some figures are estimates: 1 meal is priced from an estimate; 2 meals use an unverified credit rule; 1 plan price is not yet verified.',
    );
    expect(qualityNotice(quality({ estimatedEntries: 3 })).notice).toBe('Some figures are estimates: 3 meals are priced from an estimate.');
  });

  it('shows derived rules only as the secondary line, never as the notice', () => {
    expect(qualityNotice(quality({ derivedRules: 1 }))).toEqual({ notice: null, derivedLine: '1 restaurant uses the standard rules: one credit per meal.' });
    expect(qualityNotice(quality({ derivedRules: 4 })).derivedLine).toBe('4 restaurants use the standard rules: one credit per meal.');
  });
});

describe('other text', () => {
  it('words every unavailable reason', () => {
    expect(unavailableReasonText('no_nights')).toBe('A dining plan needs at least one night at the hotel.');
    expect(unavailableReasonText('stay_too_long')).toBe('The calculator handles stays of up to 30 nights.');
    expect(unavailableReasonText('no_eligible_guests')).toBe('Nobody in the party is aged 3 or over.');
    expect(unavailableReasonText(null)).toBe('Not available for this stay.');
  });

  it('formats the prices date, the rates and the stay dates', () => {
    expect(pricesAsOfText(result())).toBe('Plan prices as of 2026-11-09.');
    expect(pricesAsOfText(result({ assumptions: { ...result().assumptions, pricesAsOf: null } }))).toBe('Plan prices: price not yet verified.');
    expect(ratesText(result())).toBe('Tax 6.50% (default), tip 18% (default).');
    expect(ratesText(result({ assumptions: { ...result().assumptions, taxBps: 700, taxIsDefault: false } }))).toBe('Tax 7% (your setting), tip 18% (default).');
    expect(stayDates('2027-02-27', '2027-03-02')).toEqual(['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02']);
    expect(shortDate('2027-03-02')).toBe('Tue, Mar 2');
  });
});

describe('screen text (task 11.3)', () => {
  it('lists the best option per order style from the server, marking the current setting', () => {
    const rows = sensitivityRows(
      result({ sensitivity: [...result().sensitivity, { orderStyle: 'budget', bestPlan: null, netSavingsCents: 0 }] }),
      'typical',
    );
    expect(rows.map((r) => [r.label, r.current, r.best, r.net])).toEqual([
      ['Budget', false, 'Quick-Service Dining Plan', 'Saves $12.00'],
      ['Typical', true, 'Table-Service Dining Plan', 'Saves $299.99'],
      ['Splurge', false, 'Table-Service Dining Plan', 'Saves $410.00'],
      ['Most expensive', false, 'Deluxe Table-Service Dining Plan', 'Saves $520.00'],
      ['Budget', false, 'No Dining Plan', 'No plan is cheapest'],
    ]);
  });

  it('names scenario codes from the result', () => {
    expect(scenarioName(result(), 'quick_service')).toBe('Quick-Service Dining Plan');
    expect(scenarioName(result(), null)).toBe('No Dining Plan');
  });

  it('gives the party credit totals, the snacks per day, and the mug refill rule', () => {
    expect(creditRows(TS_CREDITS)).toEqual([
      'Table-service credits: 10 for the party, 4 used, 6 left over',
      'Quick-service credits: 10 for the party, 2 used, 8 left over',
      'Snack credits: 10 for the party, 10 used, 0 left over',
      'Use about 1 snack credit a day to use them all',
    ]);
    const qsOnly = { ...TS_CREDITS, ts: { issued: 0, used: 0, unused: 0 }, snacksPerDayToUseAll: 2, mugsCovered: 2 };
    expect(creditRows(qsOnly)).toEqual([
      'Quick-service credits: 10 for the party, 2 used, 8 left over',
      'Snack credits: 10 for the party, 10 used, 0 left over',
      'Use about 2 snack credits a day to use them all',
      '2 refillable mugs included. Refills work only at self-service stations in Disney Resort hotel quick-service locations, not in the parks or Disney Springs.',
    ]);
  });

  it('words the import action and its result', () => {
    expect(importActionLabel(1)).toBe('Add 1 reservation');
    expect(importActionLabel(2)).toBe('Add 2 reservations');
    expect(importResultText({ created: 2, skippedExisting: 1, skippedOutOfStay: 0 })).toBe('2 added, 1 already planned');
    expect(importResultText({ created: 0, skippedExisting: 0, skippedOutOfStay: 3 })).toBe('0 added, 3 outside your stay');
  });

  it('summarises the party and the stay', () => {
    expect(partySummaryText([{ label: 'Alex' }, { label: 'Kit' }])).toBe('2 people: Alex, Kit');
    expect(partySummaryText([{ label: 'Alex' }])).toBe('1 person: Alex');
    expect(partySummaryText([])).toBe('No one in the party yet');
    expect(staySummaryText({ checkIn: '2027-03-01', checkOut: '2027-03-06', nights: 5 })).toBe('Mon, Mar 1 to Sat, Mar 6, 5 nights');
  });
});

describe('several hotel stays (task 11.5)', () => {
  const CONTEMPORARY = planStay({ key: 'c', label: 'Contemporary', status: 'have_plan', heldPlan: 'table_service', recommendedPlan: 'table_service', planCostCents: 15_000, contributionCents: 4_000, credits: TS_CREDITS });
  const POP = planStay({ key: 'p', label: 'Pop Century', checkIn: '2027-12-20', checkOut: '2027-12-26', nights: 6 });
  const OFFSITE = planStay({ key: 'o', label: 'Hotel off property', lodgingKind: 'offsite', checkIn: '2027-12-26', checkOut: '2028-01-02', nights: 7, available: false, unavailableReason: 'not_disney_resort' });
  const multi = (o: Partial<ReturnType<typeof result>> = {}) =>
    result({
      verdict: 'plan_costs_more',
      recommended: 'none',
      stays: [CONTEMPORARY, POP, OFFSITE],
      recommendedCombination: { c: 'table_service', p: 'none', o: 'none' },
      alternatives: [{ combination: { c: 'table_service', p: 'quick_service', o: 'none' }, totalCents: 21_000, netSavingsCents: -1_500 }],
      ...o,
    });

  it('words a stay range within and across months', () => {
    expect(stayRangeText('2027-12-15', '2027-12-20')).toBe('Dec 15 to 20');
    expect(stayRangeText('2027-12-26', '2028-01-02')).toBe('Dec 26 to Jan 2');
  });

  it('says the Combination in words, marking a held plan as already booked', () => {
    expect(combinationSentence([CONTEMPORARY, POP], { c: 'table_service', p: 'none' })).toBe(
      'Table-Service plan (already booked) for Contemporary (Dec 15 to 20); no plan for Pop Century (Dec 20 to 26)',
    );
    expect(combinationSentence([POP], { p: 'deluxe' })).toBe('Deluxe plan for Pop Century (Dec 20 to 26)');
  });

  it('heads the Combination "Recommended" only where the comparison recommends, and not for one stay', () => {
    expect(combinationView(multi())?.heading).toBe('Recommended for your hotels');
    expect(combinationView(multi({ verdict: 'about_even' }))?.heading).toBe('Without a new plan (too close to call)');
    expect(combinationView(multi({ verdict: 'plan_unavailable' }))?.heading).toBe('Your hotels');
    expect(combinationView(multi({ stays: [CONTEMPORARY] }))).toBeNull();
    expect(combinationView(result())).toBeNull();
  });

  it('builds each stay row from the server figures', () => {
    const rows = stayResultRows(multi({ stays: [CONTEMPORARY, POP, OFFSITE, planStay({ key: 'x', label: 'X', recommendedPlan: 'quick_service', planCostCents: 9_000, contributionCents: -700 })] }));
    expect(rows[0]).toEqual({
      key: 'c',
      label: 'Contemporary',
      dates: 'Dec 15 to 20, 5 nights',
      plan: 'Table-Service Dining Plan (already booked)',
      planCost: '$150.00',
      contribution: 'Saves about $40.00 at this hotel',
      credits: [
        'Table-service credits: 10 for the party, 4 used, 6 left over',
        'Quick-service credits: 10 for the party, 2 used, 8 left over',
        'Snack credits: 10 for the party, 10 used, 0 left over',
        'Use about 1 snack credit a day to use them all',
      ],
      unavailableText: null,
    });
    expect(rows[1]).toMatchObject({ plan: 'No plan', planCost: null, contribution: null, credits: [] });
    expect(rows[2]).toMatchObject({ plan: 'No plan', unavailableText: 'Only guests staying at a Disney Resort hotel can buy a dining plan.' });
    // A stay missing from the Combination falls back to its own recommended plan.
    expect(rows[3]).toMatchObject({ plan: 'Quick-Service Dining Plan', planCost: '$90.00', contribution: 'Costs about $7.00 more than no plan at this hotel' });
  });

  it('lists the alternatives with their totals and net', () => {
    expect(alternativeRows(multi())).toEqual([
      {
        sentence: 'Table-Service plan (already booked) for Contemporary (Dec 15 to 20); Quick-Service plan for Pop Century (Dec 20 to 26); no plan for Hotel off property (Dec 26 to Jan 2)',
        total: '$210.00',
        net: 'Costs $15.00 more',
      },
    ]);
  });

  it('notes the hotel of each date and marks only switch days; nothing for one stay', () => {
    const notes = stayDayNotes([POP, CONTEMPORARY]);
    expect(notes.get('2027-12-16')).toEqual({ hotels: ['Contemporary'], handOff: false });
    expect(notes.get('2027-12-20')).toEqual({ hotels: ['Contemporary', 'Pop Century'], handOff: true });
    expect(notes.get('2027-12-26')).toEqual({ hotels: ['Pop Century'], handOff: false });
    expect(stayDayNotes([CONTEMPORARY]).size).toBe(0);
    expect(stayDayNotes(undefined).size).toBe(0);
  });

  it('knows a synthesized segment', () => {
    expect(isSynthesizedStay({ source: 'implicit_no_lodging' })).toBe(true);
    expect(isSynthesizedStay({ source: 'implicit_gap' })).toBe(true);
    expect(isSynthesizedStay({ source: 'stay' })).toBe(false);
    expect(isSynthesizedStay({ source: 'legacy_resorts' })).toBe(false);
  });
});

describe('import suggestions and the Budget export (task 11.6)', () => {
  it('labels a suggestion by its source and words it', () => {
    expect(suggestionSourceLabel('reservation')).toBe('Reservation');
    expect(suggestionSourceLabel('planned_item')).toBe('Planned');
    expect(suggestionText({ experienceName: 'Pecos Bill', date: '2027-03-04', mealPeriod: 'lunch' })).toBe('Pecos Bill, Thu, Mar 4, lunch');
  });

  it('says how many planned restaurants have no meal time, and nothing for none', () => {
    expect(needsMealTimeText(0)).toBeNull();
    expect(needsMealTimeText(1)).toBe('1 planned restaurant has no meal time; add it by hand');
    expect(needsMealTimeText(3)).toBe('3 planned restaurants have no meal time; add them by hand');
  });

  it('maps Export_Keys to their groups and categories to the Budget names', () => {
    expect(exportGroupOf('dining_plan:plan:60000000-0000-4000-8000-000000000001')).toBe('plan');
    expect(exportGroupOf('dining_plan:plan:implicit:2027-03-01')).toBe('plan');
    expect(exportGroupOf('dining_plan:oop')).toBe('out_of_pocket');
    expect(exportGroupOf('dining_plan:tips')).toBe('tips');
    expect(exportGroupOf('dining_plan:tipsx')).toBeNull();
    expect(exportGroupOf('budget:tickets')).toBeNull();
    expect(exportCategoryLabel('dining')).toBe('Dining & Snacks');
    expect(exportCategoryLabel('other')).toBe('Other & Extras');
  });

  it('words the counts and each warning', () => {
    expect(exportResultText({ created: 2, updated: 1, deleted: 0 })).toBe('2 lines added, 1 updated, 0 removed.');
    expect(exportResultText({ created: 1, updated: 0, deleted: 3 })).toBe('1 line added, 0 updated, 3 removed.');
    expect(exportWarningText({ code: 'tax_rate_mismatch', calculatorTaxBps: 650, budgetTaxBps: 700 })).toBe(
      "The Budget taxes dining at 7% and the calculator used 6.5%, so the Budget's totals will differ slightly.",
    );
    expect(exportWarningText({ code: 'other_category_taxed' })).toBe('Your Budget taxes the Other category, so the tips line will have tax added.');
  });

  it('offers the export when a plan is available or the recommended option pays anything, and not otherwise', () => {
    expect(canExportToBudget(result())).toBe(true);
    const noPlans = (none: Partial<ReturnType<typeof scenario>>) =>
      result({ verdict: 'plan_unavailable', recommended: 'none', bestPlan: null, scenarios: [scenario(none), scenario({ code: 'table_service', available: false, unavailableReason: 'not_disney_resort' })] });
    expect(canExportToBudget(noPlans({}))).toBe(true);
    const nothing = { foodOutOfPocketCents: 0, snackOutOfPocketCents: 0, mugOutOfPocketCents: 0, tipCents: 0, taxCents: 0, totalCents: 0 };
    expect(canExportToBudget(noPlans(nothing))).toBe(false);
    for (const k of ['foodOutOfPocketCents', 'snackOutOfPocketCents', 'mugOutOfPocketCents', 'tipCents'] as const) {
      expect(canExportToBudget(noPlans({ ...nothing, [k]: 100 }))).toBe(true);
    }
    // An available plan is enough, even when the recommended option (No plan) pays nothing.
    const planAvailable = result({
      verdict: 'plan_costs_more',
      recommended: 'none',
      scenarios: [scenario(nothing), scenario({ code: 'table_service', displayName: 'TS', planCostCents: 99_870 })],
    });
    expect(canExportToBudget(planAvailable)).toBe(true);
  });
});

describe('Requirement 27 view helpers (task 14.1)', () => {
  it('formats weekdayAndMonthDay and settingsChipLabel without rounding arithmetic', () => {
    expect(weekdayAndMonthDay('2027-03-02')).toEqual({ weekday: 'Tue', monthDay: 'Mar 2' });
    expect(settingsChipLabel({ orderStyle: 'splurge', tipBps: null }, 1800)).toBe('Splurge · 18% tip');
    expect(settingsChipLabel({ orderStyle: 'max_value', tipBps: 2000 }, 1800)).toBe('Most expensive · 20% tip');
  });

  it('verdictCompactView spells out winning mix plans and keeps Total from server cents', () => {
    const c = planStay({ key: 'c', label: 'All-Star Sports', checkIn: '2027-12-15', checkOut: '2027-12-16', nights: 1 });
    const b = planStay({ key: 'b', label: 'Beach Club', checkIn: '2027-12-16', checkOut: '2027-12-20', nights: 4, recommendedPlan: 'table_service' });
    const v = verdictCompactView(
      result({
        verdict: 'plan_saves',
        recommended: 'mix',
        bestPlan: null,
        stays: [c, b],
        recommendedCombination: { c: 'none', b: 'table_service' },
        scenarios: [
          scenario({ code: 'none', displayName: 'No Dining Plan', totalCents: 200_000, netSavingsCents: 0 }),
          scenario({ code: 'mix', displayName: 'A plan per hotel', totalCents: 168_760, netSavingsCents: 31_240 }),
        ],
      }),
    );
    expect(v.headline).toBe('Saves about $312.40');
    expect(v.totalText).toBe('Total $1687.60');
    expect(v.bestSummary).toBe('Best: Table-Service Dining Plan at Beach Club (pay cash elsewhere)');
    expect(v.miniStats.find((m) => m.code === 'mix')?.isRecommended).toBe(true);
  });

  it('slotMatchesFilter distinguishes credit slots from cash slots while skipping skipped/empty slots', () => {
    const creditEntry = { date: '2027-03-02', mealPeriod: 'dinner' as const, kind: 'restaurant' as const, experienceId: 'e1', experienceName: 'Ohana', placeholderKind: null, plannedItemId: null, excludedKeys: [] };
    const skipEntry = { ...creditEntry, kind: 'skip' as const };
    const usedLine = line({ date: '2027-03-02', mealPeriod: 'dinner', action: 'use_plan' });
    const partialLine = line({ date: '2027-03-02', mealPeriod: 'dinner', action: 'partly_covered' });
    const cashLine = line({ date: '2027-03-02', mealPeriod: 'dinner', action: 'pay_out_of_pocket' });

    expect(lineUsesCredit(usedLine)).toBe(true);
    expect(lineUsesCredit(partialLine)).toBe(true);
    expect(lineUsesCredit(cashLine)).toBe(false);
    expect(slotMatchesFilter(creditEntry, usedLine, 'credits')).toBe(true);
    expect(slotMatchesFilter(creditEntry, usedLine, 'cash')).toBe(false);
    expect(slotMatchesFilter(creditEntry, cashLine, 'cash')).toBe(true);
    expect(slotMatchesFilter(skipEntry, undefined, 'cash')).toBe(false);
    expect(slotMatchesFilter(undefined, undefined, 'cash')).toBe(false);
    expect(slotMatchesFilter(undefined, undefined, 'all')).toBe(true);
  });

  it('groupStayChapters assigns hand-off dates once and hides empty chapters/days under filters', () => {
    const s1 = planStay({ key: 's1', label: 'All-Star', checkIn: '2027-12-15', checkOut: '2027-12-16', nights: 1 });
    const s2 = planStay({ key: 's2', label: 'Beach Club', checkIn: '2027-12-16', checkOut: '2027-12-18', nights: 2 });
    const entries = [
      { date: '2027-12-15', mealPeriod: 'dinner' as const, kind: 'restaurant' as const, experienceId: 'e1', experienceName: 'Boma', placeholderKind: null, plannedItemId: null, excludedKeys: [] },
      { date: '2027-12-16', mealPeriod: 'dinner' as const, kind: 'restaurant' as const, experienceId: 'e2', experienceName: 'Cape May', placeholderKind: null, plannedItemId: null, excludedKeys: [] },
      { date: '2027-12-17', mealPeriod: 'breakfast' as const, kind: 'restaurant' as const, experienceId: 'e3', experienceName: 'Ale', placeholderKind: null, plannedItemId: null, excludedKeys: [] },
    ];
    const lines = [
      line({ date: '2027-12-15', mealPeriod: 'dinner', action: 'pay_out_of_pocket' }),
      line({ date: '2027-12-16', mealPeriod: 'dinner', action: 'use_plan' }),
      line({ date: '2027-12-17', mealPeriod: 'breakfast', action: 'pay_out_of_pocket' }),
    ];

    const all = groupStayChapters([s1, s2], entries, lines, 'all');
    expect(all[0]!.visibleDays.map((d) => d.date)).toEqual(['2027-12-15']);
    expect(all[1]!.visibleDays.map((d) => d.date)).toEqual(['2027-12-16', '2027-12-17', '2027-12-18']);
    expect(all[1]!.visibleDays[0]!.handOff).toBe(true);

    const creditsOnly = groupStayChapters([s1, s2], entries, lines, 'credits');
    expect(creditsOnly[0]!.visibleDays).toHaveLength(0);
    expect(creditsOnly[0]!.matchingSlotCount).toBe(0);
    expect(creditsOnly[1]!.visibleDays.map((d) => d.date)).toEqual(['2027-12-16']);
  });

  it('alternativeMatrixRows maps stay combinations to clean pill columns', () => {
    const s1 = planStay({ key: 's1', label: 'All-Star', status: 'no_plan' });
    const s2 = planStay({ key: 's2', label: 'Beach Club', status: 'have_plan', heldPlan: 'table_service' });
    const rows = alternativeMatrixRows(
      result({
        stays: [s1, s2],
        alternatives: [{ combination: { s1: 'none', s2: 'quick_service' }, totalCents: 150_000, netSavingsCents: -5_000 }],
      }),
    );
    expect(rows).toEqual([
      {
        columns: [
          { stayKey: 's1', stayLabel: 'All-Star', optionCode: 'none', optionShortLabel: 'No Plan', held: false },
          { stayKey: 's2', stayLabel: 'Beach Club', optionCode: 'quick_service', optionShortLabel: 'Quick-Service', held: true },
        ],
        total: '$1500.00',
        net: 'Costs $50.00 more',
        isCostMore: true,
        withinMargin: false,
      },
    ]);
  });

  it('verdictCompactView and alternativeMatrixRows surface tied options for about_even', () => {
    const s1 = planStay({ key: 's1', label: "Disney's All-Star Sports Resort", status: 'no_plan' });
    const s2 = planStay({ key: 's2', label: "Disney's Animal Kingdom Lodge", status: 'no_plan' });
    const multiEven = result({
      verdict: 'about_even',
      recommended: 'none',
      bestPlan: null,
      evenThresholdCents: 6_922,
      stays: [s1, s2],
      alternatives: [
        { combination: { s1: 'none', s2: 'table_service' }, totalCents: 339_575, netSavingsCents: 6_501 },
        { combination: { s1: 'quick_service', s2: 'table_service' }, totalCents: 344_138, netSavingsCents: 1_938 },
        { combination: { s1: 'table_service', s2: 'table_service' }, totalCents: 361_325, netSavingsCents: -15_249 },
      ],
    });
    const compact = verdictCompactView(multiEven);
    expect(compact.headline).toBe('Too close to call');
    expect(compact.bestMain).toBe('No plan and 2 combos are within ~2% ($69.22)');
    expect(compact.bestAside).toBe('Slight edge: Table-Service Dining Plan at Animal Kingdom Lodge (saves $65.01)');
    expect(alternativeMatrixRows(multiEven).map((r) => r.withinMargin)).toEqual([true, true, false]);
  });

  it('formats shortHotelLabel, headerMetaSummary, and clean per-hotel mix verdict wording', () => {
    expect(shortHotelLabel("Disney's All-Star Sports Resort")).toBe('All-Star Sports');
    expect(shortHotelLabel("Disney's Animal Kingdom Lodge")).toBe('Animal Kingdom Lodge');
    expect(shortHotelLabel('Hilton Buena Vista')).toBe('Hilton Buena Vista');
    expect(headerMetaSummary(3, { checkIn: '2027-12-15', checkOut: '2027-12-31', nights: 16 })).toBe('3 guests · Dec 15–31 (16n)');
    expect(headerMetaSummary(1, null)).toBe('1 guest');

    const v = verdictCompactView(
      result({
        verdict: 'plan_costs_more',
        recommended: 'none',
        bestPlan: null,
        breakEvenGapCents: 16_065,
        scenarios: [
          scenario({ code: 'none', displayName: 'No Dining Plan', totalCents: 70_584 }),
          scenario({ code: 'quick_service', displayName: 'Disney Quick-Service Dining Plan', totalCents: 80_000 }),
          scenario({ code: 'table_service', displayName: 'Disney Dining Plan', totalCents: 90_000 }),
          scenario({ code: 'mix', displayName: 'A plan per hotel', totalCents: 86_649, netSavingsCents: -16_065 }),
        ],
      }),
    );
    expect(v.headline).toBe('No dining plan saves $160.65');
    expect(v.bestSummary).toBe('Paying as you go beats per-hotel plan mix');
    expect(v.miniStats.map((m) => m.label)).toEqual(['No Plan', 'Best Mix', 'All QS Plan', 'All Dining']);

    const sens = sensitivityRows(
      result({
        sensitivity: [
          { orderStyle: 'budget', bestPlan: null, recommended: 'none', netSavingsCents: -20_000 },
          { orderStyle: 'splurge', bestPlan: null, recommended: 'mix', netSavingsCents: 16_389 },
        ],
      }),
      'splurge',
    );
    expect(sens[0]).toMatchObject({ best: 'No Dining Plan', net: 'No plan is cheapest', current: false });
    expect(sens[1]).toMatchObject({ best: 'Per-Hotel Plan Mix', net: 'Saves $163.89', current: true });
  });
});
