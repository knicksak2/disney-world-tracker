/**
 * Unit tests for the `GradientHeader` back control
 * (bugfix spec: experience-detail-back-navigation, Task 3.6).
 *
 * Validates (expected behavior of the fixed themed header):
 *   Requirements 2.4, 2.5, 3.6
 *   (Property 3 — Single Themed Header With Accessible Back Control)
 *
 * The fix adds an optional leading back control to the themed `GradientHeader`
 * so the Experience_Detail_View presents a single themed header (the native
 * header is hidden) with a visible, accessible back affordance. These unit
 * tests pin the control's contract directly on the shared component:
 *
 *   - When `onBack` is provided, the header renders a back control exposed to
 *     assistive technology as a button (`accessibilityRole="button"`) with a
 *     back `accessibilityLabel` (default "Go back"), and pressing it invokes
 *     the supplied callback — `ExperienceDetailScreen` passes
 *     `() => navigation.goBack()`, so this is the press that pops to origin
 *     (clause 2.4).
 *   - A custom `backAccessibilityLabel` is honored.
 *   - When `onBack` is omitted, NO back control renders, so the existing
 *     `GradientHeader` usages (Catalog, Home, Stats, Friends, …) are
 *     unaffected (regression guard).
 *   - The title and subtitle (the Experience name and Park) continue to render
 *     alongside the back control (clause 3.6).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { GradientHeader } from '../components';

describe('GradientHeader — accessible back control (Requirements 2.4, 2.5, 3.6)', () => {
  it('renders a back control with role "button" and the default "Go back" label, invoking onBack on press', () => {
    const onBack = jest.fn();

    render(
      <GradientHeader
        title="Avatar Flight of Passage"
        subtitle="Animal Kingdom"
        compact
        onBack={onBack}
      />,
    );

    // Reachable by assistive technology via its button role + label (clause 2.4).
    const backControl = screen.getByRole('button', { name: 'Go back' });
    expect(backControl.props.accessibilityRole).toBe('button');
    expect(backControl.props.accessibilityLabel).toBe('Go back');

    // Pressing the control fires the supplied callback exactly once. The
    // detail screen wires this to `navigation.goBack()`, which pops the root
    // stack back to the originating screen.
    fireEvent.press(backControl);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('honors a custom backAccessibilityLabel', () => {
    const onBack = jest.fn();

    render(
      <GradientHeader title="Space Mountain" onBack={onBack} backAccessibilityLabel="Back to Stats" />,
    );

    const backControl = screen.getByRole('button', { name: 'Back to Stats' });
    expect(backControl.props.accessibilityLabel).toBe('Back to Stats');

    fireEvent.press(backControl);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders no back control when onBack is omitted, so existing usages are unaffected', () => {
    render(<GradientHeader title="Catalog" subtitle="Walt Disney World" />);

    // No leading back affordance is added to a plain header.
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });

  it('continues to render the Experience name and Park alongside the back control (clause 3.6)', () => {
    render(
      <GradientHeader
        title="Avatar Flight of Passage"
        subtitle="Animal Kingdom"
        compact
        onBack={jest.fn()}
      />,
    );

    // The single themed header still surfaces the Experience name + Park.
    expect(screen.getByText('Avatar Flight of Passage')).toBeTruthy();
    expect(screen.getByText('Animal Kingdom')).toBeTruthy();
    // …and the accessible back control is present in the same header.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });
});
