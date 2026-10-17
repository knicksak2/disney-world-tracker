/**
 * Tests for bookingTimelineApi client functions and TanStack Query keys (Task 11.1).
 *
 * Validates: Requirements 6.6, 6.8, 6.10, 11.6, 13.3, 13.6, 13.7, 13.11, 15.5
 */

import { apiRequest } from '../../../api/client';
import {
  bookingKeys,
  fetchBookingTimeline,
  patchBookingSettings,
  putWindowDone,
  putReminderMute,
  fetchPackingList,
  addPackingItem,
  patchPackingItem,
  deletePackingItem,
  putPacked,
  addStarterItems,
} from '../bookingTimelineApi';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('bookingTimelineApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('bookingKeys', () => {
    it('produces distinct query keys for timeline and packing', () => {
      const tripId = 'trip-123';
      const timelineKey = bookingKeys.timeline(tripId);
      const packingKey = bookingKeys.packing(tripId);

      expect(timelineKey).toEqual(['tripBooking', 'timeline', tripId]);
      expect(packingKey).toEqual(['tripBooking', 'packing', tripId]);
      expect(timelineKey).not.toEqual(packingKey);
    });
  });

  describe('API client functions', () => {
    it('fetchBookingTimeline requests GET /trips/:id/booking-timeline', async () => {
      mockApiRequest.mockResolvedValueOnce({ tripId: 't1' });
      const result = await fetchBookingTimeline('t1');

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('GET', '/trips/t1/booking-timeline');
      expect(result).toEqual({ tripId: 't1' });
    });

    it('patchBookingSettings sends only supplied fields to PATCH /trips/:id/booking-settings', async () => {
      mockApiRequest.mockResolvedValueOnce({ tripId: 't1', stayType: 'resort' });
      const patch = { stayType: 'resort' as const };
      await patchBookingSettings('t1', patch);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/trips/t1/booking-settings', {
        stayType: 'resort',
      });
    });

    it('putWindowDone calls PUT /trips/:id/booking-windows/:kind/:dropOn/done with { done }', async () => {
      mockApiRequest.mockResolvedValueOnce({ windowKey: 'dining:2025-04-15', done: true });
      await putWindowDone('t', 'dining', '2025-04-15', true);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith(
        'PUT',
        '/trips/t/booking-windows/dining/2025-04-15/done',
        { done: true },
      );
    });

    it('putReminderMute calls PUT /me/trips/:id/booking-reminders with { muted }', async () => {
      mockApiRequest.mockResolvedValueOnce({ tripId: 't', muted: true });
      await putReminderMute('t', true);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', '/me/trips/t/booking-reminders', {
        muted: true,
      });
    });

    it('fetchPackingList requests GET /trips/:id/packing-items', async () => {
      mockApiRequest.mockResolvedValueOnce({ items: [], totalCount: 0, packedCount: 0 });
      await fetchPackingList('t1');

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('GET', '/trips/t1/packing-items');
    });

    it('addPackingItem sends POST /trips/:id/packing-items with payload', async () => {
      const payload = { name: 'Sunscreen', category: 'toiletries' as const, quantity: 2 };
      mockApiRequest.mockResolvedValueOnce({ id: 'item-1', ...payload });
      await addPackingItem('t1', payload);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/trips/t1/packing-items', payload);
    });

    it('patchPackingItem sends PATCH /trips/:id/packing-items/:itemId with payload', async () => {
      const patch = { quantity: 3 };
      mockApiRequest.mockResolvedValueOnce({ id: 'i1', quantity: 3 });
      await patchPackingItem('t1', 'i1', patch);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/trips/t1/packing-items/i1', patch);
    });

    it('deletePackingItem sends DELETE /trips/:id/packing-items/:itemId', async () => {
      mockApiRequest.mockResolvedValueOnce(undefined);
      await deletePackingItem('t1', 'i1');

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', '/trips/t1/packing-items/i1');
    });

    it('putPacked sends PUT /trips/:id/packing-items/:itemId/packed with { packed }', async () => {
      mockApiRequest.mockResolvedValueOnce({ id: 'i1', packed: true });
      await putPacked('t1', 'i1', true);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', '/trips/t1/packing-items/i1/packed', {
        packed: true,
      });
    });

    it('addStarterItems calls POST /trips/:id/packing-items/starter with no body', async () => {
      mockApiRequest.mockResolvedValueOnce({ added: 21 });
      await addStarterItems('t');

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/trips/t/packing-items/starter');
    });
  });
});
