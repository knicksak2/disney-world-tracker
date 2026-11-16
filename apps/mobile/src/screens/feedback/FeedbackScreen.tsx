/**
 * FeedbackScreen: report a problem or send an idea (in-app-feedback R1 to R4, R7.3).
 *
 *   - Kind picker (Bug / Idea / Other), a message capped at `FEEDBACK_MESSAGE_MAX`, an "Include device info" switch
 *     (default on) and a "You may contact me" checkbox (default off).
 *   - `POST /me/feedback` through `useMutation`. The draft lives in component state only (never written to storage)
 *     and is kept exactly as typed when a send fails, so the user can retry without retyping.
 *   - A second press while a send is in flight is ignored (no duplicate submission).
 *   - On success the form is replaced by a confirmation.
 *
 * The contact email is never sent from here: the server copies the account email only when `contactOk` is true.
 */
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  feedbackDeviceSchema,
  type FeedbackDevice,
  type FeedbackKind,
  type FeedbackSubmitInput,
  type FeedbackSubmitResponse,
} from '@dwt/shared';
import { ApiError, apiRequest } from '../../api/client';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import {
  Card,
  Chip,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<YouAndCrewStackParamList, 'Feedback'>;

export const KIND_LABELS: Readonly<Record<FeedbackKind, string>> = {
  bug: 'Bug',
  idea: 'Idea',
  other: 'Other',
};

export const MESSAGE_LABEL =
  'Describe the problem or idea. If it is about a specific screen, tell us which one and what you expected to happen.';
export const GENERIC_SEND_ERROR = 'Could not send. Check your connection and try again.';
export const THANKS_TITLE = 'Thanks, we got it';
export const PRIVACY_NOTE =
  'Only the app operator can read what you send. It is deleted if you delete your account.';

/**
 * App version, platform and OS version, or `undefined` when any of the three is unavailable (all-or-nothing, so a
 * partial object is never sent). Validated against the shared schema, so what is built is exactly what the API accepts.
 */
export function buildDeviceInfo(): FeedbackDevice | undefined {
  const os = Platform.OS;
  if (os !== 'ios' && os !== 'android' && os !== 'web') return undefined;
  const version: unknown = Platform.Version;
  const candidate = {
    appVersion: Constants?.expoConfig?.version ?? '',
    platform: os,
    osVersion: version === undefined || version === null ? '' : String(version),
  };
  const parsed = feedbackDeviceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function sendErrorText(err: unknown): string {
  // The API words its 400 and 429 messages for the user. Anything else (network, 5xx) gets the generic text.
  if (err instanceof ApiError && (err.status === 400 || err.status === 429)) return err.message;
  return GENERIC_SEND_ERROR;
}

export default function FeedbackScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<NavigationProp>();
  const device = useMemo(() => buildDeviceInfo(), []);

  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [includeDevice, setIncludeDevice] = useState(true);
  const [contactOk, setContactOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const deviceAvailable = device !== undefined;
  const sendDevice = includeDevice && deviceAvailable;

  const mutation = useMutation<FeedbackSubmitResponse, unknown, FeedbackSubmitInput>({
    mutationFn: (body) => apiRequest<FeedbackSubmitResponse>('POST', '/me/feedback', body),
    onSuccess: () => {
      setMessage('');
      setError(null);
      setSent(true);
    },
    // The draft (kind, message, switches) is left untouched so Send can be retried as is.
    onError: (err) => {
      setError(sendErrorText(err));
    },
  });

  const busy = mutation.isPending;
  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && !busy;

  const handleSend = (): void => {
    if (busy || trimmed.length === 0) return;
    setError(null);
    const body: FeedbackSubmitInput = {
      kind,
      message: trimmed,
      contactOk,
      ...(sendDevice && device !== undefined ? { device } : {}),
    };
    mutation.mutate(body);
  };

  const handleDone = (): void => {
    navigation.goBack();
  };

  return (
    <ScreenContainer testID="feedback-screen">
      <GradientHeader
        title="Send feedback"
        subtitle="Report a problem or share an idea"
        icon="chatbubbles"
        compact
        onBack={busy ? undefined : handleDone}
        backAccessibilityLabel="Go back"
        backTestID="feedback-back"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {sent ? (
            <Card testID="feedback-confirmation">
              <View style={styles.thanksRow}>
                <Ionicons name="checkmark-circle" size={28} color={t.color.success} />
                <Text style={styles.heading} accessibilityRole="header">
                  {THANKS_TITLE}
                </Text>
              </View>
              <Text style={styles.body}>Your message was sent to the app operator.</Text>
              <PrimaryButton label="Done" onPress={handleDone} testID="feedback-done" />
            </Card>
          ) : (
            <Card testID="feedback-form">
              <Text style={styles.label}>What kind of feedback is this?</Text>
              <View style={styles.chipRow} accessibilityRole="radiogroup">
                {FEEDBACK_KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={KIND_LABELS[k]}
                    active={kind === k}
                    onPress={() => {
                      if (!busy) setKind(k);
                    }}
                    testID={`feedback-kind-${k}`}
                  />
                ))}
              </View>

              <Text style={styles.label}>{MESSAGE_LABEL}</Text>
              <TextInput
                style={[styles.input, styles.messageInput]}
                value={message}
                onChangeText={(value) => {
                  setMessage(value);
                  if (error !== null) setError(null);
                }}
                multiline
                textAlignVertical="top"
                maxLength={FEEDBACK_MESSAGE_MAX}
                editable={!busy}
                placeholder="Which screen were you on? What happened, and what did you expect?"
                placeholderTextColor={t.color.textSecondary}
                keyboardAppearance={t.scheme}
                accessibilityLabel="Your message"
                testID="feedback-message"
              />
              <Text
                style={styles.counter}
                accessibilityLabel={`${message.length} of ${FEEDBACK_MESSAGE_MAX} characters used`}
                testID="feedback-counter"
              >
                {`${message.length}/${FEEDBACK_MESSAGE_MAX}`}
              </Text>

              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>Include device info</Text>
                  <Text style={styles.hint} testID="feedback-device-hint">
                    {deviceAvailable
                      ? `Sends your app version (${device.appVersion}), platform (${device.platform}) and OS version (${device.osVersion}). Nothing else about your device.`
                      : 'Device info is not available on this device, so none will be sent.'}
                  </Text>
                </View>
                <Switch
                  value={sendDevice}
                  onValueChange={setIncludeDevice}
                  disabled={!deviceAvailable || busy}
                  trackColor={{ false: t.color.border, true: t.color.primary }}
                  accessibilityLabel="Include device info"
                  testID="feedback-device-switch"
                />
              </View>

              <Pressable
                style={styles.checkboxRow}
                onPress={() => {
                  if (!busy) setContactOk((v) => !v);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: contactOk }}
                accessibilityLabel="You may contact me at my account email"
                testID="feedback-contact-checkbox"
              >
                <Ionicons
                  name={contactOk ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={contactOk ? t.color.primaryFg : t.color.textSecondary}
                />
                <Text style={styles.checkboxText}>You may contact me at my account email</Text>
              </Pressable>
              <Text style={styles.hint}>
                If you tick this, your account email is attached to this message. Otherwise it is not.
              </Text>

              <Text style={styles.privacy} testID="feedback-privacy-note">
                {PRIVACY_NOTE}
              </Text>

              {error !== null ? (
                <Text style={styles.error} accessibilityRole="alert" testID="feedback-error">
                  {error}
                </Text>
              ) : null}

              <PrimaryButton
                label="Send"
                icon="send"
                loading={busy}
                disabled={!canSend}
                onPress={handleSend}
                testID="feedback-send"
              />
              <SecondaryButton
                label="Cancel"
                onPress={handleDone}
                disabled={busy}
                style={styles.secondary}
                testID="feedback-cancel"
              />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  content: {
    padding: t.spacing.md,
    paddingBottom: t.spacing.xxl,
  },
  heading: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
  thanksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  body: {
    ...t.typography.body,
    color: t.color.textSecondary,
    marginBottom: t.spacing.md,
  },
  label: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: t.spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
    marginBottom: t.spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    fontSize: 16,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
  },
  messageInput: {
    minHeight: 140,
  },
  counter: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    textAlign: 'right',
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  switchText: { flex: 1 },
  switchTitle: {
    ...t.typography.body,
    color: t.color.textPrimary,
  },
  hint: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.sm,
  },
  checkboxText: {
    ...t.typography.body,
    flex: 1,
    color: t.color.textPrimary,
  },
  privacy: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  error: {
    color: t.color.danger,
    fontSize: 14,
    marginBottom: t.spacing.md,
  },
  secondary: {
    marginTop: t.spacing.sm,
  },
}));
