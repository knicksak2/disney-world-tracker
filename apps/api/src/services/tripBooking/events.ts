/**
 * Background notification notices for Trip Booking Timeline.
 *
 * Dispatched to the Notification_Service by the Reminder_Runner.
 *
 * Validates: Requirements 9.3, 9.4, 9.7, 15.1
 */

import type { ReminderLead, WindowKind } from '@dwt/shared';

export interface TripBookingReminderNotice {
  readonly tripId: string;
  readonly tripName: string;
  readonly lead: ReminderLead;
  /** One entry per distinct Window_Kind (≤ 2), ordered dining → lightning_lane. */
  readonly windows: readonly {
    readonly kind: WindowKind;
    readonly dropAt: string;
    readonly firstCovered: string;
    readonly lastCovered: string;
  }[];
  /** ISO instant the event was built; the "Opened at" decision compares this to each dropAt. */
  readonly dispatchedAt: string;
  readonly recipientIds: readonly string[];
}
