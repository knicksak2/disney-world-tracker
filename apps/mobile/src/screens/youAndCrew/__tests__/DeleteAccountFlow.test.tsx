/**
 * Self-service account deletion: the entry row on the real `YouAndCrewScreen`
 * and the real three-step `DeleteAccountScreen` (account-deletion R1.1 to R1.13;
 * tasks.md 14.2).
 *
 * Only the network layer (`apiRequest`) and native modules are mocked. Each
 * interaction asserts BOTH the network call (endpoint + payload) and the
 * on-screen change.
 */

import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import YouAndCrewScreen from '../YouAndCrewScreen';
import DeleteAccountScreen, {
  PASSWORD_INCORRECT_MESSAGE,
  REAUTH_EXPIRED_MESSAGE,
} from '../DeleteAccountScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { invalidatePushRegistration } from '../../../hooks/usePushRegistration';
import { useSessionStore } from '../../../state/sessionStore';
import { useThemeStore } from '../../../state/themeStore';
import { DEFAULT_APPEARANCE_PREFERENCE } from '../../../theme/appearance';
import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { ACCOUNT_LOCKED_MESSAGE } from '../../authCopy';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

const REAUTH_PATH = '/me/account/deletion/reauth';
const DELETE_PATH = '/me/account/deletion';
const PURGE_AT = '2030-03-15T12:00:00.000Z';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Handlers {
  reauth?: (body: unknown) => Promise<unknown>;
  remove?: (body: unknown) => Promise<unknown>;
}

function setupApi(handlers: Handlers = {}): void {
  apiRequestMock.mockImplementation((async (method: string, path: string, body?: unknown) => {
    if (path === '/me') {
      return {
        user: { id: 'u1', email: 'mickey@disney.test' },
        profile: { displayName: 'Mickey Mouse', avatarPreset: null },
      };
    }
    if (path === '/users/u1/profile') {
      return { userId: 'u1', displayName: 'Mickey Mouse', avatarPreset: null };
    }
    if (path === '/me/friends') {
      return { friends: [], incomingRequests: [], outgoingRequests: [] };
    }
    if (method === 'POST' && path === REAUTH_PATH) {
      return (handlers.reauth ?? (async () => ({
        reauthGrant: 'grant-1',
        expiresAt: '2030-01-01T00:05:00.000Z',
        graceDays: 14,
      })))(body);
    }
    if (method === 'POST' && path === DELETE_PATH) {
      return (handlers.remove ?? (async () => ({
        status: 'pending_deletion',
        scheduledPurgeAt: PURGE_AT,
        graceDays: 14,
      })))(body);
    }
    return {};
  }) as never);
}

function callsTo(method: string, path: string): unknown[][] {
  return apiRequestMock.mock.calls.filter((c) => c[0] === method && c[1] === path);
}

function apiError(code: string, message: string, status: number): ApiError {
  return new ApiError({ code: code as never, message, status });
}

