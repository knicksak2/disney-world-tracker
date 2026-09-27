// Feature: experience-detail-redesign, Task 18.2 — ShowtimesCard unit tests
//
// Validates: Requirements 14.2

import React from 'react';
import { render } from '@testing-library/react-native';
import type { Showtime } from '@dwt/shared';

import ShowtimesCard from '../ShowtimesCard';

describe('ShowtimesCard', () => {
  it('renders empty state when no showtimes are scheduled', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <ShowtimesCard showtimes={[]} />,
    );

    expect(getByTestId('showtimes-card')).toBeTruthy();
    expect(getByTestId('showtimes-empty')).toBeTruthy();
    expect(getByText('No performance times scheduled')).toBeTruthy();
    expect(queryByTestId('next-showtime-indicator')).toBeNull();
  });

  it('renders header, pulse badge for next show, and horizontal pills with (Next) label', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const showtimes: Showtime[] = [
      { start: '2026-09-25T10:00:00Z', end: '2026-09-25T10:00:00Z', type: 'Standard' },
      { start: '2026-09-25T13:00:00Z', end: '2026-09-25T13:00:00Z', type: 'Standard' },
      { start: '2026-09-25T14:00:00Z', end: '2026-09-25T14:00:00Z', type: 'Standard' },
    ];

    const { getByTestId, getAllByTestId, getByText, queryByTestId } = render(
      <ShowtimesCard showtimes={showtimes} now={now} />,
    );

    expect(getByTestId('showtimes-card')).toBeTruthy();
    expect(getByText("Today's Showtimes")).toBeTruthy();

    // Pulse badge indicates next show (1:00 PM EDT / WDW time or matching formatParkTime)
    const nextIndicator = getByTestId('next-showtime-indicator');
    expect(nextIndicator).toBeTruthy();

    const pills = getAllByTestId('showtime-row');
    expect(pills).toHaveLength(3);

    const times = getAllByTestId('showtime-time');
    // The second show (13:00) is the first upcoming show after 12:00
    expect(times[1]!.props.children).toMatch(/\(Next\)$/);
    // The first show does not have (Next)
    expect(times[0]!.props.children).not.toMatch(/\(Next\)$/);
    // Standard type is omitted from notice badge
    expect(queryByTestId('showtime-type')).toBeNull();
  });

  it('deduplicates start and end time when identical (no "7:00 PM – 7:00 PM")', () => {
    const now = new Date('2026-09-25T18:00:00Z');
    const showtimes: Showtime[] = [
      { start: '2026-09-25T19:00:00Z', end: '2026-09-25T19:00:00Z', type: 'Special Ticketed Event' },
    ];

    const { getByTestId, getByText } = render(
      <ShowtimesCard showtimes={showtimes} now={now} />,
    );

    const timeElement = getByTestId('showtime-time');
    const renderedText = String(timeElement.props.children);
    // Must NOT contain duplicate range " – "
    expect(renderedText).not.toContain('\u2013');
    // Must contain Special Ticketed Event notice
    expect(getByTestId('showtime-type')).toBeTruthy();
    expect(getByText('Special Ticketed Event')).toBeTruthy();
  });

  it('renders time range when start and end times differ', () => {
    const now = new Date('2026-09-25T18:00:00Z');
    const showtimes: Showtime[] = [
      { start: '2026-09-25T19:00:00Z', end: '2026-09-25T19:30:00Z', type: 'Standard' },
    ];

    const { getByTestId } = render(
      <ShowtimesCard showtimes={showtimes} now={now} />,
    );

    const timeElement = getByTestId('showtime-time');
    const renderedText = String(timeElement.props.children);
    expect(renderedText).toContain('\u2013');
  });

  it('omits next-showtime-indicator and marks all pills as past when all shows have finished', () => {
    const now = new Date('2026-09-25T23:59:59Z');
    const showtimes: Showtime[] = [
      { start: '2026-09-25T10:00:00Z', end: '2026-09-25T10:00:00Z' },
      { start: '2026-09-25T14:00:00Z', end: '2026-09-25T14:00:00Z' },
    ];

    const { queryByTestId, getAllByTestId } = render(
      <ShowtimesCard showtimes={showtimes} now={now} />,
    );

    expect(queryByTestId('next-showtime-indicator')).toBeNull();
    const times = getAllByTestId('showtime-time');
    expect(times[0]!.props.children).not.toMatch(/\(Next\)$/);
    expect(times[1]!.props.children).not.toMatch(/\(Next\)$/);
  });
});
