// Feature: experience-detail-redesign, Task 5.2 — AboutSection render tests
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
//
// These example (non-property) tests mount the real `AboutSection` in isolation
// and drive its overflow detection deterministically. The component measures
// the true line count of the full description on a hidden, unclamped `Text`
// (testID `about-measure`) via `onTextLayout`; in a test environment that
// callback never fires on its own, so each test fires it explicitly with a
// synthetic `nativeEvent.lines` array to simulate a laid-out line count.
//
//   - collapsed (default) clamps the visible copy to `COLLAPSED_LINE_LIMIT`
//     (numberOfLines=4) and, once overflow is reported, shows "Read more"
//     (R5.1, R5.2, R5.4, R5.9).
//   - activating the toggle expands to the full text (numberOfLines undefined)
//     and flips the affordance to "Read less" (R5.5, R5.6); activating again
//     re-collapses (R5.7).
//   - a description at or under the collapsed limit reports no overflow, so the
//     toggle is omitted (R5.3).
//   - absent / empty / whitespace-only descriptions render the existing
//     "No description available." empty state and no toggle (R5.8).
//   - the toggle carries a non-empty accessibility label reflecting the current
//     action (R5.10).

import React from 'react';
import {
  fireEvent,
  render,
  type RenderResult,
} from '@testing-library/react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';

import AboutSection, { COLLAPSED_LINE_LIMIT } from '../AboutSection';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/** A long, multi-paragraph description used for the overflow cases. */
const LONG_DESCRIPTION =
  'This iconic attraction takes guests on a grand tour of a beloved world. ' +
  'Board your vehicle and drift past scene after scene of animated tableaux, ' +
  'each richly detailed and lovingly crafted. The journey winds through ' +
  'sunlit gardens, moonlit harbors, and cavernous show buildings before ' +
  'returning you gently to the loading dock, humming the theme all the way.';

const SHORT_DESCRIPTION = 'A short and pleasant little ride.';

/**
 * Fire the hidden measurement `Text`'s `onTextLayout` with a synthetic line
 * count. The component only reads `event.nativeEvent.lines.length`, so we pass
 * an array of exactly `lineCount` placeholder line objects.
 */
