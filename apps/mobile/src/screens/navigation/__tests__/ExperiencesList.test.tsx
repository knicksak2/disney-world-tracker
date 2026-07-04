/**
 * ExperiencesList RNTL tests (friend-profile-navigation, task 5.6).
 *
 * Validates: Requirements 5.4, 13.4, 14.1, 14.2, 14.3, 14.8, 14.9
 *
 * `ExperiencesList` is the shared Experiences list + Experience_Filter UI
 * rendered by both the Friend_Profile_View's Experiences mode and the
 * Own_Stats_View's Own_Experiences mode. The behaviours worth pinning at the
 * component level are:
 *
 *   - On first display both filter controls default to `All` / `All`, so the
 *     unfiltered named set is shown (R14.2).
 *   - The Park control offers `All` plus exactly one option per catalog `PARKS`
 *     entry, and the Category control offers `All` plus exactly one option per
 *     `EXPERIENCE_CATEGORIES` entry (R14.3).
 *   - Two mounted lists hold fully independent filter state, so changing one
 *     list's selection never moves the other's (R14.1).
 *   - When the active filter matches no loaded entry, the controls remain and a
 *     "no match" message is shown (R14.8).
 *   - When the unfiltered named set is empty, the mode empty-state is shown
 *     instead of the filter + list (R5.4, R13.4).
 *   - Each filter control exposes an `accessibilityLabel` naming the control and
 *     an `accessibilityValue` reflecting the active selection (R14.9).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
} from '@dwt/shared';

import { ExperiencesList } from '../ExperiencesList';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: null,
    sharedNote: null,
    ...overrides,
  };
}

/** A small, all-named set spread across two Parks and two Categories. */
const ENTRIES: readonly CompletionEntryDTO[] = [
  makeEntry({ experienceName: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' }),
  makeEntry({ experienceName: 'Spaceship Earth', park: 'EPCOT', category: 'Ride' }),
  makeEntry({ experienceName: 'Festival of the Lion King', park: 'Animal Kingdom', category: 'Show' }),
];

/** Read the `accessibilityValue.text` of a control wrapper. */
function controlValue(testID: string): string | undefined {
  return screen.getByTestId(testID).props.accessibilityValue?.text as
    | string
    | undefined;
}

/** Read the `accessibilityLabel` of a control wrapper. */
function controlLabel(testID: string): string | undefined {
  return screen.getByTestId(testID).props.accessibilityLabel as
    | string
    | undefined;
}

// ---------------------------------------------------------------------------
// Default selections
// ---------------------------------------------------------------------------

describe('ExperiencesList — defaults to All / All (R14.2)', () => {
  test('both controls report All on first display', () => {
    render(<ExperiencesList entries={ENTRIES} testIDPrefix="friend" />);

    expect(controlValue('friend-filter-park')).toBe('All');
    expect(controlValue('friend-filter-category')).toBe('All');

    // The All option chips are the active selection on first display.
    expect(screen.getByTestId('friend-filter-park-option-All')).toBeTruthy();
    expect(screen.getByTestId('friend-filter-category-option-All')).toBeTruthy();

    // With both selections All, every named entry is shown.
    expect(screen.getByTestId('friend-experience-row-0')).toBeTruthy();
    expect(screen.getByTestId('friend-experience-row-1')).toBeTruthy();
    expect(screen.getByTestId('friend-experience-row-2')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Option sets
// ---------------------------------------------------------------------------

describe('ExperiencesList — option sets equal catalog tuples plus All (R14.3)', () => {
  test('Park control offers All plus exactly one option per catalog Park', () => {
    render(<ExperiencesList entries={ENTRIES} testIDPrefix="friend" />);

    expect(screen.getByTestId('friend-filter-park-option-All')).toBeTruthy();
    for (const park of PARKS) {
      expect(screen.getByTestId(`friend-filter-park-option-${park}`)).toBeTruthy();
    }
    // No park options beyond All + the catalog tuple.
    expect(
      screen.queryByTestId('friend-filter-park-option-Narnia'),
    ).toBeNull();
  });

  test('Category control offers All plus exactly one option per Experience_Category', () => {
    render(<ExperiencesList entries={ENTRIES} testIDPrefix="friend" />);

    expect(screen.getByTestId('friend-filter-category-option-All')).toBeTruthy();
    for (const category of EXPERIENCE_CATEGORIES) {
      expect(
        screen.getByTestId(`friend-filter-category-option-${category}`),
      ).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Independent filter state
// ---------------------------------------------------------------------------

describe('ExperiencesList — two mounted lists hold independent filter state (R14.1)', () => {
  test('changing one list selection leaves the other list unchanged', () => {
    render(
      <>
        <ExperiencesList entries={ENTRIES} testIDPrefix="friend" />
        <ExperiencesList entries={ENTRIES} testIDPrefix="own" />
      </>,
    );

    // Both start at All / All.
    expect(controlValue('friend-filter-park')).toBe('All');
    expect(controlValue('own-filter-park')).toBe('All');

    // Narrow only the friend list to EPCOT.
    fireEvent.press(screen.getByTestId('friend-filter-park-option-EPCOT'));

    // The friend list moves; the own list does not.
    expect(controlValue('friend-filter-park')).toBe('EPCOT');
    expect(controlValue('own-filter-park')).toBe('All');

    // Narrow only the own list's category to Show.
    fireEvent.press(screen.getByTestId('own-filter-category-option-Show'));

    expect(controlValue('own-filter-category')).toBe('Show');
    // Friend category is still its default.
    expect(controlValue('friend-filter-category')).toBe('All');
    // Friend park selection is retained, proving the two are decoupled.
    expect(controlValue('friend-filter-park')).toBe('EPCOT');
  });
});

// ---------------------------------------------------------------------------
// No-match message
// ---------------------------------------------------------------------------

describe('ExperiencesList — no-match message (R14.8)', () => {
  test('shows the no-match message and keeps the controls when the filter matches nothing', () => {
    // All entries are in Magic Kingdom / EPCOT / Animal Kingdom; pick a Park
    // that is present in the catalog but absent from the loaded entries.
    render(<ExperiencesList entries={ENTRIES} testIDPrefix="friend" />);

    fireEvent.press(screen.getByTestId('friend-filter-park-option-Blizzard Beach'));

    // The no-match empty-state is shown...
    expect(screen.getByTestId('friend-experiences-no-match')).toBeTruthy();
    // ...no rows survive...
    expect(screen.queryByTestId('friend-experience-row-0')).toBeNull();
    // ...and the filter controls remain available so the user can recover.
    expect(screen.getByTestId('friend-filter-park')).toBeTruthy();
    expect(screen.getByTestId('friend-filter-category')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Empty named-set message
// ---------------------------------------------------------------------------

describe('ExperiencesList — empty named-set message (R5.4, R13.4)', () => {
  test('shows the mode empty-state and withholds the controls when no entries are loaded', () => {
    render(<ExperiencesList entries={[]} testIDPrefix="friend" />);

    expect(screen.getByTestId('friend-experiences-empty')).toBeTruthy();
    // The filter controls are withheld in the empty-set state.
    expect(screen.queryByTestId('friend-filter-park')).toBeNull();
    expect(screen.queryByTestId('friend-filter-category')).toBeNull();
  });

  test('treats an all-unnamed set as empty (R5.4, R13.4)', () => {
    const unnamed: readonly CompletionEntryDTO[] = [
      makeEntry({ experienceName: '' }),
      makeEntry({ experienceName: '   ' }),
    ];

    render(<ExperiencesList entries={unnamed} testIDPrefix="own" />);

    expect(screen.getByTestId('own-experiences-empty')).toBeTruthy();
    expect(screen.queryByTestId('own-filter-park')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accessibility wiring
// ---------------------------------------------------------------------------

describe('ExperiencesList — control accessibility (R14.9)', () => {
  test('each control exposes a naming accessibilityLabel and a selection accessibilityValue', () => {
    render(<ExperiencesList entries={ENTRIES} testIDPrefix="friend" />);

    // Labels name each control.
    expect(controlLabel('friend-filter-park')).toBe('Filter by park');
    expect(controlLabel('friend-filter-category')).toBe('Filter by experience type');

    // Values track the active selection as it changes.
    expect(controlValue('friend-filter-park')).toBe('All');
    fireEvent.press(screen.getByTestId('friend-filter-park-option-Magic Kingdom'));
    expect(controlValue('friend-filter-park')).toBe('Magic Kingdom');

    // Category value uses the friendly display label for the selection.
    fireEvent.press(
      screen.getByTestId('friend-filter-category-option-Character_Meet'),
    );
    expect(controlValue('friend-filter-category')).toBe('Character Meet');
  });
});
