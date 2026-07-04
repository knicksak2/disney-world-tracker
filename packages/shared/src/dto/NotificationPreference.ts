
/**
 * NotificationPreference DTO.
 *
 * A User's per-account push notification preference (R9.3, R9.7). When a User
 * has never set a preference the service defaults `pushNotificationsEnabled` to
 * `true`; disabling it suppresses all push notifications for that User (Share
 * deliveries and friend requests) without affecting the underlying actions.
 *
 * Validates: Requirements 9.3, 9.7
 */

export interface NotificationPreferenceDTO {
  /**
   * Whether the User receives push notifications at all. Governs both Share
   * deliveries and friend-request notifications. Defaults to `true` when the
   * User has not set a preference.
   */
  readonly pushNotificationsEnabled: boolean;
}
