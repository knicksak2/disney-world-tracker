/**
 * Property 19: native and third-party controls receive themed props, and the
 * default-text rule applies in dark only and never to nested Text or text on a
 * mode-invariant background.
 *
 * Renders the real `DatePickerField` (opened) and `ResortPicker`; nothing but
 * AsyncStorage (global automatic mock) is mocked.
 *
 * Note on the `ResortPicker` search input: it already set
 * `color: textPrimary` before the retrofit, so light keeps that colour
 * (`#1f1235`) — "light unchanged" wins over "absent in light". The
 * dark-only half of the default-text rule (`t.textDefault`) is pinned on a
 * `TextInput` that has no colour of its own.
 *
 * Validates: Requirements 9.6, 9.7
 */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { Calendar } from 'react-native-calendars';
import fc from 'fast-check';

import type { ResortDTO } from '@dwt/shared';

import { DatePickerField } from '../DatePickerField';
import { DATE_PICKER } from '../DatePickerField.palette';
import { ResortPicker } from '../ResortPicker';
import { GradientHeader, SectionLabel } from '../../theme/components';
import { CompleteBadge } from '../../theme/charts';
import { makeStyles } from '../../theme/makeStyles';
import { themes } from '../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';

type Scheme = 'light' | 'dark';

const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};

const RESORTS: ResortDTO[] = [
  {
    id: 'res-riviera',
    name: "Disney's Riviera Resort",
    description: null,
    imageUrl: null,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    representingExperienceId: null,
  },
];

function openDatePicker(): ReactTestInstance {
  render(
    <DatePickerField
      value="2026-06-15"
      onChange={() => {}}
      accessibilityLabel="Visit date"
      testID="when"
    />,
  );
  fireEvent.press(screen.getByTestId('when'));
  return screen.UNSAFE_getByType(Calendar);
}

afterEach(resetTestScheme);

