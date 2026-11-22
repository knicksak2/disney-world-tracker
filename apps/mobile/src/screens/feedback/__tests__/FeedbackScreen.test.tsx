/**
 * In-app feedback: the entry row on the real `YouAndCrewScreen` and the real `FeedbackScreen`
 * (in-app-feedback R1 to R4, R7.3, R8.1).
 *
 * Only the network layer (`apiRequest`) and native modules are mocked. Each interaction asserts BOTH the network
 * call (endpoint + payload) and the on-screen change.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FEEDBACK_MESSAGE_MAX } from '@dwt/shared';

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
  default: { expoConfig: { version: '1.4.0', extra: { apiBaseUrl: 'http://test.local' } } },
}));
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});
jest.mock('../../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import Constants from 'expo-constants';
import YouAndCrewScreen from '../../youAndCrew/YouAndCrewScreen';
import SettingsScreen from '../../youAndCrew/SettingsScreen';
import FeedbackScreen, {
  GENERIC_SEND_ERROR,
  MESSAGE_LABEL,
  PRIVACY_NOTE,
  THANKS_TITLE,
  buildDeviceInfo,
} from '../FeedbackScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import { useThemeStore } from '../../../state/themeStore';
import { DEFAULT_APPEARANCE_PREFERENCE } from '../../../theme/appearance';
import { resetTestScheme } from '../../../test/themeTestUtils';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();
const FEEDBACK_PATH = '/me/feedback';
/** jest-expo leaves `Platform.Version` undefined, so it is pinned (a getter spy) to a realistic iOS version. */
const OS_VERSION = '17.5';
let versionSpy: jest.SpyInstance;

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

function setupApi(feedback: (body: unknown) => Promise<unknown> = async () => ({ id: 'fb-1' })): void {
  apiRequestMock.mockImplementation((async (method: string, path: string, body?: unknown) => {
    if (path === '/me') {
      return {
        user: { id: 'u1', email: 'mickey@disney.test' },
        profile: { displayName: 'Mickey Mouse', avatarPreset: null },
      };
    }
    if (path === '/users/u1/profile') return { userId: 'u1', displayName: 'Mickey Mouse', avatarPreset: null };
    if (path === '/me/friends') return { friends: [], incomingRequests: [], outgoingRequests: [] };
    if (method === 'POST' && path === FEEDBACK_PATH) return feedback(body);
    return {};
  }) as never);
}

function feedbackCalls(): unknown[][] {
  return apiRequestMock.mock.calls.filter((c) => c[0] === 'POST' && c[1] === FEEDBACK_PATH);
}
function lastBody(): Record<string, unknown> {
  const calls = feedbackCalls();
  return calls[calls.length - 1]![2] as Record<string, unknown>;
}
function apiError(code: string, message: string, status: number): ApiError {
  return new ApiError({ code: code as never, message, status });
}