function fireMeasureLayout(view: RenderResult, lineCount: number): void {
  // The measurement `Text` is hidden from assistive tech, so the query must
  // opt into hidden elements to reach it.
  const measure = view.getByTestId('about-measure', {
    includeHiddenElements: true,
  });
  const lines = Array.from({ length: lineCount }, () => ({
    text: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ascender: 0,
    descender: 0,
    capHeight: 0,
    xHeight: 0,
  }));
  const event = {
    nativeEvent: { lines },
  } as unknown as NativeSyntheticEvent<TextLayoutEventData>;
  fireEvent(measure, 'textLayout', event);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AboutSection render behavior (R5.1-R5.10)', () => {
  // -------------------------------------------------------------------------
  // R5.1 / R5.2 / R5.4 / R5.9 — overflowing text renders collapsed with a
  // 4-line clamp and a "Read more" affordance.
  // -------------------------------------------------------------------------
  test('R5.1/R5.2/R5.4/R5.9: overflowing description renders collapsed with a 4-line clamp and "Read more"', () => {
    const view = render(<AboutSection description={LONG_DESCRIPTION} />);

    // The section and its body are present; the empty state is not.
    expect(view.queryByTestId('about-section')).not.toBeNull();
    expect(view.queryByTestId('about-empty')).toBeNull();

    // Simulate the description laying out to more than the collapsed limit.
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT + 3);

    // R5.1 / R5.9: initial (collapsed) render clamps the visible copy to 4.
    expect(view.getByTestId('about-text').props.numberOfLines).toBe(
      COLLAPSED_LINE_LIMIT,
    );

    // R5.2 / R5.4: the toggle is rendered and shows the "Read more" affordance.
    const toggle = view.getByTestId('about-toggle');
    expect(toggle).not.toBeNull();
    expect(view.getByText('Read more')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // R5.5 / R5.6 / R5.7 — activating the toggle expands to the full text and
  // flips to "Read less"; activating again re-collapses.
  // -------------------------------------------------------------------------
  test('R5.5/R5.6/R5.7: toggling expands to full text and "Read less", then re-collapses', () => {
    const view = render(<AboutSection description={LONG_DESCRIPTION} />);
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT + 3);

    // Collapsed baseline.
    expect(view.getByTestId('about-text').props.numberOfLines).toBe(
      COLLAPSED_LINE_LIMIT,
    );
    expect(view.getByText('Read more')).not.toBeNull();

    // R5.5 / R5.6: activate → expanded, full text (numberOfLines undefined),
    // affordance becomes "Read less".
    fireEvent.press(view.getByTestId('about-toggle'));
    expect(view.getByTestId('about-text').props.numberOfLines).toBeUndefined();
    expect(view.getByText('Read less')).not.toBeNull();
    expect(view.queryByText('Read more')).toBeNull();

    // R5.7: activate again → collapsed, clamp restored, affordance back to
    // "Read more".
    fireEvent.press(view.getByTestId('about-toggle'));
    expect(view.getByTestId('about-text').props.numberOfLines).toBe(
      COLLAPSED_LINE_LIMIT,
    );
    expect(view.getByText('Read more')).not.toBeNull();
    expect(view.queryByText('Read less')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R5.3 — a description at or under the collapsed limit reports no overflow,
  // so the toggle is omitted.
  // -------------------------------------------------------------------------
  test('R5.3: a description within the collapsed limit renders no toggle', () => {
    const view = render(<AboutSection description={SHORT_DESCRIPTION} />);

    // Before any layout, overflow is unknown → no toggle.
    expect(view.queryByTestId('about-toggle')).toBeNull();

    // Simulate a layout at exactly the collapsed limit (not exceeding it).
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT);

    // R5.3: still no toggle, and the visible copy remains clamped.
    expect(view.queryByTestId('about-toggle')).toBeNull();
    expect(view.getByTestId('about-text').props.numberOfLines).toBe(
      COLLAPSED_LINE_LIMIT,
    );
  });

  // -------------------------------------------------------------------------
  // R5.3 — overflow reported then retracted hides the toggle again.
  // -------------------------------------------------------------------------
  test('R5.2/R5.3: overflow detection shows then hides the toggle as the line count changes', () => {
    const view = render(<AboutSection description={LONG_DESCRIPTION} />);

    // Overflowing layout → toggle shown.
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT + 1);
    expect(view.queryByTestId('about-toggle')).not.toBeNull();

    // A subsequent non-overflowing layout (e.g., wider container) → toggle
    // hidden again.
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT);
    expect(view.queryByTestId('about-toggle')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R5.8 — absent / empty / whitespace-only descriptions render the empty
  // state and no toggle.
  // -------------------------------------------------------------------------
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   \n\t  '],
  ])(
    'R5.8: a %s description renders the empty state and no toggle',
    (_label, description) => {
      const view = render(
        <AboutSection description={description as string | null | undefined} />,
      );

      // The empty state is present with the exact copy...
      expect(view.getByTestId('about-empty')).not.toBeNull();
      expect(view.getByText('No description available.')).not.toBeNull();

      // ...and there is neither a body text node nor a toggle.
      expect(view.queryByTestId('about-text')).toBeNull();
      expect(view.queryByTestId('about-toggle')).toBeNull();
      expect(view.queryByTestId('about-measure')).toBeNull();
    },
  );

  // -------------------------------------------------------------------------
  // R5.10 — the toggle carries a non-empty accessibility label reflecting the
  // current action.
  // -------------------------------------------------------------------------
  test('R5.10: the toggle exposes a non-empty accessibility label reflecting the current action', () => {
    const view = render(<AboutSection description={LONG_DESCRIPTION} />);
    fireMeasureLayout(view, COLLAPSED_LINE_LIMIT + 2);

    // Collapsed: the label reflects the expand action.
    const collapsedToggle = view.getByTestId('about-toggle');
    expect(collapsedToggle.props.accessibilityLabel).toBe('Read more');
    expect(collapsedToggle.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(collapsedToggle.props.accessibilityState).toEqual({
      expanded: false,
    });

    // Expanded: the label reflects the collapse action.
    fireEvent.press(collapsedToggle);
    const expandedToggle = view.getByTestId('about-toggle');
    expect(expandedToggle.props.accessibilityLabel).toBe('Read less');
    expect(expandedToggle.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(expandedToggle.props.accessibilityState).toEqual({ expanded: true });
  });
});
