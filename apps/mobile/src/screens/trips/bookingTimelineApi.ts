/**
 * TanStack Query keys and API client functions for Trip Booking Timeline & Packing List (Task 11.1).
 *
 * Validates: Requirements 6.6, 6.8, 6.10, 11.6, 13.3, 13.6, 13.7, 13.11, 15.5
 */

import type {
  BookingTimelineDTO,
  BookingSettingsDTO,
  BookingWindowDTO,
  BookingReminderMuteDTO,
  PackingListDTO,
  PackingItemDTO,
  WindowKind,
  BookingSettingsUpdateInput,
  PackingItemCreateInput,
  PackingItemUpdateInput,
} from '@dwt/shared';
import { apiRequest } from '../../api/client';

export const bookingKeys = {
  all: ['tripBooking'] as const,
  timeline: (tripId: string) => [...bookingKeys.all, 'timeline', tripId] as const,
  packing: (tripId: string) => [...bookingKeys.all, 'packing', tripId] as const,
};

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

export async function fetchBookingTimeline(tripId: string): Promise<BookingTimelineDTO> {
  return apiRequest<BookingTimelineDTO>('GET', `/trips/${tripId}/booking-timeline`);
}

export async function patchBookingSettings(
  tripId: string,
  input: BookingSettingsUpdateInput,
): Promise<BookingSettingsDTO> {
  return apiRequest<BookingSettingsDTO>('PATCH', `/trips/${tripId}/booking-settings`, input);
}

export async function putWindowDone(
  tripId: string,
  kind: WindowKind,
  dropOn: string,
  done: boolean,
): Promise<BookingWindowDTO> {
  return apiRequest<BookingWindowDTO>(
    'PUT',
    `/trips/${tripId}/booking-windows/${kind}/${dropOn}/done`,
    { done },
  );
}

export async function putReminderMute(
  tripId: string,
  muted: boolean,
): Promise<BookingReminderMuteDTO> {
  return apiRequest<BookingReminderMuteDTO>('PUT', `/me/trips/${tripId}/booking-reminders`, {
    muted,
  });
}

export async function fetchPackingList(tripId: string): Promise<PackingListDTO> {
  return apiRequest<PackingListDTO>('GET', `/trips/${tripId}/packing-items`);
}

export async function addPackingItem(
  tripId: string,
  input: PackingItemCreateInput,
): Promise<PackingItemDTO> {
  return apiRequest<PackingItemDTO>('POST', `/trips/${tripId}/packing-items`, input);
}

export async function patchPackingItem(
  tripId: string,
  itemId: string,
  input: PackingItemUpdateInput,
): Promise<PackingItemDTO> {
  return apiRequest<PackingItemDTO>('PATCH', `/trips/${tripId}/packing-items/${itemId}`, input);
}

export async function deletePackingItem(tripId: string, itemId: string): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/packing-items/${itemId}`);
}

export async function putPacked(
  tripId: string,
  itemId: string,
  packed: boolean,
): Promise<PackingItemDTO> {
  return apiRequest<PackingItemDTO>('PUT', `/trips/${tripId}/packing-items/${itemId}/packed`, {
    packed,
  });
}

export async function addStarterItems(tripId: string): Promise<{ added: number }> {
  return apiRequest<{ added: number }>('POST', `/trips/${tripId}/packing-items/starter`);
}
