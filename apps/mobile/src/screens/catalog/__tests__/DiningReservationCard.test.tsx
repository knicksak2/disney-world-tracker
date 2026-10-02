// Feature: experience-detail-redesign — DiningReservationCard unit tests
//
// Regression coverage for quick-service restaurants (Casey's Corner, Cove
// Bar, Aloha Isle, etc.) whose ThemeParks.wiki live feed genuinely has no
// standby-queue or dining-availability data to report. Once the backend's
// `themeParksLiveService.ts` stops treating an empty `liveData` feed as a
// failure, the screen receives a resolved-but-empty `LiveDetailDTO`
// (`status: 'Unknown'`, empty `diningAvailability`/`operatingHours`) instead
// of a thrown `live_unavailable`. This card must render its normal calm
// "Open Today" state for that shape — not an error, not a scary badge — since
// it is the component `TodayInParkLens` renders once `liveQ.isError` is
// false.

import React from 'react';
import { render } from '@testing-library/react-native';
import type { LiveDetailDTO } from '@dwt/shared';

import DiningReservationCard from '../DiningReservationCard';

/** The exact shape `projectThemeParksLive` produces for an empty/absent input. */
const EMPTY_UNKNOWN_LIVE_DETAIL: LiveDetailDTO = {
  status: 'Unknown',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
};

describe('DiningReservationCard — resolved-but-empty live data (regression)', () => {
  it('renders the normal Open Today state for a quick-service restaurant with no live data, not an error', () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <DiningReservationCard
        experienceName="Aloha Isle"
        diningUrl={null}
        liveDetail={EMPTY_UNKNOWN_LIVE_DETAIL}
        isQuickService
        onReserve={() => {}}
      />,
    );

    // The card renders normally — no "unavailable" testID or error copy.
    expect(getByTestId('dining-reservation-card')).toBeTruthy();
    expect(queryByTestId('live-unavailable')).toBeNull();

    // status: 'Unknown' is not 'Closed', so the card shows the calm default
    // state rather than a closed/error badge.
    expect(getByText('Open Today')).toBeTruthy();
    // Quick-service default label (no diningAvailability entry to override it).
    expect(getByText('Counter Service & Mobile Order')).toBeTruthy();
  });

  it('renders the normal Reservations Available state for a table-service restaurant with no live data', () => {
    const { getByText, queryByTestId } = render(
      <DiningReservationCard
        experienceName="Be Our Guest Restaurant"
        diningUrl="https://disneyworld.disney.go.com/dining/magic-kingdom/be-our-guest-restaurant/"
        liveDetail={EMPTY_UNKNOWN_LIVE_DETAIL}
        onReserve={() => {}}
      />,
    );

    expect(queryByTestId('live-unavailable')).toBeNull();
    expect(getByText('Open Today')).toBeTruthy();
    // Reserve button still renders since a dining_url is present, independent
    // of live data being empty.
    expect(getByText("Reserve on Disney's Site")).toBeTruthy();
  });

  it('still shows Closed when the live feed explicitly reports Closed (not conflated with "no data")', () => {
    const { getByText } = render(
      <DiningReservationCard
        experienceName="Casey's Corner"
        diningUrl={null}
        liveDetail={{ ...EMPTY_UNKNOWN_LIVE_DETAIL, status: 'Closed' }}
        isQuickService
        onReserve={() => {}}
      />,
    );

    expect(getByText('Closed')).toBeTruthy();
  });

  it('renders sensibly even with no liveDetail at all (e.g. still loading)', () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <DiningReservationCard
        experienceName="Aloha Isle"
        diningUrl={null}
        liveDetail={undefined}
        isQuickService
        onReserve={() => {}}
      />,
    );

    expect(getByTestId('dining-reservation-card')).toBeTruthy();
    expect(queryByTestId('live-unavailable')).toBeNull();
    expect(getByText('Open Today')).toBeTruthy();
  });

  it('renders Add to List button and invokes onAddToList on press (R9.1)', () => {
    const onAddToListMock = jest.fn();
    const onLogDishMock = jest.fn();
    const { getByTestId, getByText } = render(
      <DiningReservationCard
        experienceName="Jungle Navigation Co. LTD Skipper Canteen"
        diningUrl={null}
        liveDetail={EMPTY_UNKNOWN_LIVE_DETAIL}
        onReserve={() => {}}
        onLogFoodItem={onLogDishMock}
        onAddToList={onAddToListMock}
      />,
    );

    const addToListBtn = getByTestId('dining-card-add-to-list-btn');
    expect(addToListBtn).toBeTruthy();
    expect(getByText('Add to List')).toBeTruthy();

    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.press(addToListBtn);
    expect(onAddToListMock).toHaveBeenCalledTimes(1);
  });
});
