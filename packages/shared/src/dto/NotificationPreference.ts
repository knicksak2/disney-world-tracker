/**
 * NotificationPreference DTO.
 *
 * A User's per-account `Share_Notification_Preference` (R9.3, R9.7). When a
 * User has never set a preference the service defaults
 * `shareNotificationsEnabled` to `true`; disabling it suppresses share
 * notifications for that recipient without affecting delivery of the Share
 * itself.
 *
 * Validates: Requirements 9.3, 9.7
 */

export interface NotificationPreferenceDTO {
  /**
   * Whether the User receives push notifications for Shares delivered to them.
   * Defaults to `true` when the User has not set a preference.
   */
  readonly shareNotificationsEnabled: boolean;
}