describe('Delete account: entry and three-step flow', () => {
  let queryClient: QueryClient;
  let navRef: ReturnType<typeof createNavigationContainerRef<YouAndCrewStackParamList>>;

  function renderApp() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="YouAndCrewMain" component={YouAndCrewScreen} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  /** Open the real screen through the real entry row, then advance to a step. */
  async function openDeleteAccount(): Promise<void> {
    renderApp();
    await screen.findByTestId('profile-display-name');
    fireEvent.press(screen.getByTestId('delete-account-entry-button'));
    await screen.findByTestId('delete-account-step-review');
  }

  async function goToPasswordStep(): Promise<void> {
    await openDeleteAccount();
    fireEvent.press(screen.getByTestId('delete-account-continue'));
    await screen.findByTestId('delete-account-step-password');
  }

  async function verifyPassword(password: string): Promise<void> {
    fireEvent.changeText(screen.getByTestId('delete-account-password'), password);
    fireEvent.press(screen.getByTestId('delete-account-verify'));
  }

  async function goToConfirmStep(): Promise<void> {
    await goToPasswordStep();
    await verifyPassword('hunter2-correct');
    await screen.findByTestId('delete-account-step-confirm');
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
    setupApi();
  });

  afterEach(resetTestScheme);

  describe('entry row on YouAndCrewScreen (R1.1, R1.2)', () => {
    it('is a labelled button with a trash icon and the words "Delete account"', async () => {
      renderApp();
      await screen.findByTestId('profile-display-name');

      const entry = screen.getByTestId('delete-account-entry-button');
      expect(entry.props.accessibilityRole).toBe('button');
      expect(entry.props.accessibilityLabel).toBe('Delete account');
      expect(screen.getByText('Delete account')).toBeTruthy();
      const trash = screen.UNSAFE_root.findAll(
        (n) => (n.type as string) === 'Icon' && n.props.name === 'trash-outline',
      );
      expect(trash.length).toBeGreaterThan(0);
    });

    it('sits below Blocked Users and above Log out', async () => {
      renderApp();
      await screen.findByTestId('profile-display-name');

      const order: string[] = [];
      const wanted = new Set([
        'blocked-users-entry-button',
        'terms-of-service-entry-button',
        'privacy-policy-entry-button',
        'delete-account-entry-button',
        'you-and-crew-logout',
      ]);
      const walk = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const n = node as { props?: { testID?: string }; children?: unknown };
        const id = n.props?.testID;
        if (id !== undefined && wanted.has(id) && !order.includes(id)) order.push(id);
        walk(n.children);
      };
      walk(screen.toJSON());

      expect(order).toEqual([
        'blocked-users-entry-button',
        'terms-of-service-entry-button',
        'privacy-policy-entry-button',
        'delete-account-entry-button',
        'you-and-crew-logout',
      ]);
    });

    it('pressing it navigates to DeleteAccount and shows the review step; no request is sent yet', async () => {
      await openDeleteAccount();

      expect(navRef.getCurrentRoute()?.name).toBe('DeleteAccount');
      expect(screen.getByTestId('delete-account-step-review')).toBeTruthy();
      expect(callsTo('POST', REAUTH_PATH)).toHaveLength(0);
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(0);
    });

    it('renders the Privacy Policy link row and opens the hosted privacy policy URL when pressed (R20.5)', async () => {
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      try {
        renderApp();
        await screen.findByTestId('profile-display-name');

        const privacyLink = screen.getByTestId('privacy-policy-entry-button');
        expect(privacyLink.props.accessibilityRole).toBe('link');
        expect(privacyLink.props.accessibilityLabel).toBe('Privacy Policy');
        expect(screen.getByText('Privacy Policy')).toBeTruthy();

        fireEvent.press(privacyLink);
        expect(openUrlSpy).toHaveBeenCalledWith('http://test.local/privacy');
      } finally {
        openUrlSpy.mockRestore();
      }
    });

    it('renders the Terms of Service link row, opens the hosted terms URL when pressed, and renders the in-app Disney disclaimer (R4.1-R4.5)', async () => {
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      try {
        renderApp();
        await screen.findByTestId('profile-display-name');

        const termsLink = screen.getByTestId('terms-of-service-entry-button');
        expect(termsLink.props.accessibilityRole).toBe('link');
        expect(termsLink.props.accessibilityLabel).toBe('Terms of Service');
        expect(screen.getByText('Terms of Service')).toBeTruthy();

        fireEvent.press(termsLink);
        expect(openUrlSpy).toHaveBeenCalledWith('http://test.local/terms');

        const disclaimer = screen.getByTestId('you-and-crew-legal-disclaimer');
        expect(disclaimer).toBeTruthy();
        expect(
          screen.getByText(/not affiliated with, endorsed by, or sponsored by The Walt Disney Company/i),
        ).toBeTruthy();
      } finally {
        openUrlSpy.mockRestore();
      }
    });
  });

  describe('review step (R1.3, R1.4)', () => {
    it('lists every consequence, names no day count before the server reports one, and offers Cancel', async () => {
      await openDeleteAccount();

      expect(screen.getByText('Every device is signed out immediately.')).toBeTruthy();
      expect(screen.getByText('Your account is hidden from friends and trip members.')).toBeTruthy();
      expect(
        screen.getByText(/permanently deleted when the grace period ends/),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Signing in again before then cancels the deletion and restores your account.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('Your photos are deleted.')).toBeTruthy();
      expect(screen.getByText(/Trips you own are handed to another member/)).toBeTruthy();
      expect(screen.getByText(/shown as "Deleted user"/)).toBeTruthy();
      // graceDays is not known before reauth and is never hard-coded in the client.
      expect(screen.queryByText(/after \d+ days/)).toBeNull();
    });

    it('Cancel returns to You & Crew', async () => {
      await openDeleteAccount();
      fireEvent.press(screen.getByTestId('delete-account-cancel'));
      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));
    });

    it('Continue moves to the password step without calling the API', async () => {
      await goToPasswordStep();
      expect(screen.getByTestId('delete-account-password')).toBeTruthy();
      expect(callsTo('POST', REAUTH_PATH)).toHaveLength(0);
    });
  });

  describe('password step (R1.5, R1.8)', () => {
    it('Verify is disabled while the field is empty', async () => {
      await goToPasswordStep();
      expect(screen.getByTestId('delete-account-verify')).toBeDisabled();
    });

    it('a wrong password shows the inline message, keeps the user signed in and on the step, and clears the field', async () => {
      setupApi({
        reauth: async () => {
          throw apiError('reauth_failed', 'Re-authentication failed.', 403);
        },
      });
      await goToPasswordStep();

      await verifyPassword('wrong-password');

      expect(await screen.findByTestId('delete-account-password-error')).toHaveTextContent(
        PASSWORD_INCORRECT_MESSAGE,
      );
      expect(PASSWORD_INCORRECT_MESSAGE).toBe('Password is incorrect.');
      expect(callsTo('POST', REAUTH_PATH)).toEqual([
        ['POST', REAUTH_PATH, { password: 'wrong-password' }],
      ]);
      expect(screen.getByTestId('delete-account-step-password')).toBeTruthy();
      expect(screen.getByTestId('delete-account-password').props.value).toBe('');
      expect(useSessionStore.getState().token).toBe('token-abc');
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(0);
    });

    it('an account_locked reply shows the LoginScreen lockout copy and stays signed in', async () => {
      setupApi({
        reauth: async () => {
          throw apiError('account_locked', 'locked', 423);
        },
      });
      await goToPasswordStep();

      await verifyPassword('anything');

      expect(await screen.findByTestId('delete-account-password-error')).toHaveTextContent(
        ACCOUNT_LOCKED_MESSAGE,
      );
      expect(ACCOUNT_LOCKED_MESSAGE).toBe('Account temporarily locked. Try again in 15 minutes.');
      expect(useSessionStore.getState().token).toBe('token-abc');
      expect(screen.getByTestId('delete-account-password').props.value).toBe('');
    });

    it('editing the field after an error removes the error text', async () => {
      setupApi({
        reauth: async () => {
          throw apiError('reauth_failed', 'Re-authentication failed.', 403);
        },
      });
      await goToPasswordStep();
      await verifyPassword('wrong');
      await screen.findByTestId('delete-account-password-error');

      fireEvent.changeText(screen.getByTestId('delete-account-password'), 'again');

      expect(screen.queryByTestId('delete-account-password-error')).toBeNull();
    });

    it('the correct password advances to the confirm step and shows the SERVER graceDays', async () => {
      await goToPasswordStep();

      await verifyPassword('hunter2-correct');

      await screen.findByTestId('delete-account-step-confirm');
      expect(callsTo('POST', REAUTH_PATH)).toEqual([
        ['POST', REAUTH_PATH, { password: 'hunter2-correct' }],
      ]);
      // The fixture says 14; a hard-coded 30 would fail here.
      expect(screen.getByTestId('delete-account-grace-copy')).toHaveTextContent(
        /permanently deleted 14 days after you confirm/,
      );
      expect(screen.getByTestId('delete-account-grace-copy')).not.toHaveTextContent(/30 days/);
      expect(screen.getByTestId('delete-account-phrase')).toHaveTextContent('DELETE');
    });

    it('a pending reauth request disables Verify so a double tap sends one request', async () => {
      const gate = deferred<unknown>();
      setupApi({ reauth: () => gate.promise });
      await goToPasswordStep();

      await verifyPassword('hunter2-correct');
      await waitFor(() => expect(screen.getByTestId('delete-account-verify')).toBeDisabled());
      fireEvent.press(screen.getByTestId('delete-account-verify'));

      expect(callsTo('POST', REAUTH_PATH)).toHaveLength(1);
      await act(async () => {
        gate.resolve({
          reauthGrant: 'grant-1',
          expiresAt: '2030-01-01T00:05:00.000Z',
          graceDays: 14,
        });
      });
      await screen.findByTestId('delete-account-step-confirm');
    });
  });

  describe('leaving the password step (R1.12)', () => {
    it('Cancel returns to You & Crew without calling the API and stays signed in', async () => {
      await goToPasswordStep();
      fireEvent.changeText(screen.getByTestId('delete-account-password'), 'half-typed');

      fireEvent.press(screen.getByTestId('delete-account-cancel'));

      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));
      expect(callsTo('POST', REAUTH_PATH)).toHaveLength(0);
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(0);
      expect(useSessionStore.getState().token).toBe('token-abc');
    });

    it('the header back button ("Cancel and go back") does the same', async () => {
      await goToPasswordStep();
      const back = screen.getByTestId('delete-account-back');
      expect(back.props.accessibilityLabel).toBe('Cancel and go back');

      fireEvent.press(back);

      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));
      expect(callsTo('POST', REAUTH_PATH)).toHaveLength(0);
      expect(useSessionStore.getState().token).toBe('token-abc');
    });

    it('a returning user starts again at the review step with an empty password field', async () => {
      await goToPasswordStep();
      fireEvent.changeText(screen.getByTestId('delete-account-password'), 'half-typed');
      fireEvent.press(screen.getByTestId('delete-account-cancel'));
      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));

      fireEvent.press(screen.getByTestId('delete-account-entry-button'));
      await screen.findByTestId('delete-account-step-review');
      fireEvent.press(screen.getByTestId('delete-account-continue'));

      expect((await screen.findByTestId('delete-account-password')).props.value).toBe('');
    });
  });

  describe('confirm step (R1.6, R1.7, R1.9, R1.10, R1.13)', () => {
    it('keeps Delete disabled until the trimmed text equals DELETE exactly (case-sensitive)', async () => {
      await goToConfirmStep();
      const input = screen.getByTestId('delete-account-confirmation');
      const submit = (): ReturnType<typeof screen.getByTestId> =>
        screen.getByTestId('delete-account-submit');

      expect(submit()).toBeDisabled();

      fireEvent.changeText(input, 'delete');
      expect(submit()).toBeDisabled();

      fireEvent.changeText(input, 'DELET');
      expect(submit()).toBeDisabled();

      fireEvent.press(submit());
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(0);

      fireEvent.changeText(input, '  DELETE ');
      expect(submit()).not.toBeDisabled();
    });

    it('submit POSTs { reauthGrant, confirmation: "DELETE" } to /me/account/deletion', async () => {
      await goToConfirmStep();

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));

      await waitFor(() => expect(callsTo('POST', DELETE_PATH)).toHaveLength(1));
      expect(callsTo('POST', DELETE_PATH)[0]).toEqual([
        'POST',
        DELETE_PATH,
        { reauthGrant: 'grant-1', confirmation: 'DELETE' },
      ]);
    });

    it('success: cancels queries, stores the notice, clears token then cache, in that order; no /auth/logout and no push DELETE', async () => {
      await goToConfirmStep();
      const events: string[] = [];
      const realCancel = queryClient.cancelQueries.bind(queryClient);
      jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async (...args) => {
        events.push('cancelQueries');
        return realCancel(...args);
      });
      const realClear = queryClient.clear.bind(queryClient);
      jest.spyOn(queryClient, 'clear').mockImplementation(() => {
        events.push('queryClient.clear');
        realClear();
      });
      const unsubscribe = useSessionStore.subscribe((state, prev) => {
        if (state.accountDeletionNotice !== prev.accountDeletionNotice) events.push('notice');
        if (state.token !== prev.token && state.token === null) events.push('token-cleared');
      });

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));

      await waitFor(() => expect(useSessionStore.getState().token).toBeNull());
      await waitFor(() => expect(events).toContain('queryClient.clear'));
      unsubscribe();

      expect(events).toEqual(['cancelQueries', 'notice', 'token-cleared', 'queryClient.clear']);
      expect(useSessionStore.getState().accountDeletionNotice).toEqual({
        scheduledPurgeAt: PURGE_AT,
        graceDays: 14,
      });
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
      // No authenticated call after the server revoked every session (R1.13).
      expect(callsTo('POST', '/auth/logout')).toHaveLength(0);
      expect(callsTo('DELETE', '/me/push-registrations')).toHaveLength(0);
    });

    it('control: the harness WOULD see a push-registration DELETE if invalidatePushRegistration ran', async () => {
      setupApi();
      await invalidatePushRegistration();
      expect(callsTo('DELETE', '/me/push-registrations')).toHaveLength(1);
    });

    it('reauth_required returns to the password step with an explanation, stays signed in, and a fresh grant is used next', async () => {
      let removeCalls = 0;
      setupApi({
        remove: async () => {
          removeCalls += 1;
          throw apiError('reauth_required', 'Please confirm your password again.', 403);
        },
      });
      await goToConfirmStep();

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));

      await screen.findByTestId('delete-account-step-password');
      expect(removeCalls).toBe(1);
      expect(screen.getByTestId('delete-account-reauth-notice')).toHaveTextContent(
        REAUTH_EXPIRED_MESSAGE,
      );
      expect(useSessionStore.getState().token).toBe('token-abc');
      expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
      expect(screen.getByTestId('delete-account-password').props.value).toBe('');

      // The stale grant is gone: re-verifying yields a new one that the next POST carries.
      setupApi({
        reauth: async () => ({
          reauthGrant: 'grant-2',
          expiresAt: '2030-01-01T00:10:00.000Z',
          graceDays: 14,
        }),
      });
      await verifyPassword('hunter2-correct');
      await screen.findByTestId('delete-account-step-confirm');
      // The confirmation text was cleared with the old grant.
      expect(screen.getByTestId('delete-account-confirmation').props.value).toBe('');
      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));
      await waitFor(() => expect(callsTo('POST', DELETE_PATH)).toHaveLength(2));
      expect(callsTo('POST', DELETE_PATH)[1]).toEqual([
        'POST',
        DELETE_PATH,
        { reauthGrant: 'grant-2', confirmation: 'DELETE' },
      ]);
    });

    it('any other error is shown inline and the user stays signed in on the confirm step', async () => {
      setupApi({
        remove: async () => {
          throw apiError('internal_error', 'The server had a problem.', 500);
        },
      });
      await goToConfirmStep();

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));

      expect(await screen.findByTestId('delete-account-confirm-error')).toHaveTextContent(
        'The server had a problem.',
      );
      // R1.11: the inline error is announced as an alert.
      expect(screen.getByTestId('delete-account-confirm-error').props.accessibilityRole).toBe(
        'alert',
      );
      expect(screen.getByTestId('delete-account-step-confirm')).toBeTruthy();
      expect(useSessionStore.getState().token).toBe('token-abc');
      expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
    });

    it('success clears the typed confirmation and drops the grant, so a further tap cannot re-send it (R1.12)', async () => {
      await goToConfirmStep();

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));
      await waitFor(() => expect(useSessionStore.getState().token).toBeNull());
      await waitFor(() =>
        expect(screen.getByTestId('delete-account-confirmation').props.value).toBe(''),
      );

      // The grant is gone: typing the phrase again and pressing submit sends nothing.
      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(1);
    });

    it('while the request is in flight the submit is disabled and a second tap sends nothing', async () => {
      const gate = deferred<unknown>();
      setupApi({ remove: () => gate.promise });
      await goToConfirmStep();

      fireEvent.changeText(screen.getByTestId('delete-account-confirmation'), 'DELETE');
      fireEvent.press(screen.getByTestId('delete-account-submit'));
      await waitFor(() => expect(screen.getByTestId('delete-account-submit')).toBeDisabled());
      fireEvent.press(screen.getByTestId('delete-account-submit'));

      expect(callsTo('POST', DELETE_PATH)).toHaveLength(1);
      expect(screen.getByTestId('delete-account-confirmation').props.editable).toBe(false);

      await act(async () => {
        gate.resolve({ status: 'pending_deletion', scheduledPurgeAt: PURGE_AT, graceDays: 14 });
      });
      await waitFor(() => expect(useSessionStore.getState().token).toBeNull());
    });

    it('Cancel on the confirm step leaves without sending the deletion', async () => {
      await goToConfirmStep();
      fireEvent.press(screen.getByTestId('delete-account-cancel'));
      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));
      expect(callsTo('POST', DELETE_PATH)).toHaveLength(0);
      expect(useSessionStore.getState().token).toBe('token-abc');
    });
  });

  describe('accessibility and theming (R1.11)', () => {
    it('every field has a label and every error text has an alert role', async () => {
      setupApi({
        reauth: async () => {
          throw apiError('reauth_failed', 'Re-authentication failed.', 403);
        },
      });
      await goToPasswordStep();
      expect(screen.getByTestId('delete-account-password').props.accessibilityLabel).toBe(
        'Current password',
      );
      expect(screen.getByText('Current password')).toBeTruthy();
      await verifyPassword('nope');
      const err = await screen.findByTestId('delete-account-password-error');
      expect(err.props.accessibilityRole).toBe('alert');
    });

    it('confirm field is labelled with the phrase', async () => {
      await goToConfirmStep();
      expect(screen.getByTestId('delete-account-confirmation').props.accessibilityLabel).toBe(
        'Type DELETE to confirm',
      );
    });

    it('paints from the active theme (Twilight dark background)', async () => {
      setTestScheme('dark');
      await openDeleteAccount();
      const root = screen.getByTestId('delete-account-screen');
      expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe(
        darkTheme.color.background,
      );
    });
  });
});
