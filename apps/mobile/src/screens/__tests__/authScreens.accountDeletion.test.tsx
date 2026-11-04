/**
 * Auth screens and the account-deletion notices (account-deletion R1.13, R1.14,
 * R4.3, R4.9, R16.4, R16.6; tasks.md 14.3).
 *
 * Real `LoginScreen`, `RegisterScreen`, `ResetPasswordScreen` and
 * `DeleteAccountScreen`; only `apiRequest` and native modules are mocked.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import LoginScreen from '../LoginScreen';
import RegisterScreen from '../RegisterScreen';
import ResetPasswordScreen from '../ResetPasswordScreen';
import DeleteAccountScreen from '../youAndCrew/DeleteAccountScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../api/client';
import { formatPurgeDate } from '../../components/AccountDeletionNotice';
import { useSessionStore } from '../../state/sessionStore';
import { ACCOUNT_LOCKED_MESSAGE } from '../authCopy';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const PURGE_AT = '2030-03-15T12:00:00.000Z';

const SESSION_BODY = {
  user: { id: 'u-1', email: 'mickey@example.com' },
  profile: { displayName: 'Mickey' },
  token: 'fresh-token',
};

function callsTo(method: string, path: string): unknown[][] {
  return apiRequestMock.mock.calls.filter((c) => c[0] === method && c[1] === path);
}

function loginNav(): never {
  return { navigate: jest.fn() } as never;
}

function submitLogin(): void {
  fireEvent.changeText(screen.getByTestId('login-email'), 'mickey@example.com');
  fireEvent.changeText(screen.getByTestId('login-password'), 'hunter2-correct');
  fireEvent.press(screen.getByTestId('login-submit'));
}

describe('LoginScreen: deletion notice and restored flag', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => announce.mockRestore());

  it('a fresh store shows no deletion banner', () => {
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);
    expect(screen.getByTestId('login-body')).toBeTruthy();
    expect(screen.queryByTestId('account-deletion-notice')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('renders the notice (date, alert role) ABOVE the form, announces it once, and dismiss removes it', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);

    const banner = screen.getByTestId('account-deletion-notice');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(screen.getByTestId('account-deletion-notice-text')).toHaveTextContent(
      new RegExp(`scheduled for deletion on ${formatPurgeDate(PURGE_AT)}`),
    );

    // "Above the form": the banner precedes the login body in the rendered tree.
    const json = JSON.stringify(screen.toJSON());
    expect(json.indexOf('account-deletion-notice')).toBeGreaterThan(-1);
    expect(json.indexOf('account-deletion-notice')).toBeLessThan(json.indexOf('login-body'));

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]![0]).toContain(formatPurgeDate(PURGE_AT));

    fireEvent.press(screen.getByTestId('account-deletion-notice-dismiss'));
    expect(screen.queryByTestId('account-deletion-notice')).toBeNull();
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
  });

  it('signing in POSTs /auth/login, stores the token and clears the leftover deletion notice', async () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    apiRequestMock.mockResolvedValueOnce(SESSION_BODY as never);
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);

    submitLogin();

    await waitFor(() => expect(useSessionStore.getState().token).toBe('fresh-token'));
    expect(callsTo('POST', '/auth/login')).toEqual([
      ['POST', '/auth/login', { email: 'mickey@example.com', password: 'hunter2-correct' }],
    ]);
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });

  it('accountRestored: true sets the restored notice after the token is stored', async () => {
    apiRequestMock.mockResolvedValueOnce({ ...SESSION_BODY, accountRestored: true } as never);
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);

    submitLogin();

    await waitFor(() => expect(useSessionStore.getState().accountRestoredNotice).toBe(true));
    expect(useSessionStore.getState().token).toBe('fresh-token');
  });

  it('a response without accountRestored leaves the restored notice off', async () => {
    apiRequestMock.mockResolvedValueOnce(SESSION_BODY as never);
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);

    submitLogin();

    await waitFor(() => expect(useSessionStore.getState().token).toBe('fresh-token'));
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });

  it('account_locked keeps the shared lockout copy', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({ code: 'account_locked', message: 'locked', status: 423 }),
    );
    render(<LoginScreen navigation={loginNav()} route={{} as never} />);

    submitLogin();

    expect(await screen.findByTestId('login-form-error')).toHaveTextContent(ACCOUNT_LOCKED_MESSAGE);
  });
});

describe('RegisterScreen: no deletion notice, no restored flag', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('does not render the deletion notice even when one is pending in the store', () => {
    useSessionStore.setState({
      accountDeletionNotice: { scheduledPurgeAt: PURGE_AT, graceDays: 30 },
    });
    render(<RegisterScreen navigation={loginNav()} route={{} as never} />);
    expect(screen.getByTestId('register-body')).toBeTruthy();
    expect(screen.queryByTestId('account-deletion-notice')).toBeNull();
  });

  it('registering POSTs /auth/register, stores the token and never sets the restored notice', async () => {
    apiRequestMock.mockResolvedValueOnce(SESSION_BODY as never);
    render(<RegisterScreen navigation={loginNav()} route={{} as never} />);

    fireEvent.changeText(screen.getByTestId('register-email'), 'new@example.com');
    fireEvent.changeText(screen.getByTestId('register-display-name'), 'Newbie');
    fireEvent.changeText(screen.getByTestId('register-password'), 'long-enough-pw');
    fireEvent.press(screen.getByTestId('register-age-confirm'));
    fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(useSessionStore.getState().token).toBe('fresh-token'));
    expect(callsTo('POST', '/auth/register')).toEqual([
      [
        'POST',
        '/auth/register',
        {
          email: 'new@example.com',
          displayName: 'Newbie',
          password: 'long-enough-pw',
          ageConfirmed: true,
        },
      ],
    ]);
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });

  // Feature: legal-disclaimers-and-terms, Property 7: Minimum age 13 attestation
  describe('13+ age checkbox (legal-disclaimers-and-terms R8.6-R8.8)', () => {
    function fillValidFields(): void {
      fireEvent.changeText(screen.getByTestId('register-email'), 'new@example.com');
      fireEvent.changeText(screen.getByTestId('register-display-name'), 'Newbie');
      fireEvent.changeText(screen.getByTestId('register-password'), 'long-enough-pw');
    }

    it('renders the checkbox unchecked with checkbox role and label (R8.6)', () => {
      render(<RegisterScreen navigation={loginNav()} route={{} as never} />);
      const box = screen.getByTestId('register-age-confirm');
      expect(box.props.accessibilityRole).toBe('checkbox');
      expect(box.props.accessibilityLabel).toBe('I am at least 13 years old');
      expect(box.props.accessibilityState).toMatchObject({ checked: false });
      expect(screen.getByText('I am at least 13 years old')).toBeTruthy();
      expect(screen.queryByTestId('register-age-error')).toBeNull();
    });

    it('submitting unchecked makes no API call and shows the age message; checking it clears the message (R8.7)', async () => {
      render(<RegisterScreen navigation={loginNav()} route={{} as never} />);
      fillValidFields();

      fireEvent.press(screen.getByTestId('register-submit'));

      expect(await screen.findByTestId('register-age-error')).toHaveTextContent(
        'You must be 13 or older to create an account.',
      );
      expect(apiRequestMock).not.toHaveBeenCalled();
      expect(useSessionStore.getState().token).toBeNull();

      fireEvent.press(screen.getByTestId('register-age-confirm'));

      expect(screen.queryByTestId('register-age-error')).toBeNull();
      expect(screen.getByTestId('register-age-confirm').props.accessibilityState).toMatchObject({
        checked: true,
      });
    });

    it('unchecking again after checking blocks the submit once more (R8.7)', async () => {
      render(<RegisterScreen navigation={loginNav()} route={{} as never} />);
      fillValidFields();

      fireEvent.press(screen.getByTestId('register-age-confirm'));
      fireEvent.press(screen.getByTestId('register-age-confirm'));
      expect(screen.getByTestId('register-age-confirm').props.accessibilityState).toMatchObject({
        checked: false,
      });
      fireEvent.press(screen.getByTestId('register-submit'));

      expect(await screen.findByTestId('register-age-error')).toBeTruthy();
      expect(apiRequestMock).not.toHaveBeenCalled();
    });

    it('maps a server validation_failed on ageConfirmed to the same message (R8.4, R8.7)', async () => {
      apiRequestMock.mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: 'validation_failed',
          message: 'Invalid value for "ageConfirmed".',
          field: 'ageConfirmed',
        }),
      );
      render(<RegisterScreen navigation={loginNav()} route={{} as never} />);
      fillValidFields();
      fireEvent.press(screen.getByTestId('register-age-confirm'));
      fireEvent.press(screen.getByTestId('register-submit'));

      expect(await screen.findByTestId('register-age-error')).toHaveTextContent(
        'You must be 13 or older to create an account.',
      );
      expect(useSessionStore.getState().token).toBeNull();
    });
  });
});

describe('ResetPasswordScreen: restored notice', () => {
  function renderReset() {
    const navigation = { navigate: jest.fn() } as never;
    const route = { params: { email: 'mickey@example.com' } } as never;
    return render(
      <NavigationContainer>
        <ResetPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );
  }

  function submitReset(): void {
    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'SuperSecurePassword99');
    fireEvent.changeText(screen.getByTestId('reset-confirm-password'), 'SuperSecurePassword99');
    fireEvent.press(screen.getByTestId('reset-submit'));
  }

  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('accountRestored: true on the reset response sets the restored notice', async () => {
    apiRequestMock.mockResolvedValueOnce({ ...SESSION_BODY, accountRestored: true } as never);
    renderReset();

    submitReset();

    await waitFor(() => expect(useSessionStore.getState().accountRestoredNotice).toBe(true));
    expect(callsTo('POST', '/auth/reset-password')).toEqual([
      [
        'POST',
        '/auth/reset-password',
        { email: 'mickey@example.com', code: '123456', newPassword: 'SuperSecurePassword99' },
      ],
    ]);
    expect(useSessionStore.getState().token).toBe('fresh-token');
  });

  it('a reset response without accountRestored does not set it', async () => {
    apiRequestMock.mockResolvedValueOnce(SESSION_BODY as never);
    renderReset();

    submitReset();

    await waitFor(() => expect(useSessionStore.getState().token).toBe('fresh-token'));
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });
});

describe('end to end: delete the account, land on the sign-in screen with the notice', () => {
  const Stack = createNativeStackNavigator<{ DeleteAccount: undefined }>();
  let announce: jest.SpyInstance;

  /** Mirrors `RootNavigator`: `token === null` shows the sign-in screen, else the app. */
  function MiniRoot(): JSX.Element {
    const token = useSessionStore((s) => s.token);
    if (token === null) {
      return <LoginScreen navigation={loginNav()} route={{} as never} />;
    }
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => announce.mockRestore());

  it('shows the formatted date in an alert banner, token is null, no push DELETE, announced exactly once', async () => {
    apiRequestMock.mockImplementation((async (_method: string, path: string) => {
      if (path === '/me/account/deletion/reauth') {
        return { reauthGrant: 'g1', expiresAt: '2030-01-01T00:05:00.000Z', graceDays: 14 };
      }
      if (path === '/me/account/deletion') {
        return { status: 'pending_deletion', scheduledPurgeAt: PURGE_AT, graceDays: 14 };
      }
      return {};
    }) as never);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MiniRoot />
      </QueryClientProvider>,
    );

    fireEvent.press(await screen.findByTestId('delete-account-continue'));
    fireEvent.changeText(await screen.findByTestId('delete-account-password'), 'pw');
    fireEvent.press(screen.getByTestId('delete-account-verify'));
    fireEvent.changeText(await screen.findByTestId('delete-account-confirmation'), 'DELETE');
    fireEvent.press(screen.getByTestId('delete-account-submit'));

    const banner = await screen.findByTestId('account-deletion-notice');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(screen.getByTestId('account-deletion-notice-text')).toHaveTextContent(
      new RegExp(`scheduled for deletion on ${formatPurgeDate(PURGE_AT)}\\. Sign in before then to cancel\\.`),
    );
    expect(useSessionStore.getState().token).toBeNull();
    expect(callsTo('POST', '/auth/logout')).toHaveLength(0);
    expect(callsTo('DELETE', '/me/push-registrations')).toHaveLength(0);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]![0]).toContain(formatPurgeDate(PURGE_AT));
  });
});