describe('Property 19: native and third-party controls receive themed props', () => {
  // Feature: dark-mode, Property 19: native and third-party controls receive themed props; default text is dark-only
  it('DatePickerField passes the themed calendar theme for each scheme', () => {
    fc.assert(
      fc.property(fc.constantFrom<Scheme>('light', 'dark'), (s) => {
        setTestScheme(s);
        try {
          const t = themes[s];
          const calendarTheme = openDatePicker().props.theme;
          expect(calendarTheme).toMatchObject({
            calendarBackground: t.color.surface,
            monthTextColor: t.color.textPrimary,
            dayTextColor: t.color.textPrimary,
            textSectionTitleColor: t.color.textSecondary,
            textDisabledColor: DATE_PICKER[s].disabledDayText,
            todayTextColor: t.color.primaryFg,
            selectedDayBackgroundColor: t.color.primary,
            selectedDayTextColor: t.color.textOnPrimary,
            arrowColor: t.color.primaryFg,
          });
          // The selected day's marking uses the fill / on-fill pair.
          expect(screen.UNSAFE_getByType(Calendar).props.markedDates['2026-06-15']).toEqual({
            selected: true,
            selectedColor: t.color.primary,
            selectedTextColor: t.color.textOnPrimary,
          });
        } finally {
          screen.unmount();
          resetTestScheme();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("light keeps today's calendar colours; dark uses the borderStrong disabled-day pair", () => {
    const light = openDatePicker().props.theme;
    expect(light).toMatchObject({
      calendarBackground: '#ffffff',
      textDisabledColor: '#e2d9f0',
      todayTextColor: '#5b2a86',
      arrowColor: '#5b2a86',
      selectedDayBackgroundColor: '#5b2a86',
    });
    screen.unmount();
    setTestScheme('dark');
    expect(openDatePicker().props.theme).toMatchObject({
      calendarBackground: '#1e1430',
      textDisabledColor: '#4a3a6b',
      todayTextColor: '#c4a3ff',
      selectedDayBackgroundColor: '#7e57c2',
    });
  });

  it('remounts the Calendar (new instance, keyed by scheme) when the scheme switches while open', () => {
    const before = openDatePicker();
    expect(before.props.theme.calendarBackground).toBe(themes.light.color.surface);

    setTestScheme('dark');
    const after = screen.UNSAFE_getByType(Calendar);
    expect(after).not.toBe(before);
    expect(after.props.theme.calendarBackground).toBe(themes.dark.color.surface);

    // Control: a re-render under the same scheme keeps the same instance.
    setTestScheme('dark');
    expect(screen.UNSAFE_getByType(Calendar)).toBe(after);
  });

  // Feature: dark-mode, Property 19: native and third-party controls receive themed props; default text is dark-only
  it('ResortPicker search input gets themed placeholder, keyboard appearance and text colour', () => {
    fc.assert(
      fc.property(fc.constantFrom<Scheme>('light', 'dark'), (s) => {
        setTestScheme(s);
        try {
          render(
            <ResortPicker resorts={RESORTS} selectedIds={[]} onToggle={() => {}} testIDPrefix="p" />,
          );
          const input = screen.getByTestId('p-search');
          expect(input.props.placeholderTextColor).toBe(themes[s].color.textSecondary);
          expect(input.props.keyboardAppearance).toBe(s);
          expect(flat(input).color).toBe(themes[s].color.textPrimary);
        } finally {
          screen.unmount();
          resetTestScheme();
        }
      }),
      { numRuns: 100 },
    );
    // Light text colour is the pre-retrofit literal.
    render(<ResortPicker resorts={RESORTS} selectedIds={[]} onToggle={() => {}} testIDPrefix="p" />);
    expect(flat(screen.getByTestId('p-search')).color).toBe('#1f1235');
  });

  it('ResortPicker selected row and chip glyphs use primaryFg in dark', () => {
    setTestScheme('dark');
    render(
      <ResortPicker resorts={RESORTS} selectedIds={['res-riviera']} onToggle={() => {}} testIDPrefix="p" />,
    );
    const row = screen.getByTestId('p-resort-res-riviera');
    const checkbox = row.findAll((n) => n.props.name === 'checkbox')[0]!;
    expect(checkbox.props.color).toBe(themes.dark.color.primaryFg);
    const chip = screen.getByTestId('p-chip-res-riviera');
    expect(flat(chip).backgroundColor).toBe(`${themes.dark.color.primary}18`);
  });
});

describe('Property 19: default text is dark-only, and never applied to nested or invariant-background text', () => {
  const useProbeStyles = makeStyles((t) => ({
    surface: { backgroundColor: t.color.surface },
    input: { ...t.textDefault, fontSize: 15 },
  }));

  function DefaultTextProbe(): JSX.Element {
    const styles = useProbeStyles();
    return (
      <View style={styles.surface}>
        <TextInput testID="plain-input" style={styles.input} />
      </View>
    );
  }

  // Feature: dark-mode, Property 19: native and third-party controls receive themed props; default text is dark-only
  it('a colourless TextInput on a themed surface gets textPrimary in dark and no colour in light', () => {
    fc.assert(
      fc.property(fc.constantFrom<Scheme>('light', 'dark'), (s) => {
        setTestScheme(s);
        try {
          render(<DefaultTextProbe />);
          const color = flat(screen.getByTestId('plain-input')).color;
          if (s === 'dark') expect(color).toBe(themes.dark.color.textPrimary);
          else expect(color).toBeUndefined();
        } finally {
          screen.unmount();
          resetTestScheme();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a nested Text inside a coloured parent Text keeps inheriting (no textPrimary) in dark', () => {
    setTestScheme('dark');
    render(
      <SectionLabel>
        Hello <Text testID="nested">world</Text>
      </SectionLabel>,
    );
    expect(flat(screen.getByText(/Hello/)).color).toBe(themes.dark.color.textPrimary);
    expect(flat(screen.getByTestId('nested')).color).toBeUndefined();
  });

  it('Text on a mode-invariant gradient (GradientHeader iconText) gets no colour in dark', () => {
    setTestScheme('dark');
    render(<GradientHeader title="Magic Kingdom" iconText="🏰" />);
    expect(flat(screen.getByText('🏰')).color).toBeUndefined();
  });

  it('Text on a gold (G-role) fill (CompleteBadge) keeps its on-gold colour, not textPrimary, in dark', () => {
    setTestScheme('dark');
    render(<CompleteBadge />);
    const color = flat(screen.getByText('Complete!')).color;
    expect(color).toBe(themes.dark.color.textOnAccent);
    expect(color).not.toBe(themes.dark.color.textPrimary);
  });
});
