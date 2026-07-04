/**
 * CompletionRow RNTL tests (friend-profile-navigation, task 5.4).
 *
 * Validates: Requirements 3.5, 4.4, 5.2, 13.2
 *
 * `CompletionRow` is the shared per-entry row rendered by the Parks,
 * Categories, and Experiences modes on both the Friend_Profile_View and the
 * Own_Stats_View. The behaviours worth pinning at the component level are:
 *
 *   - The Experience name and the Completion date (as a calendar date) always
 *     render, regardless of `fields` (R3.5, R4.4, R5.2, R13.2).
 *   - The Rating badge renders only when a Rating is present and is omitted
 *     when `rating === null` (R3.5, R4.4, R5.2, R13.2).
 *   - The shared Note renders only when one is present and is omitted when
 *     `sharedNote === null` (R3.5, R4.4, R5.2, R13.2).
 *   - The `fields` prop selects the contextual metadata line: `'parks'` omits
 *     the Park (implied by the Park_Group), `'categories'` omits the Category
 *     (implied by the Category_Group), and `'experiences'` shows both
 *     (R3.5, R4.4, R5.2).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CompletionEntryDTO } from '@dwt/shared';

import { CompletionRow } from '../CompletionRow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
//
// `Space Mountain` / `Magic Kingdom` / `Ride` are chosen so the name, Park,
// and Category labels are all distinct substrings, letting a regex matcher
// prove a given field is present or omitted from the meta line. The
// `2024-01-05` date renders as `Jan 5, 2024` (parsed by string parts, so it
// never shifts with the device time zone).

const PARK = 'Magic Kingdom';
const CATEGORY_LABEL = 'Ride';
const NAME = 'Space Mountain';
const DATE_TEXT = 'Jan 5, 2024';
const EXPERIENCE_ID = '11111111-1111-4111-8111-111111111111';

function makeEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: EXPERIENCE_ID,
    experienceName: NAME,
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: null,
    sharedNote: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Always-rendered fields: name + calendar date
// ---------------------------------------------------------------------------

describe('CompletionRow — name and date always render', () => {
  test.each(['parks', 'categories', 'experiences'] as const)(
    'renders the Experience name and calendar date in %s mode (R3.5, R4.4, R5.2, R13.2)',
    (fields) => {
      render(<CompletionRow entry={makeEntry()} fields={fields} />);

      expect(screen.getByText(NAME)).toBeTruthy();
      // The Completion date renders as a calendar date inside the meta line.
      expect(screen.getByText(new RegExp(DATE_TEXT))).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------
// Rating: present only when a Rating exists
// ---------------------------------------------------------------------------

describe('CompletionRow — Rating appears only when present', () => {
  test('renders the Rating badge when a Rating is present (R3.5, R4.4, R5.2, R13.2)', () => {
    render(
      <CompletionRow entry={makeEntry({ rating: 8 })} fields="experiences" />,
    );

    expect(screen.getByText('8/10')).toBeTruthy();
  });

  test('omits the Rating when no Rating is present (R3.5, R4.4, R5.2, R13.2)', () => {
    render(
      <CompletionRow entry={makeEntry({ rating: null })} fields="experiences" />,
    );

    expect(screen.queryByText(/\/10/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Note: present only when a shared Note exists
// ---------------------------------------------------------------------------

describe('CompletionRow — Note appears only when present', () => {
  const NOTE = 'Loved the launch';

  test('renders the shared Note when one is present (R3.5, R4.4, R5.2, R13.2)', () => {
    render(
      <CompletionRow
        entry={makeEntry({ sharedNote: NOTE })}
        fields="experiences"
      />,
    );

    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  test('omits the Note when no shared Note is present (R3.5, R4.4, R5.2, R13.2)', () => {
    render(
      <CompletionRow
        entry={makeEntry({ sharedNote: null })}
        fields="experiences"
      />,
    );

    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `fields` prop: per-mode contextual metadata line
// ---------------------------------------------------------------------------

describe('CompletionRow — fields prop selects the meta line per mode', () => {
  test('experiences mode shows both Park and Category (R5.2)', () => {
    render(<CompletionRow entry={makeEntry()} fields="experiences" />);

    expect(screen.getByText(new RegExp(PARK))).toBeTruthy();
    expect(screen.getByText(new RegExp(`\\b${CATEGORY_LABEL}\\b`))).toBeTruthy();
    // Both contextual fields plus the date share a single meta line.
    expect(
      screen.getByText(`${PARK} \u00b7 ${CATEGORY_LABEL} \u00b7 ${DATE_TEXT}`),
    ).toBeTruthy();
  });

  test('parks mode omits the Park and keeps the Category (R3.5)', () => {
    render(<CompletionRow entry={makeEntry()} fields="parks" />);

    expect(screen.queryByText(new RegExp(PARK))).toBeNull();
    expect(screen.getByText(`${CATEGORY_LABEL} \u00b7 ${DATE_TEXT}`)).toBeTruthy();
  });

  test('categories mode omits the Category and keeps the Park (R4.4)', () => {
    render(<CompletionRow entry={makeEntry()} fields="categories" />);

    expect(screen.queryByText(new RegExp(`\\b${CATEGORY_LABEL}\\b`))).toBeNull();
    expect(screen.getByText(`${PARK} \u00b7 ${DATE_TEXT}`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// testID passthrough
// ---------------------------------------------------------------------------

describe('CompletionRow — testID', () => {
  test('forwards an optional testID to the row container', () => {
    render(
      <CompletionRow
        entry={makeEntry()}
        fields="experiences"
        testID="friend-completion-0"
      />,
    );

    expect(screen.getByTestId('friend-completion-0')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Affordance gating (experience-detail-navigation, task 5.3)
// ---------------------------------------------------------------------------
//
// A row is an activatable Completed_Experience_Row only when BOTH an
// `onOpenExperience` callback is supplied AND the entry resolves to a
// navigation target (`resolveExperienceTarget(entry) !== null`). In every
// other case the row must render as a plain, non-activatable card that exposes
// no activatable control and performs no navigation on a press or assistive
// activation gesture.
//
// Validates: Requirements 4.4, 6.1

describe('CompletionRow — affordance gating', () => {
  // (a) No callback supplied → plain, non-activatable card, even though the
  // entry carries a perfectly valid Experience_Id (R4.4).
  describe('when no onOpenExperience callback is supplied', () => {
    test('exposes no activatable control (R4.4)', () => {
      render(
        <CompletionRow
          entry={makeEntry()}
          fields="experiences"
          testID="row"
        />,
      );

      // No button role is exposed for assistive technology.
      expect(screen.queryByRole('button')).toBeNull();

      // The row container carries no `onPress` handler.
      const row = screen.getByTestId('row');
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.accessibilityRole).not.toBe('button');
    });

    test('pressing the row performs no navigation (R4.4)', () => {
      render(
        <CompletionRow
          entry={makeEntry()}
          fields="experiences"
          testID="row"
        />,
      );

      // Firing a press against a non-activatable row is a no-op; there is no
      // handler to invoke, so nothing happens and no navigation is attempted.
      expect(() => fireEvent.press(screen.getByTestId('row'))).not.toThrow();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  // (b) Callback supplied, but the Experience_Id is missing/blank →
  // `resolveExperienceTarget` returns null, so the row stays non-activatable
  // and `onOpenExperience` is never called (R6.1).
  describe('when a callback is supplied but the Experience_Id is unavailable', () => {
    test.each([
      ['blank', ''],
      ['whitespace-only', '   '],
    ])(
      'renders no activatable control and never navigates for a %s id (R6.1)',
      (_label, experienceId) => {
        const onOpenExperience = jest.fn();
        render(
          <CompletionRow
            entry={makeEntry({ experienceId })}
            fields="experiences"
            onOpenExperience={onOpenExperience}
            testID="row"
          />,
        );

        expect(screen.queryByRole('button')).toBeNull();
        const row = screen.getByTestId('row');
        expect(row.props.onPress).toBeUndefined();

        // Even an explicit press performs no navigation.
        fireEvent.press(row);
        expect(onOpenExperience).not.toHaveBeenCalled();
      },
    );

    test('renders no activatable control and never navigates for a missing id (R6.1)', () => {
      const onOpenExperience = jest.fn();
      // Model a malformed/partially-decoded entry whose Experience_Id field is
      // absent entirely, exercising the client-side defensive guard.
      const { experienceId: _omitted, ...rest } = makeEntry();
      render(
        <CompletionRow
          entry={rest as CompletionEntryDTO}
          fields="experiences"
          onOpenExperience={onOpenExperience}
          testID="row"
        />,
      );

      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByTestId('row').props.onPress).toBeUndefined();

      fireEvent.press(screen.getByTestId('row'));
      expect(onOpenExperience).not.toHaveBeenCalled();
    });
  });
});