describe('In-app feedback', () => {
  let queryClient: QueryClient;
  let navRef: ReturnType<typeof createNavigationContainerRef<YouAndCrewStackParamList>>;

  function renderApp() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="YouAndCrewMain" component={YouAndCrewScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Feedback" component={FeedbackScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  async function openSettings(): Promise<void> {
    renderApp();
    await screen.findByTestId('profile-display-name');
    fireEvent.press(screen.getByTestId('header-settings-button'));
    await screen.findByTestId('settings-screen');
  }

  async function openFeedback(): Promise<void> {
    await openSettings();
    fireEvent.press(screen.getByTestId('feedback-entry-button'));
    await screen.findByTestId('feedback-form');
  }

  const type = (text: string): void => {
    fireEvent.changeText(screen.getByTestId('feedback-message'), text);
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
    versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(OS_VERSION as never);
    setupApi();
  });
  afterEach(() => {
    versionSpy.mockRestore();
    resetTestScheme();
  });

  describe('entry row on SettingsScreen (R1.1, R1.8)', () => {
    it('is a labelled button above Delete account, and pressing it opens the Feedback screen without any request', async () => {
      await openSettings();
      const entry = screen.getByTestId('feedback-entry-button');
      expect(entry.props.accessibilityRole).toBe('button');
      expect(entry.props.accessibilityLabel).toBe('Report a problem or send feedback');
      expect(screen.getByText('Report a problem or send feedback')).toBeTruthy();

      const order: string[] = [];
      const walk = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const n = node as { props?: { testID?: string }; children?: unknown };
        const id = n.props?.testID;
        if ((id === 'feedback-entry-button' || id === 'delete-account-entry-button') && !order.includes(id)) order.push(id);
        walk(n.children);
      };
      walk(screen.toJSON());
      expect(order).toEqual(['feedback-entry-button', 'delete-account-entry-button']);

      fireEvent.press(entry);
      await screen.findByTestId('feedback-form');
      expect(navRef.getCurrentRoute()?.name).toBe('Feedback');
      expect(feedbackCalls()).toHaveLength(0);
    });
  });

  describe('form (R1.2 to R1.5, R7.3)', () => {
    it('shows the three kinds with Bug selected, the message prompt, the privacy note and the defaults', async () => {
      await openFeedback();
      expect(screen.getByText('Bug')).toBeTruthy();
      expect(screen.getByText('Idea')).toBeTruthy();
      expect(screen.getByText('Other')).toBeTruthy();
      expect(screen.getByTestId('feedback-kind-bug').props.accessibilityState).toEqual({ selected: true });
      expect(screen.getByTestId('feedback-kind-idea').props.accessibilityState).toEqual({ selected: false });
      expect(screen.getByText(MESSAGE_LABEL)).toBeTruthy();
      expect(screen.getByTestId('feedback-privacy-note').props.children).toBe(PRIVACY_NOTE);
      expect(screen.getByTestId('feedback-device-switch').props.value).toBe(true);
      expect(screen.getByTestId('feedback-contact-checkbox').props.accessibilityState).toEqual({ checked: false });
      expect(screen.getByTestId('feedback-counter').props.children).toBe(`0/${FEEDBACK_MESSAGE_MAX}`);
    });

    it('states exactly which three device values are sent', async () => {
      await openFeedback();
      const hint = screen.getByTestId('feedback-device-hint').props.children as string;
      expect(hint).toContain('app version (1.4.0)');
      expect(hint).toContain(`platform (${Platform.OS})`);
      expect(hint).toContain(`OS version (${OS_VERSION})`);
    });

    it('selecting a kind moves the selected state (conveyed by accessibilityState and the spoken label, not colour)', async () => {
      await openFeedback();
      fireEvent.press(screen.getByTestId('feedback-kind-idea'));
      expect(screen.getByTestId('feedback-kind-idea').props.accessibilityState).toEqual({ selected: true });
      expect(screen.getByTestId('feedback-kind-idea').props.accessibilityLabel).toBe('Idea, selected');
      expect(screen.getByTestId('feedback-kind-bug').props.accessibilityState).toEqual({ selected: false });
      expect(screen.getByTestId('feedback-kind-bug').props.accessibilityLabel).toBe('Bug, not selected');
    });

    it('the counter follows the typed text and the field refuses input beyond the limit', async () => {
      await openFeedback();
      type('hello');
      expect(screen.getByTestId('feedback-counter').props.children).toBe(`5/${FEEDBACK_MESSAGE_MAX}`);
      expect(screen.getByTestId('feedback-message').props.maxLength).toBe(FEEDBACK_MESSAGE_MAX);
    });

    it('every control carries an accessibility label', async () => {
      await openFeedback();
      expect(screen.getByTestId('feedback-message').props.accessibilityLabel).toBe('Your message');
      expect(screen.getByTestId('feedback-device-switch').props.accessibilityLabel).toBe('Include device info');
      expect(screen.getByTestId('feedback-contact-checkbox').props.accessibilityLabel).toBe(
        'You may contact me at my account email',
      );
      expect(screen.getByTestId('feedback-send').props.accessibilityLabel).toBe('Send');
    });
  });

  describe('sending (R1.4, R1.6, R2.1)', () => {
    it('Send is disabled for an empty or whitespace-only message and sends nothing when pressed', async () => {
      await openFeedback();
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBe(true);
      fireEvent.press(screen.getByTestId('feedback-send'));
      type('   \n ');
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBe(true);
      fireEvent.press(screen.getByTestId('feedback-send'));
      expect(feedbackCalls()).toHaveLength(0);
      type('now it has text');
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBeFalsy();
    });

    it('sends the default kind with the trimmed message, contact off and device info on, then shows the confirmation', async () => {
      await openFeedback();
      type('  The wait times screen froze  ');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');

      expect(feedbackCalls()).toHaveLength(1);
      expect(lastBody()).toEqual({
        kind: 'bug',
        message: 'The wait times screen froze',
        contactOk: false,
        device: { appVersion: '1.4.0', platform: Platform.OS, osVersion: OS_VERSION },
      });
      expect(screen.getByText(THANKS_TITLE)).toBeTruthy();
      expect(screen.queryByTestId('feedback-form')).toBeNull();
      expect(screen.queryByTestId('feedback-message')).toBeNull();
    });

    it('Idea: the chosen kind is the one sent', async () => {
      await openFeedback();
      fireEvent.press(screen.getByTestId('feedback-kind-idea'));
      type('Add a packing list');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      expect(lastBody()).toMatchObject({ kind: 'idea', message: 'Add a packing list' });
    });

    it('switching device info off sends no device object', async () => {
      await openFeedback();
      fireEvent(screen.getByTestId('feedback-device-switch'), 'valueChange', false);
      expect(screen.getByTestId('feedback-device-switch').props.value).toBe(false);
      type('no device please');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      expect(lastBody()).toEqual({ kind: 'bug', message: 'no device please', contactOk: false });
      expect('device' in lastBody()).toBe(false);
    });

    it('ticking the contact checkbox sends contactOk true, and never sends an email field', async () => {
      await openFeedback();
      fireEvent.press(screen.getByTestId('feedback-contact-checkbox'));
      expect(screen.getByTestId('feedback-contact-checkbox').props.accessibilityState).toEqual({ checked: true });
      type('call me');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      expect(lastBody().contactOk).toBe(true);
      expect(Object.keys(lastBody()).sort()).toEqual(['contactOk', 'device', 'kind', 'message']);
    });

    it('Done on the confirmation returns to Settings', async () => {
      await openFeedback();
      type('all good');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      fireEvent.press(screen.getByTestId('feedback-done'));
      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('Settings'));
      expect(await screen.findByTestId('feedback-entry-button')).toBeTruthy();
    });

    it('opening the screen again after a send starts with an empty, default form', async () => {
      await openFeedback();
      fireEvent.press(screen.getByTestId('feedback-kind-other'));
      type('first');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      fireEvent.press(screen.getByTestId('feedback-done'));
      await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('Settings'));
      fireEvent.press(await screen.findByTestId('feedback-entry-button'));
      await screen.findByTestId('feedback-form');
      expect(screen.getByTestId('feedback-message').props.value).toBe('');
      expect(screen.getByTestId('feedback-kind-bug').props.accessibilityState).toEqual({ selected: true });
    });
  });

  describe('failure and duplicates (R3.4, R4.1, R4.2, R4.3)', () => {
    it('keeps kind, text, device switch and contact exactly as entered after a failure, shows a generic error, and retry succeeds', async () => {
      let attempts = 0;
      setupApi(async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Network request failed');
        return { id: 'fb-2' };
      });
      await openFeedback();
      fireEvent.press(screen.getByTestId('feedback-kind-idea'));
      fireEvent(screen.getByTestId('feedback-device-switch'), 'valueChange', false);
      fireEvent.press(screen.getByTestId('feedback-contact-checkbox'));
      type('keep me');
      fireEvent.press(screen.getByTestId('feedback-send'));

      expect((await screen.findByTestId('feedback-error')).props.children).toBe(GENERIC_SEND_ERROR);
      expect(screen.getByTestId('feedback-message').props.value).toBe('keep me');
      expect(screen.getByTestId('feedback-kind-idea').props.accessibilityState).toEqual({ selected: true });
      expect(screen.getByTestId('feedback-device-switch').props.value).toBe(false);
      expect(screen.getByTestId('feedback-contact-checkbox').props.accessibilityState).toEqual({ checked: true });
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBeFalsy();
      expect(screen.queryByTestId('feedback-confirmation')).toBeNull();

      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      expect(feedbackCalls()).toHaveLength(2);
      expect(feedbackCalls()[1]![2]).toEqual({ kind: 'idea', message: 'keep me', contactOk: true });
    });

    it('a 5xx shows the generic error as well', async () => {
      setupApi(async () => {
        throw apiError('internal_error', 'boom with internal detail', 500);
      });
      await openFeedback();
      type('x');
      fireEvent.press(screen.getByTestId('feedback-send'));
      const err = await screen.findByTestId('feedback-error');
      expect(err.props.children).toBe(GENERIC_SEND_ERROR);
    });

    it('a 429 shows the API message, keeps the text, and leaves Send usable', async () => {
      const limitMessage = 'You have sent a lot of feedback recently. Please try again later.';
      setupApi(async () => {
        throw apiError('rate_limit_exceeded', limitMessage, 429);
      });
      await openFeedback();
      type('too many');
      fireEvent.press(screen.getByTestId('feedback-send'));
      expect((await screen.findByTestId('feedback-error')).props.children).toBe(limitMessage);
      expect(screen.getByTestId('feedback-message').props.value).toBe('too many');
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBeFalsy();
    });

    it('typing clears the error message', async () => {
      setupApi(async () => {
        throw apiError('rate_limit_exceeded', 'slow down', 429);
      });
      await openFeedback();
      type('abc');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-error');
      type('abcd');
      expect(screen.queryByTestId('feedback-error')).toBeNull();
    });

    it('a second press while a send is in flight is ignored: one request, Send shows as disabled meanwhile', async () => {
      const gate = deferred<unknown>();
      setupApi(() => gate.promise);
      await openFeedback();
      type('double tap');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await waitFor(() => expect(feedbackCalls()).toHaveLength(1));
      expect(screen.getByTestId('feedback-send').props.accessibilityState?.disabled).toBe(true);
      fireEvent.press(screen.getByTestId('feedback-send'));
      fireEvent.press(screen.getByTestId('feedback-send'));
      expect(feedbackCalls()).toHaveLength(1);

      await act(async () => {
        gate.resolve({ id: 'fb-3' });
        await gate.promise;
      });
      await screen.findByTestId('feedback-confirmation');
      expect(feedbackCalls()).toHaveLength(1);
    });

    it('never writes the draft to device storage', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AsyncStorage = require('@react-native-async-storage/async-storage');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SecureStore = require('expo-secure-store');
      AsyncStorage.setItem.mockClear?.();
      SecureStore.setItemAsync.mockClear();
      await openFeedback();
      type('private words that must not be persisted');
      fireEvent.press(screen.getByTestId('feedback-send'));
      await screen.findByTestId('feedback-confirmation');
      const written = [
        ...(AsyncStorage.setItem.mock?.calls ?? []),
        ...(AsyncStorage.multiSet?.mock?.calls ?? []),
        ...SecureStore.setItemAsync.mock.calls,
      ];
      expect(JSON.stringify(written)).not.toContain('private words');
    });
  });

  describe('device info availability', () => {
    it('with no app version the switch is off and disabled, a note says so, and no device object is sent', async () => {
      const constants = Constants as unknown as { expoConfig: { version?: string; extra: unknown } };
      const original = constants.expoConfig.version;
      delete constants.expoConfig.version;
      try {
        await openFeedback();
        const sw = screen.getByTestId('feedback-device-switch');
        expect(sw.props.value).toBe(false);
        expect(sw.props.disabled).toBe(true);
        expect(screen.getByTestId('feedback-device-hint').props.children).toContain('not available');
        type('no version');
        fireEvent.press(screen.getByTestId('feedback-send'));
        await screen.findByTestId('feedback-confirmation');
        expect('device' in lastBody()).toBe(false);
      } finally {
        if (original !== undefined) constants.expoConfig.version = original;
      }
    });
  });

  describe('buildDeviceInfo', () => {
    it('returns the app version, platform and stringified OS version', () => {
      expect(buildDeviceInfo()).toEqual({
        appVersion: '1.4.0',
        platform: Platform.OS,
        osVersion: OS_VERSION,
      });
    });

    it('returns undefined for an unsupported platform', () => {
      const spy = jest.replaceProperty(Platform, 'OS', 'windows' as never);
      try {
        expect(buildDeviceInfo()).toBeUndefined();
      } finally {
        spy.restore();
      }
    });

    it('returns undefined when the OS version is missing', () => {
      versionSpy.mockReturnValue(undefined as never);
      expect(buildDeviceInfo()).toBeUndefined();
    });

    it('stringifies a numeric Android API level', () => {
      const os = jest.replaceProperty(Platform, 'OS', 'android' as never);
      versionSpy.mockReturnValue(34 as never);
      try {
        expect(buildDeviceInfo()).toEqual({ appVersion: '1.4.0', platform: 'android', osVersion: '34' });
      } finally {
        os.restore();
      }
    });

    it('returns undefined rather than a value the API would reject (a version over 32 characters)', () => {
      versionSpy.mockReturnValue('v'.repeat(33) as never);
      expect(buildDeviceInfo()).toBeUndefined();
    });
  });
});
