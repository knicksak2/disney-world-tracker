import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import StartHereCard from '../StartHereCard';

describe('StartHereCard', () => {
  it('renders N of 4 progress and handles all four checklist items plus Dismiss', () => {
    const onLogFirst = jest.fn();
    const onStarFavorite = jest.fn();
    const onCreateTrip = jest.fn();
    const onClaimPin = jest.fn();
    const onDismiss = jest.fn();

    render(
      <StartHereCard
        checklist={{
          loggedFirstExperience: true,
          starredFavorite: false,
          hasTrip: true,
          claimedPin: false,
        }}
        onLogFirst={onLogFirst}
        onStarFavorite={onStarFavorite}
        onCreateTrip={onCreateTrip}
        onClaimPin={onClaimPin}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId('home-start-here-card')).toBeTruthy();
    expect(screen.getByTestId('start-here-progress')).toHaveTextContent('2 of 4');
    expect(screen.getByText('Favorite a ride')).toBeTruthy();
    expect(screen.queryByText(/Star a favorite/i)).toBeNull();

    fireEvent.press(screen.getByTestId('start-here-item-log'));
    fireEvent.press(screen.getByTestId('start-here-item-favorite'));
    fireEvent.press(screen.getByTestId('start-here-item-trip'));
    fireEvent.press(screen.getByTestId('start-here-item-pin'));
    fireEvent.press(screen.getByTestId('start-here-dismiss-btn'));

    expect(onLogFirst).toHaveBeenCalledTimes(1);
    expect(onStarFavorite).toHaveBeenCalledTimes(1);
    expect(onCreateTrip).toHaveBeenCalledTimes(1);
    expect(onClaimPin).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
