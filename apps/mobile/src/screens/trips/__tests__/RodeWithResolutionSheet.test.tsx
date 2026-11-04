// Feature: unified-experience-logging, Requirement 15.3 — Rode With Duplicate Resolution Sheet Unit Tests

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { RodeWithResolutionSheet } from '../RodeWithResolutionSheet';

describe('RodeWithResolutionSheet', () => {
  const defaultProps = {
    visible: true,
    experienceName: 'Space Mountain',
    existingLogLoggedAt: '2026-11-04T14:10:00.000Z',
    isSubmitting: false,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    render(<RodeWithResolutionSheet {...defaultProps} visible={false} />);
    expect(screen.queryByTestId('rode-with-resolution-sheet')).toBeNull();
  });

  it('renders experience name, options, and defaults to "Same ride"', () => {
    render(<RodeWithResolutionSheet {...defaultProps} />);

    expect(screen.getByTestId('rode-with-resolution-sheet')).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();

    const linkOption = screen.getByTestId('resolution-option-link');
    const newLogOption = screen.getByTestId('resolution-option-new-log');
    expect(linkOption).toBeTruthy();
    expect(newLogOption).toBeTruthy();
    expect(linkOption.props.accessibilityState).toEqual({ selected: true });
    expect(newLogOption.props.accessibilityState).toEqual({ selected: false });
  });

  it('calls onConfirm with "link" when confirming default selection', () => {
    render(<RodeWithResolutionSheet {...defaultProps} />);

    fireEvent.press(screen.getByTestId('resolution-confirm-btn'));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('link');
  });

  it('allows switching to "We rode it again!" and confirms with "new_log"', () => {
    render(<RodeWithResolutionSheet {...defaultProps} />);

    fireEvent.press(screen.getByTestId('resolution-option-new-log'));
    expect(screen.getByTestId('resolution-option-new-log').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('resolution-option-link').props.accessibilityState).toEqual({
      selected: false,
    });

    fireEvent.press(screen.getByTestId('resolution-confirm-btn'));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('new_log');
  });

  it('calls onClose when Cancel is pressed', () => {
    render(<RodeWithResolutionSheet {...defaultProps} />);

    fireEvent.press(screen.getByTestId('resolution-cancel-btn'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('disables controls while isSubmitting is true', () => {
    render(<RodeWithResolutionSheet {...defaultProps} isSubmitting={true} />);

    expect(screen.getByText('Confirming\u2026')).toBeTruthy();
    expect(screen.getByTestId('resolution-confirm-btn').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId('resolution-cancel-btn').props.accessibilityState?.disabled).toBe(true);
  });
});

