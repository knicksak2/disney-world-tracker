/**
 * AccountDeletionNotice and AccountRestoredNotice (account-deletion R1.13, R1.14,
 * R4.9; tasks.md 14.1). Real components, real session store; nothing mocked but
 * the secure-storage native module and the screen-reader announcement spy.
 */

import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import AccountDeletionNotice, { formatPurgeDate } from '../AccountDeletionNotice';
import AccountRestoredNotice, { ACCOUNT_RESTORED_MESSAGE } from '../AccountRestoredNotice';
import { useSessionStore } from '../../state/sessionStore';
import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import { darkTheme } from '../../theme/theme';

const PURGE_AT = '2030-03-15T12:00:00.000Z';

describe('AccountDeletionNotice', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    announce.mockRestore();
    resetTestScheme();
  });

  it('renders nothing and announces nothing when there is no notice', () => {
    render(<AccountDeletionNotice />);
    expect(screen.queryByTestId('account-deletion-notice')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('shows the formatted date and the cancel hint in an alert banner', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<AccountDeletionNotice />);

    const banner = screen.getByTestId('account-deletion-notice');
    expect(banner.props.accessibilityRole).toBe('alert');

    const expectedDate = formatPurgeDate(PURGE_AT);
    // The formatted date really is the device-locale rendering of the ISO instant.
    expect(expectedDate).toBe(
      new Date(PURGE_AT).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    );
    expect(expectedDate).toContain('2030');
    expect(screen.getByTestId('account-deletion-notice-text')).toHaveTextContent(
      `Your account is scheduled for deletion on ${expectedDate}. Sign in before then to cancel.`,
    );
  });

  it('announces the full text, date included, exactly once even across re-renders', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    const view = render(<AccountDeletionNotice />);

    expect(announce).toHaveBeenCalledTimes(1);
    const message = announce.mock.calls[0]![0] as string;
    expect(message).toContain(formatPurgeDate(PURGE_AT));
    expect(message).toContain('Sign in before then to cancel.');

    view.rerender(<AccountDeletionNotice />);
    act(() => {
      useSessionStore.setState({ hydrated: true });
    });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('dismiss removes the banner and clears the store field', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<AccountDeletionNotice />);

    fireEvent.press(screen.getByTestId('account-deletion-notice-dismiss'));

    expect(screen.queryByTestId('account-deletion-notice')).toBeNull();
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
  });

  it('the dismiss control is a labelled button', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<AccountDeletionNotice />);
    const dismiss = screen.getByTestId('account-deletion-notice-dismiss');
    expect(dismiss.props.accessibilityRole).toBe('button');
    expect(dismiss.props.accessibilityLabel).toBe('Dismiss account deletion notice');
  });

  it('repaints with the active scheme (dark warning surface)', () => {
    setTestScheme('dark');
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<AccountDeletionNotice />);
    const style = StyleSheet.flatten(screen.getByTestId('account-deletion-notice').props.style);
    expect(style.backgroundColor).toBe(darkTheme.color.warningSurface);
  });
});

describe('AccountRestoredNotice', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    announce.mockRestore();
  });

  it('renders nothing while the flag is false', () => {
    render(<AccountRestoredNotice />);
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('shows the exact welcome-back copy as an alert and announces it once', () => {
    useSessionStore.setState({ accountRestoredNotice: true });
    render(<AccountRestoredNotice />);

    expect(screen.getByTestId('account-restored-notice').props.accessibilityRole).toBe('alert');
    expect(ACCOUNT_RESTORED_MESSAGE).toBe(
      'Welcome back. Your account deletion was cancelled and your account has been restored.',
    );
    expect(screen.getByTestId('account-restored-notice-text')).toHaveTextContent(
      ACCOUNT_RESTORED_MESSAGE,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(ACCOUNT_RESTORED_MESSAGE);
  });

  it('dismiss hides it and clears the flag; it does not come back on re-render', () => {
    useSessionStore.setState({ accountRestoredNotice: true });
    const view = render(<AccountRestoredNotice />);

    fireEvent.press(screen.getByTestId('account-restored-notice-dismiss'));

    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
    view.rerender(<AccountRestoredNotice />);
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
